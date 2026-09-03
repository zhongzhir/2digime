/**
 * 只在「与 2digime」表达，不进数字之我手工改，打开页面应已同步。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Page } from 'playwright';
import {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
} from '../../runtime/tests/electron-harness';

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

async function sendTalk(page: Page, text: string): Promise<string> {
  await page.locator('#chat-input').waitFor({ state: 'visible', timeout: 20_000 });
  await page.locator('#chat-input').fill(text);
  await page.locator('#btn-chat-send').click();
  await page.locator('#btn-chat-send:not([disabled])').waitFor({ state: 'visible', timeout: 30_000 });
  return page.locator('#chat-turns').innerText();
}

test('Electron：Talk 学习回流到数字之我，Owner B 场景无需手工改页', { timeout: 180_000 }, async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-talk-self-el-'));
  const first = await launchDigitalMeElectron({ extraEnv: STUB_ENV, userData });
  try {
    await skipWelcomeAndEnterShell(first.page);
    await openTalk(first.page);

    let copy = await sendTalk(first.page, '我以后更喜欢上午处理复杂工作。');
    assert.equal(/是否保存到数字之我/.test(copy), false);

    await openDigitalSelf(first.page);
    await first.page.locator('#digital-self-page .ds-text', { hasText: '上午' }).waitFor({
      state: 'visible',
      timeout: 15_000,
    });

    await openTalk(first.page);
    copy = await sendTalk(first.page, '今天下午三点开会。');
    assert.equal(/是否保存到数字之我/.test(copy), false);
    await openDigitalSelf(first.page);
    const afterMeeting = await first.page.locator('#digital-self-page').innerText();
    assert.equal(/三点开会/.test(afterMeeting), false);

    await openTalk(first.page);
    await sendTalk(first.page, '工程安全类外部合作我不参与。');
    copy = await sendTalk(
      first.page,
      '刚才说得不准确，我愿意参与低风险工艺安全分析，但高风险工程决策仍要问我。',
    );
    assert.equal(/是否保存到数字之我/.test(copy), false);
    await openDigitalSelf(first.page);
    const bounds = await first.page.locator('#digital-self-page').innerText();
    assert.match(bounds, /低风险|高风险/);
    assert.equal(/不参与工程安全类外部合作/.test(bounds), false);
  } finally {
    await first.close();
  }

  const second = await launchDigitalMeElectron({ extraEnv: STUB_ENV, userData });
  try {
    await skipWelcomeAndEnterShell(second.page);
    await openDigitalSelf(second.page);
    const again = await second.page.locator('#digital-self-page').innerText();
    assert.match(again, /上午/);
    assert.match(again, /低风险|高风险/);
    assert.equal(/三点开会/.test(again), false);
    assert.equal(/不参与工程安全类外部合作/.test(again), false);
  } finally {
    await second.close();
  }
});
