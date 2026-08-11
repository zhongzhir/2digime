/**
 * 2DIGIME-BUILD-01-D11-A-AI-INTERACTION-KERNEL-12
 * AI 意图与对话中枢（work.converse）：
 * 对话持久化与重启恢复、非执行输入零 Job、先回应后待确认规划、
 * 未确认不执行、NL 确认与按钮语义一致、低置信度澄清、模型不可用降级、
 * 越权硬门不被绕过、不落盘思维链、评测集健全性。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime, type DigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import type { ChatMessage } from '../../infrastructure/model-http';
import {
  WORK_CONVERSE_INTENTS,
  decideConverseEffects,
  parseConverseModelOutput,
  recentTurnsWindow,
  CONVERSE_DEGRADED_NOTICE,
  isWorkConverseIntent,
  type WorkConverseIntent,
} from '../work-converse';
import {
  WORK_INTENT_EVAL_CASES,
  WORK_INTENT_EVAL_MIN_CASES,
} from '../work-intent-eval-dataset';

async function tempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-converse-${prefix}-`));
}

interface ScriptedReply {
  intent: WorkConverseIntent | string;
  confidence: number;
  reply: string;
  planUpdate?: string;
  /** 模型输出前后混入的杂散文本（模拟思维链/围栏）。 */
  wrap?: boolean;
}

/** 脚本化模型：按序返回 JSON 结论；记录收到的 messages 供审计断言。 */
function scriptedChat(replies: ScriptedReply[]) {
  const seenMessages: ChatMessage[][] = [];
  let i = 0;
  const chat = async ({ messages }: { messages: ChatMessage[] }) => {
    seenMessages.push(messages);
    const r = replies[Math.min(i, replies.length - 1)]!;
    i += 1;
    const body = JSON.stringify({
      intent: r.intent,
      confidence: r.confidence,
      reply: r.reply,
      ...(r.planUpdate ? { planUpdate: r.planUpdate } : {}),
    });
    const text = r.wrap
      ? '好的，我先想一想。\n```json\n' + body + '\n```\n以上是我的判断。'
      : body;
    return { text };
  };
  return { chat, seenMessages };
}

async function makeRuntime(dir: string, chat?: (input: { messages: ChatMessage[] }) => Promise<{ text: string }>) {
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    ...(chat ? { converseChat: chat } : {}),
  });
  const bus = createCommandBus(runtime);
  return { runtime, bus };
}

async function jobCountForTask(runtime: DigitalMeRuntime, taskId: string): Promise<number> {
  const detail = await runtime.getTask({ taskId });
  return detail.latestJob ? 1 : 0;
}

describe('D11-A work.converse — AI 意图与对话中枢', () => {
  it('1+2. 连续提问/查状态/要解释：只有回应，零 Job；对话持久化并可重启恢复', async () => {
    const root = await tempDir('persist');
    const { chat } = scriptedChat([
      { intent: 'discuss_or_question', confidence: 0.92, reply: '这类小游戏通常一到两轮就能出可玩版本。' },
      { intent: 'query_status', confidence: 0.9, reply: '任务还没开始执行，正等你确认规划。' },
      { intent: 'request_explanation', confidence: 0.88, reply: '「可玩版本」指能移动、射击并计分的最小版本。' },
    ]);
    const { runtime, bus } = await makeRuntime(root, chat);
    await bus.invoke('subject.createPackage', { displayName: '对话主体', targetDir: path.join(root, 'pkg') });

    const first = await bus.invoke('work.converse', { text: '做一个打飞机小游戏，先问下要做多久？' });
    assert.ok(first.taskId);
    assert.equal(first.createdTask, true);
    assert.equal(first.intent, 'discuss_or_question');
    assert.ok(first.reply.length > 0);
    assert.equal(first.startAuthorized, false);

    const second = await bus.invoke('work.converse', { taskId: first.taskId, text: '现在什么状态？' });
    assert.equal(second.intent, 'query_status');
    const third = await bus.invoke('work.converse', { taskId: first.taskId, text: '解释下什么叫可玩版本' });
    assert.equal(third.intent, 'request_explanation');

    // 零 Job（验证 2）
    assert.equal(await jobCountForTask(runtime, first.taskId), 0);

    // 持久化结构（验证 1）
    const detail = await runtime.getTask({ taskId: first.taskId });
    const conv = detail.task.meta?.conversation;
    assert.ok(conv);
    assert.equal(conv!.turns.length, 6); // 3 用户轮 + 3 回复轮
    for (const turn of conv!.turns) {
      assert.ok(turn.turnId && turn.role && turn.content && turn.createdAt);
    }
    // 意图结论经引用关联（不写入对话正文）
    assert.equal(conv!.intents.length, 3);
    assert.equal(conv!.intents[0]!.turnId, conv!.turns[0]!.turnId);
    assert.equal(conv!.turns[0]!.intentId, conv!.intents[0]!.intentId);

    await runtime.stop();

    // 重启恢复：新 Runtime 打开同一包
    const { runtime: runtime2, bus: bus2 } = await makeRuntime(root, chat);
    await bus2.invoke('subject.openPackage', { dir: path.join(root, 'pkg') });
    const restored = await runtime2.getTask({ taskId: first.taskId });
    assert.equal(restored.task.meta?.conversation?.turns.length, 6);
    assert.equal(restored.task.meta?.conversation?.intents.length, 3);
    await runtime2.stop();
  });

  it('3+4. 用户反馈先回应并形成待确认规划；未确认时不产生任何执行', async () => {
    const root = await tempDir('plan');
    const { chat } = scriptedChat([
      { intent: 'add_goal_info', confidence: 0.9, reply: '明白，我把「记录最高分」加进规划，确认后再开始。', planUpdate: '目标：打飞机小游戏\n交付：可玩网页版\n新增：记录最高分' },
      { intent: 'modify_plan', confidence: 0.9, reply: '好的，改为鼠标操作，规划已更新为第 2 版，等你确认。', planUpdate: '目标：打飞机小游戏\n操作：鼠标\n交付：可玩网页版' },
    ]);
    const { runtime, bus } = await makeRuntime(root, chat);
    await bus.invoke('subject.createPackage', { displayName: '规划主体', targetDir: path.join(root, 'pkg') });

    const first = await bus.invoke('work.converse', { text: '做一个打飞机小游戏，要记录最高分' });
    assert.equal(first.plan?.status, 'draft');
    assert.equal(first.plan?.version, 1);
    const second = await bus.invoke('work.converse', { taskId: first.taskId, text: '改成鼠标操作' });
    assert.equal(second.plan?.version, 2);
    assert.equal(second.plan?.status, 'draft');

    // 规划正文只存 Task.meta.plan，一处保存
    const detail = await runtime.getTask({ taskId: first.taskId });
    assert.equal(detail.task.meta?.plan?.content.includes('鼠标'), true);
    const turnTexts = (detail.task.meta?.conversation?.turns ?? []).map((t) => t.content);
    assert.ok(!turnTexts.some((t) => t === detail.task.meta?.plan?.content));

    // 未确认 → 零 Job（验证 4）
    assert.equal(await jobCountForTask(runtime, first.taskId), 0);
    await runtime.stop();
  });

  it('5. 自然语言确认与按钮确认语义一致：都确认当前规划并在同一 Task 上执行', async () => {
    const root = await tempDir('start');
    const { chat } = scriptedChat([
      { intent: 'add_goal_info', confidence: 0.9, reply: '收到，规划整理好了，确认后开始。', planUpdate: '目标：写一句话说明\n交付：一段文字' },
      { intent: 'confirm_start', confidence: 0.95, reply: '好，我按第 1 版规划开始，完成后告诉你。' },
    ]);
    const { runtime, bus } = await makeRuntime(root, chat);
    await bus.invoke('subject.createPackage', { displayName: '启动主体', targetDir: path.join(root, 'pkg') });

    const first = await bus.invoke('work.converse', { text: '帮我写一句话说明' });
    assert.equal(first.plan?.status, 'draft');

    // 自然语言确认开始
    const confirm = await bus.invoke('work.converse', { taskId: first.taskId, text: '按这个方案开始吧' });
    assert.equal(confirm.startAuthorized, true);
    assert.equal(confirm.startMode, 'new_execution');
    assert.equal(confirm.plan?.status, 'confirmed');
    // converse 自身不建 Job
    assert.equal(await jobCountForTask(runtime, first.taskId), 0);

    // 确定性执行：existingTaskId 复用同一 Task，不新建
    const before = await runtime.listTasks({});
    const submitted = await bus.invoke('work.submitTask', {
      goal: '帮我写一句话说明',
      contextRefs: [],
      requestedArtifactType: 'document',
      existingTaskId: first.taskId,
    });
    assert.equal(submitted.taskId, first.taskId);
    assert.ok(submitted.jobId);
    const after = await runtime.listTasks({});
    assert.equal(after.tasks.length, before.tasks.length);

    const { waitForJobTerminal } = await import('../job-runner');
    await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 15_000);
    const detail = await runtime.getTask({ taskId: first.taskId });
    assert.equal(detail.state, 'completed');
    // 对话与规划仍在同一 Task 上
    assert.ok(detail.task.meta?.conversation?.turns.length);
    assert.equal(detail.task.meta?.plan?.status, 'confirmed');
    await runtime.stop();
  });

  it('5b. 按钮路径：submitTask(existingTaskId) 对草稿规划的确定性确认', async () => {
    const root = await tempDir('button');
    const { chat } = scriptedChat([
      { intent: 'add_goal_info', confidence: 0.9, reply: '规划已建立，等你确认。', planUpdate: '目标：写一句话说明' },
    ]);
    const { runtime, bus } = await makeRuntime(root, chat);
    await bus.invoke('subject.createPackage', { displayName: '按钮主体', targetDir: path.join(root, 'pkg') });
    const first = await bus.invoke('work.converse', { text: '帮我写一句话说明' });
    assert.equal(first.plan?.status, 'draft');
    // 用户直接点「开始处理」= 确定性确认，不再调模型
    const submitted = await bus.invoke('work.submitTask', {
      goal: '帮我写一句话说明',
      contextRefs: [],
      requestedArtifactType: 'document',
      existingTaskId: first.taskId,
    });
    assert.equal(submitted.taskId, first.taskId);
    const detail = await runtime.getTask({ taskId: first.taskId });
    assert.equal(detail.task.meta?.plan?.status, 'confirmed');
    await runtime.stop();
  });

  it('6. 低置信度：必须澄清，保留回复但不产生规划/执行效果', async () => {
    const root = await tempDir('lowconf');
    const { chat } = scriptedChat([
      { intent: 'add_goal_info', confidence: 0.9, reply: '规划已建立。', planUpdate: '目标：小游戏' },
      { intent: 'confirm_start', confidence: 0.35, reply: '我不太确定你是想现在开始，还是先再聊聊？', planUpdate: '不应生效的规划' },
    ]);
    const { runtime, bus } = await makeRuntime(root, chat);
    await bus.invoke('subject.createPackage', { displayName: '澄清主体', targetDir: path.join(root, 'pkg') });
    const first = await bus.invoke('work.converse', { text: '做个小游戏' });
    const vague = await bus.invoke('work.converse', { taskId: first.taskId, text: '嗯……那个吧' });
    assert.equal(vague.needsClarification, true);
    assert.equal(vague.startAuthorized, false);
    // 低置信度不改规划
    assert.equal(vague.plan?.version, 1);
    assert.equal(vague.plan?.status, 'draft');
    assert.equal(await jobCountForTask(runtime, first.taskId), 0);
    await runtime.stop();
  });

  it('7. 模型不可用：明确降级提示；不做关键词路由；不得从自然语言创建 Job', async () => {
    const root = await tempDir('degraded');
    const { runtime, bus } = await makeRuntime(root /* 无 converseChat；fake 文档能力 → chat 为 null */);
    await bus.invoke('subject.createPackage', { displayName: '降级主体', targetDir: path.join(root, 'pkg') });
    // 即使输入是明确的执行请求，也不得转成 Job
    const res = await bus.invoke('work.converse', { text: '马上开始做一个打飞机小游戏' });
    assert.equal(res.degraded, true);
    assert.equal(res.reply, CONVERSE_DEGRADED_NOTICE);
    assert.equal(res.startAuthorized, false);
    assert.equal(res.adoptRequested, false);
    assert.equal(await jobCountForTask(runtime, res.taskId), 0);
    // 降级对话仍持久化（记录不丢失）
    const detail = await runtime.getTask({ taskId: res.taskId });
    assert.equal(detail.task.meta?.conversation?.turns.length, 2);
    assert.equal(detail.task.meta?.conversation?.intents[0]?.degraded, true);
    await runtime.stop();
  });

  it('8. 既有授权硬门不被绕过：改码任务确认后仍需项目位置与执行授权', async () => {
    const root = await tempDir('gate');
    const { chat } = scriptedChat([
      { intent: 'confirm_start', confidence: 0.95, reply: '好，我开始。' },
    ]);
    const { runtime, bus } = await makeRuntime(root, chat);
    await bus.invoke('subject.createPackage', { displayName: '硬门主体', targetDir: path.join(root, 'pkg') });
    const first = await bus.invoke('work.converse', { text: '修一下项目里的按钮 bug' });
    // 即便对话中枢授权了开始，确定性提交仍要过 modify_code 硬门
    const submitted = await bus.invoke('work.submitTask', {
      goal: '修一下项目里的按钮 bug',
      contextRefs: [],
      intentKind: 'modify_code',
      existingTaskId: first.taskId,
    });
    assert.equal(submitted.taskId, '');
    assert.equal(submitted.jobId, '');
    assert.ok(submitted.needsProjectFolder);
    assert.equal(await jobCountForTask(runtime, first.taskId), 0);
    await runtime.stop();
  });

  it('9. 不落盘思维链：围栏与杂散推理文本不进入对话；只存可见回复与结论', async () => {
    const root = await tempDir('nochain');
    const { chat, seenMessages } = scriptedChat([
      { intent: 'discuss_or_question', confidence: 0.9, reply: '可以的，网页版能在手机浏览器里玩。', wrap: true },
    ]);
    const { runtime, bus } = await makeRuntime(root, chat);
    await bus.invoke('subject.createPackage', { displayName: '审计主体', targetDir: path.join(root, 'pkg') });
    const res = await bus.invoke('work.converse', { text: '做的游戏手机能玩吗' });
    assert.equal(res.reply, '可以的，网页版能在手机浏览器里玩。');
    const detail = await runtime.getTask({ taskId: res.taskId });
    const contents = (detail.task.meta?.conversation?.turns ?? []).map((t) => t.content).join('\n');
    // 杂散文本与提示词不落盘
    assert.ok(!contents.includes('我先想一想'));
    assert.ok(!contents.includes('```'));
    assert.ok(seenMessages[0]!.some((m) => m.role === 'system'));
    assert.ok(!contents.includes(seenMessages[0]!.find((m) => m.role === 'system')!.content.slice(0, 24)));
    // 意图结论只存结论与置信度
    const intents = detail.task.meta?.conversation?.intents ?? [];
    assert.equal(intents.length, 1);
    assert.deepEqual(
      Object.keys(intents[0]!).sort(),
      ['confidence', 'createdAt', 'intent', 'intentId', 'turnId'].sort(),
    );
    await runtime.stop();
  });

  it('确定性策略层：解析失败→澄清零效果；执行中/首轮不授权开始与采用', () => {
    // 解析失败
    const bad = decideConverseEffects({ parsed: null, modelAvailable: true, hasArtifact: false, jobRunning: false });
    assert.equal(bad.needsClarification, true);
    assert.equal(bad.startAuthorized, false);
    // 执行中不授权
    const running = decideConverseEffects({
      parsed: { intent: 'confirm_start', confidence: 0.99, reply: '开始' },
      modelAvailable: true,
      hasArtifact: false,
      jobRunning: true,
    });
    assert.equal(running.startAuthorized, false);
    // 首轮不授权（同一句话不得建任务又当场执行）
    const firstTurn = decideConverseEffects({
      parsed: { intent: 'confirm_start', confidence: 0.99, reply: '开始' },
      modelAvailable: true,
      hasArtifact: false,
      jobRunning: false,
      firstTurn: true,
    });
    assert.equal(firstTurn.startAuthorized, false);
    // 有成果时确认开始 = 修订轮
    const revision = decideConverseEffects({
      parsed: { intent: 'confirm_start', confidence: 0.9, reply: '继续' },
      modelAvailable: true,
      hasArtifact: true,
      jobRunning: false,
    });
    assert.equal(revision.startMode, 'revision');
    // 无成果时不得采用
    const adoptNoArtifact = decideConverseEffects({
      parsed: { intent: 'final_adopt', confidence: 0.9, reply: '就这样' },
      modelAvailable: true,
      hasArtifact: false,
      jobRunning: false,
    });
    assert.equal(adoptNoArtifact.adoptRequested, false);
    // 执行性意图把握不足（<0.8）→ 先澄清，不授权开始/采用
    const midConfStart = decideConverseEffects({
      parsed: { intent: 'confirm_start', confidence: 0.7, reply: '你是想现在开始吗？' },
      modelAvailable: true,
      hasArtifact: false,
      jobRunning: false,
    });
    assert.equal(midConfStart.startAuthorized, false);
    assert.equal(midConfStart.confirmPlan, false);
    assert.equal(midConfStart.needsClarification, true);
    const midConfAdopt = decideConverseEffects({
      parsed: { intent: 'final_adopt', confidence: 0.7, reply: '你是想采用这一版吗？' },
      modelAvailable: true,
      hasArtifact: true,
      jobRunning: false,
    });
    assert.equal(midConfAdopt.adoptRequested, false);
    assert.equal(midConfAdopt.needsClarification, true);
  });

  it('输出解析：容忍围栏与前后杂文；拒绝未知意图与缺字段', () => {
    const ok = parseConverseModelOutput(
      '前置说明```json\n{"intent":"query_status","confidence":0.8,"reply":"进展正常"}\n```后置',
    );
    assert.equal(ok?.intent, 'query_status');
    assert.equal(parseConverseModelOutput('{"intent":"bad_kind","confidence":0.9,"reply":"x"}'), null);
    assert.equal(parseConverseModelOutput('{"intent":"query_status","reply":"x"}'), null);
    assert.equal(parseConverseModelOutput('{"intent":"query_status","confidence":0.9}'), null);
    assert.equal(parseConverseModelOutput('完全不是 JSON'), null);
    // confidence 越界收敛到 0..1
    const clamped = parseConverseModelOutput('{"intent":"other","confidence":7,"reply":"x"}');
    assert.equal(clamped?.confidence, 1);
  });

  it('模型上下文窗口：从持久对话按固定规则即时推导，不复制第二事实源', () => {
    const turns = Array.from({ length: 30 }, (_, i) => ({
      turnId: `t${i}`,
      role: (i % 2 === 0 ? 'user' : 'digital_me') as 'user' | 'digital_me',
      content: `第 ${i} 句`,
      createdAt: new Date().toISOString(),
    }));
    const window = recentTurnsWindow(turns);
    assert.equal(window.length, 12);
    assert.equal(window[11]!.content, '第 29 句');
  });

  it('10. 评测集健全性：≥50 条、意图合法且全覆盖、非执行样本不期望执行意图', () => {
    assert.ok(WORK_INTENT_EVAL_CASES.length >= WORK_INTENT_EVAL_MIN_CASES);
    const covered = new Set<string>();
    const ids = new Set<string>();
    for (const c of WORK_INTENT_EVAL_CASES) {
      assert.ok(!ids.has(c.id), `duplicate id: ${c.id}`);
      ids.add(c.id);
      assert.ok(c.text.trim().length > 0);
      assert.ok(c.expected.length > 0);
      for (const intent of c.expected) {
        assert.ok(isWorkConverseIntent(intent), `bad intent: ${intent}`);
        covered.add(intent);
      }
      if (c.nonExecution) {
        assert.ok(!c.expected.includes('confirm_start'));
        assert.ok(!c.expected.includes('final_adopt'));
      }
    }
    for (const intent of WORK_CONVERSE_INTENTS) {
      assert.ok(covered.has(intent), `intent not covered by dataset: ${intent}`);
    }
  });
});
