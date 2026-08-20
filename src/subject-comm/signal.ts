/**
 * Signal — 正式协作之前的最小需求/供给信息。
 * 不等于 CollaborationRecord；不得默认发送完整 SubjectPackage。
 */
export type SignalDisclosureLevel = 'minimal' | 'brief';

export interface SignalPayload {
  intent: string;
  seeking: string[];
  offering: string[];
  constraints?: string[];
  disclosureLevel: SignalDisclosureLevel;
  expiresAt?: string;
}

export type MatchVerdict = 'no_match' | 'potential_match';

export interface SignalResponsePayload {
  verdict: MatchVerdict;
  /** 用户面友好摘要，无内部协议词 */
  whyWorthKnowing?: string;
  /** 对方可能需要（最小披露） */
  peerMayNeed?: string[];
  /** 你当前可能提供（最小披露） */
  youMayOffer?: string[];
  signalEnvelopeId: string;
}

export type OpportunityStage =
  | 'inbound_pending'
  | 'potential'
  | 'continued'
  | 'mutual_interest'
  | 'brief_shared'
  | 'declined'
  | 'collaboration_started';

/**
 * 机会卡 = 派生/业务视图，不是第二份 Signal 真相。
 * 权威消息事实在 inbox（SubjectEnvelope）；本卡必引用 signalEnvelopeId。
 * seeking/offering/why 等为展示缓存，可从对应 envelope 重建。
 */
export interface OpportunityCard {
  id: string;
  /** 固定标记：派生视图，非独立消息真相 */
  derivedFrom: 'signal_envelope';
  peerDisplayName: string;
  peerEndpointRef: string;
  peerSubjectId: string;
  stage: OpportunityStage;
  seekingSummary: string;
  offeringSummary: string;
  whyWorthKnowing: string;
  privacyNote: string;
  /** 追溯到 canonical Signal envelope（inbox） */
  signalEnvelopeId: string;
  responseEnvelopeId?: string;
  correlationId: string;
  /** 继续了解后的最小简介（仍非完整 Subject） */
  peerBrief?: string;
  localBrief?: string;
  collaborationRecordId?: string;
  createdAt: string;
  updatedAt: string;
}

export const OPPORTUNITY_PRIVACY_NOTE =
  '双方 Digital Me 只交换了判断这次机会所需的少量信息。';
