/**
 * FIX-RETURN-EDIT-ACTION-04 — 真实产品链：确认 → 返回修改语义 → 再提交。
 * 验证 Runtime 不提前建任务；材料路径保留；新目标进入新确认卡。
 * 不修改目标仓。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const TARGET = String(process.env.DIGITALME_RETURN_EDIT_TARGET || '').trim();
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-return-edit-04-'));

function porcelain(cwd) {
  if (!cwd || !fs.existsSync(cwd)) return [];
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

async function main() {
  const { createDigitalMeRuntime } = require(path.join(
    root,
    'dist/runtime/digitalme-runtime',
  ));
  const ux = require(path.join(root, 'electron/renderer/work-ux-stage.js'));
  const appSrc = fs.readFileSync(path.join(root, 'electron/renderer/app.js'), 'utf8');

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-ret-fx-'));
  fs.mkdirSync(path.join(fixture, 'app'), { recursive: true });
  fs.writeFileSync(path.join(fixture, 'package.json'), '{"name":"fx"}');
  fs.writeFileSync(
    path.join(fixture, 'app', 'page.tsx'),
    'export default function Page(){return null}\n',
  );

  const beforeTarget = TARGET ? porcelain(TARGET) : [];
  const workDir = TARGET && fs.existsSync(TARGET) ? TARGET : fixture;

  const pkg = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-ret-rt-pkg-'));
  const rt = createDigitalMeRuntime({
    documentCapability: 'fake',
    codeAnalysisCapability: 'none',
    externalExecutorCapability: {
      forceAvailability: 'ready',
      executeHook: async () => ({ exitCode: 0, summary: 'ok' }),
    },
  });
  await rt.createPackage({ displayName: 'return-edit', targetDir: pkg });

  const goal1 = '修改这个项目中的展示页面信息层级';
  const first = await rt.submitTask({
    goal: goal1,
    contextRefs: [{ kind: 'folder', path: workDir }],
  });
  if (!first.needsExecutionConfirm) throw new Error('expected first confirm');

  // UI 派生：确认中无开始处理；返回后有
  const confirmView = ux.deriveWorkUxView({
    workMode: 'compose',
    executionConfirmCard: true,
    understandingReliable: first.needsExecutionConfirm.understandingReliable !== false,
  });
  const returnView = ux.deriveWorkUxView({
    workMode: 'compose',
    executionConfirmCard: false,
    jobStatus: null,
    hasArtifact: false,
  });
  if (!returnView.actions.some((a) => a.id === 'start_submit')) {
    throw new Error('start_submit missing after return-edit facts');
  }

  const goal2 = '修改这个项目中的展示页面视觉品质并保持核心功能';
  const second = await rt.submitTask({
    goal: goal2,
    contextRefs: [{ kind: 'folder', path: workDir }],
  });
  if (!second.needsExecutionConfirm) throw new Error('expected second confirm');
  if (second.taskId || second.jobId) throw new Error('must not create task/job before confirm');

  const tasks = await rt.listTasks({ limit: 20 });
  const afterTarget = TARGET ? porcelain(TARGET) : [];
  const newDirty = afterTarget.filter((l) => !beforeTarget.includes(l));

  const wiringOk =
    /function returnFromExecutionConfirmToEdit/.test(appSrc) &&
    /cancelExecution[\s\S]{0,500}returnFromExecutionConfirmToEdit/.test(appSrc);

  const report = {
    ok:
      wiringOk &&
      confirmView.stage === 'needs_confirmation' &&
      returnView.stage === 'drafting' &&
      !!returnView.actions.find((a) => a.id === 'start_submit') &&
      first.taskId === '' &&
      second.taskId === '' &&
      (tasks.tasks || []).length === 0 &&
      newDirty.length === 0 &&
      path.resolve(second.needsExecutionConfirm.workingDirectory) === path.resolve(workDir),
    outDir: OUT,
    workDir,
    usedExternalTarget: !!(TARGET && workDir === TARGET),
    wiringOk,
    confirmStage: confirmView.stage,
    returnStage: returnView.stage,
    startSubmitLabel: returnView.actions.find((a) => a.id === 'start_submit')?.label || null,
    firstGoal: goal1,
    secondGoal: goal2,
    taskCount: (tasks.tasks || []).length,
    newDirty,
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
