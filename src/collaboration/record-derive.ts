/**
 * CollaborationRecord 派生：status / 最终条款 / 约定均由事件计算，不另建状态机。
 */
import { createHash } from 'node:crypto';
import type {
  CollaborationEvent,
  CollaborationProposalTerms,
  CollaborationRecord,
  CollabUserStatus,
} from './schema';

export function canonicalizeTerms(terms: CollaborationProposalTerms): string {
  const normalized = {
    intent: terms.intent.trim(),
    expectedOutcome: terms.expectedOutcome.trim(),
    offeredMaterials: [...terms.offeredMaterials]
      .map((m) => ({
        path: m.path,
        ...(m.summary ? { summary: m.summary } : {}),
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    ...(terms.deadline ? { deadline: terms.deadline } : {}),
    ...(terms.costTerms ? { costTerms: terms.costTerms } : {}),
    acceptanceCriteria: [...terms.acceptanceCriteria].map((c) => c.trim()).filter(Boolean).sort(),
  };
  return JSON.stringify(normalized);
}

export function termsDigestOf(terms: CollaborationProposalTerms): string {
  return createHash('sha256').update(canonicalizeTerms(terms)).digest('hex').slice(0, 32);
}

export function latestTerms(record: CollaborationRecord): CollaborationProposalTerms {
  let terms = record.proposal;
  for (const ev of record.events) {
    if (
      (ev.kind === 'proposed' ||
        ev.kind === 'counter_proposed' ||
        ev.kind === 'clarified' ||
        ev.kind === 'agreement_formed') &&
      ev.terms
    ) {
      terms = ev.terms;
    }
  }
  return terms;
}

export function findAgreement(record: CollaborationRecord): CollaborationEvent | undefined {
  for (let i = record.events.length - 1; i >= 0; i -= 1) {
    const ev = record.events[i];
    if (ev?.kind === 'agreement_formed' && ev.termsDigest) return ev;
  }
  return undefined;
}

/**
 * 成约条件：双方对同一 termsDigest 表示接受。
 * - initiator 的 proposed 视为接受其初始条款；
 * - counter 后需 initiator 的 accepted 绑定新 digest；
 * - responder 必须有 accepted（或对初始条款的 accepted）。
 */
export function tryFormAgreementDigest(record: CollaborationRecord): string | null {
  const initiatorId = record.initiator.subjectId;
  const responderId = record.responder.subjectId;
  const acceptedBy = new Map<string, Set<string>>();

  for (const ev of record.events) {
    if (ev.kind === 'proposed' && ev.authorSubjectId === initiatorId && ev.termsDigest) {
      const set = acceptedBy.get(initiatorId) ?? new Set();
      set.add(ev.termsDigest);
      acceptedBy.set(initiatorId, set);
    }
    if (ev.kind === 'accepted' && ev.termsDigest) {
      const set = acceptedBy.get(ev.authorSubjectId) ?? new Set();
      set.add(ev.termsDigest);
      acceptedBy.set(ev.authorSubjectId, set);
    }
    if (ev.kind === 'rejected' || ev.kind === 'withdrawn' || ev.kind === 'revoked') {
      // 终态阻断后续成约（若尚未成约）
    }
  }

  if (findAgreement(record)) return null;
  if (record.events.some((e) => e.kind === 'rejected' || e.kind === 'withdrawn')) return null;

  const initAccepts = acceptedBy.get(initiatorId) ?? new Set();
  const respAccepts = acceptedBy.get(responderId) ?? new Set();
  for (const digest of initAccepts) {
    if (respAccepts.has(digest)) return digest;
  }
  return null;
}

export function latestGrantId(record: CollaborationRecord): string | undefined {
  for (let i = record.events.length - 1; i >= 0; i -= 1) {
    const ev = record.events[i];
    if (ev?.kind === 'grant_issued' && ev.grantId) return ev.grantId;
  }
  return undefined;
}

export function latestDelivery(record: CollaborationRecord): CollaborationEvent | undefined {
  for (let i = record.events.length - 1; i >= 0; i -= 1) {
    const ev = record.events[i];
    if (ev?.kind === 'delivered' && ev.delivery) return ev;
  }
  return undefined;
}

/** 最近一次履行失败事实（无成功 delivery，且之后未再启动新的履行）。 */
export function latestFulfillmentFailure(record: CollaborationRecord): CollaborationEvent | undefined {
  if (latestDelivery(record)) return undefined;
  for (let i = record.events.length - 1; i >= 0; i -= 1) {
    const ev = record.events[i];
    if (!ev) continue;
    if (ev.kind === 'fulfillment_started' && !isFailureNote(ev.note)) {
      // 之后又启动了新的履行尝试 → 当前不是失败终态
      return undefined;
    }
    if (ev.kind === 'delivered' && !ev.delivery && isFailureNote(ev.note)) return ev;
    if (ev.kind === 'fulfillment_started' && isFailureNote(ev.note)) return ev;
  }
  return undefined;
}

function isFailureNote(note: string | undefined): boolean {
  if (!note) return false;
  return /^(fail:|interrupted:|recoverable_fail:)/i.test(note) || /失败|中断|error/i.test(note);
}

/** 最近一次带 Job/Task 引用的履行启动。 */
export function latestLinkedFulfillment(record: CollaborationRecord): CollaborationEvent | undefined {
  for (let i = record.events.length - 1; i >= 0; i -= 1) {
    const ev = record.events[i];
    if (ev?.kind === 'fulfillment_started' && (ev.jobId || ev.taskId)) return ev;
  }
  return undefined;
}

export function latestOwnerDecision(
  record: CollaborationRecord,
): 'accept' | 'reject' | 'revise' | undefined {
  for (let i = record.events.length - 1; i >= 0; i -= 1) {
    const ev = record.events[i];
    if (ev?.kind === 'result_decided' && ev.decision) return ev.decision;
  }
  return undefined;
}

export function deriveCollabStatus(record: CollaborationRecord): CollabUserStatus {
  const events = record.events;
  if (events.some((e) => e.kind === 'revoked')) return 'revoked';
  if (events.some((e) => e.kind === 'withdrawn')) return 'withdrawn';

  const decision = latestOwnerDecision(record);
  if (decision === 'accept') return 'completed';
  if (decision === 'reject') return 'rejected';

  if (events.some((e) => e.kind === 'rejected')) return 'rejected';

  const last = events[events.length - 1];
  if (last?.kind === 'owner_confirmation_required') return 'awaiting_owner';
  if (last?.kind === 'clarification_requested') return 'awaiting_clarification';
  if (last?.kind === 'counter_proposed') return 'counter_proposed';

  const delivery = latestDelivery(record);
  if (delivery) return 'delivered';

  if (latestFulfillmentFailure(record)) return 'failed';

  if (events.some((e) => e.kind === 'fulfillment_started')) {
    return 'running';
  }

  if (findAgreement(record) || events.some((e) => e.kind === 'grant_issued')) {
    return events.some((e) => e.kind === 'grant_issued') ? 'authorized' : 'agreed';
  }

  if (events.some((e) => e.kind === 'proposed')) return 'proposed';
  return 'proposed';
}

export function eventIdsOf(record: CollaborationRecord): Set<string> {
  return new Set(record.events.map((e) => e.eventId));
}

/** 合并对端已接收事件：只追加未见过的 eventId，不修改已有事件。 */
export function mergeIncomingEvents(
  local: CollaborationRecord,
  incoming: CollaborationEvent[],
): CollaborationRecord {
  const seen = eventIdsOf(local);
  const added: CollaborationEvent[] = [];
  for (const ev of incoming) {
    if (seen.has(ev.eventId)) continue;
    seen.add(ev.eventId);
    added.push(ev);
  }
  if (added.length === 0) return local;
  const events = [...local.events, ...added].sort((a, b) => a.at.localeCompare(b.at) || a.eventId.localeCompare(b.eventId));
  return {
    ...local,
    events,
    updatedAt: events[events.length - 1]?.at || local.updatedAt,
  };
}
