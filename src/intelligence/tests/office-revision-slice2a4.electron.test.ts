import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { Document, Footer, Header, Packer, Paragraph, Table, TableCell, TableRow } from 'docx';
import { extractFile } from '../../infrastructure/extract';
import { launchDigitalMeElectron, skipWelcomeAndEnterShell } from '../../runtime/tests/electron-harness';

function digest(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

test('Electron Slice 2A-4：同一 Talk 修改现有复杂 DOCX、另存成果卡且源文件不变', { timeout: 300_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '2digime-2a4-electron-'));
  const source = path.join(root, '复杂模板.docx');
  await fs.writeFile(source, await Packer.toBuffer(new Document({
    sections: [{
      headers: { default: new Header({ children: [new Paragraph('保留页眉')] }) },
      footers: { default: new Footer({ children: [new Paragraph('保留页脚')] }) },
      children: [
        new Paragraph('待替换原文'),
        new Table({ rows: [new TableRow({ children: [
          new TableCell({ children: [new Paragraph('保留表格')] }),
        ] })] }),
      ],
    }],
  })));
  const sourceHash = digest(await fs.readFile(source));
  const harness = await launchDigitalMeElectron({
    extraEnv: {
      DIGITALME_V2_DIGITAL_SELF_STUB: '1',
      DIGITALME_V2_TALK_STUB: '1',
    },
  });
  try {
    await skipWelcomeAndEnterShell(harness.page);
    await harness.page.evaluate(`(async (source) => {
      await window.TalkPage.handleSend('请执行 DOCX修订验证，保留格式并另存新副本。', { contextPaths: [source] });
    })(${JSON.stringify(source)})`);
    const card = harness.page.locator('.talk-result-card').last();
    await card.waitFor({ state: 'visible', timeout: 60_000 });
    assert.match(await card.innerText(), /DOCX修订验证_修订版\.docx/);
    const talk = (await harness.page.evaluate(`(async () => window.digitalMe.invoke('talk', {}))()`)) as {
      view?: { turns?: Array<{ result?: { path?: string } }> };
    };
    const output = [...(talk.view?.turns || [])].reverse().find((turn) => turn.result?.path)?.result?.path;
    assert.ok(output?.endsWith('.docx'));
    const extracted = await extractFile(output!);
    assert.equal(extracted.status, 'ok');
    assert.match(extracted.text || '', /已完成替换/);
    assert.match(extracted.text || '', /保留表格/);
    assert.equal(digest(await fs.readFile(source)), sourceHash);
  } finally {
    await harness.close();
  }
});
