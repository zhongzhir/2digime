/**
 * Windows 真实 Codex CLI 静默启动探针。
 * 不只断言 spawn options：实际拉起 Codex，核对是否出现遮挡 Digital Me 的可见控制台。
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function resolveCodexJs() {
  const candidates = [
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
    path.join(process.env.HOME || process.env.USERPROFILE || '', '.npm-global', 'lib', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
  ];
  for (const candidate of candidates) {
    try {
      fs.accessSync(candidate);
      return candidate;
    } catch {
      /* continue */
    }
  }
  return null;
}

function snapshotWindows() {
  if (process.platform !== 'win32') {
    return { platform: process.platform, conhost: 0, visible: [] };
  }
  const ps = `
    $con = @(Get-Process conhost -ErrorAction SilentlyContinue).Count
    $vis = @(Get-Process | Where-Object {
      $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and (
        $_.ProcessName -match 'codex|conhost|cmd|powershell' -or
        $_.MainWindowTitle -match 'codex|node|命令提示符|Command Prompt'
      )
    } | Select-Object -ExpandProperty MainWindowTitle)
    @{ conhost = $con; visible = @($vis) } | ConvertTo-Json -Compress
  `;
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 15000,
  });
  try {
    const parsed = JSON.parse(String(r.stdout || '').trim() || '{}');
    return {
      platform: 'win32',
      conhost: Number(parsed.conhost || 0),
      visible: Array.isArray(parsed.visible) ? parsed.visible : parsed.visible ? [parsed.visible] : [],
    };
  } catch {
    return { platform: 'win32', conhost: -1, visible: [], error: String(r.stderr || r.stdout || '') };
  }
}

function hiddenOpts(env) {
  return {
    shell: false,
    windowsHide: true,
    detached: false,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...env, ELECTRON_NO_ATTACH_CONSOLE: '1', ELECTRON_RUN_AS_NODE: process.versions.electron ? '1' : env.ELECTRON_RUN_AS_NODE },
  };
}

async function runProbe(evidenceDir) {
  const report = {
    schemaVersion: 'codex-silent-window-probe/1',
    at: new Date().toISOString(),
    platform: process.platform,
    spawnOptions: {
      shell: false,
      windowsHide: true,
      detached: false,
      stdio: ['pipe', 'pipe', 'pipe'],
      note: 'CREATE_NO_WINDOW via windowsHide; not shell; not detached',
    },
    codexJs: null,
    version: null,
    exec: null,
    before: null,
    after: null,
    visibleWindowCreated: false,
    rustGrandchildConsole: null,
    verdict: 'not_run',
  };
  const codexJs = resolveCodexJs();
  report.codexJs = codexJs;
  if (!codexJs) {
    report.verdict = 'codex_not_installed';
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(path.join(evidenceDir, 'codex-silent-probe.json'), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  }
  report.before = snapshotWindows();
  const ver = spawnSync(process.execPath, [codexJs, '--version'], {
    ...hiddenOpts(process.env),
    encoding: 'utf8',
    timeout: 20000,
  });
  report.version = {
    status: ver.status,
    stdout: String(ver.stdout || '').trim().slice(0, 200),
    stderr: String(ver.stderr || '').trim().slice(0, 200),
    error: ver.error ? ver.error.message : null,
  };

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-c18a-codex-'));
  fs.writeFileSync(path.join(work, 'README.md'), 'probe\n');
  const lastMsg = path.join(work, 'last.txt');
  const execResult = await new Promise((resolve) => {
    const args = [
      codexJs,
      'exec',
      '--cd',
      work,
      '--skip-git-repo-check',
      '--sandbox',
      'workspace-write',
      '--full-auto',
      '--output-last-message',
      lastMsg,
      '-',
    ];
    const child = spawn(process.execPath, args, hiddenOpts(process.env));
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      resolve({ timedOut: true, status: null, stdout, stderr });
    }, 25000);
    child.stdout?.on('data', (c) => {
      stdout += c.toString('utf8');
    });
    child.stderr?.on('data', (c) => {
      stderr += c.toString('utf8');
    });
    child.stdin?.write('只回复 ok，不要改任何文件。\n');
    child.stdin?.end();
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ timedOut: false, status, stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ timedOut: false, status: null, stdout, stderr, error: err.message });
    });
  });
  report.exec = {
    timedOut: !!execResult.timedOut,
    status: execResult.status,
    stdout: String(execResult.stdout || '').slice(0, 400),
    stderr: String(execResult.stderr || '').slice(0, 400),
    error: execResult.error || null,
  };
  await new Promise((r) => setTimeout(r, 800));
  report.after = snapshotWindows();
  const beforeVis = new Set(report.before.visible || []);
  const newVisible = (report.after.visible || []).filter((t) => !beforeVis.has(t));
  const conhostDelta = (report.after.conhost || 0) - (report.before.conhost || 0);
  report.visibleWindowCreated = newVisible.length > 0;
  report.rustGrandchildConsole =
    conhostDelta > 0 && newVisible.length === 0
      ? 'conhost_increased_no_visible_title'
      : conhostDelta > 0 && newVisible.length > 0
        ? 'visible_console_detected'
        : 'no_new_console_observed';
  report.verdict = report.visibleWindowCreated
    ? 'visible_window_detected'
    : 'no_visible_window_observed';
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'codex-silent-probe.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

module.exports = { runProbe, resolveCodexJs };

if (require.main === module) {
  const dest = process.argv[2] || path.join(ROOT, 'scripts', '_corrective-18a-smoke-evidence');
  runProbe(dest)
    .then((r) => {
      console.log(JSON.stringify({ verdict: r.verdict, rustGrandchildConsole: r.rustGrandchildConsole }, null, 2));
      process.exit(r.verdict === 'visible_window_detected' ? 2 : 0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
