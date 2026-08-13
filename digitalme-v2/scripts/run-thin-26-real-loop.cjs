/**
 * 启动真实 Electron/main.cjs + 真实模型 + 真实 Codex。
 * 隔离非 Git 小项目。最多约 9 分钟；超时即停。
 */
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MODE = String(process.env.DIGITALME_THIN26_MODE || 'success').trim();
const EVIDENCE =
  process.env.DIGITALME_THIN26_EVIDENCE ||
  path.join(ROOT, 'scripts', `_thin-26-real-loop-${MODE}-evidence`);
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const ENTRY = path.join(__dirname, 'electron-thin-26-real-loop-entry.cjs');
const GOAL =
  process.env.DIGITALME_THIN26_GOAL ||
  '请看一下这个小项目，把 formatLabel 改成：输入 start 时给出 start-processing，然后把测试跑一遍。';

fs.rmSync(EVIDENCE, { recursive: true, force: true });
fs.mkdirSync(EVIDENCE, { recursive: true });

const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), `dm-thin26-${MODE}-ud-`));
const FIXTURE = fs.mkdtempSync(path.join(os.tmpdir(), `dm-thin26-${MODE}-repo-`));
fs.writeFileSync(
  path.join(FIXTURE, 'package.json'),
  JSON.stringify(
    { name: 'dm-thin26-fixture', private: true, scripts: { test: 'node formatLabel.test.js' } },
    null,
    2,
  ) + '\n',
);
fs.writeFileSync(
  path.join(FIXTURE, 'formatLabel.js'),
  "function formatLabel(input){ return input; }\nmodule.exports={formatLabel};\n",
);
fs.writeFileSync(path.join(FIXTURE, 'index.js'), "module.exports=require('./formatLabel');\n");
const lockPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'Temp', 'dm-thin26-locked-slot-alpha.never');
const testBody =
  MODE === 'fail'
    ? "const { formatLabel } = require('./formatLabel');\n" +
      "const fs = require('fs');\n" +
      "if (formatLabel('start') !== 'start-processing') {\n" +
      "  console.error('unexpected', formatLabel('start'));\n  process.exit(1);\n}\n" +
      `const lock = ${JSON.stringify(lockPath)};\n` +
      "if (!fs.existsSync(lock)) {\n" +
      "  console.error('locked-env-assert: missing ' + lock);\n  process.exit(1);\n}\n" +
      "console.log('ok');\n"
    : "const { formatLabel } = require('./formatLabel');\n" +
      "if (formatLabel('start') !== 'start-processing') {\n" +
      "  console.error('unexpected', formatLabel('start'));\n  process.exit(1);\n}\n" +
      "console.log('ok');\n";
fs.writeFileSync(path.join(FIXTURE, 'formatLabel.test.js'), testBody);

fs.writeFileSync(
  path.join(EVIDENCE, 'launch.json'),
  `${JSON.stringify({ USER_DATA, FIXTURE, GOAL, entry: 'electron/main.cjs' }, null, 2)}\n`,
);

const env = {
  ...process.env,
  DIGITALME_V2_ALLOW_DEV_CREDENTIAL: '1',
  DIGITALME_THIN26_USER_DATA: USER_DATA,
  DIGITALME_THIN26_FIXTURE: FIXTURE,
  DIGITALME_THIN26_EVIDENCE: EVIDENCE,
  DIGITALME_THIN26_GOAL: GOAL,
  DIGITALME_THIN_OWNER_RUNTIME: '1',
};
delete env.DIGITALME_V2_UX_ACCEPTANCE;
delete env.DIGITALME_FORCE_FAKE;
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(ELECTRON, ['--disable-gpu', ENTRY], {
  cwd: ROOT,
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: false,
});
let stdout = '';
let stderr = '';
child.stdout.on('data', (c) => {
  stdout += c.toString('utf8');
});
child.stderr.on('data', (c) => {
  stderr += c.toString('utf8');
});

const timeout = setTimeout(() => {
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  const reportPath = path.join(EVIDENCE, 'REAL_LOOP.json');
  let report = {};
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  } catch {
    /* ignore */
  }
  report.ok = false;
  report.uniqueBlocker = `timeout_at_layer:${report.layer || 'unknown'}`;
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(EVIDENCE, 'stdio.txt'), `${stdout}\n---stderr---\n${stderr}`);
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}, 9 * 60 * 1000);

child.on('exit', (code) => {
  clearTimeout(timeout);
  fs.writeFileSync(path.join(EVIDENCE, 'stdio.txt'), `${stdout}\n---stderr---\n${stderr}`);
  const done = path.join(EVIDENCE, 'done.json');
  const fail = path.join(EVIDENCE, 'fail.json');
  const reportPath = path.join(EVIDENCE, 'REAL_LOOP.json');
  const file = fs.existsSync(done) ? done : fs.existsSync(fail) ? fail : reportPath;
  let report = { ok: false, uniqueBlocker: `electron_exit_${code}` };
  try {
    report = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* keep */
  }
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
});
