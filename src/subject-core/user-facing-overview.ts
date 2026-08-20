/**
 * 将派生视图裁成用户可感知切片 — 不含内部术语文案。
 * 供 getOverview 与成果侧「使用了什么」共用。
 *
 * GROWTH-CONTEXT-CONSISTENCY-FIX-01B：
 * 「已经了解」只能展示**具体事实及其具体值**（title + 可独立理解的具体 detail）。
 * 只有维度名、泛化摘要或缺少具体值的事件不得标为 known。
 * 页面「已经了解」、growth cockpit known、对话模型上下文共用同一份
 * buildUserVisibleFacts 投影源，逐项相等。
 */
import type { ActiveSubjectItem, SubjectDerivedBundle } from './derive-all';
import type { SubjectContextFreeze } from './subject-context-freeze';
import { requiresOwnerConfirmation } from './candidate-distill';
import { phraseRecentLearning } from './small-loop';
import { isInternalGrowthPhrase } from './growth-dimensions';

export interface ActiveUnderstandingItem {
  eventId: string;
  text: string;
}

/**
 * 01B：统一的「当前有效本人认识」事实项。
 * text 为 title：detail，必须自包含具体值（如「简历文件格式要求：word和pdf各一」）。
 */
export interface UserVisibleFactItem {
  eventId: string;
  kind: ActiveSubjectItem['kind'];
  title: string;
  detail: string;
  /** 具体事实及其具体值，页面/模型逐项共用 */
  text: string;
}

export interface RecentLearningItem {
  eventId: string;
  text: string;
  /** 是否建议轻量确认(C 类);UI 勿展示内部类型名。 */
  suggestConfirm: boolean;
  /** 自然语言来源说明 */
  sourceNote?: string;
}

export interface HelpfulQuestionItem {
  eventId: string;
  text: string;
}

export interface AppliedUnderstanding {
  notice: string;
  items: Array<{ text: string }>;
}

const MAX_RECENT = 5;
const MAX_GAPS = 3;
/** 页面与对话模型共用的具体事实上限。 */
export const MAX_USER_VISIBLE_FACTS = 6;
/** 页面与对话模型共用的事实文本总字符预算（含分隔符）。 */
export const MAX_USER_VISIBLE_FACTS_CHARS = 1200;
/** 具体事实的最短 detail 长度（不足视为无具体值）。 */
export const MIN_CONCRETE_DETAIL_CHARS = 4;

/**
 * 「当前有效本人认识」排除判定 — 唯一的来源筛选规则，页面「已经了解」与对话上下文共同遵守。
 * 排除：候选待确认（needs_confirmation）、任务临时材料（temporary / category:temporary_context /
 * expiresAt:）、外部项目主张（category:external_claim）、内部过程行（capture:noop /
 * growth:stage:* / growth:guide_choice:*）。
 */
export function isExcludedFromPersonalUnderstanding(tags: readonly string[]): boolean {
  return tags.some((t) => {
    if (
      t === 'category:temporary_context' ||
      t === 'category:external_claim' ||
      t === 'temporary' ||
      t === 'needs_confirmation' ||
      t === 'capture:noop'
    ) {
      return true;
    }
    if (t.startsWith('expiresAt:') || t.startsWith('growth:stage') || t.startsWith('growth:guide_choice')) {
      return true;
    }
    return false;
  });
}

const KIND_RANK: Record<string, number> = {
  identity: 0,
  goal: 1,
  principle: 2,
  experience: 3,
  boundary: 4,
  preference: 5,
};

/** 维度词表：仅由这些词构成的"事实"是维度标签，不是具体事实。 */
const DIMENSION_WORDS =
  '城市|地区|行业|领域|岗位|职位|职能|部门|阶段|状态|偏好|边界|原则|方向|目标|经验|背景|履历|简历|身份|关系|沟通|愿景|价值观|工作|现状|进展';

/** 整条 factText 仅为维度名/泛化说明（无具体值）的模式。 */
const DIMENSION_ONLY_PATTERNS: readonly RegExp[] = [
  new RegExp(
    `^\\s*(用户|本人|我|owner|Owner)?\\s*(所在|在|的|当前)?\\s*(${DIMENSION_WORDS})\\s*(与|和|及|、|,|相关|方面|情况|说明|信息|范围)?\\s*(${DIMENSION_WORDS}|概况|说明|信息|范围)?\\s*[：:。.；;,\\s]*$`,
    'i',
  ),
  new RegExp(
    `^\\s*(${DIMENSION_WORDS})\\s*(与|和|及|、|,)\\s*(${DIMENSION_WORDS})\\s*[：:。.；;,\\s]*$`,
    'i',
  ),
  /^\s*(本人|用户|我|owner|Owner)(的)?(基本情况|基本信息|基础信息|整体情况|整体概况|相关情况|相关信息|简介|概述)\s*[：:。.\s]*$/i,
  /^\s*(about|profile|overview|summary)\s*(of)?\s*(me|user|owner)?\s*[：:。.\s]*$/i,
];

/** 泛化/占位 detail：不是具体值。 */
const GENERIC_DETAIL_RE =
  /^(已确认|已了解|已记录|待确认|待补充|暂无|需要更多了解|更多了解|情况|说明|信息|范围|简介|概况|相关|大致|大概|相关情况|基本信息|基础信息|整体情况|整体概况|基本|概述|当前状态|现状)$/i;

/**
 * 01B 事实文案：title：detail —— 每条事实必须携带可独立理解的具体 detail。
 * 与 toUserFacingText 不同，这里**总是**带上 detail（不因 detail 短而只返回标题）。
 */
export function factText(title: string, detail: string): string {
  const t = (title || '').trim();
  const d = (detail || '').trim();
  if (!t) return d.slice(0, 200);
  if (!d) return t.slice(0, 200);
  return `${t}：${d.slice(0, 160)}`.slice(0, 240);
}

/**
 * 01B：判定一条 activeItem 是否为「具体可引用的事实」。
 * 必须同时满足：
 * - 有 title、非 asset；
 * - detail 非空且足够具体（>= MIN_CONCRETE_DETAIL_CHARS、非泛化占位）；
 * - 整条 factText 不是维度名/泛化摘要；
 * - 不命中内部成长短语。
 */
export function isConcreteFact(item: ActiveSubjectItem): boolean {
  if (!item) return false;
  const title = (item.title || '').trim();
  const detail = (item.detail || '').trim();
  if (!title) return false;
  if (item.kind === 'asset') return false;
  if (!detail || detail.length < MIN_CONCRETE_DETAIL_CHARS) return false;
  if (GENERIC_DETAIL_RE.test(detail)) return false;
  const text = factText(title, detail);
  if (isInternalGrowthPhrase(text)) return false;
  if (text.length < 6) return false;
  for (const pat of DIMENSION_ONLY_PATTERNS) {
    if (pat.test(text)) return false;
  }
  return true;
}

/**
 * 01B：唯一的「当前有效本人认识」事实选择器。
 * 01C：数量与字符预算在此一次性完成 —— 页面「已经了解」、growth cockpit known、
 * 对话模型上下文与受控回复消费同一份已裁剪数组，模型侧不得再单独裁剪。
 * 只保留已确认、当前有效、非资产、非临时/外部/内部过程、非维度标签、含具体值的本人信息。
 */
export function buildUserVisibleFacts(
  derived: SubjectDerivedBundle,
  opts: { maxItems?: number; maxChars?: number } = {},
): UserVisibleFactItem[] {
  const maxItems = opts.maxItems ?? MAX_USER_VISIBLE_FACTS;
  const maxChars = opts.maxChars ?? MAX_USER_VISIBLE_FACTS_CHARS;
  const inactive = new Set(derived.inactiveEventIds);
  const sorted = [...derived.activeItems]
    .filter((i) => !inactive.has(i.eventId))
    .sort((a, b) => (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9));

  const out: UserVisibleFactItem[] = [];
  const seen = new Set<string>();
  let chars = 0;
  for (const item of sorted) {
    if (out.length >= maxItems) break;
    if (item.kind === 'asset') continue;
    if (isExcludedFromPersonalUnderstanding(item.tags)) continue;
    if (!isConcreteFact(item)) continue;
    if (seen.has(item.eventId)) continue;
    seen.add(item.eventId);
    const text = factText(item.title, item.detail);
    const next = chars + text.length + (out.length > 0 ? 1 : 0);
    if (next > maxChars) break;
    chars = next;
    out.push({
      eventId: item.eventId,
      kind: item.kind,
      title: item.title,
      detail: item.detail,
      text,
    });
  }
  return out;
}

/**
 * 兼容旧名：01A 的「当前有效本人认识」选择器。01B 起由 buildUserVisibleFacts 提供唯一事实源，
 * 本函数仅做 text 投影（现在同样携带具体值）。
 */
export function selectValidPersonalUnderstandings(
  derived: SubjectDerivedBundle,
  opts: { maxItems?: number } = {},
): ActiveUnderstandingItem[] {
  const maxItems = opts.maxItems ?? MAX_USER_VISIBLE_FACTS;
  return buildUserVisibleFacts(derived, { maxItems }).map((f) => ({
    eventId: f.eventId,
    text: f.text,
  }));
}

export function toUserFacingText(title: string, detail: string): string {
  const t = (title || '').trim();
  const d = (detail || '').trim();
  if (!t) return d.slice(0, 160);
  if (!d || d === t) return t.slice(0, 160);
  // 标题已够用时不重复堆砌
  if (d.length <= 40 || t.includes(d.slice(0, 12))) return t.slice(0, 160);
  return `${t}：${d.slice(0, 100)}`.slice(0, 180);
}

export function buildUserFacingSubjectSlices(derived: SubjectDerivedBundle): {
  activeUnderstandings: ActiveUnderstandingItem[];
  /** 01B：页面「已经了解」、growth cockpit known、对话模型上下文共用的唯一事实投影。 */
  userVisibleFacts: UserVisibleFactItem[];
  recentLearnings: RecentLearningItem[];
  recentConfirmedLearnings: ActiveUnderstandingItem[];
  helpfulQuestions: HelpfulQuestionItem[];
} {
  const inactive = new Set(derived.inactiveEventIds);

  const userVisibleFacts = buildUserVisibleFacts(derived);
  const activeUnderstandings: ActiveUnderstandingItem[] = userVisibleFacts.map((f) => ({
    eventId: f.eventId,
    text: f.text,
  }));

  // Owner 验收轻量：「最近学到的内容」——已确认的偏好/项目决策/纠正（自然语言）
  const recentConfirmedLearnings: ActiveUnderstandingItem[] = [];
  const recentConfirmed = [...derived.activeItems]
    .filter((i) => !inactive.has(i.eventId))
    .filter(
      (i) =>
        i.kind === 'preference' ||
        i.tags.some((t) =>
          ['project_decision', 'correction', 'from_edit', 'from_reject', 'style'].includes(t),
        ),
    )
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  for (const item of recentConfirmed) {
    if (recentConfirmedLearnings.length >= MAX_RECENT) break;
    recentConfirmedLearnings.push({
      eventId: item.eventId,
      text: phraseRecentLearning({
        title: item.title,
        detail: item.detail,
        tags: item.tags,
      }),
    });
  }

  const recentLearnings: RecentLearningItem[] = [];
  const candidates = [...derived.candidates.entries]
    .filter((e) => e.type !== 'asset_added')
    .filter((e) => !(e.tags || []).includes('capture:noop'))
    .sort((a, b) => {
      const aC = requiresOwnerConfirmation(a.type, a.tags) ? 0 : 1;
      const bC = requiresOwnerConfirmation(b.type, b.tags) ? 0 : 1;
      return aC - bC || b.occurredAt.localeCompare(a.occurredAt);
    });
  for (const item of candidates) {
    if (recentLearnings.length >= MAX_RECENT) break;
    const row: RecentLearningItem = {
      eventId: item.eventId,
      text: toUserFacingText(item.title, item.detail),
      suggestConfirm: requiresOwnerConfirmation(item.type, item.tags),
    };
    const note = naturalSourceNote(item.tags || []);
    if (note) row.sourceNote = note;
    recentLearnings.push(row);
  }

  const helpfulQuestions: HelpfulQuestionItem[] = [];
  for (const gap of derived.knowledgeGaps.entries) {
    if (helpfulQuestions.length >= MAX_GAPS) break;
    const raw = toUserFacingText(gap.title, gap.detail);
    const text = /[？?]$/.test(raw) ? raw : gapAsQuestion(raw);
    helpfulQuestions.push({ eventId: gap.eventId, text });
  }

  return { activeUnderstandings, userVisibleFacts, recentLearnings, recentConfirmedLearnings, helpfulQuestions };
}

function naturalSourceNote(tags: readonly string[]): string | undefined {
  if (tags.some((t) => t.includes('from_edit') || t === 'artifact_edit')) {
    return '来自你修改并采用的成果';
  }
  if (tags.some((t) => /sourceKind:conversation|conversation/.test(t))) {
    return '来自你的说明';
  }
  if (tags.includes('category:external_claim') || tags.includes('project_fact')) {
    return '来自你提供的资料（项目观点，不是你的个人立场）';
  }
  if (tags.includes('category:temporary_context') || tags.some((t) => t.startsWith('expiresAt:'))) {
    return '来自某次任务中的临时要求';
  }
  if (tags.includes('conflict') || tags.includes('needs_confirmation')) {
    return '与已有内容可能不一致，待你确认';
  }
  return '来自你近期的使用与反馈';
}

function gapAsQuestion(raw: string): string {
  const body = raw
    .replace(/^还不确定[：:]\s*/, '')
    .replace(/^需要更多了解[：:]\s*/, '')
    .trim();
  if (!body) return '还有哪一点希望数字之我先了解？';
  if (/偏好|简短|完整|分析|结论/.test(body)) {
    return '你更偏好简短结论，还是完整分析？';
  }
  if (/目标|阶段|方向|项目/.test(body)) {
    return '这个项目当前最重要的阶段目标是什么？';
  }
  return `${body.slice(0, 80)}${/[？?]$/.test(body) ? '' : '？'}`;
}

export function buildAppliedUnderstanding(
  freeze: SubjectContextFreeze | null | undefined,
): AppliedUnderstanding | undefined {
  if (!freeze || freeze.entries.length === 0) return undefined;
  // 成果区轻量提示：固定文案 + 最多 3 条实际使用条目（不暴露学习机制）
  const items = freeze.entries.slice(0, 3).map((e) => ({
    text: toUserFacingText(e.title, e.detail),
  }));
  if (items.length === 0) return undefined;
  return { notice: '已结合你之前确认的内容', items };
}
