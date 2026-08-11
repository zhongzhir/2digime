import { nowIso } from '../shared/ids';
import { randomUUID } from 'node:crypto';

/** 对话轮/意图结论局部 id（不属于 shared/ids 的对象前缀集）。 */
function converseId(prefix: 'turn' | 'intent'): string {
  return `${prefix}_${randomUUID()}`;
}
import type { ChatMessage } from '../infrastructure/model-http';
import type {
  ContextRef,
  Task,
  TaskConversationTurn,
  TaskIntentConclusion,
  TaskPlan,
} from './task';

/**
 * work-converse — D11-A AI 意图与对话中枢（设计 v0.2 §9）。
 *
 * 职责边界：
 * - 自然语言输入一律先经 AI 结合完整 Task 上下文判断意图并生成回复；
 * - 本模块**永不创建 Job**：执行只能经确定性命令（work.submitTask / work.reviseArtifact）发生；
 * - 模型不可用时不做关键词降级路由，不得把自然语言转成执行 Job；
 * - 只落盘可见对话、意图结论、规划版本；不落盘提示词与模型思维链。
 */

export const WORK_CONVERSE_INTENTS = [
  'discuss_or_question',
  'add_goal_info',
  'modify_plan',
  'confirm_start',
  'artifact_feedback',
  'request_explanation',
  'query_status',
  'pause_or_cancel',
  'final_adopt',
  'other',
] as const;

export type WorkConverseIntent = (typeof WORK_CONVERSE_INTENTS)[number];

/** 低于该置信度必须先澄清，不得产生任何执行性效果。 */
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

/**
 * 执行性效果（开始执行 / 请求采用）要求更高把握：
 * 低于此值保留模型回复但先向用户澄清，不授权任何确定性执行入口。
 */
export const EXECUTION_EFFECT_CONFIDENCE_THRESHOLD = 0.8;

/** 模型输入的近期对话窗口（可计算派生，不落盘第二份）。 */
export const CONVERSE_CONTEXT_TURN_WINDOW = 12;

/** 降级提示（结构性文案，允许确定性生成；不冒充 AI 情境回复）。 */
export const CONVERSE_DEGRADED_NOTICE =
  '我现在暂时无法理解你的这句话：理解能力需要的模型连接不可用。' +
  '你仍然可以查看和打开已有成果，或使用明确的暂停、取消按钮；' +
  '等模型恢复连接后，我会继续按你的话推进。这段话我已记录，不会丢失。';

/** 模型返回无法解析时的澄清提示（同为结构性降级文案）。 */
export const CONVERSE_UNPARSEABLE_NOTICE =
  '我刚才没有把你的意思理解清楚。可以换一种说法再讲一次吗？' +
  '比如告诉我你是想了解情况、补充要求，还是希望我开始或继续做事。';

/** 非执行类意图：只回应，不产生任何执行性效果。 */
export const NON_EXECUTION_INTENTS: readonly WorkConverseIntent[] = [
  'discuss_or_question',
  'request_explanation',
  'query_status',
  'other',
];

export function isWorkConverseIntent(value: unknown): value is WorkConverseIntent {
  return (
    typeof value === 'string' && (WORK_CONVERSE_INTENTS as readonly string[]).includes(value)
  );
}

export interface ConverseTaskFacts {
  /** 用户可读阶段标签（如 等待开始 / 处理中 / 需要你确认）。 */
  stageLabel: string;
  hasArtifact: boolean;
  jobRunning: boolean;
  /** 最近一次失败的用户面说明（如有）。 */
  lastFailure?: string;
}

export interface ConverseModelContext {
  goal: string;
  facts: ConverseTaskFacts;
  plan?: TaskPlan;
  /** 近期对话窗口（已按 CONVERSE_CONTEXT_TURN_WINDOW 截取）。 */
  recentTurns: Array<{ role: 'user' | 'digital_me'; content: string }>;
  userText: string;
}

/** 由持久对话即时推导模型输入窗口；不产生第二事实源。 */
export function recentTurnsWindow(
  turns: readonly TaskConversationTurn[],
  limit: number = CONVERSE_CONTEXT_TURN_WINDOW,
): Array<{ role: 'user' | 'digital_me'; content: string }> {
  return turns.slice(-limit).map((t) => ({ role: t.role, content: t.content }));
}

const CONVERSE_SYSTEM_PROMPT = [
  '你是用户的 Digital Me，以技术负责人的身份与用户讨论一项正在进行的任务。',
  '用户不懂技术，你要用平实的中文与其对话；不要输出任何内部术语、分析提纲或推理过程。',
  '根据下面提供的任务上下文与用户最新输入，判断用户意图并生成回复。',
  '只输出一个 JSON 对象（不要 Markdown 代码块围栏、不要其他文字），字段如下：',
  '{"intent":"<必须是以下之一: discuss_or_question | add_goal_info | modify_plan | confirm_start | artifact_feedback | request_explanation | query_status | pause_or_cancel | final_adopt | other>",',
  ' "confidence": <0 到 1 的数字，表示你对意图判断的把握>,',
  ' "reply": "<给用户的自然语言回复>",',
  ' "planUpdate": "<可选：当用户补充了目标信息、要求修改规划或对成果提出修改反馈时，给出更新后的完整规划要点（分行列出目标、交付、路径、边界）；其他情况省略该字段>"}',
  '意图判定规则：',
  '- 讨论、提问、请求解释、询问进度或状态，都不是执行请求，分别归入 discuss_or_question / request_explanation / query_status。',
  '- 用户补充目标或要求，且尚未开始执行 → add_goal_info；要求调整当前规划 → modify_plan；对已有成果提出修改意见 → artifact_feedback。',
  '- 只有用户明确表示「开始 / 按这个做 / 继续执行」时才是 confirm_start。',
  '- 只有用户明确表示满意并要求采用、定稿、结束时才是 final_adopt。',
  '- 已有成果时，用户表达对当前版本满意并要用这一版（如「就用这一版」「这版可以，收货」）→ final_adopt，不是 confirm_start；confirm_start 只用于要求开始或继续做开发工作。',
  '- 想暂停、停止、取消 → pause_or_cancel。',
  '- 拿不准时给出较低的 confidence，并在 reply 中向用户澄清你不确定的点。',
  '示例（帮助你区分边界）：',
  '- 「以后想加个排行榜，难不难？」→ 只是询问难度，不是让你现在做 → discuss_or_question 或 request_explanation。',
  '- 「背景改成夜晚的，其他不动」→ 已有成果时是 artifact_feedback；尚未开始时是 modify_plan。',
  '- 「行，就这么干」→ confirm_start；「这版挺好，不用再改了」→ final_adopt。',
  'reply 要求：',
  '- 说明你对这句话的理解和判断；',
  '- 说明接下来会发生什么或需要用户做什么；',
  '- 不要假装已经完成了任何修改或执行；执行需要用户确认后才会开始。',
].join('\n');

export function buildConverseMessages(ctx: ConverseModelContext): ChatMessage[] {
  const lines: string[] = [];
  lines.push('【任务上下文】');
  lines.push(`任务目标：${ctx.goal || '（尚未明确）'}`);
  lines.push(`当前阶段：${ctx.facts.stageLabel}`);
  lines.push(
    `执行情况：${ctx.facts.jobRunning ? '有一轮执行正在进行' : '当前没有正在进行的执行'}`,
  );
  lines.push(`成果：${ctx.facts.hasArtifact ? '已有可查看的成果' : '尚未形成成果'}`);
  if (ctx.facts.lastFailure) {
    lines.push(`最近一次失败说明：${ctx.facts.lastFailure}`);
  }
  if (ctx.plan) {
    lines.push(
      `当前规划（第 ${ctx.plan.version} 版，${ctx.plan.status === 'confirmed' ? '已确认' : '待确认'}）：`,
    );
    lines.push(ctx.plan.content);
  } else {
    lines.push('当前规划：尚未建立');
  }
  if (ctx.recentTurns.length) {
    lines.push('【近期对话】');
    for (const t of ctx.recentTurns) {
      lines.push(`${t.role === 'user' ? '用户' : 'Digital Me'}：${t.content}`);
    }
  }
  lines.push('【用户最新输入】');
  lines.push(ctx.userText);
  return [
    { role: 'system', content: CONVERSE_SYSTEM_PROMPT },
    { role: 'user', content: lines.join('\n') },
  ];
}

export interface ParsedConverseOutput {
  intent: WorkConverseIntent;
  confidence: number;
  reply: string;
  planUpdate?: string;
}

/** 解析模型输出；无法解析返回 null（由策略层走澄清降级，不猜测）。 */
export function parseConverseModelOutput(text: string): ParsedConverseOutput | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const candidate = extractJsonObject(raw);
  if (!candidate) return null;
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!isWorkConverseIntent(obj.intent)) return null;
  const reply = typeof obj.reply === 'string' ? obj.reply.trim() : '';
  if (!reply) return null;
  const confidenceRaw = typeof obj.confidence === 'number' ? obj.confidence : NaN;
  if (!Number.isFinite(confidenceRaw)) return null;
  const confidence = Math.min(1, Math.max(0, confidenceRaw));
  const planUpdate =
    typeof obj.planUpdate === 'string' && obj.planUpdate.trim().length > 0
      ? obj.planUpdate.trim()
      : undefined;
  return {
    intent: obj.intent,
    confidence,
    reply,
    ...(planUpdate ? { planUpdate } : {}),
  };
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

export interface ConverseDecision {
  intent: WorkConverseIntent;
  confidence: number;
  reply: string;
  needsClarification: boolean;
  degraded: boolean;
  /** 形成/更新待确认规划（草稿）。 */
  planDraftContent?: string;
  /** 将当前规划标记为已确认（confirm_start）。 */
  confirmPlan: boolean;
  /** 授权渲染层走确定性执行入口；本模块自身不创建 Job。 */
  startAuthorized: boolean;
  startMode?: 'new_execution' | 'revision';
  /** 请求渲染层弹出确定性采用确认（不自动采用）。 */
  adoptRequested: boolean;
  /** 请求渲染层走确定性暂停/取消路径。 */
  pauseRequested: boolean;
}

export interface ConverseDecisionInput {
  parsed: ParsedConverseOutput | null;
  modelAvailable: boolean;
  hasArtifact: boolean;
  jobRunning: boolean;
  /**
   * 本轮输入刚创建了任务（首轮）：同一句话不得当场授权执行或采用，
   * 必须先有 Digital Me 的理解回应，再由用户确认（两步启动）。
   */
  firstTurn?: boolean;
}

/**
 * 确定性策略层：把 AI 意图结论翻译为受限效果集合。
 * 规则（不可被模型输出覆盖）：
 * - 模型不可用 → 降级提示，零效果；
 * - 输出不可解析 → 澄清提示，零效果；
 * - 低置信度 → 保留模型回复但强制澄清，零效果；
 * - 执行性意图（confirm_start / final_adopt）把握低于 EXECUTION_EFFECT_CONFIDENCE_THRESHOLD → 先澄清，不授权；
 * - 非执行意图 → 只回应；
 * - 执行中（jobRunning）→ 不授权开始/采用。
 */
export function decideConverseEffects(input: ConverseDecisionInput): ConverseDecision {
  const base: ConverseDecision = {
    intent: 'other',
    confidence: 0,
    reply: '',
    needsClarification: false,
    degraded: false,
    confirmPlan: false,
    startAuthorized: false,
    adoptRequested: false,
    pauseRequested: false,
  };
  if (!input.modelAvailable) {
    return { ...base, reply: CONVERSE_DEGRADED_NOTICE, degraded: true };
  }
  if (!input.parsed) {
    return { ...base, reply: CONVERSE_UNPARSEABLE_NOTICE, needsClarification: true };
  }
  const { intent, confidence, reply, planUpdate } = input.parsed;
  if (confidence < LOW_CONFIDENCE_THRESHOLD) {
    return { ...base, intent, confidence, reply, needsClarification: true };
  }
  const decision: ConverseDecision = { ...base, intent, confidence, reply };
  switch (intent) {
    case 'add_goal_info':
    case 'modify_plan':
    case 'artifact_feedback':
      if (planUpdate) decision.planDraftContent = planUpdate;
      break;
    case 'confirm_start':
      if (confidence < EXECUTION_EFFECT_CONFIDENCE_THRESHOLD) {
        decision.needsClarification = true;
        break;
      }
      if (!input.jobRunning && !input.firstTurn) {
        decision.confirmPlan = true;
        decision.startAuthorized = true;
        decision.startMode = input.hasArtifact ? 'revision' : 'new_execution';
      }
      break;
    case 'final_adopt':
      if (confidence < EXECUTION_EFFECT_CONFIDENCE_THRESHOLD) {
        decision.needsClarification = true;
        break;
      }
      if (input.hasArtifact && !input.jobRunning && !input.firstTurn) {
        decision.adoptRequested = true;
      }
      break;
    case 'pause_or_cancel':
      decision.pauseRequested = true;
      break;
    default:
      break;
  }
  return decision;
}

export interface WorkConverseDeps {
  /** null 表示模型不可用（降级；不得从自然语言创建 Job）。 */
  chat: ((input: { messages: ChatMessage[] }) => Promise<{ text: string }>) | null;
  getTask(taskId: string): Promise<Task | null>;
  createTask(input: { goal: string; contextRefs: ContextRef[] }): Promise<Task>;
  appendConversation(
    taskId: string,
    input: { turns: TaskConversationTurn[]; intents?: TaskIntentConclusion[] },
  ): Promise<Task>;
  updatePlan(taskId: string, plan: TaskPlan): Promise<Task>;
  getTaskFacts(taskId: string): Promise<ConverseTaskFacts>;
}

export interface WorkConverseInput {
  taskId?: string;
  text: string;
  /** 首轮建任务时可携带材料/项目引用。 */
  contextRefs?: ContextRef[];
}

export interface WorkConverseResult {
  taskId: string;
  createdTask: boolean;
  intent: WorkConverseIntent;
  confidence: number;
  reply: string;
  needsClarification: boolean;
  degraded: boolean;
  newTurns: TaskConversationTurn[];
  plan?: { version: number; status: 'draft' | 'confirmed'; content: string };
  startAuthorized: boolean;
  startMode?: 'new_execution' | 'revision';
  adoptRequested: boolean;
  pauseRequested: boolean;
}

/**
 * 对话中枢编排：追加用户轮 → AI 判断 → 确定性策略 → 持久化回复与意图结论。
 * 全程不创建 Job、不调用任何执行命令。
 */
export async function runWorkConverse(
  deps: WorkConverseDeps,
  input: WorkConverseInput,
): Promise<WorkConverseResult> {
  const text = String(input.text || '').trim();
  if (!text) {
    throw Object.assign(new Error('converse text must not be empty'), {
      actionable: '请先输入内容再发送',
    });
  }

  let task: Task | null = null;
  let createdTask = false;
  if (input.taskId) {
    task = await deps.getTask(input.taskId);
    if (!task) throw new Error(`task not found: ${input.taskId}`);
  } else {
    task = await deps.createTask({ goal: text, contextRefs: input.contextRefs ?? [] });
    createdTask = true;
  }

  const existingTurns = task.meta?.conversation?.turns ?? [];
  const existingPlan = task.meta?.plan;
  const facts = await deps.getTaskFacts(task.id);

  const modelAvailable = deps.chat !== null;
  let parsed: ParsedConverseOutput | null = null;
  let chatFailed = false;
  if (deps.chat) {
    const messages = buildConverseMessages({
      goal: task.goal,
      facts,
      ...(existingPlan ? { plan: existingPlan } : {}),
      recentTurns: recentTurnsWindow(existingTurns),
      userText: text,
    });
    try {
      const result = await deps.chat({ messages });
      parsed = parseConverseModelOutput(result.text);
    } catch {
      chatFailed = true;
    }
  }

  const decision = decideConverseEffects({
    parsed,
    modelAvailable: modelAvailable && !chatFailed,
    hasArtifact: facts.hasArtifact,
    jobRunning: facts.jobRunning,
    firstTurn: createdTask,
  });

  // 规划效果（先于对话落盘，保证返回的 plan 与存储一致）
  let planOut: WorkConverseResult['plan'];
  if (decision.planDraftContent) {
    const nextPlan: TaskPlan = {
      version: (existingPlan?.version ?? 0) + 1,
      status: 'draft',
      content: decision.planDraftContent,
      updatedAt: nowIso(),
      ...(existingPlan?.confirmedFacts ? { confirmedFacts: existingPlan.confirmedFacts } : {}),
    };
    await deps.updatePlan(task.id, nextPlan);
    planOut = { version: nextPlan.version, status: nextPlan.status, content: nextPlan.content };
  } else if (decision.confirmPlan) {
    const confirmed: TaskPlan = existingPlan
      ? {
          ...existingPlan,
          status: 'confirmed',
          updatedAt: nowIso(),
          confirmedAt: nowIso(),
        }
      : {
          version: 1,
          status: 'confirmed',
          content: '按当前任务目标执行（未单独建立规划正文）',
          updatedAt: nowIso(),
          confirmedAt: nowIso(),
        };
    await deps.updatePlan(task.id, confirmed);
    planOut = { version: confirmed.version, status: confirmed.status, content: confirmed.content };
  } else if (existingPlan) {
    planOut = {
      version: existingPlan.version,
      status: existingPlan.status,
      content: existingPlan.content,
    };
  }

  // 对话与意图结论落盘（只存可见内容与结论；不存提示词/思维链）
  const intentId = converseId('intent');
  const userTurn: TaskConversationTurn = {
    turnId: converseId('turn'),
    role: 'user',
    content: text,
    createdAt: nowIso(),
    intentId,
  };
  const replyTurn: TaskConversationTurn = {
    turnId: converseId('turn'),
    role: 'digital_me',
    content: decision.reply,
    createdAt: nowIso(),
  };
  const conclusion: TaskIntentConclusion = {
    intentId,
    turnId: userTurn.turnId,
    intent: decision.intent,
    confidence: decision.confidence,
    ...(decision.needsClarification ? { needsClarification: true } : {}),
    ...(decision.degraded ? { degraded: true } : {}),
    createdAt: nowIso(),
  };
  await deps.appendConversation(task.id, {
    turns: [userTurn, replyTurn],
    intents: [conclusion],
  });

  return {
    taskId: task.id,
    createdTask,
    intent: decision.intent,
    confidence: decision.confidence,
    reply: decision.reply,
    needsClarification: decision.needsClarification,
    degraded: decision.degraded,
    newTurns: [userTurn, replyTurn],
    ...(planOut ? { plan: planOut } : {}),
    startAuthorized: decision.startAuthorized,
    ...(decision.startMode ? { startMode: decision.startMode } : {}),
    adoptRequested: decision.adoptRequested,
    pauseRequested: decision.pauseRequested,
  };
}
