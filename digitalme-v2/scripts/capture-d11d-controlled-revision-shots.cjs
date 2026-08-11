/**
 * D11-D 工程视觉核对：隔离 userData，截取首次自动修订 / 换方案 / 三次暂停 / 扩权确认 / 可试用。
 */
'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_d11-d-controlled-revision-15-evidence');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-d11d-ud-'));
app.setPath('userData', userData);

const FIXTURE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"/><title>D11-D</title>
<style>
body{margin:0;font:14px/1.5 Segoe UI,sans-serif;color:#1a1f2c;background:#eef1f6}
.layout{display:grid;grid-template-columns:200px 1fr 320px;height:100vh}
.col{background:#fff;border-right:1px solid #d8dde6;padding:12px;overflow:auto}
.col:last-child{border-right:0}
.panel{border:1px solid #d8dde6;border-radius:10px;background:#f7f8fb;padding:12px;margin-bottom:12px}
.turn{margin:0 0 12px;padding:10px 12px;border:1px solid #d8dde6;border-radius:8px}
.role{font-size:12px;color:#5b6475;margin-bottom:4px}
.compose{margin-top:16px;border-top:1px solid #d8dde6;padding-top:12px}
.compose input{width:100%;box-sizing:border-box;padding:8px;border:1px solid #d8dde6;border-radius:8px}
.muted{color:#5b6475}.ok{color:#1f6b3a;font-weight:600}
button{border:1px solid #d8dde6;border-radius:8px;padding:6px 12px;background:#fff;margin-top:8px}
</style></head><body>
<div class="layout">
<aside class="col"><h2>任务</h2><p id="left">修订中</p><p class="muted" id="status">自动处理中</p></aside>
<main class="col"><h2>对话</h2><div id="tl"></div>
<div class="compose"><p class="muted">输入区始终可用</p><input placeholder="继续说明你的想法…"></div></main>
<aside class="col"><h2 id="rt">任务工作区 · 修订中</h2>
<div id="rp" class="panel"><h3 id="rh">修订中</h3><p id="rr" class="muted">第 1 轮</p><p id="rb">正在解决启动失败问题</p><p id="ru" class="muted">当前不需要你操作</p>
<details><summary>技术证据（默认折叠）</summary><p class="muted">构建通过 · 启动失败</p></details></div>
</aside></div>
<script>
function set(left,status,title,h,round,body,needUser,tl){
  document.getElementById('left').textContent=left;
  document.getElementById('status').textContent=status;
  document.getElementById('rt').textContent=title;
  document.getElementById('rh').textContent=h;
  document.getElementById('rr').textContent=round;
  document.getElementById('rb').textContent=body;
  document.getElementById('ru').textContent=needUser?'需要你决定下一步':'当前不需要你操作';
  document.getElementById('tl').innerHTML=tl;
}
</script></body></html>`;

async function capture(win, name) {
  const img = await win.webContents.capturePage();
  const file = path.join(EVIDENCE, `${name}.png`);
  fs.writeFileSync(file, img.toPNG());
  return file;
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const fixturePath = path.join(EVIDENCE, 'fixture.html');
  fs.writeFileSync(fixturePath, FIXTURE, 'utf8');
  await app.whenReady();
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  await win.loadURL(pathToFileURL(fixturePath).href);
  await new Promise((r) => setTimeout(r, 250));
  const shots = {};

  await win.webContents.executeJavaScript(`set(
    '修订中','正在自动修订','任务工作区 · 修订中','修订中','第 1 轮 · 按规划 v2',
    '第一轮未达到规划，我已找到问题并开始修订。',false,
    '<div class="turn"><div class="role">Digital Me</div>第一轮未达到规划，我已找到问题并开始修订。</div>'
  ); true;`);
  shots.first = await capture(win, '01-first-auto-revision');

  await win.webContents.executeJavaScript(`set(
    '换方案','正在换一种方式','任务工作区 · 修订中','修订中','第 2 轮 · 按规划 v2',
    '相同原因再次出现，原方案无效，我正在换一种方式处理。',false,
    '<div class="turn"><div class="role">Digital Me</div>相同原因再次出现，原方案无效，我正在换一种方式处理。</div>'
  ); true;`);
  shots.second = await capture(win, '02-second-scheme-change');

  await win.webContents.executeJavaScript(`set(
    '已暂停','连续失败已暂停','任务工作区 · 成果','已暂停','已完成 2 轮自动修订',
    '这个原因已连续出现三次，我已暂停，避免继续无效尝试。',true,
    '<div class="turn"><div class="role">Digital Me</div>这个原因已连续出现三次，我已暂停，避免继续无效尝试。你可以调整目标或说明希望换一种处理方式。</div>'
  ); true;`);
  shots.third = await capture(win, '03-third-forced-pause');

  await win.webContents.executeJavaScript(`set(
    '需要确认','扩权需你决定','任务工作区 · 准备','需要额外确认','规划 v2',
    '该修改涉及更高权限范围，请你确认后再继续。',true,
    '<div class="turn"><div class="role">Digital Me</div>该修改会扩大可写入范围。确认后我才会继续；你也可以改回原范围内的方案。</div><button>确认并继续</button>'
  ); true;`);
  shots.expand = await capture(win, '04-expand-scope-user-decision');

  await win.webContents.executeJavaScript(`set(
    '可试用','工程已达到规划','任务工作区 · 成果','可以试用','按规划 v2 完成',
    '成果已达到当前计划。你可以先试用，再决定是否采用。',false,
    '<div class="turn"><div class="role">Digital Me</div>工程已达到规划，可以试用。最终是否采用仍由你决定。</div><button>确认采用</button>'
  ); document.getElementById('rb').innerHTML='<span class="ok">可以试用：打开项目预览</span>'; true;`);
  shots.ready = await capture(win, '05-meets-plan-try');

  const summary = {
    task: '2DIGIME-BUILD-01-D11-D-CONTROLLED-REVISION-LOOP-15',
    generatedAt: new Date().toISOString(),
    userData,
    shots,
    note: 'engineering visual check only; owner_runtime_not_started; D11-E not implemented',
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
