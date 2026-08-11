/**
 * D11-E 界面示意截图（visual_mock_only）。
 * 仅加载 fixture.html — 不得当作真实主链运行证据。
 * 真实 Electron smoke：electron-d11e-runtime-smoke.cjs → _d11-e-runtime-evidence-16a/
 */
'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_d11-e-legacy-cleanup-16-evidence');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-d11e-ud-'));
app.setPath('userData', userData);

async function capture(win, name) {
  const img = await win.webContents.capturePage();
  const file = path.join(EVIDENCE, `${name}.png`);
  fs.writeFileSync(file, img.toPNG());
  return file;
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const fixturePath = path.join(EVIDENCE, 'fixture.html');
  await app.whenReady();
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  const scenes = [
    ['plan', 'visual_mock_only-01-plan-confirm'],
    ['auth', 'visual_mock_only-02-execution-auth'],
    ['running', 'visual_mock_only-03-developing'],
    ['revise', 'visual_mock_only-04-auto-revision'],
    ['try', 'visual_mock_only-05-ready-to-try'],
    ['pause', 'visual_mock_only-06-paused-after-failures'],
  ];
  const shots = {};
  for (const [scene, name] of scenes) {
    await win.loadURL(`${pathToFileURL(fixturePath).href}?scene=${scene}`);
    await new Promise((r) => setTimeout(r, 200));
    shots[scene] = path.basename(await capture(win, name));
  }
  const summary = {
    task: '2DIGIME-BUILD-01-D11-E-LEGACY-CLEANUP-OWNER-RUNTIME-PREP-16',
    generatedAt: new Date().toISOString(),
    kind: 'visual_mock_only',
    userData,
    shots,
    note:
      'Static fixture.html only (visual_mock_only). NOT runtime evidence. See scripts/_d11-e-runtime-evidence-16a/. owner_runtime_not_started; no MUHUB.',
  };
  fs.writeFileSync(path.join(EVIDENCE, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log(JSON.stringify(summary, null, 2));
  app.quit();
}

main().catch((err) => {
  console.error(err);
  app.exit(1);
});
