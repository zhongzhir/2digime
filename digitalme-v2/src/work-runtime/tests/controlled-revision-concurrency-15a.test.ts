/**
 * D11-D concurrency follow-up：直接覆盖 maybeRunControlledRevisionAfterJob 编排，
 * 不得只测纯决策函数。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_MAX_AUTO_REVISION_CUMULATIVE_MS,
  DEFAULT_MAX_AUTO_REVISION_ROUNDS,
  DEFAULT_REVISION_CLAIM_STALE_MS,
  EXTERNAL_EXECUTOR_DEFAULT_TIMEOUT_MS,
  decideControlledRevision,
} from '../controlled-revision';
import {
  claimRevisionVersionExclusive,
  isPendingClaim,
  maybeRunControlledRevisionAfterJob,
  type ControlledRevisionRunnerDeps,
} from '../controlled-revision-runner';
import type { Task } from '../task';

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  const now = '2026-08-11T00:00:00.000Z';
  const base: Task = {
    id: overrides.id,
    subjectId: 'subj',
    goal: 'goal',
    contextRefs: [],
    requestedArtifactType: 'code_change',
    createdAt: now,
    meta: {
      plan: {
        status: 'confirmed',
        version: 1,
        confirmedAt: now,
        content: 'plan',
        updatedAt: now,
      },
      revisionLoop: {
        attempts: [],
        autoRoundCount: 0,
      },
    },
  };
  const meta: Task['meta'] = {
    plan: overrides.meta?.plan ?? base.meta!.plan!,
    revisionLoop: overrides.meta?.revisionLoop ?? base.meta!.revisionLoop!,
  };
  if (overrides.meta?.conversation) meta!.conversation = overrides.meta.conversation;
  else if (base.meta?.conversation) meta!.conversation = base.meta.conversation;
  return {
    ...base,
    ...overrides,
    meta,
  };
}

function createHarness(opts: {
  versionId?: string;
  reviseImpl?: ControlledRevisionRunnerDeps['reviseArtifact'];
  nowMs?: () => number;
  afterClaimForTest?: ControlledRevisionRunnerDeps['afterClaimForTest'];
  cumulativeMs?: number;
} = {}) {
  const taskId = 'task_conc';
  let task = makeTask({ id: taskId });
  const locks = new Map<string, Promise<unknown>>();
  let reviseCalls = 0;
  const jobsCreated: string[] = [];

  const withTaskExclusive = async <T>(id: string, fn: () => Promise<T>): Promise<T> => {
    const prev = locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    locks.set(
      id,
      prev.then(() => gate),
    );
    await prev.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
    }
  };

  const deps: ControlledRevisionRunnerDeps = {
    getTask: async () => task,
    withTaskExclusive,
    updateRevisionLoop: async (_id, patch) => {
      const prev = task.meta?.revisionLoop ?? { attempts: [], autoRoundCount: 0 };
      const next =
        typeof patch === 'function'
          ? patch(prev)
          : { ...prev, ...patch, attempts: patch.attempts ?? prev.attempts };
      task = {
        ...task,
        meta: { ...task.meta, revisionLoop: next },
      };
      return task;
    },
    appendConversation: async () => undefined,
    findActiveJob: async () => null,
    getArtifactContent: async () => ({
      versionId: opts.versionId ?? 'ver_1',
      acceptanceSummary: {
        ctoReview: {
          decision: 'needs_revision',
          revisionDirective: '检查 build:api_contract 并补充缺失的输入校验。',
          findings: ['缺少输入校验'],
        },
      },
      checks: [{ id: 'api_contract', verdict: 'unsatisfied', detail: '缺少输入校验' }],
    }),
    reviseArtifact:
      opts.reviseImpl ??
      (async () => {
        reviseCalls += 1;
        const jobId = `job_rev_${reviseCalls}`;
        jobsCreated.push(jobId);
        return { jobId };
      }),
    sumSucceededJobDurationMs: async () => opts.cumulativeMs ?? 0,
    modelAvailable: true,
    nowIso: () => '2026-08-11T00:00:00.000Z',
    nowMs: opts.nowMs ?? (() => Date.parse('2026-08-11T00:00:00.000Z')),
    ...(opts.afterClaimForTest ? { afterClaimForTest: opts.afterClaimForTest } : {}),
  };

  return {
    taskId,
    get task() {
      return task;
    },
    setTask(next: Task) {
      task = next;
    },
    deps,
    get reviseCalls() {
      return reviseCalls;
    },
    jobsCreated,
    withTaskExclusive,
  };
}

describe('D11-D concurrency follow-up (runner)', () => {
  it('同一 succeeded event 并发 10 次只创建 1 个修订 Job', async () => {
    const h = createHarness();
    const input = { taskId: h.taskId, jobId: 'job_src', artifactId: 'art_1' };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => maybeRunControlledRevisionAfterJob(h.deps, input)),
    );
    assert.equal(h.reviseCalls, 1);
    assert.equal(results.filter((r) => r.revisionJobId).length, 1);
    assert.ok(!isPendingClaim(h.task.meta?.revisionLoop?.inFlightJobId));
    assert.equal(h.task.meta?.revisionLoop?.inFlightJobId, 'job_rev_1');
  });

  it('两个回调同时读到无 active Job，仍只有一个认领成功', async () => {
    const h = createHarness();
    let bothSawEmpty = false;
    const saw: boolean[] = [];
    const orig = h.deps.findActiveJob;
    h.deps.findActiveJob = async () => {
      const active = await orig('x');
      saw.push(!active);
      if (saw.length >= 2 && saw.every(Boolean)) bothSawEmpty = true;
      return active;
    };
    const input = { taskId: h.taskId, jobId: 'job_src', artifactId: 'art_1' };
    const [a, b] = await Promise.all([
      maybeRunControlledRevisionAfterJob(h.deps, input),
      maybeRunControlledRevisionAfterJob(h.deps, input),
    ]);
    assert.equal(bothSawEmpty, true);
    assert.equal(h.reviseCalls, 1);
    const actions = [a.action, b.action];
    assert.ok(actions.includes('auto_revise') || actions.includes('auto_revise_new_scheme'));
    assert.ok(actions.includes('noop') || actions.filter((x) => x === 'auto_revise').length === 1);
  });

  it('pending 占位存在但 Job 尚未落盘时，重复事件不得继续', async () => {
    const h = createHarness();
    await h.deps.updateRevisionLoop(h.taskId, (prev) => ({
      ...prev,
      // 故意不写 lastHandled：仅靠 pending 阻断
      inFlightJobId: 'pending:job_src:ver_1',
      claimToken: 'pending:job_src:ver_1',
      claimStartedAt: '2026-08-11T00:00:00.000Z',
    }));
    const result = await maybeRunControlledRevisionAfterJob(h.deps, {
      taskId: h.taskId,
      jobId: 'job_src',
      artifactId: 'art_1',
    });
    assert.equal(result.action, 'noop');
    assert.equal(result.reason, 'revision_in_flight');
    assert.equal(h.reviseCalls, 0);
  });

  it('认领后、reviseArtifact 前用户暂停 → 零新 Job', async () => {
    const h = createHarness({
      afterClaimForTest: async () => {
        await h.deps.updateRevisionLoop(h.taskId, (prev) => ({
          ...prev,
          paused: true,
          pauseReason: 'user_pause',
        }));
      },
    });
    const result = await maybeRunControlledRevisionAfterJob(h.deps, {
      taskId: h.taskId,
      jobId: 'job_src',
      artifactId: 'art_1',
    });
    assert.equal(h.reviseCalls, 0);
    assert.equal(result.action, 'noop');
    assert.ok(result.reason === 'paused' || result.reason === 'blocked_before_create');
    assert.equal(h.task.meta?.revisionLoop?.inFlightJobId, undefined);
    assert.equal(h.task.meta?.revisionLoop?.lastHandledVersionId, 'ver_1');
  });

  it('认领后用户取消 → 零新 Job', async () => {
    const h = createHarness({
      afterClaimForTest: async () => {
        await h.deps.updateRevisionLoop(h.taskId, (prev) => ({
          ...prev,
          paused: true,
          pauseReason: 'user_cancelled',
        }));
      },
    });
    const result = await maybeRunControlledRevisionAfterJob(h.deps, {
      taskId: h.taskId,
      jobId: 'job_src',
      artifactId: 'art_1',
    });
    assert.equal(h.reviseCalls, 0);
    assert.equal(result.action, 'noop');
    assert.ok(result.reason === 'cancelled' || result.reason === 'blocked_before_create');
  });

  it('创建 Job 失败后不残留假运行状态，也不重复执行旧版本', async () => {
    const h = createHarness({
      reviseImpl: async () => {
        throw new Error('create_failed');
      },
    });
    const first = await maybeRunControlledRevisionAfterJob(h.deps, {
      taskId: h.taskId,
      jobId: 'job_src',
      artifactId: 'art_1',
    });
    assert.equal(first.ok, false);
    assert.equal(h.task.meta?.revisionLoop?.inFlightJobId, undefined);
    assert.equal(h.task.meta?.revisionLoop?.paused, true);
    assert.equal(h.task.meta?.revisionLoop?.lastHandledVersionId, 'ver_1');

    const second = await maybeRunControlledRevisionAfterJob(h.deps, {
      taskId: h.taskId,
      jobId: 'job_src',
      artifactId: 'art_1',
    });
    assert.equal(second.action, 'noop');
    assert.ok(
      second.reason === 'paused_or_cancelled' ||
        second.reason === 'version_already_handled' ||
        second.reason === 'paused',
    );
  });

  it('重启后过期 pending 可安全收敛，不重复建 Job（同 version）', async () => {
    const started = Date.parse('2026-08-11T00:00:00.000Z');
    const h = createHarness({
      nowMs: () => started + DEFAULT_REVISION_CLAIM_STALE_MS + 1,
    });
    await h.deps.updateRevisionLoop(h.taskId, (prev) => ({
      ...prev,
      lastHandledVersionId: 'ver_1',
      inFlightJobId: 'pending:job_old:ver_1',
      claimToken: 'pending:job_old:ver_1',
      claimStartedAt: '2026-08-11T00:00:00.000Z',
    }));
    const result = await maybeRunControlledRevisionAfterJob(h.deps, {
      taskId: h.taskId,
      jobId: 'job_src',
      artifactId: 'art_1',
    });
    assert.equal(h.reviseCalls, 0);
    assert.equal(result.action, 'noop');
    assert.equal(result.reason, 'version_already_handled');
    assert.equal(h.task.meta?.revisionLoop?.inFlightJobId, undefined);
  });

  it('不同 Artifact version 可按顺序处理', async () => {
    const h = createHarness({ versionId: 'ver_1' });
    const first = await maybeRunControlledRevisionAfterJob(h.deps, {
      taskId: h.taskId,
      jobId: 'job_1',
      artifactId: 'art_1',
    });
    assert.ok(first.revisionJobId);

    // 上一轮 Job 已结束：清 inFlight，推进到 ver_2
    await h.deps.updateRevisionLoop(h.taskId, (prev) => {
      const next = { ...prev };
      delete next.inFlightJobId;
      delete next.claimStartedAt;
      delete next.claimToken;
      return next;
    });
    h.deps.getArtifactContent = async () => ({
      versionId: 'ver_2',
      acceptanceSummary: {
        ctoReview: {
          decision: 'needs_revision',
          revisionDirective: '修复集成测试中的空指针分支。',
          findings: ['空指针'],
        },
      },
      checks: [{ id: 'integration', verdict: 'unsatisfied', detail: '空指针' }],
    });

    const second = await maybeRunControlledRevisionAfterJob(h.deps, {
      taskId: h.taskId,
      jobId: 'job_2',
      artifactId: 'art_1',
    });
    assert.ok(second.revisionJobId);
    assert.equal(h.reviseCalls, 2);
    assert.equal(h.task.meta?.revisionLoop?.lastHandledVersionId, 'ver_2');
  });

  it('硬门常量：单轮超时 / 累计时长 / 自动轮次上限可引用且决策生效', () => {
    assert.equal(EXTERNAL_EXECUTOR_DEFAULT_TIMEOUT_MS, 600_000);
    assert.equal(DEFAULT_MAX_AUTO_REVISION_ROUNDS, 6);
    assert.ok(DEFAULT_MAX_AUTO_REVISION_CUMULATIVE_MS > 0);

    const pausedByRounds = decideControlledRevision({
      evidence: {
        decision: 'needs_revision',
        revisionPlan: '补充校验',
      },
      hasConfirmedPlan: true,
      confirmedPlanVersion: 1,
      hasActiveJob: false,
      modelAvailable: true,
      pausedByUser: false,
      cancelled: false,
      loop: { attempts: [], autoRoundCount: DEFAULT_MAX_AUTO_REVISION_ROUNDS },
    });
    assert.equal(pausedByRounds.action, 'pause');

    const pausedByCum = decideControlledRevision({
      evidence: {
        decision: 'needs_revision',
        revisionPlan: '补充校验',
      },
      hasConfirmedPlan: true,
      confirmedPlanVersion: 1,
      hasActiveJob: false,
      modelAvailable: true,
      pausedByUser: false,
      cancelled: false,
      cumulativeDurationMs: DEFAULT_MAX_AUTO_REVISION_CUMULATIVE_MS,
      loop: { attempts: [], autoRoundCount: 0 },
    });
    assert.equal(pausedByCum.action, 'pause');
  });

  it('不得把 pausedByUser:false / cancelled:false 当作真实运行事实（以 loop 为准）', async () => {
    const h = createHarness({
      afterClaimForTest: async () => {
        await h.deps.updateRevisionLoop(h.taskId, (prev) => ({
          ...prev,
          paused: true,
          pauseReason: 'user_pause',
        }));
      },
    });
    // 即便决策输入侧曾写死 false，runner 必须以最新 loop 阻断
    const result = await maybeRunControlledRevisionAfterJob(h.deps, {
      taskId: h.taskId,
      jobId: 'job_src',
      artifactId: 'art_1',
    });
    assert.equal(h.reviseCalls, 0);
    assert.equal(result.action, 'noop');
  });

  it('claimRevisionVersionExclusive：pending 本身阻止，不要求 active Job', async () => {
    const h = createHarness();
    await h.deps.updateRevisionLoop(h.taskId, (prev) => ({
      ...prev,
      inFlightJobId: 'pending:other:ver_x',
      claimStartedAt: '2026-08-11T00:00:00.000Z',
    }));
    const claim = await h.withTaskExclusive(h.taskId, () =>
      claimRevisionVersionExclusive(h.deps, {
        taskId: h.taskId,
        versionId: 'ver_new',
        sourceJobId: 'job_src',
        nowIso: '2026-08-11T00:00:00.000Z',
        nowMs: Date.parse('2026-08-11T00:00:00.000Z'),
      }),
    );
    assert.equal(claim.ok, false);
    if (!claim.ok) assert.equal(claim.reason, 'revision_in_flight');
  });
});

describe('D11-D hard-gate call chain evidence', () => {
  it('external-executor 默认超时与受控修订常量对齐文档', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const root = path.resolve(__dirname, '../../..');
    const executorSrc = await fs.readFile(
      path.join(root, 'src/capability/adapters/external-executor-codex.ts'),
      'utf8',
    );
    assert.match(executorSrc, /defaultTimeoutMs\s*=\s*600_000|defaultTimeoutMs:\s*600_000|600_000/);
    assert.equal(EXTERNAL_EXECUTOR_DEFAULT_TIMEOUT_MS, 600_000);
  });
});
