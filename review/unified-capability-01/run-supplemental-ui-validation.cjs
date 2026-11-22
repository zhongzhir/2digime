'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  beginTalk,
  talkState,
  waitForPersistedCancellation,
  waitForTalkCompletion,
} = require('./ui-request-lifecycle.cjs');
const {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
} = require('../../dist/runtime/tests/electron-harness.js');

const ROOT = path.resolve(__dirname, '..', '..');
const RESULT_FILE = path.join(__dirname, 'supplemental-ui-validation-result.json');
const EVIDENCE_DIR = path.join(__dirname, 'evidence', 'supplemental');
const KEY_CSV = process.env.DIGITALME_VALIDATION_KEY_CSV ||
  'D:\\Projects\\Digital Me\\trial\\默认业务空间-apiKey-7639591.csv';
const BASE_URL = 'https://ws-ok2fv132ihswnia7.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
const MODEL = 'qwen3.8-flash';
const PRIOR_ADMISSION_CNY = 1.8442125;
const SUPPLEMENTAL_TARGET_CNY = 2;
const PRIOR_SUPPLEMENTAL_UNKNOWN_CNY = 1.25;

function readKeyValueCsv(file) {
  const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const values = {};
  for (const row of rows) {
    const comma = row.indexOf(',');
    if (comma < 0) continue;
    const name = row.slice(0, comma).replace(/^"|"$/g, '').trim();
    const value = row.slice(comma + 1).replace(/^"|"$/g, '').trim();
    values[name] = value;
  }
  if (!values.apiKey || values.apiKey.length < 20) throw new Error('credential CSV has no usable apiKey');
  return values.apiKey;
}

function redact(value) {
  return String(value || '')
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}\b/g, '[REDACTED]')
    .replace(/(authorization|api[_-]?key|bearer)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}

function readNdjson(file) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function collectTraces(value, out) {
  if (!value || typeof value !== 'object') return;
  if (value.provider === 'responses' && value.usage && Number.isFinite(value.usage.estimatedCostCny)) {
    const key = value.responseId || JSON.stringify([
      value.elapsedMs,
      value.usage.inputTokens,
      value.usage.outputTokens,
      value.webSearchCalls,
      value.webExtractorCalls,
    ]);
    out.set(key, value);
  }
  for (const child of Object.values(value)) collectTraces(child, out);
}

function listFiles(root) {
  const out = [];
  if (!root || !fs.existsSync(root)) return out;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(full);
    }
  };
  walk(root);
  return out.sort();
}

function lastAssistant(view) {
  const turns = (((view || {}).view || {}).turns || []).filter((turn) => turn.role === 'assistant');
  return turns[turns.length - 1] || null;
}

function articlePathIsSpecific(raw) {
  try {
    const url = new URL(raw);
    const cleaned = url.pathname.replace(/\/+$/, '');
    return /^https?:$/.test(url.protocol) && cleaned.length > 1;
  } catch {
    return false;
  }
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const apiKey = readKeyValueCsv(KEY_CSV);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'digitalme-unified-supplemental-'));
  const report = {
    task: 'DIGITALME-UNIFIED-CAPABILITY-01 supplemental validation',
    startedAt: new Date().toISOString(),
    head: '',
    endpoint: BASE_URL,
    model: MODEL,
    isolatedUserData: userData,
    credential: { source: 'local CSV read in runner process', valueRecorded: false },
    budget: {
      priorAdmissionCny: PRIOR_ADMISSION_CNY,
      supplementalTargetCny: SUPPLEMENTAL_TARGET_CNY,
      supplementalKnownCny: 0,
      supplementalUnknownReserveCny: PRIOR_SUPPLEMENTAL_UNKNOWN_CNY,
      requests: [
        { name: '00-csp-runner-aborted-consultation', status: 'runner_failed_after_request_start', reserveCny: 0.25, knownCny: 0, unknownReserveCny: 0.25 },
        { name: '00-completed-consultation-with-missing-trace', status: 'completed_trace_missing', reserveCny: 0.25, knownCny: 0, unknownReserveCny: 0.25 },
        { name: '00-completed-artifact-with-missing-trace', status: 'completed_trace_missing', reserveCny: 0.45, knownCny: 0, unknownReserveCny: 0.45 },
        { name: '00-invalid-permission-case-path', status: 'runner_wait_timeout_after_request_start', reserveCny: 0.30, knownCny: 0, unknownReserveCny: 0.30 },
      ],
    },
    tasks: {},
    failures: [],
  };
  let harness;
  let page;
  let subjectDir = '';
  let stoppedForBudget = false;

  const screenshot = async (name) => {
    await page.screenshot({ path: path.join(EVIDENCE_DIR, name + '.png'), fullPage: true });
  };
  const allTraces = async () => {
    const traces = new Map();
    if (page) {
      try {
        collectTraces(await page.evaluate(() => window.digitalMe.invoke('talk', {})), traces);
      } catch {}
    }
    if (subjectDir) {
      collectTraces(readNdjson(path.join(subjectDir, 'content', 'talk-diagnostics.ndjson')), traces);
      collectTraces(readNdjson(path.join(subjectDir, 'content', 'discovery-diagnostics.ndjson')), traces);
    }
    return traces;
  };
  const eventCount = () => page.evaluate(() => (window.__supplementalEvents || []).length);
  const eventsSince = (from) => page.evaluate((start) => (window.__supplementalEvents || []).slice(start), from);
  const admit = async (name, reserveCny) => {
    const used = report.budget.supplementalKnownCny + report.budget.supplementalUnknownReserveCny;
    if (used + reserveCny > SUPPLEMENTAL_TARGET_CNY) {
      stoppedForBudget = true;
      throw new Error(`VALIDATION_BUDGET_REACHED before ${name}`);
    }
    return { name, reserveCny, before: await allTraces(), eventStart: await eventCount(), startedAt: Date.now() };
  };
  const settle = async (ticket, status, events, forceUnknown) => {
    const after = await allTraces();
    const newTraces = [];
    let knownCny = 0;
    for (const [key, trace] of after) {
      if (ticket.before.has(key)) continue;
      newTraces.push(trace);
      knownCny += Number(trace.usage.estimatedCostCny || 0);
    }
    const starts = events.filter((event) => event.stage === 'request_started').length;
    const terminals = events.filter((event) => ['completed', 'failed', 'cancelled'].includes(event.stage)).length;
    const incomplete = forceUnknown || starts > terminals || status === 'failed';
    const unknownReserveCny = incomplete ? Math.max(0, ticket.reserveCny - knownCny) : 0;
    report.budget.supplementalKnownCny += knownCny;
    report.budget.supplementalUnknownReserveCny += unknownReserveCny;
    const row = {
      name: ticket.name,
      status,
      reserveCny: ticket.reserveCny,
      knownCny,
      unknownReserveCny,
      startedProviderRequests: starts,
      terminalProviderEvents: terminals,
      traceCount: newTraces.length,
      elapsedMs: Date.now() - ticket.startedAt,
      traces: newTraces,
    };
    report.budget.requests.push(row);
    return row;
  };
  const finishTalk = async (ticket, lifecycle, name, opts = {}) => {
    const completed = await waitForTalkCompletion(page, lifecycle, opts.timeoutMs || 300_000);
    const events = await eventsSince(ticket.eventStart);
    const assistant = lastAssistant(completed.view);
    const budget = await settle(ticket, assistant ? 'completed' : 'failed', events, !assistant);
    const result = {
      elapsedMs: completed.elapsedMs,
      assistant: assistant ? {
        text: redact(assistant.text),
        result: assistant.result || null,
        capabilityTrace: assistant.capabilityTrace || [],
      } : null,
      events,
      permissionDialogVisibleAtEnd: await page.locator('#folder-access-dialog').isVisible(),
      budget,
    };
    report.tasks[name] = result;
    await screenshot(name);
    return { ...completed, assistant, result };
  };
  const sendTalk = async (name, text, reserveCny, opts) => {
    const ticket = await admit(name, reserveCny);
    const lifecycle = await beginTalk(page, text);
    return finishTalk(ticket, lifecycle, name, opts);
  };

  try {
    report.head = require('node:child_process').execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    harness = await launchDigitalMeElectron({
      userData,
      realProduct: true,
      extraEnv: {
        DIGITALME_V2_ALLOW_DEV_CREDENTIAL: '0',
        DIGITALME_V2_TALK_UI_DEADLINE_MS: '300000',
      },
    });
    page = harness.page;
    report.configuration = await page.evaluate(async (input) => {
      const saved = await window.digitalMe.saveModelCredential({
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        model: input.model,
        providerPreset: 'openai-compatible',
      });
      await window.digitalMe.saveAiCapabilitySettings({ path: 'byok' });
      await window.digitalMe.saveWebDiscoverySettings({ enabled: true, path: 'byok' });
      const status = await window.digitalMe.getModelStatus();
      return {
        saveModelReady: saved.modelReady,
        activeModelReady: status.modelReady,
        model: status.modelMeta && status.modelMeta.model,
        host: status.modelMeta && status.modelMeta.baseUrlHost,
        aiCapabilityPath: status.aiCapabilityPath,
      };
    }, { apiKey, baseUrl: BASE_URL, model: MODEL });
    await skipWelcomeAndEnterShell(page);
    await page.evaluate(() => {
      window.__supplementalEvents = [];
      window.digitalMe.onCapabilityProgress((event) => window.__supplementalEvents.push(event));
    });
    subjectDir = (await page.evaluate(() => window.digitalMe.getDefaultSubjectDir())).dir;
    report.subjectDir = subjectDir;

    if (process.env.DIGITALME_VALIDATION_INCLUDE_COMPLETED === '1') {
    const consult = await sendTalk(
      '01-consultation',
      '如果我给你说清楚数字之我的内容，你能不能起草一个标准的播客制作文件，给专业工具来完成制作。',
      0.25,
    );
    report.tasks['01-consultation'].checks = {
      effectiveAnswer: Boolean(consult.assistant && String(consult.assistant.text || '').length >= 80),
      noResultFile: !(consult.assistant && consult.assistant.result && consult.assistant.result.path),
      noPermissionRequest: !report.tasks['01-consultation'].events.some((event) => event.stage === 'waiting_permission') &&
        !report.tasks['01-consultation'].permissionDialogVisibleAtEnd,
    };

    const artifact = await sendTalk(
      '02-podcast-artifact',
      '请根据以下材料，现在生成播客制作文件，保存到应用成果区。材料：数字之我不是静态档案，而是在长期互动中不断更新、由本人授权边界保护的协作主体。请用两人对话形式，包含节目标题、角色设定、分段脚本、音效提示和交付说明。',
      0.45,
    );
    const artifactPath = artifact.assistant && artifact.assistant.result && artifact.assistant.result.path;
    const artifactContent = artifactPath && fs.existsSync(artifactPath) ? fs.readFileSync(artifactPath, 'utf8') : '';
    const resultCard = page.locator('.talk-result-card').last();
    const cardVisible = await resultCard.isVisible().catch(() => false);
    let openClick = { attempted: false, cardVisible, result: 'UI button has no success return channel' };
    if (cardVisible) {
      await resultCard.locator('.talk-result-open').click();
      openClick.attempted = true;
      await page.waitForTimeout(500);
    }
    report.tasks['02-podcast-artifact'].readback = {
      path: artifactPath || '',
      exists: Boolean(artifactPath && fs.existsSync(artifactPath)),
      bytes: artifactContent ? Buffer.byteLength(artifactContent) : 0,
      content: redact(artifactContent),
    };
    report.tasks['02-podcast-artifact'].open = openClick;
    report.tasks['02-podcast-artifact'].checks = {
      noExternalPermissionNeeded: !report.tasks['02-podcast-artifact'].events.some((event) => event.stage === 'waiting_permission'),
      wroteAndReadBack: Boolean(artifactContent && artifactPath && artifactContent.length >= 200),
      resultPathMatches: Boolean(artifactPath && artifact.assistant.result.path === artifactPath),
      openActionFromVisibleCard: openClick.attempted,
      responseDescribesArtifact: Boolean(artifact.assistant && /成果|文件|播客|已/.test(artifact.assistant.text)),
    };
    await screenshot('02-podcast-artifact-opened');
    } else {
      report.tasks['01-consultation'] = {
        skipped: true,
        reason: 'Already passed in supplemental attempt 2; not repeated.',
        evidence: 'supplemental-ui-validation-attempt-2.json',
      };
      report.tasks['02-podcast-artifact'] = {
        skipped: true,
        reason: 'Already passed in supplemental attempt 2; not repeated.',
        evidence: 'supplemental-ui-validation-attempt-2.json',
      };
    }

    const documentsRoot = path.resolve(os.homedir(), 'Documents');
    const deniedDir = path.resolve(documentsRoot, 'DigitalMe-Validation-Deny-' + path.basename(userData));
    if (!deniedDir.startsWith(documentsRoot + path.sep)) throw new Error('unsafe denied validation directory');
    fs.mkdirSync(deniedDir, { recursive: true });
    const deniedFile = path.join(deniedDir, 'permission-denied.md');
    const denyTicket = await admit('03-permission-denied', 0.30);
    const denyLifecycle = await beginTalk(
      page,
      '请现在把一段公开测试说明保存到外部文档目录：' + deniedDir +
        '。文件名 permission-denied.md。如果缺少访问权限，请立即向我申请这个目录的访问权限，不要改存应用成果区。',
    );
    let permissionShown = false;
    const permissionDeadline = Date.now() + 300_000;
    while (Date.now() < permissionDeadline) {
      if (await page.locator('#folder-access-dialog').isVisible().catch(() => false)) {
        permissionShown = true;
        break;
      }
      const state = await talkState(page);
      if (!state.sendDisabled && !state.processingVisible &&
          state.assistantCount > denyLifecycle.beforeAssistantCount) break;
      await page.waitForTimeout(100);
    }
    let waitingState = null;
    if (permissionShown) {
      waitingState = {
        dialog: redact(await page.locator('#folder-access-dialog').innerText()),
        talk: await talkState(page),
      };
      await screenshot('03-permission-waiting');
      await page.locator('#btn-folder-deny').click();
    }
    const denied = await finishTalk(denyTicket, denyLifecycle, '03-permission-denied');
    report.tasks['03-permission-denied'].waitingState = waitingState;
    report.tasks['03-permission-denied'].checks = {
      authorizationWasRequested: permissionShown,
      requestWasRunningWhileWaiting: Boolean(
        waitingState && waitingState.talk.sendDisabled && waitingState.talk.processingVisible,
      ),
      fileAbsentAfterDeny: !fs.existsSync(deniedFile),
      noResultPath: !(denied.assistant && denied.assistant.result && denied.assistant.result.path),
      responseDoesNotClaimSuccess: Boolean(denied.assistant && !/已经完成|已写入/.test(denied.assistant.text)),
    };

    const comparison = await sendTalk(
      '04-existing-source-comparison',
      '这是上一轮已有的两篇数字货币结果，请读取原文后比较观点差异，并把每个关键判断绑定到对应来源；读取失败或只看到摘要必须明说。第一篇：https://www.tradingkey.com/analysis/cryptocurrencies/btc/262050150-crypto-bitcoin-btc-etf-ath-price-iran-us-tradingkey 第二篇：https://www.coinbase.com/institutional/research-insights/research/market-intelligence/2026-crypto-market-outlook',
      0.40,
    );
    const comparisonText = String((comparison.assistant && comparison.assistant.text) || '');
    const comparisonTraces = comparison.result.budget.traces;
    report.tasks['04-existing-source-comparison'].checks = {
      usedWebExtractor: comparisonTraces.some((trace) => trace.webExtractorCalls > 0),
      namesBothSources: /TradingKey/i.test(comparisonText) && /Coinbase/i.test(comparisonText),
      sourceBoundComparison: /https?:\/\//.test(comparisonText) && /差异|相比|而/.test(comparisonText),
      noPodcastContextLeak: !/角色设定|音效提示|播客制作/.test(comparisonText),
      sourceEvidence: comparisonTraces.flatMap((trace) => trace.sources || []),
    };

    const blockchainTicket = await admit('05-blockchain-quality', 0.30);
    await page.locator('#nav-discover').click();
    await page.locator('#panel-discover').waitFor({ state: 'visible', timeout: 20_000 });
    const beforeDiagnostics = readNdjson(path.join(subjectDir, 'content', 'discovery-diagnostics.ndjson')).length;
    await page.locator('#content-discover-query').fill('找一些关于区块链的最新报道和深度分析文章。');
    await page.locator('#btn-content-discover-search').click();
    await page.locator('#content-discover[data-replenishing="1"]').waitFor({ state: 'attached', timeout: 10_000 });
    await page.locator('#content-discover[data-replenishing="0"]').waitFor({ state: 'attached', timeout: 300_000 });
    await page.locator('#btn-discover-cancel').waitFor({ state: 'hidden', timeout: 300_000 });
    await page.waitForTimeout(500);
    const cards = await page.locator('#content-discover-list .content-discover-card').evaluateAll((nodes) => nodes.map((node) => ({
      title: (node.querySelector('h3') || {}).textContent || '',
      url: node.getAttribute('data-url') || '',
      textOrigin: node.getAttribute('data-text-origin') || '',
      source: Array.from(node.querySelectorAll('.content-discover-source')).map((item) => item.textContent || ''),
      excerpt: (node.querySelector('.content-discover-excerpt') || {}).textContent || '',
    })));
    const diagnostics = readNdjson(path.join(subjectDir, 'content', 'discovery-diagnostics.ndjson'));
    const diagnostic = diagnostics[diagnostics.length - 1] || null;
    const blockchainEvents = await eventsSince(blockchainTicket.eventStart);
    const blockchainBudget = await settle(
      blockchainTicket,
      diagnostics.length > beforeDiagnostics ? 'completed' : 'failed',
      blockchainEvents,
      diagnostics.length <= beforeDiagnostics,
    );
    const traces = [];
    collectTraces(diagnostic, new Map());
    const evidenceMap = new Map();
    collectTraces(diagnostic, evidenceMap);
    for (const trace of evidenceMap.values()) traces.push(...(trace.sources || []));
    const cardChecks = cards.map((card) => {
      const evidence = traces.find((source) => source.url === card.url);
      const expectedOrigin = evidence && evidence.readStatus === 'read' ? 'body' : 'snippet';
      return {
        title: card.title,
        url: card.url,
        specificArticleUrl: articlePathIsSpecific(card.url),
        homepageRejected: articlePathIsSpecific(card.url),
        evidenceReadStatus: evidence ? evidence.readStatus : 'missing',
        uiTextOrigin: card.textOrigin,
        readStateMatchesEvidence: Boolean(evidence && card.textOrigin === expectedOrigin),
      };
    });
    report.tasks['05-blockchain-quality'] = {
      elapsedMs: Date.now() - blockchainTicket.startedAt,
      cards,
      cardChecks,
      diagnostic,
      events: blockchainEvents,
      budget: blockchainBudget,
      checks: {
        hasResults: cards.length > 0,
        allTitlesHaveSpecificArticleUrls: cards.length > 0 && cardChecks.every((row) => row.specificArticleUrl),
        noHomepageMasqueradesAsArticle: cards.length > 0 && cardChecks.every((row) => row.homepageRejected),
        allReadStatesMatchActualEvidence: cards.length > 0 && cardChecks.every((row) => row.readStateMatchesEvidence),
      },
    };
    await screenshot('05-blockchain-quality');

    const cancelTicket = await admit('06-runtime-cancel', 0.30);
    await page.locator('#nav-chat').click();
    const artifactFilesBefore = listFiles(path.join(subjectDir, 'artifacts'));
    const cancelLifecycle = await beginTalk(
      page,
      '请搜索今天关于海洋碳汇的最新进展，读取来源后写一份摘要到应用成果区。',
    );
    {
      const deadline = Date.now() + 20_000;
      let started = false;
      while (Date.now() < deadline) {
        const events = await eventsSince(cancelTicket.eventStart);
        if (events.some((event) => event.stage === 'request_started')) {
          started = true;
          break;
        }
        await page.waitForTimeout(50);
      }
      if (!started) throw new Error('cancel case never emitted request_started');
    }
    await screenshot('06-cancel-running');
    await page.locator('#btn-chat-cancel').click();
    const cancelled = await waitForPersistedCancellation(page, cancelLifecycle, 30_000);
    const cancelEvents = await eventsSince(cancelTicket.eventStart);
    const cancelBudget = await settle(cancelTicket, 'cancelled', cancelEvents, true);
    const terminalTurns = (((cancelled.view || {}).view || {}).turns || []);
    await page.waitForTimeout(2_000);
    const lateView = await page.evaluate(() => window.digitalMe.invoke('talk', {}));
    const lateTurns = (((lateView || {}).view || {}).turns || []);
    const artifactFilesAfter = listFiles(path.join(subjectDir, 'artifacts'));
    report.tasks['06-runtime-cancel'] = {
      elapsedMs: cancelled.elapsedMs,
      events: cancelEvents,
      budget: cancelBudget,
      terminal: terminalTurns[terminalTurns.length - 1] || null,
      checks: {
        requestActuallyStarted: cancelEvents.some((event) => event.stage === 'request_started'),
        providerCancellationObserved: cancelEvents.some((event) => event.stage === 'cancelled'),
        persistedCancelledTerminal: /取消/.test(String((terminalTurns[terminalTurns.length - 1] || {}).text || '')),
        noLateTurn: lateTurns.length === terminalTurns.length,
        noLateCompletion: !/已经完成|已写入/.test(String((lateTurns[lateTurns.length - 1] || {}).text || '')),
        noArtifactAfterCancel: JSON.stringify(artifactFilesAfter) === JSON.stringify(artifactFilesBefore),
      },
    };
    await screenshot('06-runtime-cancelled');
  } catch (error) {
    const message = redact(error && error.stack ? error.stack : error);
    if (message.includes('VALIDATION_BUDGET_REACHED')) stoppedForBudget = true;
    report.failures.push(message);
  } finally {
    report.stoppedForBudget = stoppedForBudget;
    report.budget.supplementalAdmissionCny =
      report.budget.supplementalKnownCny + report.budget.supplementalUnknownReserveCny;
    report.budget.totalAdmissionIncludingPriorCny =
      PRIOR_ADMISSION_CNY + report.budget.supplementalAdmissionCny;
    report.completedAt = new Date().toISOString();
    if (subjectDir) {
      report.talkDiagnostics = readNdjson(path.join(subjectDir, 'content', 'talk-diagnostics.ndjson'));
      report.discoveryDiagnostics = readNdjson(path.join(subjectDir, 'content', 'discovery-diagnostics.ndjson'));
    }
    fs.writeFileSync(RESULT_FILE, JSON.stringify(report, null, 2) + '\n', 'utf8');
    if (harness) await harness.close().catch(() => undefined);
    const documentsRoot = path.resolve(os.homedir(), 'Documents');
    const deniedDir = path.resolve(documentsRoot, 'DigitalMe-Validation-Deny-' + path.basename(userData));
    if (deniedDir.startsWith(documentsRoot + path.sep)) fs.rmSync(deniedDir, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
    console.log(JSON.stringify({
      ok: report.failures.length === 0,
      stoppedForBudget,
      tasks: Object.keys(report.tasks),
      supplementalKnownCny: report.budget.supplementalKnownCny,
      supplementalUnknownReserveCny: report.budget.supplementalUnknownReserveCny,
      resultFile: RESULT_FILE,
    }));
  }
}

main().catch((error) => {
  console.error(redact(error && error.stack ? error.stack : error));
  process.exitCode = 1;
});
