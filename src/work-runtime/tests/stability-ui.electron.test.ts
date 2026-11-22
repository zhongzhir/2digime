/**
 * 稳定性收口已迁到当前用户路径：与兔机米的对话列表、发送和取消。
 * 不恢复已隐藏的 #nav-work，也不再点击做事工作台。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launchDigitalMeElectron, skipWelcomeAndEnterShell } from '../../runtime/tests/electron-harness';

test('对话隔离：A 的迟到结果不得写进新建的 B；回到 A 才看得到 A', { timeout: 180_000 }, async () => {
  const harness = await launchDigitalMeElectron({
    extraEnv: {
      DIGITALME_V2_TALK_STUB: '1',
      DIGITALME_V2_TALK_STUB_DELAY_MS: '1800',
    },
  });
  const { page } = harness;
  try {
    await skipWelcomeAndEnterShell(page);
    await page.locator('#chat-input').fill('alpha-unique-token-aaa 请先记下');
    await page.locator('#btn-chat-send').click();
    await page.locator('#btn-chat-cancel').waitFor({ state: 'visible', timeout: 8_000 });
    await page.locator('#btn-chat-new').click();
    await page.locator('#chat-status', { hasText: '已开始新对话' }).waitFor({ timeout: 8_000 });
    const fresh = await page.locator('#chat-turns').innerText();
    assert.equal(fresh.includes('alpha-unique-token-aaa'), false);
    await page.locator('#chat-session-list button', { hasText: 'alpha-unique-token-aaa' }).click();
    await page.locator('#chat-turns', { hasText: 'alpha-unique-token-aaa' }).waitFor({ timeout: 15_000 });
    await page.locator('#btn-chat-new').click();
    const backToNew = await page.locator('#chat-turns').innerText();
    assert.equal(backToNew.includes('alpha-unique-token-aaa'), false);
  } finally {
    await harness.close();
  }
});

test('历史对话超过 50 条仍留在与兔机米的列表里，选中后不丢', { timeout: 240_000 }, async () => {
  const harness = await launchDigitalMeElectron({
    extraEnv: { DIGITALME_V2_TALK_STUB: '1' },
  });
  const { page } = harness;
  try {
    await skipWelcomeAndEnterShell(page);
    await page.evaluate(`(async () => {
      const api = window.digitalMe;
      for (let i = 0; i < 55; i += 1) {
        await api.conversation.createSession();
        await api.invoke('talk', { text: 'list-item-' + String(i).padStart(3, '0') });
      }
      if (window.TalkPage && typeof window.TalkPage.refresh === 'function') {
        await window.TalkPage.refresh();
      }
    })()`);
    const count = await page.locator('#chat-session-list button').count();
    assert.ok(count > 50, `历史对话应超过 50 条，实际 ${count}`);
    const last = page.locator('#chat-session-list button', { hasText: 'list-item-054' });
    await last.scrollIntoViewIfNeeded();
    await last.click();
    await page.locator('#chat-turns', { hasText: 'list-item-054' }).waitFor({ timeout: 15_000 });
    const still = await page.locator('#chat-session-list button').count();
    assert.ok(still > 50, '选中后列表不得被截成旧的 50 条分页');
    assert.equal(await last.evaluate((el) => el.classList.contains('active')), true);
  } finally {
    await harness.close();
  }
});

test('与兔机米发送中可以取消，取消前状态不会被第二次点击清掉', { timeout: 120_000 }, async () => {
  const harness = await launchDigitalMeElectron({
    extraEnv: {
      DIGITALME_V2_TALK_STUB: '1',
      DIGITALME_V2_TALK_STUB_HANG: '1',
      DIGITALME_V2_TALK_UI_DEADLINE_MS: '30000',
    },
  });
  const { page } = harness;
  try {
    await skipWelcomeAndEnterShell(page);
    await page.locator('#chat-input').fill('请帮我写一份短周报');
    await page.locator('#btn-chat-send').click();
    await page.locator('#btn-chat-cancel').waitFor({ state: 'visible', timeout: 8_000 });
    const sending = await page.locator('#chat-status').innerText();
    assert.match(sending, /正在替你做/);
    assert.equal(await page.locator('#btn-chat-send').isDisabled(), true);
    await page.locator('#btn-chat-send').click({ force: true });
    const still = await page.locator('#chat-status').innerText();
    assert.match(still, /正在替你做/);
    assert.equal(await page.locator('#btn-chat-cancel').isVisible(), true);
    await page.locator('#btn-chat-cancel').click();
    await page.locator('#chat-status', { hasText: '已取消' }).waitFor({ timeout: 8_000 });
  } finally {
    await harness.close();
  }
});
