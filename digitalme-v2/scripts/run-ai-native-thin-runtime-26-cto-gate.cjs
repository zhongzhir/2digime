/**
 * 2DIGIME-AI-NATIVE-THIN-RUNTIME-26
 * CTO 核对：三个不同自然语言任务的自主理解与执行质量（脚本化模型 + 薄主链确定性断言）。
 * 不启动 Owner 真机；不合并；不部署；不碰 MUHUB。
 */
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'scripts', '_ai-native-thin-runtime-26-evidence');
fs.mkdirSync(EVIDENCE, { recursive: true });

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    ...opts,
  });
  return r;
}

const tsc = run('npx', ['tsc', '-p', 'tsconfig.json', '--pretty', 'false']);
if (tsc.status !== 0) {
  fs.writeFileSync(
    path.join(EVIDENCE, 'GATE_SUMMARY.json'),
    JSON.stringify(
      {
        ok: false,
        step: 'tsc',
        status: tsc.status,
        stderr: String(tsc.stderr || '').slice(0, 4000),
        stdout: String(tsc.stdout || '').slice(0, 2000),
      },
      null,
      2,
    ),
  );
  console.error(tsc.stdout || '');
  console.error(tsc.stderr || '');
  process.exit(tsc.status || 1);
}

const testFile = path.join(ROOT, 'dist', 'work-runtime', 'tests', 'ai-native-thin-runtime-26.test.js');
const test = run(process.execPath, ['--test', '--test-concurrency=1', testFile], {
  env: { ...process.env, DIGITALME_THIN_OWNER_RUNTIME: '1' },
});
const out = `${test.stdout || ''}\n${test.stderr || ''}`;
fs.writeFileSync(path.join(EVIDENCE, 'CTO_THREE_NL_TASKS.txt'), out.slice(0, 20000));

const passed = /# pass/.test(out) || /tests\s+\d+/.test(out);
const failed = test.status !== 0;
const summary = {
  ok: !failed,
  headNote: 'CTO three-NL-task check for thin runtime 26; Owner runtime must not start until this passes',
  ownerRuntime: 'not_started',
  merge: 'forbidden',
  deploy: 'forbidden',
  muhub: 'untouched',
  nlTasks: [
    '通读仓库文件，让 formatLabel 在输入 start 时返回 start-processing 并跑测试',
    '给这个小项目加一个简单的帮助说明，写在 README 里',
    '先看一下项目现在怎么组织的，然后把页面标题改成欢迎使用',
  ],
  testStatus: test.status,
  stdoutTail: out.slice(-3000),
};

fs.writeFileSync(path.join(EVIDENCE, 'GATE_SUMMARY.json'), JSON.stringify(summary, null, 2));
console.log(out);
if (failed) {
  console.error('CTO thin-runtime-26 gate failed; do not start Owner runtime.');
  process.exit(test.status || 1);
}
console.log('CTO thin-runtime-26 gate passed. Owner runtime remains blocked.');
process.exit(0);
