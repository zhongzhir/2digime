/**
 * THIN-28 交互四项视觉探针：真实 electron/main.cjs，不跑 Codex / 不全量。
 */
'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_thin-28-interaction-probe-evidence');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-thin28-ud-'));
fs.mkdirSync(EVIDENCE, { recursive: true });
app.setPath('userData', USER_DATA);
app.commandLine.appendSwitch('disable-gpu');
process.env.DIGITALME_V2_ALLOW_DEV_CREDENTIAL = '1';
delete process.env.DIGITALME_FORCE_FAKE;
delete process.env.DIGITALME_V2_UX_ACCEPTANCE;

function write(name, obj) {
  fs.writeFileSync(path.join(EVIDENCE, name), `${JSON.stringify(obj, null, 2)}\n`);
}

let started = false;
async function run(win) {
  if (started) return;
  started = true;
  try {
    win.setSize(1280, 820);
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 1600));
  await win.webContents.executeJavaScript(`(() => {
    const skip = document.getElementById('btn-create-skip');
    if (skip) skip.click();
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 1200));
  await win.webContents.executeJavaScript(`(() => {
    const nav = document.getElementById('nav-work');
    if (nav) nav.click();
    const neu = document.getElementById('btn-new-task');
    if (neu) neu.click();
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 600));

  const layout = await win.webContents.executeJavaScript(`(() => {
    const layoutEl = document.querySelector('.work-layout');
    const appEl = document.getElementById('app');
    const rect = layoutEl ? layoutEl.getBoundingClientRect() : null;
    const appRect = appEl ? appEl.getBoundingClientRect() : null;
    const vh = window.innerHeight || 0;
    const gapBelow = rect ? Math.max(0, vh - rect.bottom) : -1;
    return {
      vh,
      layoutHeight: rect ? Math.round(rect.height) : 0,
      layoutBottom: rect ? Math.round(rect.bottom) : 0,
      fillRatio: rect && vh ? Number((rect.height / vh).toFixed(3)) : 0,
      gapBelow,
      appHeight: appRect ? Math.round(appRect.height) : 0,
      appOverflow: appEl ? getComputedStyle(appEl).overflow : '',
    };
  })()`);

  const adopt = await win.webContents.executeJavaScript(`(() => {
    window.__nativeConfirm = 0;
    const orig = window.confirm;
    window.confirm = function () {
      window.__nativeConfirm += 1;
      return false;
    };
    const accept = document.getElementById('btn-accept-artifact');
    if (accept) {
      accept.disabled = false;
      accept.click();
    }
    const box = document.getElementById('adopt-confirm');
    const yes = document.getElementById('btn-adopt-confirm');
    const later = document.getElementById('btn-adopt-later');
    const text = document.getElementById('adopt-confirm-text');
    const snap = {
      nativeConfirm: window.__nativeConfirm || 0,
      boxExists: !!box,
      boxHidden: !!(box && box.hidden),
      yesLabel: yes ? String(yes.textContent || '').trim() : '',
      laterLabel: later ? String(later.textContent || '').trim() : '',
      text: text ? String(text.textContent || '') : '',
    };
    if (later) later.click();
    snap.afterLaterHidden = !!(box && box.hidden);
    window.confirm = orig;
    return snap;
  })()`);

  const source = await win.webContents.executeJavaScript(`(() => {
    const status = String((document.getElementById('job-status') || {}).textContent || '');
    const page = String(document.body && document.body.innerText || '');
    return {
      status,
      hasElapsedOnPage: /\\d+\\s*秒|\\d+\\s*分/.test(page),
      hasThinkingCopy: /正在思考|正在处理/.test(page),
    };
  })()`);

  const ok =
    layout.fillRatio >= 0.62 &&
    layout.gapBelow <= 80 &&
    adopt.boxExists &&
    adopt.yesLabel === '确认采用' &&
    adopt.laterLabel === '再看看' &&
    /确认采用「/.test(adopt.text) &&
    /结束当前交付循环/.test(adopt.text) &&
    adopt.nativeConfirm === 0 &&
    adopt.afterLaterHidden &&
    !source.hasElapsedOnPage;

  const report = { ok, layout, adopt, source, headNote: 'thin-28 interaction probe' };
  write('PROBE.json', report);
  setTimeout(() => app.exit(ok ? 0 : 1), 300);
}

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('did-finish-load', () => {
    run(win).catch((err) => {
      write('PROBE.json', { ok: false, error: String(err && err.message ? err.message : err) });
      setTimeout(() => app.exit(1), 300);
    });
  });
});

require(path.join(ROOT, 'electron', 'main.cjs'));
app.removeAllListeners('window-all-closed');
app.on('window-all-closed', () => {});
