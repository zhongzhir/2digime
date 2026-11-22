/**
 * Subject ↔ Subject 最小合同。
 * 公开协作面 ≠ Digital Self。交换事实记录发生了什么，不是协作走到第几步。
 */
import type { PersonalContextContract } from './personal-context-contract';

export const PUBLIC_CARD_SCHEMA_VERSION = 1 as const;
export const EXCHANGE_SCHEMA_VERSION = 1 as const;

export interface PublicSkill {
  name: string;
  summary: string;
}

export interface PublicSubjectCard {
  schemaVersion: typeof PUBLIC_CARD_SCHEMA_VERSION;
  subjectId: string;
  displayName: string;
  endpointRef: string;
  publicSkills: PublicSkill[];
  cooperationScope: string;
  protocol: '2digime-subject-collab/1';
  reachable: boolean;
}

export type CollaborationDecision = 'accept' | 'decline' | 'clarify' | 'alternative';

export interface CollaborationRequest {
  exchangeId: string;
  fromSubjectId: string;
  toSubjectId: string;
  at: string;
  goal: string;
  hopedContribution: string;
  disclosure: string;
  /** 一次任务的短期投影；不是第二份 Digital Self。 */
  contextContract?: PersonalContextContract;
  threadId: string;
}

export interface CollaborationDeliveryMeta {
  recipientEndpointRef: string;
  actualBody: string;
}

export interface CollaborationDeliveryReceipt {
  delivered: boolean;
  recipientEndpointRef: string;
  actualBodyDigest: string;
  actualBytes: number;
}

export interface CollaborationResponse {
  exchangeId: string;
  fromSubjectId: string;
  toSubjectId: string;
  at: string;
  /** 对端实际作出的决定（观察事实，不是产品阶段）。 */
  decision: CollaborationDecision;
  reply: string;
  contribution?: string;
  usedOwnCapability?: boolean;
  evidenceDigest?: string;
}

export type ExchangeKind =
  | 'request_sent'
  | 'request_received'
  | 'response_sent'
  | 'response_received'
  | 'disclosure_blocked'
  | 'delivery_failed';

export interface PersonalContextDisclosureAudit {
  contractId: string;
  contentDigest: string;
  actualBodyDigest: string;
  actualBytes: number;
  recipientEndpointRef: string;
  fieldRefs: string[];
}

export interface CollaborationExchangeEvent {
  schemaVersion: typeof EXCHANGE_SCHEMA_VERSION;
  id: string;
  exchangeId: string;
  kind: ExchangeKind;
  at: string;
  fromSubjectId: string;
  toSubjectId: string;
  threadId?: string;
  summary: string;
  bodyDigest: string;
  body: string;
  settlementRef: null;
  protocolRef?: string;
  peerDecision?: CollaborationDecision;
  usedOwnCapability?: boolean;
  disclosureAudit?: PersonalContextDisclosureAudit;
}

export interface ConsultResult {
  ok: boolean;
  received: boolean;
  decision?: CollaborationDecision;
  reply: string;
  contribution?: string;
  exchangeId: string;
  failureReason?: string;
  usedOwnCapability?: boolean;
  disclosed: string;
}
