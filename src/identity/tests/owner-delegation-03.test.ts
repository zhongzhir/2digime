import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { GrantStore } from '../../collaboration/grant-store';
import { createAesGcmCipherAdapter } from '../../infrastructure/secret-store';
import { CommIdentityStore } from '../../subject-comm/identity-store';
import type { LocalEndpointProfile } from '../../subject-comm/endpoint';
import {
  OwnerDelegationCredentialService,
  verifyOwnerDelegationPresentation,
  type SecuredOwnerDelegationCredential,
  type SecuredOwnerDelegationPresentation,
} from '../owner-delegation-credential';
import { OwnerIdentityStore } from '../owner-identity-store';
import type { OwnerIdentityRecord, SubjectOwnerBinding } from '../types';

const cipher = createAesGcmCipherAdapter(Buffer.alloc(32, 37));

async function tempRoot(name: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-owner-delegation-${name}-`));
}

interface Fixture {
  root: string;
  ownerStore: OwnerIdentityStore;
  service: OwnerDelegationCredentialService;
  profile: LocalEndpointProfile;
  identity: OwnerIdentityRecord;
  binding: SubjectOwnerBinding;
}

async function fixture(name: string): Promise<Fixture> {
  const root = await tempRoot(name);
  const ownerStore = new OwnerIdentityStore(root);
  const at = '2026-11-23T08:00:00.000Z';
  const identity = await ownerStore.recordVerifiedIdentity({
    providerId: 'institution-provider',
    issuer: 'https://identity.example.test',
    subject: 'external-owner-subject-must-not-be-disclosed',
    organizationId: 'bank-group-sandbox',
    tenantId: 'bank-tenant-sandbox',
    acr: 'urn:example:loa:2',
    amr: ['pwd', 'otp'],
    authenticatedAt: at,
    email: 'owner.private@example.test',
    emailVerified: true,
    phoneNumber: '+8613800001234',
    phoneNumberVerified: true,
    grantedScopes: ['openid', 'profile', 'email', 'phone'],
    verifiedAt: at,
  });
  const binding = await ownerStore.bindToSubject({
    ownerIdentityId: identity.id,
    subjectId: 'subject-owned-a',
    targetAuthority: {
      organizationId: 'bank-group-sandbox',
      tenantId: 'bank-tenant-sandbox',
    },
    confirmationRef: 'talk-owner-confirmation-1',
    confirmed: true,
    at,
  });
  const subjectIdentity = new CommIdentityStore(root, cipher);
  const { profile } = await subjectIdentity.ensureLocalEndpoint({
    subjectId: 'subject-owned-a',
    displayName: 'Owner 的兔机米',
    relayUrl: 'https://relay.example.test',
    endpointId: 'endpoint-owned-a',
  });
  return {
    root,
    ownerStore,
    service: new OwnerDelegationCredentialService(root, cipher),
    profile,
    identity,
    binding,
  };
}

async function issueAndPresent(f: Fixture, at = '2026-11-23T08:05:00.000Z'): Promise<{
  credential: SecuredOwnerDelegationCredential;
  presentation: SecuredOwnerDelegationPresentation;
}> {
  const credential = await f.service.issue({
    ownerIdentityId: f.identity.id,
    subjectId: f.profile.subjectId,
    actions: ['read_account_summary', 'submit_service_request'],
    resourceRefs: ['account:masked:001'],
    purpose: '查询脱敏账户摘要并提交一次服务请求',
    selectedClaims: ['tenant_id'],
    issuedAt: at,
    ttlMs: 30 * 60 * 1000,
  });
  const presentation = await f.service.present({
    credential,
    audience: 'https://service.example.test/verifier',
    challenge: 'challenge-128-bits-minimum-test-value',
    createdAt: new Date(Date.parse(at) + 60 * 1000).toISOString(),
  });
  return { credential, presentation };
}

async function verifyCurrent(input: {
  f: Fixture;
  credential: SecuredOwnerDelegationCredential;
  presentation: SecuredOwnerDelegationPresentation;
  issuerKey?: SecuredOwnerDelegationCredential['issuerKey'];
  expectedSubject?: LocalEndpointProfile;
  challenge?: string;
  now?: string;
}) {
  const listed = await input.f.ownerStore.list();
  return verifyOwnerDelegationPresentation({
    compactJws: input.presentation.compactJws,
    expectedIssuerKey: input.issuerKey || input.credential.issuerKey,
    expectedSubject: input.expectedSubject || input.f.profile,
    expectedAudience: 'https://service.example.test/verifier',
    expectedChallenge: input.challenge || 'challenge-128-bits-minimum-test-value',
    expectedPurpose: '查询脱敏账户摘要并提交一次服务请求',
    requiredActions: ['read_account_summary'],
    now: input.now || '2026-11-23T08:07:00.000Z',
    currentGrant: await (await GrantStore.open(input.f.root)).get(input.credential.grant.id),
    currentOwnerIdentity: listed.identities.find((item) => item.id === input.f.identity.id) || null,
    currentBinding: listed.bindings.find((item) => item.id === input.f.binding.id) || null,
  });
}

test('VC 2.0 委托凭证只披露明确选择的 authority claim，并由 Owner 与 Subject 双层签名绑定', async () => {
  const f = await fixture('minimal');
  const { credential, presentation } = await issueAndPresent(f);

  assert.equal(credential.format, 'application/vc+jwt');
  assert.equal(presentation.format, 'application/vp+jwt');
  assert.equal(credential.document.credentialSubject.tenantId, 'bank-tenant-sandbox');
  assert.equal(credential.document.credentialSubject.organizationId, undefined);
  assert.equal(credential.grant.grantee.kind, 'owned_subject');
  assert.equal(credential.grant.origin.kind, 'owner_delegation');

  const serialized = JSON.stringify({ credential: credential.document, presentation: presentation.document });
  assert.doesNotMatch(serialized, /owner\.private@example\.test/);
  assert.doesNotMatch(serialized, /13800001234/);
  assert.doesNotMatch(serialized, /external-owner-subject-must-not-be-disclosed/);
  assert.doesNotMatch(serialized, /urn:example:loa:2/);
  assert.doesNotMatch(serialized, /bank-group-sandbox/);

  const secretFile = await fs.readFile(
    path.join(f.root, 'identity', 'owner-delegation-secrets.v1.json'),
    'utf8',
  );
  assert.doesNotMatch(secretFile, /PRIVATE KEY/);
  assert.doesNotMatch(secretFile, /external-owner-subject/);

  const verified = await verifyCurrent({ f, credential, presentation });
  assert.equal(verified.ok, true, JSON.stringify(verified.reasons));

  const wrongChallenge = await verifyCurrent({
    f,
    credential,
    presentation,
    challenge: 'different-challenge',
  });
  assert.equal(wrongChallenge.ok, false);
  assert.ok(wrongChallenge.reasons.includes('challenge_mismatch'));

  const listed = await f.ownerStore.list();
  const missingAction = await verifyOwnerDelegationPresentation({
    compactJws: presentation.compactJws,
    expectedIssuerKey: credential.issuerKey,
    expectedSubject: f.profile,
    expectedAudience: 'https://service.example.test/verifier',
    expectedChallenge: 'challenge-128-bits-minimum-test-value',
    expectedPurpose: '查询脱敏账户摘要并提交一次服务请求',
    requiredActions: ['approve_funds_transfer'],
    now: '2026-11-23T08:07:00.000Z',
    currentGrant: await (await GrantStore.open(f.root)).get(credential.grant.id),
    currentOwnerIdentity: listed.identities.find((item) => item.id === f.identity.id) || null,
    currentBinding: listed.bindings.find((item) => item.id === f.binding.id) || null,
  });
  assert.equal(missingAction.ok, false);
  assert.ok(missingAction.reasons.includes('required_action_missing'));
});

test('撤销、过期、Owner identity 停用和 binding 停用均使委托凭证失效', async () => {
  const revokedFixture = await fixture('revoked');
  const revokedIssued = await issueAndPresent(revokedFixture);
  await revokedFixture.service.revoke(
    revokedIssued.credential.grant.id,
    '2026-11-23T08:08:00.000Z',
  );
  const revoked = await verifyCurrent({ f: revokedFixture, ...revokedIssued });
  assert.equal(revoked.ok, false);
  assert.ok(revoked.reasons.includes('grant_revoked'));

  const expiredFixture = await fixture('expired');
  const expiredIssued = await issueAndPresent(expiredFixture);
  const expired = await verifyCurrent({
    f: expiredFixture,
    ...expiredIssued,
    now: '2026-11-23T08:40:00.000Z',
  });
  assert.equal(expired.ok, false);
  assert.ok(expired.reasons.includes('presentation_expired'));
  assert.ok(expired.reasons.includes('credential_expired'));

  const identityFixture = await fixture('identity-disabled');
  const identityIssued = await issueAndPresent(identityFixture);
  await identityFixture.ownerStore.revokeIdentity(
    identityFixture.identity.id,
    '2026-11-23T08:08:00.000Z',
  );
  const identityDisabled = await verifyCurrent({ f: identityFixture, ...identityIssued });
  assert.equal(identityDisabled.ok, false);
  assert.ok(identityDisabled.reasons.includes('owner_identity_inactive'));
  assert.ok(identityDisabled.reasons.includes('owner_subject_binding_inactive'));

  const bindingFixture = await fixture('binding-disabled');
  const bindingIssued = await issueAndPresent(bindingFixture);
  await bindingFixture.ownerStore.revokeBinding(
    bindingFixture.binding.id,
    '2026-11-23T08:08:00.000Z',
  );
  const bindingDisabled = await verifyCurrent({ f: bindingFixture, ...bindingIssued });
  assert.equal(bindingDisabled.ok, false);
  assert.ok(bindingDisabled.reasons.includes('owner_subject_binding_inactive'));

  const tenantFixture = await fixture('tenant-changed');
  const tenantIssued = await issueAndPresent(tenantFixture);
  await tenantFixture.ownerStore.recordVerifiedIdentity({
    providerId: 'institution-provider',
    issuer: 'https://identity.example.test',
    subject: 'external-owner-subject-must-not-be-disclosed',
    organizationId: 'bank-group-sandbox',
    tenantId: 'bank-tenant-next',
    amr: ['pwd', 'otp'],
    emailVerified: false,
    phoneNumberVerified: false,
    grantedScopes: ['openid'],
    verifiedAt: '2026-11-23T08:08:00.000Z',
  });
  const tenantChanged = await verifyCurrent({ f: tenantFixture, ...tenantIssued });
  assert.equal(tenantChanged.ok, false);
  assert.ok(tenantChanged.reasons.includes('owner_subject_binding_inactive'));
  await assert.rejects(
    tenantFixture.service.issue({
      ownerIdentityId: tenantFixture.identity.id,
      subjectId: tenantFixture.profile.subjectId,
      actions: ['read_account_summary'],
      purpose: '旧租户绑定不得继承',
      issuedAt: '2026-11-23T08:09:00.000Z',
    }),
    /尚未有效绑定/,
  );
});

test('Owner 签名 key 轮换后旧凭证失效，重新签发的凭证通过', async () => {
  const f = await fixture('owner-key-rotation');
  const oldIssued = await issueAndPresent(f);
  const nextKey = await f.service.rotateIssuerKey(
    f.identity.id,
    '2026-11-23T08:10:00.000Z',
  );
  assert.notEqual(nextKey.id, oldIssued.credential.issuerKey.id);

  const oldAfterRotation = await verifyCurrent({
    f,
    ...oldIssued,
    issuerKey: nextKey,
  });
  assert.equal(oldAfterRotation.ok, false);
  assert.ok(oldAfterRotation.reasons.includes('credential_signature_invalid'));

  const newIssued = await issueAndPresent(f, '2026-11-23T08:11:00.000Z');
  assert.equal(newIssued.credential.issuerKey.id, nextKey.id);
  const renewed = await verifyCurrent({ f, ...newIssued, now: '2026-11-23T08:12:00.000Z' });
  assert.equal(renewed.ok, true, JSON.stringify(renewed.reasons));
});

test('Subject key/endpoint 替换不能继承旧 holder proof', async () => {
  const f = await fixture('subject-key-replacement');
  const issued = await issueAndPresent(f);
  const replacement = new CommIdentityStore(await tempRoot('replacement-profile'), cipher);
  const { profile } = await replacement.ensureLocalEndpoint({
    subjectId: f.profile.subjectId,
    displayName: '迁移后的兔机米',
    relayUrl: 'https://relay.example.test',
    endpointId: 'endpoint-owned-a-next',
  });
  const result = await verifyCurrent({ f, ...issued, expectedSubject: profile });
  assert.equal(result.ok, false);
  assert.ok(
    result.reasons.includes('presentation_signature_invalid') ||
      result.reasons.includes('holder_key_binding_mismatch'),
  );
});

test('没有显式 Owner→Subject binding 时不能签发，未选择的机构范围不进入凭证', async () => {
  const root = await tempRoot('no-binding');
  const ownerStore = new OwnerIdentityStore(root);
  const identity = await ownerStore.recordVerifiedIdentity({
    providerId: 'institution-provider',
    issuer: 'https://identity.example.test',
    subject: 'external-owner',
    amr: ['pwd'],
    emailVerified: false,
    phoneNumberVerified: false,
    grantedScopes: ['openid'],
    verifiedAt: '2026-11-23T08:00:00.000Z',
  });
  const subjectIdentity = new CommIdentityStore(root, cipher);
  await subjectIdentity.ensureLocalEndpoint({
    subjectId: 'subject-unbound',
    displayName: '未绑定兔机米',
    relayUrl: 'https://relay.example.test',
  });
  const service = new OwnerDelegationCredentialService(root, cipher);
  await assert.rejects(
    service.issue({
      ownerIdentityId: identity.id,
      subjectId: 'subject-unbound',
      actions: ['read_account_summary'],
      purpose: '查询脱敏摘要',
      issuedAt: '2026-11-23T08:05:00.000Z',
    }),
    /尚未有效绑定/,
  );
  await assert.rejects(
    service.issue({
      ownerIdentityId: identity.id,
      subjectId: 'subject-unbound',
      actions: ['read_account_summary'],
      purpose: '查询脱敏摘要',
      selectedClaims: ['tenant_id'],
      issuedAt: '2026-11-23T08:05:00.000Z',
    }),
    /尚未有效绑定|没有可披露/,
  );
});
