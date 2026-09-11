#!/usr/bin/env node
/**
 * Slice B real verification:
 * bootstrap Demo Telecom → two users → exchange → real LiteLLM/DeepSeek → usage isolation → privacy.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const BACKEND_DIR = __dirname;
const SPIKE_DIR = path.join(__dirname, '..', 'litellm-spike');
const EVIDENCE_DIR = path.join(ROOT, 'build', 'evidence', 'institution-backend-b');
const BACKEND_PORT = Number(process.env.INSTITUTION_BACKEND_PORT || 4100);
const BACKEND = `http://127.0.0.1:${BACKEND_PORT}`;
const MARKER_A = `BACKEND_PRIVACY_A_${Date.now()}`;
const MARKER_B = `BACKEND_PRIVACY_B_${Date.now()}`;

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
  return text
    .replace(/sk-[A-Za-z0-9_\-]{8,}/g, 'sk-[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9_\-]+/gi, 'Bearer [REDACTED]');
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

async function waitBackend(timeoutMs = 60000) {
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
  fail('institution backend health timeout', last);
}

function startBackend() {
  const child = spawn(process.execPath, [path.join(BACKEND_DIR, 'server.cjs')], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => {
    out += d.toString('utf8');
  });
  child.stderr.on('data', (d) => {
    out += d.toString('utf8');
  });
  return {
    child,
    getOutput: () => out,
    stop() {
      if (!child.killed) child.kill();
    },
  };
}

async function chatViaGateway(gatewayBaseUrl, virtualKey, model, marker) {
  const res = await fetch(`${gatewayBaseUrl.replace(/\/+$/, '')}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${virtualKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: `Reply with exactly one word: OK. Marker=${marker}` }],
      max_tokens: 16,
      temperature: 0,
    }),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return {
    ok: res.ok,
    status: res.status,
    usage: json && json.usage ? json.usage : null,
    errorPreview: res.ok ? null : redact(text).slice(0, 500),
  };
}

function scanInstitutionStore(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const json = JSON.parse(raw);
  const forbiddenHits = [];
  const walk = (node, trail) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${trail}[${i}]`));
      return;
    }
    for (const [k, v] of Object.entries(node)) {
      if (
        [
          'prompt',
          'messages',
          'response',
          'digitalSelf',
          'memory',
          'conversation',
          'artifactContent',
          'providerMasterKey',
          'deepseekApiKey',
        ].includes(k)
      ) {
        forbiddenHits.push(`${trail}.${k}`);
      }
      walk(v, trail ? `${trail}.${k}` : k);
    }
  };
  walk(json, 'store');
  const masterLeak =
    process.env.DEEPSEEK_API_KEY && raw.includes(process.env.DEEPSEEK_API_KEY)
      ? true
      : false;
  return { forbiddenHits, masterLeak, bytes: raw.length };
}

function postgresPrivacy() {
  const counts = spawnSync(
    'docker',
    [
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
      '-t',
      '-A',
      '-F',
      '|',
      '-c',
      `SELECT COUNT(*)::int, COUNT(*) FILTER (WHERE messages IS NOT NULL AND messages::text NOT IN ('null','{}','[]'))::int, COUNT(*) FILTER (WHERE response IS NOT NULL AND response::text NOT IN ('null','{}','[]'))::int, COUNT(*) FILTER (WHERE proxy_server_request IS NOT NULL AND proxy_server_request::text NOT IN ('null','{}','[]'))::int FROM "LiteLLM_SpendLogs";`,
    ],
    { cwd: SPIKE_DIR, encoding: 'utf8', env: process.env }
  );
  const markers = spawnSync(
    'docker',
    [
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
      '-t',
      '-A',
      '-c',
      `SELECT COUNT(*)::int FROM "LiteLLM_SpendLogs" WHERE COALESCE(messages::text,'') || COALESCE(response::text,'') || COALESCE(proxy_server_request::text,'') || COALESCE(metadata::text,'') LIKE '%BACKEND_PRIVACY_%';`,
    ],
    { cwd: SPIKE_DIR, encoding: 'utf8', env: process.env }
  );
  return {
    counts: {
      status: counts.status,
      stdout: (counts.stdout || '').trim(),
      stderr: (counts.stderr || '').trim().slice(0, 500),
    },
    markers: {
      status: markers.status,
      stdout: (markers.stdout || '').trim(),
      stderr: (markers.stderr || '').trim().slice(0, 500),
    },
  };
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const report = {
    slice: 'B',
    name: '最小 Institution Backend',
    startedAt: new Date().toISOString(),
    steps: {},
  };

  const proc = startBackend();
  try {
    await waitBackend();
    report.steps.backendHealthy = true;

    const boot = await httpJson('POST', `${BACKEND}/v0/admin/bootstrap`, { force: true });
    if (!boot.ok) fail('bootstrap failed', redact(boot.json));
    report.steps.bootstrap = {
      organization: boot.json.organization,
      users: boot.json.users,
    };

    const org = await httpJson('GET', `${BACKEND}/v0/organization`);
    if (!org.ok) fail('organization failed', org.json);

    const exLow = await httpJson('POST', `${BACKEND}/v0/session/exchange`, {
      institutionUserId: 'demo-user-low',
      assertion: 'mock',
    });
    const exHigh = await httpJson('POST', `${BACKEND}/v0/session/exchange`, {
      institutionUserId: 'demo-user-high',
      assertion: 'mock',
    });
    if (!exLow.ok || !exHigh.ok) fail('session/exchange failed', { low: redact(exLow.json), high: redact(exHigh.json) });
    if (exLow.json.providerMasterKey || exHigh.json.providerMasterKey) {
      fail('session/exchange returned providerMasterKey');
    }
    if (process.env.DEEPSEEK_API_KEY) {
      const blob = JSON.stringify(exLow.json) + JSON.stringify(exHigh.json);
      if (blob.includes(process.env.DEEPSEEK_API_KEY)) fail('provider master key leaked in exchange response');
    }
    if (exLow.json.credential.value === exHigh.json.credential.value) {
      fail('users must receive distinct virtual keys');
    }
    report.steps.exchange = {
      lowModel: exLow.json.model,
      highModel: exHigh.json.model,
      lowBudget: exLow.json.entitlement && exLow.json.entitlement.quotaAmount,
      highBudget: exHigh.json.entitlement && exHigh.json.entitlement.quotaAmount,
      distinctKeys: true,
      masterKeyAbsent: true,
    };

    const highFirst = await chatViaGateway(
      exHigh.json.gatewayBaseUrl,
      exHigh.json.credential.value,
      exHigh.json.model,
      MARKER_B
    );
    if (!highFirst.ok) fail('high user real chat failed', highFirst);
    report.steps.highFirst = highFirst;

    const lowAttempts = [];
    let lowRejected = false;
    for (let i = 0; i < 12; i++) {
      const attempt = await chatViaGateway(
        exLow.json.gatewayBaseUrl,
        exLow.json.credential.value,
        exLow.json.model,
        MARKER_A
      );
      lowAttempts.push({ i, ok: attempt.ok, status: attempt.status, usage: attempt.usage, errorPreview: attempt.errorPreview });
      if (!attempt.ok) {
        lowRejected = true;
        break;
      }
    }
    report.steps.lowAttempts = lowAttempts;
    if (!lowRejected) fail('expected low entitlement to be rejected by LiteLLM budget', lowAttempts);

    const highAfter = await chatViaGateway(
      exHigh.json.gatewayBaseUrl,
      exHigh.json.credential.value,
      exHigh.json.model,
      MARKER_B
    );
    if (!highAfter.ok) fail('high user affected by low entitlement exhaustion', highAfter);
    report.steps.highAfter = highAfter;
    report.steps.isolationOk = true;

    const usage = await httpJson('GET', `${BACKEND}/v0/usage/summary`);
    if (!usage.ok) fail('usage/summary failed', usage.json);
    report.steps.usageSummary = usage.json;

    const entLow = await httpJson('GET', `${BACKEND}/v0/entitlement?institutionUserId=demo-user-low`);
    const entHigh = await httpJson('GET', `${BACKEND}/v0/entitlement?institutionUserId=demo-user-high`);
    report.steps.entitlements = {
      low: entLow.json,
      high: entHigh.json,
      groupsDiffer:
        entLow.json &&
        entHigh.json &&
        entLow.json.entitlementGroup !== entHigh.json.entitlementGroup,
    };
    if (!report.steps.entitlements.groupsDiffer) fail('entitlement groups must differ');

    const dataFile =
      process.env.INSTITUTION_DATA_FILE || path.join(BACKEND_DIR, 'data', 'store.json');
    const storeScan = scanInstitutionStore(dataFile);
    report.steps.institutionStorePrivacy = storeScan;
    if (storeScan.forbiddenHits.length) fail('forbidden fields in institution store', storeScan.forbiddenHits);
    if (storeScan.masterLeak) fail('provider master key found in institution store');

    const pg = postgresPrivacy();
    report.steps.litellmPrivacy = pg;
    if (pg.counts.status !== 0 || pg.markers.status !== 0) fail('postgres privacy query failed', pg);
    const nums = String(pg.counts.stdout || '')
      .split('|')
      .map((p) => Number(String(p).trim()));
    report.steps.litellmBodyCounts = {
      rows: nums[0],
      messagesNonempty: nums[1],
      responseNonempty: nums[2],
      proxyReqNonempty: nums[3],
    };
    if (nums[1] > 0 || nums[2] > 0 || nums[3] > 0) {
      fail('LiteLLM spend logs contain message/response bodies', report.steps.litellmBodyCounts);
    }
    const markerHits = Number(String(pg.markers.stdout || '').trim());
    report.steps.litellmMarkerHits = markerHits;
    if (!Number.isFinite(markerHits) || markerHits !== 0) {
      fail('expected zero privacy marker hits in LiteLLM DB', { markerHits, pg });
    }

    report.verdict = 'INSTITUTION_DISTRIBUTION_V01_BACKEND_ACCEPTED';
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
    verdict: 'INSTITUTION_DISTRIBUTION_V01_BACKEND_FAIL',
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
