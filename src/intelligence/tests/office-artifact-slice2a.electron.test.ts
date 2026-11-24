import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { extractFile } from '../../infrastructure/extract';
import {
  launchDigitalMeElectron,
  skipWelcomeAndEnterShell,
} from '../../runtime/tests/electron-harness';

test('Electron Slice 2A-1：Talk 生成真实 Word 成果并显示打开卡片', { timeout: 240_000 }, async () => {
  const harness = await launchDigitalMeElectron({
    extraEnv: {
      DIGITALME_V2_DIGITAL_SELF_STUB: '1',
      DIGITALME_V2_TALK_STUB: '1',
    },
  });
  try {
    await skipWelcomeAndEnterShell(harness.page);
    await harness.page.locator('#chat-input').fill('请生成 Office成果验证 Word，保存到应用成果区。');
    await harness.page.locator('#btn-chat-send').click();

    const card = harness.page.locator('.talk-result-card').last();
    await card.waitFor({ state: 'visible', timeout: 30_000 });
    assert.match(await card.innerText(), /Office成果验证\.docx/);
    assert.equal((await card.locator('.talk-result-open').innerText()).trim(), '打开');

    const talk = (await harness.page.evaluate(`(async () => window.digitalMe.invoke('talk', {}))()`)) as {
      view?: { turns?: Array<{ result?: { path?: string } }> };
    };
    const outputPath = [...(talk.view?.turns || [])].reverse().find((turn) => turn.result?.path)?.result?.path;
    assert.ok(outputPath?.endsWith('.docx'));
    const stat = await fs.stat(outputPath!);
    assert.ok(stat.isFile() && stat.size > 1000);
    const extracted = await extractFile(outputPath!);
    assert.equal(extracted.status, 'ok');
    assert.match(extracted.text || '', /Office成果验证/);
    assert.match(extracted.text || '', /真实回读/);
  } finally {
    await harness.close();
  }
});
