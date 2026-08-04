import type { GrowthEvent } from './growth-event';

export type SubjectEntryKind =
  | 'identity'
  | 'goal'
  | 'principle'
  | 'experience'
  | 'boundary'
  | 'preference'
  | 'asset';

/**
 * 已确认经验视图 — 由 GrowthEvent 流派生,是任务上下文注入条目的载体形态。
 * 派生值不落盘为独立事实;损坏可重放重建(domain model §5)。
 */
export interface ConfirmedExperienceView {
  subjectId: string;
  derivedAt: string;
  entries: ConfirmedExperienceEntry[];
}

export interface ConfirmedExperienceEntry {
  eventId: string;
  title: string;
  detail: string;
  tags: string[];
  occurredAt: string;
  /** 注入分类;缺省按经验处理。 */
  kind?: SubjectEntryKind;
}

/** 纯函数派生:仅 experience_confirmed 进入「实践经验」视图。 */
export function deriveConfirmedExperience(
  subjectId: string,
  events: Iterable<GrowthEvent>,
  derivedAt: string,
): ConfirmedExperienceView {
  const entries: ConfirmedExperienceEntry[] = [];
  for (const event of events) {
    if (event.subjectId !== subjectId) continue;
    if (event.confidence !== 'confirmed') continue;
    if (event.type !== 'experience_confirmed') continue;
    entries.push({
      eventId: event.id,
      title: event.payload.title,
      detail: event.payload.detail,
      tags: event.payload.tags ?? [],
      occurredAt: event.occurredAt,
      kind: 'experience',
    });
  }
  return { subjectId, derivedAt, entries };
}
