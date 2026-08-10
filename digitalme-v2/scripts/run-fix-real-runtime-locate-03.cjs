/**
 * FIX-REAL-RUNTIME-LOCATE-03 — 真实产品确认卡调用链回归（非仅 hook 注入）。
 * 走 createDigitalMeRuntime → submitTask → needsExecutionConfirm，
 * 与 job-runner 确认前 understanding + asReadOnlyLocateHook 同路径。
 *
 * 用法（在 digitalme-v2 下）：
 *   set DIGITALME_READONLY_CODEX_LOCATE=1
 *   set DIGITALME_LOCATE03_TARGET=D:\Projects\MUHUB
 *   node scripts/run-fix-real-runtime-locate-03.cjs
 *
 * 不修改目标仓；证据写 TEMP。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const TARGET = String(
  process.env.DIGITALME_LOCATE03_TARGET || 'D:\\Projects\\MUHUB',
).trim();
const GOAL =
  process.env.DIGITALME_LOCATE03_GOAL ||
  'MUHUB 的展示页面比较模板化，请从专业产品设计和用户体验角度优化页面，使信息层级更清晰、视觉呈现更有品质，同时保持现有核心功能正常。请先理解现有实现并提出方案，再进行修改。';
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-locate03-runtime-'));

function porcelain(cwd) {
  const r = spawnSync('git', ['status', '--porcelain'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
  });
  return String(r.stdout || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function isNoise(p) {
  const base = path.posix.basename(String(p || '')).toLowerCase();
  return base === 'package.json' || base === 'readme.md' || base === 'readme';
}

async function main() {
  if (!fs.existsSync(TARGET)) {
    throw new Error(`target missing: ${TARGET}`);
  }
  if (process.env.NODE_TEST_CONTEXT) {
    throw new Error('Refuse: NODE_TEST_CONTEXT set; this script must run real Codex');
  }
  process.env.DIGITALME_READONLY_CODEX_LOCATE = '1';

  const { createDigitalMeRuntime } = require(path.join(
    root,
    'dist/runtime/digitalme-runtime',
  ));
  const {
    READONLY_CODEX_LOCATE_TIMEOUT_MS,
  } = require(path.join(root, 'dist/execution/software-readonly-codex-locate'));

  const before = porcelain(TARGET);
  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-locate03-pkg-'));
  const rt = createDigitalMeRuntime({
    documentCapability: 'fake',
    codeAnalysisCapability: 'none',
    // 无 executeHook：与产品确认卡一致注入真实 readOnlyLocate
    externalExecutorCapability: { forceAvailability: 'ready' },
  });
  await rt.createPackage({ displayName: 'locate03', targetDir: pkg });

  const t0 = Date.now();
  const result = await rt.submitTask({
    goal: GOAL,
    contextRefs: [{ kind: 'folder', path: TARGET }],
  });
  const ms = Date.now() - t0;
  const after = porcelain(TARGET);
  const newDirty = after.filter((l) => !before.includes(l));

  const confirm = result.needsExecutionConfirm || null;
  const summary = (confirm && confirm.understandingSummary) || [];
  const reliable = confirm ? confirm.understandingReliable !== false : false;
  const summaryText = summary.join('\n');
  const hasNoiseOnlyCore =
    /将重点查看：.*package\.json/i.test(summaryText) ||
    (/package\.json/i.test(summaryText) &&
      !/app\/|components\//i.test(summaryText));
  const hasPageImpl =
    /app\/page\.tsx|components\/home\/|components\/layout\/|globals\.css|project-card/i.test(
      summaryText,
    );
  const unreliableCopy =
    !reliable && /尚未定位到可靠改动位置/.test(summaryText + (confirm?.title || ''));
  const pass =
    !!confirm &&
    newDirty.length === 0 &&
    !hasNoiseOnlyCore &&
    ((reliable && hasPageImpl) || unreliableCopy === false) &&
    reliable === true &&
    hasPageImpl &&
    READONLY_CODEX_LOCATE_TIMEOUT_MS >= 120_000;

  const report = {
    ok: pass,
    outDir: OUT,
    target: TARGET,
    timeoutMs: READONLY_CODEX_LOCATE_TIMEOUT_MS,
    ms,
    reliable,
    title: confirm?.title || null,
    notice: confirm?.notice || null,
    understandingSummary: summary,
    understandingReliable: confirm?.understandingReliable,
    newDirty,
    hasPageImpl,
    hasNoiseOnlyCore,
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!pass) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
