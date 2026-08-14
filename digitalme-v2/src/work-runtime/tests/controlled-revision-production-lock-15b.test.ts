/**
 * D11-D production lock follow-up：直接测真实 WorkRuntime / JobRunner 互斥，
 * 不得依赖 createHarness 自建锁。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createWorkRuntime } from '../create-runtime';
import { waitForJobTerminal, type WorkRuntime } from '../job-runner';
import { maybeRunControlledRevisionAfterJob } from '../controlled-revision-runner';
import type { ControlledRevisionRunnerDeps } from '../controlled-revision-runner';
import { artifactIdForJob } from '../artifact';

async function tempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-lock-'));
}

async function boot(): Promise<{ runtime: WorkRuntime; root: string }> {
  const root = await tempRoot();
  const runtime = createWorkRuntime({
    rootDir: root,
    subjectId: 'subj_lock',
    fakeAdapter: { delayMs: 5 },
  });
  await runtime.recoverOnStartup();
  runtime.start();
  return { runtime, root };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function wireRevisionDeps(
  runtime: WorkRuntime,
  opts: {
    versionId: string;
    afterClaimForTest?: ControlledRevisionRunnerDeps['afterClaimForTest'];
  },
): ControlledRevisionRunnerDeps {
  return {
    getTask: (id) => runtime.getTaskRecord(id),
    withTaskExclusive: (id, fn) => runtime.runExclusiveForTask(id, fn),
    updateRevisionLoop: (id, patch) => runtime.updateTaskRevisionLoopAlreadyLocked(id, patch),
    appendConversation: async (id, turn) => {
      await runtime.appendTaskConversation(id, {
        turns: [
          {
            turnId: `turn_${Math.random().toString(36).slice(2, 8)}`,
            role: turn.role,
            content: turn.content,
            createdAt: new Date().toISOString(),
          },
        ],
      });
    },
    findActiveJob: async (id) => {
      const jobs = await runtime.listJobsForTask(id);
      const active = jobs.find((j) => j.status === 'queued' || j.status === 'running');
      return active ? { id: active.id } : null;
    },
    getArtifactContent: async () => ({
      versionId: opts.versionId,
      acceptanceSummary: {
        ctoReview: {
          decision: 'needs_revision',
          revisionDirective: '检查 build:api_contract 并补充缺失的输入校验。',
          findings: ['缺少输入校验'],
        },
      },
      checks: [{ id: 'api_contract', verdict: 'unsatisfied', detail: '缺少输入校验' }],
    }),
    reviseArtifact: (input) => runtime.reviseArtifactAlreadyLocked(input),
    modelAvailable: true,
    nowIso: () => new Date().toISOString(),
    nowMs: () => Date.now(),
    ...(opts.afterClaimForTest ? { afterClaimForTest: opts.afterClaimForTest } : {}),
  };
}

async function seedSucceededTask(runtime: WorkRuntime): Promise<{
  taskId: string;
  jobId: string;
  artifactId: string;
  versionId: string;
}> {
  const materials = path.join(os.tmpdir(), `dm-mat-${Date.now()}`);
  await fs.mkdir(materials, { recursive: true });
  await fs.writeFile(path.join(materials, 'notes.txt'), '材料', 'utf8');
  const submitted = await runtime.submitTask({
    goal: '写一份简报',
    contextRefs: [{ kind: 'folder', path: materials }],
    requestedArtifactType: 'document',
  });
  await waitForJobTerminal(runtime, submitted.jobId, 10_000);
  const artifactId = artifactIdForJob(submitted.jobId);
  const artifact = await runtime.getArtifact(artifactId);
  assert.ok(artifact);
  const versionId = artifact.headVersionId!;
  const now = new Date().toISOString();
  await runtime.updateTaskPlan(submitted.taskId, {
    version: 1,
    status: 'confirmed',
    content: '交付一份简报',
    updatedAt: now,
    confirmedAt: now,
  });
  // 上一 Job 已终态：清 revision inFlight，便于本测触发修订
  await runtime.updateTaskRevisionLoop(submitted.taskId, (prev) => {
    const next = { ...prev, attempts: prev.attempts ?? [], autoRoundCount: prev.autoRoundCount ?? 0 };
    delete next.inFlightJobId;
    delete next.claimStartedAt;
    delete next.claimToken;
    delete next.lastHandledVersionId;
    delete next.paused;
    delete next.pauseReason;
    return next;
  });
  return {
    taskId: submitted.taskId,
    jobId: submitted.jobId,
    artifactId,
    versionId,
  };
}

describe('D11-D production Task mutex (WorkRuntime)', () => {
  it('回调 A 持锁等待时，独立回调 B 不得进入', async () => {
    const { runtime } = await boot();
    try {
      const seeded = await seedSucceededTask(runtime);
      let bEnteredWhileAHeld = false;
      let aHolding = false;
      let releaseA!: () => void;
      const holdGate = new Promise<void>((r) => {
        releaseA = r;
      });

      const aPromise = runtime.runExclusiveForTask(seeded.taskId, async () => {
        aHolding = true;
        await holdGate;
        aHolding = false;
      });

      await delay(20);
      assert.equal(aHolding, true);

      const bPromise = runtime.runExclusiveForTask(seeded.taskId, async () => {
        if (aHolding) bEnteredWhileAHeld = true;
        return 'b';
      });

      await delay(40);
      assert.equal(bEnteredWhileAHeld, false, 'B must wait while A holds lock');
      releaseA();
      assert.equal(await bPromise, 'b');
      await aPromise;
      assert.equal(bEnteredWhileAHeld, false);
    } finally {
      await runtime.stop();
    }
  });

  it('A 内部合法嵌套 AlreadyLocked 操作不得死锁', async () => {
    const { runtime } = await boot();
    try {
      const seeded = await seedSucceededTask(runtime);
      const result = await runtime.runExclusiveForTask(seeded.taskId, async () => {
        await runtime.updateTaskRevisionLoopAlreadyLocked(seeded.taskId, (prev) => ({
          ...prev,
          autoRoundCount: (prev.autoRoundCount ?? 0) + 1,
        }));
        const task = await runtime.getTaskRecord(seeded.taskId);
        return task?.meta?.revisionLoop?.autoRoundCount ?? 0;
      });
      assert.ok(result >= 1);
    } finally {
      await runtime.stop();
    }
  });

  it('10 个真实并发 succeeded 回调零自动修订 Job', async () => {
    const { runtime } = await boot();
    try {
      const seeded = await seedSucceededTask(runtime);
      const beforeJobs = await runtime.listJobsForTask(seeded.taskId);
      const deps = wireRevisionDeps(runtime, { versionId: seeded.versionId });
      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          maybeRunControlledRevisionAfterJob(deps, {
            taskId: seeded.taskId,
            jobId: seeded.jobId,
            artifactId: seeded.artifactId,
          }),
        ),
      );
      const created = results.filter((r) => r.revisionJobId);
      assert.equal(created.length, 0);
      assert.ok(results.every((r) => r.reason === 'product_main_chain_no_auto_revision'));
      const afterJobs = await runtime.listJobsForTask(seeded.taskId);
      assert.equal(afterJobs.length, beforeJobs.length);
    } finally {
      await runtime.stop();
    }
  });

  it('认领后暂停仍为零新 Job', async () => {
    const { runtime } = await boot();
    try {
      const seeded = await seedSucceededTask(runtime);
      const before = (await runtime.listJobsForTask(seeded.taskId)).length;
      const deps = wireRevisionDeps(runtime, {
        versionId: seeded.versionId,
        afterClaimForTest: async () => {
          await runtime.updateTaskRevisionLoop(seeded.taskId, (prev) => ({
            ...prev,
            paused: true,
            pauseReason: 'user_pause',
          }));
        },
      });
      const result = await maybeRunControlledRevisionAfterJob(deps, {
        taskId: seeded.taskId,
        jobId: seeded.jobId,
        artifactId: seeded.artifactId,
      });
      assert.equal(result.action, 'noop');
      assert.equal((await runtime.listJobsForTask(seeded.taskId)).length, before);
    } finally {
      await runtime.stop();
    }
  });

  it('认领后取消仍为零新 Job', async () => {
    const { runtime } = await boot();
    try {
      const seeded = await seedSucceededTask(runtime);
      const before = (await runtime.listJobsForTask(seeded.taskId)).length;
      const deps = wireRevisionDeps(runtime, {
        versionId: seeded.versionId,
        afterClaimForTest: async () => {
          await runtime.updateTaskRevisionLoop(seeded.taskId, (prev) => ({
            ...prev,
            paused: true,
            pauseReason: 'user_cancelled',
          }));
        },
      });
      const result = await maybeRunControlledRevisionAfterJob(deps, {
        taskId: seeded.taskId,
        jobId: seeded.jobId,
        artifactId: seeded.artifactId,
      });
      assert.equal(result.action, 'noop');
      assert.equal((await runtime.listJobsForTask(seeded.taskId)).length, before);
    } finally {
      await runtime.stop();
    }
  });

  it('异常抛出后锁正常释放', async () => {
    const { runtime } = await boot();
    try {
      const seeded = await seedSucceededTask(runtime);
      await assert.rejects(
        () =>
          runtime.runExclusiveForTask(seeded.taskId, async () => {
            throw new Error('boom');
          }),
        /boom/,
      );
      let entered = false;
      await runtime.runExclusiveForTask(seeded.taskId, async () => {
        entered = true;
      });
      assert.equal(entered, true);
    } finally {
      await runtime.stop();
    }
  });

  it('不同 taskId 可并行，不能全局串行', async () => {
    const { runtime } = await boot();
    try {
      const a = await seedSucceededTask(runtime);
      const b = await seedSucceededTask(runtime);
      let aHolding = false;
      let bEnteredWhileA = false;
      const t0 = Date.now();
      await Promise.all([
        runtime.runExclusiveForTask(a.taskId, async () => {
          aHolding = true;
          await delay(60);
          aHolding = false;
        }),
        (async () => {
          await delay(5);
          await runtime.runExclusiveForTask(b.taskId, async () => {
            if (aHolding) bEnteredWhileA = true;
          });
        })(),
      ]);
      assert.equal(bEnteredWhileA, true, 'different tasks must run in parallel');
      assert.ok(Date.now() - t0 < 200, 'must not globally serialize');
    } finally {
      await runtime.stop();
    }
  });

  it('定时器、事件回调、独立 Promise 不得被误认为重入', async () => {
    const { runtime } = await boot();
    try {
      const seeded = await seedSucceededTask(runtime);
      let independentEnteredWhileHeld = false;
      let timerEnteredWhileHeld = false;
      let holding = false;
      let releaseHold!: () => void;
      const holdGate = new Promise<void>((r) => {
        releaseHold = r;
      });

      const exclusive = runtime.runExclusiveForTask(seeded.taskId, async () => {
        holding = true;
        await holdGate;
        holding = false;
      });

      await delay(15);
      assert.equal(holding, true);

      const independent = Promise.resolve().then(async () => {
        await runtime.updateTaskRevisionLoop(seeded.taskId, (prev) => ({
          ...prev,
          pauseReason: 'from_independent',
        }));
        if (holding) independentEnteredWhileHeld = true;
      });
      const timer = new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          runtime
            .updateTaskRevisionLoop(seeded.taskId, (prev) => ({
              ...prev,
              pauseReason: 'from_timer',
            }))
            .then(() => {
              if (holding) timerEnteredWhileHeld = true;
              resolve();
            })
            .catch(reject);
        }, 5);
      });

      await delay(40);
      assert.equal(independentEnteredWhileHeld, false);
      assert.equal(timerEnteredWhileHeld, false);
      releaseHold();
      await exclusive;
      await Promise.all([independent, timer]);
      assert.equal(independentEnteredWhileHeld, false);
      assert.equal(timerEnteredWhileHeld, false);
      const task = await runtime.getTaskRecord(seeded.taskId);
      assert.ok(
        task?.meta?.revisionLoop?.pauseReason === 'from_independent' ||
          task?.meta?.revisionLoop?.pauseReason === 'from_timer',
      );
    } finally {
      await runtime.stop();
    }
  });
});
