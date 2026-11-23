import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { createAesGcmCipherAdapter } from '../../infrastructure/secret-store';
import { InstitutionFederationService } from '../institution-federation';
import type {
  AuthorizationStart,
  InstitutionOidcAdapter,
} from '../openid-client-adapter';
import { validateInstitutionProvider } from '../openid-client-adapter';
import { OwnerIdentityStore } from '../owner-identity-store';
import type {
  InstitutionIdentityProvider,
  OidcAuthorizationTransaction,
  VerifiedFederatedIdentity,
} from '../types';

async function tempRoot(): Promise<string> {
  return fs.mkdtemp(path.join(tmpdir(), 'digitalme-identity-'));
}

const provider: InstitutionIdentityProvider = {
  id: 'local-keycloak',
  displayName: 'Local Keycloak',
  issuer: 'http://127.0.0.1:8080/realms/digitalme',
  clientId: 'digitalme-test',
  redirectUri: 'http://127.0.0.1:43119/callback',
  scopes: ['openid', 'email', 'phone'],
  clientAuthentication: { method: 'client_secret_basic', clientSecret: 'test-only' },
  securityProfile: 'oidc-code-pkce',
  allowInsecureLoopback: true,
};

class ProtocolFixture implements InstitutionOidcAdapter {
  readonly state = 'state-with-at-least-128-bits-of-test-entropy';
  completeCalls = 0;

  async startAuthorization(
    input: InstitutionIdentityProvider,
    now: string,
  ): Promise<AuthorizationStart> {
    const transaction: OidcAuthorizationTransaction = {
      providerId: input.id,
      state: this.state,
      nonce: 'nonce-with-at-least-128-bits-of-test-entropy',
      codeVerifier: 'verifier-with-at-least-128-bits-of-test-entropy',
      redirectUri: input.redirectUri,
      createdAt: now,
      expiresAt: new Date(Date.parse(now) + 600_000).toISOString(),
    };
    return {
      authorizationUrl: `${input.issuer}/protocol/openid-connect/auth?state=${this.state}`,
      transaction,
    };
  }

  async completeAuthorization(input: {
    provider: InstitutionIdentityProvider;
    callbackUrl: string;
    transaction: OidcAuthorizationTransaction;
    verifiedAt: string;
  }): Promise<VerifiedFederatedIdentity> {
    this.completeCalls += 1;
    assert.equal(new URL(input.callbackUrl).searchParams.get('state'), input.transaction.state);
    return {
      providerId: input.provider.id,
      issuer: input.provider.issuer,
      subject: 'kc-user-123',
      organizationId: 'org-bank-sandbox',
      acr: 'urn:test:loa:2',
      amr: ['pwd', 'otp'],
      email: 'owner@example.com',
      emailVerified: true,
      phoneNumber: '+8613800138000',
      phoneNumberVerified: true,
      grantedScopes: input.provider.scopes,
      verifiedAt: input.verifiedAt,
    };
  }
}

test('provider gate requires OIDC code + PKCE profile and secure non-loopback transport', () => {
  assert.doesNotThrow(() => validateInstitutionProvider(provider));
  const externalPublicClient: InstitutionIdentityProvider = {
    ...provider,
    id: 'duende-public-demo',
    issuer: 'https://demo.duendesoftware.com',
    clientId: 'interactive.public',
    clientAuthentication: { method: 'none' },
    allowInsecureLoopback: false,
    allowLoopbackRedirect: true,
  };
  assert.doesNotThrow(() => validateInstitutionProvider(externalPublicClient));
  assert.doesNotThrow(() =>
    validateInstitutionProvider({
      ...externalPublicClient,
      redirectUri: 'http://[::1]:43119/callback',
    }),
  );
  assert.throws(
    () => validateInstitutionProvider({ ...externalPublicClient, allowLoopbackRedirect: false }),
    /loopback HTTP/,
  );
  assert.throws(
    () =>
      validateInstitutionProvider({
        ...externalPublicClient,
        redirectUri: 'http://callback.example.com/oidc',
      }),
    /loopback HTTP/,
  );
  assert.throws(
    () => validateInstitutionProvider({ ...provider, issuer: 'http://idp.example.com' }),
    /身份源必须使用 HTTPS/,
  );
  assert.throws(
    () => validateInstitutionProvider({ ...provider, scopes: ['email'] }),
    /openid/,
  );
  assert.throws(
    () => validateInstitutionProvider({ ...provider, securityProfile: 'fapi2' }),
    /FAPI2_PROFILE_NOT_IMPLEMENTED/,
  );
});

test('transaction is encrypted, one-time, and produces Owner identity only', async () => {
  const root = await tempRoot();
  const fixture = new ProtocolFixture();
  const service = new InstitutionFederationService(
    root,
    createAesGcmCipherAdapter(Buffer.alloc(32, 19)),
    fixture,
  );
  const now = '2026-11-23T02:00:00.000Z';
  const url = await service.start(provider, now);
  assert.equal(new URL(url).searchParams.get('state'), fixture.state);
  const secretFile = await fs.readFile(
    path.join(root, 'identity', 'oidc-transactions.v1.json'),
    'utf8',
  );
  assert.doesNotMatch(secretFile, /verifier-with|nonce-with|state-with/);

  const callback = `${provider.redirectUri}?code=real-code-shape&state=${fixture.state}`;
  const identity = await service.complete({ provider, callbackUrl: callback, now });
  assert.equal(identity.subject, 'kc-user-123');
  assert.equal(identity.contact.emailHint, 'o***@example.com');
  assert.equal(identity.contact.phoneHint, '***8000');
  assert.equal(identity.contact.emailVerified, true);
  assert.equal(identity.contact.phoneVerified, true);
  assert.equal((await service.ownerIdentityStore().list()).bindings.length, 0);

  await assert.rejects(
    service.complete({ provider, callbackUrl: callback, now }),
    /已使用、已过期/,
  );
  assert.equal(fixture.completeCalls, 1);
});

test('institution login cannot silently become Subject authority; confirmation and revocation are explicit', async () => {
  const root = await tempRoot();
  const store = new OwnerIdentityStore(root);
  const verifiedAt = '2026-11-23T03:00:00.000Z';
  const identity = await store.recordVerifiedIdentity({
    providerId: provider.id,
    issuer: provider.issuer,
    subject: 'owner-456',
    amr: ['pwd'],
    email: 'person@example.com',
    emailVerified: true,
    phoneNumberVerified: false,
    grantedScopes: ['openid', 'email'],
    verifiedAt,
  });
  await assert.rejects(
    store.bindToSubject({
      ownerIdentityId: identity.id,
      subjectId: 'subject-a',
      confirmationRef: 'talk-turn-1',
      confirmed: false,
      at: verifiedAt,
    }),
    /不能自动授权/,
  );
  const binding = await store.bindToSubject({
    ownerIdentityId: identity.id,
    subjectId: 'subject-a',
    confirmationRef: 'talk-turn-2',
    confirmed: true,
    at: verifiedAt,
  });
  assert.equal(binding.subjectId, 'subject-a');
  assert.equal(await store.revokeIdentity(identity.id, '2026-11-23T04:00:00.000Z'), true);
  const listed = await store.list();
  assert.equal(listed.identities[0]?.revokedAt, '2026-11-23T04:00:00.000Z');
  assert.equal(listed.bindings[0]?.revokedAt, '2026-11-23T04:00:00.000Z');
  const reverified = await store.recordVerifiedIdentity({
    providerId: provider.id,
    issuer: provider.issuer,
    subject: 'owner-456',
    amr: ['pwd', 'otp'],
    emailVerified: true,
    phoneNumberVerified: false,
    grantedScopes: ['openid'],
    verifiedAt: '2026-11-23T05:00:00.000Z',
  });
  assert.equal(reverified.revokedAt, '2026-11-23T04:00:00.000Z');
  await assert.rejects(
    store.bindToSubject({
      ownerIdentityId: identity.id,
      subjectId: 'subject-b',
      confirmationRef: 'talk-turn-3',
      confirmed: true,
      at: '2026-11-23T05:00:00.000Z',
    }),
    /不可用/,
  );
  const raw = await fs.readFile(path.join(root, 'identity', 'owner-identities.json'), 'utf8');
  assert.doesNotMatch(raw, /person@example\.com/);
});
