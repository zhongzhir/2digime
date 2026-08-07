/**
 * Owner 真机验收启动器 — SOFTWARE-DEVELOPMENT-TASK-OWNER-ACCEPTANCE-01
 * - 默认复用隔离 userData（不删除旧证据）
 * - --fresh-session：新建时间戳 userData + 时间戳测试项目（不覆盖旧目录）
 * - 不注入任务/材料/成果
 */
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'scripts', '_software-dev-task-owner-acceptance-01-evidence');
const acceptanceRoot = path.join(
  os.homedir(),
  'AppData',
  'Local',
  'DigitalMe-OwnerAcceptance',
);
const defaultSessionId = 'software-dev-task-ux-01';
const defaultFixture = 'D:\\Projects\\DigitalMe-Software-UX-Owner-Test';

function parseArgs(argv) {
  const fresh = argv.includes('--fresh-session');
  const sessionArg = argv.find((a) => a.startsWith('--session='));
  const stamp = Date.now();
  const sessionId = sessionArg
    ? sessionArg.slice('--session='.length).trim()
    : fresh
      ? `${defaultSessionId}-${stamp}`
      : defaultSessionId;
  return { fresh, sessionId, stamp };
}

function createFreshFixture(stamp) {
  const fixtureRoot = path.join('D:\\Projects', `DigitalMe-Software-UX-Owner-Test-${stamp}`);
  fs.mkdirSync(fixtureRoot, { recursive: true });
  fs.writeFileSync(
    path.join(fixtureRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'digitalme-software-ux-owner-test',
        version: '1.0.0',
        private: true,
        main: 'index.js',
        scripts: { test: 'node test.js' },
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(fixtureRoot, 'index.js'),
    [
      '/**',
      ' * Minimal label formatter for Owner acceptance fixture.',
      ' */',
      'function formatLabel(input) {',
      "  return String(input ?? '');",
      '}',
      '',
      'module.exports = { formatLabel };',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.writeFileSync(
    path.join(fixtureRoot, 'test.js'),
    [
      "const { formatLabel } = require('./index.js');",
      '',
      'function assertEqual(actual, expected, label) {',
      '  if (actual !== expected) {',
      '    console.error(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);',
      '    process.exitCode = 1;',
      '    return;',
      '  }',
      '  console.log(`ok ${label}`);',
      '}',
      '',
      "assertEqual(formatLabel('start'), 'start', 'formatLabel(start)');",
      "assertEqual(formatLabel('other'), 'other', 'formatLabel(other)');",
      'if (process.exitCode) process.exit(process.exitCode);',
      "console.log('All tests passed.');",
      '',
    ].join('\n'),
    'utf8',
  );
  spawnSync('git', ['init'], { cwd: fixtureRoot, stdio: 'ignore', shell: false });
  spawnSync('git', ['add', '.'], { cwd: fixtureRoot, stdio: 'ignore', shell: false });
  spawnSync(
    'git',
    ['-c', 'user.email=owner@local', '-c', 'user.name=Owner', 'commit', '-m', 'baseline'],
    { cwd: fixtureRoot, stdio: 'ignore', shell: false },
  );
  return fixtureRoot;
}

function ensureDirs(userData) {
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
}

function build() {
  const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc');
  const r = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.json'], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

function writeLaunchNote(electronPath, userData, sessionId, fresh, fixtureProject) {
  const note = {
    schemaVersion: 'owner-acceptance-launch/1',
    launchedAt: new Date().toISOString(),
    branchHint: 'v2/foundation',
    headHint: '531b71de01e847ada54a702ca2c25ed5e558d9bb',
    electronMain: path.join(root, 'electron', 'main.cjs'),
    electronPath,
    userData,
    sessionId,
    freshSession: !!fresh,
    fixtureProject,
    preservedEvidenceUserData:
      'C:\\Users\\46554\\AppData\\Local\\DigitalMe-OwnerAcceptance\\software-dev-task-ux-01',
    ownerGoal:
      '修改这个项目中的 formatLabel，使输入 start 时返回 start-processing，并同步更新测试、运行测试。不要提交或推送代码。',
    tetrisGoal: '开发一个俄罗斯方块游戏。',
    reviseGoal: '将 start-processing 改为 done，并同步更新测试。',
    notes: [
      '本启动不注入任务/材料/成果；Owner 须从做事页亲自操作。',
      '默认命令复用旧 userData；--fresh-session 创建新时间戳会话与新测试项目，不删除旧证据。',
      '不得 push 测试仓库；不得 commit Digital Me 本任务改动，除非 Owner 另行授权。',
    ],
  };
  fs.writeFileSync(path.join(evidenceDir, 'launch.json'), `${JSON.stringify(note, null, 2)}\n`, 'utf8');
  fs.writeFileSync(
    path.join(evidenceDir, 'OWNER_CHECKLIST.md'),
    [
      '# Owner 真机验收清单（BLOCKER-03）',
      '',
      `测试项目：\`${fixtureProject.replace(/\\/g, '\\\\')}\``,
      `userData：\`${userData.replace(/\\/g, '\\\\')}\``,
      `会话：\`${sessionId}\``,
      '',
      '## 复验路径',
      '',
      '1. 任务 A：修改 formatLabel → 确认 → 执行 → 提出修改改为 done → 采用',
      '2. 新建任务 B：开发一个俄罗斯方块游戏（先不选目录）→ 应提示选择项目位置，且不得显示 A 的成果',
      '3. 为 B 选择空文件夹 → 确认 → 执行 → 独立成果',
      '4. 在 A/B 间切换，成果不得串线',
      '5. 核对 Digital Me 检查结果摘要后再采用',
      '6. 重启后任务数量与成果绑定仍正确',
      '',
      '## 启动',
      '',
      '```',
      'node scripts/start-software-dev-owner-acceptance.cjs --fresh-session',
      '```',
      '',
    ].join('\n'),
    'utf8',
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        userData,
        sessionId,
        freshSession: !!fresh,
        evidenceDir,
        fixtureProject,
      },
      null,
      2,
    ),
  );
}

function main() {
  const { fresh, sessionId, stamp } = parseArgs(process.argv.slice(2));
  if (!sessionId.startsWith('software-dev-task-ux-01')) {
    console.error('拒绝：仅允许 DigitalMe-OwnerAcceptance 下的 software-dev-task-ux-01* 会话');
    process.exit(1);
  }
  const userData = path.join(acceptanceRoot, sessionId);
  ensureDirs(userData);
  const fixtureProject = fresh ? createFreshFixture(stamp) : defaultFixture;
  build();
  let electronPath;
  try {
    electronPath = require('electron');
  } catch {
    console.error('electron 未安装');
    process.exit(1);
  }
  if (typeof electronPath !== 'string') {
    console.error('require(electron) 未返回可执行路径');
    process.exit(1);
  }
  writeLaunchNote(electronPath, userData, sessionId, fresh, fixtureProject);
  const mainEntry = path.join(root, 'electron', 'main.cjs');
  const child = spawn(electronPath, [`--user-data-dir=${userData}`, mainEntry], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      DIGITALME_V2_ROOT: root,
    },
  });
  child.on('exit', (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code || 0);
  });
  child.on('error', (err) => {
    console.error('启动失败:', err.message);
    process.exit(1);
  });
}

main();
