import type { ConfirmedExperienceView, SubjectEntryKind } from './derived-views';
import type { SubjectDerivedBundle } from './derive-all';
import {
  buildSubjectContextFreeze,
  type SelectionReason,
  type SubjectContextFreeze,
  type FrozenSubjectEntry,
} from './subject-context-freeze';

export interface ExperienceSelectInput {
  goal: string;
  requestedArtifactType: string;
  confirmed: ConfirmedExperienceView;
  boundaries: SubjectDerivedBundle['boundaries'];
}

export interface ExperienceSelectOptions {
  maxEntries?: number;
  maxDetailChars?: number;
}

export interface SubjectInjectionSelectInput {
  goal: string;
  requestedArtifactType: string;
  derived: SubjectDerivedBundle;
}

export interface SubjectInjectionSelection {
  subjectContext: ConfirmedExperienceView;
  freeze: SubjectContextFreeze;
}

const DEFAULT_MAX_ENTRIES = 5;
const DEFAULT_MAX_DETAIL_CHARS = 200;
const MAX_CORE_PER_KIND = 3;

/**
 * ConfirmedExperienceSelector — 确定性关键词/标签匹配(实践经验)。
 * - candidate 永不进入;
 * - 边界 excludedTags 过滤;
 * - 数量与长度上限;
 * - 每条保留 eventId 可追溯。
 */
export function selectConfirmedExperiences(
  input: ExperienceSelectInput,
  options: ExperienceSelectOptions = {},
): ConfirmedExperienceView {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxDetailChars = options.maxDetailChars ?? DEFAULT_MAX_DETAIL_CHARS;
  const excluded = new Set(input.boundaries.excludedTags.map((t) => t.toLowerCase()));
  const tokens = tokenize(input.goal);

  const scored = input.confirmed.entries
    .filter((entry) => {
      const tags = entry.tags.map((t) => t.toLowerCase());
      if (tags.some((t) => excluded.has(t))) return false;
      // 不采用只作负面记录，不作为正向「沿用经验」注入。
      if (tags.includes('decision:reject')) return false;
      return true;
    })
    .map((entry) => {
      const hay = tokenize(`${entry.title} ${entry.detail} ${entry.tags.join(' ')}`);
      let score = 0;
      for (const token of tokens) {
        if (token.length >= 2 && hay.has(token)) score += 1;
      }
      if (
        score > 0 &&
        entry.tags.map((t) => t.toLowerCase()).includes(input.requestedArtifactType.toLowerCase())
      ) {
        score += 2;
      }
      return { entry, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.occurredAt.localeCompare(a.entry.occurredAt));

  const entries = scored.slice(0, maxEntries).map(({ entry }) => ({
    eventId: entry.eventId,
    title: entry.title,
    detail: truncate(entry.detail, maxDetailChars),
    tags: [...entry.tags],
    occurredAt: entry.occurredAt,
    kind: 'experience' as SubjectEntryKind,
  }));

  return {
    subjectId: input.confirmed.subjectId,
    derivedAt: input.confirmed.derivedAt,
    entries,
  };
}

/**
 * 主体注入选择:身份/方向/原则 + 匹配经验 + 相关时的边界短声明。
 * knowledge_gap / candidate / inactive 永不注入。
 */
export function selectSubjectInjection(
  input: SubjectInjectionSelectInput,
  options: ExperienceSelectOptions = {},
): SubjectInjectionSelection {
  const maxDetailChars = options.maxDetailChars ?? DEFAULT_MAX_DETAIL_CHARS;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const derived = input.derived;
  const inactive = new Set(derived.inactiveEventIds);
  const tokens = tokenize(input.goal);
  const excluded = new Set(derived.boundaries.excludedTags.map((t) => t.toLowerCase()));

  const frozenEntries: FrozenSubjectEntry[] = [];
  const reasons: Array<{ eventId: string; reason: SelectionReason }> = [];
  const excludedEventIds: string[] = [...inactive];

  const push = (
    item: { eventId: string; title: string; detail: string; tags: string[]; occurredAt?: string },
    kind: SubjectEntryKind,
    reason: SelectionReason,
  ) => {
    if (inactive.has(item.eventId)) {
      excludedEventIds.push(item.eventId);
      return;
    }
    if (frozenEntries.some((e) => e.eventId === item.eventId)) return;
    frozenEntries.push({
      eventId: item.eventId,
      kind,
      title: item.title,
      detail: truncate(item.detail, maxDetailChars),
      tags: [...item.tags],
      occurredAt: item.occurredAt ?? derived.summary.derivedAt,
    });
    reasons.push({ eventId: item.eventId, reason });
  };

  // 身份:始终可注入(必要 core)
  for (const item of derived.identity.entries.slice(0, MAX_CORE_PER_KIND)) {
    const full = derived.activeItems.find((a) => a.eventId === item.eventId);
    const payload: {
      eventId: string;
      title: string;
      detail: string;
      tags: string[];
      occurredAt?: string;
    } = {
      eventId: item.eventId,
      title: item.title,
      detail: item.detail,
      tags: item.tags,
    };
    if (full?.occurredAt) payload.occurredAt = full.occurredAt;
    push(payload, 'identity', 'identity_core');
  }

  const pickMatching = (
    items: Array<{ eventId: string; title: string; detail: string; tags: string[] }>,
    kind: SubjectEntryKind,
    reason: SelectionReason,
  ): number => {
    let added = 0;
    for (const item of items) {
      if (added >= MAX_CORE_PER_KIND) break;
      const score = scoreText(tokens, `${item.title} ${item.detail} ${item.tags.join(' ')}`);
      if (score <= 0) {
        excludedEventIds.push(item.eventId);
        continue;
      }
      const full = derived.activeItems.find((a) => a.eventId === item.eventId);
      const payload: {
        eventId: string;
        title: string;
        detail: string;
        tags: string[];
        occurredAt?: string;
      } = {
        eventId: item.eventId,
        title: item.title,
        detail: item.detail,
        tags: item.tags,
      };
      if (full?.occurredAt) payload.occurredAt = full.occurredAt;
      push(payload, kind, reason);
      added += 1;
    }
    return added;
  };

  const matchedGoals = pickMatching(derived.goals.entries, 'goal', 'goal_core');
  const matchedPrinciples = pickMatching(
    derived.principles.entries,
    'principle',
    'principle_core',
  );

  const experienceView = selectConfirmedExperiences(
    {
      goal: input.goal,
      requestedArtifactType: input.requestedArtifactType,
      confirmed: derived.confirmed,
      boundaries: derived.boundaries,
    },
    { maxEntries, maxDetailChars },
  );
  const selectedExperienceIds = new Set(experienceView.entries.map((e) => e.eventId));
  for (const entry of derived.confirmed.entries) {
    if (!selectedExperienceIds.has(entry.eventId)) excludedEventIds.push(entry.eventId);
  }
  for (const entry of experienceView.entries) {
    const reason: SelectionReason = entry.tags
      .map((t) => t.toLowerCase())
      .includes(input.requestedArtifactType.toLowerCase())
      ? 'goal_tag'
      : 'keyword_match';
    push(entry, 'experience', reason);
  }

  const related =
    matchedGoals > 0 ||
    matchedPrinciples > 0 ||
    experienceView.entries.length > 0;

  if (related) {
    for (const item of derived.boundaries.entries.slice(0, MAX_CORE_PER_KIND)) {
      const full = derived.activeItems.find((a) => a.eventId === item.eventId);
      const payload: {
        eventId: string;
        title: string;
        detail: string;
        tags: string[];
        occurredAt?: string;
      } = {
        eventId: item.eventId,
        title: item.title,
        detail: item.detail,
        tags: item.tags,
      };
      if (full?.occurredAt) payload.occurredAt = full.occurredAt;
      push(payload, 'boundary', 'boundary_statement');
    }
  } else {
    for (const item of derived.boundaries.entries) {
      excludedEventIds.push(item.eventId);
    }
    for (const item of derived.goals.entries) {
      if (!frozenEntries.some((e) => e.eventId === item.eventId)) {
        excludedEventIds.push(item.eventId);
      }
    }
    for (const item of derived.principles.entries) {
      if (!frozenEntries.some((e) => e.eventId === item.eventId)) {
        excludedEventIds.push(item.eventId);
      }
    }
  }

  // knowledge gaps never inject
  for (const gap of derived.knowledgeGaps.entries) {
    excludedEventIds.push(gap.eventId);
  }

  const freeze = buildSubjectContextFreeze({
    subjectId: derived.summary.subjectId,
    entries: frozenEntries,
    selectionReasons: reasons.length
      ? reasons
      : frozenEntries.length === 0
        ? []
        : [{ eventId: frozenEntries[0]!.eventId, reason: 'manual_none' }],
    excludedEventIds,
  });

  const subjectContext: ConfirmedExperienceView = {
    subjectId: derived.summary.subjectId,
    derivedAt: derived.summary.derivedAt,
    entries: frozenEntries.map((e) => ({
      eventId: e.eventId,
      title: e.title,
      detail: e.detail,
      tags: e.tags,
      occurredAt: e.occurredAt,
      kind: e.kind,
    })),
  };

  return { subjectContext, freeze };
}

function scoreText(tokens: Set<string>, text: string): number {
  const hay = tokenize(text);
  let score = 0;
  for (const token of tokens) {
    if (token.length >= 2 && hay.has(token)) score += 1;
  }
  return score;
}

function truncate(detail: string, maxDetailChars: number): string {
  return detail.length <= maxDetailChars
    ? detail
    : `${detail.slice(0, maxDetailChars - 1)}…`;
}

function tokenize(text: string): Set<string> {
  const result = new Set<string>();
  const lower = text.toLowerCase();
  for (const part of lower.split(/[^\p{L}\p{N}]+/u)) {
    if (part.length === 0) continue;
    if (part.length >= 2 && !/[\u4e00-\u9fff]/.test(part)) result.add(part);
    if (/[\u4e00-\u9fff]/.test(part)) {
      for (let i = 0; i < part.length - 1; i += 1) {
        result.add(part.slice(i, i + 2));
      }
      if (part.length >= 2) result.add(part);
    } else if (part.length >= 2) {
      result.add(part);
    }
  }
  return result;
}
