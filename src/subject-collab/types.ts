/**
 * Subject ↔ Subject 最小合同。
 * 公开协作面 ≠ Digital Self。交换事实记录发生了什么，不是协作走到第几步。
 */
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
  threadId: string;
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
  | 'disclosure_blocked';

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
