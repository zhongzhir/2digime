import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
} from '../../runtime/tests/electron-harness';

const STUB_ENV = { DIGITALME_V2_DIGITAL_SELF_STUB: '1' };

test('Slice 3B：数字之我只读投影真实协作并从同一 Talk 发起', { timeout: 240_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-slice3b-collab-'));
  const peerDir = path.join(root, 'peer');
  const peer = createDigitalMeRuntime({ documentCapability: 'fake' });
  await peer.createPackage({
    displayName: '项目伙伴乙',
    targetDir: peerDir,
    initialSelfDescription: '我负责共同整理项目材料。',
  });
  await peer.stop();

  const launched = await launchDigitalMeElectron({ extraEnv: STUB_ENV });
  try {
    const { page } = launched;
    await skipWelcomeAndEnterShell(page);
    await page.setViewportSize({ width: 1280, height: 900 });
    const proposed = (await page.evaluate(`window.digitalMe.invoke('collab.interact', ${JSON.stringify({
      action: 'propose',
      granteePackageDir: peerDir,
      intent: '共同整理下一阶段产品验证要点',
      expectedOutcome: '一份双方可核对的验证要点',
      acceptanceCriteria: ['列出验证目标和责任分工'],
      skipAutoEvaluate: true,
    })})`)) as { recordId?: string; status?: string };
    assert.ok(proposed.recordId);
    assert.equal(proposed.status, 'proposed');

    await page.locator('#nav-subject').click();
    await page.locator('#ds-collaboration-summary').waitFor({ state: 'visible' });
    await page.waitForFunction(`document.getElementById('ds-collaboration-summary')?.textContent?.includes('1 项协作')`);
    const cardCopy = await page.locator('#ds-collaboration-title').locator('..').innerText();
    assert.match(cardCopy, /项目伙伴乙/);
    assert.match(cardCopy, /共同整理下一阶段产品验证要点/);
    assert.match(cardCopy, /你发起 · 等待对方确认/);
    assert.equal(cardCopy.includes('proposed'), false);
    assert.equal(cardCopy.includes(String(proposed.recordId)), false);
    assert.equal(cardCopy.includes('A2A'), false);
    assert.equal(cardCopy.includes('exchange'), false);

    const before = (await page.evaluate(`window.digitalMe.invoke('collab.interact', { action: 'list' })`)) as {
      items?: Array<{ recordId: string }>;
    };
    await page.locator('#ds-capability-panel').evaluate((node) => node.setAttribute('hidden', ''));
    const hidden = (await page.evaluate(`window.digitalMe.invoke('collab.interact', { action: 'list' })`)) as {
      items?: Array<{ recordId: string }>;
    };
    assert.deepEqual(hidden.items?.map((item) => item.recordId), before.items?.map((item) => item.recordId));
    await page.locator('#ds-capability-panel').evaluate((node) => node.removeAttribute('hidden'));

    await page.locator('#btn-ds-start-collaboration').click();
    await page.locator('#panel-chat').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#chat-input').inputValue(), '我想发起一项协作：');
    assert.equal(await page.evaluate(`document.activeElement?.id === 'chat-input'`), true);

    await page.locator('#nav-subject').click();
    await page.screenshot({
      path: path.join(os.tmpdir(), 'digital-self-slice3b-collaboration.png'),
      fullPage: true,
    });
  } finally {
    await launched.close();
  }
});
