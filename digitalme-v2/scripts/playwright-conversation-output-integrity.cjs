/**
 * DIGITALME-V2-CONVERSATION-OUTPUT-INTEGRITY-01 — Playwright × Electron 自动化。
 * 覆盖：长回复结束标记、无 analysis 泄漏、完整才「已回复」、截断未完成、重试不重复用户消息、
 * capture 不替代主回复、重载后完整恢复。不得只测固定短回复。
 */
'use strict';

const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const HARNESS = path.join(__dirname, 'electron-conversation-output-integrity-harness.cjs');
const electronBin = require('electron');
const END_MARKER = 'END_OF_REPLY_20260805';
const REASONING_LEAK = '内部分析过程';

const runId = `${Date.now()}-${process.pid}`;
const runRoot =
  process.env.DIGITALME_COI_RUN_DIR || path.join(os.tmpdir(), `dmv2-coi-accept-${runId}`);
const userData = path.join(runRoot, 'userData');
const evidenceDir =
  process.env.DIGITALME_COI_EVIDENCE ||
  path.join(ROOT, 'scripts', '_conversation-output-integrity-evidence');
fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(evidenceDir, { recursive: true });
fs.mkdirSync(path.join(runRoot, 'shots'), { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  runRoot,
  userData,
  checks: [],
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
  while (Date.now() - start < timeout) {
    const hit = await page.evaluate(fn);
    if (hit) return hit;
    await page.waitForTimeout(150);
  }
  throw new Error(`waitPred timeout: ${label}`);
}

async function coiMeta(app) {
  return app.evaluate(() => {
    const api = global.__digitalmeCoi;
    return api ? api.getMeta() : null;
  });
}

async function setReplyMode(app, mode) {
  // Playwright Electron: evaluate(fn, arg) → fn(electron, arg)
  return app.evaluate((_electron, m) => {
    const api = global.__digitalmeCoi;
    if (!api) throw new Error('no __digitalmeCoi');
    return api.setReplyMode(m);
  }, mode);
}

async function enterShell(page) {
  const welcomeHidden = await page.locator('#view-welcome').evaluate((el) => el.hidden).catch(() => true);
  if (!welcomeHidden) {
    // 首启三步：若停在介绍/模型步，先进入「开始使用」再创建
    const startHidden = await page
      .locator('#welcome-step-start')
      .evaluate((el) => el.hidden)
      .catch(() => true);
    if (startHidden) {
      const introVisible = await page
        .locator('#welcome-step-intro')
        .evaluate((el) => !el.hidden)
        .catch(() => false);
      if (introVisible) {
        await page.click('#btn-welcome-skip-model');
      } else {
        await page.click('#btn-welcome-skip-model-2').catch(() => page.click('#btn-welcome-skip-model'));
      }
      await page.waitForTimeout(200);
    }
    await page.fill('#self-intro', '对话输出完整性验收主体。');
    await page.click('#btn-create-pkg');
  }
  await waitPred(
    page,
    () => document.getElementById('view-shell')?.hidden === false,
    30000,
    'shell-visible',
  );
  await page.click('#nav-chat');
  await waitPred(
    page,
    () => {
      const el = document.getElementById('panel-chat');
      return el && el.hidden === false;
    },
    10000,
    'chat-panel',
  );
}

async function sendChat(page, text) {
  await page.fill('#chat-input', text);
  await page.click('#btn-chat-send');
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

async function run() {
  const app = await electron.launch({
    executablePath: electronBin,
    args: [HARNESS],
    env: {
      ...process.env,
      DIGITALME_COI_USER_DATA: userData,
      DIGITALME_COI_CAPTURE_FAIL: '1',
    },
    timeout: 120000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(600);
  await enterShell(page);

  // 1) 短回复
  await setReplyMode(app, 'auto');
  await sendChat(page, '只回复：CHAT_SHORT_OK');
  await waitPred(
    page,
    () => /已回复/.test(document.getElementById('chat-status')?.textContent || ''),
    15000,
    'short-replied',
  );
  let snap = await chatSnapshot(page);
  check('short_status_replied', /已回复/.test(snap.status), snap);
  check('short_token', /CHAT_SHORT_OK/.test(snap.domText), { preview: snap.domText.slice(0, 200) });
  check('short_no_reasoning', !snap.domText.includes(REASONING_LEAK), { preview: snap.domText.slice(0, 200) });
  const userAfterShort = snap.userCount;

  // 2) 长回复（≥6 节 + 结束标记）
  await sendChat(
    page,
    '用中文完整写一篇不少于 1200 字的文章，分 6 个小节，最后以 END_OF_REPLY_20260805 结尾。',
  );
  await waitPred(
    page,
    () => {
      const status = document.getElementById('chat-status')?.textContent || '';
      const body = document.getElementById('chat-turns')?.innerText || '';
      return /已回复/.test(status) && body.includes('END_OF_REPLY_20260805');
    },
    20000,
    'long-replied',
  );
  snap = await chatSnapshot(page);
  check('long_status_replied', /已回复/.test(snap.status), { status: snap.status });
  check('long_end_marker', snap.domText.includes(END_MARKER), {
    hasMarker: snap.domText.includes(END_MARKER),
  });
  for (let i = 1; i <= 6; i += 1) {
    check(`long_section_${i}`, snap.domText.includes(`第${i}节`), { i });
  }
  check('long_no_reasoning_in_dom', !snap.domText.includes(REASONING_LEAK), {
    preview: snap.domText.slice(0, 300),
  });
  check('long_no_analysis_keyword', !/reasoning_content|analysis process|内部分析过程/i.test(snap.domText), {
    preview: snap.domText.slice(0, 300),
  });
  const userAfterLong = snap.userCount;
  check('long_added_one_user', userAfterLong === userAfterShort + 1, {
    userAfterShort,
    userAfterLong,
  });

  // 3) 截断路径 → 未完成，可重试；不得「已回复」
  await setReplyMode(app, 'incomplete');
  await sendChat(page, '请 FORCE_TRUNCATE 人为截断这条回复');
  await waitPred(
    page,
    () => /回复未完成，可重试/.test(document.getElementById('chat-status')?.textContent || ''),
    15000,
    'incomplete-status',
  );
  snap = await chatSnapshot(page);
  check('truncate_status_incomplete', /回复未完成，可重试/.test(snap.status), snap);
  check('truncate_not_replied', !/已回复/.test(snap.status), snap);
  check('truncate_retry_visible', snap.retryVisible === true, snap);
  const userBeforeRetry = snap.userCount;
  const assistantBeforeRetry = snap.assistantCount;

  // 4) 重试：不重复用户消息
  await setReplyMode(app, 'auto');
  await page.click('#btn-chat-retry');
  await waitPred(
    page,
    () => /已回复/.test(document.getElementById('chat-status')?.textContent || ''),
    15000,
    'retry-replied',
  );
  snap = await chatSnapshot(page);
  check('retry_status_replied', /已回复/.test(snap.status), snap);
  check('retry_no_duplicate_user', snap.userCount === userBeforeRetry, {
    userBeforeRetry,
    userAfter: snap.userCount,
  });
  check('retry_added_assistant', snap.assistantCount === assistantBeforeRetry + 1, {
    assistantBeforeRetry,
    assistantAfter: snap.assistantCount,
  });

  // 5) 网络中断路径
  await setReplyMode(app, 'network');
  await sendChat(page, '这条会网络中断');
  await waitPred(
    page,
    () => /回复未完成，可重试|无法回复，请重试/.test(document.getElementById('chat-status')?.textContent || ''),
    15000,
    'network-incomplete',
  );
  snap = await chatSnapshot(page);
  check('network_not_replied', !/已回复/.test(snap.status), snap);
  check('network_incomplete_or_fail', /回复未完成，可重试|无法回复，请重试/.test(snap.status), snap);
  check('network_retry_visible', snap.retryVisible === true, snap);

  // 6) capture 失败不阻断：再发短回复仍成功
  await setReplyMode(app, 'auto');
  const metaBefore = await coiMeta(app);
  await sendChat(page, '只回复：CHAT_SHORT_OK');
  await waitPred(
    page,
    () => /已回复/.test(document.getElementById('chat-status')?.textContent || ''),
    15000,
    'capture-fail-still-reply',
  );
  const metaAfter = await coiMeta(app);
  check('capture_attempted', (metaAfter?.captureCount || 0) > (metaBefore?.captureCount || 0), {
    before: metaBefore?.captureCount,
    after: metaAfter?.captureCount,
  });
  snap = await chatSnapshot(page);
  check('capture_does_not_replace_reply', /CHAT_SHORT_OK/.test(snap.domText) && /已回复/.test(snap.status), {
    status: snap.status,
  });

  // 7) 连续两轮长回复 + 输入仍可用 + 重载恢复
  await sendChat(
    page,
    '第一轮长回复：写 6 个小节，最后以 END_OF_REPLY_20260805 结尾。',
  );
  await waitPred(
    page,
    () => {
      const status = document.getElementById('chat-status')?.textContent || '';
      return /已回复/.test(status);
    },
    20000,
    'round1-long',
  );
  const afterR1 = await chatSnapshot(page);
  const markerCount1 = (afterR1.domText.match(new RegExp(END_MARKER, 'g')) || []).length;

  await sendChat(
    page,
    '第二轮长回复：再写 6 个小节，最后以 END_OF_REPLY_20260805 结尾。',
  );
  await waitPred(
    page,
    () => {
      const status = document.getElementById('chat-status')?.textContent || '';
      const body = document.getElementById('chat-turns')?.innerText || '';
      const markers = (body.match(/END_OF_REPLY_20260805/g) || []).length;
      return /已回复/.test(status) && markers >= 2;
    },
    20000,
    'round2-long',
  );
  snap = await chatSnapshot(page);
  const markerCount2 = (snap.domText.match(new RegExp(END_MARKER, 'g')) || []).length;
  check('two_rounds_markers', markerCount2 >= markerCount1 + 1, { markerCount1, markerCount2 });
  check('input_still_usable', snap.inputDisabled === false && snap.sendDisabled === false, snap);
  check('prior_round_not_overwritten', markerCount2 >= 2, { markerCount2 });

  // 重载：刷新页面后重新打开主体并核对 transcript
  const turnsBeforeReload = snap.turns.length;
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);
  // 自动打开已存在主体
  await waitPred(
    page,
    () =>
      document.getElementById('view-shell')?.hidden === false ||
      document.getElementById('view-welcome')?.hidden === false,
    20000,
    'after-reload',
  );
  const shellHidden = await page.locator('#view-shell').evaluate((el) => el.hidden).catch(() => true);
  if (shellHidden) {
    // 若未自动进入，走欢迎首启（兼容三步引导）
    const welcomeHidden2 = await page.locator('#view-welcome').evaluate((el) => el.hidden).catch(() => true);
    if (!welcomeHidden2) {
      const startHidden = await page
        .locator('#welcome-step-start')
        .evaluate((el) => el.hidden)
        .catch(() => true);
      if (startHidden) {
        await page.click('#btn-welcome-skip-model').catch(async () => {
          await page.click('#btn-welcome-skip-model-2');
        });
        await page.waitForTimeout(200);
      }
      await page.fill('#self-intro', '重载恢复').catch(() => {});
      await page.click('#btn-create-pkg').catch(async () => {
        await page.click('#btn-create-skip');
      });
    }
  }
  await waitPred(
    page,
    () => document.getElementById('view-shell')?.hidden === false,
    30000,
    'shell-after-reload',
  );
  await page.click('#nav-chat');
  await waitPred(
    page,
    () => (document.querySelectorAll('#chat-turns .chat-turn').length || 0) >= 4,
    15000,
    'transcript-restored',
  );
  snap = await chatSnapshot(page);
  check('reload_turn_count', snap.turns.length >= turnsBeforeReload, {
    before: turnsBeforeReload,
    after: snap.turns.length,
  });
  check('reload_has_end_marker', snap.domText.includes(END_MARKER), {
    preview: snap.domText.slice(0, 200),
  });

  report.verdict = 'passed';
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidenceDir, 'ui-acceptance-report.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(runRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`accept:conversation-output-integrity UI PASSED checks=${report.checks.length}`);
  await app.close();
}

run().catch(async (err) => {
  report.verdict = 'failed';
  report.error = String((err && err.message) || err).slice(0, 800);
  report.finishedAt = new Date().toISOString();
  try {
    fs.writeFileSync(path.join(evidenceDir, 'ui-acceptance-report.json'), `${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(path.join(runRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  } catch {
    /* ignore */
  }
  console.error(err);
  process.exit(1);
});
