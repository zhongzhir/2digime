/**
 * Runtime endpoint/key 交接证明。
 *
 * 这是身份层机械事实，不是 Owner 身份证明、授权凭证或产品工作流。
 * 旧、新 Ed25519 key 对同一份声明分别签名，已配对对端据此允许短暂双端点重叠。
 */
import { randomBytes } from 'node:crypto';
import type { CommKeyMaterial } from './crypto-identity';
import { signDetachedEd25519, verifyDetachedEd25519 } from './crypto-identity';
import type { LocalEndpointProfile, PeerEndpointRecord } from './endpoint';

export const KEY_TRANSITION_FORMAT = 'digitalme.endpoint_key_transition.v1' as const;

export interface EndpointKeyBinding {
  endpointId: string;
  keyId: string;
  signPublicKey: string;
  encPublicKey: string;
}

export interface KeyTransitionStatement {
  transitionId: string;
  subjectId: string;
  displayName: string;
  previous: EndpointKeyBinding;
  next: EndpointKeyBinding;
  relayUrl: string;
  issuedAt: string;
  expiresAt: string;
}

export interface SignedKeyTransition {
  format: typeof KEY_TRANSITION_FORMAT;
  statement: KeyTransitionStatement;
  previousSignatureB64: string;
  nextSignatureB64: string;
}

export type KeyTransitionVerificationReason =
  | 'format_invalid'
  | 'transition_expired'
  | 'transition_not_yet_valid'
  | 'subject_binding_mismatch'
  | 'previous_endpoint_binding_mismatch'
  | 'previous_key_binding_mismatch'
  | 'previous_public_key_binding_mismatch'
  | 'next_endpoint_reused'
  | 'next_key_reused'
  | 'previous_key_revoked'
  | 'previous_signature_invalid'
  | 'next_signature_invalid';

export interface KeyTransitionVerification {
  ok: boolean;
  reasons: KeyTransitionVerificationReason[];
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

export function canonicalKeyTransitionBytes(statement: KeyTransitionStatement): Buffer {
  return Buffer.from(`${KEY_TRANSITION_FORMAT}\n${stableJson(statement)}`, 'utf8');
}

function binding(profile: LocalEndpointProfile): EndpointKeyBinding {
  return {
    endpointId: profile.endpointId,
    keyId: profile.keyId,
    signPublicKey: profile.signPublicKey,
    encPublicKey: profile.encPublicKey,
  };
}

export function createSignedKeyTransition(input: {
  previousProfile: LocalEndpointProfile;
  previousKeys: CommKeyMaterial;
  nextProfile: LocalEndpointProfile;
  nextKeys: CommKeyMaterial;
  issuedAt?: string;
  expiresAt?: string;
  transitionId?: string;
}): SignedKeyTransition {
  if (input.previousProfile.subjectId !== input.nextProfile.subjectId) {
    throw new Error('端点交接不能改变 subjectId');
  }
  if (input.previousProfile.endpointId === input.nextProfile.endpointId) {
    throw new Error('交接期间必须使用不同 endpointId');
  }
  if (input.previousProfile.keyId === input.nextProfile.keyId) {
    throw new Error('端点交接必须生成新 key');
  }
  if (
    input.previousKeys.keyId !== input.previousProfile.keyId ||
    input.nextKeys.keyId !== input.nextProfile.keyId
  ) {
    throw new Error('端点交接私钥与 profile 不匹配');
  }
  const issuedAt = input.issuedAt || new Date().toISOString();
  const expiresAt =
    input.expiresAt || new Date(Date.parse(issuedAt) + 24 * 60 * 60 * 1000).toISOString();
  const statement: KeyTransitionStatement = {
    transitionId:
      input.transitionId ||
      `ktr_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`,
    subjectId: input.previousProfile.subjectId,
    displayName: input.nextProfile.displayName,
    previous: binding(input.previousProfile),
    next: binding(input.nextProfile),
    relayUrl: input.nextProfile.relayUrl.replace(/\/+$/, ''),
    issuedAt,
    expiresAt,
  };
  const bytes = canonicalKeyTransitionBytes(statement);
  return {
    format: KEY_TRANSITION_FORMAT,
    statement,
    previousSignatureB64: signDetachedEd25519(input.previousKeys.signPrivatePem, bytes),
    nextSignatureB64: signDetachedEd25519(input.nextKeys.signPrivatePem, bytes),
  };
}

export function verifySignedKeyTransition(input: {
  proof: SignedKeyTransition;
  expectedPrevious: PeerEndpointRecord;
  revokedKeyIds?: string[];
  now?: string;
}): KeyTransitionVerification {
  const reasons: KeyTransitionVerificationReason[] = [];
  const proof = input.proof;
  if (!proof || proof.format !== KEY_TRANSITION_FORMAT || !proof.statement) {
    return { ok: false, reasons: ['format_invalid'] };
  }
  const s = proof.statement;
  const nowMs = Date.parse(input.now || new Date().toISOString());
  const issuedMs = Date.parse(s.issuedAt);
  const expiresMs = Date.parse(s.expiresAt);
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs) || expiresMs <= issuedMs) {
    reasons.push('format_invalid');
  } else {
    if (nowMs < issuedMs - 5 * 60 * 1000) reasons.push('transition_not_yet_valid');
    if (nowMs >= expiresMs) reasons.push('transition_expired');
  }
  if (s.subjectId !== input.expectedPrevious.subjectId) reasons.push('subject_binding_mismatch');
  if (s.previous.endpointId !== input.expectedPrevious.endpointId) {
    reasons.push('previous_endpoint_binding_mismatch');
  }
  if (s.previous.keyId !== input.expectedPrevious.keyId) {
    reasons.push('previous_key_binding_mismatch');
  }
  if (
    s.previous.signPublicKey !== input.expectedPrevious.signPublicKey ||
    s.previous.encPublicKey !== input.expectedPrevious.encPublicKey
  ) {
    reasons.push('previous_public_key_binding_mismatch');
  }
  if (s.next.endpointId === s.previous.endpointId) reasons.push('next_endpoint_reused');
  if (s.next.keyId === s.previous.keyId) reasons.push('next_key_reused');
  if ((input.revokedKeyIds || []).includes(s.previous.keyId)) reasons.push('previous_key_revoked');
  const bytes = canonicalKeyTransitionBytes(s);
  if (!verifyDetachedEd25519(s.previous.signPublicKey, bytes, proof.previousSignatureB64)) {
    reasons.push('previous_signature_invalid');
  }
  if (!verifyDetachedEd25519(s.next.signPublicKey, bytes, proof.nextSignatureB64)) {
    reasons.push('next_signature_invalid');
  }
  return { ok: reasons.length === 0, reasons };
}
