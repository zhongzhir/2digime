'use strict';

/**
 * Slice 5 unified mechanical capability benchmark.
 *
 * This runner composes already accepted gates; it does not invent a second
 * product runtime or silently upgrade unsupported capability families. Each
 * command is bounded and a timed-out Windows process tree is terminated by
 * exact PID. Electron/Playwright release gates intentionally run as separate
 * top-level commands: nesting GUI lifecycles below this long-running runner
 * previously caused a false timeout despite the same formal gate passing on
 * its own. Results are written under ignored build/evidence for audit use.
 */
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'build', 'evidence', 'slice5-unified-release');
const reportFile = path.join(evidenceDir, 'mechanical-report.json');

function killTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    try { process.kill(pid, 'SIGKILL'); } catch {}
    const killer = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      shell: false,
      windowsHide: true,
      stdio: 'ignore',
    });
    const stopKiller = setTimeout(() => {
      try { killer.kill('SIGKILL'); } catch {}
    }, 5_000);
    killer.once('exit', () => clearTimeout(stopKiller));
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
}

function runProcess(name, command, args, timeoutMs, env = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd: root,
      env: { ...process.env, ...env },
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let finished = false;
    const append = (current, chunk) => `${current}${String(chunk)}`.slice(-16_000);
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      if (finished) return;
      killTree(child.pid);
    }, timeoutMs);
    child.on('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ name, ok: false, status: null, durationMs: Date.now() - startedAt, error: String(error.message || error), stdout, stderr });
    });
    child.on('exit', (code, signal) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        name,
        ok: code === 0,
        status: code,
        signal,
        durationMs: Date.now() - startedAt,
        timedOut: Date.now() - startedAt >= timeoutMs,
        stdout,
        stderr,
      });
    });
  });
}

function nodeTest(name, files, timeoutMs = 300_000) {
  return runProcess(name, process.execPath, ['--test', '--test-concurrency=1', ...files], timeoutMs);
}

async function runGate(definition) {
  console.log(`SLICE5_GATE_START ${definition.id} ${definition.label}`);
  const steps = [];
  for (const step of definition.steps) {
    const result = await step();
    steps.push(result);
    console.log(`SLICE5_STEP_${result.ok ? 'PASS' : 'FAIL'} ${definition.id} ${result.name} ${result.durationMs}ms`);
    if (!result.ok) break;
  }
  const mechanicalPass = steps.length === definition.steps.length && steps.every((step) => step.ok);
  const gate = {
    id: definition.id,
    label: definition.label,
    status: mechanicalPass ? definition.passStatus : 'fail',
    releaseLabel: definition.releaseLabel,
    reason: mechanicalPass ? definition.passReason : 'at least one required release-gate command failed',
    steps,
  };
  console.log(`SLICE5_GATE_${mechanicalPass ? 'PASS' : 'FAIL'} ${definition.id} ${gate.status}`);
  return gate;
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const definitions = [
    {
      id: 'discover', label: '发现', passStatus: 'limited', releaseLabel: 'Beta',
      passReason: '供给、连续性、当前开放链接和正式入口门通过；Owner 连续体验与观看入口仍不属于已通过范围',
      steps: [
        () => nodeTest('Discover deterministic gates', [
          'dist/runtime/tests/discover-personal-feed-01.test.js',
          'dist/runtime/tests/discover-owner-acceptance-recovery.test.js',
          'dist/subject-comm/tests/discover-candidate-reservoir.test.js',
        ]),
        () => runProcess('Discover 60-link openability', process.execPath, ['scripts/discover-stage1-link-openability-check.cjs'], 600_000),
      ],
    },
    {
      id: 'office', label: 'Word、PPT、PDF', passStatus: 'limited', releaseLabel: 'Beta',
      passReason: '30 项生成、结构、回读与逐页渲染门通过；复杂原格式编辑与市场全场景 95% 未宣称',
      steps: [() => runProcess('Office 30-task benchmark', process.execPath, ['scripts/run-office-benchmark.cjs'], 1_200_000)],
    },
    {
      id: 'local-files', label: '授权本地文件', passStatus: 'pass', releaseLabel: '可用',
      passReason: '固定 20 项路径围栏、真实读写回读、撤销与动作时确认门通过',
      steps: [() => nodeTest('Local file 20-task gate', ['dist/intelligence/tests/talk-file-workspace-20-task-gate.test.js'])],
    },
    {
      id: 'coding', label: 'Coding', passStatus: 'limited', releaseLabel: 'Beta',
      passReason: '四类固定任务同 build 双臂开发基准已达到阈值；未外推为所有工程场景 95%',
      steps: [() => nodeTest('Coding benchmark contracts', [
        'dist/capability/tests/coding-agent-benchmark-gate-01.test.js',
        'dist/capability/tests/coding-agent-benchmark-evidence-01.test.js',
        'dist/capability/tests/coding-agent-benchmark-materials-01.test.js',
        'dist/capability/tests/coding-agent-benchmark-collector-01.test.js',
      ], 360_000)],
    },
    {
      id: 'third-party', label: '第三方系统', passStatus: 'limited', releaseLabel: '有限预览',
      passReason: '统一 Connector 合同、只读外部工具和机构 OIDC 地基可验证；三类真实第三方系统闭环尚未完成',
      steps: [() => nodeTest('Third-party connector gates', [
        'dist/capability/tests/external-connector-contract.test.js',
        'dist/capability/tests/real-mcp-readonly-01.test.js',
        'dist/identity/tests/institution-federation-02.test.js',
      ])],
    },
    {
      id: 'collaboration', label: '协作', passStatus: 'limited', releaseLabel: 'Beta',
      passReason: 'Relay/E2EE、接受拒绝撤销、真实 Artifact 与 A2A 互操作通过；独立伙伴现场验收仍待完成',
      steps: [() => nodeTest('Collaboration domain and A2A gates', [
        'dist/collaboration/tests/real-subject-collaboration-02.test.js',
        'dist/collaboration/tests/a2a-subject-interop-04.test.js',
      ], 600_000)],
    },
    {
      id: 'automation', label: '自动化', passStatus: 'limited', releaseLabel: '有限预览',
      passReason: '机构事件人在环与低风险本机成果自动链各连续 10 次通过；联网、外发、付费、删除和权限变化未开放',
      steps: [() => nodeTest('Automation ten-run gates', [
        'dist/automation/tests/automation-natural-language-ten-run-slice3c.test.js',
        'dist/automation/tests/automation-low-risk-auto-ten-run-slice3d.test.js',
      ])],
    },
    {
      id: 'institution-sandbox', label: '机构伙伴沙箱', passStatus: 'limited', releaseLabel: '伙伴沙箱',
      passReason: '机构、两测试用户、权益、服务、两条合成旅程与隐私边界通过；不代表真实银行电信生产接入',
      steps: [() => runProcess('Partner sandbox control plane', process.execPath, ['institution/partner-sandbox/run-verify.cjs'], 300_000), () => runProcess('Synthetic institution journeys', process.execPath, ['institution/partner-sandbox/run-journeys.cjs'], 900_000)],
    },
  ];

  const gates = [];
  for (const definition of definitions) gates.push(await runGate(definition));
  const failures = gates.filter((gate) => gate.status === 'fail');
  const report = {
    schemaVersion: 1,
    scope: 'SLICE_5_MECHANICAL_CAPABILITY_FAMILIES_ONLY',
    generatedAt: new Date().toISOString(),
    gitHead: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', shell: false }).stdout.trim(),
    verdict: failures.length === 0 ? 'SLICE_5_MECHANICAL_BENCHMARK_PASS_WITH_DECLARED_LIMITS' : 'SLICE_5_MECHANICAL_BENCHMARK_FAIL',
    independentReleaseGates: [
      'npm run preflight:electron',
      'discover-ui-chain-01.electron.test.js',
      'office-artifact-slice2a.electron.test.js',
      'file-workspace-slice2b.electron.test.js',
      'digital-self-collaboration-controls-slice3b.electron.test.js',
      'digital-self-automation-projection-slice3c.electron.test.js',
      'digital-self-institution-projection-slice4a.electron.test.js',
    ],
    gates,
  };
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ verdict: report.verdict, reportFile: path.relative(root, reportFile), gates: gates.map(({ id, status, releaseLabel }) => ({ id, status, releaseLabel })) }, null, 2));
  if (failures.length > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
