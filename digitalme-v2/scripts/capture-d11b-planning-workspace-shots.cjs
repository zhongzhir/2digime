/**
 * D11-B 工程视觉核对：隔离 userData，截取规划/修改规划/准备受阻/开发中四态。
 */
'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_d11-b-planning-workspace-13-evidence');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-d11b-ud-'));
app.setPath('userData', userData);

async function capture(win, name) {
  const img = await win.webContents.capturePage();
  const file = path.join(EVIDENCE, `${name}.png`);
  fs.writeFileSync(file, img.toPNG());
  return file;
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  await app.whenReady();
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await win.loadURL(pathToFileURL(path.join(EVIDENCE, 'fixture.html')).href);
  await new Promise((r) => setTimeout(r, 300));

  const shots = {};

  await win.webContents.executeJavaScript(`
    document.getElementById('work-timeline').innerHTML =
      '<div class="work-turn"><div class="work-turn-role">你</div><div class="work-turn-text">做一个能在浏览器里玩的打飞机小游戏</div></div>' +
      '<div class="work-turn"><div class="work-turn-role">Digital Me</div><div class="work-turn-text">我理解你想先做出可玩的基础版。右侧是第 1 版规划，你可以继续提意见，或确认后开始开发。</div></div>';
    window.__setPlan(1, [
      '目标：做一个能在浏览器里玩的打飞机小游戏',
      '交付：可打开的网页版基础玩法',
      '路径：先做移动、射击、敌机与计分',
      '准备：需要项目位置与代码执行能力',
      '边界：不联网、不自动发布'
    ].join('\\n'));
    document.getElementById('left-stage').textContent = '规划待确认';
    true;
  `);
  await new Promise((r) => setTimeout(r, 200));
  shots.first_plan = await capture(win, '01-first-plan');

  await win.webContents.executeJavaScript(`
    document.getElementById('work-timeline').innerHTML +=
      '<div class="work-turn"><div class="work-turn-role">你</div><div class="work-turn-text">改成鼠标操作，并记录最高分</div></div>' +
      '<div class="work-turn"><div class="work-turn-role">Digital Me</div><div class="work-turn-text">好的，我已把规划更新为第 2 版。确认后开始开发。</div></div>';
    window.__setPlan(2, [
      '目标：做一个能在浏览器里玩的打飞机小游戏',
      '交付：可打开的网页版基础玩法（含最高分记录）',
      '路径：先做移动、射击、敌机、计分，再加最高分',
      '准备：需要项目位置与代码执行能力',
      '边界：不联网、不自动发布；操作改为鼠标'
    ].join('\\n'));
    document.getElementById('left-stage').textContent = '规划待确认 · v2';
    true;
  `);
  await new Promise((r) => setTimeout(r, 200));
  shots.plan_v2 = await capture(win, '02-plan-updated');

  await win.webContents.executeJavaScript(`
    window.__setPrep();
    document.getElementById('left-stage').textContent = '准备受阻';
    document.getElementById('job-status').textContent = '开发前还需完成准备：代码执行能力';
    true;
  `);
  await new Promise((r) => setTimeout(r, 200));
  shots.prep_blocked = await capture(win, '03-prep-blocked');

  await win.webContents.executeJavaScript(`
    window.__setRunning();
    document.getElementById('left-stage').textContent = '开发中';
    document.getElementById('job-status').textContent = '正在处理';
    document.getElementById('work-timeline').innerHTML +=
      '<div class="work-turn"><div class="work-turn-role">Digital Me</div><div class="work-turn-text">已按规划版本 v2 开始开发，完成后我会告诉你结果。</div></div>';
    true;
  `);
  await new Promise((r) => setTimeout(r, 200));
  shots.running = await capture(win, '04-after-confirm-running');

  const summary = {
    task: '2DIGIME-BUILD-01-D11-B-PLANNING-WORKSPACE-13',
    generatedAt: new Date().toISOString(),
    userData,
    shots,
    note: 'engineering visual check only; owner_runtime_not_started',
  };
  fs.writeFileSync(path.join(EVIDENCE, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
  win.destroy();
  app.exit(0);
}

main().catch((err) => {
  console.error(err);
  app.exit(1);
});
