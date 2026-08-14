import { nowIso } from '../shared/ids';
import { randomUUID } from 'node:crypto';
import {
  assertConsultReplyConsistent,
  buildDegradedConsultReply,
  isCurrentTaskConsult,
  type ConsultTaskContext,
} from './work-cto-consult';
import {
  classifyOwnerRevisionRoute,
} from './work-revision-routing';
import {
  buildConverseMaterialBrief,
  validateConfirmedPlanExecutionIntent,
} from './converse-material-brief';
import type { TaskIntentKind } from './work-intent';

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
import { isThinOwnerRuntime } from './thin-owner-start';

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

/**
 * 语义歧义时的澄清提示（仅当模型已给出合法回复且判定需要补充时使用）。
 * 技术解析失败不得使用本句。
 */
export const CONVERSE_UNPARSEABLE_NOTICE =
  '我刚才没有把你的意思理解清楚。可以换一种说法再讲一次吗？' +
  '比如告诉我你是想了解情况、补充要求，还是希望我开始或继续做事。';

/** 模型输出合同失败 / 理解或规划生成失败（保留 Owner 原文与 Task；可重试；零 Job）。 */
export const CONVERSE_PLAN_FAILED_NOTICE =
  '本次理解或规划生成失败，可重试。你的原文和任务已保留，不会丢失。请再发送一次。';

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
  /** 用户可读阶段标签（如 等待开始 / 开发中 / 尚未决定）。 */
  stageLabel: string;
  hasArtifact: boolean;
  jobRunning: boolean;
  /** 最近一次失败的用户面说明（如有）。 */
  lastFailure?: string;
  latestJobStatus?: string;
  ownerDecision?: 'undecided' | 'accepted' | 'rejected';
  canAdoptSuggested?: boolean;
  ctoReport?: string;
}

export interface ConverseModelContext {
  goal: string;
  facts: ConverseTaskFacts;
  plan?: TaskPlan;
  /** 近期对话窗口（已按 CONVERSE_CONTEXT_TURN_WINDOW 截取）。 */
  recentTurns: Array<{ role: 'user' | 'digital_me'; content: string }>;
  userText: string;
  /** 已授权材料事实（确认前理解/规划用；可空）。 */
  materialBrief?: string;
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
  '根据下面提供的任务上下文、已授权材料事实与用户最新输入，判断用户意图并生成回复。',
  '材料规则（必须遵守）：',
  '- 若上下文含「已授权材料」且有清单或摘录：你已经获得这些本地材料事实；必须基于材料理解与规划；禁止声称“无法访问/无法读取本地文件夹”，禁止要求用户把全文粘贴进对话。',
  '- 若某文件标注未读取：只说明该文件的具体阻断原因与可行动办法，不得把整次授权说成系统不能读文件夹。',
  '- 读取已授权材料属于理解与规划，不需要用户再次确认执行。',
  '- 对「先出方案、批准后再实施」：确认前只更新开发规划，不要假装已经改了项目文件。',
  '输出合同：必须给出一个合法 JSON 对象。可以在前后有简短说明，或使用 Markdown 代码围栏，但其中必须含有完整 JSON。',
  'JSON 字段如下（schema）：',
  '{"intent":"<必须是以下之一: discuss_or_question | add_goal_info | modify_plan | confirm_start | artifact_feedback | request_explanation | query_status | pause_or_cancel | final_adopt | other>",',
  ' "confidence": <0 到 1 的数字，表示你对意图判断的把握>,',
  ' "reply": "<给用户的自然语言回复：说明你对目标的理解，并给出简短 CTO 建议>",',
  ' "planUpdate": "<可选但强烈建议：完整开发规划要点，分行列出目标、交付、路径、准备、边界；首轮目标输入必须提供；其他情况可省略>",',
  ' "executionIntentKind": "<仅 confirm_start：modify_code | create_document | analyze_code>",',
  ' "expectedOutputFamily": "<仅 confirm_start：code-change | document | code-analysis>"}',
  '意图判定规则：',
  '- 讨论、提问、请求解释、询问进度或状态，都不是执行请求，分别归入 discuss_or_question / request_explanation / query_status。',
  '- 用户补充目标或要求，且尚未开始执行 → add_goal_info；要求调整当前规划 → modify_plan；对已有成果提出修改意见 → artifact_feedback。',
  '- 已有成果时，明确「改成 X / 按你说的改 / 把 A 改成 B」仍用 artifact_feedback（不要改成 discuss）；是否开始修改由系统确定性效果层决定，你仍须给出简短确认回复。',
  '- 只有用户明确表示「开始 / 按这个做 / 继续执行」且主要是确认规划时才是 confirm_start。',
  '- confirm_start 时必须同时给出本轮瞬时 executionIntentKind 与 expectedOutputFamily（不写入规划、不持久化）：要改项目文件 → modify_code 配 code-change；只出报告/说明且明确不改文件 → create_document 配 document；只读代码分析 → analyze_code 配 code-analysis。以已确认方案的实际动作为准，不得因为出现「优化」「实施」等词就改文件。',
  '- 只有用户明确表示满意并要求采用、定稿、结束时才是 final_adopt。',
  '- 已有成果时，用户表达对当前版本满意并要用这一版（如「就用这一版」「这版可以，收货」）→ final_adopt，不是 confirm_start；confirm_start 只用于要求开始或继续做开发工作。',
  '- 想暂停、停止、取消 → pause_or_cancel。',
  '- 拿不准时给出较低的 confidence，并在 reply 中向用户澄清你不确定的点。',
  '示例（帮助你区分边界）：',
  '- 「以后想加个排行榜，难不难？」→ 只是询问难度，不是让你现在做 → discuss_or_question 或 request_explanation。',
  '- 「背景改成夜晚的，其他不动」→ 已有成果时是 artifact_feedback；尚未开始时是 modify_plan。',
  '- 「行，就这么干」→ confirm_start；「这版挺好，不用再改了」→ final_adopt。',
  '- 用户问「能不能用 / 要不要改 / 有什么风险 / 现在怎么样 / 看不懂这份结果」→ query_status 或 request_explanation，必须结合当前任务、最新执行与验收结论用几句人话回答；禁止说「没听懂请再说一次」。',
  'reply 要求：',
  '- 说明你对这句话的理解和判断；',
  '- 若用户在问当前结果：必须明确回答能不能用、是否达到目标、还需不需要改、真正需要用户知道的风险、建议下一步；',
  '- 不要假装已经完成了任何修改或执行；执行需要用户确认后才会开始。',
  '- 规划正文由你直接给出（planUpdate），不要声称要交给外部写代码工具来替你写规划。',
].join('\n');

const CONVERSE_REPAIR_USER =
  '上一次输出不符合合同。请只输出一个合法 JSON 对象（可无围栏），字段为 intent、confidence、reply；intent 为 confirm_start 时必须同时给出配对的 executionIntentKind 与 expectedOutputFamily（modify_code↔code-change，create_document↔document，analyze_code↔code-analysis）；必要时加 planUpdate；不要 Markdown 说明。';

/** 确认开始但本轮执行族无效：零 Job，可重试。 */
export const CONVERSE_EXECUTION_ROUTE_FAILED_NOTICE =
  '这次还不能开始处理：还没有形成可用的执行判断。请再确认一次，或把目标说得更明确一些。你的原文和任务都还在。';

const CONVERSE_FIRST_TURN_PLAN_REPAIR =
  '上一次输出缺少可用的 planUpdate。请再输出一个合法 JSON 对象：intent、confidence、reply，以及完整 planUpdate（分行列出目标、交付、路径、准备、边界）。reply 需包含对目标的理解与简短建议。';

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
  if (ctx.facts.latestJobStatus) {
    lines.push(`最近一次执行状态：${ctx.facts.latestJobStatus}`);
  }
  if (ctx.facts.ownerDecision) {
    lines.push(
      `采用决定：${
        ctx.facts.ownerDecision === 'accepted'
          ? '已采用'
          : ctx.facts.ownerDecision === 'rejected'
            ? '未采用'
            : '尚未决定'
      }`,
    );
  }
  if (ctx.facts.canAdoptSuggested != null) {
    lines.push(`是否建议采用：${ctx.facts.canAdoptSuggested ? '是' : '否，建议继续修改'}`);
  }
  if (ctx.facts.ctoReport) {
    lines.push(`当前验收结论：${ctx.facts.ctoReport}`);
  }
  if (ctx.plan) {
    lines.push(
      `当前规划（第 ${ctx.plan.version} 版，${ctx.plan.status === 'confirmed' ? '已确认' : '待确认'}）：`,
    );
    lines.push(ctx.plan.content);
  } else {
    lines.push('当前规划：尚未建立');
  }
  if (ctx.materialBrief && ctx.materialBrief.trim()) {
    lines.push(ctx.materialBrief.trim());
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
  /** 仅 confirm_start 使用；瞬时决策，不落盘。 */
  executionIntentKind?: string;
  expectedOutputFamily?: string;
}

/** 解析模型输出；无法解析返回 null（由策略层走规划失败语义，不猜测、不说「没听懂」）。 */
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
  const confidenceRaw =
    typeof obj.confidence === 'number'
      ? obj.confidence
      : typeof obj.confidence === 'string'
        ? Number(obj.confidence)
        : NaN;
  if (!Number.isFinite(confidenceRaw)) return null;
  const confidence = Math.min(1, Math.max(0, confidenceRaw));
  const planUpdate =
    typeof obj.planUpdate === 'string' && obj.planUpdate.trim().length > 0
      ? obj.planUpdate.trim()
      : undefined;
  const executionIntentKind =
    typeof obj.executionIntentKind === 'string' && obj.executionIntentKind.trim()
      ? obj.executionIntentKind.trim()
      : undefined;
  const expectedOutputFamily =
    typeof obj.expectedOutputFamily === 'string' && obj.expectedOutputFamily.trim()
      ? obj.expectedOutputFamily.trim()
      : undefined;
  return {
    intent: obj.intent,
    confidence,
    reply,
    ...(planUpdate ? { planUpdate } : {}),
    ...(executionIntentKind ? { executionIntentKind } : {}),
    ...(expectedOutputFamily ? { expectedOutputFamily } : {}),
  };
}

/**
 * 从模型原文提取 JSON 对象：支持代码围栏与前后解释文字。
 * 优先 ```json 围栏，其次首尾花括号平衡切片。
 */
export function extractJsonObject(text: string): string | null {
  const raw = String(text || '');
  const fence = raw.match(/```(?:json|JSON)?\s*([\s\S]*?)```/);
  if (fence && fence[1]) {
    const inner = fence[1].trim();
    const fromFence = sliceBalancedJson(inner);
    if (fromFence) return fromFence;
  }
  return sliceBalancedJson(raw);
}

function sliceBalancedJson(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** 用户可见规划：仅 model 来源（缺省 source 兼容历史）。 */
export function isUserVisiblePlan(plan: { source?: string } | null | undefined): boolean {
  if (!plan) return false;
  return plan.source !== 'seed_internal';
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
  userText?: string;
  consultContext?: ConsultTaskContext;
}

/**
 * 确定性策略层：把 AI 意图结论翻译为受限效果集合。
 * 规则（不可被模型输出覆盖）：
 * - 模型不可用 → 降级提示，零效果；
 * - 输出不可解析 → 理解/规划失败语义，零效果；不得用关键词替代 AI 判断并授权执行；
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
  const consult =
    isCurrentTaskConsult(input.userText || '') && !!input.consultContext;
  if (!input.modelAvailable) {
    if (consult && input.consultContext) {
      return {
        ...base,
        intent: 'query_status',
        confidence: 0.9,
        reply: buildDegradedConsultReply(input.consultContext),
        degraded: true,
      };
    }
    return { ...base, reply: CONVERSE_DEGRADED_NOTICE, degraded: true };
  }
  if (!input.parsed || !String(input.parsed.reply || '').trim()) {
    if (consult && input.consultContext) {
      return {
        ...base,
        intent: 'query_status',
        confidence: 0.85,
        reply: buildDegradedConsultReply(input.consultContext),
        degraded: true,
      };
    }
    // 技术合同失败 ≠ 语义「没听懂」；不得用关键词降级成执行
    return {
      ...base,
      reply: CONVERSE_PLAN_FAILED_NOTICE,
      needsClarification: false,
      degraded: true,
    };
  }
  const { intent, confidence, reply, planUpdate } = input.parsed;
  if (confidence < LOW_CONFIDENCE_THRESHOLD) {
    const safeReply = consult && input.consultContext
      ? assertConsultReplyConsistent(reply, input.consultContext)
      : reply;
    return {
      ...base,
      intent: consult && intent === 'other' ? 'query_status' : intent,
      confidence,
      reply: safeReply,
      needsClarification: true,
      // 低置信度不写入规划草稿，避免误更新
    };
  }
  const decision: ConverseDecision = { ...base, intent, confidence, reply };
  if (planUpdate) decision.planDraftContent = planUpdate;
  switch (intent) {
    case 'add_goal_info':
    case 'modify_plan':
      // planUpdate 已在上方写入
      break;
    case 'artifact_feedback': {
      // FIX-22：成果后 Owner 明确修订 → user_directed_revision；不得因自动修订暂停而吞掉。
      if (confidence < EXECUTION_EFFECT_CONFIDENCE_THRESHOLD) {
        decision.needsClarification = true;
        break;
      }
      if (input.jobRunning || input.firstTurn || !input.hasArtifact) break;
      const route = classifyOwnerRevisionRoute({
        userText: input.userText || '',
        hasArtifact: true,
        intent: 'artifact_feedback',
      });
      if (route === 'consultation') break;
      if (route === 'clarify_revision') {
        decision.needsClarification = true;
        if (!/具体|哪|请说明|想改成什么|需要你确认/.test(decision.reply)) {
          decision.reply = `${decision.reply}\n\n请再说具体一点要改成什么样，或指出要改的位置；确认后我再动手。`.trim();
        }
        break;
      }
      if (route === 'user_directed_revision') {
        decision.startAuthorized = true;
        decision.startMode = 'revision';
      }
      break;
    }
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
  if (consult && input.consultContext) {
    decision.startAuthorized = false;
    decision.adoptRequested = false;
    decision.confirmPlan = false;
    if (intent === 'other') decision.intent = 'query_status';
    decision.reply = assertConsultReplyConsistent(decision.reply, input.consultContext);
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
  /** D11-D：暂停自动修订 / 目标变更后解除暂停。 */
  updateRevisionLoop?(
    taskId: string,
    patch: import('./controlled-revision').TaskRevisionLoopMeta | ((prev: import('./controlled-revision').TaskRevisionLoopMeta) => import('./controlled-revision').TaskRevisionLoopMeta),
  ): Promise<Task>;
  getTaskFacts(taskId: string): Promise<ConverseTaskFacts>;
}

export interface WorkConverseInput {
  taskId?: string;
  text: string;
  /** 首轮建任务时可携带材料/项目引用。 */
  contextRefs?: ContextRef[];
  /**
   * 薄主链：执行失败后由 Runtime 触发的结果说明。
   * 不把这句话当作 Owner 新决策，不授权开始/采用。
   */
  silentOutcomeExplain?: boolean;
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
  plan?: {
    version: number;
    status: 'draft' | 'confirmed';
    content: string;
    source?: 'model' | 'seed_internal';
  };
  /** 规划生成失败（模型合同失败）；Task 仍已持久化。 */
  planGenerationFailed?: boolean;
  /** 薄主链标记（若该 Task 走 thin_v1）。 */
  runtimePath?: 'legacy' | 'thin_v1';
  startAuthorized: boolean;
  startMode?: 'new_execution' | 'revision';
  /** 确认开始后建议的执行意图（由确认方案判定；Renderer/submitTask 复用）。 */
  executionIntentKind?: TaskIntentKind;
  executionRequestedArtifactType?: string;
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
  let forceUnparseable = false;
  const unparseableFlag = String(process.env.DIGITALME_20A_FORCE_UNPARSEABLE || '').trim();
  if (unparseableFlag) {
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(unparseableFlag);
      forceUnparseable = true;
    } catch {
      forceUnparseable = false;
    }
  }
  if (deps.chat && !forceUnparseable) {
    const materialBrief = await buildConverseMaterialBrief({
      contextRefs: task.contextRefs || [],
      goal: task.goal,
    });
    const messages = buildConverseMessages({
      goal: task.goal,
      facts,
      ...(existingPlan && isUserVisiblePlan(existingPlan) ? { plan: existingPlan } : {}),
      recentTurns: recentTurnsWindow(existingTurns),
      userText: text,
      ...(materialBrief.promptBlock ? { materialBrief: materialBrief.promptBlock } : {}),
    });
    try {
      const result = await deps.chat({ messages });
      parsed = parseConverseModelOutput(result.text);
      let usedContractRepair = false;
      if (!parsed) {
        usedContractRepair = true;
        const retry = await deps.chat({
          messages: [
            ...messages,
            { role: 'assistant' as const, content: String(result.text || '').slice(0, 2000) },
            { role: 'user' as const, content: CONVERSE_REPAIR_USER },
          ],
        });
        parsed = parseConverseModelOutput(retry.text);
      }
      const needsExecRoute =
        !!parsed &&
        parsed.intent === 'confirm_start' &&
        !createdTask &&
        !facts.hasArtifact &&
        parsed.confidence >= EXECUTION_EFFECT_CONFIDENCE_THRESHOLD &&
        !validateConfirmedPlanExecutionIntent(parsed);
      if (needsExecRoute && !usedContractRepair) {
        const retry = await deps.chat({
          messages: [
            ...messages,
            { role: 'assistant' as const, content: JSON.stringify({
              intent: parsed!.intent,
              confidence: parsed!.confidence,
              reply: parsed!.reply,
            }).slice(0, 2000) },
            { role: 'user' as const, content: CONVERSE_REPAIR_USER },
          ],
        });
        parsed = parseConverseModelOutput(retry.text);
      }
      // 首轮必须拿到模型规划正文；缺 planUpdate 时再 repair 一次
      if (parsed && createdTask && !existingPlan && !parsed.planUpdate) {
        const planRetry = await deps.chat({
          messages: [
            ...messages,
            {
              role: 'assistant' as const,
              content: JSON.stringify({
                intent: parsed.intent,
                confidence: parsed.confidence,
                reply: parsed.reply,
              }).slice(0, 2000),
            },
            { role: 'user' as const, content: CONVERSE_FIRST_TURN_PLAN_REPAIR },
          ],
        });
        const repaired = parseConverseModelOutput(planRetry.text);
        if (repaired) parsed = repaired;
      }
    } catch {
      chatFailed = true;
    }
  }

  const consultContext: ConsultTaskContext = {
    goal: task.goal,
    stageLabel: facts.stageLabel,
    hasArtifact: facts.hasArtifact,
    jobRunning: facts.jobRunning,
    ...(facts.latestJobStatus ? { latestJobStatus: facts.latestJobStatus } : {}),
    ...(facts.ownerDecision ? { ownerDecision: facts.ownerDecision } : {}),
    ...(facts.canAdoptSuggested != null ? { canAdoptSuggested: facts.canAdoptSuggested } : {}),
    ...(facts.ctoReport ? { ctoReport: facts.ctoReport } : {}),
    ...(facts.lastFailure ? { lastFailure: facts.lastFailure } : {}),
  };
  const decision = decideConverseEffects({
    parsed,
    modelAvailable: modelAvailable && !chatFailed,
    hasArtifact: facts.hasArtifact,
    jobRunning: facts.jobRunning,
    firstTurn: createdTask,
    userText: text,
    consultContext,
  });
  if (
    decision.startAuthorized &&
    decision.startMode !== 'revision' &&
    !validateConfirmedPlanExecutionIntent(parsed || {})
  ) {
    decision.startAuthorized = false;
    decision.confirmPlan = false;
    decision.degraded = true;
    decision.reply = CONVERSE_EXECUTION_ROUTE_FAILED_NOTICE;
  }

  if (input.silentOutcomeExplain) {
    decision.startAuthorized = false;
    decision.adoptRequested = false;
    decision.confirmPlan = false;
    decision.pauseRequested = false;
    delete decision.planDraftContent;
    decision.intent = 'query_status';
    if (!parsed || chatFailed || decision.degraded) {
      const evidence = String(facts.lastFailure || '').trim();
      decision.reply = evidence
        ? `这次没有做成。${evidence} 你可以改一下要求后再试，或先检查项目位置和代码执行能力是否可用。`
        : '这次没有做成。我还没有拿到足够的失败说明。你可以再试一次，或换一种说法说明目标。';
      decision.degraded = false;
      decision.needsClarification = false;
    }
  }

  // 规划效果（先于对话落盘，保证返回的 plan 与存储一致）
  let planOut: WorkConverseResult['plan'];
  let planGenerationFailed = false;
  let draftContent = decision.planDraftContent;
  const thin = isThinOwnerRuntime(task);
  // 确认是唯一主动作：已有可见规划且本轮确认执行时，忽略同轮 planUpdate，不升版。
  // 真正修改规划（confirmPlan=false 且带 planUpdate）仍生成新 draft。thin / 非 thin 同一规则。
  if (decision.confirmPlan && existingPlan && isUserVisiblePlan(existingPlan)) {
    draftContent = undefined;
  }
  let planSource: 'model' | 'seed_internal' = 'model';

  // 首轮：仅模型 planUpdate 可成为用户可见开发规划；失败则内部 seed + 明确失败语义
  if (createdTask && !existingPlan) {
    if (draftContent && parsed) {
      planSource = 'model';
    } else if (!draftContent) {
      planGenerationFailed = true;
      planSource = 'seed_internal';
      draftContent = [
        `目标：${task.goal}`,
        '交付：（内部恢复材料，未完成模型规划）',
        '路径：（待重试生成）',
        '准备：若需改代码，需要可用的项目位置与已连接的代码执行能力',
        '边界：不会自动提交、推送或发布；仅在你确认的项目范围内工作',
      ].join('\n');
      if (!decision.degraded && modelAvailable && !chatFailed) {
        decision.reply = CONVERSE_PLAN_FAILED_NOTICE;
        decision.degraded = true;
      } else if (!String(decision.reply || '').trim()) {
        decision.reply = CONVERSE_PLAN_FAILED_NOTICE;
        decision.degraded = true;
      }
    }
  } else if (draftContent) {
    planSource = 'model';
  }

  if (draftContent) {
    const nextPlan: TaskPlan = {
      version: (existingPlan?.version ?? 0) + 1,
      status: 'draft',
      content: draftContent,
      updatedAt: nowIso(),
      source: planSource,
      ...(existingPlan?.confirmedFacts ? { confirmedFacts: existingPlan.confirmedFacts } : {}),
    };
    await deps.updatePlan(task.id, nextPlan);
    // 仅用户可见规划回传给渲染层
    if (isUserVisiblePlan(nextPlan)) {
      planOut = {
        version: nextPlan.version,
        status: nextPlan.status,
        content: nextPlan.content,
        ...(nextPlan.source ? { source: nextPlan.source } : { source: 'model' as const }),
      };
    }
  } else if (decision.confirmPlan) {
    if (!existingPlan || !isUserVisiblePlan(existingPlan)) {
      // 不得用空规划或内部 seed 确认开始
      decision.startAuthorized = false;
      decision.confirmPlan = false;
    } else {
      const confirmedSource =
        existingPlan.source === 'seed_internal' ? 'model' : existingPlan.source || 'model';
      const confirmed: TaskPlan = {
        ...existingPlan,
        status: 'confirmed',
        updatedAt: nowIso(),
        confirmedAt: nowIso(),
        source: confirmedSource,
      };
      await deps.updatePlan(task.id, confirmed);
      planOut = {
        version: confirmed.version,
        status: confirmed.status,
        content: confirmed.content,
        source: confirmedSource,
      };
    }
  } else if (existingPlan && isUserVisiblePlan(existingPlan)) {
    planOut = {
      version: existingPlan.version,
      status: existingPlan.status,
      content: existingPlan.content,
      ...(existingPlan.source ? { source: existingPlan.source } : {}),
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
    turnId: input.silentOutcomeExplain ? replyTurn.turnId : userTurn.turnId,
    intent: decision.intent,
    confidence: decision.confidence,
    ...(decision.needsClarification ? { needsClarification: true } : {}),
    ...(decision.degraded ? { degraded: true } : {}),
    createdAt: nowIso(),
  };
  const persistedTurns = input.silentOutcomeExplain ? [replyTurn] : [userTurn, replyTurn];
  await deps.appendConversation(task.id, {
    turns: persistedTurns,
    intents: [conclusion],
  });

  // D11-D：暂停/目标变更与自动修订闸门联动（不新建命令）
  if (deps.updateRevisionLoop) {
    if (decision.pauseRequested) {
      await deps.updateRevisionLoop(task.id, (prev) => {
        const next = { ...prev, paused: true, pauseReason: 'user_pause' };
        delete next.inFlightJobId;
        return next;
      });
    } else if (
      decision.intent === 'modify_plan' ||
      decision.intent === 'add_goal_info' ||
      decision.planDraftContent ||
      // Owner 明确修订：解除自动修订暂停，但不等于启动 system_auto_revision
      (decision.startAuthorized && decision.startMode === 'revision')
    ) {
      await deps.updateRevisionLoop(task.id, (prev) => {
        const next = { ...prev, paused: false };
        delete next.pauseReason;
        return next;
      });
    }
  }

  let executionIntentKind: TaskIntentKind | undefined;
  let executionRequestedArtifactType: string | undefined;
  if (decision.startAuthorized && decision.startMode !== 'revision') {
    const resolved = validateConfirmedPlanExecutionIntent(parsed || {});
    if (resolved) {
      executionIntentKind = resolved.intentKind;
      executionRequestedArtifactType = resolved.expectedOutputFamily;
    }
  }

  return {
    taskId: task.id,
    createdTask,
    intent: decision.intent,
    confidence: decision.confidence,
    reply: decision.reply,
    needsClarification: decision.needsClarification,
    degraded: decision.degraded,
    newTurns: persistedTurns,
    ...(planOut ? { plan: planOut } : {}),
    ...(planGenerationFailed ? { planGenerationFailed: true } : {}),
    ...(thin ? { runtimePath: 'thin_v1' as const } : {}),
    startAuthorized: decision.startAuthorized,
    ...(decision.startMode ? { startMode: decision.startMode } : {}),
    ...(executionIntentKind ? { executionIntentKind } : {}),
    ...(executionRequestedArtifactType
      ? { executionRequestedArtifactType }
      : {}),
    adoptRequested: decision.adoptRequested,
    pauseRequested: decision.pauseRequested,
  };
}
