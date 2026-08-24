import type { ConfirmedExperienceView, SubjectEntryKind } from './derived-views';
import type { SubjectDerivedBundle } from './derive-all';
import {
  buildSubjectContextFreeze,
  type SelectionReason,
  type SubjectContextFreeze,
  type FrozenSubjectEntry,
} from './subject-context-freeze';
import {
  projectScopeAllows,
  scorePreferenceForTask,
} from './small-loop';

export interface ExperienceSelectInput {
  goal: string;
  requestedArtifactType: string;
  /** 可选弱加权；不得取代目标语义匹配。 */
  intentKind?: string;
  confirmed: ConfirmedExperienceView;
  boundaries: SubjectDerivedBundle['boundaries'];
  /** 项目/材料短提示，用于 project: 范围门禁 */
  scopeHints?: readonly string[];
}

export interface ExperienceSelectOptions {
  maxEntries?: number;
  maxDetailChars?: number;
  /**
   * ai_first（默认）：最多 3 条高相关经验；弱相关不注入。
   * legacy：保留弱相关 scrub 行为（验收对照）。
   */
  policy?: 'ai_first' | 'legacy';
}

export interface SubjectInjectionSelectInput {
  goal: string;
  requestedArtifactType: string;
  /** 可选弱加权；不得取代目标语义匹配。 */
  intentKind?: string;
  derived: SubjectDerivedBundle;
  /** 默认 ai_first */
  policy?: 'ai_first' | 'legacy';
  /** careful/high_risk 才注入匹配的身份/方向/原则 */
  includeCoreMatching?: boolean;
  /** JIT 未决或决议排除的事件（冲突保守默认） */
  excludeEventIds?: readonly string[];
  /** JIT「本次使用 B」等：强制纳入候选条目（仅本 Snapshot） */
  forceIncludeEventIds?: readonly string[];
  /** 项目/材料短提示，用于 project: 范围门禁（非全文） */
  scopeHints?: readonly string[];
  /**
   * SUBJECT-GROUNDED-WORK-01：语义相关分（可选）。由 2digime 自身模型对
   * 「已过滤的小候选池」打分（不暴露全部主体资料给外部 Agent）。
   * 仅用于提升确定性关键词/域匹配的召回；不降低既有排除门。
   */
  semanticScores?: Readonly<Record<string, number>>;
}

export interface SubjectInjectionSelection {
  subjectContext: ConfirmedExperienceView;
  freeze: SubjectContextFreeze;
}

const DEFAULT_MAX_ENTRIES = 5;
const AI_FIRST_MAX_ENTRIES = 3;
const DEFAULT_MAX_DETAIL_CHARS = 200;
const MAX_CORE_PER_KIND = 3;
/** SUBJECT-GROUNDED-WORK-01：standard 档位仍注入「与目标相关」的核/方向/原则，但数量更窄。 */
const RELEVANT_CORE_PER_KIND = 2;
const WEAK_STRUCTURE_DETAIL =
  '仅沿用通用结构或表达偏好，不注入该成果中的具体事实。';

/**
 * ConfirmedExperienceSelector — 确定性关键词/标签匹配(实践经验)。
 * - candidate 永不进入;
 * - 边界 excludedTags 过滤;
 * - 数量与长度上限;
 * - 每条保留 eventId 可追溯。
 * - 采用决策：同 Artifact 仅最新正向采用可注入；拒绝与旧版本不正向复用。
 * - ai_first：高相关最多 3 条；弱相关仅注入通用结构/风格；legacy：弱相关 scrub。
 */
export function selectConfirmedExperiences(
  input: ExperienceSelectInput,
  options: ExperienceSelectOptions = {},
): ConfirmedExperienceView {
  const policy = options.policy ?? 'ai_first';
  const maxEntries =
    options.maxEntries ?? (policy === 'ai_first' ? AI_FIRST_MAX_ENTRIES : DEFAULT_MAX_ENTRIES);
  const maxDetailChars = options.maxDetailChars ?? DEFAULT_MAX_DETAIL_CHARS;
  const excluded = new Set(input.boundaries.excludedTags.map((t) => t.toLowerCase()));
  const tokens = tokenize(input.goal);
  const artifactType = input.requestedArtifactType.toLowerCase();

  const scopeHints = input.scopeHints || [];
  const eligible = resolvePositiveExperiences(input.confirmed.entries).filter((entry) => {
    const tags = entry.tags.map((t) => t.toLowerCase());
    if (tags.includes('capture:noop')) return false;
    if (tags.some((t) => excluded.has(t))) return false;
    if (tags.includes('decision:reject')) return false;
    if (
      !projectScopeAllows({
        entryTags: entry.tags,
        goal: input.goal,
        scopeHints,
      })
    ) {
      return false;
    }
    // 过期临时内容不注入
    if (tags.some((t) => t.startsWith('expiresat:'))) {
      const iso = tags.find((t) => t.startsWith('expiresat:'))!.slice('expiresat:'.length);
      const ts = Date.parse(iso);
      if (!Number.isNaN(ts) && ts <= Date.now()) return false;
    }
    return true;
  });

  const scored = eligible
    .map((entry) => {
      const hay = tokenize(`${entry.title} ${entry.detail} ${entry.tags.join(' ')}`);
      let keywordScore = 0;
      for (const token of tokens) {
        if (token.length >= 2 && hay.has(token)) keywordScore += 1;
      }
      const tagsLower = entry.tags.map((t) => t.toLowerCase());
      const typeBoost = keywordScore > 0 && tagsLower.includes(artifactType);
      // intentKind 仅弱加权，且必须已有目标词命中，不得单独切换经验
      const intentBoost =
        keywordScore > 0 &&
        input.intentKind === 'analyze_code' &&
        (tagsLower.includes('code-analysis') ||
          tagsLower.includes('method') ||
          tagsLower.includes('偏好') ||
          /判断|关注点|工作方法|审查/.test(`${entry.title} ${entry.detail}`));
      const score = keywordScore + (typeBoost ? 2 : 0) + (intentBoost ? 1 : 0);
      const weak = keywordScore === 1;
      return { entry, score, keywordScore, weak };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.occurredAt.localeCompare(a.entry.occurredAt));

  const strong = scored.filter((row) => !row.weak && row.keywordScore >= 2);
  const weakRows = scored.filter((row) => row.weak);
  const picked =
    policy === 'ai_first'
      ? [
          ...strong.slice(0, maxEntries),
          // 弱相关：仅结构/风格，额外最多 1 条且不挤占高相关名额之外的正文事实
          ...weakRows.slice(0, Math.max(0, 1)),
        ].slice(0, maxEntries + 1)
      : scored.slice(0, maxEntries);

  const entries = picked.map(({ entry, weak }) => {
    const scrub = weak; // ai_first 与 legacy：弱相关均 scrub 事实
    return {
      eventId: entry.eventId,
      title: entry.title,
      detail: truncate(scrub ? WEAK_STRUCTURE_DETAIL : entry.detail, maxDetailChars),
      tags: scrub
        ? [...entry.tags.filter((t) => !/^decision:|^version:/.test(t)), 'reuse:weak_structure']
        : [...entry.tags],
      occurredAt: entry.occurredAt,
      kind: 'experience' as SubjectEntryKind,
    };
  });

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
  const policy = input.policy ?? options.policy ?? 'ai_first';
  const maxDetailChars = options.maxDetailChars ?? DEFAULT_MAX_DETAIL_CHARS;
  const maxEntries =
    options.maxEntries ?? (policy === 'ai_first' ? AI_FIRST_MAX_ENTRIES : DEFAULT_MAX_ENTRIES);
  const derived = input.derived;
  const inactive = new Set(derived.inactiveEventIds);
  const jitExclude = new Set(input.excludeEventIds || []);
  const forceInclude = new Set(input.forceIncludeEventIds || []);
  const tokens = tokenize(input.goal);
  const includeCore = input.includeCoreMatching === true || policy === 'legacy';

  const frozenEntries: FrozenSubjectEntry[] = [];
  const reasons: Array<{ eventId: string; reason: SelectionReason }> = [];
  const excludedEventIds: string[] = [...inactive, ...jitExclude];

  const push = (
    item: { eventId: string; title: string; detail: string; tags: string[]; occurredAt?: string },
    kind: SubjectEntryKind,
    reason: SelectionReason,
  ) => {
    if (inactive.has(item.eventId) || (jitExclude.has(item.eventId) && !forceInclude.has(item.eventId))) {
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

  // SUBJECT-GROUNDED-WORK-01：
  // standard（includeCore=false）不再整类排除身份/方向/原则，而是注入「与当前目标相关」者（数量更窄）；
  // legacy/careful/high_risk（includeCore=true）保持原样（按序注入全部核心，最多 MAX_CORE_PER_KIND）。
  const coreCap = includeCore ? MAX_CORE_PER_KIND : RELEVANT_CORE_PER_KIND;
  let identityAdded = 0;
  for (const item of derived.identity.entries) {
    if (identityAdded >= coreCap) {
      excludedEventIds.push(item.eventId);
      continue;
    }
    // standard：只注入与目标相关的身份（避免「可能有用」膨胀上下文）；careful/high_risk 保持原样全量。
    if (!includeCore) {
      const keyword = scoreText(tokens, `${item.title} ${item.detail} ${item.tags.join(' ')}`);
      const semantic = input.semanticScores?.[item.eventId] ?? 0;
      const score = Math.max(keyword, semantic);
      if (score <= 0) {
        excludedEventIds.push(item.eventId);
        continue;
      }
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
    push(payload, 'identity', 'identity_core');
    identityAdded += 1;
  }

  const pickMatching = (
    items: Array<{ eventId: string; title: string; detail: string; tags: string[] }>,
    kind: SubjectEntryKind,
    reason: SelectionReason,
  ): number => {
    let added = 0;
    for (const item of items) {
      if (added >= coreCap) {
        excludedEventIds.push(item.eventId);
        continue;
      }
      const keyword = scoreText(tokens, `${item.title} ${item.detail} ${item.tags.join(' ')}`);
      const semantic = input.semanticScores?.[item.eventId] ?? 0;
      const score = Math.max(keyword, semantic);
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
      ...(input.intentKind ? { intentKind: input.intentKind } : {}),
      confirmed: derived.confirmed,
      boundaries: derived.boundaries,
      ...(input.scopeHints ? { scopeHints: input.scopeHints } : {}),
    },
    { maxEntries, maxDetailChars, policy },
  );
  const selectedExperienceIds = new Set(experienceView.entries.map((e) => e.eventId));
  for (const entry of derived.confirmed.entries) {
    if (!selectedExperienceIds.has(entry.eventId)) excludedEventIds.push(entry.eventId);
  }
  for (const entry of experienceView.entries) {
    const tags = entry.tags.map((t) => t.toLowerCase());
    let reason: SelectionReason = 'keyword_match';
    if (tags.includes('reuse:weak_structure')) reason = 'weak_structure_only';
    else if (tags.includes(input.requestedArtifactType.toLowerCase())) reason = 'goal_tag';
    push(entry, 'experience', reason);
  }

  // 已确认偏好：relevance + 域亲和 + 项目范围；数量受控；不全量灌入
  const prefSlots = Math.max(
    0,
    AI_FIRST_MAX_ENTRIES -
      experienceView.entries.filter((e) => !e.tags.includes('reuse:weak_structure')).length,
  );
  let prefAdded = 0;
  const prefScored = derived.preferences.entries
    .map((item) => {
      if (
        !projectScopeAllows({
          entryTags: item.tags,
          goal: input.goal,
          ...(input.scopeHints ? { scopeHints: input.scopeHints } : {}),
        })
      ) {
        return { item, score: -1, minScore: 99 };
      }
      const matched = scorePreferenceForTask({
        goal: input.goal,
        requestedArtifactType: input.requestedArtifactType,
        title: item.title,
        detail: item.detail,
        tags: item.tags,
        tokenize,
        scoreText,
      });
      const semantic = input.semanticScores?.[item.eventId] ?? 0;
      const score = Math.max(matched.score, semantic);
      const minScore = policy === 'ai_first' ? Math.min(matched.minScore, semantic > 0 ? 1 : matched.minScore) : 1;
      return { item, score, minScore };
    })
    .filter((row) => row.score >= row.minScore)
    .sort((a, b) => b.score - a.score);

  for (const row of prefScored) {
    if (prefAdded >= Math.max(prefSlots, 1)) {
      excludedEventIds.push(row.item.eventId);
      continue;
    }
    const full = derived.activeItems.find((a) => a.eventId === row.item.eventId);
    const payload: {
      eventId: string;
      title: string;
      detail: string;
      tags: string[];
      occurredAt?: string;
    } = {
      eventId: row.item.eventId,
      title: row.item.title,
      detail: row.item.detail,
      tags: row.item.tags,
    };
    if (full?.occurredAt) payload.occurredAt = full.occurredAt;
    push(payload, 'preference', 'keyword_match');
    prefAdded += 1;
  }
  for (const item of derived.preferences.entries) {
    if (!prefScored.some((r) => r.item.eventId === item.eventId) && !frozenEntries.some((e) => e.eventId === item.eventId)) {
      excludedEventIds.push(item.eventId);
    }
  }

  // JIT 本次强制纳入（可为仍待确认的候选）
  for (const eventId of forceInclude) {
    if (frozenEntries.some((e) => e.eventId === eventId)) continue;
    const active = derived.activeItems.find((a) => a.eventId === eventId);
    if (active) {
      push(
        {
          eventId: active.eventId,
          title: active.title,
          detail: active.detail,
          tags: [...active.tags, 'jit:once'],
          occurredAt: active.occurredAt,
        },
        active.kind === 'preference' || active.kind === 'principle' || active.kind === 'goal'
          ? active.kind
          : 'preference',
        'keyword_match',
      );
      continue;
    }
    const cand = derived.candidates.entries.find((c) => c.eventId === eventId);
    if (cand) {
      push(
        {
          eventId: cand.eventId,
          title: cand.title,
          detail: cand.detail,
          tags: [...cand.tags, 'jit:once'],
          occurredAt: cand.occurredAt,
        },
        'preference',
        'keyword_match',
      );
    }
  }

  // 硬边界：始终可注入（明确硬约束），与是否有相关经验无关
  const hardBoundaries = derived.boundaries.entries.filter((item) =>
    item.tags.some((t) => /^exclude:/i.test(t) || t === '边界'),
  );
  const softBoundaries = derived.boundaries.entries.filter(
    (item) => !hardBoundaries.some((h) => h.eventId === item.eventId),
  );
  for (const item of hardBoundaries.slice(0, MAX_CORE_PER_KIND)) {
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

  const related =
    matchedGoals > 0 ||
    matchedPrinciples > 0 ||
    experienceView.entries.length > 0 ||
    hardBoundaries.length > 0;

  if (related && includeCore) {
    for (const item of softBoundaries.slice(0, MAX_CORE_PER_KIND)) {
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
    for (const item of softBoundaries) excludedEventIds.push(item.eventId);
  }

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

/**
 * 同 Artifact 的采用/拒绝决策：仅最新决策可参与正向注入；
 * 最新为拒绝 → 该 Artifact 全部决策排除；最新为采用 → 仅该版本采用进入候选。
 * 无决策标签的经验保持原样。
 */
export function resolvePositiveExperiences<
  T extends { eventId: string; tags: string[]; occurredAt: string; detail: string; title: string },
>(entries: readonly T[]): T[] {
  const decisionEntries: T[] = [];
  const others: T[] = [];
  for (const entry of entries) {
    const tags = entry.tags.map((t) => t.toLowerCase());
    if (tags.includes('decision:accept') || tags.includes('decision:reject')) {
      decisionEntries.push(entry);
    } else {
      others.push(entry);
    }
  }

  const byArtifact = new Map<string, T[]>();
  for (const entry of decisionEntries) {
    const key =
      tagValue(entry.tags, 'artifact:') ||
      `anon:${entry.eventId}`;
    const list = byArtifact.get(key) || [];
    list.push(entry);
    byArtifact.set(key, list);
  }

  const kept: T[] = [];
  for (const group of byArtifact.values()) {
    const latest = [...group].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0];
    if (!latest) continue;
    const tags = latest.tags.map((t) => t.toLowerCase());
    if (tags.includes('decision:reject')) continue;
    if (tags.includes('decision:accept')) kept.push(latest);
  }

  return [...others, ...kept];
}

function tagValue(tags: readonly string[], prefix: string): string | null {
  const hit = tags.find((t) => t.toLowerCase().startsWith(prefix.toLowerCase()));
  return hit ? hit.slice(prefix.length) : null;
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
