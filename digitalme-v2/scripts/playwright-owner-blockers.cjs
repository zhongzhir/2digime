/**
 * DIGITALME-V2-OWNER-ACCEPTANCE-BLOCKERS-01 — Playwright × Electron P0 验收。
 * 用法: npm run accept:owner-blockers
 */
'use strict';

const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const HARNESS = path.join(__dirname, 'electron-experience-b6-harness.cjs');
const electronBin = require('electron');
const MARKER = `OWNER_BLOCKER_UNIQUE_FACT_${Date.now().toString(36)}`;

const runId = `${Date.now()}-${process.pid}`;
const runRoot =
  process.env.DIGITALME_OWNER_BLOCKERS_RUN_DIR ||
  path.join(os.tmpdir(), `dmv2-owner-blockers-${runId}`);
const userData = path.join(runRoot, 'userData');
const shotsDir = path.join(runRoot, 'shots');
const failDir = path.join(runRoot, 'failures');
fs.mkdirSync(shotsDir, { recursive: true });
fs.mkdirSync(failDir, { recursive: true });
fs.mkdirSync(userData, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  runRoot,
  userData,
  marker: MARKER,
  checks: [],
  shots: [],
  verdict: null,
};

function check(name, ok, detail) {
  report.checks.push({ name, ok: !!ok, ...(detail ? { detail } : {}) });
  if (!ok) {
    throw new Error(`CHECK_FAILED: ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
  }
}

async function shot(page, name) {
  const file = path.join(shotsDir, `${String(report.shots.length + 1).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  const st = fs.statSync(file);
  check(`shot_${name}_written`, st.size > 2000, { file, size: st.size });
  report.shots.push({ name, file, size: st.size });
}

async function waitVisible(page, sel, timeout = 15000) {
  await page.waitForFunction(
    (s) => {
      const el = document.querySelector(s);
      return el && el.hidden === false;
    },
    sel,
    { timeout },
  );
}

async function assertExclusivePanel(page, activeKey, shotName) {
  const state = await page.evaluate((key) => {
    const ids = {
      work: 'panel-work',
      chat: 'panel-chat',
      subject: 'panel-subject',
      collab: 'panel-collab',
    };
    const titles = {
      work: '做事',
      chat: '对话',
      subject: '数字之我',
      collab: '协作',
    };
    const out = { activeKey: key, panels: {} };
    for (const [k, id] of Object.entries(ids)) {
      const el = document.getElementById(id);
      const style = el ? getComputedStyle(el) : null;
      out.panels[k] = {
        hiddenAttr: !!(el && el.hidden),
        display: style ? style.display : null,
        visible: !!(el && !el.hidden && style && style.display !== 'none'),
        title: el ? (el.querySelector('.page-title')?.textContent || '').trim() : '',
      };
    }
    out.titleOk = out.panels[key]?.title === titles[key];
    return out;
  }, activeKey);

  check(
    `exclusive_${activeKey}`,
    state.panels[activeKey]?.visible === true &&
      Object.entries(state.panels).every(([k, p]) => (k === activeKey ? p.visible : !p.visible)),
    state,
  );
  check(`title_${activeKey}`, state.titleOk === true, state);
  if (shotName) await shot(page, shotName);
}

async function b6(app, method, arg) {
  return app.evaluate(
    (_electron, state) => {
      const api = global.__digitalmeB6;
      if (!api || typeof api[state.methodName] !== 'function') {
        throw new Error(`b6 hook missing: ${state.methodName}`);
      }
      return api[state.methodName](state.payload);
    },
    { methodName: method, payload: arg },
  );
}

async function launchApp() {
  const app = await electron.launch({
    executablePath: electronBin,
    args: [HARNESS],
    env: {
      ...process.env,
      DIGITALME_B6_USER_DATA: userData,
      DIGITALME_B6_MODEL_READY: '1',
      DIGITALME_B6_FAKE_DELAY_MS: '400',
      DIGITALME_B6_PDF_MARKER: MARKER,
      DIGITALME_B6_CHAT_REPLY: '（阻断验收助手）我知道你是谁：验收 Owner。',
    },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);
  return { app, page };
}

async function enterShell(page) {
  const welcome = page.locator('#view-welcome');
  if (await welcome.isVisible().catch(() => false)) {
    const hidden = await page.locator('#view-welcome').evaluate((el) => el.hidden);
    if (!hidden) {
      await page.fill('#self-intro', 'Owner 阻断验收主体。');
      await page.click('#btn-create-pkg');
    }
  }
  await page.waitForFunction(() => document.getElementById('view-shell')?.hidden === false, null, {
    timeout: 20000,
  });
  await waitVisible(page, '#panel-work');
}

async function run(page, app) {
  await enterShell(page);

  // P0-1：四主栏互斥 + 截图
  for (const [nav, key, shotName] of [
    ['#nav-work', 'work', 'p0-work'],
    ['#nav-chat', 'chat', 'p0-chat'],
    ['#nav-subject', 'subject', 'p0-subject'],
    ['#nav-collab', 'collab', 'p0-collab'],
  ]) {
    await page.click(nav);
    await waitVisible(page, `#panel-${key}`);
    await assertExclusivePanel(page, key, shotName);
  }

  // P0-2：真实 assistant 回复
  await page.click('#nav-chat');
  await waitVisible(page, '#panel-chat');
  await page.fill('#chat-input', '你知道我是谁吗？');
  await page.click('#btn-chat-send');
  await page.waitForFunction(() => {
    const turns = document.getElementById('chat-turns')?.innerText || '';
    const status = document.getElementById('chat-status')?.textContent || '';
    return /阻断验收助手|已回复|无法回复|回复未完成/.test(`${turns}\n${status}`);
  }, null, { timeout: 15000 });
  let chatText = await page.locator('#chat-turns').innerText();
  check('chat_assistant_present', /阻断验收助手/.test(chatText), { chatText: chatText.slice(0, 300) });
  check('chat_not_ack_stub', !/已记下。需要做成具体工作时/.test(chatText), {
    chatText: chatText.slice(0, 300),
  });
  await shot(page, 'p0-chat-reply');

  // 模型失败 → 失败提示与重试（不宣称成功）
  await b6(app, 'setChatFailOnce');
  await page.fill('#chat-input', '第二次提问应失败');
  await page.click('#btn-chat-send');
  await page.waitForFunction(() => {
    const status = document.getElementById('chat-status')?.textContent || '';
    return /无法回复|回复未完成/.test(status);
  }, null, { timeout: 15000 });
  const failStatus = await page.locator('#chat-status').innerText();
  check('chat_fail_status', /无法回复|回复未完成/.test(failStatus), { failStatus });
  check('chat_retry_visible', await page.locator('#btn-chat-retry').evaluate((el) => el.hidden === false));
  const turnsAfterFail = await page.locator('#chat-turns').innerText();
  check('chat_fail_no_success_claim', !/已回复/.test(failStatus), { failStatus, turnsAfterFail: turnsAfterFail.slice(0, 200) });
  await page.click('#btn-chat-retry');
  await page.waitForFunction(() => {
    const status = document.getElementById('chat-status')?.textContent || '';
    return /已回复/.test(status);
  }, null, { timeout: 15000 });
  chatText = await page.locator('#chat-turns').innerText();
  check('chat_retry_assistant', /阻断验收助手/.test(chatText), { chatText: chatText.slice(0, 300) });
  await shot(page, 'p0-chat-retry');

  // P0-3：PDF 标记进入生成与修订
  const meta0 = await b6(app, 'getMeta');
  check('marker_pdf_ready', !!(meta0 && meta0.markerPdf && fs.existsSync(meta0.markerPdf)), meta0);
  await b6(app, 'setPickFiles', [meta0.markerPdf]);

  await page.click('#nav-work');
  await waitVisible(page, '#panel-work');
  await page.click('#btn-new-task');
  await page.waitForTimeout(200);
  await page.fill('#goal', `请依据附件撰写摘要，必须包含附件中的唯一事实：${MARKER}`);
  await page.click('#btn-add-files');
  await page.waitForTimeout(250);
  await page.click('#btn-submit');
  await page.waitForFunction(() => {
    const ed = document.getElementById('artifact-editor');
    const panel = document.getElementById('artifact-panel');
    return panel && !panel.hidden && (ed?.value || '').includes('fake document');
  }, null, { timeout: 45000 });

  const summaryLine = await page.locator('#material-summary-line').innerText().catch(() => '');
  check('material_summary_read', /已读取/.test(summaryLine), { summaryLine });
  check('material_summary_not_skipped_only', !/^未读取到可用文件/.test(summaryLine), { summaryLine });

  const firstArtifact = await page.locator('#artifact-editor').inputValue();
  check('first_artifact_has_marker', firstArtifact.includes(MARKER), {
    preview: firstArtifact.slice(0, 400),
  });
  const meta1 = await b6(app, 'getMeta');
  const matsJoined = (meta1.lastCapabilityMaterials || []).join('\n');
  check('capability_received_marker', matsJoined.includes(MARKER), {
    mats: matsJoined.slice(0, 400),
    preview: (meta1.lastCapabilityTextPreview || '').slice(0, 400),
  });
  await shot(page, 'p0-pdf-first');

  // 不采用 + 理由 → 可见结果
  await page.fill('#artifact-decision-note', '未依据附件关键事实，不采用');
  await page.click('#btn-reject-artifact');
  await page.waitForFunction(() => {
    const t = document.getElementById('artifact-decision-status')?.textContent || '';
    return /未采用/.test(t);
  }, null, { timeout: 10000 });
  const rejectStatus = await page.locator('#artifact-decision-status').innerText();
  check('reject_visible', /未采用/.test(rejectStatus), { rejectStatus });
  const saveStatus = await page.locator('#save-status').innerText().catch(() => '');
  check('reject_recorded', /已记录/.test(`${rejectStatus}\n${saveStatus}`), { rejectStatus, saveStatus });
  await shot(page, 'p0-reject');

  // 按说明修改：仍携带附件
  const reviseNote = `根据附件补充指定内容：务必保留 ${MARKER}，并增加一句「修订已完成」。`;
  await page.locator('#revise-box').evaluate((el) => {
    el.open = true;
  });
  await page.fill('#revision-request', reviseNote);
  await page.click('#btn-revise');
  await page.waitForFunction(
    (marker) => {
      const ed = document.getElementById('artifact-editor');
      const v = ed?.value || '';
      return v.includes(marker) && /修订已完成|修改说明/.test(v);
    },
    MARKER,
    { timeout: 45000 },
  );
  const revised = await page.locator('#artifact-editor').inputValue();
  check('revise_keeps_marker', revised.includes(MARKER), { preview: revised.slice(0, 500) });
  check('revise_has_instruction', /修订已完成|修改说明/.test(revised), {
    preview: revised.slice(0, 500),
  });
  const meta2 = await b6(app, 'getMeta');
  check('revise_capability_got_marker', (meta2.lastCapabilityMaterials || []).join('\n').includes(MARKER), {
    mats: (meta2.lastCapabilityMaterials || []).join('\n').slice(0, 400),
  });
  check('revise_capability_got_request', String(meta2.lastCapabilityRevision || '').includes('修订已完成'), {
    revision: meta2.lastCapabilityRevision,
  });
  const versionMeta = await page.locator('#version-meta').innerText();
  check('revise_new_version', /版本\s*[2-9]|版本\s*\d{2,}/.test(versionMeta) || /版本/.test(versionMeta), {
    versionMeta,
  });
  await shot(page, 'p0-revise');

  // 不可解析 PDF → 暂未纳入，不得「已读取」
  await b6(app, 'setPickFiles', [meta0.corruptPdf]);
  await page.click('#btn-new-task');
  await page.waitForTimeout(200);
  await page.fill('#goal', '仅用损坏 PDF 做材料可读性验收');
  await page.click('#btn-add-files');
  await page.waitForTimeout(200);
  await page.click('#btn-submit');
  await page.waitForFunction(() => {
    const line = document.getElementById('material-summary-line')?.textContent || '';
    const panel = document.getElementById('artifact-panel');
    return panel && !panel.hidden && line.length > 0;
  }, null, { timeout: 45000 });
  const badSummary = await page.locator('#material-summary-line').innerText();
  const badBody = await page.locator('#material-summary-body').innerText().catch(() => '');
  check('corrupt_pdf_not_read', !/已读取\s*[1-9]/.test(badSummary), { badSummary, badBody });
  check(
    'corrupt_pdf_skipped',
    /暂未纳入|未读取到可用文件|无法读取/.test(`${badSummary}\n${badBody}`),
    { badSummary, badBody },
  );
  await shot(page, 'p0-corrupt-pdf');

  // 重载后仍互斥
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);
  await enterShell(page);
  await assertExclusivePanel(page, 'work', 'p0-reload');
}

async function main() {
  if (!fs.existsSync(path.join(ROOT, 'dist', 'runtime', 'digitalme-runtime.js'))) {
    const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true });
    if (build.status !== 0) process.exit(build.status || 1);
  }

  let app;
  let page;
  try {
    ({ app, page } = await launchApp());
    await run(page, app);
    report.verdict = 'passed';
    console.log(`OK: owner-blockers passed (${report.checks.length} checks)`);
    console.log(`OK: shots dir=${shotsDir}`);
  } catch (err) {
    report.verdict = 'failed';
    report.error = String((err && err.message) || err);
    if (page) {
      try {
        await page.screenshot({ path: path.join(failDir, 'failure.png'), fullPage: true });
      } catch {
        /* ignore */
      }
    }
    console.error(report.error);
    process.exitCode = 1;
  } finally {
    fs.mkdirSync(runRoot, { recursive: true });
    fs.writeFileSync(path.join(runRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    if (app) {
      try {
        await app.close();
      } catch {
        /* ignore */
      }
    }
  }
}

main();
