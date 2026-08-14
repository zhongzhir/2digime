/**
 * AI-NATIVE-MATERIAL-AWARE-WORKFLOW-32-REAL-GATE
 * 唯一真实 UI 工程闸门：IMPRINT 隔离副本 + 真实 electron/main.cjs + 真实模型。
 * 任一检查失败立即停止，不补修产品代码。不提交、不 push、不更新 PR、不启动 Owner 验收。
 */
'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_ai-native-material-aware-workflow-32-real-gate-evidence');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const ENTRY = path.join(__dirname, 'electron-ai-native-material-aware-workflow-32-real-gate-entry.cjs');
const IMPRINT_SRC = 'D:\\Projects\\IMPRINT';
const GOAL = '提出/规划项目优化升级方案，待批准后实施。';

fs.rmSync(EVIDENCE, { recursive: true, force: true });
fs.mkdirSync(EVIDENCE, { recursive: true });

function hashTree(rootDir) {
  const files = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else {
        const rel = path.relative(rootDir, p).replace(/\\/g, '/');
        const buf = fs.readFileSync(p);
        files.push({
          rel,
          size: buf.length,
          sha256: crypto.createHash('sha256').update(buf).digest('hex'),
        });
      }
    }
  };
  walk(rootDir);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return {
    count: files.length,
    files,
    digest: crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex'),
  };
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyTree(from, to);
    else fs.copyFileSync(from, to);
  }
}

if (!fs.existsSync(IMPRINT_SRC)) {
  console.error(`IMPRINT missing: ${IMPRINT_SRC}`);
  process.exit(2);
}

const imprintBefore = hashTree(IMPRINT_SRC);
const FIXTURE = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-32-imprint-'));
copyTree(IMPRINT_SRC, FIXTURE);
const fixtureBefore = hashTree(FIXTURE);
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-32-ud-'));

const report = {
  schemaVersion: 'ai-native-material-aware-workflow-32-real-gate/1',
  task: 'AI-NATIVE-MATERIAL-AWARE-WORKFLOW-32-REAL-GATE',
  baseline: 'a0900b810e993c610470b8bc1b21cd8772b3e205',
  entry: 'electron/main.cjs',
  ownerAccepted: false,
  goal: GOAL,
  imprintSource: IMPRINT_SRC,
  fixture: FIXTURE,
  userData: USER_DATA,
  imprintBefore,
  fixtureBefore,
  startedAt: new Date().toISOString(),
  phases: {},
  verdict: null,
  uniqueBlocker: null,
};

function writeReport() {
  fs.writeFileSync(path.join(EVIDENCE, 'GATE.json'), `${JSON.stringify(report, null, 2)}\n`);
}

writeReport();
fs.writeFileSync(
  path.join(EVIDENCE, 'launch.json'),
  `${JSON.stringify(
    {
      entry: 'electron/main.cjs',
      FIXTURE,
      USER_DATA,
      GOAL,
      IMPRINT_SRC,
      imprintDigestBefore: imprintBefore.digest,
      fixtureDigestBefore: fixtureBefore.digest,
    },
    null,
    2,
  )}\n`,
);

function spawnPhase(phase, { timeoutMs }) {
  const env = {
    ...process.env,
    DIGITALME_V2_ALLOW_DEV_CREDENTIAL: '1',
    DIGITALME_32_PHASE: phase,
    DIGITALME_32_USER_DATA: USER_DATA,
    DIGITALME_32_FIXTURE: FIXTURE,
    DIGITALME_32_GOAL: GOAL,
    DIGITALME_32_EVIDENCE: EVIDENCE,
    DIGITALME_32_IMPRINT_SRC: IMPRINT_SRC,
    DIGITALME_32_IMPRINT_DIGEST_BEFORE: imprintBefore.digest,
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
    if (stdout.length > 240000) stdout = stdout.slice(-120000);
  });
  child.stderr.on('data', (c) => {
    stderr += c.toString('utf8');
    if (stderr.length > 240000) stderr = stderr.slice(-120000);
  });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve({
        ok: false,
        uniqueBlocker: `timeout:${phase}`,
        stdout,
        stderr,
        exitCode: null,
      });
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      const marker = path.join(EVIDENCE, `${phase}-done.json`);
      const fail = path.join(EVIDENCE, `${phase}-fail.json`);
      const file = fs.existsSync(marker) ? marker : fail;
      let payload = { ok: false, uniqueBlocker: `electron_exit_${code}` };
      try {
        if (fs.existsSync(file)) payload = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        /* keep */
      }
      fs.writeFileSync(path.join(EVIDENCE, `${phase}-stdio.txt`), `${stdout}\n---stderr---\n${stderr}`);
      resolve({ ...payload, exitCode: code, stdoutTail: stdout.slice(-4000), stderrTail: stderr.slice(-4000) });
    });
  });
}

async function run() {
  const phases = [
    { id: 'scenario', timeoutMs: 20 * 60 * 1000 },
    { id: 'restart', timeoutMs: 4 * 60 * 1000 },
  ];

  for (const phase of phases) {
    console.log(`[32-REAL-GATE] start ${phase.id}`);
    const result = await spawnPhase(phase.id, phase);
    report.phases[phase.id] = result;
    report.updatedAt = new Date().toISOString();
    writeReport();
    if (!result.ok) {
      report.verdict = 'failed';
      report.uniqueBlocker = result.uniqueBlocker || `${phase.id}_failed`;
      report.failedPhase = phase.id;
      report.imprintAfter = hashTree(IMPRINT_SRC);
      report.imprintUnchanged = report.imprintAfter.digest === imprintBefore.digest;
      writeReport();
      console.error(JSON.stringify(report, null, 2));
      process.exit(1);
    }
    console.log(`[32-REAL-GATE] pass ${phase.id}`);
  }

  report.imprintAfter = hashTree(IMPRINT_SRC);
  report.fixtureAfter = hashTree(FIXTURE);
  report.imprintUnchanged = report.imprintAfter.digest === imprintBefore.digest;
  report.fixtureChanged = report.fixtureAfter.digest !== fixtureBefore.digest;
  if (!report.imprintUnchanged) {
    report.verdict = 'failed';
    report.uniqueBlocker = 'original_imprint_modified';
    writeReport();
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  if (!report.fixtureChanged) {
    report.verdict = 'failed';
    report.uniqueBlocker = 'fixture_not_modified';
    writeReport();
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }

  report.verdict = 'passed_pending_owner_acceptance';
  report.finishedAt = new Date().toISOString();
  writeReport();
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

run().catch((err) => {
  report.verdict = 'failed';
  report.uniqueBlocker = String(err && err.stack ? err.stack : err);
  writeReport();
  console.error(report.uniqueBlocker);
  process.exit(1);
});
