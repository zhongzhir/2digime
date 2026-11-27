import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
} from '../../runtime/tests/electron-harness';

const STUB_ENV = {
  DIGITALME_V2_DIGITAL_SELF_STUB: '1',
  DIGITALME_V2_TALK_STUB: '1',
};

test('Slice 3-3B：数字之我投影待确认自动化并可暂停、恢复、撤销', { timeout: 240_000 }, async () => {
  const launched = await launchDigitalMeElectron({ extraEnv: STUB_ENV });
  try {
    const { page } = launched;
    await skipWelcomeAndEnterShell(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    const created = (await page.evaluate(`window.digitalMe.invoke('digitalSelf', ${JSON.stringify({
      action: 'automationCreate',
      title: '机构账单摘要',
      goalTemplate: '收到机构账单后生成一份摘要。',
      trigger: { type: 'institution_event', institutionEventType: 'billing.statement.ready' },
      allowedCapabilityIds: ['write_artifact'],
      allowedSubjectIds: ['subj_demo_institution'],
      validUntil: '2027-01-01T00:00:00.000Z',
      maxCostCny: 0,
      humanInLoop: 'before_execution',
    })})`)) as { automation?: { id: string } };
    assert.ok(created.automation?.id);
    await page.evaluate(`window.digitalMe.invoke('digitalSelf', ${JSON.stringify({
      action: 'automationTrigger',
      automationId: created.automation!.id,
      eventKey: 'statement-2026-11',
      triggerType: 'institution_event',
    })})`);

    await page.locator('#nav-subject').click();
    await page.waitForFunction(`document.getElementById('ds-automation-summary')?.textContent?.includes('1 项运行中')`);
    await page.getByRole('button', { name: '设置自动化' }).click();
    await page.waitForFunction(`document.getElementById('chat-input')?.value?.includes('先等我确认')`);
    assert.match(await page.locator('#chat-input').inputValue(), /已连接的机构/);
    await page.locator('#nav-subject').click();
    const card = page.locator('#ds-automation-list .ds-collaboration-item').first();
    const text = await card.innerText();
    assert.match(text, /机构账单摘要/);
    assert.match(text, /机构发来事件时 · 运行中/);
    assert.match(text, /有一次新触发，正在等你确认/);
    assert.equal(text.includes(created.automation!.id), false);
    assert.equal(text.includes('institution_event'), false);
    assert.equal(text.includes('workflow'), false);
    assert.equal(await card.getByRole('button', { name: '确认运行' }).count(), 1);

    page.on('dialog', (dialog) => dialog.accept());
    await card.getByRole('button', { name: '暂停' }).click();
    await page.waitForFunction(`document.getElementById('ds-automation-list')?.textContent?.includes('已暂停')`);
    await page.locator('#ds-automation-list').getByRole('button', { name: '恢复' }).click();
    await page.waitForFunction(`document.getElementById('ds-automation-list')?.textContent?.includes('运行中')`);

    const before = (await page.evaluate(`window.digitalMe.invoke('digitalSelf', { action: 'automationList' })`)) as {
      automations?: Array<{ id: string; lifecycle: string }>;
    };
    await page.locator('#ds-capability-panel').evaluate((node) => node.setAttribute('hidden', ''));
    const hidden = (await page.evaluate(`window.digitalMe.invoke('digitalSelf', { action: 'automationList' })`)) as {
      automations?: Array<{ id: string; lifecycle: string }>;
    };
    assert.deepEqual(hidden.automations, before.automations);
    await page.locator('#ds-capability-panel').evaluate((node) => node.removeAttribute('hidden'));

    await page.locator('#ds-automation-list').getByRole('button', { name: '撤销' }).click();
    await page.waitForFunction(`document.getElementById('ds-automation-list')?.textContent?.includes('已撤销')`);
    assert.equal((await page.locator('#ds-automation-summary').innerText()).includes('需要确认'), false);
    assert.match(await page.locator('#ds-automation-list').innerText(), /已取消，不会执行/);
    await page.screenshot({
      path: path.join(os.tmpdir(), 'digital-self-slice3c-automation.png'),
      fullPage: true,
    });
  } finally {
    await launched.close();
  }
});
