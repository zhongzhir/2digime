import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { MAX_EXTRACT_CHARS, extractFile, extractFolder } from '../extract';
import { contentDigest } from '../digest';
import { buildDocxFromMarkdown } from '../export';
import { writeZip } from '../zip';
import { buildMinimalPdf, makeTempDir } from './helpers';

test('txt 与 md 抽取', async () => {
  const dir = await makeTempDir('extract-text');
  await fs.writeFile(path.join(dir, 'a.txt'), 'plain text 内容', 'utf8');
  await fs.writeFile(path.join(dir, 'b.md'), '# 标题\r\n正文', 'utf8');
  const txt = await extractFile(path.join(dir, 'a.txt'));
  assert.equal(txt.status, 'ok');
  assert.equal(txt.text, 'plain text 内容');
  const md = await extractFile(path.join(dir, 'b.md'));
  assert.equal(md.status, 'ok');
  assert.equal(md.text, '# 标题\n正文'); // CRLF 已规范化
  assert.equal(md.digest, contentDigest(md.text as string));
});

test('docx 抽取(经导出器往返)', async () => {
  const dir = await makeTempDir('extract-docx');
  const docxPath = path.join(dir, 'doc.docx');
  await fs.writeFile(docxPath, buildDocxFromMarkdown('# 会议纪要\n\n第一段结论。\n\n- 要点一'));
  const outcome = await extractFile(docxPath);
  assert.equal(outcome.status, 'ok');
  assert.match(outcome.text as string, /会议纪要/);
  assert.match(outcome.text as string, /第一段结论/);
  assert.match(outcome.text as string, /要点一/);
});

test('pptx 抽取(幻灯片顺序)', async () => {
  const dir = await makeTempDir('extract-pptx');
  const slide = (text: string) =>
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>${text}</a:t></a:p></p:sld>`;
  const pptx = writeZip([
    { name: 'ppt/slides/slide2.xml', data: Buffer.from(slide('第二页'), 'utf8') },
    { name: 'ppt/slides/slide1.xml', data: Buffer.from(slide('第一页'), 'utf8') },
  ]);
  const pptxPath = path.join(dir, 'deck.pptx');
  await fs.writeFile(pptxPath, pptx);
  const outcome = await extractFile(pptxPath);
  assert.equal(outcome.status, 'ok');
  assert.ok(
    (outcome.text as string).indexOf('第一页') < (outcome.text as string).indexOf('第二页'),
    'slides must be ordered numerically',
  );
});

test('pdf 抽取', async () => {
  const dir = await makeTempDir('extract-pdf');
  const pdfPath = path.join(dir, 'doc.pdf');
  await fs.writeFile(pdfPath, buildMinimalPdf('Hello PDF Extraction'));
  const outcome = await extractFile(pdfPath);
  assert.equal(outcome.status, 'ok');
  assert.match(outcome.text as string, /Hello PDF Extraction/);
});

test('大文本截断:digest / length / 正文一致且幂等', async () => {
  const dir = await makeTempDir('extract-trunc');
  const bigPath = path.join(dir, 'big.txt');
  await fs.writeFile(bigPath, 'x'.repeat(MAX_EXTRACT_CHARS + 50_000), 'utf8');
  const first = await extractFile(bigPath);
  assert.equal(first.status, 'ok');
  assert.equal(first.truncated, true);
  assert.equal(first.length, MAX_EXTRACT_CHARS);
  assert.equal((first.text as string).length, MAX_EXTRACT_CHARS);
  assert.equal(first.digest, contentDigest(first.text as string)); // digest 基于截断后正文
  const second = await extractFile(bigPath);
  assert.equal(second.digest, first.digest); // 重复抽取幂等
});

test('文件夹枚举:单文件失败降级 warning,不终止整体', async () => {
  const dir = await makeTempDir('extract-folder');
  await fs.mkdir(path.join(dir, 'nested'), { recursive: true });
  await fs.writeFile(path.join(dir, 'good.txt'), '有效材料', 'utf8');
  await fs.writeFile(path.join(dir, 'nested', 'also-good.md'), '# 嵌套', 'utf8');
  await fs.writeFile(path.join(dir, 'bad.docx'), Buffer.from('this is not a zip'), 'utf8');
  await fs.writeFile(path.join(dir, 'skip.exe'), Buffer.from([0x4d, 0x5a]));

  const outcomes = await extractFolder(dir);
  assert.equal(outcomes.length, 4); // exe 以 warning 记录，便于材料透明度
  const ok = outcomes.filter((o) => o.status === 'ok');
  const warnings = outcomes.filter((o) => o.status === 'warning');
  assert.equal(ok.length, 2);
  assert.equal(warnings.length, 2);
  const badDocx = warnings.find((w) => /bad\.docx$/.test(w.sourcePath));
  const skipExe = warnings.find((w) => /skip\.exe$/.test(w.sourcePath));
  assert.ok(badDocx);
  assert.match(badDocx!.warning as string, /无法读取|extraction failed/);
  assert.ok(skipExe);
  assert.match(skipExe!.warning as string, /格式暂不支持/);
});

test('不支持类型与缺失文件 → warning 而非抛错', async () => {
  const dir = await makeTempDir('extract-warn');
  await fs.writeFile(path.join(dir, 'image.png'), Buffer.from([0x89, 0x50]));
  const unsupported = await extractFile(path.join(dir, 'image.png'));
  assert.equal(unsupported.status, 'warning');
  assert.match(unsupported.warning as string, /格式暂不支持|unsupported/);
  const missing = await extractFile(path.join(dir, 'missing.txt'));
  assert.equal(missing.status, 'warning');
});
