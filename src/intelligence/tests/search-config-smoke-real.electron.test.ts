/**
 * 联网搜索配置入口短验证。默认 skip。
 * 打开：DIGITALME_V2_SEARCH_CONFIG_SMOKE=1
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Page } from 'playwright';
import {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
  isolatedUserDataDir,
  REPO_ROOT,
  hasTestModelCredential,
} from '../../runtime/tests/electron-harness';

const ENABLED = process.env.DIGITALME_V2_SEARCH_CONFIG_SMOKE === '1';
const GEMINI_KEY = String(process.env.GEMINI_API_KEY || '').trim();
const TRACE = path.join(REPO_ROOT, 'scripts', '_search-config-smoke', 'raw-talk');

async function enterProductShell(page: Page): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const shell = await page.locator('#view-shell').isVisible().catch(() => false);
    const input = await page.locator('#chat-input').isVisible().catch(() => false);
    if (shell && input) return;
    for (const id of ['btn-welcome-skip-model', 'btn-welcome-skip-model-2', 'btn-create-skip']) {
      const btn = page.locator(`#${id}`);
      if (await btn.isVisible().catch(() => false)) {
        await btn.click({ force: true }).catch(() => undefined);
        await page.waitForTimeout(600);
      }
    }
    await page.waitForTimeout(400);
  }
  await skipWelcomeAndEnterShell(page);
}

function extraEnv(traceDir: string): Record<string, string> {
  return {
    DIGITALME_V2_DIGITAL_SELF_STUB: '0',
    DIGITALME_V2_TALK_STUB: '0',
    DIGITALME_V2_UX_ACCEPTANCE: '0',
    DIGITALME_V2_ALLOW_DEV_CREDENTIAL: '1',
    DIGITALME_V2_TALK_TRACE_DIR: traceDir,
    DIGITALME_V2_TALK_TURN_DEADLINE_MS: '600000',
    DIGITALME_V2_TALK_UI_DEADLINE_MS: '620000',
    GEMINI_API_KEY: '',
    GEMINI_SEARCH_MODEL: '',
    GEMINI_MODEL: '',
  };
}

async function modelStatus(page: Page): Promise<{
  modelReady?: boolean;
  status?: { geminiSearchConfigured?: boolean; credentialConfigured?: boolean };
}> {
  return (await page.evaluate(`(async () => window.digitalMe.getModelStatus())()`)) as {
    modelReady?: boolean;
    status?: { geminiSearchConfigured?: boolean; credentialConfigured?: boolean };
  };
}

async function openSettings(page: Page): Promise<string> {
  await page.locator('#nav-settings').click({ force: true });
  await page.locator('#view-settings').waitFor({ state: 'visible', timeout: 15_000 });
  return (await page.locator('#gemini-search-key-state').textContent()) || '';
}

async function openTalk(page: Page): Promise<void> {
  const settings = page.locator('#view-settings');
  if (await settings.isVisible().catch(() => false)) {
    await page.locator('#btn-settings-back').click({ force: true });
  }
  await page.locator('#view-shell').waitFor({ state: 'visible', timeout: 15_000 });
  const chatNav = page.locator('#nav-chat');
  if (await chatNav.isVisible().catch(() => false)) {
    await chatNav.click({ force: true }).catch(() => undefined);
  }
  await page.locator('#chat-input').waitFor({ state: 'visible', timeout: 15_000 });
}

async function talkView(page: Page): Promise<{ turns: Array<{ role: string; text: string }> }> {
  const talked = (await page.evaluate(`(async () => window.digitalMe.invoke('talk', {}))()`)) as {
    view?: { turns?: Array<{ role: string; text: string }> };
  };
  return { turns: talked.view?.turns || [] };
}

async function sendTalk(page: Page, text: string, waitMs = 240_000): Promise<void> {
  const before = (await talkView(page)).turns.length;
  await page.evaluate(`(async (text) => {
    if (!window.TalkPage || typeof window.TalkPage.handleSend !== 'function') {
      throw new Error('TalkPage.handleSend missing');
    }
    await window.TalkPage.handleSend(text);
  })(${JSON.stringify(text)})`);
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if ((await talkView(page)).turns.length > before) return;
    await page.waitForTimeout(1000);
  }
  throw new Error(`talk 未在时限内增加回合：${text}`);
}

function systemBlob(dir: string): string {
  if (!existsSync(dir)) return '';
  return require('node:fs')
    .readdirSync(dir)
    .filter((n: string) => n.endsWith('.json'))
    .map((name: string) => {
      const raw = JSON.parse(require('node:fs').readFileSync(path.join(dir, name), 'utf8')) as {
        messages?: Array<{ role?: string; content?: string }>;
      };
      return String(raw.messages?.[0]?.content || '');
    })
    .join('\n');
}

function readThread(pkgDir: string): {
  executions?: Array<{ capabilityId?: string; ok?: boolean }>;
} {
  try {
    return JSON.parse(
      require('node:fs').readFileSync(path.join(pkgDir, 'intelligence', 'thread.json'), 'utf8'),
    ) as { executions?: Array<{ capabilityId?: string; ok?: boolean }> };
  } catch {
    return {};
  }
}

async function secretsHasGemini(userData: string, rawKey: string): Promise<boolean> {
  const file = path.join(userData, 'secrets.v2.json');
  if (!existsSync(file)) return false;
  const text = await fs.readFile(file, 'utf8');
  assert.equal(text.includes(rawKey), false, '密钥不得明文写入 SecretStore 文件');
  const parsed = JSON.parse(text) as { secrets?: Record<string, string> };
  return Object.prototype.hasOwnProperty.call(parsed.secrets || {}, 'model.provider.gemini-search.apiKey');
}

async function emptyTrace(): Promise<void> {
  await fs.rm(TRACE, { recursive: true, force: true });
  await fs.mkdir(TRACE, { recursive: true });
}

test(
  'A–E 设置页写入/重启/删除 Gemini search，不改主模型',
  {
    skip: !ENABLED
      ? 'set DIGITALME_V2_SEARCH_CONFIG_SMOKE=1'
      : hasTestModelCredential() && GEMINI_KEY
        ? false
        : 'need model credential and GEMINI_API_KEY',
    timeout: 900_000,
  },
  async () => {
    const userData = await isolatedUserDataDir('dm-search-cfg-');
    await emptyTrace();

    let harness = await launchDigitalMeElectron({
      realProduct: true,
      userData,
      extraEnv: extraEnv(TRACE),
    });
    try {
      await enterProductShell(harness.page);
      const statusA = await modelStatus(harness.page);
      assert.equal(!!statusA.modelReady, true);
      assert.equal(!!statusA.status?.geminiSearchConfigured, false);
      const labelA = await openSettings(harness.page);
      assert.match(labelA, /未配置/);
      await openTalk(harness.page);
      await sendTalk(harness.page, '今天天气怎么样？');
      const sysA = systemBlob(TRACE);
      assert.equal(/cap_gemini_web_search|cap_baseline_web_search/.test(sysA), false);
      assert.match(sysA, /联网搜索：当前尚未连接或配置/);

      await openSettings(harness.page);
      await harness.page.locator('#gemini-search-api-key').fill(GEMINI_KEY);
      await harness.page.locator('#btn-save-gemini-search').click();
      await harness.page.locator('#gemini-search-key-state', { hasText: '已配置' }).waitFor({ timeout: 60_000 });
      assert.equal(await secretsHasGemini(userData, GEMINI_KEY), true);
      const statusSaved = await modelStatus(harness.page);
      assert.equal(!!statusSaved.status?.geminiSearchConfigured, true);
      assert.equal(!!statusSaved.status?.credentialConfigured, true);
    } finally {
      await harness.close();
    }

    await emptyTrace();
    harness = await launchDigitalMeElectron({
      realProduct: true,
      userData,
      extraEnv: extraEnv(TRACE),
    });
    try {
      await enterProductShell(harness.page);
      const statusB = await modelStatus(harness.page);
      assert.equal(!!statusB.status?.geminiSearchConfigured, true, '重启后应仍已配置');
      const labelB = await openSettings(harness.page);
      assert.match(labelB, /已配置/);
      await openTalk(harness.page);
      await sendTalk(harness.page, '帮我查一下 OpenAI 今天有什么新发布');
      const sysB = systemBlob(TRACE);
      assert.match(sysB, /cap_gemini_web_search/);
      assert.equal(/cap_baseline_web_search/.test(sysB), false);
      const loc = (await harness.page.evaluate(`(async () => window.digitalMe.getDefaultSubjectDir())()`)) as {
        dir: string;
      };
      const execC = readThread(loc.dir).executions || [];
      assert.equal(
        execC.some((e) => e.capabilityId === 'cap_gemini_web_search' && e.ok === true),
        true,
        'Talk 应自行调用 Gemini 且成功',
      );

      await sendTalk(harness.page, '帮我写一个 hello.html，内容是 <html><body>hi</body></html>。', 180_000);
      const htmlPath = path.join(loc.dir, 'intelligence', 'outputs', 'hello.html');
      assert.equal(existsSync(htmlPath), true);
      assert.match(await fs.readFile(htmlPath, 'utf8'), /hi/);

      await openSettings(harness.page);
      await harness.page.locator('#btn-delete-gemini-search').click();
      await harness.page.locator('#gemini-search-key-state', { hasText: '未配置' }).waitFor({ timeout: 60_000 });
      assert.equal(await secretsHasGemini(userData, GEMINI_KEY), false);
    } finally {
      await harness.close();
    }

    await emptyTrace();
    harness = await launchDigitalMeElectron({
      realProduct: true,
      userData,
      extraEnv: extraEnv(TRACE),
    });
    try {
      await enterProductShell(harness.page);
      const statusD = await modelStatus(harness.page);
      assert.equal(!!statusD.status?.geminiSearchConfigured, false);
      const labelD = await openSettings(harness.page);
      assert.match(labelD, /未配置/);
      await openTalk(harness.page);
      await sendTalk(harness.page, '帮我查一下 OpenAI 今天有什么新发布');
      const sysD = systemBlob(TRACE);
      assert.equal(/cap_gemini_web_search/.test(sysD), false);
      const reply = [...(await talkView(harness.page)).turns].reverse().find((t) => t.role === 'assistant')?.text || '';
      assert.equal(/cap_gemini_web_search|基础搜索/.test(reply), false);
    } finally {
      await harness.close();
    }
  },
);
