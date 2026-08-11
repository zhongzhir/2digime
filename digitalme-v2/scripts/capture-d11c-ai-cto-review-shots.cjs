/**
 * D11-C 工程视觉核对：隔离 userData，截取开发中 / 达标可试用 / 需修订 / 证据不足 / 模型不可用。
 */
'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_d11-c-ai-cto-review-14-evidence');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-d11c-ud-'));
app.setPath('userData', userData);

const FIXTURE = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>D11-C AI CTO Review Visual</title>
<style>
:root { --border:#d8dde6; --panel:#f7f8fb; --text:#1a1f2c; --muted:#5b6475; --ok:#1f6b3a; --warn:#8a5a00; }
body { margin:0; font:14px/1.5 "Segoe UI",sans-serif; color:var(--text); background:#eef1f6; }
.layout { display:grid; grid-template-columns: 220px 1fr 320px; height:100vh; }
.col { background:#fff; border-right:1px solid var(--border); padding:12px; overflow:auto; }
.col:last-child { border-right:none; }
h2,h3 { margin:0 0 8px; font-size:15px; }
.muted { color:var(--muted); }
.tiny { font-size:12px; }
.panel { border:1px solid var(--border); border-radius:10px; background:var(--panel); padding:12px; margin-bottom:12px; }
.work-turn { margin:0 0 12px; padding:10px 12px; border:1px solid var(--border); border-radius:8px; }
.work-turn-role { font-size:12px; color:var(--muted); margin-bottom:4px; }
.work-turn-actions { margin-top:8px; display:flex; gap:8px; }
button { border:1px solid var(--border); border-radius:8px; padding:6px 12px; background:#fff; }
button.primary { background:#1f3a5f; color:#fff; border-color:#1f3a5f; }
.compose { margin-top:16px; border-top:1px solid var(--border); padding-top:12px; }
.compose input { width:100%; box-sizing:border-box; padding:8px; border:1px solid var(--border); border-radius:8px; }
.tech { margin-top:8px; }
.badge-ok { color:var(--ok); font-weight:600; }
.badge-warn { color:var(--warn); font-weight:600; }
#task-workspace-running[hidden], #task-workspace-result[hidden], #tech-fold[hidden] { display:none !important; }
</style>
</head>
<body>
<div class="layout">
  <aside class="col">
    <h2>任务</h2>
    <p id="left-stage">开发中</p>
    <p class="muted tiny" id="job-status">正在处理</p>
  </aside>
  <main class="col">
    <h2>对话</h2>
    <div id="work-timeline"></div>
    <div class="compose">
      <p class="muted tiny">输入区始终可用</p>
      <input id="nl" value="" placeholder="继续说明你的想法…" />
    </div>
  </main>
  <aside class="col" id="artifact-panel">
    <h2 id="task-workspace-title">任务工作区 · 开发中</h2>
    <div id="task-workspace-running" class="panel">
      <h3>开发中</h3>
      <p class="muted">按已确认的规划版本 v2 执行</p>
      <p id="tw-running-progress">正在实现与验证，请稍候…</p>
    </div>
    <div id="task-workspace-result" class="panel" hidden>
      <h3 id="result-title">成果</h3>
      <p id="result-body"></p>
      <p id="try-run" class="badge-ok" hidden>可以试用：打开项目预览</p>
      <details class="tech" id="tech-fold">
        <summary>技术证据（默认折叠）</summary>
        <p class="tiny muted">构建通过 · 测试通过 · 修改 3 个文件</p>
      </details>
    </div>
  </aside>
</div>
<script>
function setTimeline(html){ document.getElementById('work-timeline').innerHTML = html; }
function setRunning(){
  document.getElementById('task-workspace-running').hidden = false;
  document.getElementById('task-workspace-result').hidden = true;
  document.getElementById('task-workspace-title').textContent = '任务工作区 · 开发中';
}
function setResult(title, body, opts){
  opts = opts || {};
  document.getElementById('task-workspace-running').hidden = true;
  document.getElementById('task-workspace-result').hidden = false;
  document.getElementById('task-workspace-title').textContent = '任务工作区 · 成果';
  document.getElementById('result-title').textContent = title;
  document.getElementById('result-body').textContent = body;
  document.getElementById('try-run').hidden = !opts.tryRun;
  document.getElementById('tech-fold').hidden = !!opts.hideTech;
}
</script>
</body>
</html>
`;

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
  await new Promise((r) => setTimeout(r, 300));
  const shots = {};

  await win.webContents.executeJavaScript(`
    setRunning();
    setTimeline(
      '<div class="work-turn"><div class="work-turn-role">你</div><div class="work-turn-text">做一个打飞机小游戏</div></div>' +
      '<div class="work-turn"><div class="work-turn-role">Digital Me</div><div class="work-turn-text">已按规划版本 v2 开始开发。完成后我会给出独立验收结论。</div></div>'
    );
    document.getElementById('left-stage').textContent = '开发中';
    document.getElementById('job-status').textContent = '正在处理这项任务…';
    true;
  `);
  shots.running = await capture(win, '01-running');

  await win.webContents.executeJavaScript(`
    setResult('工程已达到规划，可以试用', '对照已确认规划，基础玩法、计分与启动检查均有证据支持。你可以先试用，再决定是否采用。', { tryRun: true });
    setTimeline(
      '<div class="work-turn"><div class="work-turn-role">Digital Me</div><div class="work-turn-text">对照已确认规划，基础玩法、计分与启动检查均有证据支持。你可以先试用，再决定是否采用。</div>' +
      '<div class="work-turn-actions"><button class="primary">确认采用</button></div></div>'
    );
    document.getElementById('left-stage').textContent = '可试用';
    document.getElementById('job-status').textContent = '工程已达到规划';
    true;
  `);
  shots.meets = await capture(win, '02-meets-plan-try');

  await win.webContents.executeJavaScript(`
    setResult('Digital Me 已形成修订建议', '计分已完成，但启动检查未通过。已形成修订建议，输入区可继续补充意见；本阶段不会自动连续创建修订任务。', { tryRun: false });
    setTimeline(
      '<div class="work-turn"><div class="work-turn-role">Digital Me</div><div class="work-turn-text">计分已完成，但启动检查未通过。修订方向：修复启动失败原因，补齐可打开的预览证据后再验收。</div>' +
      '<div class="work-turn-actions"><button>按修订建议继续</button></div></div>'
    );
    document.getElementById('left-stage').textContent = '需要修订';
    document.getElementById('job-status').textContent = '已形成修订建议';
    true;
  `);
  shots.revision = await capture(win, '03-needs-revision');

  await win.webContents.executeJavaScript(`
    setResult('证据不足，暂不能确认达标', '目前只有部分文件变更记录，缺少构建与运行证据，暂不能确认已达到规划。', { tryRun: false });
    setTimeline(
      '<div class="work-turn"><div class="work-turn-role">Digital Me</div><div class="work-turn-text">目前只有部分文件变更记录，缺少构建与运行证据，暂不能确认已达到规划。你可以补充说明，或稍后在证据齐全后重新验收。</div></div>'
    );
    document.getElementById('left-stage').textContent = '证据不足';
    document.getElementById('job-status').textContent = '暂不能确认达标';
    true;
  `);
  shots.insufficient = await capture(win, '04-insufficient-evidence');

  await win.webContents.executeJavaScript(`
    setResult('暂时无法完成独立验收', '验收所需的模型连接不可用。现有工程证据会保留，你可以先查看已有成果，稍后再重新验收。', { tryRun: false, hideTech: false });
    setTimeline(
      '<div class="work-turn"><div class="work-turn-role">Digital Me</div><div class="work-turn-text">暂时无法完成独立验收：验收所需的模型连接不可用。现有工程证据会保留，你可以先查看已有成果，稍后再重新验收。</div>' +
      '<div class="work-turn-actions"><button>稍后重新验收</button></div></div>'
    );
    document.getElementById('left-stage').textContent = '验收暂不可用';
    document.getElementById('job-status').textContent = '模型不可用，未判定完成';
    true;
  `);
  shots.unavailable = await capture(win, '05-model-unavailable');

  const summary = {
    task: '2DIGIME-BUILD-01-D11-C-AI-CTO-REVIEW-14',
    generatedAt: new Date().toISOString(),
    userData,
    shots,
    note: 'engineering visual check only; owner_runtime_not_started; D11-D/E not implemented',
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
