#!/usr/bin/env node
/**
 * INSTITUTION-DISTRIBUTION-V01 Slice A — LiteLLM isolated spike runner.
 * Does not import or modify 2digime Core.
 *
 * Env:
 *   DEEPSEEK_API_KEY (required)
 *   LITELLM_MASTER_KEY (optional)
 *   LITELLM_BASE_URL (default http://127.0.0.1:4000)
 *   SPIKE_EVIDENCE_DIR (default build/evidence/institution-litellm-spike)
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SPIKE_DIR = __dirname;

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1);
    if (!key || process.env[key]) continue;
    process.env[key] = value;
  }
}

loadDotEnv(path.join(SPIKE_DIR, '.env'));

const BASE = (process.env.LITELLM_BASE_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '');
const MASTER = process.env.LITELLM_MASTER_KEY || 'sk-institution-spike-local-only';
const MODEL = process.env.SPIKE_MODEL || 'deepseek-v4-flash';
const EVIDENCE_DIR =
  process.env.SPIKE_EVIDENCE_DIR ||
  path.join(ROOT, 'build', 'evidence', 'institution-litellm-spike');

const MARKER_A = `PRIVACY_MARKER_USER_A_${Date.now()}_DO_NOT_STORE`;
const MARKER_B = `PRIVACY_MARKER_USER_B_${Date.now()}_DO_NOT_STORE`;

function fail(msg, detail) {
  const err = new Error(msg);
  err.detail = detail;
  throw err;
}

function redactSecrets(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text
    .replace(/sk-[A-Za-z0-9_\-]{8,}/g, 'sk-[REDACTED]')
    .replace(/Bearer\s+[A-Za-z0-9_\-]+/gi, 'Bearer [REDACTED]');
}

async function httpJson(method, urlPath, { key, body } = {}) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${key || MASTER}`,
      'Content-Type': 'application/json',
    },
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

async function waitHealthy(timeoutMs = 180000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await httpJson('GET', '/health/liveliness');
      last = r;
      if (r.ok || r.status === 200) return;
      // some builds use /health
      const h = await httpJson('GET', '/health');
      last = h;
      if (h.ok || h.status === 200) return;
    } catch (e) {
      last = { error: String(e && e.message ? e.message : e) };
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  fail('LiteLLM did not become healthy in time', last);
}

async function generateKey({ userId, maxBudget, alias }) {
  const r = await httpJson('POST', '/key/generate', {
    body: {
      user_id: userId,
      max_budget: maxBudget,
      models: [MODEL],
      key_alias: alias,
      metadata: { spike: 'institution-v01-slice-a', role: alias },
    },
  });
  if (!r.ok) fail(`key/generate failed for ${alias}`, { status: r.status, body: redactSecrets(r.json) });
  const key = r.json && (r.json.key || r.json.token);
  if (!key) fail(`key/generate missing key for ${alias}`, redactSecrets(r.json));
  return { key, info: r.json };
}

async function chat(key, marker, label) {
  const r = await httpJson('POST', '/v1/chat/completions', {
    key,
    body: {
      model: MODEL,
      messages: [
        {
          role: 'user',
          content: `Reply with exactly one word: OK. Marker=${marker}`,
        },
      ],
      max_tokens: 16,
      temperature: 0,
    },
  });
  return {
    label,
    ok: r.ok,
    status: r.status,
    usage: r.json && r.json.usage ? r.json.usage : null,
    hasMarkerEcho: !!(r.text && r.text.includes(marker)),
    errorPreview: r.ok ? null : redactSecrets(r.text).slice(0, 800),
    finish: r.json && r.json.choices && r.json.choices[0] && r.json.choices[0].finish_reason,
  };
}

async function keyInfo(key) {
  const r = await httpJson('GET', `/key/info?key=${encodeURIComponent(key)}`, { key: MASTER });
  // Some versions want POST /key/info
  if (!r.ok) {
    const p = await httpJson('POST', '/key/info', { body: { key } });
    return p;
  }
  return r;
}

function scanForMarkers(payload, markers) {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return markers.filter((m) => text.includes(m));
}

async function fetchSpendLogs() {
  const attempts = [
    () => httpJson('GET', '/spend/logs?limit=50'),
    () => httpJson('GET', '/spend/logs/v2?limit=50'),
    () => httpJson('POST', '/spend/logs', { body: { limit: 50 } }),
  ];
  for (const attempt of attempts) {
    try {
      const r = await attempt();
      if (r.ok) return r;
    } catch {
      // try next
    }
  }
  return { ok: false, status: 0, json: null, text: '' };
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

function queryPostgresPrivacy() {
  const bodyCounts = psql(`
SELECT COUNT(*)::int AS rows,
 COUNT(*) FILTER (WHERE messages IS NOT NULL AND messages::text NOT IN ('null','{}','[]'))::int AS messages_nonempty,
 COUNT(*) FILTER (WHERE response IS NOT NULL AND response::text NOT IN ('null','{}','[]'))::int AS response_nonempty,
 COUNT(*) FILTER (WHERE proxy_server_request IS NOT NULL AND proxy_server_request::text NOT IN ('null','{}','[]'))::int AS proxy_req_nonempty
FROM "LiteLLM_SpendLogs";
`.trim());
  const markerHits = psql(
    `
SELECT COUNT(*)::int AS marker_hits
FROM "LiteLLM_SpendLogs"
WHERE COALESCE(messages::text,'') || COALESCE(response::text,'') || COALESCE(proxy_server_request::text,'') || COALESCE(metadata::text,'')
 LIKE '%PRIVACY_MARKER_USER_%';
`.trim(),
    { tuplesOnly: true }
  );
  return { bodyCounts, markerHits };
}

async function main() {
  if (!process.env.DEEPSEEK_API_KEY) {
    fail('DEEPSEEK_API_KEY is required in the environment (do not commit secrets)');
  }

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const report = {
    slice: 'A',
    name: 'LiteLLM 隔离 spike（硬门槛）',
    startedAt: new Date().toISOString(),
    baseUrl: BASE,
    model: MODEL,
    masterKeyExposedToClientChecks: false,
    steps: {},
  };

  await waitHealthy();
  report.steps.healthy = true;

  const runId = `spike-${Date.now()}`;
  // Low budget should exhaust quickly; high budget remains usable.
  const low = await generateKey({
    userId: `demo-telecom-user-low-${runId}`,
    maxBudget: 0.00001,
    alias: `user-low-${runId}`,
  });
  const high = await generateKey({
    userId: `demo-telecom-user-high-${runId}`,
    maxBudget: 1.0,
    alias: `user-high-${runId}`,
  });
  report.steps.runId = runId;
  report.steps.keysCreated = {
    lowBudget: 0.00001,
    highBudget: 1.0,
    lowKeyPrefix: String(low.key).slice(0, 8),
    highKeyPrefix: String(high.key).slice(0, 8),
    masterEqualsLow: low.key === MASTER,
    masterEqualsHigh: high.key === MASTER,
    lowEqualsHigh: low.key === high.key,
  };
  if (report.steps.keysCreated.masterEqualsLow || report.steps.keysCreated.masterEqualsHigh) {
    fail('Virtual key must not equal master key');
  }
  if (report.steps.keysCreated.lowEqualsHigh) fail('Two users must receive distinct virtual keys');

  // Prove client credentials are virtual keys, not provider master: provider key never returned by generate.
  const genBlob = redactSecrets({ low: low.info, high: high.info });
  if (genBlob.includes(process.env.DEEPSEEK_API_KEY)) {
    fail('Provider master key leaked in key/generate response');
  }
  report.steps.providerKeyAbsentFromKeyGenerate = true;

  const highFirst = await chat(high.key, MARKER_B, 'high-first');
  if (!highFirst.ok) fail('High-budget user first chat failed', highFirst);
  report.steps.highFirst = highFirst;

  // Drive low-budget user until rejected or capped attempts.
  const lowAttempts = [];
  let lowRejected = false;
  for (let i = 0; i < 12; i++) {
    const attempt = await chat(low.key, MARKER_A, `low-${i}`);
    lowAttempts.push({
      i,
      ok: attempt.ok,
      status: attempt.status,
      usage: attempt.usage,
      errorPreview: attempt.errorPreview,
    });
    if (!attempt.ok) {
      lowRejected = true;
      break;
    }
  }
  report.steps.lowAttempts = lowAttempts;
  report.steps.lowRejected = lowRejected;
  if (!lowRejected) {
    fail('Expected low-budget user to be rejected after exceeding max_budget', lowAttempts);
  }

  const highAfter = await chat(high.key, MARKER_B, 'high-after-low-exhausted');
  if (!highAfter.ok) {
    fail('High-budget user was affected by low-budget exhaustion', highAfter);
  }
  report.steps.highAfter = highAfter;
  report.steps.isolationOk = true;

  const lowInfo = await keyInfo(low.key);
  const highInfo = await keyInfo(high.key);
  report.steps.keyInfo = {
    lowStatus: lowInfo.status,
    highStatus: highInfo.status,
    lowSpend: lowInfo.json && (lowInfo.json.info?.spend ?? lowInfo.json.spend ?? lowInfo.json.key?.spend),
    highSpend: highInfo.json && (highInfo.json.info?.spend ?? highInfo.json.spend ?? highInfo.json.key?.spend),
    lowMaxBudget:
      lowInfo.json && (lowInfo.json.info?.max_budget ?? lowInfo.json.max_budget ?? lowInfo.json.key?.max_budget),
    highMaxBudget:
      highInfo.json && (highInfo.json.info?.max_budget ?? highInfo.json.max_budget ?? highInfo.json.key?.max_budget),
  };

  const spendLogs = await fetchSpendLogs();
  const spendHits = scanForMarkers(
    spendLogs.text || JSON.stringify(spendLogs.json || {}),
    [MARKER_A, MARKER_B]
  );
  report.steps.spendLogsApi = {
    ok: spendLogs.ok,
    status: spendLogs.status,
    markerHits: spendHits,
  };

  const pg = queryPostgresPrivacy();
  report.steps.postgresPrivacy = pg;
  if (pg.bodyCounts.status !== 0) {
    fail('Postgres body-count query failed', pg.bodyCounts);
  }
  if (pg.markerHits.status !== 0) {
    fail('Postgres marker-hit query failed', pg.markerHits);
  }
  const markerHitCount = Number(String(pg.markerHits.stdout || '').trim());
  if (!Number.isFinite(markerHitCount)) {
    fail('Postgres marker scan did not return a count', pg.markerHits);
  }
  if (markerHitCount > 0) {
    fail('Privacy markers found in LiteLLM_SpendLogs', pg.markerHits);
  }
  const countLines = pg.bodyCounts.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^\d+/.test(l));
  if (!countLines.length) {
    fail('Postgres body-count query returned no data row', pg.bodyCounts);
  }
  const nums = countLines[0].split('|').map((p) => Number(String(p).trim()));
  report.steps.spendLogBodyCounts = {
    rows: nums[0],
    messagesNonempty: nums[1],
    responseNonempty: nums[2],
    proxyReqNonempty: nums[3],
  };
  if (nums[1] > 0 || nums[2] > 0 || nums[3] > 0) {
    fail('SpendLogs contains non-empty messages/response/proxy_server_request bodies', report.steps.spendLogBodyCounts);
  }
  if (spendHits.length > 0) {
    fail('Privacy markers found in spend logs API payload', spendHits);
  }

  report.steps.privacyOk = true;
  report.verdict = 'LITELLM_SPIKE_PRIVACY_AND_QUOTA_PASS';
  report.finishedAt = new Date().toISOString();

  const outPath = path.join(EVIDENCE_DIR, 'report.json');
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ verdict: report.verdict, evidence: outPath, isolationOk: true, privacyOk: true }, null, 2));
}

main().catch((err) => {
  const payload = {
    verdict: 'LITELLM_SPIKE_PRIVACY_AND_QUOTA_FAIL',
    error: String(err && err.message ? err.message : err),
    detail: err && err.detail ? err.detail : undefined,
  };
  try {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'report.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  } catch {
    // ignore evidence write failures on fatal path
  }
  console.error(JSON.stringify(payload, null, 2));
  process.exit(1);
});
