/**
 * 对话回复用主体上下文装配 — 与「数字之我」页共用同一派生来源。
 *
 * 纪律:
 * - 直接消费唯一的「当前有效本人认识」选择器 buildUserVisibleFacts 的同一结果，
 *   不允许对话再做页面没有的二次过滤；
 * - 每条事实包含可独立理解的具体 detail（title：detail），不传纯标题；
 * - 候选 / 已失效 / 任务临时材料 / 外部项目主张 / 内部过程事件 / 维度标签由选择器统一排除，
 *   不进页面也不进对话；
 * - 不暴露内部字段名与事件 ID;只输出用户面自然语言;
 * - 数量与字符预算,避免主体资料挤占对话窗口;
 * - normal 与 growth_guided 走同一装配函数,保证同一主体事实来源。
 */
import type { SubjectDerivedBundle } from './derive-all';
import {
  buildUserVisibleFacts,
  MAX_USER_VISIBLE_FACTS,
  MAX_USER_VISIBLE_FACTS_CHARS,
  type UserVisibleFactItem,
} from './user-facing-overview';

/** 对话上下文最大事实条数（与页面共用同一上限）。 */
export const CONVERSATION_CONTEXT_MAX_ITEMS = MAX_USER_VISIBLE_FACTS;
/** 对话上下文事实文本总字符预算（与页面共用同一预算，保证同一份已裁剪数组）。 */
export const CONVERSATION_CONTEXT_MAX_CHARS = MAX_USER_VISIBLE_FACTS_CHARS;

export interface ConversationContextItem {
  text: string;
}

export interface ConversationContextResult {
  /** 用于注入系统提示的事实文本（已去重、已裁剪；空串表示无可注入事实）。 */
  text: string;
  items: ConversationContextItem[];
  count: number;
}

/** 读取成功：text 为空表示当前确实没有可注入的本人认识（不是失败）。 */
export interface ConversationContextOkResult extends ConversationContextResult {
  ok: true;
}

/** 读取失败：不得转成空主体继续调用模型。 */
export interface ConversationContextErrorResult {
  ok: false;
  reason: 'no_package' | 'read_failed';
}

export type ConversationSubjectContextResult = ConversationContextOkResult | ConversationContextErrorResult;

/**
 * 从主体派生视图装配对话上下文。
 * 直接取「数字之我」页同源的 buildUserVisibleFacts 结果（数量与字符预算已在该选择器内完成），
 * 不再做页面没有的二次过滤或二次裁剪 — 保证页面/对话/受控回复消费同一份已裁剪事实数组。
 */
export function buildConversationSubjectContext(
  derived: SubjectDerivedBundle,
  opts: { maxItems?: number; maxChars?: number } = {},
): ConversationContextResult {
  const maxItems = opts.maxItems ?? CONVERSATION_CONTEXT_MAX_ITEMS;
  const maxChars = opts.maxChars ?? CONVERSATION_CONTEXT_MAX_CHARS;
  const items: ConversationContextItem[] = [];
  for (const item of buildUserVisibleFacts(derived, { maxItems, maxChars })) {
    const text = String(item.text || '').trim();
    if (!text) continue;
    items.push({ text });
  }
  return {
    text: items.map((i) => i.text).join('；'),
    items,
    count: items.length,
  };
}

export interface ConversationSystemInput {
  /** 01B：与页面「已经了解」逐项相等的事实列表（每条自包含具体值）。 */
  subjectFacts?: string[];
  /** 兼容旧调用：已连接事实文本。 */
  subjectContext?: string;
  /** 成长引导指令（仅 growth_guided 时携带；normal 为空）。 */
  growthGuide?: string;
}

function resolveFacts(input: ConversationSystemInput): string[] {
  if (Array.isArray(input.subjectFacts) && input.subjectFacts.length > 0) {
    return input.subjectFacts.map((s) => String(s).trim()).filter(Boolean);
  }
  return String(input.subjectContext || '')
    .split('；')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 装配对话系统提示。
 * - 有主体事实：不得声称一无所知；只能依据已提供事实回答；不足处明确说「不确定」，不得推断或虚构；
 * - 无主体事实：如实说明了解不足，不得编造用户信息。
 */
export function buildConversationSystemContent(input: ConversationSystemInput = {}): string {
  const base =
    '你是用户的数字之我助手。根据对话上下文直接、具体地回答最终答复正文。' +
    '不要用「已记下」代替回答；不要假装已完成任务；不要输出分析过程、推理提纲或内部标签。';
  const facts = resolveFacts(input);
  let subjectRule = '';
  if (facts.length > 0) {
    subjectRule =
      `\n\n关于用户，你当前掌握以下已确认的认识（只能依据这些内容回答关于用户本人的问题）：\n` +
      facts.map((line) => `- ${line}`).join('\n') +
      `\n要求：已经掌握上述认识时，不得声称对用户一无所知或没有任何信息；` +
      `只能依据上述认识回答关于用户本人的问题；对认识之外的方面应明确说「不确定」，不得推断或虚构。`;
  } else {
    subjectRule =
      `\n\n关于用户，你目前还没有已确认的认识。` +
      `对关于用户本人的问题应如实说明了解不足，明确说「不确定」，不得编造或推断用户信息。`;
  }
  const guide = String(input.growthGuide || '').trim();
  return base + subjectRule + (guide ? `\n\n${guide}` : '');
}

/**
 * 01B：unsupported inference 检测 —— 在回复返回给用户前执行。
 * 仅当回复中包含「无具体事实支撑的本人推断」（求职状态/职业阶段/性格/价值判断/身份推断）时命中。
 * 若命中的关键词能在 userVisibleFacts 的具体事实（title/detail）中找到直接支撑，则不算违规。
 */
export type UnsupportedInferenceCategory =
  | 'job_status'
  | 'career_stage'
  | 'personality'
  | 'value_judgment'
  | 'identity_inference';

export interface UnsupportedInferenceHit {
  category: UnsupportedInferenceCategory;
  matched: string;
  /** 命中关键词原文片段上下文（前后 20 字）。 */
  context: string;
}

const UNSUPPORTED_INFERENCE_PATTERNS: ReadonlyArray<{
  category: UnsupportedInferenceCategory;
  regex: RegExp;
}> = [
  {
    category: 'job_status',
    regex: /(正在|已经|准备|打算|想|想要|有意|在找|正在找|马上要|或许|可能)?\s*(求职|找工作|换工作|跳槽|面试|投简历|找工作方向|找工作目标)/i,
  },
  { category: 'job_status', regex: /(是|属于|处在|处于|目前是)\s*(应届生|往届生|在校生|实习生|无业|待业|失业)/i },
  { category: 'job_status', regex: /(被裁员|被开除|被辞退|刚离职|裸辞)/i },
  {
    category: 'career_stage',
    regex: /(处于|处在|正在)?\s*(职业初期|职业中期|职业后期|职业上升期|职业转型期|职业瓶颈|事业起步|事业上升|事业巅峰|事业瓶颈)/i,
  },
  { category: 'career_stage', regex: /(几年经验|多年经验|资深|新人|小白|萌新|老手|菜鸟|职场老手)/i },
  {
    category: 'personality',
    regex: /(性格|人格|气质|性格上|本质上|骨子里|天性)\s*(是|属于|偏向|倾向|偏)?\s*(内向|外向|开朗|内敛|敏感|理性|感性|严谨|随性|保守|激进|强势|软弱|固执|随和|完美主义|完美型|控制欲|冒险|理性主义|理想主义)/i,
  },
  {
    category: 'personality',
    regex: /(你是一个|你是个|你本质上|你其实是)\s*(内向|外向|开朗|内敛|敏感|理性|感性|完美主义|控制型|依赖型|强势|软弱|固执|随和)/i,
  },
  {
    category: 'value_judgment',
    regex: /(你|你本人|你这个人|本质上|其实)\s*(更)?\s*(看重|重视|在乎|关心|关心的是|在意的|在意的是|更在意的|更看重的是)\s*(金钱|钱|高薪|薪酬|待遇|稳定|安全感|成长|自由|成就感|权力|地位|名声|面子|家庭|工作|事业|梦想|理想|情怀|人际|关系)/i,
  },
  {
    category: 'identity_inference',
    regex: /(你|你本人|你是一个|你是个)\s*(求职者|应聘者|面试者|候选人|找工作者|职场人|打工人|社畜|内卷人)/i,
  },
  {
    category: 'identity_inference',
    regex: /(看起来|看上去|感觉)\s*(你|你本人)?\s*(是|像是|应该是)\s*(求职者|应聘者|面试者|候选人|找工作者|打工人|职场人)/i,
  },
];

export function detectUnsupportedInference(
  reply: string,
  userVisibleFacts: ReadonlyArray<Pick<UserVisibleFactItem, 'text' | 'title' | 'detail'>>,
): UnsupportedInferenceHit[] {
  const out: UnsupportedInferenceHit[] = [];
  const text = String(reply || '');
  if (!text) return out;
  for (const { category, regex } of UNSUPPORTED_INFERENCE_PATTERNS) {
    const m = regex.exec(text);
    if (m && m[0]) {
      const idx = m.index;
      const start = Math.max(0, idx - 20);
      const end = Math.min(text.length, idx + m[0].length + 20);
      out.push({ category, matched: m[0], context: text.slice(start, end) });
    }
  }
  if (out.length === 0) return out;
  const factsBlob = userVisibleFacts
    .map((f) => `${f.text} ${f.title || ''} ${f.detail || ''}`)
    .join(' ');
  return out.filter((hit) => {
    const inFact = new RegExp(hit.matched.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(factsBlob);
    return !inFact;
  });
}

/**
 * 01C：主体事实查询判定。用户询问数字之我对「我」的印象/了解/认识时返回 true。
 * 仅命中「对本人事实的查询」，不命中普通对话或任务请求。
 */
/** 问「是否更了解 / 怎么增加了解」是过程或变化，不是要一份本人事实清单。 */
export function isSubjectUnderstandingDeltaOrProcessQuery(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  return (
    /通过什么方式|用什么方式|以什么方式|怎么增加|如何增加|怎样增加|怎么知道|如何知道|从哪[里儿]知道/.test(t) ||
    /了解(多了|增加了|更多了|更深了|更清楚|变多)/.test(t) ||
    /(多了|增加了|更多了).{0,8}了解/.test(t) ||
    /比(以前|之前|刚才|刚开始|过去).{0,12}(了解|认识)/.test(t)
  );
}

export function isSubjectFactQuery(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  if (isSubjectUnderstandingDeltaOrProcessQuery(t)) return false;
  const zh =
    /(关于我|对我|对于我|你眼中|你心里的我|你记得的我)[^？?。\n]{0,16}(印象|了解|认识|看法|感觉|评价|什么样|什么样子|怎么样|怎样|如何|记得什么样|知道什么样)/.test(t) ||
    /^(你|你到|究竟|还)?(了解|认识|记得|知道|记得起)我(什么|多少|吗|么|了)?[？?]?$/.test(t) ||
    /^(你对|对)?(我|我的)(的印象|的了解|的认识|的看法)(是|是什么|是什么样|如何|怎么样|怎样)?[？?]?$/.test(t) ||
    /^(你觉得|你认为|你看|你说说)(我|我是|我是怎样)(是)?(什么样|什么样子|怎么样|怎样|如何|是什么)的?(人|样子)?[？?]?$/.test(t);
  const en = /(what do you (know|think)|how well do you know|your impression of me|do you know me|tell me about me|what do you remember about me|what have you learned about me)/i.test(t);
  return zh || en;
}

/** 01D/01E：本人属性主题词（仅用于结构化句式，不得与任意第一人称词简单共现）。 */
const PERSONAL_ATTR_TOPIC =
  '求职|找工作|换工作|跳槽|面试|投简历|待业|失业|被裁|辞退|裸辞|' +
  '职业(初期|中期|后期|转型|瓶颈|阶段|状态)|事业(起步|上升|巅峰|瓶颈)|资深|新人|多年经验|职场老手|' +
  '性格|人格|气质|内向|外向|开朗|内敛|敏感|理性|感性|严谨|随性|保守|激进|强势|软弱|固执|随和|完美主义|控制欲|冒险|理想主义|' +
  '是什么样的人|身份|求职者|应聘者|面试者|候选人|打工人|职场人|社畜|' +
  '价值|价值观';

/**
 * 01D：本人推断查询判定（已废弃的第一版：任意第一人称词与主题词共现，误拦截一般知识问题）。
 * 01E：高精度句式判定 —— 只拦截「明确询问本人属性」的表达：
 *  - 我是不是/是否/算不算/属不属于 + 有限语义连接词 + 属性主题（禁止任意字符窗口）；
 *  - 你觉得/认为/判断/看 我/我的 + 属性主题；
 *  - 我的+属性 + 是/处于 + 什么/怎样；
 *  - 我(在/正在/最近)+求职行为 + 吗（直接问本人求职状态，必须带问句标记）；
 *  - 我(更)?看重/在乎 + 什么（本人价值偏好）；
 *  - 我(适不适合/能不能)+求职行为（本人胜任询问）。
 * 「帮我分析求职市场」「给我介绍职业中期的常见挑战」「我想知道内向和外向有什么区别」
 * 「我是不是应该了解求职市场」「我是否可以研究职业中期的挑战」「我算了下求职成本，请帮我核对。」
 * 以及「求职是什么」「职业中期有什么挑战」「如何写简历」等一般知识问题必须放行（返回 false）。
 */
export function isPersonalInferenceQuery(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;

  // 1) 我是不是/是否/算不算/属不属于 + 有限语义连接词 + 属性主题。
  //    连接词为闭合集合（正在/最近在/在/算是/属于/处于/处在），禁止任意字符窗口；
  //    不含单字「算」（排除「我算了下求职成本」等计算类表达）。
  const beQuestion = new RegExp(
    `我(是不是|是否|算不算|属不属于)(正在|最近在|在|算是|属于|处于|处在)?(${PERSONAL_ATTR_TOPIC})`,
    'i',
  );
  // 2) 你觉得/认为/判断/看 我/我的 + 属性主题
  const opinionQuestion = new RegExp(
    `(你觉得|你认为|你判断|你说|你看|在你眼中|你分析)(我|我的)(的)?(${PERSONAL_ATTR_TOPIC})`,
    'i',
  );
  // 3) 我的/本人 + 属性 + 是/属于/处于/算不算 + 什么/怎样/如何
  const myAttributeQuestion = new RegExp(
    `(我的|本人)(的)?(${PERSONAL_ATTR_TOPIC})(是|属于|处于|算不算)?(什么|怎么样|怎样|如何|哪一种|哪一类)[？?]?$`,
    'i',
  );
  // 4) 我(在/正在/现在/最近)+求职行为 + 吗（本人求职状态直接询问；必须带问句标记）
  const directJobStatus = new RegExp(
    `我(是否)?(在|正在|现在|最近)?在?(求职|找工作|换工作|跳槽|面试|投简历|待业|失业)([^。？?]{0,10})?(吗|么|呢|是不是|有没有|对不对)[？?]?$`,
    'i',
  );
  // 5) 我(更)?看重/重视/在乎/在意/关心 + 什么（本人价值偏好）
  const valuePreference = /我(更|最)?(看重|重视|在乎|在意|关心)(什么|哪些|哪方面|什么方面)[？?]?$/i;
  // 6) 我(适不适合/能不能/可以/该) + 求职行为（本人胜任询问）
  const fitQuestion = new RegExp(
    `我(适不适合|适合|能不能|能|可以|可不可以|该|该不该|能否)去?(求职|找工作|面试|投简历|跳槽|换工作)`,
    'i',
  );

  return (
    beQuestion.test(t) ||
    opinionQuestion.test(t) ||
    myAttributeQuestion.test(t) ||
    directJobStatus.test(t) ||
    valuePreference.test(t) ||
    fitQuestion.test(t)
  );
}

/** 01C 受控回复固定边界文案。 */
export const CONTROLLED_REPLY_LEAD = '我目前确认的是：';
export const CONTROLLED_REPLY_TAIL = '。除此之外，我还不确定。';
export const CONTROLLED_REPLY_EMPTY = '我目前还没有已确认的关于你的具体事实';

/**
 * 01C：由 userVisibleFacts 直接生成受控回复。
 * 只允许出现 userVisibleFacts 原文（逐项）与固定边界文案；
 * 不得添加动机、性格、职业状态、价值偏好或使用场景解释。
 */
export function buildControlledFactualReply(facts: readonly string[]): string {
  const list = (facts || []).map((s) => String(s).trim()).filter(Boolean);
  if (list.length === 0) {
    return `${CONTROLLED_REPLY_LEAD}${CONTROLLED_REPLY_EMPTY}${CONTROLLED_REPLY_TAIL}`;
  }
  return `${CONTROLLED_REPLY_LEAD}${list.join('；')}${CONTROLLED_REPLY_TAIL}`;
}