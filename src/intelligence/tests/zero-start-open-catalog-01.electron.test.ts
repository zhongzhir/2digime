/**
 * 无 Gemini Key / 无模型的 Discover cold-start：开放目录必须出现真实卡片。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
  isolatedUserDataDir,
} from '../../runtime/tests/electron-harness';

test('Electron Discover zero-key cold start shows open-catalog cards', { timeout: 180_000 }, async () => {
  const userData = await isolatedUserDataDir('dm-zero-key-discover-');
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
    await harness.page.locator('#nav-discover').click();
    await harness.page.locator('#panel-discover').waitFor({ state: 'visible', timeout: 15_000 });
    const deadline = Date.now() + 90_000;
    let view: { cards?: Array<{ title?: string; url?: string }>; notice?: string; replenishing?: boolean } = {};
    while (Date.now() < deadline) {
      view = (await harness.page.evaluate(`(async () => {
        const result = await window.digitalMe.invoke('content', { action: 'discover' });
        let next = result && result.view ? result.view : {};
        if (next.replenishing) {
          const filled = await window.digitalMe.invoke('content', { action: 'replenish' });
          next = filled && filled.view ? filled.view : next;
        }
        return next;
      })()`)) as typeof view;
      if ((view.cards || []).some((card) => /^https:\/\//i.test(String(card.url || '')))) break;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    const cards = view.cards || [];
    assert.ok(cards.some((card) => /^https:\/\//i.test(String(card.url || ''))), 'zero-key Discover should show live open catalog cards');
    assert.equal(/API Key|请配置 Gemini|Google Cloud/.test(String(view.notice || '')), false);
  } finally {
    await harness.close();
  }
});
