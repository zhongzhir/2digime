/**
 * AI-NATIVE-CORE-RUNTIME-31A
 * 确认规划在创建 Job 时冻结为不可变快照；执行只读该快照，不读当前 Task.meta.plan。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime, type DigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import type { ChatMessage } from '../../infrastructure/model-http';
import { waitForJobTerminal } from '../job-runner';
import {
  confirmedPlanFromJob,
  freezeConfirmedPlanSnapshot,
} from '../confirmed-plan-execution';
import { formatCapabilityTaskAndPlan, type CapabilityInput } from '../../capability/adapter';
import {
  applyAuthorizationProjectionToInput,
  projectRemoteAuthorization,
  DEFAULT_ALLOWED_FIELDS,
} from '../../capability/remote-authorization';
import type { ExecutionJob } from '../execution-job';
import type { Task } from '../task';
import { THIN_RUNTIME_PATH } from '../thin-owner-start';

const V1_STEP = '本 Job 必须执行 CORE-RUNTIME-31A-V1 步骤';
const V2_STEP = '这是后来的 CORE-RUNTIME-31A-V2-SHOULD-NOT-EXECUTE';
const V1_PLAN = `目标：写一份简报\n步骤：${V1_STEP}`;
const V2_PLAN = `目标：写一份简报\n步骤：${V2_STEP}`;

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-runtime31a-${prefix}-`));
}

async function makeSoftwareFolder(root: string): Promise<string> {
  const folder = path.join(root, 'fixture-project');
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(
    path.join(folder, 'package.json'),
    JSON.stringify({ name: 'fixture-project', private: true }),
    'utf8',
  );
  return folder;
}

function scriptedChat(
  replies: Array<{ intent: string; confidence: number; reply: string; planUpdate?: string; executionIntentKind?: string; expectedOutputFamily?: string }>,
) {
  let i = 0;
  const chat = async ({ messages }: { messages: ChatMessage[] }) => {
    void messages;
    const r = replies[Math.min(i, replies.length - 1)]!;
    i += 1;
    return {
      text: JSON.stringify({
        intent: r.intent,
        confidence: r.confidence,
        reply: r.reply,
        ...(r.planUpdate ? { planUpdate: r.planUpdate } : {}),
        ...(r.executionIntentKind ? { executionIntentKind: r.executionIntentKind } : {}),
        ...(r.expectedOutputFamily ? { expectedOutputFamily: r.expectedOutputFamily } : {}),
      }),
    };
  };
  return { chat };
}

async function makeDigitalRuntime(
  chat?: (input: { messages: ChatMessage[] }) => Promise<{ text: string }>,
  fakeAdapter?: { onExecute?: (info: { input: CapabilityInput }) => void },
) {
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    ...(chat ? { converseChat: chat } : {}),
    ...(fakeAdapter ? { fakeAdapter } : {}),
  });
  const bus = createCommandBus(runtime);
  return { runtime, bus };
}

async function confirmPlanThenStopPump(
  bus: ReturnType<typeof createCommandBus>,
  runtime: DigitalMeRuntime,
  opts: { text: string; planUpdate: string; contextRefs?: Array<{ kind: 'folder'; path: string; projectOrigin: 'user_selected' }> },
) {
  const first = await bus.invoke('work.converse', {
    text: opts.text,
    ...(opts.contextRefs ? { contextRefs: opts.contextRefs } : {}),
  });
  const confirm = await bus.invoke('work.converse', {
    taskId: first.taskId,
    text: '按这个做吧，开始。',
  });
  assert.equal(confirm.plan?.status, 'confirmed');
  assert.equal(confirm.plan?.version, 1);
  await runtime.workRuntime.stop();
  return first.taskId as string;
}

describe('AI-NATIVE-CORE-RUNTIME-31A', () => {
  it('快照只读 Job；当前 Task 规划变化不影响 confirmedPlanFromJob', () => {
    const now = new Date().toISOString();
    const taskV1: Task = {
      id: 'task_1',
      subjectId: 's1',
      createdAt: now,
      goal: '写一份简报',
      contextRefs: [],
      requestedArtifactType: 'document',
      meta: {
        plan: { version: 1, status: 'confirmed', content: V1_PLAN, updatedAt: now, confirmedAt: now },
      },
    };
    const snap = freezeConfirmedPlanSnapshot(taskV1);
    assert.equal(snap?.version, 1);
    assert.match(snap!.content, /CORE-RUNTIME-31A-V1/);
    const job: ExecutionJob = {
      id: 'job_1',
      taskId: 'task_1',
      capabilityId: 'cap_fake_document',
      createdAt: now,
      status: 'queued',
      confirmedPlanSnapshot: snap,
    };
    taskV1.meta = {
      plan: { version: 2, status: 'draft', content: V2_PLAN, updatedAt: now },
    };
    const fromJob = confirmedPlanFromJob(job);
    assert.equal(fromJob?.version, 1);
    assert.match(fromJob!.content, /CORE-RUNTIME-31A-V1/);
    assert.doesNotMatch(fromJob!.content, /SHOULD-NOT-EXECUTE/);
    assert.equal(freezeConfirmedPlanSnapshot(taskV1), undefined);
  });

  it('远程 Job 序列化/反序列化后仍使用 v1；投影不读 Task', () => {
    const now = new Date().toISOString();
    const job: ExecutionJob = {
      id: 'job_remote',
      taskId: 'task_1',
      capabilityId: 'cap_fake_document',
      createdAt: now,
      status: 'queued',
      confirmedPlanSnapshot: { version: 1, content: V1_PLAN },
    };
    const roundtrip = JSON.parse(JSON.stringify(job)) as ExecutionJob;
    const fromJob = confirmedPlanFromJob(roundtrip);
    assert.equal(fromJob?.version, 1);
    assert.match(fromJob!.content, /CORE-RUNTIME-31A-V1/);
    const input: CapabilityInput = {
      goal: '写一份简报',
      snapshot: { id: 'snap_1', taskId: 'task_1', createdAt: now, items: [] },
      subjectContext: { subjectId: 's1', derivedAt: now, entries: [] },
      artifactType: 'document',
      confirmedPlan: fromJob,
    };
    const auth = projectRemoteAuthorization({
      goal: input.goal,
      allowedMaterialPaths: [],
      defaults: { allowedFields: [...DEFAULT_ALLOWED_FIELDS] },
    });
    assert.ok(auth.allowedFields.includes('confirmedPlan'));
    const prepared = applyAuthorizationProjectionToInput(
      JSON.parse(JSON.stringify(input)) as CapabilityInput,
      auth,
    );
    assert.equal(prepared.confirmedPlan?.version, 1);
    assert.match(String(prepared.confirmedPlan?.content), /CORE-RUNTIME-31A-V1/);
    assert.doesNotMatch(formatCapabilityTaskAndPlan(prepared), /SHOULD-NOT-EXECUTE/);
  });

  it('排队 Job 在启动前 Task 改成 v2：执行器仍收到 v1，Job 追溯为 v1', async () => {
    const root = await tempDir('queued-race');
    const captured: CapabilityInput[] = [];
    const { chat } = scriptedChat([
      {
        intent: 'add_goal_info',
        confidence: 0.95,
        reply: '规划已整理，确认后开始。',
        planUpdate: V1_PLAN,
      },
      {
        intent: 'confirm_start',
        confidence: 0.95,
        reply: '好，按当前方案开始。',
        executionIntentKind: 'create_document',
        expectedOutputFamily: 'document',
      },
    ]);
    const { runtime, bus } = await makeDigitalRuntime(chat, {
      onExecute: (info) => {
        captured.push(info.input);
      },
    });
    await bus.invoke('subject.createPackage', {
      displayName: '竞态主体',
      targetDir: path.join(root, 'pkg'),
    });
    const taskId = await confirmPlanThenStopPump(bus, runtime, {
      text: '写一份简报',
      planUpdate: V1_PLAN,
    });
    const submitted = await bus.invoke('work.submitTask', {
      goal: '写一份简报',
      contextRefs: [],
      requestedArtifactType: 'document',
      existingTaskId: taskId,
      confirmedPlanVersion: 1,
    });
    assert.ok(submitted.jobId);
    const queued = await runtime.workRuntime.getJob(submitted.jobId);
    assert.equal(queued?.status, 'queued');
    assert.equal(queued?.confirmedPlanSnapshot?.version, 1);
    assert.match(String(queued?.confirmedPlanSnapshot?.content), /CORE-RUNTIME-31A-V1/);
    const now = new Date().toISOString();
    await runtime.workRuntime.updateTaskPlan(taskId, {
      version: 2,
      status: 'draft',
      content: V2_PLAN,
      updatedAt: now,
    });
    const taskAfter = await runtime.getTask({ taskId });
    assert.equal(taskAfter.task.meta?.plan?.version, 2);
    assert.match(String(taskAfter.task.meta?.plan?.content), /SHOULD-NOT-EXECUTE/);
    runtime.workRuntime.start();
    await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 15_000);
    const done = await runtime.workRuntime.getJob(submitted.jobId);
    assert.equal(done?.confirmedPlanSnapshot?.version, 1);
    assert.match(String(done?.confirmedPlanSnapshot?.content), /CORE-RUNTIME-31A-V1/);
    const last = captured[captured.length - 1];
    assert.ok(last);
    assert.equal(last.goal, '写一份简报');
    assert.doesNotMatch(last.goal, /CORE-RUNTIME-31A/);
    assert.equal(last.confirmedPlan?.version, 1);
    assert.match(String(last.confirmedPlan?.content), /CORE-RUNTIME-31A-V1/);
    assert.doesNotMatch(String(last.confirmedPlan?.content), /SHOULD-NOT-EXECUTE/);
    assert.doesNotMatch(formatCapabilityTaskAndPlan(last), /SHOULD-NOT-EXECUTE/);
    await runtime.stop();
  });

  it('重启恢复后执行仍使用 v1', async () => {
    const root = await tempDir('recover-v1');
    const pkgDir = path.join(root, 'pkg');
    const { chat } = scriptedChat([
      {
        intent: 'add_goal_info',
        confidence: 0.95,
        reply: '规划已整理，确认后开始。',
        planUpdate: V1_PLAN,
      },
      {
        intent: 'confirm_start',
        confidence: 0.95,
        reply: '好，按当前方案开始。',
        executionIntentKind: 'create_document',
        expectedOutputFamily: 'document',
      },
    ]);
    const firstRt = await makeDigitalRuntime(chat);
    await firstRt.bus.invoke('subject.createPackage', {
      displayName: '恢复主体',
      targetDir: pkgDir,
    });
    const taskId = await confirmPlanThenStopPump(firstRt.bus, firstRt.runtime, {
      text: '写一份简报',
      planUpdate: V1_PLAN,
    });
    const submitted = await firstRt.bus.invoke('work.submitTask', {
      goal: '写一份简报',
      contextRefs: [],
      requestedArtifactType: 'document',
      existingTaskId: taskId,
      confirmedPlanVersion: 1,
    });
    await firstRt.runtime.workRuntime.updateTaskPlan(taskId, {
      version: 2,
      status: 'draft',
      content: V2_PLAN,
      updatedAt: new Date().toISOString(),
    });
    const queued = await firstRt.runtime.workRuntime.getJob(submitted.jobId);
    assert.equal(queued?.status, 'queued');
    assert.equal(queued?.confirmedPlanSnapshot?.version, 1);
    await firstRt.runtime.stop();

    const captured: CapabilityInput[] = [];
    const secondRt = await makeDigitalRuntime(undefined, {
      onExecute: (info) => {
        captured.push(info.input);
      },
    });
    await secondRt.bus.invoke('subject.openPackage', { dir: pkgDir });
    await waitForJobTerminal(secondRt.runtime.workRuntime, submitted.jobId, 15_000);
    const recovered = await secondRt.runtime.workRuntime.getJob(submitted.jobId);
    assert.equal(recovered?.confirmedPlanSnapshot?.version, 1);
    assert.match(String(recovered?.confirmedPlanSnapshot?.content), /CORE-RUNTIME-31A-V1/);
    const last = captured[captured.length - 1];
    assert.ok(last);
    assert.equal(last.confirmedPlan?.version, 1);
    assert.match(String(last.confirmedPlan?.content), /CORE-RUNTIME-31A-V1/);
    assert.doesNotMatch(String(last.confirmedPlan?.content), /SHOULD-NOT-EXECUTE/);
    const task = await secondRt.runtime.getTask({ taskId });
    assert.equal(task.task.meta?.plan?.version, 2);
    await secondRt.runtime.stop();
  });

  it('非 thin：确认与 submitTask 之间规划升版 → 明确拒绝，不静默建 Job', async () => {
    const root = await tempDir('ipc-nontin');
    const { chat } = scriptedChat([
      {
        intent: 'add_goal_info',
        confidence: 0.95,
        reply: '规划已整理，确认后开始。',
        planUpdate: V1_PLAN,
      },
      {
        intent: 'confirm_start',
        confidence: 0.95,
        reply: '好，按当前方案开始。',
        executionIntentKind: 'create_document',
        expectedOutputFamily: 'document',
      },
    ]);
    const { runtime, bus } = await makeDigitalRuntime(chat);
    await bus.invoke('subject.createPackage', {
      displayName: 'IPC 非薄',
      targetDir: path.join(root, 'pkg'),
    });
    const first = await bus.invoke('work.converse', { text: '写一份简报' });
    await bus.invoke('work.converse', { taskId: first.taskId, text: '按这个做吧，开始。' });
    await runtime.workRuntime.updateTaskPlan(first.taskId, {
      version: 2,
      status: 'draft',
      content: V2_PLAN,
      updatedAt: new Date().toISOString(),
    });
    await assert.rejects(
      () =>
        bus.invoke('work.submitTask', {
          goal: '写一份简报',
          contextRefs: [],
          requestedArtifactType: 'document',
          existingTaskId: first.taskId,
          confirmedPlanVersion: 1,
        }),
      (err: unknown) => {
        const e = err as { code?: string };
        assert.equal(e.code, 'plan_version_mismatch');
        return true;
      },
    );
    assert.equal((await runtime.workRuntime.listJobsForTask(first.taskId)).length, 0);
    await runtime.stop();
  });

  it('thin：确认与 submitTask 之间规划升版 → 明确拒绝，不静默建 Job', async () => {
    const root = await tempDir('ipc-thin');
    const folder = await makeSoftwareFolder(root);
    const { chat } = scriptedChat([
      {
        intent: 'add_goal_info',
        confidence: 0.95,
        reply: '这是当前方案，确认后开始。',
        planUpdate: V1_PLAN,
      },
      {
        intent: 'confirm_start',
        confidence: 0.95,
        reply: '好，开始。',
        executionIntentKind: 'create_document',
        expectedOutputFamily: 'document',
      },
    ]);
    const { runtime, bus } = await makeDigitalRuntime(chat);
    await bus.invoke('subject.createPackage', {
      displayName: 'IPC 薄主链',
      targetDir: path.join(root, 'pkg'),
    });
    const first = await bus.invoke('work.converse', {
      text: '通读仓库文件，让 formatLabel 在输入 start 时返回 start-processing 并跑测试',
      contextRefs: [{ kind: 'folder', path: folder, projectOrigin: 'user_selected' }],
    });
    assert.equal(first.runtimePath, THIN_RUNTIME_PATH);
    await bus.invoke('work.converse', { taskId: first.taskId, text: '按这个做吧，开始。' });
    await runtime.workRuntime.updateTaskPlan(first.taskId, {
      version: 2,
      status: 'draft',
      content: V2_PLAN,
      updatedAt: new Date().toISOString(),
    });
    await assert.rejects(
      () =>
        bus.invoke('work.submitTask', {
          goal: '通读仓库文件，让 formatLabel 在输入 start 时返回 start-processing 并跑测试',
          contextRefs: [{ kind: 'folder', path: folder, projectOrigin: 'user_selected' }],
          existingTaskId: first.taskId,
          confirmedPlanVersion: 1,
        }),
      (err: unknown) => {
        const e = err as { code?: string };
        assert.equal(e.code, 'plan_version_mismatch');
        return true;
      },
    );
    assert.equal((await runtime.workRuntime.listJobsForTask(first.taskId)).length, 0);
    await runtime.stop();
  });

  it('源码：执行装配只读 Job 快照，不再从 Task.meta.plan 取确认正文', async () => {
    const repoRoot = path.resolve(__dirname, '../../..');
    const runner = await fs.readFile(path.join(repoRoot, 'src/work-runtime/job-runner.ts'), 'utf8');
    const helper = await fs.readFile(
      path.join(repoRoot, 'src/work-runtime/confirmed-plan-execution.ts'),
      'utf8',
    );
    assert.match(runner, /confirmedPlanFromJob\(/);
    assert.match(runner, /freezeConfirmedPlanSnapshot\(/);
    assert.doesNotMatch(runner, /resolvedConfirmedPlan\(/);
    assert.match(helper, /禁止回退到当前 Task\.meta\.plan/);
    assert.match(
      helper,
      /export function confirmedPlanFromJob\([\s\S]*job\?/,
    );
    assert.doesNotMatch(
      helper.slice(helper.indexOf('export function confirmedPlanFromJob')),
      /task\.meta\?\.plan/,
    );
  });
});
