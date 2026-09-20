/**
 * 无客户端 IQS/Gemini Key 的 Talk 联网：走 managed web-discovery。
 * 只复用本机已加密 DeepSeek SecretStore 作为对话模型；不明文导出密钥。
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
  officialAppUserDataPath,
} from '../../runtime/tests/electron-harness';

async function copyChatModelSecrets(userData: string): Promise<{ model: string; copied: boolean }> {
  const official = officialAppUserDataPath();
  const cfgPath = path.join(official, 'model-config.json');
  const secretsPath = path.join(official, 'secrets.v2.json');
  if (!existsSync(cfgPath) || !existsSync(secretsPath)) {
    return { model: '', copied: false };
  }
  await fs.copyFile(cfgPath, path.join(userData, 'model-config.json'));
  await fs.copyFile(secretsPath, path.join(userData, 'secrets.v2.json'));
  const localState = path.join(official, 'Local State');
  if (existsSync(localState)) {
    await fs.copyFile(localState, path.join(userData, 'Local State'));
  }
  const cfg = JSON.parse(await fs.readFile(cfgPath, 'utf8')) as { model?: string };
  return { model: String(cfg.model || ''), copied: true };
}

async function talkView(page: Page): Promise<{ turns: Array<{ role?: string; text?: string }> }> {
  const talked = (await page.evaluate(`(async () => {
    return window.digitalMe.invoke('talk', {});
  })()`)) as { view?: { turns?: Array<{ role?: string; text?: string }> } };
  return { turns: talked.view?.turns || [] };
}

async function sendTalk(page: Page, text: string, waitMs: number): Promise<void> {
  const before = (await talkView(page)).turns.length;
  await page.evaluate(`(async (payload) => {
    if (!window.TalkPage || typeof window.TalkPage.handleSend !== 'function') {
      throw new Error('TalkPage.handleSend missing');
    }
    await window.TalkPage.handleSend(payload);
  })(${JSON.stringify(text)})`);
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    if ((await talkView(page)).turns.length > before) return;
    await page.waitForTimeout(1000);
  }
  throw new Error(`talk 未在时限内增加回合：${text}`);
}

test('Electron Talk zero-key uses managed web-discovery without IQS/Gemini client keys', { timeout: 420_000 }, async (t) => {
  const userData = await isolatedUserDataDir('dm-zero-key-iqs-talk-');
  const copied = await copyChatModelSecrets(userData);
  if (!copied.copied) {
    t.skip('official encrypted SecretStore missing');
    return;
  }
  const harness = await launchDigitalMeElectron({
    userData,
    extraEnv: {
      DIGITALME_V2_UX_ACCEPTANCE: '0',
      DIGITALME_V2_DIGITAL_SELF_STUB: '0',
      DIGITALME_V2_TALK_STUB: '0',
      DIGITALME_V2_OPEN_WEB_DISCOVERY: '1',
      DIGITALME_V2_SEARCH_ENABLED: '1',
      GEMINI_API_KEY: '',
      GEMINI_SEARCH_MODEL: '',
    },
  });
  try {
    await skipWelcomeAndEnterShell(harness.page);
    const status = (await harness.page.evaluate(`(async () => window.digitalMe.getModelStatus())()`)) as {
      modelReady?: boolean;
      status?: { geminiSearchConfigured?: boolean };
    };
    assert.equal(!!status.modelReady, true, 'chat model SecretStore did not become modelReady');
    const walk: string[] = [];
    const scan = async (dir: string) => {
      let names: string[] = [];
      try {
        names = await fs.readdir(dir);
      } catch {
        return;
      }
      for (const name of names) {
        const full = path.join(dir, name);
        const st = await fs.stat(full);
        if (st.isDirectory()) {
          await scan(full);
          continue;
        }
        if (!/\.(json|jsonl|txt|log)$/i.test(name)) continue;
        const text = await fs.readFile(full, 'utf8').catch(() => '');
        walk.push(text);
      }
    };
    await scan(userData);
    const blob = walk.join('\n');
    assert.equal(/cloud-iqs\.aliyuncs\.com|WEB_DISCOVERY_PROVIDER_API_KEY/.test(blob), false);
    assert.equal(/API Key|请配置 Gemini|Google Cloud|阿里云控制台/.test(blob), false);

    await sendTalk(harness.page, '查一下今天 AI 有什么重要进展', 300_000);
    const turns = (await talkView(harness.page)).turns;
    const reply = [...turns].reverse().find((row) => row.role === 'assistant')?.text || '';
    assert.ok(reply.trim().length > 0, 'Talk produced empty reply');
    assert.equal(/请配置 Gemini|配置 IQS|API Key|Google Cloud|阿里云控制台/.test(reply), false);
    const hasSource = /https:\/\//.test(reply) || /来源[:：]/.test(reply) || /\.(com|cn|org)\b/.test(reply);
    assert.equal(hasSource, true, 'Talk reply should cite a real public source');
  } finally {
    await harness.close();
  }
});
