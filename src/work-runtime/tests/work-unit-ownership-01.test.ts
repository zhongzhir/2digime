/**
 * DIGITALME-WORK-UNIT-OWNERSHIP-01
 * Turn → Task → Job 显式身份；新目标不写入已完成 Task；
 * converse 瞬时降级在同一 Task/Turn 恢复；确认不得打到旧 Task。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import type { ChatMessage } from '../../infrastructure/model-http';
import { waitForJobTerminal } from '../job-runner';
import {
  resolveConverseBinding,
  staleConfirmationError,
  STALE_CONFIRMATION_CODE,
} from '../work-unit-ownership';
import type { WorkConverseIntent } from '../work-converse';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-own-${prefix}-`));
}

function planBody(goal: string): string {
  return [
    `目标：${goal}`,
    '交付：一份可直接使用的说明文档',
    '路径：1. 整理要点；2. 写成文档',
    '准备：无',
    '边界：不提交不推送',
  ].join('\n');
}

function jsonChatText(r: {
  intent: WorkConverseIntent;
  confidence: number;
  reply: string;
  planUpdate?: string;
  executionIntentKind?: string;
  expectedOutputFamily?: string;
}): string {
  return JSON.stringify({
    intent: r.intent,
    confidence: r.confidence,
    reply: r.reply,
    ...(r.planUpdate ? { planUpdate: r.planUpdate } : {}),
    ...(r.executionIntentKind ? { executionIntentKind: r.executionIntentKind } : {}),
    ...(r.expectedOutputFamily ? { expectedOutputFamily: r.expectedOutputFamily } : {}),
  });
}

const startReply = {
  intent: 'confirm_start' as const,
  confidence: 0.95,
  reply: '好的，开始。',
  executionIntentKind: 'create_document',
  expectedOutputFamily: 'document',
};

function scriptedChat(
  replies: Array<{
    intent: WorkConverseIntent;
    confidence: number;
    reply: string;
    planUpdate?: string;
    executionIntentKind?: string;
    expectedOutputFamily?: string;
  }>,
  opts?: { throwFirst?: number },
) {
  let throwsLeft = opts?.throwFirst ?? 0;
  const chat = async ({ messages }: { messages: ChatMessage[] }) => {
    if (throwsLeft > 0) {
      throwsLeft -= 1;
      throw new Error('transient model unavailable');
    }
    const sys = String(messages[0]?.content || '');
    const last = String(messages[messages.length - 1]?.content || '');
    const blob = messages.map((m) => String(m.content || '')).join('\n');
    if (/选择真正相关的已有上下文/.test(sys)) {
      return { text: JSON.stringify({ relevantContextIds: [] }) };
    }
    if (/【用户最新输入】/.test(blob) === false) {
      return { text: JSON.stringify({ queries: [], relevantContextIds: [] }) };
    }
    const userText = (blob.split('【用户最新输入】').pop() || '').trim().split('\n')[0] || '';
    if (/^确认/.test(userText) || userText === '按这个方案开始吧') {
      return { text: jsonChatText(startReply) };
    }
    const discuss = replies.find((r) => r.intent === 'discuss_or_question');
    if (discuss) return { text: jsonChatText(discuss) };
    const goalLine = blob.match(/任务目标：([^\n]+)/);
    const goal = userText || String(goalLine?.[1] || '').trim() || '当前目标';
    const matched = replies.find((r) => r.planUpdate && r.planUpdate.includes(goal.slice(0, 12)));
    if (matched) return { text: jsonChatText(matched) };
    return {
      text: jsonChatText({
        intent: 'add_goal_info',
        confidence: 0.95,
        reply: `已形成规划：${goal}`,
        planUpdate: planBody(goal),
        executionIntentKind: 'create_document',
        expectedOutputFamily: 'document',
      }),
    };
  };
  return { chat };
}

async function makeRuntime(
  dir: string,
  chat?: (input: { messages: ChatMessage[] }) => Promise<{ text: string }>,
) {
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    ...(chat ? { converseChat: chat } : {}),
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', {
    displayName: '所有权主体',
    targetDir: path.join(dir, 'pkg'),
  });
  return { runtime, bus };
}

function requiredOrigin(res: { originTurnId?: string }): string {
  assert.ok(res.originTurnId);
  return res.originTurnId;
}

describe('DIGITALME-WORK-UNIT-OWNERSHIP-01', () => {
  it('binding: new ignores leaked taskId; stale confirm rejected', () => {
    assert.deepEqual(resolveConverseBinding({ workUnit: 'new', requestedTaskId: 'task_old' }), {
      action: 'create_new',
    });
    assert.deepEqual(
      resolveConverseBinding({
        workUnit: 'confirm',
        requestedTaskId: 'task_old',
        closedForNewExecution: true,
      }),
      { action: 'reject_stale_confirm', taskId: 'task_old' },
    );
    assert.deepEqual(resolveConverseBinding({ workUnit: 'confirm' }), {
      action: 'reject_stale_confirm',
      taskId: '',
    });
    assert.equal(
      (staleConfirmationError() as Error & { code?: string }).code,
      STALE_CONFIRMATION_CODE,
    );
  });

  it('T1: 新研究目标不写入已完成炒蛋 Task；确认旧 Task 被拒绝', async () => {
    const root = await tempDir('t1');
    const cookGoal = '写一份番茄炒蛋家常做法，别掺项目的事。';
    const hireGoal =
      '欧美招人用生成式模型筛简历，监管最近有没有实质变化？我们产品会碰到人事决策，接下来半年合规上该先盯哪些。';
    const { chat } = scriptedChat([
      {
        intent: 'add_goal_info',
        confidence: 0.95,
        reply: '收到炒蛋规划。',
        planUpdate: planBody(cookGoal),
        executionIntentKind: 'create_document',
        expectedOutputFamily: 'document',
      },
      startReply,
      {
        intent: 'add_goal_info',
        confidence: 0.95,
        reply: '收到招聘监管规划。',
        planUpdate: planBody(hireGoal),
        executionIntentKind: 'create_document',
        expectedOutputFamily: 'document',
      },
    ]);
    const { runtime, bus } = await makeRuntime(root, chat);
    const cook = await bus.invoke('work.converse', { text: cookGoal, workUnit: 'new' });
    assert.equal(cook.createdTask, true);
    const cookOrigin = requiredOrigin(cook);
    const cookConfirm = await bus.invoke('work.converse', {
      taskId: cook.taskId,
      text: '确认',
      workUnit: 'confirm',
      originatingTurnId: cookOrigin,
    });
    assert.equal(cookConfirm.startAuthorized, true);
    const submitted = await bus.invoke('work.submitTask', {
      goal: cookGoal,
      contextRefs: [],
      requestedArtifactType: 'document',
      existingTaskId: cook.taskId,
      confirmedPlanVersion: cook.plan!.version,
      originatingTurnId: cookOrigin,
    });
    const cookJob = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 15_000);
    assert.equal(cookJob.status, 'succeeded');
    assert.equal(cookJob.taskId, cook.taskId);
    assert.equal(cookJob.originTurnId, cookOrigin);

    const hire = await bus.invoke('work.converse', {
      text: hireGoal,
      taskId: cook.taskId,
      workUnit: 'new',
    });
    assert.notEqual(hire.taskId, cook.taskId);
    assert.equal(hire.createdTask, true);
    const cookAfter = await runtime.getTask({ taskId: cook.taskId });
    const cookTexts = (cookAfter.task.meta?.conversation?.turns ?? []).map((t) => t.content).join('\n');
    assert.equal(/招聘|筛简历/.test(cookTexts), false);
    const hireDetail = await runtime.getTask({ taskId: hire.taskId });
    assert.equal(hireDetail.task.goal, hireGoal);
    assert.equal(hireDetail.task.meta?.workUnit?.originTurnId, hire.originTurnId);

    await assert.rejects(
      () =>
        bus.invoke('work.converse', {
          taskId: cook.taskId,
          text: '确认',
          workUnit: 'confirm',
          originatingTurnId: cookOrigin,
        }),
      /已经完成/,
    );
    await assert.rejects(
      () =>
        bus.invoke('work.submitTask', {
          goal: hireGoal,
          contextRefs: [],
          requestedArtifactType: 'document',
          existingTaskId: cook.taskId,
          confirmedPlanVersion: cook.plan!.version,
        }),
      /已经完成/,
    );
    await runtime.stop();
  });

  it('C2/T5: 首轮瞬时 degrade 在同一 Task/Turn 恢复，无需用户再发确认', async () => {
    const root = await tempDir('c2');
    const goal = '帮我整理一版能直接拿去对上的进展稿，结构你定。';
    const { chat } = scriptedChat(
      [
        {
          intent: 'add_goal_info',
          confidence: 0.94,
          reply: '已形成进展稿规划。',
          planUpdate: planBody(goal),
          executionIntentKind: 'create_document',
          expectedOutputFamily: 'document',
        },
      ],
      { throwFirst: 3 },
    );
    const { runtime, bus } = await makeRuntime(root, chat);
    const first = await bus.invoke('work.converse', { text: goal, workUnit: 'new' });
    assert.equal(first.createdTask, true);
    assert.equal(first.degraded, false);
    assert.ok(first.plan);
    assert.equal(first.plan?.source, 'model');
    assert.equal(first.recoveryStatus, 'recovered');
    const detail = await runtime.getTask({ taskId: first.taskId });
    assert.equal(detail.task.meta?.workUnit?.originTurnId, first.originTurnId);
    assert.equal(detail.task.meta?.workUnit?.converseRecovery?.status, 'recovered');
    assert.equal(detail.state, 'waiting');
    const userTurns = (detail.task.meta?.conversation?.turns ?? []).filter((t) => t.role === 'user');
    assert.equal(userTurns.length, 1);
    assert.equal(userTurns[0]?.content, goal);
    await runtime.stop();
  });

  it('degrade 最终无法恢复时进入 attention，不永久 waiting', async () => {
    const root = await tempDir('exh');
    const { runtime, bus } = await makeRuntime(root);
    const res = await bus.invoke('work.converse', { text: '整理一版对上进展稿', workUnit: 'new' });
    assert.equal(res.degraded, true);
    const detail = await runtime.getTask({ taskId: res.taskId });
    assert.equal(detail.state, 'attention');
    assert.equal(detail.latestJob, undefined);
    assert.equal(detail.task.meta?.workUnit?.converseRecovery?.status, 'exhausted');
    await runtime.stop();
  });

  it('迟到确认不能改写后一 Task：A 完成、B 新建后，A 的 confirm 被拒绝', async () => {
    const root = await tempDir('stale');
    const { chat } = scriptedChat([
      {
        intent: 'add_goal_info',
        confidence: 0.95,
        reply: 'A 规划',
        planUpdate: planBody('任务A'),
        executionIntentKind: 'create_document',
        expectedOutputFamily: 'document',
      },
      startReply,
      {
        intent: 'add_goal_info',
        confidence: 0.95,
        reply: 'B 规划',
        planUpdate: planBody('任务B'),
        executionIntentKind: 'create_document',
        expectedOutputFamily: 'document',
      },
    ]);
    const { runtime, bus } = await makeRuntime(root, chat);
    const a = await bus.invoke('work.converse', { text: '任务A', workUnit: 'new' });
    const aOrigin = requiredOrigin(a);
    await bus.invoke('work.converse', {
      taskId: a.taskId,
      text: '确认',
      workUnit: 'confirm',
      originatingTurnId: aOrigin,
    });
    const sub = await bus.invoke('work.submitTask', {
      goal: '任务A',
      contextRefs: [],
      requestedArtifactType: 'document',
      existingTaskId: a.taskId,
      confirmedPlanVersion: a.plan!.version,
      originatingTurnId: aOrigin,
    });
    await waitForJobTerminal(runtime.workRuntime, sub.jobId, 15_000);
    const b = await bus.invoke('work.converse', { text: '任务B', workUnit: 'new' });
    assert.notEqual(b.taskId, a.taskId);
    await assert.rejects(
      () =>
        bus.invoke('work.converse', {
          taskId: a.taskId,
          text: '确认',
          workUnit: 'confirm',
          originatingTurnId: aOrigin,
        }),
      /已经完成/,
    );
    const bAfter = await runtime.getTask({ taskId: b.taskId });
    const bUsers = (bAfter.task.meta?.conversation?.turns ?? []).filter((t) => t.role === 'user');
    assert.equal(bUsers.length, 1);
    assert.equal(bUsers[0]?.content, '任务B');
    await runtime.stop();
  });

  it('连续 5 个工作单元：Turn → Task → Job 一一对应', async () => {
    const root = await tempDir('seq');
    const goals = ['目标一说明', '目标二说明', '目标三说明', '目标四说明', '目标五说明'];
    const replies = goals.flatMap((g) => [
      {
        intent: 'add_goal_info' as const,
        confidence: 0.95,
        reply: `规划 ${g}`,
        planUpdate: planBody(g),
        executionIntentKind: 'create_document',
        expectedOutputFamily: 'document',
      },
      startReply,
    ]);
    const { chat } = scriptedChat(replies);
    const { runtime, bus } = await makeRuntime(root, chat);
    const seenTask = new Set<string>();
    const seenJob = new Set<string>();
    const seenTurn = new Set<string>();
    for (const goal of goals) {
      const first = await bus.invoke('work.converse', { text: goal, workUnit: 'new' });
      assert.equal(first.createdTask, true);
      const origin = requiredOrigin(first);
      assert.equal(seenTask.has(first.taskId), false);
      assert.equal(seenTurn.has(origin), false);
      seenTask.add(first.taskId);
      seenTurn.add(origin);
      const confirm = await bus.invoke('work.converse', {
        taskId: first.taskId,
        text: '确认',
        workUnit: 'confirm',
        originatingTurnId: origin,
      });
      assert.equal(confirm.taskId, first.taskId);
      const submitted = await bus.invoke('work.submitTask', {
        goal,
        contextRefs: [],
        requestedArtifactType: 'document',
        existingTaskId: first.taskId,
        confirmedPlanVersion: first.plan!.version,
        originatingTurnId: origin,
      });
      assert.equal(submitted.taskId, first.taskId);
      assert.equal(seenJob.has(submitted.jobId), false);
      seenJob.add(submitted.jobId);
      const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 15_000);
      assert.equal(job.taskId, first.taskId);
      assert.equal(job.originTurnId, origin);
    }
    assert.equal(seenTask.size, 5);
    assert.equal(seenJob.size, 5);
    assert.equal(seenTurn.size, 5);
    await runtime.stop();
  });

  it('T6: 讨论意图不建 Job', async () => {
    const root = await tempDir('t6');
    const { chat } = scriptedChat([
      {
        intent: 'discuss_or_question',
        confidence: 0.9,
        reply: '这类说明通常一轮就能写完。',
        planUpdate: planBody('讨论任务时长'),
      },
    ]);
    const { runtime, bus } = await makeRuntime(root, chat);
    const first = await bus.invoke('work.converse', {
      text: '写一份说明大概要多久？',
      workUnit: 'new',
    });
    assert.equal(first.startAuthorized, false);
    const detail = await runtime.getTask({ taskId: first.taskId });
    assert.equal(detail.latestJob, undefined);
    await runtime.stop();
  });
});
