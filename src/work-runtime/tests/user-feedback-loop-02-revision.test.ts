/**
 * 使用反馈（2）场景 C：已有成果后的连续修改。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { decideConverseEffects } from '../work-converse';
import { classifyOwnerRevisionRoute, isConcreteQueuedRevision, isOwnerStartNowPhrase } from '../work-revision-routing';
import { createWorkRuntime } from '../create-runtime';
import { waitForJobTerminal } from '../job-runner';

const REVISION =
  '整体界面太简单了，请优化设计和排版。另外再提供一份 Word 版本。';
const START = '开始做吧。';

async function tempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-fb02-rev-'));
}

test('具体设计+Word 修改要求记为 queue_revision，不是含糊澄清', () => {
  assert.equal(isConcreteQueuedRevision(REVISION), true);
  assert.equal(isOwnerStartNowPhrase(START), true);
  assert.equal(
    classifyOwnerRevisionRoute({
      userText: REVISION,
      hasArtifact: true,
      intent: 'artifact_feedback',
    }),
    'queue_revision',
  );
});

test('模型说已经加入计划时，必须先有可查询的 pendingRevision', () => {
  const d = decideConverseEffects({
    parsed: {
      intent: 'artifact_feedback',
      confidence: 0.92,
      reply: '已经加入计划。',
    },
    modelAvailable: true,
    hasArtifact: true,
    jobRunning: false,
    userText: REVISION,
  });
  assert.equal(d.recordPendingRevision, true);
  assert.equal(d.startAuthorized, false);
  assert.equal(d.revisionRequestText, REVISION);
  assert.match(d.reply, /已经加入计划|已经记下/);
});

test('开始做吧 在有 pending 时授权唯一 revision；没有 pending 不得说已经就绪', () => {
  const ready = decideConverseEffects({
    parsed: { intent: 'confirm_start', confidence: 0.95, reply: '已经就绪。' },
    modelAvailable: true,
    hasArtifact: true,
    jobRunning: false,
    userText: START,
    pendingRevision: {
      text: REVISION,
      createdAt: new Date().toISOString(),
      sourceTurnId: 'turn_1',
    },
  });
  assert.equal(ready.startAuthorized, true);
  assert.equal(ready.startMode, 'revision');
  assert.equal(ready.revisionRequestText, REVISION);
  assert.doesNotMatch(ready.reply, /已经就绪/);

  const missing = decideConverseEffects({
    parsed: { intent: 'confirm_start', confidence: 0.95, reply: '已经就绪。' },
    modelAvailable: true,
    hasArtifact: true,
    jobRunning: false,
    userText: START,
  });
  assert.equal(missing.startAuthorized, false);
  assert.doesNotMatch(missing.reply, /已经就绪/);
  assert.match(missing.reply, /还没有记下具体要改什么|要改什么/);
});

test('完整路径：记下修订 → 开始做吧 → 只创建一个 revision Job；重放不重复', async () => {
  const root = await tempRoot();
  const runtime = createWorkRuntime({
    rootDir: root,
    subjectId: 'subj_test',
    fakeAdapter: {
      text: (input) => {
        const rev = String(input.revision?.request || '');
        return rev
          ? [
              '# 产品汇报 PPT（已按说明修改）',
              '',
              '已优化整体界面设计与排版，并提供 Word 版本。',
              '',
              rev,
              '',
              '## 进展',
              '',
              '- 封面重排',
              '- 要点与双栏',
              '',
              '## 结论',
              '',
              '- PPT 与 Word 一并交付',
            ].join('\n')
          : '# 产品汇报 PPT\n\n第一版内容。\n\n## 进展\n\n- 条目一\n- 条目二\n- 条目三';
      },
    },
  });
  await runtime.recoverOnStartup();
  runtime.start();
  const submitted = await runtime.submitTask({
    goal: '做一份产品汇报 PPT',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const firstJob = await waitForJobTerminal(runtime, submitted.jobId);
  assert.equal(firstJob.status, 'succeeded');
  const detail = await runtime.getTask({ taskId: submitted.taskId });
  const artifactId = detail.artifactIds[0];
  assert.ok(artifactId);

  await runtime.updatePendingRevision(submitted.taskId, {
    text: REVISION,
    createdAt: new Date().toISOString(),
    sourceTurnId: 'turn_owner_1',
  });
  const pending = (await runtime.getTask({ taskId: submitted.taskId })).task.meta
    ?.pendingRevisionRequest;
  assert.equal(pending?.text, REVISION);
  assert.ok(!pending?.consumedJobId);

  const first = await runtime.reviseArtifact({
    taskId: submitted.taskId,
    artifactId,
    revisionRequest: START,
    ownerTurnId: 'turn_start_1',
  });
  const replay = await runtime.reviseArtifact({
    taskId: submitted.taskId,
    artifactId,
    revisionRequest: START,
    ownerTurnId: 'turn_start_1',
  });
  assert.equal(replay.jobId, first.jobId);
  const second = await waitForJobTerminal(runtime, first.jobId);
  assert.equal(second.status, 'succeeded');
  assert.match(String(second.revisionRequest || ''), /优化设计和排版|Word/);
  const after = (await runtime.getTask({ taskId: submitted.taskId })).task.meta
    ?.pendingRevisionRequest;
  assert.equal(after?.consumedJobId, first.jobId);
  await runtime.stop();
});

test('ownerTurnId 是 Job 幂等事实：pending 写入失败后重试仍返回原 Job', async () => {
  const root = await tempRoot();
  let failOnce = true;
  const runtime = createWorkRuntime({
    rootDir: root,
    subjectId: 'subj_test',
    fakeAdapter: {
      text: (input) => {
        const rev = String(input.revision?.request || '');
        return rev
          ? [
              '# 产品汇报 PPT（已按说明修改）',
              '',
              '已优化整体界面设计与排版，并提供 Word 版本。',
              '',
              rev,
              '',
              '## 进展',
              '',
              '- 封面重排',
              '- 要点与双栏',
              '',
              '## 结论',
              '',
              '- PPT 与 Word 一并交付',
            ].join('\n')
          : '# 产品汇报 PPT\n\n第一版内容。\n\n## 进展\n\n- 条目一\n- 条目二\n- 条目三';
      },
    },
    afterRevisionJobQueuedForTest: async (job) => {
      assert.equal(String(job.ownerTurnId || ''), 'turn_fault_1');
      if (failOnce) {
        failOnce = false;
        throw new Error('injected pending write failure');
      }
    },
  });
  await runtime.recoverOnStartup();
  runtime.start();
  const submitted = await runtime.submitTask({
    goal: '做一份产品汇报 PPT',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const firstJob = await waitForJobTerminal(runtime, submitted.jobId);
  assert.equal(firstJob.status, 'succeeded');
  const detail = await runtime.getTask({ taskId: submitted.taskId });
  const artifactId = detail.artifactIds[0];
  assert.ok(artifactId);
  await runtime.updatePendingRevision(submitted.taskId, {
    text: REVISION,
    createdAt: new Date().toISOString(),
    sourceTurnId: 'turn_owner_1',
  });
  await assert.rejects(
    () =>
      runtime.reviseArtifact({
        taskId: submitted.taskId,
        artifactId,
        revisionRequest: START,
        ownerTurnId: 'turn_fault_1',
      }),
    /injected pending write failure/,
  );
  const stored = await runtime.listJobsForTask(submitted.taskId);
  const created = stored.find((j) => j.ownerTurnId === 'turn_fault_1');
  assert.ok(created, 'Job 必须已带 ownerTurnId 可查询');
  const pendingAfterFail = (await runtime.getTask({ taskId: submitted.taskId })).task.meta
    ?.pendingRevisionRequest;
  assert.ok(!pendingAfterFail?.consumedJobId);
  const retry = await runtime.reviseArtifact({
    taskId: submitted.taskId,
    artifactId,
    revisionRequest: START,
    ownerTurnId: 'turn_fault_1',
  });
  assert.equal(retry.jobId, created!.id);
  const again = await runtime.reviseArtifact({
    taskId: submitted.taskId,
    artifactId,
    revisionRequest: START,
    ownerTurnId: 'turn_fault_1',
  });
  assert.equal(again.jobId, created!.id);
  await runtime.stop();
});
