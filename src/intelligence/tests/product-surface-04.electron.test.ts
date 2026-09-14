/**
 * 04 产品表面：主导航收敛 + 同一入口覆盖回答/完成/询问/缺能力。
 * 使用 talk stub，不迁旧 work runtime。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
} from '../../runtime/tests/electron-harness';
import type { Page } from 'playwright';

const STUB_ENV = {
  DIGITALME_V2_DIGITAL_SELF_STUB: '1',
  DIGITALME_V2_TALK_STUB: '1',
};

async function talkTurnCount(page: Page): Promise<number> {
  const result = (await page.evaluate(`(async () => {
    return window.digitalMe.invoke('talk', {});
  })()`)) as { view?: { turns?: unknown[] } };
  return result.view?.turns?.length || 0;
}

async function sendTalk(page: Page, text: string): Promise<void> {
  const before = await talkTurnCount(page);
  await page.evaluate(`(async (payload) => {
    if (!window.TalkPage || typeof window.TalkPage.handleSend !== 'function') {
      throw new Error('TalkPage.handleSend missing');
    }
    await window.TalkPage.handleSend(payload);
  })(${JSON.stringify(text)})`);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if ((await talkTurnCount(page)) > before) return;
    await page.waitForTimeout(200);
  }
  throw new Error(`talk 未增加回合：${text}`);
}

async function assertProductNav(page: Page): Promise<void> {
  const navChat = page.locator('#nav-chat');
  await navChat.waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#panel-chat').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#nav-subject').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#nav-settings').waitFor({ state: 'visible', timeout: 10_000 });
  assert.equal((await navChat.innerText()).trim(), '与兔机米');
  assert.equal((await page.locator('#nav-discover').innerText()).trim(), '发现');
  assert.equal(await page.locator('#nav-work').isVisible().catch(() => false), false);
  assert.equal(await page.locator('#nav-collab').isVisible().catch(() => false), false);
  assert.equal(await page.locator('#panel-work').isVisible().catch(() => false), false);
  assert.equal(await page.locator('#btn-chat-to-task').isVisible().catch(() => false), false);
  assert.equal(await page.locator('.empty-emblem').count(), 0);
  const navText = await page.locator('.main-nav').innerText();
  assert.equal(/做事|协作|Feed|Growth/i.test(navText), false);
}

function leak(copy: string): boolean {
  return /Job|taskId|cap_|adapter|execution stage|semantic review|正在调用/i.test(copy);
}

async function assertLegacyWorkInactive(page: Page): Promise<void> {
  const status = (await page.evaluate(`(async () => {
    return window.digitalMe.getModelStatus();
  })()`)) as { legacyWorkRuntimeAttached?: boolean };
  assert.equal(!!status.legacyWorkRuntimeAttached, false, '正式路径不应初始化旧 Work Runtime');
}

test('Electron：统一产品表面导航与同一入口 A/B/C/D/E', { timeout: 240_000 }, async () => {
  const note = path.join(os.tmpdir(), `dm-surface-note-${Date.now()}.md`);
  await fs.writeFile(note, '# note\n', 'utf8');
  const harness = await launchDigitalMeElectron({
    extraEnv: {
      ...STUB_ENV,
      DIGITALME_V2_TEST_IMPORT_FILES: note,
    },
  });
  try {
    await skipWelcomeAndEnterShell(harness.page);
    await assertProductNav(harness.page);
    await assertLegacyWorkInactive(harness.page);

    await harness.page.locator('#nav-subject').click();
    await harness.page.locator('#panel-subject').waitFor({ state: 'visible', timeout: 15_000 });
    await harness.page.locator('#digital-self-page').waitFor({ state: 'visible' });
    await harness.page.locator('#btn-ds-tell').click();
    await harness.page.locator('#ds-tell-input').fill('我喜欢早起处理事情');
    await harness.page.locator('#btn-ds-tell-submit').click();
    await harness.page.locator('#digital-self-page .ds-text', { hasText: '早起' }).waitFor({
      state: 'visible',
      timeout: 20_000,
    });

    await harness.page.locator('#nav-chat').click();
    await assertProductNav(harness.page);

    await harness.page.locator('#nav-settings').click();
    await harness.page.locator('#view-settings').waitFor({ state: 'visible', timeout: 15_000 });
    const settingsCopy = await harness.page.locator('#view-settings').innerText();
    assert.match(settingsCopy, /AI 连接|联网搜索|高级/);
    assert.equal(/Relay URL|OpenCode|Codex|MCP|capability registry/i.test(settingsCopy), false);
    assert.equal(
      await harness.page.evaluate(`!!document.querySelector('#settings-advanced') && document.querySelector('#settings-advanced').open`),
      false,
    );
    await harness.page.locator('#btn-settings-back').click();
    await harness.page.locator('#view-shell').waitFor({ state: 'visible', timeout: 15_000 });
    await harness.page.locator('#nav-chat').click();
    await assertProductNav(harness.page);

    await harness.page.locator('#btn-open-help').click();
    await harness.page.locator('#view-help').waitFor({ state: 'visible', timeout: 10_000 });
    const help = await harness.page.locator('#view-help').innerText();
    assert.match(help, /与兔机米/);
    assert.match(help, /数字之我/);
    assert.match(help, /设置/);
    assert.equal(help.includes('转为任务'), false);
    assert.equal(help.includes('点「转为任务」'), false);
    await harness.page.locator('#btn-help-back').click();
    await harness.page.locator('#view-shell').waitFor({ state: 'visible', timeout: 10_000 });
    await assertProductNav(harness.page);

    await sendTalk(harness.page, '你现在了解我什么？');
    let copy = await harness.page.locator('#chat-turns').innerText();
    assert.match(copy, /早起/);
    assert.equal(leak(copy), false);

    await sendTalk(
      harness.page,
      '帮我把这段话改得更简洁。今天开会讨论了很多内容，最后决定下周再确认方案细节。',
    );
    copy = await harness.page.locator('#chat-turns').innerText();
    assert.match(copy, /下周|方案|简洁|开会/);
    assert.equal(await harness.page.locator('.talk-result-card').count(), 0);
    assert.equal(leak(copy), false);

    await sendTalk(harness.page, '请在工作区创建 README.md，写一段简短项目说明。');
    copy = await harness.page.locator('#chat-turns').innerText();
    assert.match(copy, /完成|README|说明/);
    await harness.page.locator('.talk-result-card').waitFor({ state: 'visible', timeout: 10_000 });
    assert.match(await harness.page.locator('.talk-result-card .talk-result-name').innerText(), /README\.md|result\.md/);
    assert.match(await harness.page.locator('.talk-result-card').innerText(), /这次完成的结果/);
    assert.equal((await harness.page.locator('.talk-result-open').innerText()).trim(), '打开');
    assert.equal(await harness.page.locator('#panel-work').isVisible().catch(() => false), false);
    assert.equal(leak(copy), false);

    await sendTalk(harness.page, '请把这份说明用邮件发给李明。');
    copy = await harness.page.locator('#chat-turns').innerText();
    assert.match(copy, /邮箱|发给谁|没有/);
    assert.equal(leak(copy), false);

    await sendTalk(harness.page, '用这个邮箱：liming@example.com，继续原来那件事。');
    copy = await harness.page.locator('#chat-turns').innerText();
    assert.match(copy, /发信|不会假装|没有|停/);
    const lastMail = (await harness.page.locator('#chat-turns li.chat-turn-assistant').last().innerText()) || '';
    assert.equal(/已发送成功|邮件已送达/.test(lastMail), false);

    await harness.page.evaluate(`(async () => {
      if (!window.TalkPage || typeof window.TalkPage.attachFiles !== 'function') {
        throw new Error('TalkPage.attachFiles missing');
      }
      await window.TalkPage.attachFiles();
    })()`);
    await harness.page.locator('.talk-attach-chip').waitFor({ state: 'visible', timeout: 10_000 });
    assert.match(await harness.page.locator('.talk-attach-chip').innerText(), /dm-surface-note/);
    assert.equal(await harness.page.locator('#panel-work').isVisible().catch(() => false), false);
    await assertLegacyWorkInactive(harness.page);
  } finally {
    await harness.close();
    await fs.unlink(note).catch(() => undefined);
  }
});
