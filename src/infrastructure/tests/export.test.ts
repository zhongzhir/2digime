import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { buildDocxFromMarkdown, buildPptxFromMarkdown, exportDocx, exportMarkdown, exportPptx, splitMarkdownIntoSlides } from '../export';
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
  assert.match(documentXml, /Microsoft YaHei/);
  assert.match(documentXml, /w:pgMar/);
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

test('PPTX 按标题拆页且含中文字体，不得整篇塞进一页', async () => {
  const md = [
    '# 产品介绍',
    '',
    '这是第一页的说明，包含中文排版要求。',
    '',
    '## 进展',
    '',
    '- 完成文稿',
    '- 完成大纲',
    '',
    '## 下一步',
    '',
    '导出真实 PowerPoint 文件，而不是让用户运行脚本。',
  ].join('\n');
  const drafts = splitMarkdownIntoSlides(md);
  assert.ok(drafts.length >= 3, `expected split slides, got ${drafts.length}`);
  const pptx = buildPptxFromMarkdown(md);
  const entries = readZipEntries(pptx);
  assert.ok(entries.has('[Content_Types].xml'));
  assert.ok(entries.has('ppt/presentation.xml'));
  assert.ok(entries.has('ppt/slides/slide1.xml'));
  assert.ok(entries.has('ppt/slides/slide2.xml'));
  const slide1 = (entries.get('ppt/slides/slide1.xml') as Buffer).toString('utf8');
  assert.match(slide1, /产品介绍/);
  assert.match(slide1, /Microsoft YaHei/);
  assert.match(slide1, /wrap="square"/);
  const dir = await makeTempDir('export-pptx');
  const out = await exportPptx(md, path.join(dir, 'deck'));
  assert.ok(out.path.endsWith('.pptx'));
  const bytes = await fs.readFile(out.path);
  assert.equal(bytes.readUInt32LE(0), 0x04034b50);
  assert.ok(bytes.length > 1000);
});

test('中文长文导出为真实 DOCX 与 PPTX 文件', async () => {
  const md = [
    '# 数字之我使用说明',
    '',
    '这份说明面向普通用户，不要求运行任何脚本或命令。',
    '',
    '## Word 导出',
    '',
    '点击「导出 Word」后，会生成可以用 WPS 或 Microsoft Word 打开的 .docx 文件。中文应完整可读，长句会在页边距内换行。',
    '',
    '## 演示文稿',
    '',
    '点击「导出 PowerPoint」后，会按标题拆成多页幻灯片，而不是把全部文字堆在一页。',
    '',
    '## 失败时',
    '',
    '如果导出没有成功，页面会显示原因和「重试」，不会声称文件已经生成。',
  ].join('\n');
  const dir = await makeTempDir('export-zh');
  const docx = await exportDocx(md, path.join(dir, '说明.docx'));
  const pptx = await exportPptx(md, path.join(dir, '说明.pptx'));
  const docxBytes = await fs.readFile(docx.path);
  const pptxBytes = await fs.readFile(pptx.path);
  assert.ok(docxBytes.length > 800);
  assert.ok(pptxBytes.length > 1000);
  const pptxEntries = readZipEntries(pptxBytes);
  const slideCount = [...pptxEntries.keys()].filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).length;
  assert.ok(slideCount >= 3, `pptx should split slides, got ${slideCount}`);
});
