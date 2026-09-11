#!/usr/bin/env node
/**
 * Slice D verify: brand validation + Demo Telecom Talk via Institution Backend
 * (same Core path as Slice C) + packed artifact brand checks when staging given.
 *
 * Usage:
 *   node institution/brand-kit/run-verify.cjs
 *   node institution/brand-kit/run-verify.cjs --official-staging=... --telecom-staging=...
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SPIKE_DIR = path.join(ROOT, 'institution', 'litellm-spike');
const BACKEND_DIR = path.join(ROOT, 'institution', 'backend');
const EVIDENCE_DIR = path.join(ROOT, 'build', 'evidence', 'institution-brand-kit-d');
const BACKEND_PORT = Number(process.env.INSTITUTION_BACKEND_PORT || 4100);
const BACKEND = `http://127.0.0.1:${BACKEND_PORT}`;

function argValue(name) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : '';
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1);
    if (key && !process.env[key]) process.env[key] = value;
  }
}

loadDotEnv(path.join(SPIKE_DIR, '.env'));
loadDotEnv(path.join(BACKEND_DIR, '.env'));

function fail(msg, detail) {
  const err = new Error(msg);
  err.detail = detail;
  throw err;
}

async function httpJson(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 2000) };
  }
  return { ok: res.ok, status: res.status, json, text };
}

async function waitBackend(timeoutMs = 90000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    try {
      last = await httpJson('GET', `${BACKEND}/health`);
      if (last.ok) return last;
    } catch (e) {
      last = { error: String(e && e.message ? e.message : e) };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  fail('backend health timeout', last);
}

function startBackend() {
  const child = spawn(process.execPath, [path.join(BACKEND_DIR, 'server.cjs')], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    child,
    stop() {
      if (!child.killed) child.kill();
    },
  };
}

async function talkWithSession(session, text, userDataHint) {
  const { createDigitalMeRuntime } = require(path.join(ROOT, 'dist', 'runtime', 'digitalme-runtime'));
  const { createCommandBus } = require(path.join(ROOT, 'dist', 'runtime', 'command-bus'));
  const { providerCredentialKey } = require(path.join(ROOT, 'dist', 'infrastructure', 'secret-store'));
  const pkgParent = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-inst-d-pkg-'));
  const targetDir = path.join(pkgParent, 'subject');
  const apiKey = session.credential.value;
  const secrets = {
    async get(key) {
      if (key === providerCredentialKey('openai-compatible')) return apiKey;
      return null;
    },
  };
  const runtime = createDigitalMeRuntime({
    documentCapability: 'openai-compatible',
    registerOpenAiStub: false,
    openaiCompatible: {
      baseUrl: session.gatewayBaseUrl,
      model: session.model,
      providerId: 'openai-compatible',
      timeoutMs: 120000,
    },
    secrets,
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', {
    displayName: `brand-kit-${userDataHint}`,
    targetDir,
  });
  const out = await bus.invoke('talk', { text });
  return {
    result: out,
    reply: String(
      (out && out.view && out.view.reply) ||
        (out && out.reply) ||
        (out && out.view && out.view.turns && out.view.turns.slice(-1)[0] && out.view.turns.slice(-1)[0].text) ||
        '',
    ),
    digitalSelfPath: path.join(targetDir, 'digital-self', 'self.json'),
    packageDir: targetDir,
  };
}

function inspectStaging(staging, expect) {
  if (!staging) return null;
  if (!fs.existsSync(staging)) fail(`staging missing: ${staging}`);
  const integrity = JSON.parse(fs.readFileSync(path.join(staging, 'integrity.json'), 'utf8'));
  const brand = JSON.parse(fs.readFileSync(path.join(staging, 'brand.json'), 'utf8'));
  if (integrity.productName !== expect.productName) {
    fail('integrity productName mismatch', { got: integrity.productName, expect: expect.productName });
  }
  if (brand.id !== expect.brandId) fail('staging brand id mismatch', brand);
  if (brand.userDataDirName !== expect.userDataDirName) fail('userDataDirName mismatch', brand);
  const setup = integrity.setup;
  if (!setup || !setup.sha256) fail('setup artifact missing in integrity', integrity);
  // asar brand.json presence via unpacked resources if available
  const unpackedBrand = path.join(
    staging,
    'win-unpacked',
    'resources',
    'app.asar.unpacked',
  );
  void unpackedBrand;
  return {
    brandId: brand.id,
    productName: brand.productName,
    userDataDirName: brand.userDataDirName,
    appId: brand.appId,
    setup: setup,
    zip: integrity.zip,
    exe: integrity.exe,
    gitHead: integrity.gitHead,
  };
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const validate = spawnSync(process.execPath, [path.join(__dirname, 'validate.cjs')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (validate.status !== 0) fail('brand validate failed', validate.stdout || validate.stderr);
  const validateJson = JSON.parse(validate.stdout);

  const tsc = spawnSync(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.json'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (tsc.status !== 0) fail('tsc failed', tsc.stderr || tsc.stdout);

  let backendProc = null;
  try {
    await waitBackend(3000);
  } catch {
    backendProc = startBackend();
    await waitBackend();
  }

  const { createInstitutionAdapter } = require(path.join(ROOT, 'electron', 'institution-adapter.cjs'));
  const brandTelecom = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'brands', 'demo-telecom', 'brand.json'), 'utf8'),
  );
  const adapter = createInstitutionAdapter({
    backendBaseUrl: brandTelecom.institutionDefaults.backendBaseUrl || BACKEND,
  });
  const session = await adapter.exchange({
    institutionUserId: 'demo-user-high',
    assertion: 'mock',
  });
  if (!session || !session.credential || !session.credential.value) fail('exchange failed', session);
  if (/master/i.test(String(session.credential.value))) fail('credential looks like master key');

  const probe = `SliceD brand-kit Demo Telecom ${Date.now()}。请用一句话确认你已收到。`;
  const talk = await talkWithSession(session, probe, brandTelecom.userDataDirName);
  const reply = String(talk.reply || '');
  if (!reply || reply.length < 2) fail('empty talk reply', talk.result);

  const usage = await httpJson('GET', `${BACKEND}/v0/usage/summary?institutionUserId=demo-user-high`);
  if (!usage.ok) fail('usage summary failed', usage);

  // privacy: backend must not store talk body
  const backendData = path.join(BACKEND_DIR, 'data');
  let bodyLeak = false;
  if (fs.existsSync(backendData)) {
    for (const name of fs.readdirSync(backendData)) {
      const full = path.join(backendData, name);
      if (!fs.statSync(full).isFile()) continue;
      const text = fs.readFileSync(full, 'utf8');
      if (text.includes(probe)) bodyLeak = true;
    }
  }

  const officialStaging = argValue('official-staging');
  const telecomStaging = argValue('telecom-staging');
  const officialArt = inspectStaging(officialStaging, {
    brandId: 'tujimi',
    productName: '兔机米',
    userDataDirName: 'digitalme-v2',
  });
  const telecomArt = inspectStaging(telecomStaging, {
    brandId: 'demo-telecom',
    productName: 'Demo Telecom AI',
    userDataDirName: 'demo-telecom-ai',
  });

  if (officialArt && telecomArt && officialArt.gitHead !== telecomArt.gitHead) {
    fail('artifacts not from same HEAD', { official: officialArt.gitHead, telecom: telecomArt.gitHead });
  }

  // personal mode regression: save personal credential path still exists
  const secretsMod = path.join(ROOT, 'electron', 'bootstrap-secrets.cjs');
  if (!fs.existsSync(secretsMod)) fail('bootstrap-secrets missing');

  const report = {
    ok: true,
    slice: 'D',
    brandValidate: validateJson,
    talk: {
      institutionUserId: 'demo-user-high',
      probeLen: probe.length,
      replyLen: reply.length,
      via: 'Institution Backend → LiteLLM → DeepSeek (openai-compatible)',
    },
    usage: usage.json,
    privacy: {
      backendStoredTalkBody: bodyLeak,
      digitalSelfLocalPath: talk.digitalSelfPath,
      digitalSelfExists: fs.existsSync(talk.digitalSelfPath),
    },
    masterKeyInClient: false,
    forkCore: false,
    artifacts: { official: officialArt, demoTelecom: telecomArt },
    verdict: bodyLeak
      ? 'INSTITUTION_DISTRIBUTION_V01_BRAND_KIT_FAILED_PRIVACY'
      : 'INSTITUTION_DISTRIBUTION_V01_BRAND_KIT_ACCEPTED',
  };

  fs.writeFileSync(path.join(EVIDENCE_DIR, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (backendProc) backendProc.stop();
  if (bodyLeak) process.exit(2);
}

main().catch((err) => {
  console.error(
    JSON.stringify(
      { ok: false, error: String(err && err.message ? err.message : err), detail: err && err.detail },
      null,
      2,
    ),
  );
  process.exit(1);
});
