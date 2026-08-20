/**
 * CODEX-DOING-CLOSED-LOOP-01 单测（hook 为主，不依赖真实 Codex / 网络）。
 * 覆盖：机械回复拦截、诚实失败、恢复同一 taskId、verifier 独立于 executor 自报、
 *       direct/orchestrated 记录结构、单 Coding Job 硬门、预注册测试绑定。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { waitForJobTerminal } from '../../work-runtime/job-runner';
import { verifyExternalExecution } from '../execution-verifier';
import { captureExecutionBaseline } from '../baseline';
import { collectExecutionChanges } from '../run-collector';
import {
  buildBenchmarkArmPair,
  loadP0TaskFixtures,
  computeBenchmarkMetrics,
} from '../../capability/external-connector-contract';
import { CODE_CHANGE_ARTIFACT_TYPE } from '../external-executor-contract';

const FIXTURE_P0 = path.resolve(
  __dirname,
  '../../../scripts/fixtures/external-capability-p0-tasks.json',
);
const MATERIALS_ROOT = path.resolve(
  __dirname,
  '../../../scripts/fixtures/p0-materials',
);

async function copyDir(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const names = await fs.readdir(src);
  for (const name of names) {
    const s = path.join(src, name);
    const d = path.join(dst, name);
    const st = await fs.stat(s);
    if (st.isDirectory()) await copyDir(s, d);
    else await fs.copyFile(s, d);
  }
}

function planChatHook(): (input: { messages: unknown[] }) => Promise<{ text: string }> {
  return async () => ({
    text: JSON.stringify({
      intent: 'add_goal_info',
      confidence: 0.95,
      reply: '已整理规划，确认后开始。',
      planUpdate:
        '目标：按任务要求产出实质成果\n交付：在项目目录内完成最小必要改动\n路径：项目目录\n准备：项目文件夹\n边界：不推送、不修改范围外文件',
    }),
  });
}

async function createIsolatedTriageapp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdcl-triageapp-'));
  await copyDir(path.join(MATERIALS_ROOT, 'triageapp'), dir);
  return dir;
}

async function createIsolatedPlain(repoName: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `cdcl-${repoName}-`));
  await fs.writeFile(path.join(dir, 'project-brief.md'), await fs.readFile(path.join(MATERIALS_ROOT, 'project-brief.md'), 'utf8'));
  await fs.writeFile(path.join(dir, 'owner-notes.md'), await fs.readFile(path.join(MATERIALS_ROOT, 'owner-notes.md'), 'utf8'));
  return dir;
}

function makeRuntime(opts: {
  hook: (input: {
    pkg: { workingDirectory: string; goal?: string; previousRun?: { revisionRequest?: string } };
    prompt: string;
  }) => Promise<Partial<{ exitCode: number | null; summary: string; claimedChangedFiles: string[]; testCommands: string[]; testResults: unknown[] }>>;
  converseChat?: (input: { messages: unknown[] }) => Promise<{ text: string }>;
  forceAvailability?: 'ready';
}) {
  return createDigitalMeRuntime({
    documentCapability: 'fake',
    codeAnalysisCapability: 'none',
    converseChat: opts.converseChat || planChatHook(),
    externalExecutorCapability: {
      executeHook: opts.hook as never,
      ...(opts.forceAvailability ? { forceAvailability: opts.forceAvailability } : {}),
    },
  });
}

async function planAndSubmit(opts: {
  rt: ReturnType<typeof createDigitalMeRuntime>;
  goal: string;
  repo: string;
  hook?: (input: { messages: unknown[] }) => Promise<{ text: string }>;
}) {
  const planned = await opts.rt.converse({
    text: opts.goal,
    contextRefs: [{ kind: 'folder', path: opts.repo }],
  });
  assert.ok(planned.taskId, 'converse must create a task');
  assert.ok(planned.plan?.version, 'converse must produce a plan');
  const preview = await opts.rt.submitTask({
    goal: opts.goal,
    contextRefs: [{ kind: 'folder', path: opts.repo }],
    existingTaskId: planned.taskId,
    confirmedPlanVersion: planned.plan!.version,
    intentKind: 'modify_code',
  });
  assert.ok(preview.needsExecutionConfirm, 'preview must request execution confirm');
  const started = await opts.rt.submitTask({
    goal: opts.goal,
    contextRefs: [{ kind: 'folder', path: opts.repo }],
    existingTaskId: planned.taskId,
    confirmedPlanVersion: planned.plan!.version,
    intentKind: 'modify_code',
    executionAuthorization: {
      confirmed: true,
      workingDirectory: preview.needsExecutionConfirm!.workingDirectory,
      readScope: preview.needsExecutionConfirm!.readScope,
      writeScope: preview.needsExecutionConfirm!.writeScope,
    },
  });
  assert.ok(started.taskId, 'confirmed submit must create a task');
  return { planned, preview, started };
}

describe('codex-doing-closed-loop-01', () => {
  it('arm record structure: 4 P0 tasks x 2 arms = 8 BenchmarkArmRecord', () => {
    const tasks = loadP0TaskFixtures(FIXTURE_P0);
    assert.equal(tasks.length, 4);
    const placeholders = tasks.flatMap((t) => {
      const pair = buildBenchmarkArmPair(t);
      return [pair.direct, pair.orchestrated];
    });
    assert.equal(placeholders.length, 8);
    for (const r of placeholders) {
      assert.equal(r.outcome, 'not_run');
      assert.equal(r.connectorClass, 'agent');
      assert.equal(r.adapterId, 'external-executor-codex-cli');
      assert.ok(
        ['taskId', 'arm', 'connectorClass', 'adapterId', 'budget', 'confirmationCount', 'outcome', 'falseCompletion', 'recovered', 'adoptedOnFirstAttempt', 'honestFailure'].every(
          (k) => Object.prototype.hasOwnProperty.call(r, k),
        ),
        `record must carry all required fields: ${r.taskId}/${r.arm}`,
      );
    }
    const m = computeBenchmarkMetrics(placeholders);
    assert.equal(m.denominator, 0);
    assert.equal(m.counts.notRun, 8);
  });

  it('verifier is independent of executor self-report and catches mechanical reply', async () => {
    const repo = await createIsolatedPlain('mech-unit');
    const evidence = await fs.mkdtemp(path.join(os.tmpdir(), 'cdcl-ev-'));
    try {
      // agent self-reports success + claimed files, but writes mechanical placeholder
      const baseline = await captureExecutionBaseline({
        workingDirectory: repo,
        writeScope: ['.'],
        readScope: ['.'],
        jobEvidenceDir: evidence,
      });
      await fs.writeFile(path.join(repo, 'result.txt'), 'AUTO_REPLY 任务已完成\n', 'utf8');
      const collected = await collectExecutionChanges({ baseline, jobEvidenceDir: evidence });
      const pkg = {
        taskId: 't1',
        jobId: 'j1',
        goal: '请整理已授权材料并输出要点摘要。',
        acceptanceCriteria: ['完成用户目标'],
        projectBrief: '本地项目：mech-unit',
        priorDecisions: [],
        doNotDo: [],
        workingDirectory: repo,
        readScope: ['.'],
        writeScope: ['.'],
        forbiddenOperations: [],
        contextDigest: { materialPaths: [] },
        outputContract: { requiredParts: [] },
        timeoutMs: 60000,
        executorSelectionReason: 'test',
        executorId: 'codex',
        schemaVersion: 'executor-task-package/1',
      };
      const verification = await verifyExternalExecution({
        taskPackage: pkg as never,
        agentResult: {
          executorId: 'codex',
          executorRunId: 'r1',
          startedAt: new Date().toISOString(),
          status: 'succeeded',
          summary: '任务已完成',
          claimedChangedFiles: ['result.txt'],
          testCommands: [],
          testResults: [],
          warnings: [],
          unresolvedItems: [],
          questions: [],
          exitCode: 0,
          workingDirectoryState: 'clean_within_scope',
        },
        collected,
        jobEvidenceDir: evidence,
      });
      assert.equal(verification.overall, 'unsatisfied');
      assert.ok(
        verification.checks.some((c) => c.id === 'substantive_output' && c.verdict === 'unsatisfied'),
        'substantive_output must flag mechanical reply',
      );
      assert.equal(verification.agentClaimedSuccess, true);
      assert.equal(verification.digitalMeVerified, false);

      // real change is substantive
      const repo2 = await createIsolatedPlain('real-unit');
      const evidence2 = await fs.mkdtemp(path.join(os.tmpdir(), 'cdcl-ev2-'));
      const baseline2 = await captureExecutionBaseline({
        workingDirectory: repo2,
        writeScope: ['.'],
        readScope: ['.'],
        jobEvidenceDir: evidence2,
      });
      await fs.writeFile(
        path.join(repo2, 'summary.md'),
        '# 要点摘要\n\n根据项目简报归纳的实质要点。',
        'utf8',
      );
      const collected2 = await collectExecutionChanges({ baseline: baseline2, jobEvidenceDir: evidence2 });
      const v2 = await verifyExternalExecution({
        taskPackage: pkg as never,
        agentResult: {
          executorId: 'codex',
          executorRunId: 'r2',
          startedAt: new Date().toISOString(),
          status: 'succeeded',
          summary: 'ok',
          claimedChangedFiles: ['summary.md'],
          testCommands: [],
          testResults: [],
          warnings: [],
          unresolvedItems: [],
          questions: [],
          exitCode: 0,
          workingDirectoryState: 'clean_within_scope',
        },
        collected: collected2,
        jobEvidenceDir: evidence2,
      });
      assert.notEqual(v2.overall, 'unsatisfied');
    } finally {
      await fs.rm(repo, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('verifier binds pre-registered tests (P0-triageapp-edit 对齐)', async () => {
    const repo = await createIsolatedTriageapp();
    const evidence = await fs.mkdtemp(path.join(os.tmpdir(), 'cdcl-ev3-'));
    try {
      const baseline = await captureExecutionBaseline({
        workingDirectory: repo,
        writeScope: ['.'],
        readScope: ['.'],
        jobEvidenceDir: evidence,
      });
      // simulate a real edit: update description text, keep markers intact
      const html = await fs.readFile(path.join(repo, 'triageapp.html'), 'utf8');
      await fs.writeFile(
        path.join(repo, 'triageapp.html'),
        html.replace('内容分拣工作台', '内容分拣与轻量整理工作台'),
        'utf8',
      );
      const collected = await collectExecutionChanges({ baseline, jobEvidenceDir: evidence });
      const pkg = {
        taskId: 't1',
        jobId: 'j1',
        goal: '修改 TRIAGEAPP 单文件内容分拣工作台的功能说明与一处界面文案，并在隔离副本上执行预注册测试，确认既有行为未被破坏。',
        acceptanceCriteria: ['按目标要求运行相关测试并使其通过'],
        projectBrief: '本地项目：triageapp',
        priorDecisions: [],
        doNotDo: [],
        workingDirectory: repo,
        readScope: ['.'],
        writeScope: ['.'],
        forbiddenOperations: [],
        contextDigest: { materialPaths: [] },
        outputContract: { requiredParts: [] },
        timeoutMs: 60000,
        executorSelectionReason: 'test',
        executorId: 'codex',
        schemaVersion: 'executor-task-package/1',
      };
      const base = {
        executorId: 'codex',
        executorRunId: 'r3',
        startedAt: new Date().toISOString(),
        status: 'succeeded',
        summary: 'changed description',
        claimedChangedFiles: ['triageapp.html'],
        testCommands: [],
        testResults: [],
        warnings: [],
        unresolvedItems: [],
        questions: [],
        exitCode: 0,
        workingDirectoryState: 'clean_within_scope',
      };
      // 不跑 npm：用预注册命令直接绑定（node 脚本校验 marker）
      const verifyScript = path.join(repo, 'test', 'verify-fixture.mjs');
      const passing = await verifyExternalExecution({
        taskPackage: pkg as never,
        agentResult: base as never,
        collected,
        jobEvidenceDir: evidence,
        preRegisteredTests: [
          { command: [process.execPath, verifyScript], description: 'pre-registered fixture verify' },
        ],
      });
      assert.equal(
        passing.checks.find((c) => c.id === 'pre_registered_tests')?.verdict,
        'satisfied',
      );
      // failing pre-registered test must block
      const failScript = path.join(evidence, 'fail.mjs');
      await fs.writeFile(failScript, 'process.exit(3)\n', 'utf8');
      const failing = await verifyExternalExecution({
        taskPackage: pkg as never,
        agentResult: base as never,
        collected,
        jobEvidenceDir: evidence,
        preRegisteredTests: [
          { command: [process.execPath, failScript], description: 'failing pre-registered' },
        ],
      });
      assert.equal(
        failing.checks.find((c) => c.id === 'pre_registered_tests')?.verdict,
        'unsatisfied',
      );
      assert.equal(
        failing.overall,
        'unsatisfied',
        'failed pre-registered tests are hardFail and must not complete',
      );
      assert.equal(failing.digitalMeVerified, false);
    } finally {
      await fs.rm(repo, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it('orchestrated P0-triageapp-edit: isolated copy actually edited + pre-registered test runs', async () => {
    const pkgDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdcl-pkg-'));
    const triageappDir = await createIsolatedTriageapp();
    const originalHtml = await fs.readFile(path.join(triageappDir, 'triageapp.html'), 'utf8');
    const rt = makeRuntime({
      hook: async ({ pkg }) => {
        const html = await fs.readFile(path.join(pkg.workingDirectory, 'triageapp.html'), 'utf8');
        await fs.writeFile(
          path.join(pkg.workingDirectory, 'triageapp.html'),
          html.replace('内容分拣工作台', '内容分拣与轻量整理工作台'),
          'utf8',
        );
        return { exitCode: 0, summary: 'updated description', claimedChangedFiles: ['triageapp.html'] };
      },
    });
    await rt.createPackage({ displayName: 'cdcl-triageapp', targetDir: pkgDir });
    const goal =
      '修改 TRIAGEAPP 单文件内容分拣工作台的功能说明与一处界面文案，并在隔离副本上执行预注册测试，确认既有行为未被破坏。';
    const { started } = await planAndSubmit({ rt, goal, repo: triageappDir });
    const job = await waitForJobTerminal(rt.workRuntime, started.jobId, 30_000);
    assert.equal(job.status, 'succeeded', job.failure?.actionable);
    const detail = await rt.getTask({ taskId: started.taskId });
    assert.ok(detail.artifactIds.length >= 1, 'must produce an artifact');
    // isolated copy changed; original fixture file untouched
    assert.match(
      await fs.readFile(path.join(triageappDir, 'triageapp.html'), 'utf8'),
      /内容分拣与轻量整理工作台/,
    );
    const fixtureOriginal = await fs.readFile(
      path.join(MATERIALS_ROOT, 'triageapp', 'triageapp.html'),
      'utf8',
    );
    assert.doesNotMatch(fixtureOriginal, /内容分拣与轻量整理工作台/, 'original fixture must be untouched');
    assert.equal(originalHtml, fixtureOriginal, 'isolated copy diverges from pristine fixture');
    // verifier ran declared npm test in isolated copy
    const evidenceDir = path.join(pkgDir, 'runtime', 'work', 'jobs', job.id, 'external-execution');
    const verification = JSON.parse(
      await fs.readFile(path.join(evidenceDir, 'verification.json'), 'utf8'),
    ) as { checks: Array<{ id: string; verdict: string }> };
    const testsExecuted = verification.checks.find((c) => c.id === 'tests_executed');
    assert.equal(testsExecuted?.verdict, 'satisfied');
    const testsPassed = verification.checks.find((c) => c.id === 'tests_passed');
    assert.equal(testsPassed?.verdict, 'satisfied');
    rt.workRuntime.stop();
    await fs.rm(pkgDir, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(triageappDir, { recursive: true, force: true }).catch(() => undefined);
  });

  it('orchestrated mechanical reply is blocked (never completed)', async () => {
    const pkgDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdcl-pkg-'));
    const repo = await createIsolatedPlain('mech');
    const rt = makeRuntime({
      hook: async ({ pkg }) => {
        await fs.writeFile(path.join(pkg.workingDirectory, 'result.txt'), 'AUTO_REPLY 任务已完成\n', 'utf8');
        return { exitCode: 0, summary: '任务已完成', claimedChangedFiles: ['result.txt'] };
      },
    });
    await rt.createPackage({ displayName: 'cdcl-mech', targetDir: pkgDir });
    const goal = '请整理已授权材料并输出要点摘要。若无实质产出必须如实说明，不得用模板化回复标记完成。';
    const { started } = await planAndSubmit({ rt, goal, repo });
    const job = await waitForJobTerminal(rt.workRuntime, started.jobId, 30_000);
    assert.equal(job.status, 'failed', 'mechanical reply must fail, not complete');
    assert.notEqual(job.status, 'succeeded');
    const detail = await rt.getTask({ taskId: started.taskId });
    assert.equal(detail.artifactIds.length, 0, 'no artifact for blocked mechanical reply');
    assert.equal(detail.latestJob?.status, 'failed');
    rt.workRuntime.stop();
    await fs.rm(pkgDir, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(repo, { recursive: true, force: true }).catch(() => undefined);
  });

  it('honest failure: no research tool => honest capability-insufficient failure', async () => {
    const pkgDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdcl-pkg-'));
    const repo = await createIsolatedPlain('research');
    const rt = makeRuntime({
      hook: async () => ({
        exitCode: 0,
        summary: '当前环境未提供任何研究工具或网络检索能力，无法完成研究任务，如实说明能力不足。',
        claimedChangedFiles: [],
      }),
    });
    await rt.createPackage({ displayName: 'cdcl-research', targetDir: pkgDir });
    const goal =
      '请针对给定主题完成一项研究并形成结构化报告。当前环境未提供任何研究工具；若无能力完成，必须如实说明能力不足，不得编造来源。';
    const { started } = await planAndSubmit({ rt, goal, repo });
    const job = await waitForJobTerminal(rt.workRuntime, started.jobId, 30_000);
    assert.equal(job.status, 'failed');
    assert.equal(job.failure?.stage, 'capability');
    const detail = await rt.getTask({ taskId: started.taskId });
    assert.equal(detail.latestJob?.status, 'failed');
    assert.equal(detail.artifactIds.length, 0, 'honest failure must not produce artifact');
    rt.workRuntime.stop();
    await fs.rm(pkgDir, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(repo, { recursive: true, force: true }).catch(() => undefined);
  });

  it('restart recover: interrupted job is not a new success; retry recovers same taskId', async () => {
    const pkgDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdcl-pkg-'));
    const repo = await createIsolatedPlain('restart');
    const rt1 = makeRuntime({
      hook: async ({ pkg }) => {
        await fs.writeFile(path.join(pkg.workingDirectory, 'partial.txt'), 'partial progress', 'utf8');
        const err = new Error('simulated interruption');
        Object.assign(err, { failureKind: 'interrupted', actionable: '执行被中断，请重试该任务' });
        throw err;
      },
    });
    await rt1.createPackage({ displayName: 'cdcl-restart', targetDir: pkgDir });
    const goal = '完成一份文档草稿写作。任务在执行中途被中断，重启后应恢复同一任务，而不是当作新任务重新成功。';
    const { started } = await planAndSubmit({ rt: rt1, goal, repo });
    const firstJob = await waitForJobTerminal(rt1.workRuntime, started.jobId, 30_000);
    assert.equal(firstJob.status, 'failed', 'interrupted job must not succeed');
    assert.equal(firstJob.taskId, started.taskId);

    // "restart": reopen same package dir with a fresh runtime (completing hook)
    const rt2 = makeRuntime({
      hook: async ({ pkg }) => {
        await fs.writeFile(
          path.join(pkg.workingDirectory, 'draft.md'),
          '# 文档草稿\n\n已完成。',
          'utf8',
        );
        return { exitCode: 0, summary: 'draft completed', claimedChangedFiles: ['draft.md'] };
      },
    });
    await rt2.openPackage({ dir: pkgDir });
    const beforeRetry = await rt2.getTask({ taskId: started.taskId });
    assert.equal(beforeRetry.task.id, started.taskId, 'same taskId preserved');
    const retried = await rt2.retryTask({ taskId: started.taskId, action: 'retry' });
    assert.ok(retried.jobId);
    const secondJob = await waitForJobTerminal(rt2.workRuntime, retried.jobId, 30_000);
    assert.equal(secondJob.status, 'succeeded');
    assert.equal(secondJob.taskId, started.taskId, 'retry stays on same task');

    const tasks = await rt2.listTasks({ limit: 50 });
    const sameTask = tasks.tasks.filter((t) => t.taskId === started.taskId);
    assert.equal(sameTask.length, 1, 'task must not be duplicated');
    const detail = await rt2.getTask({ taskId: started.taskId });
    assert.equal(detail.artifactIds.length, 1, 'recovered task yields one artifact');
    assert.equal(detail.latestJob?.status, 'succeeded');
    rt2.workRuntime.stop();
    await fs.rm(pkgDir, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(repo, { recursive: true, force: true }).catch(() => undefined);
  });

  it('single coding job gate: second coding job refused while one is active', async () => {
    const pkgDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cdcl-pkg-'));
    const repoA = await createIsolatedPlain('gate-a');
    const repoB = await createIsolatedPlain('gate-b');
    let release!: () => void;
    const blocker = new Promise<void>((r) => {
      release = r;
    });
    const rt = makeRuntime({
      hook: async ({ pkg }) => {
        if (String(pkg.goal || '').includes('gate-a')) {
          await blocker;
          await fs.writeFile(path.join(pkg.workingDirectory, 'out-a.txt'), 'gate-a done', 'utf8');
          return { exitCode: 0, summary: 'a done', claimedChangedFiles: ['out-a.txt'] };
        }
        await fs.writeFile(path.join(pkg.workingDirectory, 'out.txt'), 'gate-b done', 'utf8');
        return { exitCode: 0, summary: 'b done', claimedChangedFiles: ['out.txt'] };
      },
    });
    await rt.createPackage({ displayName: 'cdcl-gate', targetDir: pkgDir });
    const goalA = 'gate-a 修改并产出成果';
    const a = await planAndSubmit({ rt, goal: goalA, repo: repoA });
    // wait until task A is running
    let aDetail = await rt.getTask({ taskId: a.started.taskId });
    const deadline = Date.now() + 15_000;
    while (
      Date.now() < deadline &&
      aDetail.latestJob &&
      aDetail.latestJob.status !== 'running'
    ) {
      await new Promise((r) => setTimeout(r, 20));
      aDetail = await rt.getTask({ taskId: a.started.taskId });
    }
    assert.equal(aDetail.latestJob?.status, 'running', 'task A must be running');
    // task B confirmed submit must be refused by the single coding job gate
    const plannedB = await rt.converse({
      text: 'gate-b 修改并产出成果',
      contextRefs: [{ kind: 'folder', path: repoB }],
    });
    let rejected = false;
    try {
      await rt.submitTask({
        goal: 'gate-b 修改并产出成果',
        contextRefs: [{ kind: 'folder', path: repoB }],
        existingTaskId: plannedB.taskId,
        confirmedPlanVersion: plannedB.plan!.version,
        intentKind: 'modify_code',
        executionAuthorization: {
          confirmed: true,
          workingDirectory: repoB,
          readScope: ['.'],
          writeScope: ['.'],
        },
      });
    } catch (err) {
      rejected = true;
      assert.match(String((err as Error).message), /其他代码修改任务在执行/);
    }
    assert.equal(rejected, true, 'second coding job must be refused');
    release();
    const jobA = await waitForJobTerminal(rt.workRuntime, a.started.jobId, 30_000);
    assert.equal(jobA.status, 'succeeded');
    rt.workRuntime.stop();
    await fs.rm(pkgDir, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(repoA, { recursive: true, force: true }).catch(() => undefined);
    await fs.rm(repoB, { recursive: true, force: true }).catch(() => undefined);
  });
});