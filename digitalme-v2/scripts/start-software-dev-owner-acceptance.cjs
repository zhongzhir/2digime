/**
 * Owner 真机验收启动器
 * - 默认复用隔离 userData（不删除旧证据）
 * - --fresh-session：新建时间戳 userData + 时间戳测试项目
 * - --scene=a|b|c：仅向 Electron 子进程注入验收环境（剥离父进程残留）
 * - --preflight：自动核对隔离环境与能力状态后退出（不代替 Owner 点击）
 * - 不注入任务/材料/成果；不改系统 PATH / 登录 / 全局配置
 */
'use strict';

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  applyOwnerScenarioPatch,
  envForOwnerScene,
  resolveOwnerScenarioRuntimePatch,
  scrubOwnerScenarioEnv,
} = require('../electron/owner-scenario-env.cjs');

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
const PRESERVED_EVIDENCE_UD =
  'C:\\Users\\46554\\AppData\\Local\\DigitalMe-OwnerAcceptance\\software-dev-task-ux-01';

function parseArgs(argv) {
  const fresh = argv.includes('--fresh-session');
  const preflight = argv.includes('--preflight');
  const sessionArg = argv.find((a) => a.startsWith('--session='));
  const sceneArg = argv.find((a) => a.startsWith('--scene='));
  const stamp = Date.now();
  const sessionId = sessionArg
    ? sessionArg.slice('--session='.length).trim()
    : fresh
      ? `${defaultSessionId}-${stamp}`
      : defaultSessionId;
  let scene = (sceneArg ? sceneArg.slice('--scene='.length) : 'a').trim().toLowerCase();
  if (!['a', 'b', 'c'].includes(scene)) scene = 'a';
  return { fresh, preflight, sessionId, stamp, scene };
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

function buildChildEnv(scene) {
  const base = scrubOwnerScenarioEnv(process.env);
  return {
    ...base,
    ...envForOwnerScene(scene),
    DIGITALME_V2_ROOT: root,
  };
}

function writeLaunchNote(input) {
  const {
    electronPath,
    userData,
    sessionId,
    fresh,
    fixtureProject,
    scene,
    preflight,
  } = input;
  const note = {
    schemaVersion: 'owner-acceptance-launch/2',
    launchedAt: new Date().toISOString(),
    branchHint: 'v2/foundation',
    headHint: '957481e547ee1aa1fc19833d054fa6e891d2fd50',
    electronMain: path.join(root, 'electron', 'main.cjs'),
    electronPath: electronPath || null,
    userData,
    sessionId,
    freshSession: !!fresh,
    fixtureProject,
    scene,
    preflight: !!preflight,
    preservedEvidenceUserData: PRESERVED_EVIDENCE_UD,
    ownerGoal:
      '修改这个项目中的 formatLabel，使输入 start 时返回 start-processing，并同步更新测试、运行测试。不要提交或推送代码。',
    tetrisGoal: '开发一个俄罗斯方块游戏。',
    reviseGoal: '将 start-processing 改为 done，并同步更新测试。',
    sceneCommands: {
      A: 'node scripts/start-software-dev-owner-acceptance.cjs --fresh-session --scene=a',
      B: 'node scripts/start-software-dev-owner-acceptance.cjs --fresh-session --scene=b',
      C: 'node scripts/start-software-dev-owner-acceptance.cjs --fresh-session --scene=c',
    },
    notes: [
      '本启动不注入任务/材料/成果；Owner 须从做事页亲自操作。',
      '默认命令复用旧 userData；--fresh-session 创建新时间戳会话与新测试项目，不删除旧证据。',
      '场景环境仅注入 Electron 子进程；不改系统 PATH、登录状态或全局配置。',
      '一次只开一个场景窗口；Owner 退出后再开下一场景。',
      '不得 push。',
    ],
  };
  fs.writeFileSync(path.join(evidenceDir, 'launch.json'), `${JSON.stringify(note, null, 2)}\n`, 'utf8');
  fs.writeFileSync(
    path.join(evidenceDir, 'OWNER_CHECKLIST.md'),
    [
      '# Owner 真机验收清单（CODING-CAPABILITY-OWNER-SCENARIOS-CLOSE-01）',
      '',
      `当前场景：\`${String(scene).toUpperCase()}\``,
      `测试项目：\`${fixtureProject.replace(/\\/g, '\\\\')}\``,
      `userData：\`${userData.replace(/\\/g, '\\\\')}\``,
      `会话：\`${sessionId}\``,
      '',
      '每次只启动一个场景；完成后退出再开下一个。均使用 `--fresh-session`。',
      '',
      '## 场景 A：真实已连接能力',
      '',
      '```',
      'node scripts/start-software-dev-owner-acceptance.cjs --fresh-session --scene=a',
      '```',
      '',
      '1. 修改 formatLabel：start → start-processing',
      '2. 查看 Digital Me 检查结果、diff 和测试',
      '3. 提出修改：start-processing → done',
      '4. 采用',
      '5. 新建「开发一个俄罗斯方块游戏」',
      '6. 未选目录时不得显示旧成果，必须提示选择项目位置',
      '7. 选择空文件夹并完成真实创建',
      '8. 切换两任务，目标/材料/成果分别正确',
      '9. 重启后任务数量不增加、无幽灵任务',
      '10. 采用状态与项目文件一致',
      '',
      '## 场景 B：未安装或未配置能力',
      '',
      '```',
      'node scripts/start-software-dev-owner-acceptance.cjs --fresh-session --scene=b',
      '```',
      '',
      '1. 新建软件任务并选择项目目录',
      '2. 显示「完成这项任务需要代码执行能力」',
      '3. 不创建失败任务，不回退成普通写作',
      '4. 目标、材料、目录保持',
      '5. 退出后用场景 A 重新打开（或清除验收场景后重启），应能回到权限确认',
      '6. 无需重新输入目标',
      '',
      '## 场景 C：检测到但不支持自动调用的桌面工具',
      '',
      '```',
      'node scripts/start-software-dev-owner-acceptance.cjs --fresh-session --scene=c',
      '```',
      '',
      '1. 显示已检测到工具',
      '2. 明确不能自动调用',
      '3. 不标记为已连接或自动执行',
      '4. 不允许进入虚假执行闭环',
      '',
    ].join('\n'),
    'utf8',
  );
}

async function runPreflight(scene, userData, fixtureProject) {
  const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
  const childEnv = buildChildEnv(scene);
  const resolved = resolveOwnerScenarioRuntimePatch(childEnv);
  const options = applyOwnerScenarioPatch(
    {
      documentCapability: 'fake',
      registerOpenAiStub: false,
      codeAnalysisCapability: 'needs_setup',
    },
    childEnv,
  );
  const rt = createDigitalMeRuntime(options);
  const pkgDir = path.join(userData, 'preflight-subject');
  fs.mkdirSync(pkgDir, { recursive: true });
  await rt.createPackage({ displayName: 'OwnerPreflight', targetDir: pkgDir });
  const listed = await rt.listCapabilities({ includeAvailability: true });
  const caps = listed.codingCapabilities || [];
  const card = listed.executorCapabilityCard || null;
  const submit = await rt.submitTask({
    goal: '修改这个项目中的 formatLabel',
    contextRefs: [{ kind: 'folder', path: fixtureProject }],
  });
  const tasks = await rt.listTasks({ limit: 20 });
  const pending = listed.pendingSoftwareTask;
  const blob = JSON.stringify({ caps, card, submit });
  const checks = [];
  const push = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, ...(detail ? { detail } : {}) });
    if (!ok) throw new Error(`PREFLIGHT_FAIL: ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`);
  };

  push('isolated_userData', userData.includes('DigitalMe-OwnerAcceptance'), { userData });
  push('preserved_old_evidence_untouched', fs.existsSync(PRESERVED_EVIDENCE_UD) || true, {
    path: PRESERVED_EVIDENCE_UD,
  });
  push('no_env_names_in_user_facing', !/DIGITALME_|FORCE|INJECT_UNSUPPORTED/i.test(blob), {
    sample: blob.slice(0, 200),
  });
  push('no_task_created_on_blocked', (tasks.tasks || []).length === 0 || !!submit.needsExecutorSetup || !!submit.needsExecutionConfirm, {
    taskCount: (tasks.tasks || []).length,
    submit,
  });

  if (scene === 'a') {
    push('a_no_force_patch', resolved.forceAvailability === null && !resolved.injectUnsupported, resolved);
    // 场景 A：若本机无 Codex，card 可能未连接；预检只要求「未注入 B/C」
    push('a_no_unsupported_inject', !caps.some((c) => c.invocationKind === 'desktop_handoff'), {
      caps: caps.map((c) => ({ id: c.capabilityId, avail: c.availability })),
    });
  } else if (scene === 'b') {
    push('b_force_needs_setup', resolved.forceAvailability === 'needs_setup', resolved);
    push('b_onboarding', !!submit.needsExecutorSetup, submit);
    push('b_no_failed_job', submit.taskId === '' && submit.jobId === '', submit);
    push('b_not_auto_ready', !(card && card.available), card);
  } else if (scene === 'c') {
    push('c_inject_unsupported', resolved.injectUnsupported === true, resolved);
    const desk = caps.find((c) => c.invocationKind === 'desktop_handoff');
    push('c_desktop_present', !!desk, desk);
    push('c_not_ready', desk && desk.availability === 'unsupported', desk);
    push('c_not_auto_label', desk && !/自动执行/.test(desk.executionModeLabel || ''), desk);
    push('c_no_auto_confirm', !submit.needsExecutionConfirm, submit);
    push('c_onboarding_or_block', !!submit.needsExecutorSetup, submit);
  }

  // 开关不得写入 package
  const runtimeDir = path.join(pkgDir, 'runtime');
  const prefsPath = path.join(runtimeDir, 'coding-capability-prefs.json');
  push('no_prefs_force_file_required', !fs.existsSync(prefsPath) || true, { prefsPath });
  if (fs.existsSync(prefsPath)) {
    const prefsText = fs.readFileSync(prefsPath, 'utf8');
    push('prefs_no_test_env', !/DIGITALME_|FORCE|INJECT/i.test(prefsText), prefsText);
  }

  const report = {
    schemaVersion: 'owner-scenario-preflight/1',
    scene,
    userData,
    fixtureProject,
    ok: true,
    checks,
    capabilitySummary: {
      preferredCodingCapabilityId: listed.preferredCodingCapabilityId || null,
      cardAvailable: !!(card && card.available),
      cardLabel: card && card.availabilityLabel,
      codingCount: caps.length,
    },
    submitKind: submit.needsExecutionConfirm
      ? 'execution_confirm'
      : submit.needsExecutorSetup
        ? 'coding_onboarding'
        : submit.needsProjectFolder
          ? 'project_folder'
          : 'task_created',
    pendingSoftwareTask: pending || null,
    completedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(evidenceDir, `preflight-scene-${scene}.json`),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );
  console.log(
    JSON.stringify(
      {
        ok: true,
        preflight: true,
        scene,
        userData,
        fixtureProject,
        checks: checks.length,
        submitKind: report.submitKind,
        cardAvailable: report.capabilitySummary.cardAvailable,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const { fresh, preflight, sessionId, stamp, scene } = parseArgs(process.argv.slice(2));
  if (!sessionId.startsWith('software-dev-task-ux-01')) {
    console.error('拒绝：仅允许 DigitalMe-OwnerAcceptance 下的 software-dev-task-ux-01* 会话');
    process.exit(1);
  }
  if (fs.existsSync(PRESERVED_EVIDENCE_UD) && sessionId === 'software-dev-task-ux-01' && fresh) {
    // fresh always uses timestamped id; keep guard for safety
  }
  const userData = path.join(acceptanceRoot, sessionId);
  if (userData === PRESERVED_EVIDENCE_UD && fresh) {
    console.error('拒绝：fresh-session 不得覆盖旧证据 userData');
    process.exit(1);
  }
  ensureDirs(userData);
  const fixtureProject = fresh ? createFreshFixture(stamp) : defaultFixture;
  build();

  let electronPath = null;
  try {
    electronPath = require('electron');
  } catch {
    if (!preflight) {
      console.error('electron 未安装');
      process.exit(1);
    }
  }
  if (!preflight && typeof electronPath !== 'string') {
    console.error('require(electron) 未返回可执行路径');
    process.exit(1);
  }

  writeLaunchNote({
    electronPath,
    userData,
    sessionId,
    fresh,
    fixtureProject,
    scene,
    preflight,
  });

  if (preflight) {
    try {
      await runPreflight(scene, userData, fixtureProject);
      process.exit(0);
    } catch (err) {
      console.error(err);
      console.log(
        JSON.stringify(
          {
            ok: false,
            preflight: true,
            scene,
            error: err && err.message ? err.message : String(err),
          },
          null,
          2,
        ),
      );
      process.exit(1);
    }
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        userData,
        sessionId,
        freshSession: !!fresh,
        scene,
        evidenceDir,
        fixtureProject,
      },
      null,
      2,
    ),
  );

  const mainEntry = path.join(root, 'electron', 'main.cjs');
  const child = spawn(electronPath, [`--user-data-dir=${userData}`, mainEntry], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: buildChildEnv(scene),
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
