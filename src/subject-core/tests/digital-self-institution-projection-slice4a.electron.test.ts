import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  isolatedUserDataDir,
  launchDigitalMeElectron,
  REPO_ROOT,
  skipWelcomeAndEnterShell,
} from '../../runtime/tests/electron-harness';

async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function waitForOverview(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/v0/client/overview?institutionUserId=partner-user-1`);
      if (response.ok) return;
    } catch {
      // wait for the local sandbox backend
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('institution overview endpoint did not start');
}

test('Slice 4A：数字之我投影机构权益、最小计量边界并可撤销连接', { timeout: 240_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-slice4a-'));
  const userData = await isolatedUserDataDir('dmv2-slice4a-ud-');
  const dataFile = path.join(root, 'institution-store.json');
  const port = await reservePort();
  const backendBaseUrl = `http://127.0.0.1:${port}`;
  const now = new Date().toISOString();
  await fs.writeFile(
    dataFile,
    `${JSON.stringify({
      version: 1,
      organizations: {
        'org-partner-sandbox': {
          id: 'org-partner-sandbox',
          name: '伙伴电信沙箱',
          status: 'active',
          brandRef: 'demo-telecom',
          gatewayBaseUrl: 'http://127.0.0.1:4000',
          createdAt: now,
        },
      },
      users: {
        'partner-user-1': {
          institutionUserId: 'partner-user-1',
          organizationId: 'org-partner-sandbox',
          status: 'active',
          entitlementGroup: 'high',
          virtualKey: 'sk-synthetic-never-rendered',
          provisionedAt: now,
        },
      },
      updatedAt: now,
    }, null, 2)}\n`,
    'utf8',
  );
  await fs.writeFile(
    path.join(userData, 'institution-mode.json'),
    `${JSON.stringify({
      enabled: true,
      backendBaseUrl,
      institutionUserId: 'partner-user-1',
      organizationId: 'org-partner-sandbox',
      organizationName: '伙伴电信沙箱',
      assertion: 'mock',
      model: 'sandbox-model',
      gatewayBaseUrl: 'http://127.0.0.1:4000',
      updatedAt: now,
    }, null, 2)}\n`,
    'utf8',
  );

  let backend: ChildProcess | null = spawn(process.execPath, [path.join(REPO_ROOT, 'institution', 'backend', 'server.cjs')], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      INSTITUTION_BACKEND_PORT: String(port),
      INSTITUTION_DATA_FILE: dataFile,
    },
    stdio: 'ignore',
  });
  await waitForOverview(backendBaseUrl);

  const launched = await launchDigitalMeElectron({
    userData,
    extraEnv: { DIGITALME_V2_DIGITAL_SELF_STUB: '1' },
  });
  try {
    const { page } = launched;
    await skipWelcomeAndEnterShell(page);
    await page.locator('#nav-settings').click();
    await page.locator('#view-settings').waitFor({ state: 'visible' });
    await page.waitForFunction(`document.getElementById('ds-institution-account')?.textContent === '伙伴电信沙箱'`);

    assert.equal(await page.locator('#ds-institution-account').innerText(), '伙伴电信沙箱');
    assert.match(await page.locator('#ds-institution-verification').innerText(), /沙箱账号.*非真实身份认证/);
    assert.match(await page.locator('#ds-institution-entitlement').innerText(), /Demo high budget.*可用/);
    assert.equal(await page.locator('#ds-institution-services').innerText(), '机构 AI 对话服务');
    assert.match(await page.locator('#ds-institution-scope').innerText(), /同一对话/);
    assert.match(await page.locator('#ds-institution-validity').innerText(), /直至机构或你撤销/);
    assert.match(await page.locator('#ds-institution-metering').innerText(), /账号映射.*用量汇总/);
    const privacy = await page.locator('#ds-institution-privacy').innerText();
    assert.match(privacy, /Digital Self/);
    assert.match(privacy, /私人 Talk 正文/);
    assert.match(privacy, /本地文件/);
    assert.match(privacy, /长期记忆/);
    assert.equal((await page.locator('#ds-institution-card').innerText()).includes('sk-synthetic'), false);

    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('#btn-ds-disconnect-institution').click();
    await page.waitForFunction(`document.getElementById('ds-institution-account')?.textContent === '尚未连接机构服务'`);
    assert.equal(await fs.stat(path.join(userData, 'institution-mode.json')).then(() => true, () => false), false);
    assert.equal(await fs.readFile(dataFile, 'utf8').then((text) => text.includes('partner-user-1')), true);
  } finally {
    await launched.close();
    if (backend && !backend.killed) backend.kill();
    backend = null;
  }
});

