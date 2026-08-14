/**
 * AI-NATIVE-CORE-RUNTIME-31-REAL-GATE
 * 真实 electron/main.cjs + 真实模型 + 真实执行能力。
 * 任一场景失败立即停止，不补修产品代码。不提交、不 push、不更新 PR。
 */
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const REPO = path.resolve(ROOT, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_ai-native-core-runtime-31-real-gate-evidence');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const ENTRY = path.join(__dirname, 'electron-ai-native-core-runtime-31-real-gate-entry.cjs');

const GOAL_DOC =
  '通读这个项目，形成一份架构评估报告，说明当前架构、主要问题和建议的下一步。';
const GOAL_CODEX =
  '通读这个项目，让 formatLabel 在输入 start 时返回 start-processing，并跑测试。';
const GOAL_RACE = '根据这个文件夹写一份一页项目说明。';

fs.rmSync(EVIDENCE, { recursive: true, force: true });
fs.mkdirSync(EVIDENCE, { recursive: true });

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

const DOC_FIXTURE = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-31-doc-'));
fs.writeFileSync(
  path.join(DOC_FIXTURE, 'README.txt'),
  [
    'ARCH-GATE-31-UNIQUE-MARKER',
    '这是一份隔离项目副本，供架构评估使用。',
    '当前系统按「对话 / 做事 / 数字之我」组织。',
    '本副本不含软件工程根标记，不得被当成代码仓库。',
    '',
  ].join('\n'),
  'utf8',
);
copyFile(
  path.join(ROOT, 'docs', 'design', 'digitalme_v2_product_architecture_consolidation_v0.1_20260804.md'),
  path.join(DOC_FIXTURE, 'architecture.md'),
);
copyFile(
  path.join(ROOT, 'docs', 'design', 'digitalme_v2_ai_first_execution_simplification_v0.1_202608.md'),
  path.join(DOC_FIXTURE, 'execution.md'),
);

const RACE_FIXTURE = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-31-race-'));
fs.writeFileSync(
  path.join(RACE_FIXTURE, 'README.txt'),
  'RACE-GATE-31 隔离说明材料。这不是软件项目。\n',
  'utf8',
);
fs.writeFileSync(
  path.join(RACE_FIXTURE, 'notes.md'),
  '# 说明\n本文件夹只有文档，没有工程文件。\n',
  'utf8',
);

const CODE_FIXTURE = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-31-code-'));
fs.writeFileSync(
  path.join(CODE_FIXTURE, 'package.json'),
  JSON.stringify(
    { name: 'dm-31-real-gate-fixture', private: true, scripts: { test: 'node formatLabel.test.js' } },
    null,
    2,
  ) + '\n',
);
fs.writeFileSync(
  path.join(CODE_FIXTURE, 'formatLabel.js'),
  "function formatLabel(input){ return input; }\nmodule.exports={formatLabel};\n",
);
fs.writeFileSync(path.join(CODE_FIXTURE, 'index.js'), "module.exports=require('./formatLabel');\n");
fs.writeFileSync(
  path.join(CODE_FIXTURE, 'formatLabel.test.js'),
  "const { formatLabel } = require('./formatLabel');\n" +
    "if (formatLabel('start') !== 'start-processing') {\n" +
    "  console.error('unexpected', formatLabel('start'));\n  process.exit(1);\n}\n" +
    "console.log('ok');\n",
);

const DOC_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-31-doc-ud-'));
const RACE_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-31-race-ud-'));
const CODE_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-31-code-ud-'));

const report = {
  schemaVersion: 'ai-native-core-runtime-31-real-gate/1',
  task: 'AI-NATIVE-CORE-RUNTIME-31-REAL-GATE',
  head: '34499d857ced53b25b3748dfb5ba089781d75972',
  entry: 'electron/main.cjs',
  ownerAccepted: false,
  startedAt: new Date().toISOString(),
  fixtures: {
    document: DOC_FIXTURE,
    race: RACE_FIXTURE,
    code: CODE_FIXTURE,
  },
  userData: {
    document: DOC_USER_DATA,
    race: RACE_USER_DATA,
    code: CODE_USER_DATA,
  },
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
      DOC_FIXTURE,
      RACE_FIXTURE,
      CODE_FIXTURE,
      DOC_USER_DATA,
      RACE_USER_DATA,
      CODE_USER_DATA,
      GOAL_DOC,
      GOAL_CODEX,
      GOAL_RACE,
    },
    null,
    2,
  )}\n`,
);

function spawnPhase(phase, { userData, fixture, goal, timeoutMs }) {
  const env = {
    ...process.env,
    DIGITALME_V2_ALLOW_DEV_CREDENTIAL: '1',
    DIGITALME_31_PHASE: phase,
    DIGITALME_31_USER_DATA: userData,
    DIGITALME_31_FIXTURE: fixture,
    DIGITALME_31_GOAL: goal,
    DIGITALME_31_EVIDENCE: EVIDENCE,
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
    {
      id: 'scenario1',
      userData: DOC_USER_DATA,
      fixture: DOC_FIXTURE,
      goal: GOAL_DOC,
      timeoutMs: 12 * 60 * 1000,
    },
    {
      id: 'restart',
      userData: DOC_USER_DATA,
      fixture: DOC_FIXTURE,
      goal: GOAL_DOC,
      timeoutMs: 3 * 60 * 1000,
    },
    {
      id: 'race',
      userData: RACE_USER_DATA,
      fixture: RACE_FIXTURE,
      goal: GOAL_RACE,
      timeoutMs: 8 * 60 * 1000,
    },
    {
      id: 'scenario2',
      userData: CODE_USER_DATA,
      fixture: CODE_FIXTURE,
      goal: GOAL_CODEX,
      timeoutMs: 16 * 60 * 1000,
    },
  ];

  for (const phase of phases) {
    console.log(`[31-REAL-GATE] start ${phase.id}`);
    const result = await spawnPhase(phase.id, phase);
    report.phases[phase.id] = result;
    report.updatedAt = new Date().toISOString();
    writeReport();
    if (!result.ok) {
      report.verdict = 'failed';
      report.uniqueBlocker = result.uniqueBlocker || `${phase.id}_failed`;
      report.failedPhase = phase.id;
      writeReport();
      console.error(JSON.stringify(report, null, 2));
      process.exit(1);
    }
    console.log(`[31-REAL-GATE] pass ${phase.id}`);
    if (String(process.env.DIGITALME_31_STOP_AFTER || '').trim() === phase.id) {
      report.verdict = 'passed_pending_cto_review';
      report.stoppedAfter = phase.id;
      report.finishedAt = new Date().toISOString();
      writeReport();
      console.log(JSON.stringify(report, null, 2));
      process.exit(0);
    }
  }

  report.verdict = 'passed_pending_cto_review';
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
