import type { GrowthEvent } from './growth-event';

/**
 * 已确认经验视图 — 由 GrowthEvent 流派生,是任务上下文注入的唯一主体经验来源。
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
}

/** 纯函数派生:仅 experience_confirmed 进入任务可注入的经验视图。 */
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
    });
  }
  return { subjectId, derivedAt, entries };
}
