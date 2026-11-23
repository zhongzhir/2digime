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
const ISSUER = 'https://demo.duendesoftware.com';
const CLIENT_ID = 'interactive.public';
const EVIDENCE = path.join(
  ROOT,
  'build',
  'evidence',
  'institutional-subject-collaboration-01-slice2b',
);

function startCallbackServer() {
  let resolveCallback;
  let rejectCallback;
  let redirectUri = '';
  const callbackPromise = new Promise((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });
  const timeout = setTimeout(
    () => rejectCallback(new Error('external OIDC callback timed out')),
    90_000,
  );
  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url || '/', redirectUri);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end('not found');
        return;
      }
      clearTimeout(timeout);
      resolveCallback(`${redirectUri}${url.search}`);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('2digime Slice 2B external OIDC callback received.');
    } catch (error) {
      clearTimeout(timeout);
      rejectCallback(error);
      res.writeHead(500).end('callback failed');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('callback server did not expose a TCP port'));
        return;
      }
      redirectUri = `http://127.0.0.1:${address.port}/callback`;
      resolve({
        server,
        callbackPromise,
        redirectUri,
        cancel: () => clearTimeout(timeout),
      });
    });
  });
}

async function close(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}

async function launchBrowser() {
  const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  return chromium.launch({
    headless: true,
    ...(fs.existsSync(edge) ? { executablePath: edge } : {}),
  });
}

async function completeDemoLogin(page, authorizationUrl, username, password) {
  await page.goto(authorizationUrl, { waitUntil: 'domcontentloaded' });
  const usernameInput = page
    .locator(
      'input[name="Input.Username"], input[name="Username"], input[name="username"], input[name="login"]',
    )
    .first();
  const passwordInput = page
    .locator('input[name="Input.Password"], input[name="Password"], input[name="password"]')
    .first();
  try {
    await usernameInput.waitFor({ state: 'visible', timeout: 15_000 });
  } catch (error) {
    const title = await page.title().catch(() => '');
    const body = await page.locator('body').innerText().catch(() => '');
    throw new Error(
      `external OIDC login form unavailable; url=${page.url()} title=${title} body=${body
        .replace(/\s+/g, ' ')
        .slice(0, 500)}`,
      { cause: error },
    );
  }
  await usernameInput.fill(username);
  await passwordInput.fill(password);
  await page
    .locator(
      'button[name="Input.Button"][value="login"], button[name="button"][value="login"], button[type="submit"], input[type="submit"]',
    )
    .first()
    .click();
  await page.waitForTimeout(750);
  const consent = page
    .locator(
      'button[name="button"][value="yes"], button[value="yes"], input[name="button"][value="yes"]',
    )
    .first();
  if (await consent.isVisible().catch(() => false)) await consent.click();
}

async function main() {
  const username = process.env.DIGITALME_DUENDE_DEMO_USER || '';
  const password = process.env.DIGITALME_DUENDE_DEMO_PASSWORD || '';
  if (!username || !password) {
    throw new Error(
      'set DIGITALME_DUENDE_DEMO_USER and DIGITALME_DUENDE_DEMO_PASSWORD to the public demo credentials documented by Duende',
    );
  }

  let callbackServer;
  let callback;
  let browser;
  let packageRoot;
  try {
    callback = await startCallbackServer();
    callbackServer = callback.server;
    const {
      InstitutionFederationService,
    } = require(path.join(ROOT, 'dist', 'identity', 'institution-federation.js'));
    const {
      createAesGcmCipherAdapter,
    } = require(path.join(ROOT, 'dist', 'infrastructure', 'secret-store.js'));
    packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'digitalme-slice2b-oidc-'));
    const cipher = createAesGcmCipherAdapter(crypto.randomBytes(32));
    const provider = {
      id: 'duende-public-demo',
      displayName: 'Duende public demo IdentityServer',
      issuer: ISSUER,
      clientId: CLIENT_ID,
      redirectUri: callback.redirectUri,
      scopes: ['openid', 'profile', 'email'],
      clientAuthentication: { method: 'none' },
      securityProfile: 'oidc-code-pkce',
      allowLoopbackRedirect: true,
    };

    const startingService = new InstitutionFederationService(packageRoot, cipher);
    const authorizationUrl = await startingService.start(provider, new Date().toISOString());
    const parsedAuthorization = new URL(authorizationUrl);
    assert.equal(parsedAuthorization.origin, ISSUER);
    assert.equal(parsedAuthorization.searchParams.get('client_id'), CLIENT_ID);
    assert.equal(parsedAuthorization.searchParams.get('response_type'), 'code');
    assert.equal(parsedAuthorization.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(parsedAuthorization.searchParams.get('nonce'));
    assert.ok(parsedAuthorization.searchParams.get('state'));

    browser = await launchBrowser();
    const page = await browser.newPage();
    await completeDemoLogin(page, authorizationUrl, username, password);
    const callbackUrl = await callback.callbackPromise;

    const completingService = new InstitutionFederationService(packageRoot, cipher);
    const identity = await completingService.complete({
      provider,
      callbackUrl,
      now: new Date().toISOString(),
    });
    assert.equal(identity.issuer, ISSUER);
    assert.ok(identity.subject);
    const beforeBinding = await completingService.ownerIdentityStore().list();
    assert.equal(beforeBinding.identities.length, 1);
    assert.equal(beforeBinding.bindings.length, 0);
    const binding = await completingService.ownerIdentityStore().bindToSubject({
      ownerIdentityId: identity.id,
      subjectId: 'subject-slice2b-demo',
      confirmationRef: 'developer-external-oidc-explicit-confirmation',
      confirmed: true,
      at: new Date().toISOString(),
    });
    assert.equal(binding.subjectId, 'subject-slice2b-demo');

    const rawFiles = fs
      .readdirSync(path.join(packageRoot, 'identity'))
      .map((name) => fs.readFileSync(path.join(packageRoot, 'identity', name), 'utf8'))
      .join('\n');
    assert.doesNotMatch(rawFiles, /access_token|refresh_token|id_token|code_verifier/i);
    assert.equal(rawFiles.includes(password), false);

    fs.mkdirSync(EVIDENCE, { recursive: true });
    const report = {
      task: 'INSTITUTIONAL-SUBJECT-COLLABORATION-01',
      slice: '2B',
      result: 'REAL_EXTERNAL_OIDC_DEVELOPER_GATE_PASS',
      at: new Date().toISOString(),
      provider: {
        implementation: 'Duende public demo IdentityServer',
        issuer: ISSUER,
        clientId: CLIENT_ID,
        flow: 'authorization_code',
        pkce: 'S256',
        clientAuthentication: 'none',
        callback: 'ephemeral loopback',
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
        accountCreated: false,
        realIdentityUsed: false,
        paymentMethodAdded: false,
        feeIncurred: false,
      },
      limitations: [
        'public demo identity source, not a bank or telecom tenant',
        'public demo account is not legal identity proof or KYC',
        'FAPI 2.0 PAR/private_key_jwt/DPoP or mTLS not implemented',
        'developer automation is not Owner acceptance or production readiness',
      ],
    };
    fs.writeFileSync(
      path.join(EVIDENCE, 'external-oidc-report.json'),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    if (browser) await browser.close();
    if (typeof callback?.cancel === 'function') callback.cancel();
    await close(callbackServer);
    if (packageRoot) fs.rmSync(packageRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
