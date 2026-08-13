/**
 * THIN-27 界面四项聚焦探针：真实 electron/main.cjs，不代替 Owner 跑 Codex。
 */
'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_thin-27-surface-probe-evidence');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-thin27-ud-'));
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
  const snap = await win.webContents.executeJavaScript(`(() => {
    const goalSend = document.getElementById('btn-goal-send');
    const more = document.getElementById('artifact-exports-more');
    const summary = more && more.querySelector('summary');
    const start = document.getElementById('btn-start-development');
    const status = document.getElementById('job-status');
    const page = String(document.body && document.body.innerText || '');
    return {
      goalSendLabel: goalSend ? String(goalSend.textContent || '').trim() : '',
      goalSendVisible: !!(goalSend && !goalSend.hidden),
      exportLabel: summary ? String(summary.textContent || '').trim() : '',
      exportHidden: !!(more && more.hidden),
      hasSaveCopy: /保存副本/.test(page),
      hasCtoTitle: false,
      startExists: !!start,
    };
  })()`);
  await win.webContents.executeJavaScript(`(() => {
    const start = document.getElementById('btn-start-development');
    if (start) start.click();
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  const afterClick = await win.webContents.executeJavaScript(`(() => {
    const status = String((document.getElementById('job-status') || {}).textContent || '');
    const start = document.getElementById('btn-start-development');
    return {
      status,
      startLabel: start ? String(start.textContent || '').trim() : '',
    };
  })()`);
  const ok =
    snap.goalSendLabel === '发送给 Digital Me' &&
    snap.goalSendVisible &&
    snap.exportLabel === '导出副本' &&
    snap.exportHidden &&
    !snap.hasSaveCopy &&
    /已确认，正在开始|还没有可确认的方案/.test(afterClick.status);
  const report = { ok, snap, afterClick, headNote: 'thin-27 surface probe' };
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
