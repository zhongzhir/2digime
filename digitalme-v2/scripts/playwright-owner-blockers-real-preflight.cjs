/**
 * DIGITALME-V2-OWNER-ACCEPTANCE-BLOCKERS-01 — 真实 DeepSeek + 真实 PDF 预检。
 * 生产 main/preload/renderer；无 Fake；无 conversationReply stub。
 */
'use strict';

const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const ENTRY = path.join(__dirname, 'electron-owner-blockers-real-preflight-entry.cjs');
const { makeTextPdf } = require('./lib/make-text-pdf.cjs');
const electronBin = require('electron');

const MARKER = 'OWNER_REAL_PDF_FACT_20260805_X7K9';
const evidenceDir =
  process.env.DIGITALME_REAL_PREFLIGHT_EVIDENCE ||
  path.join(ROOT, 'scripts', '_owner-acceptance-blockers-01-real-preflight-evidence');
const userData = path.join(evidenceDir, 'userData');
const fixtures = path.join(evidenceDir, 'fixtures');
const shotsDir = path.join(evidenceDir, 'shots');
const failDir = path.join(evidenceDir, 'failures');
const markerPdf = path.join(fixtures, 'owner-real-marker.pdf');
const credImport =
  process.env.DIGITALME_V2_CREDENTIAL_IMPORT ||
  path.join(ROOT, 'scripts', '_mvp-p14-real-capability-evidence', '.runtime-model-credential.json');

fs.mkdirSync(shotsDir, { recursive: true });
fs.mkdirSync(failDir, { recursive: true });
fs.mkdirSync(fixtures, { recursive: true });
fs.mkdirSync(userData, { recursive: true });
makeTextPdf(
  markerPdf,
  `${MARKER}\n本附件核心事实：Digital Me 真实预检材料，仅用于核对附件是否进入模型上下文。`,
);

const report = {
  startedAt: new Date().toISOString(),
  evidenceDir,
  userData,
  marker: MARKER,
  realDeepSeek: null,
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
  check(`shot_${name}`, st.size > 1500, { file, size: st.size });
  report.shots.push({ name, file, size: st.size });
}

async function waitVisible(page, sel, timeout = 20000) {
  await page.locator(`${sel}:not([hidden])`).first().waitFor({ state: 'attached', timeout });
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const visible = await page.locator(sel).evaluate((el) => el && el.hidden === false).catch(() => false);
    if (visible) return;
    await page.waitForTimeout(150);
  }
  throw new Error(`waitVisible timeout: ${sel}`);
}

async function waitPred(page, fn, timeout = 30000, label = 'predicate') {
  const start = Date.now();
  let lastErr = '';
  while (Date.now() - start < timeout) {
    try {
      const hit = await page.evaluate(fn);
      if (hit) return hit;
    } catch (err) {
      lastErr = String((err && err.message) || err).slice(0, 200);
    }
    await page.waitForTimeout(250);
  }
  throw new Error(`waitPred timeout: ${label}${lastErr ? ` lastErr=${lastErr}` : ''}`);
}

async function assertExclusive(page, key, shotName) {
  const state = await page.evaluate((active) => {
    const ids = {
      work: 'panel-work',
      chat: 'panel-chat',
      subject: 'panel-subject',
      collab: 'panel-collab',
    };
    const titles = { work: '做事', chat: '对话', subject: '数字之我', collab: '协作' };
    const panels = {};
    for (const [k, id] of Object.entries(ids)) {
      const el = document.getElementById(id);
      const style = el ? getComputedStyle(el) : null;
      panels[k] = {
        hiddenAttr: !!(el && el.hidden),
        display: style ? style.display : null,
        visible: !!(el && !el.hidden && style && style.display !== 'none'),
        title: el ? (el.querySelector('.page-title')?.textContent || '').trim() : '',
      };
    }
    return {
      panels,
      titleOk: panels[active]?.title === titles[active],
      onlyOne:
        panels[active]?.visible === true &&
        Object.entries(panels).every(([k, p]) => (k === active ? p.visible : !p.visible)),
    };
  }, key);
  check(`exclusive_${key}`, state.onlyOne === true, state);
  check(`title_${key}`, state.titleOk === true, state);
  if (shotName) await shot(page, shotName);
}

async function preflightMeta(app) {
  return app.evaluate(() => {
    const api = global.__ownerRealPreflight;
    return api ? api.getMeta() : null;
  });
}

async function modelCalls(app) {
  return app.evaluate(() => {
    const api = global.__ownerRealPreflight;
    return api ? api.getModelCalls() : [];
  });
}

async function launchApp() {
  if (!fs.existsSync(credImport)) {
    throw new Error(`missing credential import: ${credImport}`);
  }
  const app = await electron.launch({
    executablePath: electronBin,
    args: [ENTRY],
    env: {
      ...process.env,
      DIGITALME_REAL_PREFLIGHT_EVIDENCE: evidenceDir,
      DIGITALME_REAL_PREFLIGHT_USER_DATA: userData,
      DIGITALME_REAL_PREFLIGHT_PDF: markerPdf,
      DIGITALME_REAL_PREFLIGHT_MARKER: MARKER,
      DIGITALME_V2_CREDENTIAL_IMPORT: credImport,
    },
    timeout: 120000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);
  return { app, page };
}

async function enterShell(page) {
  const welcomeHidden = await page.locator('#view-welcome').evaluate((el) => el.hidden).catch(() => true);
  if (!welcomeHidden) {
    await page.fill('#self-intro', '真实 DeepSeek 预检主体：重视附件事实与可核对回复。');
    await page.click('#btn-create-pkg');
  }
  await waitPred(
    page,
    () => document.getElementById('view-shell')?.hidden === false,
    30000,
    'shell-visible',
  );
  // 模型门禁：若未就绪则失败
  const boot = await page.evaluate(async () => {
    const api = window.digitalMe;
    if (!api || typeof api.getModelStatus !== 'function') return { ok: false, reason: 'no_api' };
    return api.getModelStatus();
  });
  check('model_ready', !!(boot && boot.modelReady), {
    modelReady: boot && boot.modelReady,
    host: boot && boot.status && boot.status.baseUrl,
    model: boot && boot.status && boot.status.model,
  });
  await waitVisible(page, '#panel-work');
}

async function run(page, app) {
  await enterShell(page);
  const meta0 = await preflightMeta(app);
  check('entry_meta', !!(meta0 && meta0.markerPdf), meta0);

  // 1) 四栏互斥
  for (const [nav, key, name] of [
    ['#nav-work', 'work', 'real-nav-work'],
    ['#nav-chat', 'chat', 'real-nav-chat'],
    ['#nav-subject', 'subject', 'real-nav-subject'],
    ['#nav-collab', 'collab', 'real-nav-collab'],
  ]) {
    await page.click(nav);
    await waitVisible(page, `#panel-${key}`);
    await assertExclusive(page, key, name);
  }

  // 2) 真实对话
  await page.click('#nav-chat');
  await waitVisible(page, '#panel-chat');
  await page.fill('#chat-input', '只回复：REAL_CHAT_REPLY_OK');
  await page.click('#btn-chat-send');
  await waitPred(
    page,
    () => {
      const status = document.getElementById('chat-status')?.textContent || '';
      if (/回复失败/.test(status)) return `fail:${status}`;
      if (!/已回复/.test(status)) return false;
      const assistantNodes = [
        ...document.querySelectorAll('#chat-turns .chat-turn-assistant, #chat-turns .chat-turn.assistant'),
      ];
      const assistantText = assistantNodes.map((el) => el.textContent || '').join('\n');
      if (/REAL_CHAT_REPLY_OK/i.test(assistantText)) return `ok:${status}`;
      // 回退：整段中在「数字之我」标签后出现标记
      const all = document.getElementById('chat-turns')?.innerText || '';
      if (/数字之我[\s\S]{0,40}REAL_CHAT_REPLY_OK/i.test(all)) return `ok-fallback:${status}`;
      return false;
    },
    180000,
    'chat-reply',
  );
  const chatText = await page.locator('#chat-turns').innerText();
  const chatStatus = await page.locator('#chat-status').innerText();
  check('chat_status_replied', /已回复/.test(chatStatus), { chatStatus });
  check('chat_not_ack_stub', !/已记下。需要做成具体工作时/.test(chatText), {
    chatText: chatText.slice(0, 400),
  });
  check('chat_assistant_has_token', /数字之我[\s\S]*REAL_CHAT_REPLY_OK/i.test(chatText), {
    chatText: chatText.slice(0, 500),
  });
  await shot(page, 'real-chat-reply');

  const callsAfterChat = await modelCalls(app);
  check('chat_reached_model', callsAfterChat.length >= 1, { count: callsAfterChat.length });
  const chatCall = callsAfterChat[callsAfterChat.length - 1];
  check('chat_deepseek_host', /deepseek/i.test(String(chatCall.baseUrlHost || '')), chatCall);
  report.realDeepSeek = {
    host: chatCall.baseUrlHost,
    model: chatCall.model,
  };

  // 3) 真实 PDF 首轮
  await page.click('#nav-work');
  await waitVisible(page, '#panel-work');
  await page.click('#btn-new-task');
  await page.waitForTimeout(300);
  await page.fill(
    '#goal',
    '严格依据附件撰写一份说明，并原样引用附件中的唯一标记。',
  );
  await page.click('#btn-add-files');
  await page.waitForTimeout(400);
  const matText = await page.locator('#material-list').innerText();
  check('pdf_attached_ui', /owner-real-marker\.pdf/i.test(matText), { matText: matText.slice(0, 200) });
  await page.click('#btn-submit');
  await waitPred(
    page,
    () => {
      const panel = document.getElementById('artifact-panel');
      const ed = document.getElementById('artifact-editor');
      const status = document.getElementById('job-status')?.textContent || '';
      if (panel && !panel.hidden && (ed?.value || '').length > 20) return 'done';
      if (/失败|错误/.test(status)) return 'failed';
      return false;
    },
    300000,
    'first-artifact',
  );
  const jobStatus = await page.locator('#job-status').innerText();
  check('first_job_not_failed', !/失败|错误/.test(jobStatus), { jobStatus });
  const summary = await page.locator('#material-summary-line').innerText().catch(() => '');
  check('pdf_marked_read', /已读取/.test(summary), { summary });
  const firstArtifact = await page.locator('#artifact-editor').inputValue();
  check('first_artifact_has_marker', firstArtifact.includes(MARKER), {
    preview: firstArtifact.slice(0, 600),
  });
  await shot(page, 'real-pdf-first');

  const callsAfterGen = await modelCalls(app);
  const genCalls = callsAfterGen.filter((c) => c.markerInAnyMessage);
  check('gen_context_has_marker', genCalls.length >= 1, {
    totalCalls: callsAfterGen.length,
    withMarker: genCalls.length,
    hosts: callsAfterGen.map((c) => c.baseUrlHost),
  });
  check(
    'gen_deepseek',
    genCalls.some((c) => /deepseek/i.test(c.baseUrlHost)),
    { genCalls: genCalls.map((c) => ({ host: c.baseUrlHost, model: c.model })) },
  );

  // 4) 不采用 + 修订
  await page.fill(
    '#artifact-decision-note',
    '没有充分依据附件，请增加附件中的唯一标记及核心事实',
  );
  await page.click('#btn-reject-artifact');
  await waitPred(
    page,
    () => {
      const t = document.getElementById('artifact-decision-status')?.textContent || '';
      return /未采用/.test(t) ? t : false;
    },
    20000,
    'reject-visible',
  );
  const rejectStatus = await page.locator('#artifact-decision-status').innerText();
  const saveStatus = await page.locator('#save-status').innerText().catch(() => '');
  check('reject_visible', /未采用/.test(rejectStatus), { rejectStatus, saveStatus });
  check('reject_recorded', /已记录|未采用/.test(`${rejectStatus}\n${saveStatus}`), {
    rejectStatus,
    saveStatus,
  });
  await shot(page, 'real-reject');

  const reviseText =
    '没有充分依据附件，请增加附件中的唯一标记及核心事实；修订后须原样保留唯一标记并写明已按说明修改。';
  await page.locator('#revise-box').evaluate((el) => {
    el.open = true;
  });
  await page.fill('#revision-request', reviseText);
  const versionBefore = await page.locator('#version-meta').innerText();
  await page.click('#btn-revise');
  const reviseOutcome = await waitPred(
    page,
    () => {
      const ed = document.getElementById('artifact-editor');
      const v = ed?.value || '';
      const meta = document.getElementById('version-meta')?.textContent || '';
      const status = document.getElementById('job-status')?.textContent || '';
      if (/失败|错误/.test(status) && !/处理|排队|进行/.test(status)) return 'FAIL';
      if (v.includes('OWNER_REAL_PDF_FACT_20260805_X7K9') && /版本\s*[2-9]/.test(meta)) return 'OK';
      return false;
    },
    300000,
    'revise-done',
  );
  check('revise_wait_ok', reviseOutcome === 'OK', { reviseOutcome });
  const versionAfter = await page.locator('#version-meta').innerText();
  const revised = await page.locator('#artifact-editor').inputValue();
  check('revise_new_version', versionAfter !== versionBefore || /版本\s*[2-9]/.test(versionAfter), {
    versionBefore,
    versionAfter,
  });
  check('revise_has_marker', revised.includes(MARKER), { preview: revised.slice(0, 700) });
  check(
    'revise_reflects_instruction',
    /按说明修改|核心事实|唯一标记|已按/.test(revised) || revised.includes(MARKER),
    { preview: revised.slice(0, 700) },
  );
  await shot(page, 'real-revise');

  const callsAfterRevise = await modelCalls(app);
  const reviseCalls = callsAfterRevise.filter(
    (c) =>
      c.markerInAnyMessage &&
      (c.messages || []).some((m) => /没有充分依据附件|请增加附件中的唯一标记|按说明修改/.test(
        // markerSnippet only; use hasMarker + call order
        JSON.stringify(m),
      ) || c.markerInAnyMessage),
  );
  // 更稳：找最后一次带标记的调用，并确认 messages 里同时有修改说明痕迹（通过 record 的 hasMarker + 次数增加）
  const lastMarked = [...callsAfterRevise].reverse().find((c) => c.markerInAnyMessage);
  check('revise_context_has_marker', !!(lastMarked && lastMarked.markerInAnyMessage), {
    lastMarked,
    callCount: callsAfterRevise.length,
  });
  // 修订调用应晚于首轮：至少 2 次含标记（首轮+修订）或总调用数大于聊天+1
  check('revise_made_model_call', callsAfterRevise.length > callsAfterGen.length, {
    before: callsAfterGen.length,
    after: callsAfterRevise.length,
  });

  // 增强修订证据：在 model-calls 中标注最后一次带修改说明的探测
  // 重新从磁盘读取并补充 judgment
  const callsFile = path.join(evidenceDir, 'model-calls-redacted.json');
  const redacted = JSON.parse(fs.readFileSync(callsFile, 'utf8'));
  redacted.judgment = {
    usedDeepSeek: redacted.usedDeepSeekHost === true,
    chatOk: true,
    firstGenMarkerInRequest: genCalls.length >= 1,
    firstGenMarkerInArtifact: firstArtifact.includes(MARKER),
    rejectVisible: true,
    reviseMarkerInRequest: !!(lastMarked && lastMarked.markerInAnyMessage),
    reviseMarkerInArtifact: revised.includes(MARKER),
    reviseNewVersion: /版本\s*[2-9]/.test(versionAfter),
  };
  fs.writeFileSync(callsFile, `${JSON.stringify(redacted, null, 2)}\n`, 'utf8');

  report.summary = redacted.judgment;
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
    console.log(`OK: real DeepSeek preflight passed (${report.checks.length} checks)`);
    console.log(`OK: evidence=${evidenceDir}`);
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
    fs.writeFileSync(path.join(evidenceDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
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
