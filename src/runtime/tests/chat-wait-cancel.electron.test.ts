/**
 * Talk 等待与取消：迟到回复不得插入当前会话。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { launchDigitalMeElectron, skipWelcomeAndEnterShell } from './electron-harness';

test('对话延迟：显示处理中并可取消；迟到回复不插入', { timeout: 180_000 }, async () => {
  const harness = await launchDigitalMeElectron({
    extraEnv: {
      DIGITALME_V2_TALK_STUB: '1',
      DIGITALME_V2_DIGITAL_SELF_STUB: '1',
      DIGITALME_V2_TALK_STUB_HANG: '1',
    },
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
      const doing = document.querySelector('[data-talk-doing]');
      return {
        sendDisabled: !!(send && send.disabled),
        cancelVisible: !!(cancel && !cancel.hidden),
        status: status ? status.textContent : '',
        doing: doing ? doing.textContent : '',
      };
    })()`)) as { sendDisabled: boolean; cancelVisible: boolean; status: string; doing: string };
    assert.equal(waiting.sendDisabled, true);
    assert.equal(waiting.cancelVisible, true);
    assert.match(String(waiting.status + waiting.doing), /正在替你做|正在查看结果|正在处理/);
    assert.equal(/runtime|provider|executor|IPC|Codex|OpenCode/i.test(waiting.status + waiting.doing), false);

    await page.locator('#btn-chat-cancel').click();
    await page.waitForTimeout(400);
    const afterCancel = await page.locator('#chat-status').innerText();
    assert.match(afterCancel, /取消/);
    const before = await page.locator('#chat-turns').innerText();
    await page.waitForTimeout(1500);
    const after = await page.locator('#chat-turns').innerText();
    assert.equal(after.includes('已收到。') && !before.includes('已收到。'), false);
  } finally {
    await harness.close();
  }
});
