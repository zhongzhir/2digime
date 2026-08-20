/**
 * SubjectEndpoint — 跨机主体端点身份（与本地 package 路径解耦）。
 * Subject identity ≠ device endpoint；本轮每 Subject 一个 active endpoint。
 */
export const SUBJECT_ENDPOINT_PROTOCOL = 1 as const;

export interface SubjectEndpointPublic {
  protocolVersion: typeof SUBJECT_ENDPOINT_PROTOCOL;
  subjectId: string;
  endpointId: string;
  displayName: string;
  /** Relay base URL，如 http://127.0.0.1:8787 */
  relayUrl: string;
  /** Ed25519 验签公钥（spki base64） */
  signPublicKey: string;
  /** X25519 加密公钥（spki base64） */
  encPublicKey: string;
  keyId: string;
}

export interface PeerEndpointRecord extends SubjectEndpointPublic {
  pairedAt: string;
}

export interface LocalEndpointProfile extends SubjectEndpointPublic {
  /** 本端私钥不在此结构；仅存 keyId 引用 SecretStore */
  createdAt: string;
}

/** 远程 endpointRef 合同：dmep:<endpointId> */
export function remoteEndpointRef(endpointId: string): string {
  return `dmep:${endpointId}`;
}

export function parseRemoteEndpointRef(endpointRef: string): string | null {
  if (!endpointRef.startsWith('dmep:')) return null;
  const id = endpointRef.slice('dmep:'.length).trim();
  return id || null;
}

export function isRemoteEndpointRef(endpointRef: string): boolean {
  return endpointRef.startsWith('dmep:');
}
