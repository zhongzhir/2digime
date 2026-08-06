'use strict';
/**
 * DIGITALME-V2-GUIDED-VALIDATION-READINESS-01 — 静态 + 轻量验收证据。
 * 不宣称 MVP / closed alpha / production ready。
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const evidenceDir = path.join(root, 'scripts', '_guided-validation-readiness-evidence');
fs.mkdirSync(evidenceDir, { recursive: true });

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function check(name, ok, detail) {
  return { name, ok: !!ok, detail: detail || '' };
}

const checks = [];

// --- 产品诚实性（静态） ---
const indexHtml = read('electron/renderer/index.html');
const appJs = read('electron/renderer/app.js');
const mainCjs = read('electron/main.cjs');
const secretsCjs = read('electron/bootstrap-secrets.cjs');
const remoteCjs = read('electron/bootstrap-remote-capability.cjs');

checks.push(
  check(
    'collab_experimental_label',
    /#nav-collab::after[\s\S]*?content:\s*["']实验["']/.test(
      fs.readFileSync(path.join(root, 'electron/renderer/styles.css'), 'utf8'),
    ) || /title="实验能力"/.test(indexHtml),
    'nav marks 实验 without breaking button text',
  ),
);
checks.push(
  check(
    'collab_same_device_only_copy',
    /已添加到本设备的另一个 Digital Me/.test(indexHtml) &&
      /不支持跨设备或公开网络协作/.test(indexHtml),
  ),
);
checks.push(
  check(
    'external_cap_not_on_collab_home',
    !/id="collab-external-cap-manage"/.test(indexHtml),
    'external cap manage card removed from collab home',
  ),
);
checks.push(
  check(
    'external_cap_in_settings',
    /settings-remote-cap-status/.test(indexHtml) && /专业能力/.test(indexHtml),
  ),
);
checks.push(
  check(
    'no_hardcoded_check_passed_default',
    !/检查状态：已通过/.test(indexHtml) || /external-cap-check-status"[\s\S]*?hidden/.test(indexHtml),
    'HTML default must not claim 已通过',
  ),
);
checks.push(
  check(
    'check_status_gated_in_js',
    /renderExternalCapCheckStatus/.test(appJs) &&
      /selfCheck\.passed === true/.test(appJs),
  ),
);
checks.push(
  check(
    'remote_status_labels_honest',
    /已配置，尚未验证/.test(remoteCjs) &&
      /暂时无法连接/.test(remoteCjs) &&
      /reachabilityVerified !== true/.test(remoteCjs),
  ),
);

// --- 首启 ---
checks.push(
  check(
    'welcome_model_gate_steps',
    /welcome-step-intro/.test(indexHtml) &&
      /welcome-step-model/.test(indexHtml) &&
      /welcome-step-start/.test(indexHtml) &&
      /可以先浏览，但对话和做事需要连接模型/.test(indexHtml),
  ),
);
checks.push(
  check(
    'welcome_flow_in_app',
    /initWelcomeFlow/.test(appJs) && /welcomeModelSkipped/.test(appJs),
  ),
);
checks.push(
  check(
    'no_auto_dev_credential_by_default',
    /DIGITALME_V2_ALLOW_DEV_CREDENTIAL === "1"/.test(mainCjs) &&
      /allowDevRuntimeFile !== false/.test(secretsCjs),
    'dev credential import only when env allow flag set',
  ),
);

// --- 协作恢复 ---
const collabTs = read('src/collaboration/local-collaboration.ts');
const deriveTs = read('src/collaboration/record-derive.ts');
checks.push(
  check(
    'fulfillment_job_ref_persisted',
    /note: 'job_linked'/.test(collabTs) && /jobId: submitted\.jobId/.test(collabTs),
  ),
);
checks.push(
  check(
    'recover_in_flight_on_reconcile',
    /recoverInFlightFulfillment/.test(collabTs) &&
      /recoverable_fail:/.test(collabTs),
  ),
);
checks.push(
  check(
    'derive_failed_not_stuck_running',
    /latestFulfillmentFailure/.test(deriveTs) &&
      /return 'failed'/.test(deriveTs),
  ),
);

// --- 引导脚本 ---
const scriptPath = path.join(
  root,
  'docs',
  'guided-validation',
  'DIGITALME-V2-GUIDED-VALIDATION-SCRIPT-01.md',
);
checks.push(
  check('guided_script_exists', fs.existsSync(scriptPath), scriptPath),
);

// --- 编译与协作单测 ---
const build = spawnSync('npm', ['run', 'build'], {
  cwd: root,
  encoding: 'utf8',
  shell: true,
});
checks.push(
  check('typescript_build', build.status === 0, (build.stderr || build.stdout || '').slice(-400)),
);

const unit = spawnSync(
  'node',
  [
    '--test',
    '--test-concurrency=1',
    'dist/collaboration/tests/record-derive.test.js',
    'dist/collaboration/tests/local-collaboration.test.js',
  ],
  { cwd: root, encoding: 'utf8', shell: false },
);
checks.push(
  check(
    'collab_unit_including_recovery',
    unit.status === 0,
    (unit.stdout || unit.stderr || '').slice(-800),
  ),
);

const failed = checks.filter((c) => !c.ok);
const summary = {
  task: 'DIGITALME-V2-GUIDED-VALIDATION-READINESS-01',
  goalState: 'ready_for_2_to_5_user_guided_validation',
  ok: failed.length === 0,
  checkedAt: new Date().toISOString(),
  claims: {
    mvp_ready: false,
    closed_alpha_ready: false,
    production_ready: false,
  },
  checks,
  failed: failed.map((c) => c.name),
};

fs.writeFileSync(
  path.join(evidenceDir, 'summary.json'),
  `${JSON.stringify(summary, null, 2)}\n`,
  'utf8',
);
fs.writeFileSync(
  path.join(evidenceDir, 'unit-output.txt'),
  `${unit.stdout || ''}\n${unit.stderr || ''}`,
  'utf8',
);

console.log(JSON.stringify({ ok: summary.ok, failed: summary.failed }, null, 2));
process.exit(summary.ok ? 0 : 1);
