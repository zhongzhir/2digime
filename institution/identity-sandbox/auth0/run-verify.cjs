#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const CALLBACK = 'http://127.0.0.1:43120/callback';
const CALLBACK_PORT = 43120;
const EVIDENCE = path.join(
  ROOT,
  'build',
  'evidence',
  'institutional-subject-collaboration-01-slice2b-auth0',
);

function requiredEnvironment(name) {
  const value = (process.env[name] || '').trim();
  if (!value) throw new Error(`set ${name} before running the Auth0 developer gate`);
  return value;
}

function canonicalIssuer(value) {
  const issuer = new URL(value);
  if (issuer.protocol !== 'https:') throw new Error('Auth0 issuer must use HTTPS');
  if (issuer.username || issuer.password || issuer.search || issuer.hash) {
    throw new Error('Auth0 issuer must not contain credentials, query, or fragment');
  }
  if (issuer.pathname !== '/' && issuer.pathname !== '') {
    throw new Error('Auth0 issuer must be an origin URL');
  }
  issuer.pathname = '/';
  return issuer.href;
}

function startCallbackServer() {
  let resolveCallback;
  let rejectCallback;
  const callbackPromise = new Promise((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });
  const timeout = setTimeout(
    () => rejectCallback(new Error('Auth0 OIDC callback timed out after 5 minutes')),
    5 * 60_000,
  );
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', CALLBACK);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end('not found');
        return;
      }
      clearTimeout(timeout);
      resolveCallback(`${CALLBACK}${url.search}`);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('2digime Auth0 OIDC callback received. You may return to Codex.');
    } catch (error) {
      clearTimeout(timeout);
      rejectCallback(error);
      res.writeHead(500).end('callback failed');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(CALLBACK_PORT, '127.0.0.1', () =>
      resolve({
        server,
        callbackPromise,
        cancel: () => clearTimeout(timeout),
      }),
    );
  });
}

async function close(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}

async function main() {
  const issuer = canonicalIssuer(requiredEnvironment('DIGITALME_AUTH0_ISSUER'));
  const clientId = requiredEnvironment('DIGITALME_AUTH0_CLIENT_ID');
  let callback;
  let packageRoot;
  try {
    callback = await startCallbackServer();
    const {
      InstitutionFederationService,
    } = require(path.join(ROOT, 'dist', 'identity', 'institution-federation.js'));
    const {
      createAesGcmCipherAdapter,
    } = require(path.join(ROOT, 'dist', 'infrastructure', 'secret-store.js'));
    packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'digitalme-slice2b-auth0-'));
    const cipher = createAesGcmCipherAdapter(crypto.randomBytes(32));
    const provider = {
      id: 'auth0-owner-development',
      displayName: 'Owner-controlled Auth0 development tenant',
      issuer,
      clientId,
      redirectUri: CALLBACK,
      scopes: ['openid', 'profile', 'email'],
      clientAuthentication: { method: 'none' },
      securityProfile: 'oidc-code-pkce',
      allowLoopbackRedirect: true,
    };

    const startingService = new InstitutionFederationService(packageRoot, cipher);
    const authorizationUrl = await startingService.start(provider, new Date().toISOString());
    const parsedAuthorization = new URL(authorizationUrl);
    assert.equal(parsedAuthorization.origin, new URL(issuer).origin);
    assert.equal(parsedAuthorization.searchParams.get('client_id'), clientId);
    assert.equal(parsedAuthorization.searchParams.get('redirect_uri'), CALLBACK);
    assert.equal(parsedAuthorization.searchParams.get('response_type'), 'code');
    assert.equal(parsedAuthorization.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(parsedAuthorization.searchParams.get('code_challenge'));
    assert.ok(parsedAuthorization.searchParams.get('nonce'));
    assert.ok(parsedAuthorization.searchParams.get('state'));

    process.stdout.write(`AUTH0_AUTHORIZATION_URL=${authorizationUrl}\n`);
    process.stdout.write('AUTH0_WAITING_FOR_OWNER_LOGIN\n');
    const callbackUrl = await callback.callbackPromise;

    const completingService = new InstitutionFederationService(packageRoot, cipher);
    const identity = await completingService.complete({
      provider,
      callbackUrl,
      now: new Date().toISOString(),
    });
    assert.equal(identity.issuer, issuer);
    assert.ok(identity.subject);
    const beforeBinding = await completingService.ownerIdentityStore().list();
    assert.equal(beforeBinding.identities.length, 1);
    assert.equal(beforeBinding.bindings.length, 0);
    const binding = await completingService.ownerIdentityStore().bindToSubject({
      ownerIdentityId: identity.id,
      subjectId: 'subject-slice2b-auth0-development',
      confirmationRef: 'developer-auth0-explicit-confirmation',
      confirmed: true,
      at: new Date().toISOString(),
    });
    assert.equal(binding.subjectId, 'subject-slice2b-auth0-development');

    const rawFiles = fs
      .readdirSync(path.join(packageRoot, 'identity'))
      .map((name) => fs.readFileSync(path.join(packageRoot, 'identity', name), 'utf8'))
      .join('\n');
    assert.doesNotMatch(rawFiles, /access_token|refresh_token|id_token|code_verifier/i);

    fs.mkdirSync(EVIDENCE, { recursive: true });
    const report = {
      task: 'INSTITUTIONAL-SUBJECT-COLLABORATION-01',
      slice: '2B-owner-controlled-client',
      result: 'OWNER_CONTROLLED_AUTH0_OIDC_DEVELOPER_GATE_PASS',
      at: new Date().toISOString(),
      provider: {
        implementation: 'Auth0 development tenant',
        issuerOrigin: new URL(issuer).origin,
        clientIdFingerprint: crypto.createHash('sha256').update(clientId).digest('hex'),
        flow: 'authorization_code',
        pkce: 'S256',
        clientAuthentication: 'none',
        callback: CALLBACK,
      },
      identity: {
        stableIssuerSubjectPresent: Boolean(identity.issuer && identity.subject),
        persistedAcrossFreshServiceInstance: beforeBinding.identities.length === 1,
        rawContactStored: false,
      },
      binding: {
        initiallyAbsent: beforeBinding.bindings.length === 0,
        explicitConfirmationRequired: true,
        created: Boolean(binding.id),
      },
      externalImpact: {
        ownerControlledDevelopmentTenant: true,
        ownerControlledClient: true,
        syntheticIdentityOnly: true,
        realIdentityUsed: false,
        clientSecretReadOrStored: false,
        paymentMethodAdded: false,
        feeIncurred: false,
      },
      limitations: [
        'Auth0 development tenant, not a bank or telecom tenant',
        'synthetic account is not legal identity proof or KYC',
        'FAPI 2.0 PAR/private_key_jwt/DPoP or mTLS not implemented',
        'developer automation is not Owner acceptance or production readiness',
      ],
    };
    fs.writeFileSync(
      path.join(EVIDENCE, 'auth0-oidc-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    if (typeof callback?.cancel === 'function') callback.cancel();
    await close(callback?.server);
    if (packageRoot) fs.rmSync(packageRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
