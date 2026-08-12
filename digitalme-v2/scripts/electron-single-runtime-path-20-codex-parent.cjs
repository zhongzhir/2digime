/**
 * Electron 父进程下 Codex probe/exec 静默证据（真实 main.cjs 同进程树）。
 * 不调用模型；不写产品代码。
 */
'use strict';

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_single-runtime-path-20-evidence');
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-srp20-codex-ud-'));
fs.mkdirSync(EVIDENCE, { recursive: true });
app.commandLine.appendSwitch('disable-gpu');
app.setPath('userData', USER_DATA);

function snapshotWindows() {
  if (process.platform !== 'win32') return { platform: process.platform, conhost: 0, visible: [] };
  const ps = `
    $con = @(Get-Process conhost -ErrorAction SilentlyContinue).Count
    $vis = @(Get-Process | Where-Object {
      $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and (
        $_.ProcessName -match 'codex|conhost|cmd|powershell' -or
        $_.MainWindowTitle -match 'codex|vendor|Command Prompt|命令提示符'
      )
    } | Select-Object ProcessName, Id, MainWindowTitle)
    @{ conhost = $con; visible = @($vis | ForEach-Object { \"$($_.ProcessName):$($_.Id):$($_.MainWindowTitle)\" }) } | ConvertTo-Json -Compress
  `;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 15000,
  });
  try {
    return JSON.parse(String(r.stdout || '').trim() || '{}');
  } catch {
    return { conhost: -1, visible: [], error: String(r.stderr || '') };
  }
}

async function run() {
  const {
    resolveCodexLaunch,
    buildCodexExecArgs,
  } = require(path.join(ROOT, 'dist', 'capability', 'adapters', 'external-executor-codex'));
  const { hiddenSpawnOptions } = require(path.join(ROOT, 'dist', 'execution', 'hidden-spawn'));
  const launch = resolveCodexLaunch();
  const report = {
    schemaVersion: 'single-runtime-path-20-codex-parent/1',
    parent: 'electron+main.cjs-require',
    parentPid: process.pid,
    launch,
    probe: null,
    exec: null,
  };

  const beforeProbe = snapshotWindows();
  const versionOut = await new Promise((resolve) => {
    const child = spawn(
      launch.executable,
      [...launch.argsPrefix, '--version'],
      hiddenSpawnOptions({ env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }),
    );
    let out = '';
    child.stdout?.on('data', (c) => {
      out += c.toString('utf8');
    });
    child.on('close', () => resolve(out.trim()));
    child.on('error', (e) => resolve(`ERR:${e.message}`));
  });
  await new Promise((r) => setTimeout(r, 800));
  const afterProbe = snapshotWindows();
  const probeNew = (afterProbe.visible || []).filter((t) => !(beforeProbe.visible || []).includes(t));
  report.probe = {
    version: versionOut.slice(0, 120),
    before: beforeProbe,
    after: afterProbe,
    newVisible: probeNew,
    ok: probeNew.length === 0,
  };

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-srp20-codex-work-'));
  fs.writeFileSync(path.join(work, 'README.md'), 'probe\n');
  const lastMsg = path.join(work, 'last.txt');
  const cli = buildCodexExecArgs({
    codexJsPath: launch.codexJsPath,
    workingDirectory: work,
    lastMessagePath: lastMsg,
    skipGitRepoCheck: true,
  });
  const beforeExec = snapshotWindows();
  const execResult = await new Promise((resolve) => {
    const child = spawn(
      launch.executable,
      [...launch.argsPrefix, ...cli],
      hiddenSpawnOptions({ env: process.env }),
    );
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ timedOut: true, stdout, stderr });
    }, 45000);
    child.stdout?.on('data', (c) => {
      stdout += c.toString('utf8');
    });
    child.stderr?.on('data', (c) => {
      stderr += c.toString('utf8');
    });
    child.stdin?.write('只回复 ok，不要改任何文件。\n');
    child.stdin?.end();
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ timedOut: false, code, stdout, stderr });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ error: e.message, stdout, stderr });
    });
  });
  await new Promise((r) => setTimeout(r, 800));
  const afterExec = snapshotWindows();
  const execNew = (afterExec.visible || []).filter((t) => !(beforeExec.visible || []).includes(t));
  report.exec = {
    ...execResult,
    stdout: String(execResult.stdout || '').slice(0, 300),
    stderr: String(execResult.stderr || '').slice(0, 300),
    before: beforeExec,
    after: afterExec,
    newVisible: execNew,
    ok: execNew.length === 0,
  };
  report.verdict =
    report.probe.ok && report.exec.ok
      ? 'electron_parent_no_visible_console'
      : 'visible_console_detected';
  fs.writeFileSync(
    path.join(EVIDENCE, 'codex-electron-parent-silent.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  console.log(JSON.stringify({ ok: report.verdict === 'electron_parent_no_visible_console', verdict: report.verdict, mode: launch.mode }, null, 2));
  app.exit(report.verdict === 'electron_parent_no_visible_console' ? 0 : 1);
}

app.whenReady().then(() => {
  // 拉起一个空窗，确保与产品相同的 Electron 父进程环境
  const win = new BrowserWindow({ show: false, width: 800, height: 600 });
  win.loadURL('about:blank');
  run().catch((err) => {
    fs.writeFileSync(
      path.join(EVIDENCE, 'codex-electron-parent-silent.json'),
      `${JSON.stringify({ error: String(err && err.stack ? err.stack : err) }, null, 2)}\n`,
    );
    console.error(err);
    app.exit(1);
  });
});

// 同进程加载生产 main 的依赖环境（不进入 UI 自动化）
require(path.join(ROOT, 'electron', 'main.cjs'));
