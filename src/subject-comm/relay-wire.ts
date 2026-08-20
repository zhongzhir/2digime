/**
 * Relay 线上单位 — 仅路由元数据 + 密文；无业务明文。
 */
import type { SealedPayload } from './crypto-identity';

export interface RelayWireEnvelope {
  version: 1;
  envelopeId: string;
  fromEndpointId: string;
  toEndpointId: string;
  keyId: string;
  createdAt: string;
  expiresAt?: string;
  /** JSON string of SealedPayload — 已签名的密封体 */
  sealed: SealedPayload;
  signatureB64: string;
  /** 投递状态（仅 Relay / 客户端日志用） */
  deliveryState?: 'submitted' | 'stored' | 'fetched' | 'acked';
}

export interface RelaySubmitResponse {
  ok: boolean;
  duplicate?: boolean;
  state: 'delivered-to-relay' | 'duplicate';
}

export interface RelayFetchResponse {
  items: RelayWireEnvelope[];
}

export interface RelayAckResponse {
  ok: boolean;
}
