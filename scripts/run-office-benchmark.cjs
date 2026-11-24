const assert = require('node:assert/strict');
const { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, promises: fs } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const { exportDocx, exportPdf, exportPptx } = require('../dist/infrastructure/export.js');
const { extractFile } = require('../dist/infrastructure/extract.js');
const { readZipEntries } = require('../dist/infrastructure/zip.js');

const PIXEL = readFileSync(path.join(__dirname, '..', 'brands', 'demo-telecom', 'icon.png')).toString('base64');
const CASES = [
  { id: '01-report', marker: '基准报告一号', markdown: '# 基准报告一号\n\n## 摘要\n\n本报告用于验证中文标题、正文、层级与页眉页脚。\n\n## 结论\n\n- 结论一：成果必须可编辑\n- 结论二：成果必须可回读' },
  { id: '02-minutes', marker: '会议纪要二号', markdown: '# 会议纪要二号\n\n## 议题\n\n讨论产品能力集成。\n\n## 决议\n\n- 下周完成验证\n- 负责人复核结果\n- 风险事项单独记录' },
  { id: '03-table', marker: '数据附件三号', markdown: '# 数据附件三号\n\n| 指标 | 本期 | 上期 | 变化 |\n|---|---:|---:|---:|\n| 用户数 | 1280 | 1100 | 16.4% |\n| 完成率 | 96% | 91% | 5个百分点 |\n| 响应时间 | 2.4秒 | 3.1秒 | -22.6% |\n\n## 说明\n\n表格必须真实存在并可读取。' },
  { id: '04-image', marker: '图片附件四号', markdown: `# 图片附件四号\n\n正文说明图片属于同一成果。\n\n![测试色块](${`data:image/png;base64,${PIXEL}`})\n\n## 结论\n\n图片与题注必须进入文件。` },
  { id: '05-bilingual', marker: '双语简报五号', markdown: '# 双语简报五号 / Bilingual Brief\n\n## 中文摘要\n\n兔机米将成果交付给用户。\n\n## English Summary\n\nDigital Me delivers an editable artifact to its owner.' },
  { id: '06-checklist', marker: '执行清单六号', markdown: '# 执行清单六号\n\n## 发布前\n\n- 核对文件结构\n- 核对逐页渲染\n- 核对真实回读\n- 核对撤销边界\n\n## 完成标准\n\n每项均有可核验证据。' },
  { id: '07-comparison', marker: '方案比较七号', markdown: '# 方案比较七号\n\n## 路线对比\n\n| 方案 | 优点 | 代价 |\n|---|---|---|\n| 成熟库集成 | 能力完整 | 增加依赖 |\n| 手写格式 | 依赖少 | 维护成本高 |\n\n## 推荐\n\n采用成熟库集成。' },
  { id: '08-timeline', marker: '十二周计划八号', markdown: '# 十二周计划八号\n\n## 时间线\n\n- 第1—2周：建立基准\n- 第3—5周：接入成熟能力\n- 第6—8周：完成真实任务\n- 第9—12周：验收与收束\n\n## 下一步\n\n先关闭当前小批次。' },
  { id: '09-memo', marker: '机构备忘九号', markdown: '# 机构备忘九号\n\n## 背景\n\n机构只能读取明确授权的最小信息。\n\n## 边界\n\n不得读取私人对话、文件和数字之我。\n\n## 行动\n\n用沙箱验证授权与撤销。' },
  { id: '10-long', marker: '长文验收十号', markdown: ['# 长文验收十号', '', ...Array.from({ length: 36 }, (_, i) => `## 第${i + 1}节\n\n这是第${i + 1}节的中文正文，用于验证自动分页、跨页渲染和末尾内容没有丢失。`)].join('\n\n') },
];

async function main() {
  const outRoot = process.env.DIGITALME_OFFICE_BENCHMARK_DIR || path.join(os.tmpdir(), 'digitalme-office-benchmark-slice2a3');
  if (process.env.DIGITALME_OFFICE_BENCHMARK_REUSE !== '1') {
    await fs.rm(outRoot, { recursive: true, force: true });
  }
  await fs.mkdir(outRoot, { recursive: true });
  const soffice = findSoffice();
  const pdfinfo = findCommand('pdfinfo');
  const pdftoppm = findCommand('pdftoppm');
  assert.ok(soffice, 'LibreOffice soffice 未找到，不能执行真实 Office 渲染门。');
  assert.ok(pdfinfo && pdftoppm, 'Poppler pdfinfo/pdftoppm 未找到，不能执行逐页视觉门。');

  const results = [];
  for (const format of ['docx', 'pptx', 'pdf']) {
    const formatDir = path.join(outRoot, format);
    await fs.mkdir(formatDir, { recursive: true });
    for (const item of CASES) {
      const source = path.join(formatDir, `${item.id}.${format}`);
      const exported = format === 'docx'
        ? await exportDocx(item.markdown, source)
        : format === 'pptx'
          ? await exportPptx(item.markdown, source)
          : await exportPdf(item.markdown, source);
      const extracted = await extractFile(exported.path);
      assert.equal(extracted.status, 'ok', `${format}/${item.id} 无法真实回读`);
      assert.match(extracted.text || '', new RegExp(item.marker), `${format}/${item.id} 缺少标记正文`);
      const structure = await inspectStructure(format, exported.path, item.id);
      const renderedPdf = format === 'pdf'
        ? exported.path
        : await convertToPdf(soffice, exported.path, path.join(formatDir, 'rendered'));
      const pages = renderPages(pdfinfo, pdftoppm, renderedPdf, path.join(formatDir, 'pages', item.id));
      if (format === 'pptx' && item.id === '10-long') {
        assert.ok(pages.length <= 12, `长文演示稿被拆成 ${pages.length} 页，信息密度过低`);
      }
      results.push({ format, id: item.id, marker: item.marker, source: exported.path, renderedPdf, pages, structure, ok: true });
    }
  }
  const passed = results.filter((row) => row.ok).length;
  const score = passed / results.length;
  assert.ok(score >= 0.95, `Office 固定任务完成率 ${(score * 100).toFixed(1)}%，低于 95%`);
  const report = {
    generatedAt: new Date().toISOString(),
    taskCount: results.length,
    passed,
    score,
    tools: { soffice, pdfinfo, pdftoppm },
    results,
  };
  await fs.writeFile(path.join(outRoot, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  await writeMontageHtml(outRoot, results);
  await renderMontages(outRoot);
  console.log(`OFFICE_BENCHMARK_PASS ${passed}/${results.length} ${(score * 100).toFixed(1)}%`);
  console.log(`OUTPUT ${outRoot}`);
}

async function inspectStructure(format, source, id) {
  const bytes = await fs.readFile(source);
  if (format === 'pdf') {
    assert.equal(bytes.subarray(0, 5).toString('ascii'), '%PDF-', `${id} PDF 签名错误`);
    return { bytes: bytes.length, signature: '%PDF-' };
  }
  const entries = readZipEntries(bytes);
  if (format === 'docx') {
    assert.ok(entries.has('word/document.xml'), `${id} 缺少 Word 正文`);
    assert.ok([...entries.keys()].some((name) => /^word\/header\d+\.xml$/.test(name)), `${id} 缺少页眉`);
    assert.ok([...entries.keys()].some((name) => /^word\/footer\d+\.xml$/.test(name)), `${id} 缺少页脚`);
    if (id === '03-table' || id === '07-comparison') assert.match(entries.get('word/document.xml').toString('utf8'), /<w:tbl>/, `${id} 缺少真实表格`);
    if (id === '04-image') assert.ok([...entries.keys()].some((name) => /^word\/media\//.test(name)), `${id} 缺少嵌入图片`);
  } else {
    assert.ok(entries.has('ppt/presentation.xml'), `${id} 缺少 PowerPoint 主文档`);
    if (id === '03-table' || id === '07-comparison') assert.ok([...entries.values()].some((buf) => buf.toString('utf8').includes('<a:tbl>')), `${id} 缺少真实表格`);
    if (id === '04-image') assert.ok([...entries.keys()].some((name) => /^ppt\/media\//.test(name)), `${id} 缺少嵌入图片`);
  }
  return { bytes: bytes.length, entries: entries.size };
}

async function convertToPdf(soffice, source, outDir) {
  await fs.mkdir(outDir, { recursive: true });
  const pdf = path.join(outDir, `${path.basename(source, path.extname(source))}.pdf`);
  if (process.env.DIGITALME_OFFICE_BENCHMARK_REUSE === '1' && existsSync(pdf)) return pdf;
  const profile = path.join(outDir, `.lo-${path.basename(source).replace(/[^A-Za-z0-9.-]/g, '_')}`);
  await fs.mkdir(profile, { recursive: true });
  const profileUri = `file:///${profile.replace(/\\/g, '/')}`;
  const run = spawnSync(soffice, [`-env:UserInstallation=${profileUri}`, '--headless', '--convert-to', 'pdf', '--outdir', outDir, source], { encoding: 'utf8', timeout: 120000, windowsHide: true });
  assert.equal(run.status, 0, `LibreOffice 渲染失败 ${source}: ${run.stderr || run.stdout}`);
  assert.ok(existsSync(pdf), `LibreOffice 未生成 PDF: ${source}`);
  return pdf;
}

function renderPages(pdfinfo, pdftoppm, pdf, prefix) {
  const info = spawnSync(pdfinfo, [pdf], { encoding: 'utf8', timeout: 60000, windowsHide: true });
  assert.equal(info.status, 0, `pdfinfo 失败 ${pdf}`);
  const count = Number(/^Pages:\s+(\d+)/m.exec(info.stdout)?.[1] || 0);
  assert.ok(count > 0, `PDF 页数无效 ${pdf}`);
  mkdirSync(path.dirname(prefix), { recursive: true });
  for (const name of readdirSync(path.dirname(prefix))) {
    if (name.startsWith(`${path.basename(prefix)}-`) && name.endsWith('.png')) {
      unlinkSync(path.join(path.dirname(prefix), name));
    }
  }
  const rendered = spawnSync(pdftoppm, ['-png', '-r', '96', pdf, prefix], { encoding: 'utf8', timeout: 120000, windowsHide: true });
  assert.equal(rendered.status, 0, `pdftoppm 失败 ${pdf}: ${rendered.stderr}`);
  const pageFiles = readdirSync(path.dirname(prefix))
    .filter((name) => name.startsWith(`${path.basename(prefix)}-`) && name.endsWith('.png'))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  assert.equal(pageFiles.length, count, `逐页 PNG 数量与 PDF 页数不一致: ${pdf}`);
  const pages = [];
  for (let i = 0; i < pageFiles.length; i += 1) {
    const png = path.join(path.dirname(prefix), pageFiles[i]);
    assert.ok(existsSync(png), `缺少第 ${i} 页 PNG: ${pdf}`);
    const bytes = readFileSync(png);
    assert.equal(bytes.subarray(1, 4).toString('ascii'), 'PNG', `第 ${i} 页不是 PNG: ${pdf}`);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    assert.ok(bytes.length > 1000 && width > 300 && height > 200, `第 ${i} 页渲染异常: ${pdf}`);
    pages.push({ png, bytes: bytes.length, width, height });
  }
  return pages;
}

async function writeMontageHtml(outRoot, results) {
  const sections = [];
  for (const format of ['docx', 'pptx', 'pdf']) {
    const images = results.filter((row) => row.format === format).flatMap((row) => row.pages.map((page, index) => {
      const data = readFileSync(page.png).toString('base64');
      return `<figure><img src="data:image/png;base64,${data}"><figcaption>${row.id} · p${index + 1}</figcaption></figure>`;
    })).join('');
    sections.push(`<div class="format" id="montage-${format}"><h1>${format.toUpperCase()} 逐页渲染</h1><section>${images}</section></div>`);
  }
  const html = `<!doctype html><meta charset="utf-8"><style>body{font-family:Arial,"Microsoft YaHei";background:#ddd;margin:20px}section{display:grid;grid-template-columns:repeat(5,1fr);gap:12px}figure{background:#fff;margin:0;padding:8px}img{width:100%;height:180px;object-fit:contain;background:#eee}figcaption{font-size:12px;margin-top:4px}</style>${sections.join('')}`;
  await fs.writeFile(path.join(outRoot, 'montage.html'), html, 'utf8');
}

async function renderMontages(outRoot) {
  const { launchDigitalMeElectron } = require('../dist/runtime/tests/electron-harness.js');
  const harness = await launchDigitalMeElectron({ extraEnv: { DIGITALME_V2_SEARCH_ENABLED: '0' } });
  try {
    await harness.page.goto(pathToFileURL(path.join(outRoot, 'montage.html')).href, { waitUntil: 'load' });
    for (const format of ['docx', 'pptx', 'pdf']) {
      const montage = harness.page.locator(`#montage-${format}`);
      await montage.waitFor({ state: 'visible', timeout: 10000 });
      await montage.screenshot({ path: path.join(outRoot, `montage-${format}.png`) });
    }
  } finally {
    await harness.close();
  }
}

function findSoffice() {
  const candidates = [process.env.DIGITALME_SOFFICE, 'C:\\Program Files\\LibreOffice\\program\\soffice.exe', findCommand('soffice')];
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

function findCommand(name) {
  const found = spawnSync('where.exe', [name], { encoding: 'utf8', windowsHide: true });
  return found.status === 0 ? found.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) : undefined;
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
