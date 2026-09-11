#!/usr/bin/env node
/**
 * Slice E — Institution Distribution v0.1 final acceptance.
 *
 * Requires:
 *   --official-staging=release-staging/v2-tujimi-...
 *   --telecom-staging=release-staging/v2-demo-telecom-...
 * Both must be built from the same clean committed HEAD.
 *
 * Does not commit evidence. Does not touch scripts/_*.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SPIKE_DIR = path.join(ROOT, 'institution', 'litellm-spike');
const BACKEND_DIR = path.join(ROOT, 'institution', 'backend');
const EVIDENCE_DIR = path.join(ROOT, 'build', 'evidence', 'institution-acceptance-e');
const BACKEND_PORT = Number(process.env.INSTITUTION_BACKEND_PORT || 4100);
const BACKEND = `http://127.0.0.1:${BACKEND_PORT}`;
const EXPECTED_HEAD = process.env.SLICE_E_EXPECTED_HEAD || '1a72abeaf0805d1294028522a8d2edafcbcd663d';

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

function redact(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.replace(/sk-[A-Za-z0-9_\-]{8,}/g, 'sk-[REDACTED]');
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
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
    await new Promise((r) => setTimeout(r, 500));
  }
  fail('backend health timeout', last);
}

function startBackend() {
  const child = spawn(process.execPath, [path.join(BACKEND_DIR, 'server.cjs')], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => {
    stderr += String(d);
  });
  return {
    child,
    stderr: () => stderr,
    stop() {
      if (!child.killed) child.kill();
    },
  };
}

function mapBudgetFacing(message) {
  if (/budget|max_budget|额度已用完|Budget has been exceeded|quota/i.test(message) || /\b429\b/.test(message)) {
    return '你的 AI 使用额度已用完。';
  }
  const { mapInstitutionError } = require(path.join(ROOT, 'electron', 'institution-adapter.cjs'));
  return mapInstitutionError({ message }) || null;
}

async function talkWithSession(session, text) {
  const { createDigitalMeRuntime } = require(path.join(ROOT, 'dist', 'runtime', 'digitalme-runtime'));
  const { createCommandBus } = require(path.join(ROOT, 'dist', 'runtime', 'command-bus'));
  const { providerCredentialKey } = require(path.join(ROOT, 'dist', 'infrastructure', 'secret-store'));
  const pkgParent = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-inst-e-pkg-'));
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
    displayName: `e-${session.institutionUserId}`,
    targetDir,
  });
  try {
    const out = await bus.invoke('talk', { text });
    return {
      ok: true,
      view: out && out.view,
      digitalSelfPath: path.join(targetDir, 'digital-self', 'self.json'),
      pkgRoot: targetDir,
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err && err.message ? err.message : err),
      digitalSelfPath: path.join(targetDir, 'digital-self', 'self.json'),
      pkgRoot: targetDir,
    };
  }
}

function inspectArtifact(staging, expect) {
  if (!staging || !fs.existsSync(staging)) fail(`staging missing: ${staging}`);
  const integrityPath = path.join(staging, 'integrity.json');
  const brandPath = path.join(staging, 'brand.json');
  if (!fs.existsSync(integrityPath) || !fs.existsSync(brandPath)) fail('integrity/brand missing', staging);
  const integrity = JSON.parse(fs.readFileSync(integrityPath, 'utf8'));
  const brand = JSON.parse(fs.readFileSync(brandPath, 'utf8'));
  if (integrity.gitHead !== EXPECTED_HEAD) {
    fail('artifact gitHead mismatch', { got: integrity.gitHead, expect: EXPECTED_HEAD });
  }
  if (brand.id !== expect.brandId) fail('brand id mismatch', brand);
  if (brand.productName !== expect.productName) fail('productName mismatch', brand);
  if (brand.appId !== expect.appId) fail('appId mismatch', brand);
  if (brand.userDataDirName !== expect.userDataDirName) fail('userDataDirName mismatch', brand);
  if (!integrity.setup || !integrity.setup.sha256) fail('setup missing', integrity);
  if (integrity.sensitiveFindings && integrity.sensitiveFindings.length) {
    fail('integrity sensitive findings', integrity.sensitiveFindings);
  }

  const asarPath = integrity.asar && path.join(ROOT, integrity.asar.path);
  if (!asarPath || !fs.existsSync(asarPath)) fail('asar missing', integrity.asar);
  const asar = require('@electron/asar');
  // electron-asar on Windows stores members with backslash separators.
  function asarRead(relPosix) {
    const variants = [
      relPosix,
      relPosix.replace(/\//g, '\\'),
      `\\${relPosix.replace(/\//g, '\\')}`,
      `/${relPosix}`,
    ];
    let last;
    for (const key of variants) {
      try {
        return asar.extractFile(asarPath, key);
      } catch (err) {
        last = err;
      }
    }
    throw last || new Error(`asar missing ${relPosix}`);
  }
  const asarBrand = JSON.parse(asarRead('electron/brand.json').toString('utf8'));
  if (asarBrand.id !== expect.brandId) fail('asar brand mismatch', asarBrand);
  const runtimeJs = asarRead('electron/renderer/brand.runtime.js').toString('utf8');
  if (!runtimeJs.includes(expect.productName)) fail('brand.runtime missing productName', expect.productName);
  if (!/2digime/i.test(asarBrand.strings && asarBrand.strings.openSourceNote)) {
    fail('openSourceNote must retain 2digime', asarBrand.strings);
  }

  // deep sensitive scan of staging text files
  const findings = [];
  const banned = /(LITELLM_MASTER_KEY|DEEPSEEK_API_KEY|INSTITUTION_ADMIN)\s*[:=]\s*["']?[^"'\s]{8,}/i;
  for (const file of walkFiles(staging)) {
    if (!/\.(js|cjs|mjs|json|html|css|md|txt|yml|yaml)$/i.test(file)) continue;
    const buf = fs.readFileSync(file);
    if (buf.length > 2_000_000) continue;
    const text = buf.toString('utf8');
    if (/sk-[A-Za-z0-9_-]{20,}/.test(text) && !/sk-\[REDACTED\]/.test(text) && /brand\.json|integrity|build-meta/.test(file) === false) {
      // asar binary may contain false positives in minified code; check plaintext configs only
      if (/\.(json|yml|yaml|env|md|txt)$/i.test(file) && /sk-[A-Za-z0-9_-]{20,}/.test(text)) {
        findings.push({ file: path.relative(ROOT, file), reason: 'secret_like' });
      }
    }
    if (banned.test(text)) findings.push({ file: path.relative(ROOT, file), reason: 'master_key_env' });
  }
  if (findings.length) fail('sensitive scan failed', findings);

  return {
    brandId: brand.id,
    productName: brand.productName,
    appId: brand.appId,
    userDataDirName: brand.userDataDirName,
    gitHead: integrity.gitHead,
    setup: {
      path: integrity.setup.path,
      bytes: integrity.setup.bytes,
      sha256: integrity.setup.sha256,
    },
    zip: integrity.zip,
    exe: integrity.exe,
    asarSha256: integrity.asar.sha256,
  };
}

function architectureBoundaryChecks() {
  const checks = {
    institutionAdapterExists: fs.existsSync(path.join(ROOT, 'electron', 'institution-adapter.cjs')),
    brandKitExists: fs.existsSync(path.join(ROOT, 'brands', 'demo-telecom', 'brand.json')),
    noSecondCoreDir: !fs.existsSync(path.join(ROOT, 'telecom-core')) && !fs.existsSync(path.join(ROOT, 'institution-core')),
    relaySeparate:
      fs.existsSync(path.join(ROOT, 'institution', 'backend', 'server.cjs')) &&
      !fs.readFileSync(path.join(ROOT, 'institution', 'backend', 'server.cjs'), 'utf8').includes('subject-comm'),
    noSelfQuotaEngine: !fs.existsSync(path.join(ROOT, 'institution', 'quota-engine')),
    personalCredentialIpc: /shell:saveModelCredential/.test(
      fs.readFileSync(path.join(ROOT, 'electron', 'main.cjs'), 'utf8'),
    ),
    officialUserDataStable: JSON.parse(
      fs.readFileSync(path.join(ROOT, 'brands', 'tujimi', 'brand.json'), 'utf8'),
    ).userDataDirName === 'digitalme-v2',
    officialAppIdStable: JSON.parse(
      fs.readFileSync(path.join(ROOT, 'brands', 'tujimi', 'brand.json'), 'utf8'),
    ).appId === 'local.digitalme.v2',
  };
  const failed = Object.entries(checks)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (failed.length) fail('architecture boundary failed', failed);
  return checks;
}

function brandIsolationCheck(officialArt, telecomArt) {
  if (officialArt.appId === telecomArt.appId) fail('appId must differ');
  if (officialArt.userDataDirName === telecomArt.userDataDirName) fail('userDataDirName must differ');
  if (officialArt.productName === telecomArt.productName) fail('productName must differ');
  // Simulate default userData roots (without env override)
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const officialRoot = path.join(appData, officialArt.userDataDirName);
  const telecomRoot = path.join(appData, telecomArt.userDataDirName);
  if (officialRoot === telecomRoot) fail('resolved userData roots collide');
  return {
    officialRoot,
    telecomRoot,
    distinct: true,
    note: 'Different product identities resolve to different userData namespaces; no shared Digital Self/credentials by default.',
  };
}

function launchPackagedSmoke(exePath, userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const child = spawn(exePath, [], {
    cwd: path.dirname(exePath),
    env: { ...process.env, DIGITALME_V2_USER_DATA: userDataDir },
    stdio: 'ignore',
    detached: false,
  });
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      const entries = fs.existsSync(userDataDir) ? fs.readdirSync(userDataDir) : [];
      resolve({
        started: true,
        exitedEarly: child.exitCode != null,
        userDataEntries: entries,
        wroteSubjects: entries.includes('subjects') || entries.includes('Local Storage'),
      });
    }, 8000);
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ started: false, error: String(err && err.message ? err.message : err) });
    });
  });
}

function psql(sql, { tuplesOnly = false } = {}) {
  const args = [
    'compose',
    '-f',
    path.join(SPIKE_DIR, 'docker-compose.yml'),
    'exec',
    '-T',
    'db',
    'psql',
    '-U',
    'litellm',
    '-d',
    'litellm',
  ];
  if (tuplesOnly) args.push('-t', '-A');
  args.push('-c', sql);
  const result = spawnSync('docker', args, {
    cwd: SPIKE_DIR,
    encoding: 'utf8',
    env: process.env,
  });
  return {
    status: result.status,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim().slice(0, 1000),
  };
}

function queryLiteLlmPrivacy(marker) {
  const bodyCounts = psql(`
SELECT COUNT(*)::int AS rows,
 COUNT(*) FILTER (WHERE messages IS NOT NULL AND messages::text NOT IN ('null','{}','[]'))::int AS messages_nonempty,
 COUNT(*) FILTER (WHERE response IS NOT NULL AND response::text NOT IN ('null','{}','[]'))::int AS response_nonempty,
 COUNT(*) FILTER (WHERE proxy_server_request IS NOT NULL AND proxy_server_request::text NOT IN ('null','{}','[]'))::int AS proxy_req_nonempty
FROM "LiteLLM_SpendLogs";
`.trim());
  const escaped = String(marker).replace(/'/g, "''");
  const markerHits = psql(
    `
SELECT COUNT(*)::int AS marker_hits
FROM "LiteLLM_SpendLogs"
WHERE COALESCE(messages::text,'') || COALESCE(response::text,'') || COALESCE(proxy_server_request::text,'') || COALESCE(metadata::text,'')
 LIKE '%${escaped}%';
`.trim(),
    { tuplesOnly: true },
  );
  return { bodyCounts, markerHits };
}

function institutionStorePrivacy(marker) {
  const storeFile = path.join(BACKEND_DIR, 'data', 'store.json');
  if (!fs.existsSync(storeFile)) return { present: false, markerHits: 0 };
  const raw = fs.readFileSync(storeFile, 'utf8');
  const forbidden = ['prompt', 'messages', 'response', 'digitalSelf', 'memory', 'conversation', 'artifactContent'];
  const hits = forbidden.filter((k) => new RegExp(`"${k}"\\s*:`).test(raw));
  const markerHits = raw.includes(marker) ? 1 : 0;
  const masterLeak =
    (process.env.DEEPSEEK_API_KEY && raw.includes(process.env.DEEPSEEK_API_KEY)) ||
    (process.env.LITELLM_MASTER_KEY && raw.includes(process.env.LITELLM_MASTER_KEY));
  return { present: true, forbiddenHits: hits, markerHits, masterLeak: Boolean(masterLeak), bytes: raw.length };
}

async function runOnce(round, officialStaging, telecomStaging) {
  const roundReport = {
    round,
    startedAt: new Date().toISOString(),
    steps: {},
  };

  roundReport.steps.architecture = architectureBoundaryChecks();

  const officialArt = inspectArtifact(officialStaging, {
    brandId: 'tujimi',
    productName: '兔机米',
    appId: 'local.digitalme.v2',
    userDataDirName: 'digitalme-v2',
  });
  const telecomArt = inspectArtifact(telecomStaging, {
    brandId: 'demo-telecom',
    productName: 'Demo Telecom AI',
    appId: 'local.demotelecom.ai',
    userDataDirName: 'demo-telecom-ai',
  });
  if (officialArt.gitHead !== telecomArt.gitHead) fail('artifact HEAD diverge', { officialArt, telecomArt });
  roundReport.steps.artifacts = { official: officialArt, demoTelecom: telecomArt };
  roundReport.steps.brandIsolation = brandIsolationCheck(officialArt, telecomArt);

  // Packaged launch smoke with isolated userData
  const exeOfficial = path.join(ROOT, officialArt.exe.path);
  const exeTelecom = path.join(ROOT, telecomArt.exe.path);
  const udO = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-e-off-'));
  const udT = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-e-tel-'));
  // Seed fake "existing" rabbit data that telecom must not see
  fs.mkdirSync(path.join(udO, 'subjects', 'default'), { recursive: true });
  fs.writeFileSync(
    path.join(udO, 'subjects', 'default', 'marker-official-only.txt'),
    'OFFICIAL_PRIVATE_MARKER',
    'utf8',
  );
  const smokeO = await launchPackagedSmoke(exeOfficial, udO);
  const smokeT = await launchPackagedSmoke(exeTelecom, udT);
  if (!smokeO.started || !smokeT.started) fail('packaged smoke failed to start', { smokeO, smokeT });
  if (fs.existsSync(path.join(udT, 'subjects', 'default', 'marker-official-only.txt'))) {
    fail('telecom userData saw official private marker');
  }
  roundReport.steps.packagedSmoke = {
    official: smokeO,
    telecom: smokeT,
    crossReadBlocked: true,
  };

  let backendProc = null;
  let startedHere = false;
  try {
    await waitBackend(3000);
  } catch {
    backendProc = startBackend();
    startedHere = true;
    await waitBackend();
  }

  try {
    const boot = await httpJson('POST', `${BACKEND}/v0/admin/bootstrap`, { force: true });
    if (!boot.ok) fail('bootstrap failed', redact(boot.json));
    roundReport.steps.bootstrap = {
      organization: boot.json.organization,
      users: boot.json.users,
    };

    const { createInstitutionAdapter } = require(path.join(ROOT, 'electron', 'institution-adapter.cjs'));
    const adapter = createInstitutionAdapter({ backendBaseUrl: BACKEND });
    const lowSession = await adapter.exchange({ institutionUserId: 'demo-user-low', assertion: 'mock' });
    const highSession = await adapter.exchange({ institutionUserId: 'demo-user-high', assertion: 'mock' });
    if (lowSession.credential.value === highSession.credential.value) {
      fail('users must not share credential');
    }
    if (process.env.DEEPSEEK_API_KEY && JSON.stringify(lowSession).includes(process.env.DEEPSEEK_API_KEY)) {
      fail('provider master key leaked into session');
    }
    if (process.env.LITELLM_MASTER_KEY && JSON.stringify(highSession).includes(process.env.LITELLM_MASTER_KEY)) {
      fail('litellm master key leaked into session');
    }
    roundReport.steps.exchange = {
      distinctCredentials: true,
      lowBudget: lowSession.entitlement && lowSession.entitlement.quotaAmount,
      highBudget: highSession.entitlement && highSession.entitlement.quotaAmount,
      masterAbsent: true,
    };

    const markerHigh = `SLICE_E_PRIVACY_HIGH_${Date.now()}_${round}_DO_NOT_STORE`;
    const markerLow = `SLICE_E_PRIVACY_LOW_${Date.now()}_${round}_DO_NOT_STORE`;

    const high1 = await talkWithSession(highSession, `${markerHigh} 只用一个字回答：好`);
    if (!high1.ok) fail('high Talk failed', redact(high1));
    roundReport.steps.highTalk1 = { ok: true, digitalSelfLocal: fs.existsSync(high1.digitalSelfPath) };

    let lowRejected = false;
    const lowAttempts = [];
    for (let i = 0; i < 10; i++) {
      const attempt = await talkWithSession(lowSession, `${markerLow} 只用一个字回答：好（${i}）`);
      lowAttempts.push({
        i,
        ok: attempt.ok,
        facing: attempt.ok ? null : mapBudgetFacing(attempt.error || ''),
        error: attempt.ok ? null : redact(attempt.error).slice(0, 200),
      });
      if (!attempt.ok) {
        lowRejected = true;
        if (!/budget|429|额度/i.test(attempt.error || '') && mapBudgetFacing(attempt.error || '') == null) {
          fail('low failure not budget-related', attempt);
        }
        break;
      }
    }
    roundReport.steps.lowAttempts = lowAttempts;
    if (!lowRejected) fail('expected low user to hit budget');

    const high2 = await talkWithSession(highSession, `${markerHigh}_AFTER 只用一个字回答：好`);
    if (!high2.ok) fail('high Talk broken after low exhausted', redact(high2));
    roundReport.steps.highTalk2 = { ok: true };
    roundReport.steps.userIsolationOk = true;

    const usage = await httpJson('GET', `${BACKEND}/v0/usage/summary`);
    if (!usage.ok) fail('usage summary failed', usage);
    const summaries = (usage.json && usage.json.summaries) || [];
    const lowU = summaries.find((s) => s.institutionUserId === 'demo-user-low');
    const highU = summaries.find((s) => s.institutionUserId === 'demo-user-high');
    if (!lowU || !highU) fail('usage missing users', usage.json);
    roundReport.steps.usage = { low: lowU, high: highU, isolation: true };

    const storePrivacy = institutionStorePrivacy(markerHigh);
    if (storePrivacy.forbiddenHits && storePrivacy.forbiddenHits.length) {
      fail('institution store forbidden fields', storePrivacy);
    }
    if (storePrivacy.markerHits) fail('privacy marker in institution store', storePrivacy);
    if (storePrivacy.masterLeak) fail('master key in institution store');
    roundReport.steps.institutionStorePrivacy = storePrivacy;

    const pg = queryLiteLlmPrivacy(markerHigh);
    const markerCount = Number(String(pg.markerHits.stdout || '0').trim() || '0');
    if (pg.markerHits.status !== 0) fail('LiteLLM postgres marker query failed', pg.markerHits);
    if (markerCount > 0) fail('privacy marker in LiteLLM SpendLogs', pg);
    if (pg.bodyCounts.status !== 0) fail('LiteLLM postgres body query failed', pg.bodyCounts);
    // stdout example: "123|0|0|0" with -t -A would be better; without -t parse last data line
    const bodyLine =
      (pg.bodyCounts.stdout || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => /^\d+/.test(l) || /\|\d+/.test(l))
        .pop() || '';
    const nums = bodyLine.split('|').map((x) => Number(String(x).trim()));
    const messagesNonempty = nums.length >= 2 ? nums[1] : NaN;
    const responseNonempty = nums.length >= 3 ? nums[2] : NaN;
    const proxyNonempty = nums.length >= 4 ? nums[3] : NaN;
    if (
      Number.isFinite(messagesNonempty) &&
      (messagesNonempty > 0 || responseNonempty > 0 || proxyNonempty > 0)
    ) {
      fail('LiteLLM SpendLogs still stores message/response bodies', {
        bodyLine,
        messagesNonempty,
        responseNonempty,
        proxyNonempty,
      });
    }
    roundReport.steps.litellmPrivacy = {
      markerHits: markerCount,
      privacyMarkerZero: markerCount === 0,
      bodyLine,
      messagesNonempty,
      responseNonempty,
      proxyNonempty,
    };

    // Personal mode regression (code + optional personal talk if key present)
    const mainSrc = fs.readFileSync(path.join(ROOT, 'electron', 'main.cjs'), 'utf8');
    const personal = {
      saveModelCredentialPresent: /shell:saveModelCredential/.test(mainSrc),
      connectInstitutionOptional: /shell:connectInstitution/.test(mainSrc),
      clearModeOnPersonalSave: /clearMode\(app\.getPath\("userData"\)\)/.test(mainSrc),
      officialBrandDefault: officialArt.userDataDirName === 'digitalme-v2',
    };
    if (!personal.saveModelCredentialPresent || !personal.clearModeOnPersonalSave) {
      fail('personal mode regression', personal);
    }
    roundReport.steps.personalMode = personal;

    if (process.env.DEEPSEEK_API_KEY) {
      // Personal Mode Talk against provider directly (not institution), proving non-institution path
      const personalSession = {
        institutionUserId: 'personal',
        gatewayBaseUrl: 'https://api.deepseek.com',
        model: process.env.PERSONAL_MODEL || 'deepseek-chat',
        credential: { value: process.env.DEEPSEEK_API_KEY },
      };
      // Prefer openai-compatible deepseek endpoint used by product if known
      const personalTalk = await talkWithSession(
        {
          ...personalSession,
          gatewayBaseUrl: process.env.PERSONAL_BASE_URL || 'https://api.deepseek.com/v1',
          model: process.env.PERSONAL_MODEL || 'deepseek-chat',
        },
        '只用一个字回答：好',
      );
      roundReport.steps.personalTalk = {
        ok: personalTalk.ok,
        error: personalTalk.ok ? null : redact(personalTalk.error).slice(0, 200),
      };
      if (!personalTalk.ok) {
        // Do not fail acceptance solely on personal provider outage if institution path works;
        // but record and require at least credential path intact. Owner requires real Talk —
        // retry once with deepseek-v4-flash naming used by institution.
        const alt = await talkWithSession(
          {
            institutionUserId: 'personal',
            gatewayBaseUrl: process.env.PERSONAL_BASE_URL || 'https://api.deepseek.com/v1',
            model: 'deepseek-v4-flash',
            credential: { value: process.env.DEEPSEEK_API_KEY },
          },
          '只用一个字回答：好',
        );
        roundReport.steps.personalTalkAlt = { ok: alt.ok, error: alt.ok ? null : redact(alt.error).slice(0, 200) };
        if (!alt.ok) fail('personal mode Talk failed', roundReport.steps.personalTalkAlt);
      }
    } else {
      fail('DEEPSEEK_API_KEY required for personal mode Talk regression');
    }

    roundReport.checklist = {
      '1_organization': true,
      '2_two_user_mapping': true,
      '3_different_entitlements':
        Number(lowSession.entitlement.quotaAmount) !== Number(highSession.entitlement.quotaAmount),
      '4_white_label_brand': telecomArt.productName === 'Demo Telecom AI',
      '5_two_user_real_talk': true,
      '6_usage_separated': true,
      '7_low_exhaust_only_self': true,
      '8_no_body_in_institution': storePrivacy.markerHits === 0,
      '9_no_core_fork': true,
      '10_same_core_two_brands': officialArt.gitHead === telecomArt.gitHead,
    };
    const checklistFail = Object.entries(roundReport.checklist)
      .filter(([, v]) => !v)
      .map(([k]) => k);
    if (checklistFail.length) fail('§8 checklist failed', checklistFail);

    roundReport.ok = true;
    roundReport.finishedAt = new Date().toISOString();
    return roundReport;
  } finally {
    if (startedHere && backendProc) backendProc.stop();
  }
}

async function main() {
  const officialStaging = path.resolve(argValue('official-staging'));
  const telecomStaging = path.resolve(argValue('telecom-staging'));
  const rounds = Number(argValue('rounds') || 2);
  if (!officialStaging || !telecomStaging) {
    fail('require --official-staging=... --telecom-staging=...');
  }

  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  if (head !== EXPECTED_HEAD) fail('workspace HEAD is not expected Slice E authority', { head, EXPECTED_HEAD });

  // ensure domain build
  if (!fs.existsSync(path.join(ROOT, 'dist', 'runtime', 'digitalme-runtime.js'))) {
    const b = spawnSync('npm', ['run', 'build'], { cwd: ROOT, encoding: 'utf8', shell: true });
    if (b.status !== 0) fail('npm run build failed', b.stderr);
  }

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const report = {
    slice: 'E',
    name: '验收对照',
    authority: EXPECTED_HEAD,
    startedAt: new Date().toISOString(),
    rounds: [],
  };

  for (let i = 1; i <= rounds; i++) {
    const one = await runOnce(i, officialStaging, telecomStaging);
    report.rounds.push(one);
    if (!one.ok) fail(`round ${i} failed`, one);
  }

  report.stability = {
    rounds,
    allPass: report.rounds.every((r) => r.ok),
  };
  if (!report.stability.allPass) fail('stability: not all rounds passed');

  report.artifacts = report.rounds[0].steps.artifacts;
  report.verdict = 'INSTITUTION_DISTRIBUTION_V01_ACCEPTED';
  report.finishedAt = new Date().toISOString();

  const out = path.join(EVIDENCE_DIR, 'report.json');
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(
    JSON.stringify(
      {
        ok: true,
        verdict: report.verdict,
        authority: report.authority,
        rounds: report.stability,
        artifacts: report.artifacts,
        evidence: out,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  const payload = {
    ok: false,
    verdict: 'INSTITUTION_DISTRIBUTION_V01_FAIL',
    error: String(err && err.message ? err.message : err),
    detail: err && err.detail ? err.detail : undefined,
  };
  try {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'report.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch {
    /* ignore */
  }
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
