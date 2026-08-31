import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { buildPptxFromMarkdown, collectPptxVisibleTexts, inspectPptxDraftQuality, inspectPptxSlideGeometry, splitMarkdownIntoSlides } from '../export';
import { readZipEntries } from '../zip';
import { makeTempDir } from './helpers';
import {
  buildAerospaceBioLearningPlanMarkdown,
  buildFixturePptMarkdown,
  buildOwnerAcceptanceFiles,
} from './feedback-loop-02-fixtures';

test('PPT 基础版式：封面/要点/双栏/结论、主题色、页码、拆页、文本框边界', async () => {
  const md = buildFixturePptMarkdown();
  const drafts = splitMarkdownIntoSlides(md);
  assert.ok(drafts.some((s) => s.kind === 'cover'));
  assert.ok(drafts.some((s) => s.kind === 'bullets' || s.kind === 'two_column'));
  assert.ok(drafts.some((s) => s.kind === 'closing'));
  assert.ok(drafts.every((s) => (s.lines || []).length <= 8));
  const pptx = buildPptxFromMarkdown(md);
  const entries = readZipEntries(pptx);
  const slide1 = (entries.get('ppt/slides/slide1.xml') as Buffer).toString('utf8');
  assert.match(slide1, /产品进展汇报/);
  assert.match(slide1, /srgbClr val="F7F4EE"/);
  assert.match(slide1, /srgbClr val="0F6A5A"/);
  assert.match(slide1, /Microsoft YaHei/);
  assert.match(slide1, /wrap="square"/);
  assert.match(slide1, /1 \/ /);
  assert.ok([...entries.keys()].filter((k) => /ppt\/slides\/slide\d+\.xml/.test(k)).length >= 3);
  const names = [...entries.values()].map((buf) => buf.toString('utf8')).join('\n');
  assert.match(names, /要点|行动|左栏|右栏|标题/);
  assert.match(names, /sz="3200"/);
  const visible = collectPptxVisibleTexts(pptx);
  assert.ok(visible.some((t) => t.startsWith('• ')));
  assert.equal(visible.filter((t) => /••/.test(t) || t.startsWith('• •')).length, 0);
});

test('Markdown 列表只规范化一次，生成文本不得出现双项目符号', () => {
  const md = ['# 封面', '', '例会材料', '', '## 进展', '', '- 完成资料读取闭环', '- 完成姓名跨会话', ''].join('\n');
  const drafts = splitMarkdownIntoSlides(md);
  assert.ok(drafts.some((s) => s.kind === 'bullets' || s.kind === 'two_column' || s.kind === 'closing'));
  for (const slide of drafts) {
    for (const line of slide.lines || []) {
      assert.doesNotMatch(line, /^[•\u2022]/);
      assert.doesNotMatch(line, /••/);
    }
  }
  const texts = collectPptxVisibleTexts(buildPptxFromMarkdown(md));
  const bullets = texts.filter((t) => t.includes('•') || t.includes('\u2022'));
  assert.ok(bullets.length >= 1, `应有项目符号文本，实际=${JSON.stringify(texts)}`);
  assert.ok(bullets.every((t) => !/••|•\s*•/.test(t)));
  assert.ok(bullets.every((t) => (t.match(/•/g) || []).length <= 1));
});

test('现场验收材料：写出中文 PPTX 与 DOCX 绝对路径', async () => {
  const dir = path.join(os.tmpdir(), 'digitalme-owner-accept-20260831');
  await fs.mkdir(dir, { recursive: true });
  const files = buildOwnerAcceptanceFiles();
  const pptxPath = path.join(dir, '产品进展汇报.pptx');
  const docxPath = path.join(dir, '产品进展汇报.docx');
  await fs.writeFile(pptxPath, files.pptx);
  await fs.writeFile(docxPath, files.docx);
  const pptxStat = await fs.stat(pptxPath);
  const docxStat = await fs.stat(docxPath);
  assert.ok(pptxStat.size > 1000);
  assert.ok(docxStat.size > 1000);
  const htmlDir = path.join(dir, 'slide-previews');
  await fs.mkdir(htmlDir, { recursive: true });
  const md = buildFixturePptMarkdown();
  const drafts = splitMarkdownIntoSlides(md);
  const textsBySlide: string[][] = [];
  const pptx = files.pptx;
  const entries = readZipEntries(pptx);
  const slideNames = [...entries.keys()]
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => Number((/slide(\d+)/.exec(a) || [])[1]) - Number((/slide(\d+)/.exec(b) || [])[1]));
  for (const name of slideNames) {
    const xml = (entries.get(name) as Buffer).toString('utf8');
    const texts = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((m) =>
      String(m[1] || '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&'),
    );
    textsBySlide.push(texts);
  }
  const esc = (s: string) => String(s || '').replace(/</g, '&lt;');
  const html = [
    '<!doctype html><meta charset="utf-8"><title>PPT 逐页预览</title>',
    '<style>body{font-family:"Microsoft YaHei",sans-serif;background:#e8e4dc;margin:16px;}',
    '.slide{width:960px;height:540px;background:#F7F4EE;border:1px solid #ccc;margin:16px 0;padding:40px 48px;box-sizing:border-box;position:relative;}',
    '.bar{position:absolute;left:0;top:0;right:0;height:8px;background:#0F6A5A;}',
    'h1{font-size:32px;margin:12px 0 18px;color:#1B2430;} .sub{font-size:18px;color:#5C6773;}',
    '.cover{display:flex;flex-direction:column;justify-content:center;} .cover h1{font-size:36px;}',
    '.cols{display:grid;grid-template-columns:1fr 1fr;gap:28px;}',
    'ul{margin:0;padding-left:1.2em;} li{font-size:18px;margin:10px 0;line-height:1.45;color:#1B2430;}',
    '.page{position:absolute;right:36px;bottom:18px;color:#5C6773;font-size:12px;}</style>',
    ...drafts.map((d, i) => {
      const page = `<p class="page">${i + 1} / ${drafts.length}</p>`;
      if (d.kind === 'cover') {
        return `<section class="slide cover" id="slide-${i + 1}"><div class="bar"></div><h1>${esc(d.title)}</h1><p class="sub">${esc(d.subtitle || d.lines[0] || '')}</p>${page}</section>`;
      }
      if (d.kind === 'two_column') {
        const left = (d.leftLines || []).map((l) => `<li>${esc(l)}</li>`).join('');
        const right = (d.rightLines || []).map((l) => `<li>${esc(l)}</li>`).join('');
        return `<section class="slide" id="slide-${i + 1}"><div class="bar"></div><h1>${esc(d.title)}</h1><div class="cols"><ul>${left}</ul><ul>${right}</ul></div>${page}</section>`;
      }
      const lines = (d.lines || []).map((l) => `<li>${esc(l)}</li>`).join('');
      return `<section class="slide" id="slide-${i + 1}"><div class="bar"></div><h1>${esc(d.title)}</h1><ul>${lines}</ul>${page}</section>`;
    }),
  ].join('\n');
  const htmlPath = path.join(htmlDir, 'index.html');
  await fs.writeFile(htmlPath, html, 'utf8');
  const pngDir = path.join(dir, 'slide-renders');
  await fs.mkdir(pngDir, { recursive: true });
  const conclusions: string[] = [];
  for (let i = 0; i < drafts.length; i += 1) {
    const vis = textsBySlide[i] || [];
    const doubled = vis.some((t) => /••|•\s*•/.test(t));
    conclusions.push(
      `第${i + 1}页 kind=${drafts[i]?.kind} title=${drafts[i]?.title} 双项目符=${doubled ? '有' : '无'} 文本=${vis.join(' | ').slice(0, 120)}`,
    );
  }
  await fs.writeFile(path.join(dir, 'slide-render-notes.txt'), conclusions.join('\n'), 'utf8');
  await makeTempDir('owner-accept-probe');
});

test('航天×生物学习计划：标题完整、多种内容布局、无连续空白双栏', async () => {
  const md = buildAerospaceBioLearningPlanMarkdown();
  const drafts = splitMarkdownIntoSlides(md);
  assert.ok(drafts[0]?.kind === 'cover');
  assert.match(drafts[0]!.title, /航天/);
  assert.doesNotMatch(drafts.map((d) => d.title).join('\n'), /…/);
  const kinds = [...new Set(drafts.filter((d) => d.kind !== 'cover' && d.kind !== 'closing').map((d) => d.kind))];
  assert.ok(kinds.length >= 4, `内容布局种类不足：${kinds.join(',')}`);
  for (let i = 1; i < drafts.length; i += 1) {
    if (drafts[i]?.kind === 'two_column' && drafts[i - 1]?.kind === 'two_column') {
      assert.fail('不得连续重复双栏页');
    }
  }
  const quality = inspectPptxDraftQuality(drafts);
  assert.equal(quality.ok, true, quality.defects.join('；'));
  const pptx = buildPptxFromMarkdown(md);
  const geometry = inspectPptxSlideGeometry(pptx);
  const processPage = drafts.findIndex((d) => d.kind === 'process');
  const timelinePage = drafts.findIndex((d) => d.kind === 'timeline');
  const metricsPage = drafts.findIndex((d) => d.kind === 'metrics');
  assert.ok(processPage >= 0 && geometry[processPage]?.hasProcessNode && geometry[processPage]?.hasArrow, '流程页必须有步骤节点和箭头连接线');
  assert.ok(timelinePage >= 0 && geometry[timelinePage]?.hasAxis, '时间线必须有时间轴');
  assert.ok(metricsPage >= 0 && geometry[metricsPage]?.hasKpiCard, '关键数字页必须有 KPI 卡片');
  assert.equal(geometry.some((g) => g.overflow), false, '存在越界形状');
  for (const g of geometry) {
    const kind = drafts[g.page - 1]?.kind;
    if (kind && kind !== 'cover') {
      assert.ok(g.occupancy >= 0.28, `第${g.page}页占用率过低 ${g.occupancy.toFixed(3)} kind=${kind}`);
    }
  }
  const joinedXml = [...readZipEntries(pptx).entries()]
    .filter(([name]) => /ppt\/slides\/slide\d+\.xml/.test(name))
    .map(([, buf]) => buf.toString('utf8'))
    .join('\n');
  assert.match(joinedXml, /tailEnd/);
  assert.match(joinedXml, /name="时间轴"/);
  assert.match(joinedXml, /name="KPI/);
  assert.match(joinedXml, /Microsoft YaHei/);
  assert.match(joinedXml, /1 \/ /);
  assert.doesNotMatch(collectPptxVisibleTexts(pptx).join('\n'), /••/);
  const compareIdx = drafts.findIndex((d) => d.kind === 'compare');
  assert.ok(compareIdx >= 0);
  const compareXml = (readZipEntries(pptx).get(`ppt/slides/slide${compareIdx + 1}.xml`) as Buffer).toString('utf8');
  assert.match(compareXml, /name="交叉节点"/);
  assert.match(compareXml, /name="交叉标题"/);
  assert.match(compareXml, /name="交叉说明"/);
  const explain = /name="交叉说明"[\s\S]*?<\/p:sp>/.exec(compareXml)?.[0] || '';
  assert.match(explain, /交叉点|乘员健康/);
  assert.match(explain, /srgbClr val="1B2430"/);
  assert.doesNotMatch(explain, /srgbClr val="FFFFFF"/);
  const titleOnDiamond = /name="交叉标题"[\s\S]*?<\/p:sp>/.exec(compareXml)?.[0] || '';
  assert.match(titleOnDiamond, />交叉</);
  assert.match(titleOnDiamond, /srgbClr val="FFFFFF"/);
  for (const [i, draft] of drafts.entries()) {
    if (draft.kind !== 'process') continue;
    const xml = (readZipEntries(pptx).get(`ppt/slides/slide${i + 1}.xml`) as Buffer).toString('utf8');
    const texts = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((m) =>
      String(m[1] || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'),
    );
    for (const t of texts) {
      assert.doesNotMatch(t, /^[、，。；：]/, `流程页第${i + 1}页出现行首孤立标点：${t}`);
    }
  }
  const dir = path.join(os.tmpdir(), 'digitalme-owner-accept-20260831');
  await fs.mkdir(dir, { recursive: true });
  const pptxPath = path.join(dir, '航天生物学习计划.pptx');
  await fs.writeFile(pptxPath, pptx);
  const htmlDir = path.join(dir, 'slide-previews-aerospace');
  await fs.mkdir(htmlDir, { recursive: true });
  const esc = (s: string) => String(s || '').replace(/</g, '&lt;');
  const html = buildAerospaceVisualHtml(drafts, esc);
  await fs.writeFile(path.join(htmlDir, 'index.html'), html, 'utf8');
  await fs.writeFile(
    path.join(dir, 'slide-render-notes-aerospace.txt'),
    drafts.map((d, i) => `${i + 1} ${d.kind} ${d.title}`).join('\n') +
      `\nPPTX=${pptxPath}\nPNG=${path.join(dir, 'slide-renders-aerospace')}\nMONTAGE=${path.join(dir, 'slide-renders-aerospace', 'montage.png')}`,
    'utf8',
  );
  const pngDir = path.join(dir, 'slide-renders-aerospace');
  await fs.mkdir(pngDir, { recursive: true });
  await renderHtmlSlidesToPng(html, pngDir, drafts.length);
});

function buildAerospaceVisualHtml(
  drafts: ReturnType<typeof splitMarkdownIntoSlides>,
  esc: (s: string) => string,
): string {
  const slides = drafts.map((d, i) => {
    const page = `<p class="page">${i + 1} / ${drafts.length} · ${d.kind}</p>`;
    if (d.kind === 'cover') {
      return `<section class="slide" id="slide-${i + 1}"><div class="bar"></div><div class="cover-row"><div><h1>${esc(d.title)}</h1><p class="sub">${esc(d.subtitle || '')}</p></div><svg class="orbit" viewBox="0 0 120 120"><circle cx="60" cy="60" r="54" fill="none" stroke="#0F6A5A" stroke-width="3"/><circle cx="60" cy="60" r="36" fill="none" stroke="#7AA89E" stroke-width="2"/><circle cx="60" cy="60" r="12" fill="#0F6A5A"/></svg></div>${page}</section>`;
    }
    if (d.kind === 'process') {
      const wrapNode = (l: string) => {
        const m = /^([^：:]{1,8}[：:])\s*(.*)$/.exec(l);
        if (!m) return esc(l);
        const bits = m[2] ? m[2].split('、').map((b) => esc(b.trim())).filter(Boolean) : [];
        return `${esc(m[1] || '')}${bits.length ? `<br>${bits.join('<br>')}` : ''}`;
      };
      const nodes = (d.lines || []).map((l, idx) => `<div class="node"><div class="chevron"></div><strong>${idx + 1}</strong><p>${wrapNode(l)}</p></div>`).join('<div class="arrow">→</div>');
      return `<section class="slide" id="slide-${i + 1}"><div class="bar"></div><h1>${esc(d.title)}</h1><p class="sub">流程方向 →</p><div class="flow">${nodes}</div>${page}</section>`;
    }
    if (d.kind === 'timeline') {
      const ticks = (d.lines || []).map((l) => {
        const m = /^(第?\s*\d+\s*[-–—到至]+\s*\d+\s*周)[：:]?\s*(.*)$/.exec(l);
        const range = m ? m[1]!.replace(/\s+/g, '') : '阶段';
        const detail = m ? m[2] : l;
        return `<div class="tick"><p class="range">${esc(range)}</p><div class="diamond"></div><div class="span"></div><p>${esc(detail || l)}</p></div>`;
      }).join('');
      return `<section class="slide" id="slide-${i + 1}"><div class="bar"></div><h1>${esc(d.title)}</h1><div class="timeline"><div class="axis"></div><div class="ticks">${ticks}</div></div>${page}</section>`;
    }
    if (d.kind === 'compare') {
      const stripLabel = (l: string) => l.replace(/^(航天侧|生物侧|交叉点|产出)[：:]?\s*/, '');
      const left = esc(stripLabel((d.lines || []).find((l) => l.includes('航天')) || d.leftLines?.[0] || ''));
      const right = esc(stripLabel((d.lines || []).find((l) => l.includes('生物')) || d.rightLines?.[0] || ''));
      const cross = esc(stripLabel((d.lines || []).find((l) => l.includes('交叉')) || ''));
      const output = esc(stripLabel((d.lines || []).find((l) => l.includes('产出')) || ''));
      return `<section class="slide" id="slide-${i + 1}"><div class="bar"></div><h1>${esc(d.title)}</h1><div class="compare"><div class="pane"><h2>航天侧</h2><p>${left}</p></div><div class="cross-col"><div class="diamond-lg"></div><p class="cross-title">交叉</p><div class="cross-note"><strong>交叉点</strong><p>${cross}</p></div></div><div class="pane alt"><h2>生物侧</h2><p>${right}</p></div></div><div class="output">产出：${output}</div>${page}</section>`;
    }
    if (d.kind === 'metrics') {
      const cards = (d.lines || []).map((l) => {
        const m = /^(\d+)\s*(小时|次|个|周|天)?\s*(.*)$/.exec(l) || [];
        return `<div class="kpi"><div class="num">${esc(m[1] || '')}</div><div class="unit">${esc(m[2] || '')}</div><p>${esc(m[3] || l)}</p></div>`;
      }).join('');
      return `<section class="slide" id="slide-${i + 1}"><div class="bar"></div><h1>${esc(d.title)}</h1><div class="kpis">${cards}</div>${page}</section>`;
    }
    if (d.kind === 'closing') {
      const wrap = (d.lines || []).map((l) => `<div class="wrap-node"><div class="diamond"></div><p>${esc(l)}</p></div>`).join('<div class="wrap-arrow">→</div>');
      const cards = (d.lines || []).map((l, idx) => `<div class="action"><strong>${idx + 1}</strong><p>${esc(l)}</p></div>`).join('');
      return `<section class="slide closing" id="slide-${i + 1}"><div class="bar"></div><div class="closing-top"><div><h1>${esc(d.title)}</h1><div class="wrap-path">${wrap}</div></div><svg class="orbit" viewBox="0 0 120 120"><circle cx="60" cy="60" r="54" fill="none" stroke="#0F6A5A" stroke-width="3"/><circle cx="60" cy="60" r="36" fill="none" stroke="#7AA89E" stroke-width="2"/><circle cx="60" cy="60" r="12" fill="#0F6A5A"/></svg></div><div class="action-band"><p>行动区</p><div class="actions">${cards}</div></div>${page}</section>`;
    }
    const lines = (d.lines || []).map((l) => `<li>${esc(l)}</li>`).join('');
    return `<section class="slide" id="slide-${i + 1}"><div class="bar"></div><h1>${esc(d.title)}</h1><ul>${lines}</ul>${page}</section>`;
  });
  const thumbs = drafts.map((_, i) => `<img src="slide-${i + 1}.png" width="240" height="135" alt="slide ${i + 1}">`).join('');
  return [
    '<!doctype html><meta charset="utf-8"><title>航天生物学习计划逐页</title>',
    '<style>body{font-family:"Microsoft YaHei",sans-serif;background:#e8e4dc;margin:16px;}',
    '.slide{width:960px;height:540px;background:#F7F4EE;border:1px solid #ccc;margin:16px 0;padding:28px 36px;box-sizing:border-box;position:relative;overflow:hidden;}',
    '.bar{position:absolute;left:0;top:0;right:0;height:8px;background:#0F6A5A;}',
    'h1{font-size:28px;margin:8px 0 12px;color:#1B2430;} .sub{color:#5C6673;} .page{position:absolute;right:24px;bottom:12px;color:#5C6673;font-size:12px;}',
    '.cover-row{display:flex;justify-content:space-between;align-items:center;height:420px;} .orbit{width:180px;height:180px;}',
    '.flow{display:flex;align-items:stretch;gap:8px;margin-top:24px;} .node{flex:1;background:#E7F2EE;border-radius:12px;padding:12px;min-height:220px;}',
    '.arrow{display:flex;align-items:center;color:#0F6A5A;font-size:28px;font-weight:700;} .chevron{width:36px;height:16px;background:#0F6A5A;clip-path:polygon(0 0,70% 0,100% 50%,70% 100%,0 100%,30% 50%);margin-bottom:8px;}',
    '.timeline{position:relative;margin-top:8px;height:360px;} .axis{position:absolute;left:12px;right:12px;top:118px;height:6px;background:#0F6A5A;} .ticks{display:flex;gap:12px;position:relative;z-index:1;padding-top:8px;} .tick{flex:1;text-align:center;} .tick .range{color:#0F6A5A;font-weight:700;min-height:48px;} .tick .span{height:8px;background:#0F6A5A;margin:10px 18px 12px;border-radius:4px;} .diamond{width:14px;height:14px;background:#0F6A5A;transform:rotate(45deg);margin:8px auto;}',
    '.compare{display:grid;grid-template-columns:1fr 180px 1fr;gap:12px;align-items:stretch;min-height:280px;} .pane{background:#E7F2EE;border-radius:12px;padding:16px;} .pane.alt{background:#F3EFE6;}',
    '.cross-col{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:8px;} .diamond-lg{width:56px;height:56px;background:#0F6A5A;transform:rotate(45deg);} .cross-title{margin:10px 0 0;color:#FFFFFF;background:#0F6A5A;padding:2px 10px;border-radius:4px;font-weight:700;} .cross-note{background:#D7EDE7;color:#1B2430;border-radius:10px;padding:10px 8px;font-size:13px;} .cross-note strong{color:#0F6A5A;display:block;}',
    '.output{margin-top:12px;background:#D7EDE7;border-radius:10px;padding:10px 14px;}',
    '.kpis{display:grid;grid-template-columns:1fr 1fr;gap:14px;} .kpi{background:#E7F2EE;border-radius:12px;padding:16px;min-height:150px;} .num{font-size:44px;font-weight:700;color:#0F6A5A;line-height:1;} .unit{color:#5C6673;margin:4px 0 8px;}',
    '.closing{padding-bottom:0;} .closing-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;} .wrap-path{display:flex;align-items:center;gap:8px;margin-top:18px;} .wrap-node{flex:1;text-align:center;font-size:13px;} .wrap-arrow{color:#0F6A5A;font-size:22px;font-weight:700;} .action-band{position:absolute;left:0;right:0;bottom:0;background:#0F6A5A;color:#fff;padding:16px 28px 28px;} .actions{display:flex;gap:12px;} .action{flex:1;background:#F7F4EE;color:#1B2430;border-radius:10px;padding:12px;min-height:88px;}',
    '#montage{display:flex;flex-wrap:wrap;gap:8px;background:#d7d0c3;padding:12px;}</style>',
    ...slides,
    `<section id="montage">${thumbs}</section>`,
  ].join('\n');
}

async function renderHtmlSlidesToPng(html: string, pngDir: string, count: number): Promise<void> {
  const playwright = await import('playwright');
  let electronPath: string;
  try {
    electronPath = require('electron') as string;
  } catch {
    throw new Error('渲染 PNG 需要 electron');
  }
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-pptx-png-'));
  const app = await playwright._electron.launch({
    executablePath: electronPath,
    args: [path.resolve(__dirname, '../../../electron/main.cjs')],
    cwd: path.resolve(__dirname, '../../..'),
    timeout: 60_000,
    env: {
      ...process.env,
      DIGITALME_V2_ELECTRON_TEST: '1',
      DIGITALME_V2_SEARCH_ENABLED: '0',
      DIGITALME_V2_USER_DATA: userData,
    },
  });
  try {
    const page = await app.firstWindow();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    for (let i = 1; i <= count; i += 1) {
      const shot = page.locator(`#slide-${i}`);
      await shot.waitFor({ state: 'visible', timeout: 10_000 });
      await shot.screenshot({ path: path.join(pngDir, `slide-${i}.png`) });
    }
    const imgs: string[] = [];
    for (let i = 1; i <= count; i += 1) {
      const buf = await fs.readFile(path.join(pngDir, `slide-${i}.png`));
      imgs.push(`<img src="data:image/png;base64,${buf.toString('base64')}" width="240" height="135" alt="slide ${i}">`);
    }
    await page.setContent(
      `<!doctype html><style>body{margin:0}#montage{display:flex;flex-wrap:wrap;gap:8px;background:#d7d0c3;padding:12px;width:1024px;}</style><div id="montage">${imgs.join('')}</div>`,
      { waitUntil: 'domcontentloaded' },
    );
    await page.locator('#montage').screenshot({ path: path.join(pngDir, 'montage.png') });
  } finally {
    await app.close();
  }
}

