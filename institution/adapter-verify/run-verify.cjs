#!/usr/bin/env node
/**
 * Slice C verification: Institution Adapter → existing Talk path (DigitalMeRuntime.talk)
 * for two Demo Telecom users, plus personal-mode regression and privacy checks.
 *
 * Does not launch Electron UI. Uses the same resolveTalkChat → chatComplete chain.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SPIKE_DIR = path.join(ROOT, 'institution', 'litellm-spike');
const BACKEND_DIR = path.join(ROOT, 'institution', 'backend');
const EVIDENCE_DIR = path.join(ROOT, 'build', 'evidence', 'institution-adapter-c');
const BACKEND_PORT = Number(process.env.INSTITUTION_BACKEND_PORT || 4100);
const BACKEND = `http://127.0.0.1:${BACKEND_PORT}`;

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

function redact(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.replace(/sk-[A-Za-z0-9_\-]{8,}/g, 'sk-[REDACTED]');
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

async function talkWithSession(session, text) {
  const { createDigitalMeRuntime } = require(path.join(ROOT, 'dist', 'runtime', 'digitalme-runtime'));
  const { createCommandBus } = require(path.join(ROOT, 'dist', 'runtime', 'command-bus'));
  const { providerCredentialKey } = require(path.join(ROOT, 'dist', 'infrastructure', 'secret-store'));
  const pkgParent = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-inst-c-pkg-'));
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
    displayName: `inst-${session.institutionUserId}`,
    targetDir,
  });
  try {
    const out = await bus.invoke('talk', { text });
    return { ok: true, view: out && out.view, pkgRoot: targetDir };
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
      kind: err && err.kind,
      status: err && err.status,
      pkgRoot: targetDir,
    };
  }
}

function personalModeRegression() {
  const adapterPath = path.join(ROOT, 'electron', 'institution-adapter.cjs');
  const mainPath = path.join(ROOT, 'electron', 'main.cjs');
  const adapterSrc = fs.readFileSync(adapterPath, 'utf8');
  const mainSrc = fs.readFileSync(mainPath, 'utf8');
  const checks = {
    adapterExists: fs.existsSync(adapterPath),
    personalSaveClearsInstitutionMode: /clearMode\(app\.getPath\("userData"\)\)/.test(mainSrc),
    connectInstitutionIpc: /shell:connectInstitution/.test(mainSrc),
    saveModelCredentialStillPresent: /shell:saveModelCredential/.test(mainSrc),
    adapterUsesExchangeOnly: /session\/exchange/.test(adapterSrc) && !/DEEPSEEK_API_KEY/.test(adapterSrc),
    noMasterKeyInAdapterApply: !/providerMasterKey:\s*session/.test(adapterSrc),
  };
  const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  return { checks, failed };
}

function institutionStorePrivacy() {
  const storeFile = path.join(BACKEND_DIR, 'data', 'store.json');
  if (!fs.existsSync(storeFile)) return { present: false };
  const raw = fs.readFileSync(storeFile, 'utf8');
  const forbidden = ['prompt', 'messages', 'response', 'digitalSelf', 'memory', 'conversation'];
  const hits = forbidden.filter((k) => new RegExp(`"${k}"\\s*:`).test(raw));
  const masterLeak = process.env.DEEPSEEK_API_KEY && raw.includes(process.env.DEEPSEEK_API_KEY);
  return { present: true, forbiddenHits: hits, masterLeak: Boolean(masterLeak) };
}

function mapBudgetFacing(message) {
  const { mapInstitutionError } = require(path.join(ROOT, 'electron', 'institution-adapter.cjs'));
  // mirror talk.js facingError budget branch
  if (/budget|max_budget|额度已用完|Budget has been exceeded|quota/i.test(message) || /\b429\b/.test(message)) {
    return '你的 AI 使用额度已用完。';
  }
  return mapInstitutionError({ message }) || null;
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  if (!fs.existsSync(path.join(ROOT, 'dist', 'runtime', 'digitalme-runtime.js'))) {
    const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, encoding: 'utf8', shell: true });
    if (build.status !== 0) fail('npm run build failed', build.stderr);
  }

  const report = {
    slice: 'C',
    name: '客户端 Institution Adapter（最薄）',
    startedAt: new Date().toISOString(),
    steps: {},
  };

  const personal = personalModeRegression();
  report.steps.personalModeRegression = personal;
  if (personal.failed.length) fail('personal mode regression checks failed', personal.failed);

  const proc = startBackend();
  try {
    await waitBackend();
    const boot = await httpJson('POST', `${BACKEND}/v0/admin/bootstrap`, { force: true });
    if (!boot.ok) fail('bootstrap failed', redact(boot.json));
    report.steps.bootstrap = { organization: boot.json.organization, users: boot.json.users };

    const { createInstitutionAdapter, writeMode, readMode, clearMode } = require(path.join(
      ROOT,
      'electron',
      'institution-adapter.cjs'
    ));
    const adapter = createInstitutionAdapter({ backendBaseUrl: BACKEND });

    const lowSession = await adapter.exchange({ institutionUserId: 'demo-user-low', assertion: 'mock' });
    const highSession = await adapter.exchange({ institutionUserId: 'demo-user-high', assertion: 'mock' });
    if (lowSession.credential.value === highSession.credential.value) {
      fail('users must not share the same credential');
    }
    if (process.env.DEEPSEEK_API_KEY) {
      const blob = JSON.stringify(lowSession) + JSON.stringify(highSession);
      if (blob.includes(process.env.DEEPSEEK_API_KEY)) fail('provider master key leaked into client session');
    }
    report.steps.exchange = {
      distinctCredentials: true,
      masterKeyAbsent: true,
      lowBudget: lowSession.entitlement && lowSession.entitlement.quotaAmount,
      highBudget: highSession.entitlement && highSession.entitlement.quotaAmount,
    };

    // Prove applyToCredentialStore + mode file for two profiles (no Electron safeStorage).
    const profileLow = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-inst-c-low-'));
    const profileHigh = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-inst-c-high-'));
    const fakeSave = async (input) => {
      const cfg = {
        providerPreset: input.providerPreset,
        providerId: input.providerId,
        baseUrl: input.baseUrl,
        model: input.model,
      };
      fs.writeFileSync(path.join(input._dir, 'model-config.json'), `${JSON.stringify(cfg, null, 2)}\n`);
      fs.writeFileSync(
        path.join(input._dir, 'virtual-key.meta.json'),
        `${JSON.stringify({ hasKey: Boolean(input.apiKey), keyPrefix: String(input.apiKey).slice(0, 6) }, null, 2)}\n`
      );
      return { ok: true };
    };
    await adapter.applyToCredentialStore((input) => fakeSave({ ...input, _dir: profileLow }), lowSession);
    writeMode(profileLow, {
      enabled: true,
      backendBaseUrl: BACKEND,
      institutionUserId: lowSession.institutionUserId,
      organizationName: 'Demo Telecom',
      model: lowSession.model,
      gatewayBaseUrl: lowSession.gatewayBaseUrl,
    });
    await adapter.applyToCredentialStore((input) => fakeSave({ ...input, _dir: profileHigh }), highSession);
    writeMode(profileHigh, {
      enabled: true,
      backendBaseUrl: BACKEND,
      institutionUserId: highSession.institutionUserId,
      organizationName: 'Demo Telecom',
      model: highSession.model,
      gatewayBaseUrl: highSession.gatewayBaseUrl,
    });
    const modeLow = readMode(profileLow);
    const modeHigh = readMode(profileHigh);
    if (!modeLow.enabled || !modeHigh.enabled) fail('institution mode not written');
    if (modeLow.institutionUserId === modeHigh.institutionUserId) fail('profiles must differ');
    clearMode(profileLow); // personal-path simulation on one profile
    if (readMode(profileLow).enabled) fail('clearMode failed');
    report.steps.profiles = {
      lowUser: 'demo-user-low',
      highUser: modeHigh.institutionUserId,
      personalClearWorks: true,
      modeFilesWritten: true,
    };

    const highTalk1 = await talkWithSession(highSession, '只用一个字回答：好');
    if (!highTalk1.ok) fail('high user Talk failed', redact(highTalk1));
    report.steps.highTalk1 = {
      ok: true,
      hasAssistant: !!(highTalk1.view && (highTalk1.view.assistantText || highTalk1.view.turns)),
      preview: redact(JSON.stringify(highTalk1.view || {})).slice(0, 300),
    };

    let lowRejected = false;
    const lowAttempts = [];
    for (let i = 0; i < 8; i++) {
      const attempt = await talkWithSession(lowSession, `只用一个字回答：好（${i}）`);
      lowAttempts.push({
        i,
        ok: attempt.ok,
        error: attempt.ok ? null : redact(attempt.error),
        facing: attempt.ok ? null : mapBudgetFacing(attempt.error || ''),
      });
      if (!attempt.ok) {
        lowRejected = true;
        if (mapBudgetFacing(attempt.error || '') !== '你的 AI 使用额度已用完。') {
          // still accept if raw contains budget and our mapper would show human text in UI via 429
          if (!/budget|429/i.test(attempt.error || '')) {
            fail('low user failure was not budget-related', attempt);
          }
        }
        break;
      }
    }
    report.steps.lowAttempts = lowAttempts;
    if (!lowRejected) fail('expected low user Talk to hit budget limit');

    const highTalk2 = await talkWithSession(highSession, '只用一个字回答：好');
    if (!highTalk2.ok) fail('high user Talk broken after low exhausted', redact(highTalk2));
    report.steps.highTalk2 = { ok: true };
    report.steps.isolationOk = true;

    const usage = await httpJson('GET', `${BACKEND}/v0/usage/summary`);
    report.steps.usageSummary = usage.json;
    const storePrivacy = institutionStorePrivacy();
    report.steps.institutionStorePrivacy = storePrivacy;
    if (storePrivacy.forbiddenHits && storePrivacy.forbiddenHits.length) {
      fail('institution store has forbidden fields', storePrivacy);
    }
    if (storePrivacy.masterLeak) fail('provider master key in institution store');

    report.verdict = 'INSTITUTION_DISTRIBUTION_V01_CLIENT_ADAPTER_ACCEPTED';
    report.finishedAt = new Date().toISOString();
    const out = path.join(EVIDENCE_DIR, 'report.json');
    fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({ verdict: report.verdict, evidence: out, isolationOk: true }, null, 2));
  } finally {
    proc.stop();
  }
}

main().catch((err) => {
  const payload = {
    verdict: 'INSTITUTION_DISTRIBUTION_V01_CLIENT_ADAPTER_FAIL',
    error: String(err && err.message ? err.message : err),
    detail: err && err.detail ? err.detail : undefined,
  };
  try {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'report.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch {
    // ignore
  }
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
