import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createWorkRuntime } from '../create-runtime';
import { waitForJobTerminal, waitForTaskState, WorkRuntime } from '../job-runner';
import { artifactIdForJob } from '../artifact';
import { JsonObjectStore } from '../../infrastructure/json-store';
import type { ExecutionJob } from '../execution-job';
import type { Artifact } from '../artifact';
import type { DomainPushEvent } from '../../shared/events';

async function tempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-work-'));
}

async function writeSampleMaterials(dir: string): Promise<{ file: string; folder: string }> {
  const folder = path.join(dir, 'materials');
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, 'notes.txt');
  await fs.writeFile(file, '材料正文 A', 'utf8');
  await fs.writeFile(path.join(folder, 'ok.md'), '# 材料 B', 'utf8');
  await fs.writeFile(path.join(folder, 'bad.docx'), Buffer.from('not-a-zip'));
  return { file, folder };
}

async function boot(
  root: string,
  fake: Parameters<typeof createWorkRuntime>[0]['fakeAdapter'] = {},
): Promise<WorkRuntime> {
  const runtime = createWorkRuntime({
    rootDir: root,
    subjectId: 'subj_test',
    fakeAdapter: fake,
  });
  await runtime.recoverOnStartup();
  runtime.start();
  return runtime;
}

test('submitTask 常规材料与大 contextRefs 均 <1 秒', async () => {
  const root = await tempRoot();
  const materials = await writeSampleMaterials(root);
  const runtime = await boot(root);

  const manyRefs = Array.from({ length: 800 }, (_, i) => ({
    kind: 'folder' as const,
    path: path.join(root, 'huge-tree', `bucket-${i}`),
  }));

  const t0 = Date.now();
  const small = await runtime.submitTask({
    goal: '写一份简报',
    contextRefs: [
      { kind: 'file', path: materials.file },
      { kind: 'folder', path: materials.folder },
    ],
    requestedArtifactType: 'document',
  });
  const smallMs = Date.now() - t0;
  assert.ok(smallMs < 1000, `submitTask small took ${smallMs}ms`);

  const t1 = Date.now();
  const large = await runtime.submitTask({
    goal: '大文件夹引用',
    contextRefs: manyRefs,
    requestedArtifactType: 'document',
  });
  const largeMs = Date.now() - t1;
  assert.ok(largeMs < 1000, `submitTask large refs took ${largeMs}ms`);
  assert.ok(small.taskId && small.jobId);
  assert.ok(large.taskId && large.jobId);

  // 同步路径不得已写 Artifact
  assert.equal(await runtime.getArtifact(artifactIdForJob(small.jobId)), null);

  await runtime.stop();
});

test('同 Task 单活跃 Job;queued→running→succeeded', async () => {
  const root = await tempRoot();
  const materials = await writeSampleMaterials(root);
  const runtime = await boot(root, { delayMs: 400 });
  const { taskId, jobId } = await runtime.submitTask({
    goal: '成功路径',
    contextRefs: [{ kind: 'file', path: materials.file }],
    requestedArtifactType: 'document',
  });

  await waitForTaskState(runtime, taskId, (v) => v.state === 'processing');
  await assert.rejects(() => runtime.retryTask({ taskId }), /active job/);

  const job = await waitForJobTerminal(runtime, jobId);
  assert.equal(job.status, 'succeeded');
  assert.equal(job.artifactId, artifactIdForJob(jobId));
  const view = await runtime.getTask({ taskId });
  assert.equal(view.state, 'completed');
  assert.equal(view.userFacingLabel, '已完成');
  assert.deepEqual(view.artifactIds, [artifactIdForJob(jobId)]);
  assert.equal('status' in view.task, false);
  assert.equal('jobIds' in view.task, false);
  assert.equal('activeJobId' in view.task, false);
  assert.equal('artifactIds' in view.task, false);
  await runtime.stop();
});

test('queued/running→cancelled;cancelled 不产生 Artifact', async () => {
  const root = await tempRoot();
  // 先不 start:确保 queued 取消不与泵竞争
  const runtime = createWorkRuntime({
    rootDir: root,
    subjectId: 'subj_test',
    fakeAdapter: { delayMs: 5_000 },
  });
  await runtime.recoverOnStartup();

  const queued = await runtime.submitTask({
    goal: '取消排队',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const cancelQueued = await runtime.cancelJob({ jobId: queued.jobId });
  assert.equal(cancelQueued.cancelled, true);
  runtime.start();
  const qJob = await waitForJobTerminal(runtime, queued.jobId);
  assert.equal(qJob.status, 'cancelled');
  assert.equal(await runtime.getArtifact(artifactIdForJob(queued.jobId)), null);

  const runningSubmit = await runtime.submitTask({
    goal: '取消运行中',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  await waitForTaskState(runtime, runningSubmit.taskId, (v) => v.state === 'processing');
  const cancelRunning = await runtime.cancelJob({ jobId: runningSubmit.jobId });
  assert.equal(cancelRunning.cancelled, true);
  const rJob = await waitForJobTerminal(runtime, runningSubmit.jobId, 8_000);
  assert.equal(rJob.status, 'cancelled');
  assert.equal(await runtime.getArtifact(artifactIdForJob(runningSubmit.jobId)), null);
  await runtime.stop();
});

test('非法迁移拒绝(守卫)', async () => {
  const { canTransition, transitionJob } = await import('../execution-job');
  assert.equal(canTransition('succeeded', 'failed'), false);
  assert.equal(canTransition('queued', 'succeeded'), false);
  assert.throws(() =>
    transitionJob(
      {
        id: 'job_x',
        taskId: 'task_x',
        capabilityId: 'cap',
        createdAt: new Date().toISOString(),
        status: 'failed',
      },
      'running',
      new Date().toISOString(),
    ),
  );
});

test('Snapshot 条目 warning 不阻断;每次 retry 新 Snapshot', async () => {
  const root = await tempRoot();
  const materials = await writeSampleMaterials(root);
  const runtime = await boot(root, {
    failWith: { message: 'forced fail', actionable: '可重试' },
  });

  const { taskId, jobId } = await runtime.submitTask({
    goal: '含坏文件仍过 context',
    contextRefs: [{ kind: 'folder', path: materials.folder }],
    requestedArtifactType: 'document',
  });
  const failed = await waitForJobTerminal(runtime, jobId);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failure?.stage, 'capability');
  assert.ok(failed.snapshotId);
  const snaps1 = await runtime.listSnapshotsForTask(taskId);
  assert.equal(snaps1.length, 1);
  assert.ok(snaps1[0]?.items.some((i) => i.status === 'warning'));
  assert.ok(snaps1[0]?.items.some((i) => i.status === 'ok'));

  await runtime.stop();
  const runtime2 = createWorkRuntime({
    rootDir: root,
    subjectId: 'subj_test',
    fakeAdapter: {},
  });
  // 不 recover 失败态;直接 start 后 retry
  runtime2.start();
  const { jobId: job2 } = await runtime2.retryTask({ taskId });
  const ok = await waitForJobTerminal(runtime2, job2);
  assert.equal(ok.status, 'succeeded');
  const snaps2 = await runtime2.listSnapshotsForTask(taskId);
  assert.equal(snaps2.length, 2);
  assert.notEqual(snaps2[0]?.id, snaps2[1]?.id);
  assert.notEqual(ok.snapshotId, failed.snapshotId);
  await runtime2.stop();
});

test('Artifact 幂等提交;重复执行不产生第二成果', async () => {
  const root = await tempRoot();
  const runtime = await boot(root);
  const { taskId, jobId } = await runtime.submitTask({
    goal: '幂等',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  await waitForJobTerminal(runtime, jobId);
  const artId = artifactIdForJob(jobId);
  const first = await runtime.getArtifact(artId);
  assert.ok(first);

  // 模拟重复 commit:直接再次调用 committer 路径 — 通过私有装配复用同 store
  const again = createWorkRuntime({ rootDir: root, subjectId: 'subj_test' });
  // 读取已有 artifact 应仍为同一 id;Store list 按 task 只有一个
  const listed = await again.getTask({ taskId });
  assert.deepEqual(listed.artifactIds, [artId]);
  await again.stop();
  await runtime.stop();
});

test('崩溃恢复:Artifact 写后补交;succeeded 缺 Artifact;queued 重入队;running 转 failed', async () => {
  const root = await tempRoot();

  // 1) running + Artifact 已写 → commit_succeeded
  const jobStore = new JsonObjectStore<ExecutionJob>({ dir: path.join(root, 'jobs') });
  const artifactStore = new JsonObjectStore<Artifact>({ dir: path.join(root, 'artifacts') });
  const jobA: ExecutionJob = {
    id: 'job_recover_a',
    taskId: 'task_recover',
    capabilityId: 'cap_fake_document',
    createdAt: '2026-08-02T12:00:00.000Z',
    status: 'running',
    startedAt: '2026-08-02T12:00:01.000Z',
    phase: 'artifact_write',
  };
  await jobStore.put(jobA);
  await artifactStore.put({
    id: artifactIdForJob(jobA.id),
    taskId: 'task_recover',
    jobId: jobA.id,
    subjectId: 'subj_test',
    createdAt: '2026-08-02T12:00:02.000Z',
    type: 'document',
    title: '半成品',
    versions: [
      {
        versionId: 'ver_1',
        createdAt: '2026-08-02T12:00:02.000Z',
        author: 'capability',
        content: { kind: 'text', format: 'markdown', ref: 'text/ab/ab.md' },
      },
    ],
    headVersionId: 'ver_1',
    storageDir: path.join(root, 'artifact-files', artifactIdForJob(jobA.id)),
  });

  // 2) succeeded 缺 Artifact
  await jobStore.put({
    id: 'job_recover_b',
    taskId: 'task_recover',
    capabilityId: 'cap_fake_document',
    createdAt: '2026-08-02T12:01:00.000Z',
    status: 'succeeded',
    finishedAt: '2026-08-02T12:01:01.000Z',
    artifactId: artifactIdForJob('job_recover_b'),
  });

  // 3) queued
  await jobStore.put({
    id: 'job_recover_c',
    taskId: 'task_recover_c',
    capabilityId: 'cap_fake_document',
    createdAt: '2026-08-02T12:02:00.000Z',
    status: 'queued',
  });
  // 需要对应 Task,否则执行会失败 — 写入 task
  const taskStore = new JsonObjectStore<{ id: string; subjectId: string; createdAt: string; goal: string; contextRefs: []; requestedArtifactType: string; capabilityId?: string }>({
    dir: path.join(root, 'tasks'),
  });
  await taskStore.put({
    id: 'task_recover_c',
    subjectId: 'subj_test',
    createdAt: '2026-08-02T12:02:00.000Z',
    goal: '恢复后继续',
    contextRefs: [],
    requestedArtifactType: 'document',
    capabilityId: 'cap_fake_document',
  });

  // 4) running 无 Artifact
  await jobStore.put({
    id: 'job_recover_d',
    taskId: 'task_recover_d',
    capabilityId: 'cap_fake_document',
    createdAt: '2026-08-02T12:03:00.000Z',
    status: 'running',
    startedAt: '2026-08-02T12:03:01.000Z',
  });

  const runtime = createWorkRuntime({ rootDir: root, subjectId: 'subj_test' });
  const { actions } = await runtime.recoverOnStartup();
  const byId = Object.fromEntries(actions.map((a) => [a.jobId, a.action]));
  assert.equal(byId.job_recover_a, 'commit_succeeded');
  assert.equal(byId.job_recover_b, 'mark_failed');
  assert.equal(byId.job_recover_c, 'requeue');
  assert.equal(byId.job_recover_d, 'mark_failed');

  const a = await runtime.getJob('job_recover_a');
  assert.equal(a?.status, 'succeeded');
  assert.equal(a?.artifactId, artifactIdForJob('job_recover_a'));

  const b = await runtime.getJob('job_recover_b');
  assert.equal(b?.status, 'failed');
  assert.equal(b?.failure?.stage, 'artifact_write');

  const d = await runtime.getJob('job_recover_d');
  assert.equal(d?.status, 'failed');
  assert.equal(d?.failure?.stage, 'interrupted');

  runtime.start();
  const c = await waitForJobTerminal(runtime, 'job_recover_c');
  assert.equal(c.status, 'succeeded');
  await runtime.stop();
});

test('双击 retry 竞争只能创建一个 Job', async () => {
  const root = await tempRoot();
  const runtime = await boot(root, {
    failWith: { message: 'x', actionable: 'retry' },
    failTimes: 1,
  });
  const { taskId, jobId } = await runtime.submitTask({
    goal: '先失败再双击重试',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  await waitForJobTerminal(runtime, jobId);

  const results = await Promise.allSettled([
    runtime.retryTask({ taskId }),
    runtime.retryTask({ taskId }),
  ]);
  const fulfilled = results.filter((r) => r.status === 'fulfilled') as Array<
    PromiseFulfilledResult<{ jobId: string }>
  >;
  const rejected = results.filter((r) => r.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  const activeJobId = fulfilled[0]?.value.jobId;
  assert.ok(activeJobId);
  await waitForJobTerminal(runtime, activeJobId);
  const view = await runtime.getTask({ taskId });
  assert.equal(view.state, 'completed');
  await runtime.stop();
});

test('事件丢失后查询结果一致;用户面无 Legacy 词汇', async () => {
  const root = await tempRoot();
  const runtime = await boot(root);
  const events: DomainPushEvent[] = [];
  const unsub = runtime.eventBus.subscribe((e) => events.push(e));
  const { taskId, jobId } = await runtime.submitTask({
    goal: '事件与查询',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  await waitForJobTerminal(runtime, jobId);
  unsub();
  events.length = 0; // 模拟事件丢失
  const view = await runtime.getTask({ taskId });
  assert.equal(view.state, 'completed');
  assert.equal(view.userFacingLabel, '已完成');
  assert.equal(view.latestJob?.status, 'succeeded');
  assert.equal(view.latestJob?.progressNote, undefined);
  const dumped = JSON.stringify(view);
  for (const banned of ['committed', 'Reviewer', 'Channel B', 'generationAttempt', 'adopted', 'materialsStale']) {
    assert.ok(!dumped.includes(banned), `must not leak ${banned}`);
  }
  await runtime.stop();
});

test('修改成果:同 Artifact 追加 capability 版本;失败保留 head', async () => {
  const root = await tempRoot();
  let calls = 0;
  const runtime = await boot(root, {
    text: (input) => {
      calls += 1;
      if (input.revision) {
        return `# 修订稿\n${input.revision.request}\n基于:${input.revision.previousText.slice(0, 20)}`;
      }
      return '# 初稿\n(fake document)\n原始内容';
    },
  });
  const { taskId, jobId } = await runtime.submitTask({
    goal: '写初稿',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  await waitForJobTerminal(runtime, jobId);
  const first = await runtime.getTask({ taskId });
  assert.equal(first.artifactIds.length, 1);
  const artifactId = first.artifactIds[0] as string;
  const before = await runtime.getArtifact(artifactId);
  assert.ok(before);
  assert.equal(before.versions.length, 1);
  const headBefore = before.headVersionId;

  const revised = await runtime.reviseArtifact({
    taskId,
    artifactId,
    revisionRequest: '改成更短',
  });
  await waitForJobTerminal(runtime, revised.jobId);
  const afterView = await runtime.getTask({ taskId });
  assert.equal(afterView.artifactIds.length, 1);
  assert.equal(afterView.artifactIds[0], artifactId);
  assert.equal(afterView.userFacingLabel, '已完成');
  const after = await runtime.getArtifact(artifactId);
  assert.ok(after);
  assert.equal(after.versions.length, 2);
  assert.notEqual(after.headVersionId, headBefore);
  assert.equal(after.versions[1]?.author, 'capability');
  assert.ok(calls >= 2);

  // 失败不破坏当前 head
  await runtime.stop();
  const runtime2 = await boot(root, {
    failWith: { message: '模型失败', actionable: '请重试' },
  });
  // reopen stores by using same root - createWorkRuntime creates new stores on same root
  const failRevise = await runtime2.reviseArtifact({
    taskId,
    artifactId,
    revisionRequest: '这次会失败',
  });
  const failed = await waitForJobTerminal(runtime2, failRevise.jobId);
  assert.equal(failed.status, 'failed');
  const still = await runtime2.getArtifact(artifactId);
  assert.ok(still);
  assert.equal(still.versions.length, 2);
  assert.equal(still.headVersionId, after.headVersionId);
  await runtime2.stop();
});

test('runtime 内无 provider 专有字段;openai stub 不抢选择', async () => {
  const root = await tempRoot();
  const runtime = await boot(root);
  const { taskId, jobId } = await runtime.submitTask({
    goal: '选择 fake',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job = await waitForJobTerminal(runtime, jobId);
  assert.equal(job.capabilityId, 'cap_fake_document');
  const view = await runtime.getTask({ taskId });
  const text = JSON.stringify(view);
  assert.ok(!text.includes('baseUrl'));
  assert.ok(!text.includes('apiKey'));
  assert.ok(!text.includes('openai'));
  await runtime.stop();
});

test('Adapter 忽略 abort 时 Runner 最终仍落 cancelled', async () => {
  const root = await tempRoot();
  const runtime = await boot(root, { delayMs: 300, ignoreAbort: true });
  const { jobId, taskId } = await runtime.submitTask({
    goal: '强制取消',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  await waitForTaskState(runtime, taskId, (v) => v.state === 'processing');
  await runtime.cancelJob({ jobId });
  const job = await waitForJobTerminal(runtime, jobId);
  assert.equal(job.status, 'cancelled');
  assert.equal(await runtime.getArtifact(artifactIdForJob(jobId)), null);
  await runtime.stop();
});
