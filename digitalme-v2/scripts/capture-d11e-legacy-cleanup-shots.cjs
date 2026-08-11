/**
 * D11-E 工程视觉核对：隔离 userData，截取规划确认 / 执行授权 / 开发中 / 自动修订 / 可试用 / 失败暂停。
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
    ['plan', '01-plan-confirm'],
    ['auth', '02-execution-auth'],
    ['running', '03-developing'],
    ['revise', '04-auto-revision'],
    ['try', '05-ready-to-try'],
    ['pause', '06-paused-after-failures'],
  ];
  const shots = {};
  for (const [scene, name] of scenes) {
    await win.loadURL(`${pathToFileURL(fixturePath).href}?scene=${scene}`);
    await new Promise((r) => setTimeout(r, 200));
    shots[scene] = await capture(win, name);
  }
  const summary = {
    task: '2DIGIME-BUILD-01-D11-E-LEGACY-CLEANUP-OWNER-RUNTIME-PREP-16',
    generatedAt: new Date().toISOString(),
    userData,
    shots,
    note: 'engineering visual check only; owner_runtime_not_started; no MUHUB',
  };
  fs.writeFileSync(path.join(EVIDENCE, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log(JSON.stringify(summary, null, 2));
  app.quit();
}

main().catch((err) => {
  console.error(err);
  app.exit(1);
});
