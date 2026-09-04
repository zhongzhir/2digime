/**
 * Talk UI：模型/工具挂起时必须离开「正在处理」，进入明确失败。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
} from '../../runtime/tests/electron-harness';

test('Electron：Talk 挂起后在期限内离开正在处理', { timeout: 60_000 }, async () => {
  const harness = await launchDigitalMeElectron({
    extraEnv: {
      DIGITALME_V2_DIGITAL_SELF_STUB: '1',
      DIGITALME_V2_TALK_STUB: '1',
      DIGITALME_V2_TALK_STUB_HANG: '1',
      DIGITALME_V2_TALK_TURN_DEADLINE_MS: '1500',
      DIGITALME_V2_TALK_UI_DEADLINE_MS: '4000',
    },
  });
  try {
    await skipWelcomeAndEnterShell(harness.page);
    await harness.page.locator('#chat-input').fill('你好');
    const started = Date.now();
    await harness.page.locator('#btn-chat-send').click();
    await harness.page.locator('[data-talk-processing]').waitFor({
      state: 'visible',
      timeout: 8_000,
    });
    const deadline = Date.now() + 10_000;
    let leftProcessing = false;
    let copy = '';
    while (Date.now() < deadline) {
      const processing = await harness.page.locator('[data-talk-processing]').count();
      copy =
        (await harness.page.locator('#chat-status').innerText()) +
        '\n' +
        (await harness.page.locator('#chat-turns').innerText());
      if (processing === 0 && /超时/.test(copy)) {
        leftProcessing = true;
        break;
      }
      await harness.page.waitForTimeout(150);
    }
    const elapsed = Date.now() - started;
    assert.equal(leftProcessing, true, `仍停留正在处理：${copy}`);
    assert.equal(elapsed < 10_000, true, `失败过慢：${elapsed}ms`);
    assert.equal(copy.includes('正在处理'), false);
  } finally {
    await harness.close();
  }
});

test('Electron：设置测试连接失败展示真实原因，高级项默认折叠', { timeout: 60_000 }, async () => {
  const harness = await launchDigitalMeElectron({
    extraEnv: {
      DIGITALME_V2_DIGITAL_SELF_STUB: '1',
      DIGITALME_V2_TALK_STUB: '1',
    },
  });
  try {
    await skipWelcomeAndEnterShell(harness.page);
    await harness.page.locator('#nav-settings').click();
    await harness.page.locator('#view-settings').waitFor({ state: 'visible', timeout: 15_000 });
    assert.equal(await harness.page.locator('#settings-capability-overview').count(), 0);
    assert.equal(
      await harness.page.evaluate(
        `!!document.querySelector('#settings-optional-remote') && document.querySelector('#settings-optional-remote').open`,
      ),
      false,
    );
    assert.equal(
      await harness.page.evaluate(
        `!!document.querySelector('#settings-optional-coding') && document.querySelector('#settings-optional-coding').open`,
      ),
      false,
    );
    assert.equal(
      await harness.page.evaluate(
        `!!document.querySelector('#settings-optional-professional') && document.querySelector('#settings-optional-professional').open`,
      ),
      false,
    );
    assert.equal(
      await harness.page.evaluate(
        `!!document.querySelector('#advanced-connection') && document.querySelector('#advanced-connection').open`,
      ),
      false,
    );
    await harness.page.locator('#btn-test-model').click();
    await harness.page.locator('#settings-status').waitFor({ state: 'visible', timeout: 10_000 });
    const settingsStatus = await harness.page.locator('#settings-status').innerText();
    assert.match(settingsStatus, /无法连接|请先填写|密钥|连接/);
    assert.equal(settingsStatus.includes('连接成功'), false);
    await harness.page.locator('#settings-tech-detail').waitFor({ state: 'visible', timeout: 5_000 });
    const tech = await harness.page.locator('#settings-tech-body').innerText();
    assert.equal(tech.trim().length > 0, true);
    assert.match(await harness.page.locator('#settings-tech-detail summary').innerText(), /详细原因/);
  } finally {
    await harness.close();
  }
});
