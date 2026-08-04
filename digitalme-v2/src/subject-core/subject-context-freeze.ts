/**
 * 冻结进 ContextSnapshot.subjectContextRef 的主体切片(非独立 Store)。
 */
import { contentDigest } from '../infrastructure/digest';
import type { SubjectEntryKind } from './derived-views';

export type SelectionReason =
  | 'identity_core'
  | 'goal_core'
  | 'principle_core'
  | 'keyword_match'
  | 'goal_tag'
  | 'boundary_statement'
  | 'manual_none';

export interface FrozenSubjectEntry {
  eventId: string;
  kind: SubjectEntryKind;
  title: string;
  detail: string;
  tags: string[];
  occurredAt: string;
}

export interface SubjectContextFreeze {
  schemaVersion: 1;
  subjectId: string;
  selectedEventIds: string[];
  entries: FrozenSubjectEntry[];
  selectionReasons: Array<{ eventId: string; reason: SelectionReason }>;
  excludedEventIds: string[];
  subjectContextDigest: string;
}

export function computeSubjectContextDigest(input: {
  subjectId: string;
  selectedEventIds: string[];
  entries: FrozenSubjectEntry[];
}): string {
  const canonical = JSON.stringify({
    subjectId: input.subjectId,
    selectedEventIds: [...input.selectedEventIds].sort(),
    entries: input.entries.map((e) => ({
      eventId: e.eventId,
      kind: e.kind,
      title: e.title,
      detail: e.detail,
      tags: [...e.tags].sort(),
      occurredAt: e.occurredAt,
    })),
  });
  return contentDigest(canonical);
}

export function buildSubjectContextFreeze(input: {
  subjectId: string;
  entries: FrozenSubjectEntry[];
  selectionReasons: Array<{ eventId: string; reason: SelectionReason }>;
  excludedEventIds: string[];
}): SubjectContextFreeze {
  const selectedEventIds = input.entries.map((e) => e.eventId);
  const digest = computeSubjectContextDigest({
    subjectId: input.subjectId,
    selectedEventIds,
    entries: input.entries,
  });
  return {
    schemaVersion: 1,
    subjectId: input.subjectId,
    selectedEventIds,
    entries: input.entries,
    selectionReasons: input.selectionReasons,
    excludedEventIds: [...new Set(input.excludedEventIds)],
    subjectContextDigest: digest,
  };
}
