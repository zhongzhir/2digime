import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
} from '../../runtime/tests/electron-harness';

const STUB_ENV = { DIGITALME_V2_DIGITAL_SELF_STUB: '1' };

test('Slice 3A：我的承接身份与授权，数字之我只保留当前理解', { timeout: 240_000 }, async () => {
  const launched = await launchDigitalMeElectron({ extraEnv: STUB_ENV });
  try {
    const { page } = launched;
    await skipWelcomeAndEnterShell(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator('#nav-subject').click();
    await page.locator('#digital-self-page').waitFor({ state: 'visible' });
    await page.locator('#ds-capability-panel').waitFor({ state: 'hidden' });
    await page.locator('#nav-settings').click();
    await page.locator('#view-settings').waitFor({ state: 'visible' });
    await page.locator('#ds-capability-panel').waitFor({ state: 'visible' });
    await page.waitForFunction(`(() => {
      const text = document.getElementById('ds-identity-name')?.textContent || '';
      return Boolean(text && text !== '正在读取…');
    })()`);

    const identityName = await page.locator('#ds-identity-name').innerText();
    const institutionState = await page.locator('#ds-institution-state').innerText();
    const authorizationCount = await page.locator('#ds-authorization-count').innerText();
    assert.ok(identityName.trim());
    assert.match(institutionState, /尚未认证|已连接/);
    assert.equal(authorizationCount, '没有文件夹授权');
    assert.equal((await page.locator('#ds-capability-panel').innerText()).includes('A2A'), false);
    assert.equal((await page.locator('#ds-capability-panel').innerText()).includes('workflow'), false);
    await page.locator('#btn-ds-edit-identity').click();
    await page.locator('#ds-identity-display-input').fill('张三');
    await page.locator('#ds-identity-bio-input').fill('愿意与可信伙伴协作。');
    await page.locator('#ds-identity-phone-input').fill('138 0000 0000');
    await page.locator('#ds-identity-email-input').fill('zhangsan@example.com');
    await page.locator('#btn-ds-save-identity').click();
    await page.waitForFunction(`document.getElementById('ds-identity-name')?.textContent === '张三'`);
    assert.equal(await page.locator('#ds-identity-username').innerText(), '兔机米号：尚未开通');
    assert.equal((await page.locator('#ds-identity-detail').innerText()).includes('用户名'), false);
    assert.match(await page.locator('#ds-identity-phone').innerText(), /未验证/);
    assert.match(await page.locator('#ds-identity-email').innerText(), /未验证/);
    assert.equal((await page.locator('#ds-capability-panel').innerText()).includes('尚未接入'), true);
    await page.locator('#nav-chat').click();
    await page.locator('#nav-settings').click();
    await page.waitForFunction(`document.getElementById('ds-identity-name')?.textContent === '张三'`);
    assert.equal(await page.locator('#ds-capability-panel').evaluate((node) => node.parentElement?.id), 'my-profile-slot');
    await page.evaluate(`(() => {
      for (const node of Array.from(document.querySelectorAll('*'))) {
        if (node instanceof HTMLElement && node.scrollTop) node.scrollTop = 0;
      }
    })()`);
    await page.screenshot({
      path: path.join(os.tmpdir(), 'my-slice3a-identity-authorization.png'),
      fullPage: true,
    });

    const before = (await page.evaluate(`window.digitalMe.invoke('subject.getOverview', {})`)) as {
      subjectId: string;
      displayName: string;
    };
    await page.locator('#ds-capability-panel').evaluate((node) => {
      node.setAttribute('hidden', '');
    });
    await page.locator('#nav-subject').click();
    await page.locator('#btn-ds-tell').click();
    await page.locator('#ds-tell-input').fill('我叫张三');
    await page.locator('#btn-ds-tell-submit').click();
    await page.locator('#digital-self-page .ds-text', { hasText: '张三' }).waitFor({ state: 'visible' });
    const after = (await page.evaluate(`window.digitalMe.invoke('subject.getOverview', {})`)) as {
      subjectId: string;
      displayName: string;
    };
    assert.equal(after.subjectId, before.subjectId);
    assert.equal(after.displayName, before.displayName);

    await page.locator('#ds-capability-panel').evaluate((node) => {
      node.removeAttribute('hidden');
    });
    await page.locator('#nav-settings').click();
    await page.locator('#view-settings').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#filesystem-grant-list').count(), 1);
    assert.equal(await page.locator('#institution-status').count(), 1);
  } finally {
    await launched.close();
  }
});
