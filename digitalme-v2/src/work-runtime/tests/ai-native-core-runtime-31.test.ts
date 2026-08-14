/**
 * AI-NATIVE-CORE-RUNTIME-31
 * 规划确认是唯一主动作；执行输入必须带上确认规划；系统自动修订退出产品主链。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime, type DigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import type { ChatMessage } from '../../infrastructure/model-http';
import { createWorkRuntime } from '../create-runtime';
import { waitForJobTerminal } from '../job-runner';
import { maybeRunControlledRevisionAfterJob } from '../controlled-revision-runner';
import { formatCapabilityTaskAndPlan, type CapabilityInput } from '../../capability/adapter';
import { assembleDocumentPrompt } from '../../capability/adapters/prompt-assemble';
import { buildExecutorTaskPackage } from '../../execution/task-package';
import { THIN_RUNTIME_PATH } from '../thin-owner-start';

const UNIQUE_STEP = '先写入 imprint-unique-step.txt，内容必须是 CORE-RUNTIME-31-UNIQUE';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-runtime31-${prefix}-`));
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

interface ScriptedReply {
  intent: string;
  confidence: number;
  reply: string;
  planUpdate?: string;
  executionIntentKind?: string;
  expectedOutputFamily?: string;
}

function scriptedChat(replies: ScriptedReply[]) {
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
  dir: string,
  chat?: (input: { messages: ChatMessage[] }) => Promise<{ text: string }>,
) {
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    ...(chat ? { converseChat: chat } : {}),
  });
  const bus = createCommandBus(runtime);
  return { runtime, bus };
}

async function jobCount(runtime: DigitalMeRuntime, taskId: string): Promise<number> {
  return (await runtime.workRuntime.listJobsForTask(taskId)).length;
}

function sampleCapInput(overrides: Partial<CapabilityInput> = {}): CapabilityInput {
  return {
    goal: '写一份简报',
    snapshot: {
      id: 'snap_1',
      taskId: 'task_1',
      createdAt: new Date().toISOString(),
      items: [],
    },
    subjectContext: { subjectId: 's1', derivedAt: new Date().toISOString(), entries: [] },
    artifactType: 'document',
    ...overrides,
  };
}

describe('AI-NATIVE-CORE-RUNTIME-31', () => {
  it('非 thin：confirmPlan + planUpdate → 原版本 confirmed、无新 draft', async () => {
    const root = await tempDir('nontin-confirm');
    const { chat } = scriptedChat([
      {
        intent: 'add_goal_info',
        confidence: 0.95,
        reply: '规划已整理，确认后开始。',
        planUpdate: '目标：写一句话说明\n交付：一段文字\n路径：直接写\n准备：无\n边界：不外发',
      },
      {
        intent: 'confirm_start',
        confidence: 0.95,
        reply: '好，按当前方案开始。',
        planUpdate: '目标：写一句话说明（同轮不应生效的升版）\n交付：被忽略',
        executionIntentKind: 'create_document',
        expectedOutputFamily: 'document',
      },
    ]);
    const { runtime, bus } = await makeDigitalRuntime(root, chat);
    await bus.invoke('subject.createPackage', {
      displayName: '确认主体',
      targetDir: path.join(root, 'pkg'),
    });
    const first = await bus.invoke('work.converse', { text: '帮我写一句话说明' });
    assert.equal(first.plan?.version, 1);
    assert.equal(first.plan?.status, 'draft');
    const confirm = await bus.invoke('work.converse', {
      taskId: first.taskId,
      text: '按这个做吧，开始。',
    });
    assert.equal(confirm.startAuthorized, true);
    assert.equal(confirm.plan?.status, 'confirmed');
    assert.equal(confirm.plan?.version, 1, '不得因同轮 planUpdate 升版');
    assert.doesNotMatch(String(confirm.plan?.content || ''), /不应生效/);
    await runtime.stop();
  });

  it('thin：确认开始即使附带 planUpdate 也不升版', async () => {
    const root = await tempDir('thin-confirm');
    const folder = await makeSoftwareFolder(root);
    const { chat } = scriptedChat([
      {
        intent: 'add_goal_info',
        confidence: 0.95,
        reply: '这是当前方案，确认后开始。',
        planUpdate:
          '目标：改 formatLabel\n交付：改好并通过检查\n路径：阅读项目后修改\n准备：已有项目位置\n边界：不提交不推送',
      },
      {
        intent: 'confirm_start',
        confidence: 0.95,
        reply: '好，开始。',
        planUpdate: '目标：修 formatLabel（补充说明）\n交付：同上',
        executionIntentKind: 'modify_code',
        expectedOutputFamily: 'code-change',
      },
    ]);
    const { runtime, bus } = await makeDigitalRuntime(root, chat);
    await bus.invoke('subject.createPackage', {
      displayName: '薄主链主体',
      targetDir: path.join(root, 'pkg'),
    });
    const first = await bus.invoke('work.converse', {
      text: '通读仓库文件，让 formatLabel 在输入 start 时返回 start-processing 并跑测试',
      contextRefs: [{ kind: 'folder', path: folder, projectOrigin: 'user_selected' }],
    });
    assert.equal(first.runtimePath, THIN_RUNTIME_PATH);
    assert.equal(first.plan?.version, 1);
    const confirm = await bus.invoke('work.converse', {
      taskId: first.taskId,
      text: '按这个做吧，开始。',
    });
    assert.equal(confirm.plan?.status, 'confirmed');
    assert.equal(confirm.plan?.version, 1);
    assert.equal(confirm.executionIntentKind, 'modify_code');
    await runtime.stop();
  });

  it('真正修改规划 → 正常升版 draft，不启动', async () => {
    const root = await tempDir('modify-plan');
    const { chat } = scriptedChat([
      {
        intent: 'add_goal_info',
        confidence: 0.95,
        reply: '规划已整理。',
        planUpdate: '目标：写一句话说明\n交付：一段文字',
      },
      {
        intent: 'modify_plan',
        confidence: 0.95,
        reply: '已按你的意见改成第二版，确认后再开始。',
        planUpdate: '目标：写一句话说明\n交付：两段文字\n新增：记录出处',
      },
    ]);
    const { runtime, bus } = await makeDigitalRuntime(root, chat);
    await bus.invoke('subject.createPackage', {
      displayName: '改规划主体',
      targetDir: path.join(root, 'pkg'),
    });
    const first = await bus.invoke('work.converse', { text: '帮我写一句话说明' });
    const modified = await bus.invoke('work.converse', {
      taskId: first.taskId,
      text: '请改成两段，并记下出处。',
    });
    assert.equal(modified.startAuthorized, false);
    assert.equal(modified.plan?.status, 'draft');
    assert.equal(modified.plan?.version, 2);
    assert.match(String(modified.plan?.content || ''), /记录出处/);
    assert.equal(await jobCount(runtime, first.taskId), 0);
    await runtime.stop();
  });

  it('一次确认 → 恰好一个 Job', async () => {
    const root = await tempDir('one-job');
    const { chat } = scriptedChat([
      {
        intent: 'add_goal_info',
        confidence: 0.95,
        reply: '规划已整理，确认后开始。',
        planUpdate: '目标：写一句话说明\n交付：一段文字',
      },
      {
        intent: 'confirm_start',
        confidence: 0.95,
        reply: '好，按当前方案开始。',
        planUpdate: '不应升版的附带规划',
        executionIntentKind: 'create_document',
        expectedOutputFamily: 'document',
      },
    ]);
    const { runtime, bus } = await makeDigitalRuntime(root, chat);
    await bus.invoke('subject.createPackage', {
      displayName: '一确认主体',
      targetDir: path.join(root, 'pkg'),
    });
    const first = await bus.invoke('work.converse', { text: '帮我写一句话说明' });
    const confirm = await bus.invoke('work.converse', {
      taskId: first.taskId,
      text: '按这个做吧，开始。',
    });
    assert.equal(confirm.startAuthorized, true);
    assert.equal(await jobCount(runtime, first.taskId), 0);
    const submitted = await bus.invoke('work.submitTask', {
      goal: '帮我写一句话说明',
      contextRefs: [],
      requestedArtifactType: 'document',
      existingTaskId: first.taskId,
      confirmedPlanVersion: 1,
    });
    assert.ok(submitted.jobId);
    await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 15_000);
    assert.equal(await jobCount(runtime, first.taskId), 1);
    await runtime.stop();
  });

  it('执行器输入包含确认规划的独有内容，且 Job 可追溯规划版本', async () => {
    const root = await tempDir('plan-in-input');
    const captured: CapabilityInput[] = [];
    const { chat } = scriptedChat([
      {
        intent: 'add_goal_info',
        confidence: 0.95,
        reply: '规划已整理，确认后开始。',
        planUpdate: `目标：写一份简报\n步骤：${UNIQUE_STEP}`,
      },
      {
        intent: 'confirm_start',
        confidence: 0.95,
        reply: '好，按当前方案开始。',
        executionIntentKind: 'create_document',
        expectedOutputFamily: 'document',
      },
    ]);
    const runtime = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      converseChat: chat,
      fakeAdapter: {
        onExecute: (info) => {
          captured.push(info.input);
        },
      },
    });
    const bus = createCommandBus(runtime);
    await bus.invoke('subject.createPackage', {
      displayName: '规划入执行主体',
      targetDir: path.join(root, 'pkg'),
    });
    const goal = '写一份简报';
    const first = await bus.invoke('work.converse', { text: goal });
    await bus.invoke('work.converse', { taskId: first.taskId, text: '按这个做吧，开始。' });
    const submitted = await bus.invoke('work.submitTask', {
      goal,
      contextRefs: [],
      requestedArtifactType: 'document',
      existingTaskId: first.taskId,
      confirmedPlanVersion: 1,
    });
    await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 15_000);
    const jobs = await runtime.workRuntime.listJobsForTask(first.taskId);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.confirmedPlanSnapshot?.version, 1);
    assert.match(String(jobs[0]?.confirmedPlanSnapshot?.content || ''), /imprint-unique-step\.txt/);
    const last = captured[captured.length - 1];
    assert.ok(last);
    assert.equal(last.goal, goal);
    assert.doesNotMatch(last.goal, /imprint-unique-step/);
    assert.ok(last.confirmedPlan);
    assert.match(last.confirmedPlan.content, /imprint-unique-step\.txt/);
    assert.match(formatCapabilityTaskAndPlan(last), /CORE-RUNTIME-31-UNIQUE/);
    const prompt = await assembleDocumentPrompt(last, async () => '');
    assert.match(prompt.messages.map((m) => m.content).join('\n'), /CORE-RUNTIME-31-UNIQUE/);
    const pkg = buildExecutorTaskPackage({
      taskId: first.taskId,
      jobId: submitted.jobId,
      goal: formatCapabilityTaskAndPlan(last),
      workingDirectory: root,
      executorId: 'external-executor-codex-cli',
      executorSelectionReason: 'test',
    });
    assert.match(pkg.goal, /CORE-RUNTIME-31-UNIQUE/);
    assert.doesNotMatch(last.goal, /CORE-RUNTIME-31-UNIQUE/);
    await runtime.stop();
  });

  it('Job 成功 + CTO needs_revision → 零自动修订 Job', async () => {
    const root = await tempDir('no-auto-rev');
    const runtime = createWorkRuntime({
      rootDir: root,
      subjectId: 'subj_31',
      fakeAdapter: { delayMs: 5 },
    });
    await runtime.recoverOnStartup();
    runtime.start();
    const submitted = await runtime.submitTask({
      goal: '写一份简报',
      contextRefs: [],
      requestedArtifactType: 'document',
    });
    await waitForJobTerminal(runtime, submitted.jobId, 10_000);
    const before = await runtime.listJobsForTask(submitted.taskId);
    const artifactId = before[0]?.artifactId;
    assert.ok(artifactId);
    const result = await maybeRunControlledRevisionAfterJob(
      {
        getTask: (id) => runtime.getTaskRecord(id),
        withTaskExclusive: (id, fn) => runtime.runExclusiveForTask(id, fn),
        updateRevisionLoop: (id, patch) => runtime.updateTaskRevisionLoopAlreadyLocked(id, patch),
        appendConversation: async () => undefined,
        findActiveJob: async () => null,
        getArtifactContent: async () => ({
          versionId: 'ver_1',
          acceptanceSummary: {
            ctoReview: {
              decision: 'needs_revision',
              revisionDirective: UNIQUE_STEP,
              findings: ['缺步骤'],
            },
          },
        }),
        reviseArtifact: (input) => runtime.reviseArtifactAlreadyLocked(input),
        nowIso: () => new Date().toISOString(),
      },
      { taskId: submitted.taskId, jobId: submitted.jobId, artifactId },
    );
    assert.equal(result.action, 'noop');
    assert.equal(result.reason, 'product_main_chain_no_auto_revision');
    const after = await runtime.listJobsForTask(submitted.taskId);
    assert.equal(after.length, before.length);
    await runtime.stop();
  });

  it('Owner 明确修订 → 恰好一个新 Job', async () => {
    const root = await tempDir('owner-revise');
    const runtime = createWorkRuntime({
      rootDir: root,
      subjectId: 'subj_31',
      fakeAdapter: { delayMs: 5 },
    });
    await runtime.recoverOnStartup();
    runtime.start();
    const submitted = await runtime.submitTask({
      goal: '写一份简报',
      contextRefs: [],
      requestedArtifactType: 'document',
    });
    await waitForJobTerminal(runtime, submitted.jobId, 10_000);
    const before = await runtime.listJobsForTask(submitted.taskId);
    const artifactId = before[0]?.artifactId;
    assert.ok(artifactId);
    const revised = await runtime.reviseArtifact({
      taskId: submitted.taskId,
      artifactId,
      revisionRequest: '按验收意见补上缺的步骤。',
    });
    assert.ok(revised.jobId);
    assert.notEqual(revised.jobId, submitted.jobId);
    const mid = await runtime.listJobsForTask(submitted.taskId);
    assert.equal(mid.length, before.length + 1);
    await waitForJobTerminal(runtime, revised.jobId, 10_000);
    const after = await runtime.listJobsForTask(submitted.taskId);
    assert.equal(after.length, before.length + 1);
    await runtime.stop();
  });

  it('重复成功事件 → 不产生自动修订', async () => {
    const root = await tempDir('repeat-success');
    const runtime = createWorkRuntime({
      rootDir: root,
      subjectId: 'subj_31',
      fakeAdapter: { delayMs: 5 },
    });
    await runtime.recoverOnStartup();
    runtime.start();
    const submitted = await runtime.submitTask({
      goal: '写一份简报',
      contextRefs: [],
      requestedArtifactType: 'document',
    });
    await waitForJobTerminal(runtime, submitted.jobId, 10_000);
    const artifactId = (await runtime.listJobsForTask(submitted.taskId))[0]?.artifactId;
    assert.ok(artifactId);
    const deps = {
      getTask: (id: string) => runtime.getTaskRecord(id),
      withTaskExclusive: <T>(id: string, fn: () => Promise<T>) => runtime.runExclusiveForTask(id, fn),
      updateRevisionLoop: (id: string, patch: Parameters<typeof runtime.updateTaskRevisionLoopAlreadyLocked>[1]) =>
        runtime.updateTaskRevisionLoopAlreadyLocked(id, patch),
      appendConversation: async () => undefined,
      findActiveJob: async () => null,
      getArtifactContent: async () => ({
        versionId: 'ver_1',
        acceptanceSummary: {
          ctoReview: { decision: 'needs_revision', revisionDirective: '再改一版' },
        },
      }),
      reviseArtifact: (input: { taskId: string; artifactId: string; revisionRequest: string }) =>
        runtime.reviseArtifactAlreadyLocked(input),
      nowIso: () => new Date().toISOString(),
    };
    const before = (await runtime.listJobsForTask(submitted.taskId)).length;
    await Promise.all([
      maybeRunControlledRevisionAfterJob(deps, {
        taskId: submitted.taskId,
        jobId: submitted.jobId,
        artifactId,
      }),
      maybeRunControlledRevisionAfterJob(deps, {
        taskId: submitted.taskId,
        jobId: submitted.jobId,
        artifactId,
      }),
    ]);
    const again = await maybeRunControlledRevisionAfterJob(deps, {
      taskId: submitted.taskId,
      jobId: submitted.jobId,
      artifactId,
    });
    assert.equal(again.action, 'noop');
    assert.equal((await runtime.listJobsForTask(submitted.taskId)).length, before);
    await runtime.stop();
  });

  it('formatCapabilityTaskAndPlan：原始目标与确认规划同时进入执行载荷', () => {
    const input = sampleCapInput({
      goal: '写一份简报',
      confirmedPlan: {
        version: 2,
        content: UNIQUE_STEP,
      },
    });
    const text = formatCapabilityTaskAndPlan(input);
    assert.match(text, /原始目标：写一份简报/);
    assert.match(text, /必须按此方案执行/);
    assert.match(text, /CORE-RUNTIME-31-UNIQUE/);
  });
});
