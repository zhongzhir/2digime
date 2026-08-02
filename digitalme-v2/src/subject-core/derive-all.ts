import type { GrowthEvent } from './growth-event';
import {
  deriveConfirmedExperience,
  type ConfirmedExperienceView,
} from './derived-views';

/**
 * 主体派生视图全集 — 一律由 GrowthEvent 重放得到,可落盘缓存但非权威。
 */
export interface CandidateExperienceView {
  subjectId: string;
  derivedAt: string;
  entries: Array<{
    eventId: string;
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

export interface SubjectDerivedBundle {
  confirmed: ConfirmedExperienceView;
  candidates: CandidateExperienceView;
  preferences: PreferencesView;
  goals: GoalsView;
  boundaries: BoundariesView;
  assets: AssetsView;
}

/** 纯函数重放:从事件流重建全部派生视图。 */
export function deriveAllViews(
  subjectId: string,
  events: Iterable<GrowthEvent>,
  derivedAt: string,
): SubjectDerivedBundle {
  const list = [...events].filter((e) => e.subjectId === subjectId);
  const confirmed = deriveConfirmedExperience(subjectId, list, derivedAt);

  const candidates: CandidateExperienceView = {
    subjectId,
    derivedAt,
    entries: [],
  };
  const confirmedIds = new Set(
    list.filter((e) => e.type === 'experience_confirmed' && e.confirms).map((e) => e.confirms as string),
  );

  for (const event of list) {
    if (event.confidence !== 'candidate') continue;
    if (event.type !== 'feedback_recorded') continue;
    if (confirmedIds.has(event.id)) continue; // 已确认的不再出现在待确认列表
    const entry: CandidateExperienceView['entries'][number] = {
      eventId: event.id,
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
    entries: list
      .filter((e) => e.type === 'preference_observed' && e.confidence === 'confirmed')
      .map((e) => ({
        eventId: e.id,
        title: e.payload.title,
        detail: e.payload.detail,
        tags: e.payload.tags ?? [],
      })),
  };

  const goals: GoalsView = {
    subjectId,
    derivedAt,
    entries: list
      .filter((e) => e.type === 'goal_updated' && e.confidence === 'confirmed')
      .map((e) => ({
        eventId: e.id,
        title: e.payload.title,
        detail: e.payload.detail,
        tags: e.payload.tags ?? [],
      })),
  };

  const boundaryEvents = list.filter(
    (e) => e.type === 'boundary_updated' && e.confidence === 'confirmed',
  );
  const excludedTags = new Set<string>();
  const excludedAssetTags = new Set<string>();
  for (const event of boundaryEvents) {
    for (const tag of event.payload.tags ?? []) {
      if (tag.startsWith('exclude:')) excludedTags.add(tag.slice('exclude:'.length));
      else if (tag.startsWith('exclude-asset:')) excludedAssetTags.add(tag.slice('exclude-asset:'.length));
      else excludedTags.add(tag);
    }
    // detail 形如 "exclude-tag:formal" 也识别
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
    entries: list
      .filter((e) => e.type === 'asset_added' && e.confidence === 'confirmed')
      .map((e) => ({
        eventId: e.id,
        title: e.payload.title,
        detail: e.payload.detail,
        tags: e.payload.tags ?? [],
      })),
  };

  return { confirmed, candidates, preferences, goals, boundaries, assets };
}
