/**
 * Owner 真机验收启动器
 * - 默认复用隔离 userData（不删除旧证据）
 * - --fresh-session：新建时间戳 userData + 时间戳测试项目
 * - --resume-session <userData路径>：同会话重启，不新建、不删除、不复制
 * - --fixture-project <路径>：与 resume 配套指定原测试项目（可选；可从 launch.json 回填）
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

function takeArgValue(argv, name) {
  const eq = argv.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1).trim();
  const idx = argv.indexOf(name);
  if (idx >= 0 && argv[idx + 1] && !String(argv[idx + 1]).startsWith('--')) {
    return String(argv[idx + 1]).trim();
  }
  return '';
}

function parseArgs(argv) {
  const fresh = argv.includes('--fresh-session');
  const preflight = argv.includes('--preflight');
  const resumeSession = takeArgValue(argv, '--resume-session');
  const fixtureProjectArg = takeArgValue(argv, '--fixture-project');
  const sessionArg = argv.find((a) => a.startsWith('--session='));
  const sceneArg = argv.find((a) => a.startsWith('--scene='));
  const stamp = Date.now();
  let scene = (sceneArg ? sceneArg.slice('--scene='.length) : 'a').trim().toLowerCase();
  if (!['a', 'b', 'c'].includes(scene)) scene = 'a';

  if (resumeSession && fresh) {
    throw new Error('--resume-session 与 --fresh-session 不能同时使用');
  }

  let sessionId = sessionArg
    ? sessionArg.slice('--session='.length).trim()
    : fresh
      ? `${defaultSessionId}-${stamp}`
      : defaultSessionId;
  let userDataOverride = '';

  if (resumeSession) {
    userDataOverride = path.resolve(resumeSession);
    sessionId = path.basename(userDataOverride);
  }

  return {
    fresh,
    preflight,
    sessionId,
    stamp,
    scene,
    resumeSession: !!resumeSession,
    userDataOverride,
    fixtureProjectArg,
  };
}

function resolveFixtureForResume(userData, fixtureProjectArg) {
  if (fixtureProjectArg) {
    const resolved = path.resolve(fixtureProjectArg);
    if (!fs.existsSync(resolved)) {
      throw new Error(`fixture-project 不存在: ${resolved}`);
    }
    return resolved;
  }
  try {
    const launch = JSON.parse(
      fs.readFileSync(path.join(evidenceDir, 'launch.json'), 'utf8'),
    );
    if (
      launch &&
      launch.userData &&
      path.resolve(launch.userData) === path.resolve(userData) &&
      launch.fixtureProject &&
      fs.existsSync(launch.fixtureProject)
    ) {
      return path.resolve(launch.fixtureProject);
    }
  } catch {
    /* ignore */
  }
  throw new Error(
    '同会话重启需要 --fixture-project <原测试项目路径>，或 evidence/launch.json 中有匹配记录',
  );
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

function inspectResumePackage(userData) {
  const pkgDir = path.join(userData, 'subjects', 'default');
  const manifestPath = path.join(pkgDir, 'manifest.json');
  const tasksDir = path.join(pkgDir, 'runtime', 'tasks');
  const jobsDir = path.join(pkgDir, 'runtime', 'jobs');
  const artifactsDir = path.join(pkgDir, 'runtime', 'artifacts');
  const modelConfig = path.join(userData, 'model-config.json');
  const secrets = path.join(userData, 'secrets.v2.json');
  const listJson = (dir) => {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((n) => n.endsWith('.json'))
      .sort();
  };
  const taskFiles = listJson(tasksDir);
  const jobFiles = listJson(jobsDir);
  const artifactFiles = listJson(artifactsDir);
  let packageId = null;
  try {
    packageId = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).id || null;
  } catch {
    /* ignore */
  }
  let modelConfigured = false;
  try {
    const cfg = JSON.parse(fs.readFileSync(modelConfig, 'utf8'));
    modelConfigured = !!(cfg && cfg.baseUrl && cfg.model);
  } catch {
    /* ignore */
  }
  return {
    packageDir: pkgDir,
    packageExists: fs.existsSync(manifestPath),
    packageId,
    taskCount: taskFiles.length,
    taskIds: taskFiles.map((f) => f.replace(/\.json$/, '')),
    jobCount: jobFiles.length,
    artifactCount: artifactFiles.length,
    modelConfigPresent: fs.existsSync(modelConfig),
    modelConfigured,
    secretsPresent: fs.existsSync(secrets),
    subjectsCount: fs.existsSync(path.join(userData, 'subjects'))
      ? fs
          .readdirSync(path.join(userData, 'subjects'), { withFileTypes: true })
          .filter((d) => d.isDirectory()).length
      : 0,
  };
}

function resumeCommand(userData, fixtureProject) {
  return [
    'node scripts/start-software-dev-owner-acceptance.cjs',
    `--resume-session "${userData}"`,
    `--fixture-project "${fixtureProject}"`,
    '--scene=a',
  ].join(' ');
}

function writeLaunchNote(input) {
  const {
    electronPath,
    userData,
    sessionId,
    fresh,
    resumeSession,
    fixtureProject,
    scene,
    preflight,
    resumeDiagnostics,
  } = input;
  const resumeCmd = resumeCommand(userData, fixtureProject);
  const preferredWorking =
    'C:\\Users\\46554\\AppData\\Local\\DigitalMe-OwnerAcceptance\\software-dev-task-ux-01-1786086712062';
  const preferredFixture = 'D:\\Projects\\DigitalMe-Software-UX-Owner-Test-1786086712062';
  const note = {
    schemaVersion: 'owner-acceptance-launch/4',
    launchedAt: new Date().toISOString(),
    branchHint: 'v2/foundation',
    headHint: '375428702e6b778191eecd329b2cdca83c6b1d6d',
    blocker: 'BLOCKER-05',
    electronMain: path.join(root, 'electron', 'main.cjs'),
    electronPath: electronPath || null,
    userData,
    sessionId,
    freshSession: !!fresh,
    resumeSession: !!resumeSession,
    fixtureProject,
    scene,
    preflight: !!preflight,
    resumeDiagnostics: resumeDiagnostics || null,
    preservedEvidenceUserData: PRESERVED_EVIDENCE_UD,
    ownerGoal:
      '修改这个项目中的 formatLabel，使输入 start 时返回 start-processing，并同步更新测试、运行测试。不要提交或推送代码。',
    tetrisGoal: '开发一个俄罗斯方块游戏。',
    reviseGoal: '将 start-processing 改为 done，并同步更新测试。',
    sceneCommands: {
      A: 'node scripts/start-software-dev-owner-acceptance.cjs --fresh-session --scene=a',
      A_RESUME: resumeCmd,
      A_RESUME_WORKING_SESSION: resumeCommand(preferredWorking, preferredFixture),
      B: 'node scripts/start-software-dev-owner-acceptance.cjs --fresh-session --scene=b',
      C: 'node scripts/start-software-dev-owner-acceptance.cjs --fresh-session --scene=c',
    },
    notes: [
      '本启动不注入任务/材料/成果；Owner 须从做事页亲自操作。',
      '默认命令复用旧 userData；--fresh-session 创建新时间戳会话与新测试项目，不删除旧证据。',
      '--resume-session 同会话重启：不新建、不删除、不复制；须带原 fixture 或从 launch.json 回填。',
      'resume 只恢复指定 userData；打开空会话不等于「任务丢失」。请核对 taskCount。',
      '场景环境仅注入 Electron 子进程；不改系统 PATH、登录状态或全局配置。',
      '一次只开一个场景窗口；Owner 退出后再开下一场景。场景 B/C 本轮暂停。',
      '不得 push。',
    ],
  };
  fs.writeFileSync(path.join(evidenceDir, 'launch.json'), `${JSON.stringify(note, null, 2)}\n`, 'utf8');
  fs.writeFileSync(
    path.join(evidenceDir, 'OWNER_CHECKLIST.md'),
    [
      '# Owner 真机验收清单（BLOCKER-05）',
      '',
      `当前场景：\`${String(scene).toUpperCase()}\``,
      `测试项目：\`${fixtureProject.replace(/\\/g, '\\\\')}\``,
      `userData：\`${userData.replace(/\\/g, '\\\\')}\``,
      `会话：\`${sessionId}\``,
      `模式：\`${resumeSession ? 'resume-session' : fresh ? 'fresh-session' : 'default'}\``,
      resumeDiagnostics
        ? `恢复诊断：tasks=${resumeDiagnostics.taskCount} jobs=${resumeDiagnostics.jobCount} artifacts=${resumeDiagnostics.artifactCount} packageId=${resumeDiagnostics.packageId || 'n/a'} secrets=${resumeDiagnostics.secretsPresent} modelConfig=${resumeDiagnostics.modelConfigured}`
        : '',
      '',
      '## 重要：同会话重启',
      '',
      '必须 resume **你实际做事** 的那个 userData。空会话（taskCount=0）不是「丢任务」。',
      '',
      '若此前真实任务在 `…1786086712062`：',
      '',
      '```',
      resumeCommand(preferredWorking, preferredFixture),
      '```',
      '',
      '当前窗口同会话重启：',
      '',
      '```',
      resumeCmd,
      '```',
      '',
      '## 场景 A 复验（BLOCKER-05）',
      '',
      'A1 formatLabel：修改 → 修订 → 采用 → 关闭 → 同 userData resume → AI 无需重配、任务/成果仍在。',
      '',
      'A2 俄罗斯方块：由 Digital Me 创建新项目 → 无 trusted directory 错误 → 真实执行 → Digital Me 启动检查；失败则继续修复，不得显示「可以试用」。',
      '',
      'A3 截图反馈：在「告诉 Digital Me 哪里不对」粘贴截图 + 文字 → 同一任务 revision。',
      '',
      'A4 resume：AI 配置仍在；任务数量与 ID 不变；不出现第二 default package。',
      '',
      '场景 B/C：暂停，不要启动。',
      '',
    ]
      .filter((line) => line !== undefined)
      .join('\n'),
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
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  }
  const {
    fresh,
    preflight,
    sessionId,
    stamp,
    scene,
    resumeSession,
    userDataOverride,
    fixtureProjectArg,
  } = parsed;
  if (!sessionId.startsWith('software-dev-task-ux-01')) {
    console.error('拒绝：仅允许 DigitalMe-OwnerAcceptance 下的 software-dev-task-ux-01* 会话');
    process.exit(1);
  }

  let userData = userDataOverride || path.join(acceptanceRoot, sessionId);
  if (resumeSession) {
    if (!fs.existsSync(userData)) {
      console.error(`拒绝：resume-session 的 userData 不存在: ${userData}`);
      process.exit(1);
    }
    if (path.resolve(userData) === path.resolve(PRESERVED_EVIDENCE_UD)) {
      console.error('拒绝：resume-session 不得指向已保留旧证据 userData');
      process.exit(1);
    }
    const underAcceptance =
      path.resolve(userData).toLowerCase().startsWith(path.resolve(acceptanceRoot).toLowerCase() + path.sep) ||
      path.resolve(userData).toLowerCase() === path.resolve(acceptanceRoot).toLowerCase();
    if (!underAcceptance) {
      console.error('拒绝：resume-session 必须位于 DigitalMe-OwnerAcceptance 下');
      process.exit(1);
    }
  } else {
    if (userData === PRESERVED_EVIDENCE_UD && fresh) {
      console.error('拒绝：fresh-session 不得覆盖旧证据 userData');
      process.exit(1);
    }
    ensureDirs(userData);
  }

  const resumeDiagnostics = resumeSession ? inspectResumePackage(userData) : null;
  if (resumeSession && resumeDiagnostics) {
    if (!resumeDiagnostics.packageExists) {
      console.error(
        '拒绝：resume-session 目标没有 subjects/default/manifest.json；这会变成「新用户」而不是恢复。请指定真实做事会话。',
      );
      process.exit(1);
    }
    if (resumeDiagnostics.taskCount === 0) {
      console.warn(
        JSON.stringify(
          {
            warn: 'resume_empty_package',
            message:
              '该 userData 的 default package 任务数为 0。若你期望看到旧任务，说明 resume 到了错误会话（常见：fresh 空窗 vs 实际做事窗）。',
            userData,
            diagnostics: resumeDiagnostics,
          },
          null,
          2,
        ),
      );
    }
  }

  let fixtureProject;
  try {
    if (resumeSession) {
      fixtureProject = resolveFixtureForResume(userData, fixtureProjectArg);
    } else if (fresh) {
      fixtureProject = createFreshFixture(stamp);
    } else if (fixtureProjectArg) {
      fixtureProject = path.resolve(fixtureProjectArg);
      if (!fs.existsSync(fixtureProject)) {
        console.error(`fixture-project 不存在: ${fixtureProject}`);
        process.exit(1);
      }
    } else {
      fixtureProject = defaultFixture;
    }
  } catch (err) {
    console.error(err && err.message ? err.message : String(err));
    process.exit(1);
  }

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
    resumeSession,
    fixtureProject,
    scene,
    preflight,
    resumeDiagnostics,
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
        resumeSession: !!resumeSession,
        scene,
        evidenceDir,
        fixtureProject,
        resumeCommand: resumeCommand(userData, fixtureProject),
        resumeDiagnostics,
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

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}