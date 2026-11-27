const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  return out;
}

function runSandbox(exe, home, workspace, command) {
  return spawnSync(exe, [
    'sandbox',
    '-P', ':workspace',
    '-C', workspace,
    '-c', 'windows.sandbox="unelevated"',
    '--',
    'powershell.exe', '-NoProfile', '-NonInteractive', '-Command', command,
  ], {
    cwd: workspace,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot || 'C:\\Windows',
      COMSPEC: process.env.COMSPEC || 'C:\\Windows\\System32\\cmd.exe',
      PATHEXT: process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD',
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      HOME: process.env.USERPROFILE,
      USERPROFILE: process.env.USERPROFILE,
      HOMEDRIVE: process.env.HOMEDRIVE,
      HOMEPATH: process.env.HOMEPATH,
      APPDATA: process.env.APPDATA,
      LOCALAPPDATA: process.env.LOCALAPPDATA,
      CODEX_HOME: home,
    },
  });
}

const args = parseArgs(process.argv.slice(2));
if (!args.exe || !args.output) throw new Error('usage: --exe <codex.exe> --output <receipt.json>');
const exe = path.resolve(args.exe);
const output = path.resolve(args.output);
const probeParent = args.root ? path.resolve(args.root) : path.join(path.dirname(output), 'boundary-probes');
fs.mkdirSync(probeParent, { recursive: true });
const root = fs.mkdtempSync(path.join(probeParent, 'dm-codex-boundary-'));
const workspace = args.workspace ? path.resolve(args.workspace) : path.join(root, 'authorized-workspace');
const outsideDir = path.join(root, 'outside-workspace');
const home = path.join(root, 'codex-home');
fs.mkdirSync(workspace, { recursive: true });
fs.mkdirSync(outsideDir, { recursive: true });
fs.mkdirSync(home, { recursive: true });
const inside = path.join(workspace, '.slice-2c-boundary-probe.txt');
const outside = path.join(outsideDir, 'outside.txt');
const psQuote = (value) => `'${value.replace(/'/g, "''")}'`;
const insideRun = runSandbox(exe, home, workspace, `Set-Content -LiteralPath ${psQuote(inside)} -Value 'inside-ok' -Encoding utf8`);
const outsideRun = runSandbox(exe, home, workspace, `Set-Content -LiteralPath ${psQuote(outside)} -Value 'outside-bad' -Encoding utf8`);
const insideExisted = fs.existsSync(inside);
const receipt = {
  schemaVersion: 1,
  checkedAt: new Date().toISOString(),
  executable: exe,
  executableSha256: crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex'),
  workingDirectory: workspace,
  sandbox: { profile: ':workspace', network: 'restricted', windowsImplementation: 'unelevated-restricted-token' },
  insideScopeWrite: { exitCode: insideRun.status, exists: insideExisted },
  outsideScopeWrite: {
    exitCode: outsideRun.status,
    exists: fs.existsSync(outside),
    stderr: String(outsideRun.stderr || '').slice(0, 1000),
  },
  outsideScopeWrites: fs.existsSync(outside) ? [outside] : [],
  passed: insideRun.status === 0 && insideExisted && outsideRun.status !== 0 && !fs.existsSync(outside),
};
if (insideExisted) fs.rmSync(inside, { force: true });
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(receipt, null, 2));
if (!receipt.passed) process.exit(1);
