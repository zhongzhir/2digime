#!/usr/bin/env node
/**
 * Institution Backend v0.1 — minimal HTTP service (Slice B).
 * Independent of Relay / Electron / Talk Core.
 *
 * Env:
 *   LITELLM_BASE_URL (default http://127.0.0.1:4000)
 *   LITELLM_MASTER_KEY
 *   INSTITUTION_BACKEND_PORT (default 4100)
 *   INSTITUTION_DATA_FILE (default institution/backend/data/store.json)
 *   INSTITUTION_DEFAULT_MODEL (default deepseek-v4-flash)
 */
'use strict';

const http = require('node:http');
const path = require('node:path');
const { createStore } = require('./store.cjs');
const { createLitellmClient } = require('./litellm-client.cjs');

function loadDotEnv(filePath) {
  const fs = require('node:fs');
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1);
    if (key && !process.env[key]) process.env[key] = value;
  }
}

loadDotEnv(path.join(__dirname, '..', 'litellm-spike', '.env'));
loadDotEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.INSTITUTION_BACKEND_PORT || 4100);
const DATA_FILE =
  process.env.INSTITUTION_DATA_FILE || path.join(__dirname, 'data', 'store.json');
const DEFAULT_MODEL = process.env.INSTITUTION_DEFAULT_MODEL || 'deepseek-v4-flash';
const GATEWAY = (process.env.LITELLM_BASE_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '');
const MASTER = process.env.LITELLM_MASTER_KEY || 'sk-institution-spike-local-only';

const store = createStore(DATA_FILE);
const litellm = createLitellmClient({ baseUrl: GATEWAY, masterKey: MASTER });

const ENTITLEMENT_GROUPS = {
  low: {
    group: 'low',
    label: 'Demo low budget',
    models: [DEFAULT_MODEL],
    quotaType: 'max_budget_usd',
    quotaAmount: 0.00001,
  },
  high: {
    group: 'high',
    label: 'Demo high budget',
    models: [DEFAULT_MODEL],
    quotaType: 'max_budget_usd',
    quotaAmount: 1.0,
  },
};

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(Object.assign(new Error('invalid JSON body'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function publicOrg(org) {
  return {
    id: org.id,
    name: org.name,
    status: org.status,
    brandRef: org.brandRef || null,
    gatewayBaseUrl: org.gatewayBaseUrl,
  };
}

function publicUser(user) {
  return {
    institutionUserId: user.institutionUserId,
    organizationId: user.organizationId,
    status: user.status,
    entitlementGroup: user.entitlementGroup,
  };
}

function entitlementView(user) {
  const policy = ENTITLEMENT_GROUPS[user.entitlementGroup];
  return {
    institutionUserId: user.institutionUserId,
    entitlementGroup: user.entitlementGroup,
    policy: policy
      ? {
          group: policy.group,
          label: policy.label,
          models: policy.models,
          quotaType: policy.quotaType,
          quotaAmount: policy.quotaAmount,
        }
      : null,
    enforcement: 'litellm',
  };
}

function extractSpend(infoJson) {
  const info = infoJson && (infoJson.info || infoJson.key || infoJson);
  if (!info || typeof info !== 'object') {
    return { spend: null, maxBudget: null, models: null };
  }
  return {
    spend: info.spend ?? null,
    maxBudget: info.max_budget ?? null,
    models: info.models ?? null,
  };
}

async function ensureDemoSeed(force = false) {
  const data = store.read();
  const orgId = 'org-demo-telecom';
  if (!force && data.organizations[orgId] && Object.keys(data.users).length >= 2) {
    return { seeded: false, organization: publicOrg(data.organizations[orgId]), users: Object.values(data.users).map(publicUser) };
  }

  const health = await litellm.health();
  if (!health.ok) {
    const err = new Error('LiteLLM is not healthy; cannot seed Demo Telecom');
    err.statusCode = 503;
    err.detail = { status: health.status };
    throw err;
  }

  const runId = `b-${Date.now()}`;
  const org = {
    id: orgId,
    name: 'Demo Telecom',
    status: 'active',
    brandRef: 'demo-telecom',
    gatewayBaseUrl: GATEWAY,
    createdAt: new Date().toISOString(),
  };

  const specs = [
    { institutionUserId: 'demo-user-low', entitlementGroup: 'low' },
    { institutionUserId: 'demo-user-high', entitlementGroup: 'high' },
  ];

  const users = {};
  for (const spec of specs) {
    const policy = ENTITLEMENT_GROUPS[spec.entitlementGroup];
    const alias = `${spec.institutionUserId}-${runId}`;
    const generated = await litellm.generateKey({
      userId: `${orgId}:${spec.institutionUserId}`,
      maxBudget: policy.quotaAmount,
      models: policy.models,
      alias,
      metadata: {
        organizationId: orgId,
        institutionUserId: spec.institutionUserId,
        entitlementGroup: spec.entitlementGroup,
        slice: 'institution-v01-b',
      },
    });
    if (generated.key === MASTER) {
      throw new Error('refusing to store master key as user credential');
    }
    users[spec.institutionUserId] = {
      institutionUserId: spec.institutionUserId,
      organizationId: orgId,
      status: 'active',
      entitlementGroup: spec.entitlementGroup,
      litellmKeyAlias: alias,
      // user-scoped virtual key only — never provider master key
      virtualKey: generated.key,
      provisionedAt: new Date().toISOString(),
    };
  }

  store.write({
    version: 1,
    organizations: { [orgId]: org },
    users,
    updatedAt: null,
  });

  return {
    seeded: true,
    organization: publicOrg(org),
    users: Object.values(users).map(publicUser),
  };
}

async function handle(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  const { pathname } = url;

  try {
    if (req.method === 'GET' && pathname === '/health') {
      const litellmHealth = await litellm.health();
      return send(res, litellmHealth.ok ? 200 : 503, {
        ok: litellmHealth.ok,
        service: 'institution-backend',
        litellm: { ok: litellmHealth.ok, status: litellmHealth.status },
      });
    }

    if (req.method === 'POST' && pathname === '/v0/admin/bootstrap') {
      const body = await readBody(req);
      const result = await ensureDemoSeed(Boolean(body.force));
      return send(res, 200, result);
    }

    if (req.method === 'GET' && pathname === '/v0/organization') {
      const data = store.read();
      const org = Object.values(data.organizations)[0];
      if (!org) return send(res, 404, { error: 'organization_not_found' });
      return send(res, 200, { organization: publicOrg(org) });
    }

    if (req.method === 'POST' && pathname === '/v0/session/exchange') {
      const body = await readBody(req);
      const institutionUserId = String(body.institutionUserId || '').trim();
      const assertion = String(body.assertion || body.mockAssertion || 'mock').trim();
      if (!institutionUserId) return send(res, 400, { error: 'institutionUserId_required' });
      // Demo identity only; replaceable by OIDC later.
      if (assertion !== 'mock') return send(res, 401, { error: 'unsupported_assertion' });

      const data = store.read();
      const user = data.users[institutionUserId];
      if (!user || user.status !== 'active') return send(res, 404, { error: 'user_not_found' });
      const org = data.organizations[user.organizationId];
      if (!org) return send(res, 404, { error: 'organization_not_found' });
      if (!user.virtualKey) return send(res, 500, { error: 'credential_missing' });

      const policy = ENTITLEMENT_GROUPS[user.entitlementGroup];
      return send(res, 200, {
        institutionUserId: user.institutionUserId,
        organizationId: org.id,
        gatewayBaseUrl: org.gatewayBaseUrl,
        model: (policy && policy.models[0]) || DEFAULT_MODEL,
        // restricted credential only
        credential: {
          type: 'litellm_virtual_key',
          value: user.virtualKey,
        },
        entitlement: entitlementView(user).policy,
        // explicit non-disclosure
        providerMasterKey: undefined,
      });
    }

    if (req.method === 'GET' && pathname === '/v0/entitlement') {
      const institutionUserId = String(url.searchParams.get('institutionUserId') || '').trim();
      if (!institutionUserId) return send(res, 400, { error: 'institutionUserId_required' });
      const data = store.read();
      const user = data.users[institutionUserId];
      if (!user) return send(res, 404, { error: 'user_not_found' });

      const view = entitlementView(user);
      const info = await litellm.keyInfo(user.virtualKey);
      const spend = extractSpend(info.json);
      return send(res, 200, {
        ...view,
        live: {
          source: 'litellm',
          ok: info.ok,
          spend: spend.spend,
          maxBudget: spend.maxBudget,
          models: spend.models,
        },
      });
    }

    if (req.method === 'GET' && pathname === '/v0/usage/summary') {
      const institutionUserId = String(url.searchParams.get('institutionUserId') || '').trim();
      const data = store.read();
      const users = institutionUserId
        ? [data.users[institutionUserId]].filter(Boolean)
        : Object.values(data.users);
      if (institutionUserId && users.length === 0) {
        return send(res, 404, { error: 'user_not_found' });
      }

      const summaries = [];
      for (const user of users) {
        const info = await litellm.keyInfo(user.virtualKey);
        const spend = extractSpend(info.json);
        summaries.push({
          institutionUserId: user.institutionUserId,
          entitlementGroup: user.entitlementGroup,
          source: 'litellm',
          ok: info.ok,
          spend: spend.spend,
          maxBudget: spend.maxBudget,
          models: spend.models,
        });
      }
      return send(res, 200, { enforcement: 'litellm', summaries });
    }

    return send(res, 404, { error: 'not_found' });
  } catch (err) {
    const status = err && err.statusCode ? err.statusCode : 500;
    return send(res, status, {
      error: 'backend_error',
      message: String(err && err.message ? err.message : err),
      detail: err && err.detail ? err.detail : undefined,
    });
  }
}

const server = http.createServer((req, res) => {
  handle(req, res);
});

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(
      JSON.stringify({
        ok: true,
        service: 'institution-backend',
        port: PORT,
        dataFile: DATA_FILE,
        gateway: GATEWAY,
      })
    );
  });
}

module.exports = {
  server,
  ensureDemoSeed,
  ENTITLEMENT_GROUPS,
  store,
  litellm,
};
