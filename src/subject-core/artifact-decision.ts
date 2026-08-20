/**
 * Artifact 采用/不采用 — 由 GrowthEvent 派生的用户面决策状态。
 * 不引入 Acceptance Store；UI 不得自建长期布尔权威。
 */
import type { GrowthEvent } from './growth-event';

export type ArtifactOwnerDecisionStatus = 'undecided' | 'accepted' | 'rejected';

export const DECISION_ACCEPT_TAG = 'decision:accept';
export const DECISION_REJECT_TAG = 'decision:reject';

export interface ArtifactOwnerDecision {
  status: ArtifactOwnerDecisionStatus;
  artifactVersionId: string;
  decidedAt?: string;
  eventId?: string;
}

function decisionFromTags(tags: readonly string[] | undefined): ArtifactOwnerDecisionStatus | null {
  const list = tags ?? [];
  if (list.includes(DECISION_ACCEPT_TAG)) return 'accepted';
  if (list.includes(DECISION_REJECT_TAG)) return 'rejected';
  return null;
}

function versionOf(event: GrowthEvent): string | undefined {
  return event.payload.evidence?.toVersionId;
}

function artifactOf(event: GrowthEvent): string | undefined {
  return event.payload.evidence?.artifactId ?? event.source.artifactId;
}

/**
 * 对指定 Artifact 当前版本，从事件流派生采用状态。
 * 同版本多次决策取最新 occurredAt；无匹配则为未决定。
 */
export function deriveArtifactOwnerDecision(
  events: readonly GrowthEvent[],
  artifactId: string,
  artifactVersionId: string,
): ArtifactOwnerDecision {
  const base: ArtifactOwnerDecision = {
    status: 'undecided',
    artifactVersionId,
  };
  const matches = events
    .filter((e) => {
      if (artifactOf(e) !== artifactId) return false;
      if (versionOf(e) !== artifactVersionId) return false;
      return decisionFromTags(e.payload.tags) !== null;
    })
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  const latest = matches[matches.length - 1];
  if (!latest) return base;
  const status = decisionFromTags(latest.payload.tags);
  if (!status || status === 'undecided') return base;
  return {
    status,
    artifactVersionId,
    decidedAt: latest.occurredAt,
    eventId: latest.id,
  };
}

/** 是否已对同一版本写入相同决策（用于幂等）。 */
export function hasSameVersionDecision(
  events: readonly GrowthEvent[],
  artifactId: string,
  artifactVersionId: string,
  status: 'accepted' | 'rejected',
): boolean {
  const current = deriveArtifactOwnerDecision(events, artifactId, artifactVersionId);
  return current.status === status;
}
