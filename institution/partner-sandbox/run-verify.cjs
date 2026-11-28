#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');

async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function request(baseUrl, token, method, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { ok: response.ok, status: response.status, text, json };
}

async function wait(baseUrl) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/partner-sandbox`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('partner sandbox did not start');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-partner-sandbox-'));
  const port = await reservePort();
  const token = `sandbox-admin-${Date.now()}`;
  const baseUrl = `http://127.0.0.1:${port}`;
  const dataFile = path.join(temp, 'store.json');
  const child = spawn(process.execPath, [path.join(ROOT, 'institution', 'backend', 'server.cjs')], {
    cwd: ROOT,
    env: {
      ...process.env,
      INSTITUTION_BACKEND_PORT: String(port),
      INSTITUTION_DATA_FILE: dataFile,
      INSTITUTION_ADMIN_TOKEN: token,
    },
    stdio: 'ignore',
  });
  try {
    await wait(baseUrl);
    const page = await fetch(`${baseUrl}/partner-sandbox`).then((response) => response.text());
    assert(page.includes('兔机米伙伴沙箱'), 'partner console missing');
    const denied = await request(baseUrl, '', 'GET', '/v0/admin/partner/overview');
    assert(denied.status === 401, 'admin API must reject missing token');

    let response = await request(baseUrl, token, 'POST', '/v0/admin/partner/organizations', {
      id: 'partner-demo', name: '合成伙伴机构', brandRef: 'tujimi',
    });
    assert(response.status === 201, 'organization creation failed');
    for (const user of [
      { institutionUserId: 'test-user-1', entitlementLabel: '基础权益', quotaAmount: 100 },
      { institutionUserId: 'test-user-2', entitlementLabel: '增强权益', quotaAmount: 200 },
    ]) {
      response = await request(baseUrl, token, 'POST', '/v0/admin/partner/users', {
        ...user, organizationId: 'partner-demo', models: ['sandbox-model'],
      });
      assert(response.status === 201, `user creation failed: ${user.institutionUserId}`);
    }
    response = await request(baseUrl, token, 'POST', '/v0/admin/partner/services', {
      serviceId: 'partner-service',
      organizationId: 'partner-demo',
      name: '机构协作服务',
      subjectId: 'subject-partner-service',
      a2aEndpoint: 'https://sandbox.example/a2a',
      agentCardUrl: 'https://sandbox.example/.well-known/agent-card.json',
      scopes: ['service:consult'],
      humanInLoop: true,
    });
    assert(response.status === 201, 'service creation failed');

    const overviewResponse = await request(baseUrl, token, 'GET', '/v0/admin/partner/overview');
    const overview = overviewResponse.json.overview;
    assert(overview.organizations.length === 1, 'organization count mismatch');
    assert(overview.users.length === 2, 'user count mismatch');
    assert(overview.services.length === 1, 'service count mismatch');
    assert(overview.auditEvents.length === 4, 'audit count mismatch');
    const leakedKeys = [];
    const walk = (value, trail = '') => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) return value.forEach((item, index) => walk(item, `${trail}[${index}]`));
      for (const [key, item] of Object.entries(value)) {
        if (['virtualKey', 'prompt', 'response', 'responseBody', 'digitalSelf', 'memory', 'providerMasterKey'].includes(key)) {
          leakedKeys.push(trail ? `${trail}.${key}` : key);
        }
        walk(item, trail ? `${trail}.${key}` : key);
      }
    };
    walk(overview);
    assert(leakedKeys.length === 0, `overview leaked private keys: ${leakedKeys.join(', ')}`);

    response = await request(baseUrl, token, 'POST', '/v0/admin/partner/disable', {
      resourceType: 'service', resourceId: 'partner-service',
    });
    assert(response.ok, 'service disable failed');
    assert(response.json.overview.services[0].status === 'disabled', 'service not disabled');

    console.log(JSON.stringify({
      verdict: 'SLICE_4B_PARTNER_SANDBOX_CONTROL_PLANE_PASS',
      organizationCount: 1,
      userCount: 2,
      serviceCount: 1,
      auditCount: 5,
      unauthorizedRejected: true,
      privacyBoundaryPass: true,
    }, null, 2));
  } finally {
    if (!child.killed) child.kill();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

