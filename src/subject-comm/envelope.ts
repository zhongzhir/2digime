/**
 * SubjectEnvelope — 跨主体传输单位（Local / 未来 Relay / P2P 共用合同）。
 * 不承载协作决策、匹配、Growth、Task、Artifact 业务规则。
 */
import type { SubjectRef } from '../collaboration/schema';
import type { CollaborationEvent, CollaborationRecord } from '../collaboration/schema';
import type { SignalPayload, SignalResponsePayload } from './signal';

export const SUBJECT_ENVELOPE_VERSION = 1 as const;

export type SubjectEnvelopeKind = 'signal' | 'signal_response' | 'collaboration_sync';

/** Local 明确 trusted；远程预留字段本轮不填、不伪造。 */
export type TransportTrustMode = 'local_trusted' | 'remote';

export interface SubjectTransportMeta {
  mode: TransportTrustMode;
  /** 未来 Remote：sender/recipient identity key 引用 */
  keyId?: string;
  signature?: string;
  encrypted?: boolean;
}

export interface CollaborationSyncPayload {
  recordId: string;
  events: CollaborationEvent[];
  seedRecord?: CollaborationRecord;
}

export type SubjectEnvelopePayload =
  | SignalPayload
  | SignalResponsePayload
  | CollaborationSyncPayload;

export interface SubjectEnvelope {
  /** JsonObjectStore 主键；与 envelopeId 相同 */
  id: string;
  version: typeof SUBJECT_ENVELOPE_VERSION;
  envelopeId: string;
  from: SubjectRef;
  to: SubjectRef;
  kind: SubjectEnvelopeKind;
  createdAt: string;
  expiresAt?: string;
  correlationId?: string;
  replyTo?: string;
  payload: SubjectEnvelopePayload;
  transportMeta: SubjectTransportMeta;
  /** 本方 inbox 派生：投递回执，≠ 业务接受 */
  ackedAt?: string;
  receivedAt?: string;
}

export function envelopeStoreId(envelopeId: string): string {
  return envelopeId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
}
