import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../digitalme-runtime';
import { createCommandBus } from '../command-bus';
import { providerCredentialKey } from '../../infrastructure/secret-store';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const adapterModule = require(path.join(REPO_ROOT, 'electron', 'institution-adapter.cjs')) as {
  createInstitutionAdapter: (input: { backendBaseUrl: string }) => any;
  writeMode: (userData: string, mode: Record<string, unknown>) => void;
  readMode: (userData: string) => { enabled?: boolean };
  clearMode: (userData: string) => void;
};

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

async function request(baseUrl: string, token: string, route: string, body: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  assert.ok(response.ok, JSON.stringify(json));
  return json;
}

async function waitForBackend(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/partner-sandbox`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('synthetic institution backend did not start');
}

test('Slice 4C 电信旅程：沙箱登录、权益到账、同一 Talk 能力调用与撤销', { timeout: 180_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-slice4c-telco-'));
  const port = await reservePort();
  const token = `admin-${Date.now()}`;
  const baseUrl = `http://127.0.0.1:${port}`;
  const dataFile = path.join(root, 'institution.json');
  let backend: ChildProcess | null = spawn(process.execPath, [path.join(REPO_ROOT, 'institution', 'backend', 'server.cjs')], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      INSTITUTION_BACKEND_PORT: String(port),
      INSTITUTION_DATA_FILE: dataFile,
      INSTITUTION_ADMIN_TOKEN: token,
      INSTITUTION_SYNTHETIC_MODE: '1',
      INSTITUTION_DEFAULT_MODEL: 'sandbox-model',
    },
    stdio: 'ignore',
  });
  backend.unref();
  await waitForBackend(baseUrl);
  await request(baseUrl, token, '/v0/admin/partner/organizations', {
    id: 'synthetic-telco', name: '合成电信伙伴', brandRef: 'demo-telecom',
  });
  await request(baseUrl, token, '/v0/admin/partner/users', {
    institutionUserId: 'telco-user-1',
    organizationId: 'synthetic-telco',
    displayName: '测试用户一',
    entitlementLabel: '电信 AI 试用权益',
    quotaAmount: 100,
    models: ['sandbox-model'],
  });

  const adapter = adapterModule.createInstitutionAdapter({ backendBaseUrl: baseUrl });
  const session = await adapter.exchange({ institutionUserId: 'telco-user-1', assertion: 'mock' });
  assert.equal(session.entitlement.label, '电信 AI 试用权益');
  assert.equal(session.organizationId, 'synthetic-telco');

  let savedCredential: Record<string, string> | null = null;
  await adapter.applyToCredentialStore(async (input: Record<string, string>) => {
    savedCredential = { ...input };
  }, session);
  assert.ok(savedCredential);
  adapterModule.writeMode(root, {
    enabled: true,
    backendBaseUrl: baseUrl,
    institutionUserId: session.institutionUserId,
    organizationId: session.organizationId,
    organizationName: '合成电信伙伴',
    assertion: 'mock',
    model: session.model,
    gatewayBaseUrl: session.gatewayBaseUrl,
  });
  assert.equal(adapterModule.readMode(root).enabled, true);

  const credential = savedCredential as unknown as { apiKey: string; providerId: string };
  const runtime = createDigitalMeRuntime({
    documentCapability: 'openai-compatible',
    registerOpenAiStub: false,
    openaiCompatible: {
      baseUrl: session.gatewayBaseUrl,
      model: session.model,
      providerId: 'openai-compatible',
      timeoutMs: 30_000,
    },
    secrets: {
      async get(key: string) {
        return key === providerCredentialKey(credential.providerId) ? credential.apiKey : null;
      },
    },
  });
  const subjectDir = path.join(root, 'subject');
  await runtime.createPackage({ displayName: '合成电信用户', targetDir: subjectDir });
  try {
    const result = await createCommandBus(runtime).invoke('talk', { text: '请确认我的机构权益是否可以使用。' });
    assert.match(JSON.stringify(result), /机构沙箱能力调用成功/);
  } finally {
    await runtime.stop();
  }

  const usage = await fetch(`${baseUrl}/v0/usage/summary?institutionUserId=telco-user-1`).then((response) => response.json()) as {
    summaries: Array<{ usage?: { requestCount?: number } }>;
  };
  assert.ok((usage.summaries[0]?.usage?.requestCount || 0) >= 1);

  adapterModule.clearMode(root);
  assert.equal(adapterModule.readMode(root).enabled, false);
  const backendOverview = await fetch(`${baseUrl}/v0/client/overview?institutionUserId=telco-user-1`).then((response) => response.json()) as {
    overview?: { account?: { status?: string } };
  };
  assert.equal(backendOverview.overview?.account?.status, 'active');

  if (backend && !backend.killed) backend.kill();
  backend = null;
});
