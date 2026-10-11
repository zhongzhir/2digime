'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
} = require('../../dist/runtime/tests/electron-harness.js');

const ROOT = path.resolve(__dirname, '..', '..');
const RESULT_FILE = path.join(__dirname, 'final-blockchain-ui-validation-result.json');
const EVIDENCE_DIR = path.join(__dirname, 'evidence', 'closeout');
const KEY_CSV = process.env.DIGITALME_VALIDATION_KEY_CSV ||
  'D:\\Projects\\Digital Me\\trial\\默认业务空间-apiKey-7639591.csv';
const BASE_URL = 'https://ws-ok2fv132ihswnia7.cn-beijing.maas.aliyuncs.com/compatible-mode/v1';
const MODEL = 'qwen3.8-flash';
const TARGET_CNY = 2;
const PRIOR_KNOWN_CNY = 0.0578902;
const PRIOR_UNKNOWN_RESERVE_CNY = 1.55;
const PRIOR_ADMISSION_CNY = PRIOR_KNOWN_CNY + PRIOR_UNKNOWN_RESERVE_CNY;
const REQUEST_RESERVE_CNY = 0.30;

function readKeyValueCsv(file) {
  const rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
  const values = {};
  for (const row of rows) {
    const comma = row.indexOf(',');
    if (comma < 0) continue;
    values[row.slice(0, comma).replace(/^"|"$/g, '').trim()] =
      row.slice(comma + 1).replace(/^"|"$/g, '').trim();
  }
  if (!values.apiKey || values.apiKey.length < 20) throw new Error('credential CSV has no usable apiKey');
  return values.apiKey;
}

function readNdjson(file) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function evidenceKey(value) {
  const parsed = new URL(value);
  parsed.hash = '';
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString();
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const preAdmissionCny = PRIOR_ADMISSION_CNY + REQUEST_RESERVE_CNY;
  const report = {
    task: 'DIGITALME-UNIFIED-CAPABILITY-01 final real blockchain UI validation',
    startedAt: new Date().toISOString(),
    head: childProcess.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    endpoint: BASE_URL,
    model: MODEL,
    credential: { source: 'local CSV, read in runner process', valueRecorded: false },
    budget: {
      targetCny: TARGET_CNY,
      priorKnownCny: PRIOR_KNOWN_CNY,
      priorUnknownReserveCny: PRIOR_UNKNOWN_RESERVE_CNY,
      priorAdmissionCny: PRIOR_ADMISSION_CNY,
      requestReserveCny: REQUEST_RESERVE_CNY,
      preAdmissionCny,
      admitted: preAdmissionCny <= TARGET_CNY,
    },
    cards: [],
    events: [],
    checks: {},
    failures: [],
  };
  if (!report.budget.admitted) {
    report.failures.push('VALIDATION_BUDGET_REACHED_BEFORE_REQUEST');
    report.completedAt = new Date().toISOString();
    fs.writeFileSync(RESULT_FILE, JSON.stringify(report, null, 2) + '\n', 'utf8');
    process.exitCode = 2;
    return;
  }

  const apiKey = readKeyValueCsv(KEY_CSV);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'digitalme-final-blockchain-'));
  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'digitalme-final-blockchain-home-'));
  report.isolatedUserData = userData;
  let harness;
  let requestStarted = false;
  try {
    harness = await launchDigitalMeElectron({
      userData,
      realProduct: true,
      extraEnv: {
        DIGITALME_V2_HOME: isolatedHome,
        DIGITALME_V2_ALLOW_DEV_CREDENTIAL: '0',
      },
    });
    const page = harness.page;
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
      window.__finalBlockchainEvents = [];
      window.digitalMe.onCapabilityProgress((event) => window.__finalBlockchainEvents.push(event));
    });
    const subjectDir = (await page.evaluate(() => window.digitalMe.getDefaultSubjectDir())).dir;
    report.subjectDir = subjectDir;
    await page.locator('#nav-discover').click();
    await page.locator('#panel-discover').waitFor({ state: 'visible', timeout: 20_000 });
    const query = '找一些关于区块链的最新报道和深度分析文章。';
    report.query = query;
    const began = Date.now();
    await page.locator('#content-discover-query').fill(query);
    await page.locator('#btn-content-discover-search').click();
    const startDeadline = Date.now() + 15_000;
    while (Date.now() < startDeadline) {
      const events = await page.evaluate(() => window.__finalBlockchainEvents || []);
      if (events.some((event) => event.surface === 'discover' && event.stage === 'request_started')) {
        requestStarted = true;
        break;
      }
      await page.waitForTimeout(50);
    }
    if (!requestStarted) throw new Error('real validation did not emit request_started');
    await page.locator('#content-discover[data-replenishing="0"]').waitFor({ state: 'attached', timeout: 280_000 });
    await page.locator('#btn-discover-cancel').waitFor({ state: 'hidden', timeout: 280_000 });
    await page.waitForTimeout(800);
    report.elapsedMs = Date.now() - began;
    report.events = await page.evaluate(() => window.__finalBlockchainEvents || []);
    report.cards = await page.locator('#content-discover-list .content-discover-card').evaluateAll((nodes) => nodes.map((node) => ({
      itemId: node.getAttribute('data-item-id') || '',
      title: (node.querySelector('h3') || {}).textContent || '',
      url: node.getAttribute('data-url') || '',
      publishedDay: node.getAttribute('data-published-day') || '',
      textOrigin: node.getAttribute('data-text-origin') || '',
      sourceLines: Array.from(node.querySelectorAll('.content-discover-source')).map((item) => item.textContent || ''),
      excerpt: (node.querySelector('.content-discover-excerpt') || {}).textContent || '',
    })));
    report.notice = await page.locator('#content-discover-notice').innerText().catch(() => '');
    await page.screenshot({ path: path.join(EVIDENCE_DIR, '02-final-real-blockchain.png'), fullPage: true });

    let diagnostics = [];
    const diagnosticFile = path.join(subjectDir, 'content', 'discovery-diagnostics.ndjson');
    for (let i = 0; i < 20; i += 1) {
      diagnostics = readNdjson(diagnosticFile);
      if (diagnostics.some((row) => row.query === query && row.event === 'unified_responses')) break;
      await page.waitForTimeout(100);
    }
    report.diagnostic = diagnostics.filter((row) => row.query === query && row.event === 'unified_responses').at(-1) || null;
    const trace = report.diagnostic && report.diagnostic.trace;
    const actualKnownCny = Number(trace && trace.usage && trace.usage.estimatedCostCny);
    const traceComplete = Number.isFinite(actualKnownCny);
    report.budget.requestKnownCny = traceComplete ? actualKnownCny : 0;
    report.budget.requestUnknownReserveCny = traceComplete ? 0 : REQUEST_RESERVE_CNY;
    report.budget.finalAdmissionCny = PRIOR_ADMISSION_CNY +
      report.budget.requestKnownCny + report.budget.requestUnknownReserveCny;

    const sources = new Map(((trace && trace.sources) || []).map((source) => [evidenceKey(source.url), source]));
    const { isSpecificUnifiedResultUrl } = require(path.join(ROOT, 'dist', 'runtime', 'digitalme-runtime.js'));
    const starts = report.events.filter((event) => event.surface === 'discover' && event.stage === 'request_started').length;
    const terminals = report.events.filter((event) => event.surface === 'discover' &&
      ['completed', 'failed', 'cancelled'].includes(event.stage)).length;
    report.checks = {
      exactlyOneProviderRequestStarted: starts === 1,
      providerRequestReachedTerminal: terminals === 1,
      traceCompleted: Boolean(trace && trace.status === 'completed'),
      toolsActuallyUsed: Boolean(trace && trace.webSearchCalls >= 1 && trace.webExtractorCalls >= 1 && trace.functionCalls >= 1),
      hasUsableResults: report.cards.length >= 3 && report.cards.every((card) =>
        card.title.trim().length >= 8 && card.excerpt.trim().length >= 40 && /^https?:\/\//.test(card.url)),
      noHomepageOrSearchPageMasquerades: report.cards.length > 0 &&
        report.cards.every((card) => isSpecificUnifiedResultUrl(card.url)),
      allSourcesBoundToExactTraceUrl: report.cards.length > 0 &&
        report.cards.every((card) => sources.has(evidenceKey(card.url))),
      allReadStatesMatchTrace: report.cards.length > 0 && report.cards.every((card) => {
        const source = sources.get(evidenceKey(card.url));
        return card.textOrigin === (source && source.readStatus === 'read' ? 'body' : 'snippet');
      }),
      everyDisplayedDateHasReadSourceEvidence: report.cards.every((card) => {
        const source = sources.get(evidenceKey(card.url));
        return !card.publishedDay || Boolean(source && source.readStatus === 'read');
      }),
      withinBudget: report.budget.finalAdmissionCny <= TARGET_CNY,
    };
    report.passed = Object.values(report.checks).every(Boolean);
  } catch (error) {
    report.failures.push(String(error && error.stack || error));
    report.budget.requestKnownCny = 0;
    report.budget.requestUnknownReserveCny = requestStarted ? REQUEST_RESERVE_CNY : 0;
    report.budget.finalAdmissionCny = PRIOR_ADMISSION_CNY + report.budget.requestUnknownReserveCny;
    report.passed = false;
  } finally {
    report.completedAt = new Date().toISOString();
    fs.writeFileSync(RESULT_FILE, JSON.stringify(report, null, 2) + '\n', 'utf8');
    if (harness) await harness.close().catch(() => undefined);
  }
  if (!report.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
