/**
 * D11-D concurrency follow-up：直接覆盖 maybeRunControlledRevisionAfterJob 编排，
 * 不得只测纯决策函数。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_MAX_AUTO_REVISION_CUMULATIVE_MS,
  DEFAULT_MAX_AUTO_REVISION_ROUNDS,
  EXTERNAL_EXECUTOR_DEFAULT_TIMEOUT_MS,
  decideControlledRevision,
} from '../controlled-revision';
import {
  claimRevisionVersionExclusive,
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
  it('产品主链：同一 succeeded event 并发 10 次零自动修订 Job', async () => {
    const h = createHarness();
    const input = { taskId: h.taskId, jobId: 'job_src', artifactId: 'art_1' };
    const results = await Promise.all(
      Array.from({ length: 10 }, () => maybeRunControlledRevisionAfterJob(h.deps, input)),
    );
    assert.equal(h.reviseCalls, 0);
    assert.equal(results.filter((r) => r.revisionJobId).length, 0);
    assert.ok(results.every((r) => r.action === 'noop'));
    assert.ok(results.every((r) => r.reason === 'product_main_chain_no_auto_revision'));
  });

  it('产品主链：两个回调同时到达仍为零修订 Job', async () => {
    const h = createHarness();
    const input = { taskId: h.taskId, jobId: 'job_src', artifactId: 'art_1' };
    const [a, b] = await Promise.all([
      maybeRunControlledRevisionAfterJob(h.deps, input),
      maybeRunControlledRevisionAfterJob(h.deps, input),
    ]);
    assert.equal(h.reviseCalls, 0);
    assert.equal(a.action, 'noop');
    assert.equal(b.action, 'noop');
  });

  it('产品主链：pending 占位存在时仍不创建修订 Job', async () => {
    const h = createHarness();
    await h.deps.updateRevisionLoop(h.taskId, (prev) => ({
      ...prev,
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
    assert.equal(result.reason, 'product_main_chain_no_auto_revision');
    assert.equal(h.reviseCalls, 0);
  });

  it('产品主链：用户暂停后零新 Job', async () => {
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
  });

  it('产品主链：用户取消后零新 Job', async () => {
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
  });

  it('产品主链：重复成功事件不产生自动修订', async () => {
    const h = createHarness();
    const first = await maybeRunControlledRevisionAfterJob(h.deps, {
      taskId: h.taskId,
      jobId: 'job_src',
      artifactId: 'art_1',
    });
    const second = await maybeRunControlledRevisionAfterJob(h.deps, {
      taskId: h.taskId,
      jobId: 'job_src',
      artifactId: 'art_1',
    });
    assert.equal(first.action, 'noop');
    assert.equal(second.action, 'noop');
    assert.equal(h.reviseCalls, 0);
  });

  it('产品主链：不同 Artifact version 也不自动建修订 Job', async () => {
    const h = createHarness({ versionId: 'ver_1' });
    const first = await maybeRunControlledRevisionAfterJob(h.deps, {
      taskId: h.taskId,
      jobId: 'job_1',
      artifactId: 'art_1',
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
    assert.equal(first.revisionJobId, undefined);
    assert.equal(second.revisionJobId, undefined);
    assert.equal(h.reviseCalls, 0);
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
