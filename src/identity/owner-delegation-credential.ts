/**
 * Owner -> Digital Subject 委托凭证。
 *
 * - AuthorizationGrant 仍是授权事实源；VC/VP 只是可验证投影。
 * - Owner 签名私钥只进入既有 FileSecretStore。
 * - Subject 使用既有通信密钥对短时 presentation 做 holder binding。
 * - 本层实现 W3C VC 2.0 + VC-JOSE-COSE 的 JOSE 形状，不宣称已经实现
 *   OpenID4VCI / OpenID4VP 传输协议或第三方钱包互操作。
 */
import {
  createHash,
  generateKeyPairSync,
  randomUUID,
} from 'node:crypto';
import * as path from 'node:path';
import type * as Jose from 'jose';
import { GrantStore } from '../collaboration/grant-store';
import type { AuthorizationGrant } from '../collaboration/schema';
import { FileSecretStore, type CipherAdapter } from '../infrastructure/secret-store';
import type { LocalEndpointProfile, SubjectEndpointPublic } from '../subject-comm/endpoint';
import { CommIdentityStore } from '../subject-comm/identity-store';
import type { OwnerIdentityRecord, SubjectOwnerBinding } from './types';
import { OwnerIdentityStore } from './owner-identity-store';

type JoseModule = typeof Jose;
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
  specifier: string,
) => Promise<JoseModule>;

export const OWNER_DELEGATION_CREDENTIAL_TYPE = 'DigitalSubjectDelegationCredential' as const;
export const OWNER_DELEGATION_PRESENTATION_TYPE = 'DigitalSubjectDelegationPresentation' as const;
export const OWNER_DELEGATION_DEFAULT_TTL_MS = 60 * 60 * 1000;
export const OWNER_DELEGATION_MAX_TTL_MS = 24 * 60 * 60 * 1000;
export const OWNER_DELEGATION_PRESENTATION_TTL_MS = 5 * 60 * 1000;

const BASE_CONTEXT = 'https://www.w3.org/ns/credentials/v2' as const;
const DM_VOCAB = 'https://2digime.com/ns/credentials#';
const SECRET_PREFIX = 'identity.ownerDelegationKey.';

const DELEGATION_CONTEXT = Object.freeze({
  DigitalSubjectDelegationCredential: `${DM_VOCAB}DigitalSubjectDelegationCredential`,
  DigitalSubjectDelegationPresentation: `${DM_VOCAB}DigitalSubjectDelegationPresentation`,
  delegation: `${DM_VOCAB}delegation`,
  actions: { '@id': `${DM_VOCAB}actions`, '@container': '@set' },
  resourceRefs: { '@id': `${DM_VOCAB}resourceRefs`, '@container': '@set' },
  purpose: `${DM_VOCAB}purpose`,
  ownerSubjectBinding: `${DM_VOCAB}ownerSubjectBinding`,
  holderBinding: `${DM_VOCAB}holderBinding`,
  keyId: `${DM_VOCAB}keyId`,
  publicKeySha256: `${DM_VOCAB}publicKeySha256`,
  organizationId: `${DM_VOCAB}organizationId`,
  tenantId: `${DM_VOCAB}tenantId`,
  statusReference: `${DM_VOCAB}statusReference`,
  statusPurpose: `${DM_VOCAB}statusPurpose`,
  challenge: `${DM_VOCAB}challenge`,
  audience: `${DM_VOCAB}audience`,
  created: `${DM_VOCAB}created`,
  expires: `${DM_VOCAB}expires`,
});

export type OwnerDelegationDisclosableClaim = 'organization_id' | 'tenant_id';

export interface OwnerDelegationIssuerPublicKey {
  id: string;
  controller: string;
  algorithm: 'EdDSA';
  publicKeySpkiB64: string;
}

export interface OwnerDelegationCredentialDocument {
  '@context': readonly [typeof BASE_CONTEXT, typeof DELEGATION_CONTEXT];
  id: string;
  type: readonly ['VerifiableCredential', typeof OWNER_DELEGATION_CREDENTIAL_TYPE];
  issuer: { id: string };
  validFrom: string;
  validUntil: string;
  credentialSubject: {
    id: string;
    ownerSubjectBinding: string;
    holderBinding: {
      keyId: string;
      publicKeySha256: string;
    };
    delegation: {
      actions: string[];
      resourceRefs?: string[];
      purpose: string;
    };
    organizationId?: string;
    tenantId?: string;
  };
  credentialStatus: {
    id: string;
    type: 'DigitalMeAuthorizationGrantStatus2026';
    statusPurpose: 'revocation';
    statusReference: string;
  };
}

export interface OwnerDelegationPresentationDocument {
  '@context': readonly [typeof BASE_CONTEXT, typeof DELEGATION_CONTEXT];
  type: readonly ['VerifiablePresentation', typeof OWNER_DELEGATION_PRESENTATION_TYPE];
  holder: { id: string };
  verifiableCredential: Array<{
    '@context': typeof BASE_CONTEXT;
    id: string;
    type: 'EnvelopedVerifiableCredential';
  }>;
  challenge: string;
  audience: string;
  created: string;
  expires: string;
}

export interface SecuredOwnerDelegationCredential {
  format: 'application/vc+jwt';
  document: OwnerDelegationCredentialDocument;
  compactJws: string;
  issuerKey: OwnerDelegationIssuerPublicKey;
  grant: AuthorizationGrant;
}

export interface SecuredOwnerDelegationPresentation {
  format: 'application/vp+jwt';
  document: OwnerDelegationPresentationDocument;
  compactJws: string;
}

interface OwnerDelegationKeyBundle {
  version: 1;
  keyId: string;
  privateKeyPkcs8Pem: string;
  publicKeySpkiB64: string;
  createdAt: string;
  retiredKeyIds: string[];
}

export interface OwnerDelegationVerification {
  ok: boolean;
  reasons: string[];
  credential?: OwnerDelegationCredentialDocument;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function spkiPem(spkiB64: string): string {
  const lines = spkiB64.match(/.{1,64}/g);
  if (!lines?.length) throw new Error('SPKI 公钥格式无效');
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`;
}

function urn(kind: string, value: string): string {
  return `urn:2digime:${kind}:${encodeURIComponent(value)}`;
}

function ownerId(ownerIdentityId: string): string {
  return urn('owner-identity', ownerIdentityId);
}

function subjectId(value: string): string {
  return urn('subject', value);
}

function keyId(value: string): string {
  return urn('owner-delegation-key', value);
}

function subjectKeyId(value: string): string {
  return urn('subject-key', value);
}

function credentialId(value: string): string {
  return `urn:uuid:${value}`;
}

function secretName(ownerIdentityId: string): string {
  if (!/^[A-Za-z0-9_.-]+$/.test(ownerIdentityId)) {
    throw new Error('Owner identity id 不适合作为密钥引用');
  }
  return `${SECRET_PREFIX}${ownerIdentityId}`;
}

function createKeyBundle(at: string, retiredKeyIds: string[] = []): OwnerDelegationKeyBundle {
  const parsedAt = Date.parse(at);
  if (!Number.isFinite(parsedAt)) throw new Error('Owner 委托密钥时间无效');
  const pair = generateKeyPairSync('ed25519');
  return {
    version: 1,
    keyId: `odk_${randomUUID()}`,
    privateKeyPkcs8Pem: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeySpkiB64: pair.publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    createdAt: at,
    retiredKeyIds: [...new Set(retiredKeyIds)].sort(),
  };
}

function parseKeyBundle(raw: string | null): OwnerDelegationKeyBundle | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<OwnerDelegationKeyBundle>;
    if (
      value.version !== 1 ||
      typeof value.keyId !== 'string' ||
      typeof value.privateKeyPkcs8Pem !== 'string' ||
      typeof value.publicKeySpkiB64 !== 'string' ||
      typeof value.createdAt !== 'string' ||
      !Array.isArray(value.retiredKeyIds)
    ) return null;
    return value as OwnerDelegationKeyBundle;
  } catch {
    return null;
  }
}

function publicIssuerKey(
  ownerIdentityId: string,
  bundle: OwnerDelegationKeyBundle,
): OwnerDelegationIssuerPublicKey {
  return {
    id: keyId(bundle.keyId),
    controller: ownerId(ownerIdentityId),
    algorithm: 'EdDSA',
    publicKeySpkiB64: bundle.publicKeySpkiB64,
  };
}

function normalizeList(values: readonly string[], label: string, limit = 32): string[] {
  const rows = [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].sort();
  if (!rows.length) throw new Error(`${label}不能为空`);
  if (rows.length > limit) throw new Error(`${label}超过最小授权上限`);
  return rows;
}

function activeAuthority(
  identities: OwnerIdentityRecord[],
  bindings: SubjectOwnerBinding[],
  ownerIdentityId: string,
  targetSubjectId: string,
): { identity: OwnerIdentityRecord; binding: SubjectOwnerBinding } {
  const identity = identities.find((item) => item.id === ownerIdentityId);
  if (!identity || identity.revokedAt) throw new Error('Owner identity 不可用于委托');
  const binding = bindings.find(
    (item) =>
      item.ownerIdentityId === ownerIdentityId &&
      item.subjectId === targetSubjectId &&
      !item.revokedAt,
  );
  if (!binding) throw new Error('Owner identity 尚未有效绑定目标 Digital Subject');
  const scopedIdentity = Boolean(identity.organizationId || identity.tenantId);
  if (
    (scopedIdentity && !binding.authorityScope) ||
    binding.authorityScope?.organizationId !== identity.organizationId ||
    binding.authorityScope?.tenantId !== identity.tenantId
  ) {
    throw new Error('Owner→Subject binding 的机构范围已失效，必须重新确认');
  }
  return { identity, binding };
}

function selectedAuthorityClaims(
  identity: OwnerIdentityRecord,
  selected: readonly OwnerDelegationDisclosableClaim[],
): Pick<OwnerDelegationCredentialDocument['credentialSubject'], 'organizationId' | 'tenantId'> {
  const unique = new Set(selected);
  if ([...unique].some((item) => item !== 'organization_id' && item !== 'tenant_id')) {
    throw new Error('Owner 委托包含不允许披露的 authority claim');
  }
  const result: { organizationId?: string; tenantId?: string } = {};
  if (unique.has('organization_id')) {
    if (!identity.organizationId) throw new Error('Owner identity 没有可披露 organization_id');
    result.organizationId = identity.organizationId;
  }
  if (unique.has('tenant_id')) {
    if (!identity.tenantId) throw new Error('Owner identity 没有可披露 tenant_id');
    result.tenantId = identity.tenantId;
  }
  return result;
}

function parseJsonObject(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function parseCredential(value: Record<string, unknown> | null): OwnerDelegationCredentialDocument | null {
  if (!value) return null;
  const context = value['@context'];
  const type = value.type;
  const issuer = value.issuer;
  const subject = value.credentialSubject;
  const status = value.credentialStatus;
  if (
    !Array.isArray(context) || context.length !== 2 || context[0] !== BASE_CONTEXT ||
    JSON.stringify(context[1]) !== JSON.stringify(DELEGATION_CONTEXT) ||
    !Array.isArray(type) || type[0] !== 'VerifiableCredential' ||
    type[1] !== OWNER_DELEGATION_CREDENTIAL_TYPE ||
    typeof value.id !== 'string' ||
    !issuer || typeof issuer !== 'object' || typeof (issuer as { id?: unknown }).id !== 'string' ||
    typeof value.validFrom !== 'string' || typeof value.validUntil !== 'string' ||
    !subject || typeof subject !== 'object' ||
    !status || typeof status !== 'object'
  ) return null;
  const subjectRow = subject as Record<string, unknown>;
  const holderBinding = subjectRow.holderBinding as Record<string, unknown> | undefined;
  const delegation = subjectRow.delegation as Record<string, unknown> | undefined;
  const statusRow = status as Record<string, unknown>;
  if (
    typeof subjectRow.id !== 'string' ||
    typeof subjectRow.ownerSubjectBinding !== 'string' ||
    (subjectRow.organizationId !== undefined && typeof subjectRow.organizationId !== 'string') ||
    (subjectRow.tenantId !== undefined && typeof subjectRow.tenantId !== 'string') ||
    !holderBinding || typeof holderBinding.keyId !== 'string' ||
    typeof holderBinding.publicKeySha256 !== 'string' ||
    !delegation || !Array.isArray(delegation.actions) ||
    !delegation.actions.every((item) => typeof item === 'string') ||
    typeof delegation.purpose !== 'string' ||
    (delegation.resourceRefs !== undefined &&
      (!Array.isArray(delegation.resourceRefs) ||
        !delegation.resourceRefs.every((item) => typeof item === 'string'))) ||
    typeof statusRow.id !== 'string' ||
    statusRow.type !== 'DigitalMeAuthorizationGrantStatus2026' ||
    statusRow.statusPurpose !== 'revocation' ||
    typeof statusRow.statusReference !== 'string'
  ) return null;
  return value as unknown as OwnerDelegationCredentialDocument;
}

function parsePresentation(value: Record<string, unknown> | null): OwnerDelegationPresentationDocument | null {
  if (!value) return null;
  const context = value['@context'];
  const type = value.type;
  const holder = value.holder;
  const vcs = value.verifiableCredential;
  if (
    !Array.isArray(context) || context.length !== 2 || context[0] !== BASE_CONTEXT ||
    JSON.stringify(context[1]) !== JSON.stringify(DELEGATION_CONTEXT) ||
    !Array.isArray(type) || type[0] !== 'VerifiablePresentation' ||
    type[1] !== OWNER_DELEGATION_PRESENTATION_TYPE ||
    !holder || typeof holder !== 'object' || typeof (holder as { id?: unknown }).id !== 'string' ||
    !Array.isArray(vcs) || vcs.length !== 1 ||
    typeof value.challenge !== 'string' || typeof value.audience !== 'string' ||
    typeof value.created !== 'string' || typeof value.expires !== 'string'
  ) return null;
  const envelope = vcs[0] as Record<string, unknown> | undefined;
  if (
    !envelope || envelope['@context'] !== BASE_CONTEXT ||
    envelope.type !== 'EnvelopedVerifiableCredential' ||
    typeof envelope.id !== 'string' || !envelope.id.startsWith('data:application/vc+jwt,')
  ) return null;
  return value as unknown as OwnerDelegationPresentationDocument;
}

function matchingGrant(
  grant: AuthorizationGrant | null,
  credential: OwnerDelegationCredentialDocument,
): string[] {
  const reasons: string[] = [];
  const statusRef = credential.credentialStatus.statusReference;
  const expectedRef = grant ? `authorization-grant:${grant.id}` : '';
  if (!grant) return ['grant_not_found'];
  if (statusRef !== expectedRef) reasons.push('grant_reference_mismatch');
  if (credential.credentialStatus.id !== urn('grant-status', grant.id)) {
    reasons.push('grant_status_id_mismatch');
  }
  if (grant.status !== 'granted') reasons.push(`grant_${grant.status}`);
  if (grant.grantee.kind !== 'owned_subject') reasons.push('grant_grantee_kind_invalid');
  if (grant.grantee.kind === 'owned_subject' && subjectId(grant.grantee.subjectId) !== credential.credentialSubject.id) {
    reasons.push('grant_subject_mismatch');
  }
  if (grant.origin.kind !== 'owner_delegation') reasons.push('grant_origin_invalid');
  if (grant.origin.kind === 'owner_delegation') {
    if (ownerId(grant.origin.ownerIdentityId) !== credential.issuer.id) reasons.push('grant_owner_mismatch');
    if (urn('owner-subject-binding', grant.origin.ownerSubjectBindingId) !== credential.credentialSubject.ownerSubjectBinding) {
      reasons.push('grant_binding_mismatch');
    }
    if (sha256(credential.credentialSubject.delegation.purpose) !== grant.origin.purposeDigest) {
      reasons.push('grant_purpose_mismatch');
    }
    if (grant.origin.credentialId !== credential.id) reasons.push('grant_credential_mismatch');
  }
  if (JSON.stringify([...grant.scope.actions].map(String).sort()) !==
      JSON.stringify([...credential.credentialSubject.delegation.actions].sort())) {
    reasons.push('grant_actions_mismatch');
  }
  if (JSON.stringify([...(grant.scope.resourceRefs || [])].sort()) !==
      JSON.stringify([...(credential.credentialSubject.delegation.resourceRefs || [])].sort())) {
    reasons.push('grant_resources_mismatch');
  }
  if (grant.expiresAt !== credential.validUntil || grant.grantedAt !== credential.validFrom) {
    reasons.push('grant_time_mismatch');
  }
  return reasons;
}

export class OwnerDelegationCredentialService {
  private readonly ownerStore: OwnerIdentityStore;
  private readonly grantStorePromise: Promise<GrantStore>;
  private readonly subjectIdentity: CommIdentityStore;
  private readonly secrets: FileSecretStore;

  constructor(
    private readonly packageRoot: string,
    cipher: CipherAdapter,
  ) {
    this.ownerStore = new OwnerIdentityStore(packageRoot);
    this.grantStorePromise = GrantStore.open(packageRoot);
    this.subjectIdentity = new CommIdentityStore(packageRoot, cipher);
    this.secrets = new FileSecretStore({
      filePath: path.join(packageRoot, 'identity', 'owner-delegation-secrets.v1.json'),
      cipher,
    });
  }

  private async keyBundle(ownerIdentityId: string, at: string): Promise<OwnerDelegationKeyBundle> {
    const name = secretName(ownerIdentityId);
    const existing = parseKeyBundle(await this.secrets.get(name));
    if (existing) return existing;
    const created = createKeyBundle(at);
    await this.secrets.put(name, JSON.stringify(created));
    return created;
  }

  async currentIssuerKey(ownerIdentityId: string, at: string): Promise<OwnerDelegationIssuerPublicKey> {
    return publicIssuerKey(ownerIdentityId, await this.keyBundle(ownerIdentityId, at));
  }

  async rotateIssuerKey(ownerIdentityId: string, at: string): Promise<OwnerDelegationIssuerPublicKey> {
    const name = secretName(ownerIdentityId);
    const previous = await this.keyBundle(ownerIdentityId, at);
    const next = createKeyBundle(at, [...previous.retiredKeyIds, previous.keyId]);
    await this.secrets.put(name, JSON.stringify(next));
    return publicIssuerKey(ownerIdentityId, next);
  }

  async issue(input: {
    ownerIdentityId: string;
    subjectId: string;
    actions: string[];
    resourceRefs?: string[];
    purpose: string;
    selectedClaims?: OwnerDelegationDisclosableClaim[];
    issuedAt: string;
    ttlMs?: number;
  }): Promise<SecuredOwnerDelegationCredential> {
    const issuedMs = Date.parse(input.issuedAt);
    if (!Number.isFinite(issuedMs)) throw new Error('Owner 委托签发时间无效');
    const purpose = String(input.purpose || '').trim();
    if (!purpose) throw new Error('Owner 委托必须绑定明确目的');
    const actions = normalizeList(input.actions, 'Owner 委托 actions');
    const resourceRefs = input.resourceRefs?.length
      ? normalizeList(input.resourceRefs, 'Owner 委托 resourceRefs')
      : undefined;
    const ttl = Math.max(
      1_000,
      Math.min(input.ttlMs ?? OWNER_DELEGATION_DEFAULT_TTL_MS, OWNER_DELEGATION_MAX_TTL_MS),
    );
    const validUntil = new Date(issuedMs + ttl).toISOString();

    const listed = await this.ownerStore.list();
    const { identity, binding } = activeAuthority(
      listed.identities,
      listed.bindings,
      input.ownerIdentityId,
      input.subjectId,
    );
    const profile = await this.subjectIdentity.getLocalProfile();
    if (!profile || profile.subjectId !== input.subjectId) {
      throw new Error('目标 Digital Subject 的活动通信身份不可用');
    }
    const bundle = await this.keyBundle(input.ownerIdentityId, input.issuedAt);
    const issuerKey = publicIssuerKey(input.ownerIdentityId, bundle);
    const vcId = credentialId(randomUUID());
    const grantId = `grant_owner_${randomUUID()}`;
    const disclosed = selectedAuthorityClaims(identity, input.selectedClaims || []);
    const document: OwnerDelegationCredentialDocument = {
      '@context': [BASE_CONTEXT, DELEGATION_CONTEXT],
      id: vcId,
      type: ['VerifiableCredential', OWNER_DELEGATION_CREDENTIAL_TYPE],
      issuer: { id: ownerId(input.ownerIdentityId) },
      validFrom: input.issuedAt,
      validUntil,
      credentialSubject: {
        id: subjectId(input.subjectId),
        ownerSubjectBinding: urn('owner-subject-binding', binding.id),
        holderBinding: {
          keyId: subjectKeyId(profile.keyId),
          publicKeySha256: sha256(Buffer.from(profile.signPublicKey, 'base64')),
        },
        delegation: {
          actions,
          ...(resourceRefs ? { resourceRefs } : {}),
          purpose,
        },
        ...disclosed,
      },
      credentialStatus: {
        id: urn('grant-status', grantId),
        type: 'DigitalMeAuthorizationGrantStatus2026',
        statusPurpose: 'revocation',
        statusReference: `authorization-grant:${grantId}`,
      },
    };
    const grant: AuthorizationGrant = {
      id: grantId,
      // 现有 Grant 仍按 SubjectPackage 分区；实际 Owner 权威在 origin 中明确记录。
      grantorSubjectId: input.subjectId,
      grantee: { kind: 'owned_subject', subjectId: input.subjectId },
      scope: { actions, ...(resourceRefs ? { resourceRefs } : {}) },
      origin: {
        kind: 'owner_delegation',
        ownerIdentityId: input.ownerIdentityId,
        ownerSubjectBindingId: binding.id,
        purposeDigest: sha256(purpose),
        credentialId: vcId,
      },
      status: 'granted',
      grantedAt: input.issuedAt,
      expiresAt: validUntil,
    };
    const jose = await dynamicImport('jose');
    const signingKey = await jose.importPKCS8(bundle.privateKeyPkcs8Pem, 'EdDSA');
    const compactJws = await new jose.CompactSign(
      Buffer.from(JSON.stringify(document), 'utf8'),
    )
      .setProtectedHeader({ alg: 'EdDSA', typ: 'vc+jwt', cty: 'vc', kid: issuerKey.id })
      .sign(signingKey);
    await (await this.grantStorePromise).put(grant);
    return { format: 'application/vc+jwt', document, compactJws, issuerKey, grant };
  }

  async present(input: {
    credential: SecuredOwnerDelegationCredential;
    audience: string;
    challenge: string;
    createdAt: string;
  }): Promise<SecuredOwnerDelegationPresentation> {
    const audience = String(input.audience || '').trim();
    const challenge = String(input.challenge || '').trim();
    const createdMs = Date.parse(input.createdAt);
    if (!audience || !challenge || !Number.isFinite(createdMs)) {
      throw new Error('委托凭证出示必须绑定 verifier、challenge 与有效时间');
    }
    const profile = await this.subjectIdentity.getLocalProfile();
    const keys = await this.subjectIdentity.loadKeyMaterial();
    if (!profile || !keys || profile.keyId !== keys.keyId) {
      throw new Error('Digital Subject holder key 不可用');
    }
    if (input.credential.document.credentialSubject.id !== subjectId(profile.subjectId)) {
      throw new Error('委托凭证不属于当前 Digital Subject');
    }
    const expires = new Date(createdMs + OWNER_DELEGATION_PRESENTATION_TTL_MS).toISOString();
    const document: OwnerDelegationPresentationDocument = {
      '@context': [BASE_CONTEXT, DELEGATION_CONTEXT],
      type: ['VerifiablePresentation', OWNER_DELEGATION_PRESENTATION_TYPE],
      holder: { id: subjectId(profile.subjectId) },
      verifiableCredential: [{
        '@context': BASE_CONTEXT,
        id: `data:application/vc+jwt,${input.credential.compactJws}`,
        type: 'EnvelopedVerifiableCredential',
      }],
      challenge,
      audience,
      created: input.createdAt,
      expires,
    };
    const jose = await dynamicImport('jose');
    const signingKey = await jose.importPKCS8(keys.signPrivatePem, 'EdDSA');
    const compactJws = await new jose.CompactSign(Buffer.from(JSON.stringify(document), 'utf8'))
      .setProtectedHeader({
        alg: 'EdDSA',
        typ: 'vp+jwt',
        cty: 'vp',
        kid: subjectKeyId(profile.keyId),
      })
      .sign(signingKey);
    return { format: 'application/vp+jwt', document, compactJws };
  }

  async revoke(grantId: string, at: string): Promise<AuthorizationGrant> {
    if (!Number.isFinite(Date.parse(at))) throw new Error('Owner 委托撤销时间无效');
    const store = await this.grantStorePromise;
    const grant = await store.get(grantId);
    if (!grant || grant.origin.kind !== 'owner_delegation') {
      throw new Error('Owner 委托 Grant 不存在');
    }
    if (grant.status === 'revoked') return grant;
    const revoked: AuthorizationGrant = { ...grant, status: 'revoked', revokedAt: at };
    await store.put(revoked);
    return revoked;
  }
}

export async function verifyOwnerDelegationPresentation(input: {
  compactJws: string;
  expectedIssuerKey: OwnerDelegationIssuerPublicKey;
  expectedSubject: SubjectEndpointPublic | LocalEndpointProfile;
  expectedAudience: string;
  expectedChallenge: string;
  expectedPurpose: string;
  requiredActions: string[];
  now: string;
  currentGrant: AuthorizationGrant | null;
  currentOwnerIdentity: OwnerIdentityRecord | null;
  currentBinding: SubjectOwnerBinding | null;
}): Promise<OwnerDelegationVerification> {
  const reasons: string[] = [];
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) return { ok: false, reasons: ['verification_time_invalid'] };
  const jose = await dynamicImport('jose');
  let presentation: OwnerDelegationPresentationDocument | null = null;
  try {
    const key = await jose.importSPKI(spkiPem(input.expectedSubject.signPublicKey), 'EdDSA');
    const result = await jose.compactVerify(input.compactJws, key, { algorithms: ['EdDSA'] });
    if (
      result.protectedHeader.typ !== 'vp+jwt' ||
      result.protectedHeader.cty !== 'vp' ||
      result.protectedHeader.kid !== subjectKeyId(input.expectedSubject.keyId)
    ) reasons.push('presentation_header_invalid');
    presentation = parsePresentation(parseJsonObject(result.payload));
  } catch {
    reasons.push('presentation_signature_invalid');
  }
  if (!presentation) reasons.push('presentation_shape_invalid');
  if (!presentation) return { ok: false, reasons: [...new Set(reasons)] };

  if (presentation.holder.id !== subjectId(input.expectedSubject.subjectId)) reasons.push('holder_mismatch');
  if (presentation.audience !== input.expectedAudience) reasons.push('audience_mismatch');
  if (presentation.challenge !== input.expectedChallenge) reasons.push('challenge_mismatch');
  const createdMs = Date.parse(presentation.created);
  const expiresMs = Date.parse(presentation.expires);
  if (!Number.isFinite(createdMs) || !Number.isFinite(expiresMs) || expiresMs <= createdMs) {
    reasons.push('presentation_time_invalid');
  } else {
    if (createdMs > nowMs + 5 * 60 * 1000) reasons.push('presentation_not_yet_valid');
    if (expiresMs <= nowMs) reasons.push('presentation_expired');
  }

  const envelope = presentation.verifiableCredential[0]!;
  const credentialJws = envelope.id.slice('data:application/vc+jwt,'.length);
  let credential: OwnerDelegationCredentialDocument | null = null;
  try {
    const key = await jose.importSPKI(spkiPem(input.expectedIssuerKey.publicKeySpkiB64), 'EdDSA');
    const result = await jose.compactVerify(credentialJws, key, { algorithms: ['EdDSA'] });
    if (
      result.protectedHeader.typ !== 'vc+jwt' ||
      result.protectedHeader.cty !== 'vc' ||
      result.protectedHeader.kid !== input.expectedIssuerKey.id
    ) reasons.push('credential_header_invalid');
    credential = parseCredential(parseJsonObject(result.payload));
  } catch {
    reasons.push('credential_signature_invalid');
  }
  if (!credential) reasons.push('credential_shape_invalid');
  if (!credential) return { ok: false, reasons: [...new Set(reasons)] };

  if (credential.issuer.id !== input.expectedIssuerKey.controller) reasons.push('issuer_mismatch');
  if (credential.credentialSubject.id !== subjectId(input.expectedSubject.subjectId)) {
    reasons.push('credential_subject_mismatch');
  }
  if (
    credential.credentialSubject.holderBinding.keyId !== subjectKeyId(input.expectedSubject.keyId) ||
    credential.credentialSubject.holderBinding.publicKeySha256 !==
      sha256(Buffer.from(input.expectedSubject.signPublicKey, 'base64'))
  ) reasons.push('holder_key_binding_mismatch');
  if (credential.credentialSubject.delegation.purpose !== input.expectedPurpose) {
    reasons.push('purpose_mismatch');
  }
  const actionSet = new Set(credential.credentialSubject.delegation.actions);
  if (input.requiredActions.some((action) => !actionSet.has(action))) {
    reasons.push('required_action_missing');
  }
  const validFromMs = Date.parse(credential.validFrom);
  const validUntilMs = Date.parse(credential.validUntil);
  if (!Number.isFinite(validFromMs) || !Number.isFinite(validUntilMs) || validUntilMs <= validFromMs) {
    reasons.push('credential_time_invalid');
  } else {
    if (validFromMs > nowMs + 5 * 60 * 1000) reasons.push('credential_not_yet_valid');
    if (validUntilMs <= nowMs) reasons.push('credential_expired');
  }
  reasons.push(...matchingGrant(input.currentGrant, credential));

  const ownerIdentityId = input.currentGrant?.origin.kind === 'owner_delegation'
    ? input.currentGrant.origin.ownerIdentityId
    : null;
  const bindingId = input.currentGrant?.origin.kind === 'owner_delegation'
    ? input.currentGrant.origin.ownerSubjectBindingId
    : null;
  if (
    !input.currentOwnerIdentity || input.currentOwnerIdentity.revokedAt ||
    input.currentOwnerIdentity.id !== ownerIdentityId ||
    ownerId(input.currentOwnerIdentity.id) !== credential.issuer.id
  ) reasons.push('owner_identity_inactive');
  if (
    !input.currentBinding || input.currentBinding.revokedAt ||
    input.currentBinding.id !== bindingId ||
    input.currentBinding.ownerIdentityId !== ownerIdentityId ||
    subjectId(input.currentBinding.subjectId) !== credential.credentialSubject.id
  ) reasons.push('owner_subject_binding_inactive');
  if (input.currentOwnerIdentity && input.currentBinding && !input.currentBinding.revokedAt) {
    const scopedIdentity = Boolean(
      input.currentOwnerIdentity.organizationId || input.currentOwnerIdentity.tenantId,
    );
    if (
      (scopedIdentity && !input.currentBinding.authorityScope) ||
      input.currentBinding.authorityScope?.organizationId !== input.currentOwnerIdentity.organizationId ||
      input.currentBinding.authorityScope?.tenantId !== input.currentOwnerIdentity.tenantId
    ) reasons.push('owner_subject_authority_scope_inactive');
    if (
      (credential.credentialSubject.organizationId !== undefined &&
        credential.credentialSubject.organizationId !== input.currentOwnerIdentity.organizationId) ||
      (credential.credentialSubject.tenantId !== undefined &&
        credential.credentialSubject.tenantId !== input.currentOwnerIdentity.tenantId)
    ) reasons.push('authority_claim_mismatch');
  }

  return reasons.length
    ? { ok: false, reasons: [...new Set(reasons)] }
    : { ok: true, reasons: [], credential };
}
