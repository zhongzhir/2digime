import test from 'node:test';
import assert from 'node:assert/strict';
import {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
} from '../../runtime/tests/electron-harness';
import type { Page } from 'playwright';

const STUB_ENV = {
  DIGITALME_V2_DIGITAL_SELF_STUB: '1',
  DIGITALME_V2_TALK_STUB: '1',
};

async function openDigitalSelf(page: Page): Promise<void> {
  await page.locator('#nav-subject').waitFor({ state: 'visible', timeout: 20_000 });
  for (let i = 0; i < 8; i += 1) {
    await page.locator('#nav-subject').dispatchEvent('click');
    const visible = await page.locator('#panel-subject').isVisible().catch(() => false);
    if (visible) break;
    await page.waitForTimeout(300);
  }
  await page.locator('#panel-subject').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#digital-self-page').waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('#btn-ds-tell').waitFor({ state: 'visible', timeout: 10_000 });
}

async function openTalk(page: Page): Promise<void> {
  await page.locator('#nav-chat').waitFor({ state: 'visible', timeout: 20_000 });
  for (let i = 0; i < 8; i += 1) {
    await page.locator('#nav-chat').dispatchEvent('click');
    const visible = await page.locator('#panel-chat').isVisible().catch(() => false);
    if (visible) break;
    await page.waitForTimeout(300);
  }
  await page.locator('#panel-chat').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#chat-input').waitFor({ state: 'visible', timeout: 10_000 });
}

async function sendTalk(page: Page, text: string): Promise<void> {
  await page.locator('#chat-input').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#chat-input').fill(text);
  await page.locator('#btn-chat-send').click();
  await page.locator('#btn-chat-send:not([disabled])').waitFor({ state: 'visible', timeout: 30_000 });
}

async function talkText(page: Page): Promise<string> {
  return page.locator('#chat-turns').innerText();
}

test('Electron：同一入口四场景（交流 / 做事 / 换说法 / 缺信息）', { timeout: 180_000 }, async () => {
  const harness = await launchDigitalMeElectron({ extraEnv: STUB_ENV });
  try {
    await skipWelcomeAndEnterShell(harness.page);
    await openDigitalSelf(harness.page);
    await harness.page.locator('#btn-ds-tell').click();
    await harness.page.locator('#ds-tell-form').waitFor({ state: 'visible' });
    await harness.page.locator('#ds-tell-input').fill('我喜欢早起处理事情');
    await harness.page.locator('#btn-ds-tell-submit').click();
    await harness.page.locator('#digital-self-page .ds-text', { hasText: '早起' }).waitFor({
      state: 'visible',
      timeout: 20_000,
    });

    await openTalk(harness.page);
    const title = await harness.page.locator('#panel-chat .page-title').innerText();
    assert.equal(title.includes('与兔机米'), true);

    await sendTalk(harness.page, '你现在了解我什么？');
    let copy = await talkText(harness.page);
    assert.match(copy, /早起/);
    assert.equal(copy.includes('Job'), false);
    assert.equal(copy.includes('capability'), false);

    await sendTalk(harness.page, '帮我写一份明天上午要做的三件事备忘');
    copy = await talkText(harness.page);
    assert.match(copy, /完成|备忘|待办|三件/);
    assert.equal(copy.includes('cap_fake_document'), false);

    await sendTalk(harness.page, '请生成一份简短备忘录，里面写明天上午的三件待办');
    copy = await talkText(harness.page);
    assert.match(copy, /完成|备忘/);

    await sendTalk(harness.page, '把这份说明发给我同事李明，用他的邮箱');
    copy = await talkText(harness.page);
    assert.match(copy, /邮箱/);
    await sendTalk(harness.page, '他的邮箱是 ming@example.com');
    copy = await talkText(harness.page);
    assert.match(copy, /李明|邮箱|继续/);
    assert.equal(await harness.page.locator('#chat-turns .chat-turn-user').count(), 5);
  } finally {
    await harness.close();
  }
});
