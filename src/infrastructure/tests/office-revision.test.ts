import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import {
  Document,
  Footer,
  Header,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from 'docx';
import { extractFile } from '../extract';
import { locateOfficeRevisionBridge, reviseDocxWithInstalledOffice } from '../office-revision';

function digest(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

test('LibreOffice 原生修改器保留源 DOCX 并另存可回读副本', {
  skip: process.platform !== 'win32' || process.env.DIGITALME_TEST_OFFICE_REVISION !== '1',
  timeout: 120_000,
}, async () => {
  assert.ok(locateOfficeRevisionBridge(), 'Office 修改桥接组件应可定位');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '2digime-office-revision-test-'));
  const source = path.join(root, '复杂模板.docx');
  const output = path.join(root, '复杂模板_修订版.docx');
  const doc = new Document({
    sections: [{
      headers: { default: new Header({ children: [new Paragraph('保留页眉：项目甲')] }) },
      footers: { default: new Footer({ children: [new Paragraph('保留页脚')] }) },
      children: [
        new Paragraph({
          children: [
            new TextRun({ text: '需修订：', bold: true, color: '0F6A5A' }),
            new TextRun({ text: '原始', bold: true, color: '0F6A5A' }),
            new TextRun({ text: '标题', italics: true, color: '0F6A5A' }),
          ],
        }),
        new Table({
          rows: [new TableRow({ children: [
            new TableCell({ children: [new Paragraph('表格字段')] }),
            new TableCell({ children: [new Paragraph('旧值')] }),
          ] })],
        }),
      ],
    }],
  });
  await fs.writeFile(source, await Packer.toBuffer(doc));
  const before = await fs.readFile(source);

  const result = await reviseDocxWithInstalledOffice({
    sourcePath: source,
    outputPath: output,
    replacements: [
      { from: '原始标题', to: '新的标题', expectedCount: 1 },
      { from: '旧值', to: '新值', expectedCount: 1 },
    ],
  });

  assert.equal(digest(await fs.readFile(source)), digest(before), '源文件必须逐字节不变');
  assert.notEqual(result.outputSha256, result.sourceSha256);
  assert.deepEqual(result.replacements.map((row) => row.count), [1, 1]);
  assert.ok(result.replacements.every((row) => row.verifiedCount >= row.count));
  const extracted = await extractFile(output);
  assert.equal(extracted.status, 'ok');
  const text = String(extracted.text || '');
  assert.match(text, /新的标题/);
  assert.match(text, /新值/);
  assert.doesNotMatch(text, /原始标题|旧值/);
});

test('LibreOffice 原生修改器在预期次数不符时不生成副本', {
  skip: process.platform !== 'win32' || process.env.DIGITALME_TEST_OFFICE_REVISION !== '1',
  timeout: 120_000,
}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '2digime-office-revision-guard-'));
  const source = path.join(root, 'source.docx');
  const output = path.join(root, 'should-not-exist.docx');
  await fs.writeFile(source, await Packer.toBuffer(new Document({
    sections: [{ children: [new Paragraph('唯一原文')] }],
  })));
  await assert.rejects(
    reviseDocxWithInstalledOffice({
      sourcePath: source,
      outputPath: output,
      replacements: [{ from: '唯一原文', to: '新内容', expectedCount: 2 }],
    }),
    /预期 2 次，实际 1 次/,
  );
  assert.equal(await fs.stat(output).then(() => true, () => false), false);
});

test('LibreOffice 原生修改器先预检全部替换，拒绝由前项产生的级联匹配', {
  skip: process.platform !== 'win32' || process.env.DIGITALME_TEST_OFFICE_REVISION !== '1',
  timeout: 120_000,
}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), '2digime-office-revision-cascade-'));
  const source = path.join(root, 'source.docx');
  const output = path.join(root, 'should-not-exist.docx');
  await fs.writeFile(source, await Packer.toBuffer(new Document({
    sections: [{ children: [new Paragraph('甲')] }],
  })));
  await assert.rejects(
    reviseDocxWithInstalledOffice({
      sourcePath: source,
      outputPath: output,
      replacements: [
        { from: '甲', to: '乙', expectedCount: 1 },
        { from: '乙', to: '丙', expectedCount: 1 },
      ],
    }),
    /没有找到要替换的原文：乙/,
  );
  assert.equal(await fs.stat(output).then(() => true, () => false), false);
});
