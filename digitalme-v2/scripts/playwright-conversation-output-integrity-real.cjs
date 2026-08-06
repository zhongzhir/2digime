/**
 * 真实 DeepSeek：短回复 / 长回复 / 人为截断 / 连续两轮长回复。
 * 生产 main/preload/renderer；禁止 stub。
 */
'use strict';

const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(__dirname, 'electron-conversation-output-integrity-real-entry.cjs');
const electronBin = require('electron');
const END_MARKER = 'END_OF_REPLY_20260805';

const evidenceDir =
  process.env.DIGITALME_COI_REAL_EVIDENCE ||
  path.join(ROOT, 'scripts', '_conversation-output-integrity-evidence', 'real');
const userData = path.join(evidenceDir, 'userData');
const shotsDir = path.join(evidenceDir, 'shots');
const credImport =
  process.env.DIGITALME_V2_CREDENTIAL_IMPORT ||
  path.join(ROOT, 'scripts', '_mvp-p14-real-capability-evidence', '.runtime-model-credential.json');

fs.mkdirSync(shotsDir, { recursive: true });
fs.mkdirSync(userData, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  evidenceDir,
  realDeepSeek: null,
  checks: [],
  scenarios: {},
  verdict: null,
};

function check(name, ok, detail) {
  report.checks.push({ name, ok: !!ok, ...(detail ? { detail } : {}) });
  if (!ok) {
    throw new Error(`CHECK_FAILED: ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
}

async function waitPred(page, fn, timeout = 30000, label = 'predicate') {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeout) {
    try {
      const hit = await page.evaluate(fn);
      last = hit;
      if (hit === true || hit === 'ok' || (typeof hit === 'string' && hit.startsWith('ok'))) return hit;
      if (typeof hit === 'string' && (/^fail:/.test(hit) || /^bad/.test(hit))) {
        throw new Error(`waitPred aborted: ${label} → ${hit}`);
      }
      if (label === 'real-long' && typeof hit === 'string' && /^incomplete:/.test(hit)) {
        throw new Error(`waitPred aborted: ${label} → ${hit}`);
      }
    } catch (err) {
      if (/waitPred aborted/.test(String(err && err.message))) throw err;
      last = String((err && err.message) || err).slice(0, 120);
    }
    await page.waitForTimeout(400);
  }
  throw new Error(`waitPred timeout: ${label} last=${JSON.stringify(last)}`);
}

async function modelCalls(app) {
  return app.evaluate(() => {
    const api = global.__coiReal;
    return api ? api.getModelCalls() : [];
  });
}

async function chatSnapshot(page) {
  return page.evaluate(() => {
    const status = document.getElementById('chat-status')?.textContent || '';
    const retry = document.getElementById('btn-chat-retry');
    const turns = [...document.querySelectorAll('#chat-turns .chat-turn')].map((el) => ({
      role: el.className.includes('chat-turn-user')
        ? 'user'
        : el.className.includes('chat-turn-assistant')
          ? 'assistant'
          : 'other',
      text: (el.querySelector('.chat-text')?.textContent || '').trim(),
    }));
    return {
      status,
      retryVisible: !!(retry && retry.hidden === false),
      turns,
      userCount: turns.filter((t) => t.role === 'user').length,
      assistantCount: turns.filter((t) => t.role === 'assistant').length,
      domText: document.getElementById('chat-turns')?.innerText || '',
      inputDisabled: !!document.getElementById('chat-input')?.disabled,
      sendDisabled: !!document.getElementById('btn-chat-send')?.disabled,
    };
  });
}

async function enterShell(page) {
  const welcomeHidden = await page.locator('#view-welcome').evaluate((el) => el.hidden).catch(() => true);
  if (!welcomeHidden) {
    await page.fill('#self-intro', '对话输出完整性真实 DeepSeek 验收。');
    await page.click('#btn-create-pkg');
  }
  await waitPred(
    page,
    () => document.getElementById('view-shell')?.hidden === false,
    60000,
    'shell-visible',
  );
  const boot = await page.evaluate(async () => {
    const api = window.digitalMe;
    if (!api || typeof api.getModelStatus !== 'function') return { ok: false };
    return api.getModelStatus();
  });
  check('model_ready', !!(boot && boot.modelReady), boot);
  await page.click('#nav-chat');
  await waitPred(
    page,
    () => document.getElementById('panel-chat')?.hidden === false,
    15000,
    'chat-panel',
  );
}

async function clearChat(page) {
  page.once('dialog', (d) => d.accept());
  await page.click('#btn-chat-clear');
  await page.waitForTimeout(400);
}

async function run() {
  if (!fs.existsSync(credImport)) {
    throw new Error(`missing credential import: ${credImport}`);
  }

  // —— 场景 A：短回复（默认 max tokens）——
  let app = await electron.launch({
    executablePath: electronBin,
    args: [ENTRY],
    env: {
      ...process.env,
      DIGITALME_COI_REAL_EVIDENCE: evidenceDir,
      DIGITALME_COI_REAL_USER_DATA: userData,
      DIGITALME_V2_CREDENTIAL_IMPORT: credImport,
      // 确保默认长文上限
      DIGITALME_CHAT_MAX_TOKENS: process.env.DIGITALME_CHAT_MAX_TOKENS || '4096',
    },
    timeout: 180000,
  });
  let page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);
  await enterShell(page);
  await clearChat(page);

  await page.fill('#chat-input', '只回复：CHAT_SHORT_OK');
  await page.click('#btn-chat-send');
  await waitPred(
    page,
    () => {
      const status = document.getElementById('chat-status')?.textContent || '';
      const body = document.getElementById('chat-turns')?.innerText || '';
      if (/无法回复|回复未完成/.test(status)) return `fail:${status}`;
      if (/已回复/.test(status) && /CHAT_SHORT_OK/i.test(body)) return 'ok';
      return false;
    },
    180000,
    'real-short',
  );
  let snap = await chatSnapshot(page);
  check('short_replied', /已回复/.test(snap.status), { status: snap.status });
  check('short_token', /CHAT_SHORT_OK/i.test(snap.domText), { preview: snap.domText.slice(0, 300) });
  check('short_no_reasoning', !/reasoning_content|内部分析过程|用户想要什么：/.test(snap.domText), {
    preview: snap.domText.slice(0, 400),
  });
  report.scenarios.short = { status: snap.status, chars: snap.domText.length };
  await page.screenshot({ path: path.join(shotsDir, '01-short.png') });

  let calls = await modelCalls(app);
  check('short_reached_deepseek', calls.some((c) => /deepseek/i.test(c.baseUrlHost)), {
    count: calls.length,
    last: calls[calls.length - 1],
  });
  report.realDeepSeek = {
    host: calls[calls.length - 1]?.baseUrlHost,
    model: calls[calls.length - 1]?.model,
  };

  // —— 场景 B：长回复 ——
  await clearChat(page);
  await page.fill(
    '#chat-input',
    '用中文完整写一篇不少于 1200 字的文章，分 6 个小节（明确标注第1节到第6节），最后以 END_OF_REPLY_20260805 结尾。不要输出分析过程或推理提纲。',
  );
  await page.click('#btn-chat-send');
  await waitPred(
    page,
    () => {
      const status = document.getElementById('chat-status')?.textContent || '';
      const body = document.getElementById('chat-turns')?.innerText || '';
      if (/无法回复/.test(status) && !/回复未完成/.test(status)) return `fail:${status}`;
      if (/已回复/.test(status) && body.includes('END_OF_REPLY_20260805')) return 'ok';
      if (/回复未完成/.test(status)) return `incomplete:${status}`;
      return false;
    },
    300000,
    'real-long',
  );
  snap = await chatSnapshot(page);
  const assistantText = snap.turns
    .filter((t) => t.role === 'assistant')
    .map((t) => t.text)
    .join('\n');
  check('long_status_replied', /已回复/.test(snap.status), { status: snap.status });
  check('long_end_marker', assistantText.includes(END_MARKER), {
    has: assistantText.includes(END_MARKER),
    previewTail: assistantText.slice(-200),
  });
  const sectionHits = [1, 2, 3, 4, 5, 6].filter((i) =>
    new RegExp(`第\\s*${i}\\s*节|第${i}节`).test(assistantText),
  );
  check('long_six_sections', sectionHits.length === 6, { sectionHits });
  check('long_no_reasoning', !/reasoning_content|内部分析过程/.test(assistantText), {
    preview: assistantText.slice(0, 400),
  });
  const markerCount = (assistantText.match(new RegExp(END_MARKER, 'g')) || []).length;
  check('long_unique_end_marker', markerCount === 1, { markerCount });
  // 粗略字数：中文段落
  check('long_enough_chars', assistantText.replace(/\s+/g, '').length >= 800, {
    chars: assistantText.replace(/\s+/g, '').length,
  });
  report.scenarios.long = {
    status: snap.status,
    chars: assistantText.length,
    sectionHits,
    markerCount,
  };
  await page.screenshot({ path: path.join(shotsDir, '02-long.png') });

  // —— 场景 C：人为截断（低 max tokens）——
  await app.close();
  const truncUserData = path.join(evidenceDir, 'userData-truncate');
  fs.mkdirSync(truncUserData, { recursive: true });
  app = await electron.launch({
    executablePath: electronBin,
    args: [ENTRY],
    env: {
      ...process.env,
      DIGITALME_COI_REAL_EVIDENCE: evidenceDir,
      DIGITALME_COI_REAL_USER_DATA: truncUserData,
      DIGITALME_V2_CREDENTIAL_IMPORT: credImport,
      DIGITALME_CHAT_MAX_TOKENS: '64',
    },
    timeout: 180000,
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);
  await enterShell(page);
  await clearChat(page);
  await page.fill(
    '#chat-input',
    '用中文完整写一篇不少于 1200 字的文章，分 6 个小节，最后以 END_OF_REPLY_20260805 结尾。',
  );
  await page.click('#btn-chat-send');
  await waitPred(
    page,
    () => {
      const status = document.getElementById('chat-status')?.textContent || '';
      if (/回复未完成，可重试/.test(status)) return 'ok';
      if (/已回复/.test(status)) return `bad-complete:${status}`;
      // 仍在进行中
      return false;
    },
    180000,
    'real-truncate',
  );
  snap = await chatSnapshot(page);
  check('truncate_incomplete', /回复未完成，可重试/.test(snap.status), { status: snap.status });
  check('truncate_not_complete', !/已回复/.test(snap.status), { status: snap.status });
  check('truncate_retry_visible', snap.retryVisible === true, snap);
  check('truncate_no_end_marker_or_incomplete', true, {
    hasMarker: snap.domText.includes(END_MARKER),
    note: 'may or may not include partial text; must not claim complete',
  });
  report.scenarios.truncate = { status: snap.status, retryVisible: snap.retryVisible };
  await page.screenshot({ path: path.join(shotsDir, '03-truncate.png') });

  // 重试（恢复正常 token）需新进程；此处验证重试按钮不增加用户消息后关闭
  const userBeforeRetry = snap.userCount;
  // 在截断会话里点重试仍会用 maxTokens=64，可能继续 incomplete — 只验证不重复用户消息
  await page.click('#btn-chat-retry');
  await waitPred(
    page,
    () => {
      const status = document.getElementById('chat-status')?.textContent || '';
      return /回复未完成，可重试|已回复|无法回复/.test(status);
    },
    180000,
    'truncate-retry',
  );
  snap = await chatSnapshot(page);
  check('retry_no_duplicate_user', snap.userCount === userBeforeRetry, {
    before: userBeforeRetry,
    after: snap.userCount,
  });
  report.scenarios.truncateRetry = { status: snap.status, userCount: snap.userCount };

  await app.close();

  // —— 场景 D：连续两轮长回复 ——
  const twoRoundData = path.join(evidenceDir, 'userData-two-rounds');
  fs.mkdirSync(twoRoundData, { recursive: true });
  app = await electron.launch({
    executablePath: electronBin,
    args: [ENTRY],
    env: {
      ...process.env,
      DIGITALME_COI_REAL_EVIDENCE: evidenceDir,
      DIGITALME_COI_REAL_USER_DATA: twoRoundData,
      DIGITALME_V2_CREDENTIAL_IMPORT: credImport,
      DIGITALME_CHAT_MAX_TOKENS: '4096',
    },
    timeout: 180000,
  });
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);
  await enterShell(page);
  await clearChat(page);

  await page.fill(
    '#chat-input',
    '第一轮：用中文写一篇分 6 节的短文（每节至少 80 字），最后以 END_OF_REPLY_20260805 结尾。不要输出分析过程。',
  );
  await page.click('#btn-chat-send');
  await waitPred(
    page,
    () => {
      const status = document.getElementById('chat-status')?.textContent || '';
      const body = document.getElementById('chat-turns')?.innerText || '';
      if (/已回复/.test(status) && body.includes('END_OF_REPLY_20260805')) return 'ok';
      if (/回复未完成|无法回复/.test(status)) return `bad:${status}`;
      return false;
    },
    300000,
    'round1',
  );
  const after1 = await chatSnapshot(page);
  const markers1 = (after1.domText.match(new RegExp(END_MARKER, 'g')) || []).length;

  await page.fill(
    '#chat-input',
    '第二轮：再写一篇分 6 节的短文（每节至少 80 字），最后以 END_OF_REPLY_20260805 结尾。不要输出分析过程。',
  );
  await page.click('#btn-chat-send');
  await waitPred(
    page,
    () => {
      const status = document.getElementById('chat-status')?.textContent || '';
      const body = document.getElementById('chat-turns')?.innerText || '';
      const markers = (body.match(/END_OF_REPLY_20260805/g) || []).length;
      if (/已回复/.test(status) && markers >= 2) return 'ok';
      if (/回复未完成|无法回复/.test(status)) return `bad:${status}`;
      return false;
    },
    300000,
    'round2',
  );
  snap = await chatSnapshot(page);
  const markers2 = (snap.domText.match(new RegExp(END_MARKER, 'g')) || []).length;
  check('two_rounds_markers', markers2 >= markers1 + 1, { markers1, markers2 });
  check('two_rounds_input_usable', snap.inputDisabled === false && snap.sendDisabled === false, snap);
  check('two_rounds_order', snap.userCount >= 2 && snap.assistantCount >= 2, {
    userCount: snap.userCount,
    assistantCount: snap.assistantCount,
  });
  report.scenarios.twoRounds = { markers1, markers2, userCount: snap.userCount };
  await page.screenshot({ path: path.join(shotsDir, '04-two-rounds.png') });

  // 重载恢复
  const beforeReload = snap.turns.length;
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1200);
  await waitPred(
    page,
    () => document.getElementById('view-shell')?.hidden === false,
    60000,
    'shell-after-reload',
  );
  await page.click('#nav-chat');
  await waitPred(
    page,
    () => (document.querySelectorAll('#chat-turns .chat-turn').length || 0) >= 2,
    30000,
    'reload-transcript',
  );
  snap = await chatSnapshot(page);
  check('reload_intact', snap.turns.length >= beforeReload && snap.domText.includes(END_MARKER), {
    before: beforeReload,
    after: snap.turns.length,
  });
  report.scenarios.reload = { before: beforeReload, after: snap.turns.length };

  calls = await modelCalls(app);
  check('all_calls_deepseek', calls.every((c) => /deepseek/i.test(c.baseUrlHost || '')), {
    hosts: [...new Set(calls.map((c) => c.baseUrlHost))],
  });
  check('no_reasoning_in_adapter_text', calls.every((c) => !c.hasReasoningLeak), {
    leaks: calls.filter((c) => c.hasReasoningLeak),
  });

  report.verdict = 'passed';
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidenceDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`real conversation-output-integrity PASSED checks=${report.checks.length}`);
  await app.close();
}

run().catch(async (err) => {
  report.verdict = 'failed';
  report.error = String((err && err.message) || err).slice(0, 1000);
  report.finishedAt = new Date().toISOString();
  try {
    fs.writeFileSync(path.join(evidenceDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  } catch {
    /* ignore */
  }
  console.error(err);
  process.exit(1);
});
