/**
 * 对话等待、取消、迟到回复不得插入当前会话。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launchDigitalMeElectron, skipWelcomeAndEnterShell } from './electron-harness';

test('对话延迟：显示已等待并可取消；迟到回复不插入', { timeout: 180_000 }, async () => {
  const harness = await launchDigitalMeElectron({
    extraEnv: { DIGITALME_V2_CHAT_DELAY_MS: '4000' },
  });
  const { page } = harness;
  try {
    await skipWelcomeAndEnterShell(page);
    await page.locator('#chat-input').fill('延迟回复探测句');
    await page.locator('#btn-chat-send').click();
    await page.waitForTimeout(1200);
    const waiting = (await page.evaluate(`(() => {
      const send = document.getElementById('btn-chat-send');
      const cancel = document.getElementById('btn-chat-cancel');
      const status = document.getElementById('chat-status');
      return {
        sendText: send ? send.textContent : '',
        cancelVisible: !!(cancel && !cancel.hidden),
        status: status ? status.textContent : '',
      };
    })()`)) as { sendText: string; cancelVisible: boolean; status: string };
    assert.match(String(waiting.sendText), /正在发送/);
    assert.equal(waiting.cancelVisible, true);
    assert.match(String(waiting.status), /正在连接|已等待/);

    await page.locator('#btn-chat-cancel').click();
    await page.waitForTimeout(400);
    const afterCancel = await page.locator('#chat-status').innerText();
    assert.match(afterCancel, /取消/);
    const before = await page.locator('#chat-turns').innerText();
    await page.waitForTimeout(4500);
    const after = await page.locator('#chat-turns').innerText();
    assert.equal(after.includes('已收到。') && !before.includes('已收到。'), false);
  } finally {
    await harness.close();
  }
});
