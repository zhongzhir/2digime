/**
 * 全新 userData、无任何客户端模型/搜索 Key：Managed AI + Managed Web Discovery。
 * 若 live Relay 尚未配置 server-only DeepSeek，则 skip 并标 MANAGED_AI_PROVIDER_SECRET_REQUIRED。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Page } from 'playwright';
import {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
  isolatedUserDataDir,
} from '../../runtime/tests/electron-harness';

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

async function liveManagedAiReady(): Promise<boolean> {
  try {
    const res = await fetch('https://relay.muhub.cn/health', { signal: AbortSignal.timeout(8000) });
    const json = (await res.json()) as { managedAi?: boolean };
    return json.managedAi === true;
  } catch {
    return false;
  }
}

test('Electron zero-start Talk/Digital Self without any client model keys', { timeout: 420_000 }, async (t) => {
  if (!(await liveManagedAiReady())) {
    t.skip('MANAGED_AI_PROVIDER_SECRET_REQUIRED');
    return;
  }
  const userData = await isolatedUserDataDir('dm-zero-start-managed-ai-');
  const harness = await launchDigitalMeElectron({
    userData,
    extraEnv: {
      DIGITALME_V2_UX_ACCEPTANCE: '0',
      DIGITALME_V2_DIGITAL_SELF_STUB: '0',
      DIGITALME_V2_TALK_STUB: '0',
      DIGITALME_V2_OPEN_MANAGED_AI: '1',
      DIGITALME_V2_OPEN_WEB_DISCOVERY: '1',
      DIGITALME_V2_SEARCH_ENABLED: '1',
      DIGITALME_V2_ALLOW_DEV_CREDENTIAL: '0',
      GEMINI_API_KEY: '',
      GEMINI_SEARCH_MODEL: '',
    },
  });
  try {
    await skipWelcomeAndEnterShell(harness.page);
    const status = (await harness.page.evaluate(`(async () => window.digitalMe.getModelStatus())()`)) as {
      modelReady?: boolean;
      status?: { credentialConfigured?: boolean; aiCapabilityPath?: string };
    };
    assert.equal(!!status.modelReady, true, 'managed AI did not become modelReady without client key');
    assert.equal(!!status.status?.credentialConfigured, false);
    assert.equal(status.status?.aiCapabilityPath || 'managed', 'managed');

    await sendTalk(harness.page, '你好，介绍一下你能帮我做什么。', 180_000);
    const hello = (await talkView(harness.page)).turns.filter((row) => row.role === 'assistant').at(-1)?.text || '';
    assert.equal(/请配置 DeepSeek|API Key|需要先连接 AI 能力/.test(hello), false, hello.slice(0, 240));
    assert.ok(hello.trim().length > 8, hello.slice(0, 240));

    await sendTalk(harness.page, '以后回答我时尽量简洁。', 180_000);
    const self = (await harness.page.evaluate(`(async () => {
      return window.digitalMe.invoke('digitalSelf', { action: 'read' });
    })()`)) as { view?: unknown };
    assert.match(JSON.stringify(self), /简洁/);

    await sendTalk(harness.page, '查一下今天 AI 有什么重要进展并告诉我最值得关注的三件事。', 240_000);
    const searched = (await talkView(harness.page)).turns.filter((row) => row.role === 'assistant').at(-1)?.text || '';
    assert.match(searched, /https:\/\/|来源[:：]|\.(com|cn|org)\b/);

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
    const dumped = walk.join('\n');
    assert.equal(/GEMINI_API_KEY|IQS|sk-[a-zA-Z0-9]{16,}/.test(dumped), false);
  } finally {
    await harness.close();
  }
});
