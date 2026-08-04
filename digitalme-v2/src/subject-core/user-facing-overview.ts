/**
 * 将派生视图裁成用户可感知切片 — 不含内部术语文案。
 * 供 getOverview 与成果侧「使用了什么」共用。
 */
import type { SubjectDerivedBundle } from './derive-all';
import type { SubjectContextFreeze } from './subject-context-freeze';
import { requiresOwnerConfirmation } from './candidate-distill';

export interface ActiveUnderstandingItem {
  eventId: string;
  text: string;
}

export interface RecentLearningItem {
  eventId: string;
  text: string;
  /** 是否建议轻量确认(C 类);UI 勿展示内部类型名。 */
  suggestConfirm: boolean;
}

export interface HelpfulQuestionItem {
  eventId: string;
  text: string;
}

export interface AppliedUnderstanding {
  notice: string;
  items: Array<{ text: string }>;
}

const MAX_ACTIVE = 6;
const MAX_RECENT = 5;
const MAX_GAPS = 3;

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
  recentLearnings: RecentLearningItem[];
  helpfulQuestions: HelpfulQuestionItem[];
} {
  const inactive = new Set(derived.inactiveEventIds);

  const activeUnderstandings: ActiveUnderstandingItem[] = [];
  const kindRank: Record<string, number> = {
    identity: 0,
    goal: 1,
    principle: 2,
    experience: 3,
    boundary: 4,
    preference: 5,
  };
  const sorted = [...derived.activeItems]
    .filter((i) => !inactive.has(i.eventId))
    .sort((a, b) => (kindRank[a.kind] ?? 9) - (kindRank[b.kind] ?? 9));

  for (const item of sorted) {
    if (activeUnderstandings.length >= MAX_ACTIVE) break;
    if (item.kind === 'asset') continue;
    activeUnderstandings.push({
      eventId: item.eventId,
      text: toUserFacingText(item.title, item.detail),
    });
  }

  const recentLearnings: RecentLearningItem[] = [];
  const candidates = [...derived.candidates.entries]
    .filter((e) => e.type !== 'asset_added')
    .sort((a, b) => {
      const aC = requiresOwnerConfirmation(a.type, a.tags) ? 0 : 1;
      const bC = requiresOwnerConfirmation(b.type, b.tags) ? 0 : 1;
      return aC - bC || b.occurredAt.localeCompare(a.occurredAt);
    });
  for (const item of candidates) {
    if (recentLearnings.length >= MAX_RECENT) break;
    recentLearnings.push({
      eventId: item.eventId,
      text: toUserFacingText(item.title, item.detail),
      suggestConfirm: requiresOwnerConfirmation(item.type, item.tags),
    });
  }

  const helpfulQuestions: HelpfulQuestionItem[] = [];
  for (const gap of derived.knowledgeGaps.entries) {
    if (helpfulQuestions.length >= MAX_GAPS) break;
    const raw = toUserFacingText(gap.title, gap.detail);
    const text = /[？?]$/.test(raw) ? raw : gapAsQuestion(raw);
    helpfulQuestions.push({ eventId: gap.eventId, text });
  }

  return { activeUnderstandings, recentLearnings, helpfulQuestions };
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
  const items = freeze.entries.map((e) => ({
    text: toUserFacingText(e.title, e.detail),
  }));
  const kinds = new Set(freeze.entries.map((e) => e.kind));
  let notice = '已结合你之前确认的内容。';
  if (kinds.has('principle') && !kinds.has('experience')) {
    notice = '已结合你之前确认的工作原则。';
  } else if (kinds.has('experience')) {
    notice = '这次沿用了你上次修改后的表达方式。';
  } else if (kinds.has('goal')) {
    notice = '已结合你确认过的方向。';
  }
  return { notice, items };
}
