#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const CALLBACK = 'http://127.0.0.1:43119/callback';
const ISSUER = 'http://127.0.0.1:18080';
const EVIDENCE = path.join(
  ROOT,
  'build',
  'evidence',
  'institutional-subject-collaboration-01-slice2',
);

function startCallbackServer() {
  let resolveCallback;
  let rejectCallback;
  const callbackPromise = new Promise((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', CALLBACK);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end('not found');
        return;
      }
      resolveCallback(`${CALLBACK}${url.search}`);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('2digime Slice 2 OIDC callback received.');
    } catch (error) {
      rejectCallback(error);
      res.writeHead(500).end('callback failed');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(43119, '127.0.0.1', () => resolve({ server, callbackPromise }));
  });
}

async function startProvider() {
  const { default: Provider } = await import('oidc-provider');
  const provider = new Provider(ISSUER, {
    clients: [
      {
        client_id: 'digitalme-slice2',
        client_secret: 'slice2-local-client-secret-not-for-production',
        redirect_uris: [CALLBACK],
        response_types: ['code'],
        grant_types: ['authorization_code'],
        token_endpoint_auth_method: 'client_secret_basic',
      },
    ],
    claims: {
      address: ['address'],
      email: ['email', 'email_verified'],
      openid: ['sub'],
      phone: ['phone_number', 'phone_number_verified'],
      profile: ['name', 'preferred_username'],
    },
    findAccount: async (_ctx, id) => ({
      accountId: id,
      async claims() {
        return {
          sub: id,
          name: 'Owner Sandbox',
          preferred_username: 'owner@example.test',
          email: 'owner@example.test',
          email_verified: true,
        };
      },
    }),
    pkce: {
      methods: ['S256'],
      required: () => true,
    },
    features: {
      devInteractions: { enabled: true },
    },
  });
  const server = provider.listen(18080, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return server;
}

async function close(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}

async function main() {
  const providerServer = await startProvider();
  let callbackServer;
  let callbackPromise;
  let browser;
  try {
    const {
      InstitutionFederationService,
    } = require(path.join(ROOT, 'dist', 'identity', 'institution-federation.js'));
    const {
      createAesGcmCipherAdapter,
    } = require(path.join(ROOT, 'dist', 'infrastructure', 'secret-store.js'));
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'digitalme-slice2-oidc-'));
    const service = new InstitutionFederationService(
      packageRoot,
      createAesGcmCipherAdapter(crypto.randomBytes(32)),
    );
    const provider = {
      id: 'oidc-provider-local-sandbox',
      displayName: 'Independent local OIDC provider',
      issuer: ISSUER,
      clientId: 'digitalme-slice2',
      redirectUri: CALLBACK,
      scopes: ['openid', 'profile', 'email'],
      clientAuthentication: {
        method: 'client_secret_basic',
        clientSecret: 'slice2-local-client-secret-not-for-production',
      },
      securityProfile: 'oidc-code-pkce',
      allowInsecureLoopback: true,
    };
    const authorizationUrl = await service.start(provider, new Date().toISOString());
    const parsedAuthorization = new URL(authorizationUrl);
    assert.equal(parsedAuthorization.searchParams.get('response_type'), 'code');
    assert.equal(parsedAuthorization.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(parsedAuthorization.searchParams.get('nonce'));
    assert.ok(parsedAuthorization.searchParams.get('state'));

    ({ server: callbackServer, callbackPromise } = await startCallbackServer());
    browser = await chromium.launch({
      headless: true,
      executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    });
    const page = await browser.newPage();
    await page.goto(authorizationUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('input[name="login"]').fill('owner@example.test');
    await page.locator('input[name="password"]').fill('slice2-owner-password');
    await page.locator('button[type="submit"]').click();
    await page.waitForLoadState('domcontentloaded');
    const consentPrompt = page.locator('input[name="prompt"][value="consent"]');
    if (await consentPrompt.count()) {
      await page.locator('button[type="submit"]').click();
    }
    const callbackUrl = await callbackPromise;
    const identity = await service.complete({
      provider,
      callbackUrl,
      now: new Date().toISOString(),
    });
    assert.equal(identity.issuer, ISSUER);
    assert.ok(identity.subject);
    assert.equal(identity.contact.emailVerified, true);
    assert.equal(identity.contact.emailHint, 'o***@example.test');
    const beforeBinding = await service.ownerIdentityStore().list();
    assert.equal(beforeBinding.bindings.length, 0);
    const binding = await service.ownerIdentityStore().bindToSubject({
      ownerIdentityId: identity.id,
      subjectId: 'subject-slice2-sandbox',
      confirmationRef: 'developer-e2e-explicit-confirmation',
      confirmed: true,
      at: new Date().toISOString(),
    });
    assert.equal(binding.subjectId, 'subject-slice2-sandbox');
    const rawFiles = fs
      .readdirSync(path.join(packageRoot, 'identity'))
      .map((name) => fs.readFileSync(path.join(packageRoot, 'identity', name), 'utf8'))
      .join('\n');
    assert.doesNotMatch(rawFiles, /slice2-local-client-secret|slice2-owner-password/);
    assert.doesNotMatch(rawFiles, /access_token|refresh_token|id_token/);

    fs.mkdirSync(EVIDENCE, { recursive: true });
    const report = {
      task: 'INSTITUTIONAL-SUBJECT-COLLABORATION-01',
      slice: '2A',
      result: 'REAL_OIDC_DEVELOPER_GATE_PASS',
      at: new Date().toISOString(),
      provider: {
        implementation: 'oidc-provider 9.15.1',
        issuer: ISSUER,
        flow: 'authorization_code',
        pkce: 'S256',
        clientAuthentication: 'client_secret_basic',
      },
      identity: {
        id: identity.id,
        issuer: identity.issuer,
        subjectPresent: Boolean(identity.subject),
        emailVerified: identity.contact.emailVerified,
      },
      binding: {
        initiallyAbsent: beforeBinding.bindings.length === 0,
        explicitConfirmationRequired: true,
        bindingId: binding.id,
      },
      limitations: [
        'local standards-conformant development identity provider, not a bank or telecom tenant',
        'FAPI 2.0 PAR/private_key_jwt/DPoP or mTLS not implemented',
        'no real Owner identity or institution data used',
      ],
    };
    fs.writeFileSync(
      path.join(EVIDENCE, 'local-oidc-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    if (browser) await browser.close();
    await close(callbackServer);
    await close(providerServer);
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
