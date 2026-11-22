/**
 * 已配对 Subject 间的签名公开卡基础。
 *
 * 这不是 Owner 身份证明，也不宣称符合标准 A2A Agent Card/JWS。
 * 信任根仍是配对时保存的对端 Ed25519 公钥；本层只把公开声明机械绑定到
 * subject、endpoint、key、签发时间和有效期。
 */
import type { CommIdentityStore } from '../subject-comm/identity-store';
import type { PeerEndpointRecord, SubjectEndpointPublic } from '../subject-comm/endpoint';
import { parseRemoteEndpointRef, remoteEndpointRef } from '../subject-comm/endpoint';
import {
  signDetachedEd25519,
  verifyDetachedEd25519,
} from '../subject-comm/crypto-identity';
import { PUBLIC_CARD_SCHEMA_VERSION, type PublicSkill, type PublicSubjectCard } from './types';

export const SIGNED_PUBLIC_CARD_KIND = 'digitalme.public_subject_card.signed.v1' as const;
export const SIGNED_PUBLIC_CARD_SCHEMA_VERSION = 1 as const;

export interface SignedPublicSubjectCard {
  kind: typeof SIGNED_PUBLIC_CARD_KIND;
  schemaVersion: typeof SIGNED_PUBLIC_CARD_SCHEMA_VERSION;
  card: PublicSubjectCard;
  issuer: {
    subjectId: string;
    endpointId: string;
    keyId: string;
  };
  issuedAt: string;
  expiresAt: string;
  signatureB64: string;
}

interface UnsignedPublicSubjectCard extends Omit<SignedPublicSubjectCard, 'signatureB64'> {}

export interface SignedPublicCardVerification {
  ok: boolean;
  reasons: string[];
  card?: PublicSubjectCard;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('签名内容包含非有限数值');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`);
    return `{${fields.join(',')}}`;
  }
  throw new Error('签名内容包含不支持的类型');
}

export function publicSubjectCardSignBytes(input: UnsignedPublicSubjectCard): Buffer {
  return Buffer.from(`dm-public-subject-card-v1\n${stableJson(input)}`, 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function parseSkill(value: unknown): PublicSkill | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const summary = typeof value.summary === 'string' ? value.summary.trim() : '';
  if (!name || !summary) return null;
  return { name, summary };
}

function parseCard(value: unknown): PublicSubjectCard | null {
  if (!isRecord(value) || value.schemaVersion !== PUBLIC_CARD_SCHEMA_VERSION) return null;
  if (
    typeof value.subjectId !== 'string' ||
    typeof value.displayName !== 'string' ||
    typeof value.endpointRef !== 'string' ||
    typeof value.cooperationScope !== 'string' ||
    value.protocol !== '2digime-subject-collab/1' ||
    typeof value.reachable !== 'boolean' ||
    !Array.isArray(value.publicSkills)
  ) {
    return null;
  }
  const publicSkills = value.publicSkills.map(parseSkill);
  if (publicSkills.some((item) => item === null)) return null;
  return {
    schemaVersion: PUBLIC_CARD_SCHEMA_VERSION,
    subjectId: value.subjectId.trim(),
    displayName: value.displayName.trim(),
    endpointRef: value.endpointRef.trim(),
    publicSkills: publicSkills as PublicSkill[],
    cooperationScope: value.cooperationScope.trim(),
    protocol: '2digime-subject-collab/1',
    reachable: value.reachable,
  };
}

function parseSignedCard(value: unknown): SignedPublicSubjectCard | null {
  if (!isRecord(value)) return null;
  if (
    value.kind !== SIGNED_PUBLIC_CARD_KIND ||
    value.schemaVersion !== SIGNED_PUBLIC_CARD_SCHEMA_VERSION ||
    !isRecord(value.issuer) ||
    typeof value.issuer.subjectId !== 'string' ||
    typeof value.issuer.endpointId !== 'string' ||
    typeof value.issuer.keyId !== 'string' ||
    typeof value.issuedAt !== 'string' ||
    typeof value.expiresAt !== 'string' ||
    typeof value.signatureB64 !== 'string'
  ) {
    return null;
  }
  const card = parseCard(value.card);
  if (!card) return null;
  return {
    kind: SIGNED_PUBLIC_CARD_KIND,
    schemaVersion: SIGNED_PUBLIC_CARD_SCHEMA_VERSION,
    card,
    issuer: {
      subjectId: value.issuer.subjectId.trim(),
      endpointId: value.issuer.endpointId.trim(),
      keyId: value.issuer.keyId.trim(),
    },
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
    signatureB64: value.signatureB64,
  };
}

export async function signPublicSubjectCard(input: {
  card: PublicSubjectCard;
  identity: CommIdentityStore;
  issuedAt?: string;
  expiresAt?: string;
  validityMs?: number;
}): Promise<SignedPublicSubjectCard> {
  const profile = await input.identity.getLocalProfile();
  const keys = await input.identity.loadKeyMaterial();
  if (!profile || !keys) throw new Error('主体通信身份不可用');
  if (input.card.subjectId !== profile.subjectId) throw new Error('公开卡 subjectId 与签名主体不一致');
  if (input.card.endpointRef !== remoteEndpointRef(profile.endpointId)) {
    throw new Error('公开卡 endpointRef 与签名端点不一致');
  }
  if (keys.keyId !== profile.keyId) throw new Error('签名密钥与本机端点记录不一致');

  const issuedAt = input.issuedAt || new Date().toISOString();
  const issuedMs = Date.parse(issuedAt);
  if (!Number.isFinite(issuedMs)) throw new Error('公开卡 issuedAt 无效');
  const expiresAt =
    input.expiresAt || new Date(issuedMs + (input.validityMs ?? 24 * 60 * 60 * 1000)).toISOString();
  if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= issuedMs) {
    throw new Error('公开卡 expiresAt 必须晚于 issuedAt');
  }

  const unsigned: UnsignedPublicSubjectCard = {
    kind: SIGNED_PUBLIC_CARD_KIND,
    schemaVersion: SIGNED_PUBLIC_CARD_SCHEMA_VERSION,
    card: input.card,
    issuer: {
      subjectId: profile.subjectId,
      endpointId: profile.endpointId,
      keyId: profile.keyId,
    },
    issuedAt,
    expiresAt,
  };
  return {
    ...unsigned,
    signatureB64: signDetachedEd25519(keys.signPrivatePem, publicSubjectCardSignBytes(unsigned)),
  };
}

export function verifySignedPublicSubjectCard(input: {
  signedCard: unknown;
  expectedPeer: SubjectEndpointPublic | PeerEndpointRecord;
  revokedKeyIds?: readonly string[];
  now?: string;
  maxClockSkewMs?: number;
}): SignedPublicCardVerification {
  const parsed = parseSignedCard(input.signedCard);
  if (!parsed) return { ok: false, reasons: ['signed_card_shape_invalid'] };

  const reasons: string[] = [];
  const expected = input.expectedPeer;
  const endpointId = parseRemoteEndpointRef(parsed.card.endpointRef);
  if (parsed.issuer.subjectId !== expected.subjectId || parsed.card.subjectId !== expected.subjectId) {
    reasons.push('subject_binding_mismatch');
  }
  if (
    parsed.issuer.endpointId !== expected.endpointId ||
    endpointId !== expected.endpointId
  ) {
    reasons.push('endpoint_binding_mismatch');
  }
  if (parsed.issuer.keyId !== expected.keyId) reasons.push('key_binding_mismatch');
  if ((input.revokedKeyIds || []).includes(parsed.issuer.keyId)) reasons.push('key_revoked');

  const issuedMs = Date.parse(parsed.issuedAt);
  const expiresMs = Date.parse(parsed.expiresAt);
  const nowMs = Date.parse(input.now || new Date().toISOString());
  const skew = input.maxClockSkewMs ?? 5 * 60 * 1000;
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs) || expiresMs <= issuedMs) {
    reasons.push('card_time_invalid');
  } else {
    if (issuedMs > nowMs + skew) reasons.push('card_not_yet_valid');
    if (expiresMs <= nowMs) reasons.push('card_expired');
  }

  const { signatureB64: _signature, ...unsigned } = parsed;
  if (
    !verifyDetachedEd25519(
      expected.signPublicKey,
      publicSubjectCardSignBytes(unsigned),
      parsed.signatureB64,
    )
  ) {
    reasons.push('signature_invalid');
  }

  return reasons.length === 0
    ? { ok: true, reasons, card: parsed.card }
    : { ok: false, reasons };
}
