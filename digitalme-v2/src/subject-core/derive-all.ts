import type { GrowthEvent } from './growth-event';
import { correctionActionOf } from './growth-event';
import {
  deriveConfirmedExperience,
  type ConfirmedExperienceView,
  type SubjectEntryKind,
} from './derived-views';

export const CANDIDATE_QUEUE_TYPES = [
  'identity_clarified',
  'goal_updated',
  'principle_stated',
  'boundary_updated',
  'preference_observed',
  'feedback_recorded',
  'asset_added',
] as const;

export type CandidateQueueType = (typeof CANDIDATE_QUEUE_TYPES)[number];

/**
 * 主体派生视图全集 — 一律由 GrowthEvent 重放得到,可落盘缓存但非权威。
 */
export interface CandidateExperienceView {
  subjectId: string;
  derivedAt: string;
  entries: Array<{
    eventId: string;
    type: CandidateQueueType | string;
    title: string;
    detail: string;
    tags: string[];
    occurredAt: string;
    evidence?: GrowthEvent['payload']['evidence'];
  }>;
}

export interface PreferencesView {
  subjectId: string;
  derivedAt: string;
  entries: Array<{ eventId: string; title: string; detail: string; tags: string[] }>;
}

export interface GoalsView {
  subjectId: string;
  derivedAt: string;
  entries: Array<{ eventId: string; title: string; detail: string; tags: string[] }>;
}

export interface BoundariesView {
  subjectId: string;
  derivedAt: string;
  /** 被排除的经验标签(不注入 CapabilityInput)。 */
  excludedTags: string[];
  /** 被排除的资产角色/标签。 */
  excludedAssetTags: string[];
  entries: Array<{ eventId: string; title: string; detail: string; tags: string[] }>;
}

export interface AssetsView {
  subjectId: string;
  derivedAt: string;
  entries: Array<{ eventId: string; title: string; detail: string; tags: string[] }>;
}

export interface IdentityView {
  subjectId: string;
  derivedAt: string;
  entries: Array<{ eventId: string; title: string; detail: string; tags: string[] }>;
}

export interface PrinciplesView {
  subjectId: string;
  derivedAt: string;
  entries: Array<{ eventId: string; title: string; detail: string; tags: string[] }>;
}

export interface KnowledgeGapsView {
  subjectId: string;
  derivedAt: string;
  entries: Array<{ eventId: string; title: string; detail: string; tags: string[] }>;
}

export type SubjectReadiness = 'empty' | 'needs_confirmation' | 'usable';

export interface SubjectSummaryView {
  subjectId: string;
  derivedAt: string;
  displayLine: string;
  identityCount: number;
  goalCount: number;
  principleCount: number;
  experienceCount: number;
  boundaryCount: number;
  gapCount: number;
  pendingCandidateCount: number;
}

export interface ActiveSubjectItem {
  eventId: string;
  kind: SubjectEntryKind;
  title: string;
  detail: string;
  tags: string[];
  occurredAt: string;
}

export interface SubjectDerivedBundle {
  confirmed: ConfirmedExperienceView;
  candidates: CandidateExperienceView;
  preferences: PreferencesView;
  goals: GoalsView;
  boundaries: BoundariesView;
  assets: AssetsView;
  identity: IdentityView;
  principles: PrinciplesView;
  knowledgeGaps: KnowledgeGapsView;
  summary: SubjectSummaryView;
  readiness: SubjectReadiness;
  activeItems: ActiveSubjectItem[];
  /** 被 reject / replace / supersedes 的旧 confirmed id。 */
  inactiveEventIds: string[];
}

function mapConfirmed(
  list: GrowthEvent[],
  type: GrowthEvent['type'],
): Array<{ eventId: string; title: string; detail: string; tags: string[] }> {
  return list
    .filter((e) => e.type === type && e.confidence === 'confirmed')
    .map((e) => ({
      eventId: e.id,
      title: e.payload.title,
      detail: e.payload.detail,
      tags: e.payload.tags ?? [],
    }));
}

/** 收集被纠正/取代而不得再注入的事件 id。 */
export function collectInactiveEventIds(events: readonly GrowthEvent[]): string[] {
  const inactive = new Set<string>();
  for (const event of events) {
    if (event.confidence !== 'confirmed') continue;
    const supersedes = event.payload.relation?.supersedes;
    if (supersedes) inactive.add(supersedes);
    if (event.type === 'subject_corrected') {
      const target = event.payload.relation?.targetEventId;
      const action = correctionActionOf(event);
      if (target && (action === 'reject' || action === 'replace')) {
        inactive.add(target);
      }
    }
  }
  return [...inactive];
}

function kindForType(type: GrowthEvent['type']): SubjectEntryKind | null {
  switch (type) {
    case 'identity_clarified':
      return 'identity';
    case 'goal_updated':
      return 'goal';
    case 'principle_stated':
      return 'principle';
    case 'experience_confirmed':
      return 'experience';
    case 'boundary_updated':
      return 'boundary';
    case 'preference_observed':
      return 'preference';
    case 'asset_added':
      return 'asset';
    default:
      return null;
  }
}

/** 纯函数重放:从事件流重建全部派生视图。 */
export function deriveAllViews(
  subjectId: string,
  events: Iterable<GrowthEvent>,
  derivedAt: string,
): SubjectDerivedBundle {
  const list = [...events].filter((e) => e.subjectId === subjectId);
  const inactiveEventIds = collectInactiveEventIds(list);
  const inactive = new Set(inactiveEventIds);
  const confirmed = deriveConfirmedExperience(subjectId, list, derivedAt);
  confirmed.entries = confirmed.entries.filter((e) => !inactive.has(e.eventId));

  const confirmedIds = new Set(
    list.filter((e) => e.confirms).map((e) => e.confirms as string),
  );

  const candidates: CandidateExperienceView = {
    subjectId,
    derivedAt,
    entries: [],
  };
  for (const event of list) {
    if (event.confidence !== 'candidate') continue;
    if (!(CANDIDATE_QUEUE_TYPES as readonly string[]).includes(event.type)) continue;
    if (confirmedIds.has(event.id)) continue;
    if (inactive.has(event.id)) continue;
    const entry: CandidateExperienceView['entries'][number] = {
      eventId: event.id,
      type: event.type,
      title: event.payload.title,
      detail: event.payload.detail,
      tags: event.payload.tags ?? [],
      occurredAt: event.occurredAt,
    };
    if (event.payload.evidence) entry.evidence = event.payload.evidence;
    candidates.entries.push(entry);
  }

  const preferences: PreferencesView = {
    subjectId,
    derivedAt,
    entries: mapConfirmed(list, 'preference_observed').filter((e) => !inactive.has(e.eventId)),
  };

  const goals: GoalsView = {
    subjectId,
    derivedAt,
    entries: mapConfirmed(list, 'goal_updated').filter((e) => !inactive.has(e.eventId)),
  };

  const identity: IdentityView = {
    subjectId,
    derivedAt,
    entries: mapConfirmed(list, 'identity_clarified').filter((e) => !inactive.has(e.eventId)),
  };

  const principles: PrinciplesView = {
    subjectId,
    derivedAt,
    entries: mapConfirmed(list, 'principle_stated').filter((e) => !inactive.has(e.eventId)),
  };

  const knowledgeGaps: KnowledgeGapsView = {
    subjectId,
    derivedAt,
    entries: list
      .filter((e) => e.type === 'knowledge_gap_noted' && !inactive.has(e.id))
      .map((e) => ({
        eventId: e.id,
        title: e.payload.title,
        detail: e.payload.detail,
        tags: e.payload.tags ?? [],
      })),
  };

  const boundaryEvents = list.filter(
    (e) =>
      e.type === 'boundary_updated' && e.confidence === 'confirmed' && !inactive.has(e.id),
  );
  const excludedTags = new Set<string>();
  const excludedAssetTags = new Set<string>();
  for (const event of boundaryEvents) {
    for (const tag of event.payload.tags ?? []) {
      if (tag.startsWith('exclude:')) excludedTags.add(tag.slice('exclude:'.length));
      else if (tag.startsWith('exclude-asset:')) {
        excludedAssetTags.add(tag.slice('exclude-asset:'.length));
      } else if (!tag.startsWith('action:')) {
        excludedTags.add(tag);
      }
    }
    const match = /^exclude-tag:(\S+)/.exec(event.payload.detail.trim());
    if (match?.[1]) excludedTags.add(match[1]);
  }

  const boundaries: BoundariesView = {
    subjectId,
    derivedAt,
    excludedTags: [...excludedTags],
    excludedAssetTags: [...excludedAssetTags],
    entries: boundaryEvents.map((e) => ({
      eventId: e.id,
      title: e.payload.title,
      detail: e.payload.detail,
      tags: e.payload.tags ?? [],
    })),
  };

  const assets: AssetsView = {
    subjectId,
    derivedAt,
    entries: mapConfirmed(list, 'asset_added').filter((e) => !inactive.has(e.eventId)),
  };

  const activeItems: ActiveSubjectItem[] = [];
  for (const event of list) {
    if (event.confidence !== 'confirmed') continue;
    if (inactive.has(event.id)) continue;
    const kind = kindForType(event.type);
    if (!kind) continue;
    if (event.type === 'knowledge_gap_noted' || event.type === 'subject_corrected') continue;
    activeItems.push({
      eventId: event.id,
      kind,
      title: event.payload.title,
      detail: event.payload.detail,
      tags: event.payload.tags ?? [],
      occurredAt: event.occurredAt,
    });
  }

  const hasCore =
    identity.entries.length > 0 ||
    goals.entries.length > 0 ||
    principles.entries.length > 0 ||
    boundaries.entries.length > 0;
  let readiness: SubjectReadiness = 'empty';
  if (candidates.entries.length > 0 && !hasCore && confirmed.entries.length === 0) {
    readiness = 'needs_confirmation';
  } else if (hasCore || confirmed.entries.length > 0) {
    readiness = 'usable';
  } else if (candidates.entries.length > 0) {
    readiness = 'needs_confirmation';
  }

  const summaryParts: string[] = [];
  if (identity.entries[0]) summaryParts.push(identity.entries[0].title);
  if (goals.entries[0]) summaryParts.push(goals.entries[0].title);
  if (principles.entries[0]) summaryParts.push(principles.entries[0].title);

  const summary: SubjectSummaryView = {
    subjectId,
    derivedAt,
    displayLine: summaryParts.join(' · ') || '尚无已确认主体要点',
    identityCount: identity.entries.length,
    goalCount: goals.entries.length,
    principleCount: principles.entries.length,
    experienceCount: confirmed.entries.length,
    boundaryCount: boundaries.entries.length,
    gapCount: knowledgeGaps.entries.length,
    pendingCandidateCount: candidates.entries.length,
  };

  return {
    confirmed,
    candidates,
    preferences,
    goals,
    boundaries,
    assets,
    identity,
    principles,
    knowledgeGaps,
    summary,
    readiness,
    activeItems,
    inactiveEventIds,
  };
}
