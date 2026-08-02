import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { buildDocxFromMarkdown, exportDocx, exportMarkdown } from '../export';
import { readZipEntries } from '../zip';
import { makeTempDir } from './helpers';

const SAMPLE_MD = '# 项目周报\n\n本周完成基础设施。\n\n- 事项一\n- 事项二 & 验证\n\n**加粗**内容';

test('DOCX 结构可解析且包含正文', () => {
  const docx = buildDocxFromMarkdown(SAMPLE_MD);
  const entries = readZipEntries(docx);
  assert.ok(entries.has('[Content_Types].xml'));
  assert.ok(entries.has('_rels/.rels'));
  assert.ok(entries.has('word/document.xml'));
  assert.ok(entries.has('word/styles.xml'));
  const documentXml = (entries.get('word/document.xml') as Buffer).toString('utf8');
  assert.match(documentXml, /w:pStyle w:val="Heading1"/);
  assert.match(documentXml, /项目周报/);
  assert.match(documentXml, /本周完成基础设施/);
  assert.match(documentXml, /事项二 &amp; 验证/); // XML 转义
  assert.match(documentXml, /加粗内容/); // 内联标记剥离
  assert.doesNotMatch(documentXml, /\*\*/);
});

test('exportDocx / exportMarkdown 落盘且不改动源内容', async () => {
  const dir = await makeTempDir('export');
  const md = await exportMarkdown(SAMPLE_MD, path.join(dir, 'report'));
  assert.ok(md.path.endsWith('.md'));
  assert.equal(await fs.readFile(md.path, 'utf8'), SAMPLE_MD); // 导出不改变权威内容
  const docx = await exportDocx(SAMPLE_MD, path.join(dir, 'report'));
  assert.ok(docx.path.endsWith('.docx'));
  const bytes = await fs.readFile(docx.path);
  assert.equal(bytes.readUInt32LE(0), 0x04034b50); // ZIP 本地头签名
  assert.ok(readZipEntries(bytes).has('word/document.xml'));
});
