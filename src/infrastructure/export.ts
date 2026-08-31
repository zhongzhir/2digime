import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { writeZip, readZipEntries } from './zip';

/**
 * 导出器:Markdown → .md / .docx / .pptx（真实 OOXML，Word/WPS、PowerPoint/WPS 可打开）。
 * 导出是只读投影:不回写、不改变 Artifact 权威内容。
 */
const CJK_FONT = 'Microsoft YaHei';
const LATIN_FONT = 'Calibri';
const DOCX_PAGE_WIDTH = 11906;
const DOCX_PAGE_HEIGHT = 16838;
const DOCX_MARGIN = 1440;
const PPTX_SLIDE_CX = 12192000;
const PPTX_SLIDE_CY = 6858000;
const PPTX_TITLE_MAX = 32;
const PPTX_LINE_MAX = 28;
const PPTX_BODY_LINES = 8;
const PPTX_ACCENT = '0F6A5A';
const PPTX_BG = 'F7F4EE';
const PPTX_INK = '1B2430';
const PPTX_MUTED = '5C6773';
const PPTX_CONTENT_TITLE_PT = 32;
const PPTX_CONTENT_BODY_PT = 18;

export async function exportMarkdown(markdown: string, targetPath: string): Promise<{ path: string }> {
  const finalPath = ensureExtension(targetPath, '.md');
  await fs.mkdir(path.dirname(finalPath), { recursive: true });
  await fs.writeFile(finalPath, markdown, 'utf8');
  return { path: finalPath };
}

export async function exportDocx(markdown: string, targetPath: string): Promise<{ path: string }> {
  const finalPath = ensureExtension(targetPath, '.docx');
  await fs.mkdir(path.dirname(finalPath), { recursive: true });
  await fs.writeFile(finalPath, buildDocxFromMarkdown(markdown));
  return { path: finalPath };
}

export async function exportPptx(markdown: string, targetPath: string): Promise<{ path: string }> {
  const finalPath = ensureExtension(targetPath, '.pptx');
  await fs.mkdir(path.dirname(finalPath), { recursive: true });
  await fs.writeFile(finalPath, buildPptxFromMarkdown(markdown));
  return { path: finalPath };
}

/** 幻灯片可见正文（含项目符号）。用于断言列表只规范化一次。 */
export function inspectPptxSlideGeometry(pptx: Buffer): Array<{
  page: number;
  overflow: boolean;
  occupancy: number;
  hasArrow: boolean;
  hasAxis: boolean;
  hasKpiCard: boolean;
  hasProcessNode: boolean;
}> {
  const entries = readZipEntries(pptx);
  const names = [...entries.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => {
    const na = Number((/slide(\d+)/.exec(a) || [])[1] || 0);
    const nb = Number((/slide(\d+)/.exec(b) || [])[1] || 0);
    return na - nb;
  });
  return names.map((name, index) => {
    const xml = (entries.get(name) as Buffer).toString('utf8');
    let occupied = 0;
    let overflow = false;
    const boxes = [
      ...xml.matchAll(
        /<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(-?\d+)" cy="(-?\d+)"\/>/g,
      ),
    ];
    for (const box of boxes) {
      const x = Number(box[1]);
      const y = Number(box[2]);
      const cx = Number(box[3]);
      const cy = Number(box[4]);
      if (x === 0 && y === 0 && cx >= PPTX_SLIDE_CX - 1000 && cy >= PPTX_SLIDE_CY - 1000) continue;
      if (x < -20000 || y < -20000 || x + cx > PPTX_SLIDE_CX + 20000 || y + cy > PPTX_SLIDE_CY + 20000) {
        overflow = true;
      }
      occupied += Math.max(0, cx) * Math.max(0, cy);
    }
    return {
      page: index + 1,
      overflow,
      occupancy: occupied / (PPTX_SLIDE_CX * PPTX_SLIDE_CY),
      hasArrow: /tailEnd/.test(xml),
      hasAxis: /name="时间轴"/.test(xml),
      hasKpiCard: /name="KPI/.test(xml) && /sz="4[0-9]00"/.test(xml),
      hasProcessNode: /name="步骤节点/.test(xml),
    };
  });
}

/** 幻灯片可见正文（含项目符号）。用于断言列表只规范化一次。 */
export function collectPptxVisibleTexts(pptx: Buffer): string[] {
  const entries = readZipEntries(pptx);
  const texts: string[] = [];
  const names = [...entries.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort((a, b) => {
    const na = Number((/slide(\d+)/.exec(a) || [])[1] || 0);
    const nb = Number((/slide(\d+)/.exec(b) || [])[1] || 0);
    return na - nb;
  });
  for (const name of names) {
    const xml = (entries.get(name) as Buffer).toString('utf8');
    for (const m of xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)) {
      texts.push(String(m[1] || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    }
  }
  return texts;
}

export function buildDocxFromMarkdown(markdown: string): Buffer {
  const paragraphs = markdownToParagraphs(markdown);
  const body = paragraphs.map(paragraphXml).join('');
  const sectPr =
    `<w:sectPr>` +
    `<w:pgSz w:w="${DOCX_PAGE_WIDTH}" w:h="${DOCX_PAGE_HEIGHT}"/>` +
    `<w:pgMar w:top="${DOCX_MARGIN}" w:right="${DOCX_MARGIN}" w:bottom="${DOCX_MARGIN}" w:left="${DOCX_MARGIN}" w:header="720" w:footer="720"/>` +
    `</w:sectPr>`;
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${body}${sectPr}</w:body></w:document>`;

  return writeZip([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES_XML, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS_XML, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(DOCUMENT_RELS_XML, 'utf8') },
    { name: 'word/styles.xml', data: Buffer.from(STYLES_XML, 'utf8') },
  ]);
}

export type PptxSlideKind =
  | 'cover'
  | 'section'
  | 'bullets'
  | 'two_column'
  | 'closing'
  | 'timeline'
  | 'compare'
  | 'metrics'
  | 'process'
  | 'matrix';

export interface PptxSlideDraft {
  kind: PptxSlideKind;
  title: string;
  subtitle?: string;
  lines: string[];
  leftLines?: string[];
  rightLines?: string[];
}

export function rewriteLongTitle(title: string): { title: string; subtitle?: string } {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  if (!t) return { title: '内容' };
  if (t.length <= 22) return { title: t };
  const seps = ['：', ':', '——', '—', ' - ', '（', '('];
  for (const sep of seps) {
    const i = t.indexOf(sep);
    if (i >= 4 && i <= 22) {
      const subtitle = t.slice(i + sep.length).replace(/^[）)]/, '').trim();
      return subtitle ? { title: t.slice(0, i).trim(), subtitle } : { title: t.slice(0, i).trim() };
    }
  }
  const window = t.slice(0, 22);
  const punct = Math.max(
    window.lastIndexOf('，'),
    window.lastIndexOf('、'),
    window.lastIndexOf(' '),
    window.lastIndexOf('的'),
  );
  if (punct >= 8) {
    return { title: t.slice(0, punct).trim(), subtitle: t.slice(punct).trim() };
  }
  return { title: t.slice(0, 18).trim(), subtitle: t.slice(18).trim() };
}

function chooseContentKind(
  block: { title: string; lines: string[] },
  prevKind: PptxSlideKind | undefined,
): PptxSlideKind {
  const blob = `${block.title} ${block.lines.join(' ')}`;
  const candidates: PptxSlideKind[] = [];
  if (/对比|对照|versus|\bvs\.?\b|一边|另一/.test(blob)) candidates.push('compare');
  if (/时间线|十二周|第\s*\d+\s*[-–—到至]?\s*\d*\s*周|里程碑/.test(blob)) candidates.push('timeline');
  if (/\d+\s*小时|关键数字|指标|学时/.test(blob)) candidates.push('metrics');
  if (/步骤|流程|然后|接着|路径/.test(blob)) candidates.push('process');
  if (/矩阵|四象限/.test(blob)) candidates.push('matrix');
  if (block.lines.length >= 4 && block.lines.length <= 8) candidates.push('two_column');
  candidates.push('bullets');
  const picked = candidates.find((k) => k !== prevKind) || 'bullets';
  return picked;
}

export function inspectPptxDraftQuality(slides: readonly PptxSlideDraft[]): {
  ok: boolean;
  defects: string[];
} {
  const defects: string[] = [];
  for (let i = 0; i < slides.length; i += 1) {
    const s = slides[i]!;
    if (/…|\.{3}$/.test(s.title)) defects.push(`第${i + 1}页标题被机械截断`);
    if (s.kind !== 'cover' && s.kind !== 'section' && s.kind !== 'closing') {
      const density = (s.lines || []).filter((l) => l.trim()).length;
      if (density === 0) defects.push(`第${i + 1}页内容空白`);
      if (density === 1 && !(s.subtitle || '').trim()) defects.push(`第${i + 1}页信息密度过低`);
    }
    if (i > 0) {
      const prev = slides[i - 1]!;
      const contentKinds = new Set(['two_column', 'bullets', 'compare', 'timeline', 'metrics', 'process', 'matrix']);
      if (contentKinds.has(s.kind) && s.kind === prev.kind && s.kind === 'two_column') {
        defects.push(`第${i}–${i + 1}页连续重复双栏`);
      }
    }
    if (i >= 2) {
      const a = slides[i - 2]!.kind;
      const b = slides[i - 1]!.kind;
      if (s.kind === a && s.kind === b && s.kind !== 'cover') {
        defects.push(`第${i - 1}–${i + 1}页连续三页使用相同布局 ${s.kind}`);
      }
    }
  }
  return { ok: defects.length === 0, defects };
}

export function splitMarkdownIntoSlides(markdown: string): PptxSlideDraft[] {
  const paragraphs = markdownToParagraphs(markdown);
  const raw: Array<{ title: string; lines: string[]; headingLevel: 1 | 2 | 3 }> = [];
  let current = { title: '内容', lines: [] as string[], headingLevel: 2 as 1 | 2 | 3 };
  const flush = () => {
    if (current.lines.length === 0 && raw.length > 0 && current.title === '内容') return;
    raw.push({
      title: current.title || '内容',
      lines: current.lines.slice(),
      headingLevel: current.headingLevel,
    });
    current = { title: '内容', lines: [], headingLevel: 2 };
  };

  const pushBody = (text: string) => {
    const wrapped = wrapText(text, PPTX_LINE_MAX);
    for (const line of wrapped) {
      if (current.lines.length >= PPTX_BODY_LINES) flush();
      current.lines.push(line);
    }
  };

  for (const p of paragraphs) {
    if (p.style === 'Heading1' || p.style === 'Heading2') {
      if (current.lines.length > 0 || (current.title && current.title !== '内容')) flush();
      current = {
        title: p.text.trim() || '内容',
        lines: [],
        headingLevel: p.style === 'Heading1' ? 1 : 2,
      };
      continue;
    }
    if (p.style === 'Heading3') {
      if (current.lines.length >= PPTX_BODY_LINES - 1) flush();
      pushBody(p.text);
      continue;
    }
    pushBody(p.text);
  }
  if (current.lines.length > 0 || raw.length === 0) flush();
  if (raw.length === 0) {
    raw.push({
      title: '内容',
      lines: wrapText(stripInlineMarkdown(markdown).trim() || '（空）', PPTX_LINE_MAX).slice(0, PPTX_BODY_LINES),
      headingLevel: 1,
    });
  }

  const drafts: PptxSlideDraft[] = [];
  raw.forEach((block, index) => {
    const isLast = index === raw.length - 1;
    const closing = isLast && /结论|行动|下一步|谢谢|总结/.test(block.title);
    const rewritten = rewriteLongTitle(block.title);
    if (index === 0) {
      drafts.push({
        kind: 'cover',
        title: rewritten.title,
        subtitle: rewritten.subtitle || block.lines[0] || 'Digital Me',
        lines: rewritten.subtitle ? block.lines : block.lines.slice(1),
      });
      const overflow = (rewritten.subtitle ? block.lines : block.lines.slice(1)).filter((l) => l.trim());
      if (overflow.length > 4) {
        chunkLines(overflow, PPTX_BODY_LINES).forEach((chunk, i) => {
          drafts.push({
            kind: 'bullets',
            title: i === 0 ? rewritten.title : `${rewritten.title}（续）`,
            lines: chunk,
          });
        });
      }
      return;
    }
    if (block.headingLevel === 1 && block.lines.length === 0) {
      drafts.push({ kind: 'section', title: rewritten.title, lines: [], ...(rewritten.subtitle ? { subtitle: rewritten.subtitle } : {}) });
      return;
    }
    if (closing) {
      drafts.push({
        kind: 'closing',
        title: rewritten.title,
        lines: block.lines.slice(0, PPTX_BODY_LINES),
        ...(rewritten.subtitle ? { subtitle: rewritten.subtitle } : {}),
      });
      return;
    }
    const nonempty = block.lines.filter((l) => l.trim());
    if (nonempty.length === 0) return;
    const prevKind = drafts[drafts.length - 1]?.kind;
    chunkLines(nonempty, PPTX_BODY_LINES).forEach((chunk, i) => {
      const kind = chooseContentKind({ title: rewritten.title, lines: chunk }, i === 0 ? prevKind : drafts[drafts.length - 1]?.kind);
      const draft: PptxSlideDraft = {
        kind,
        title: i === 0 ? rewritten.title : `${rewritten.title}（续）`,
        lines: chunk,
        ...(rewritten.subtitle && i === 0 ? { subtitle: rewritten.subtitle } : {}),
      };
      if (kind === 'two_column' || kind === 'compare') {
        const mid = Math.ceil(chunk.length / 2);
        draft.leftLines = chunk.slice(0, mid);
        draft.rightLines = chunk.slice(mid);
      }
      drafts.push(draft);
    });
  });
  if (drafts.length === 0) {
    drafts.push({ kind: 'cover', title: '内容', subtitle: 'Digital Me', lines: [] });
  }
  return drafts;
}

function chunkLines(lines: string[], size: number): string[][] {
  if (lines.length === 0) return [[]];
  const out: string[][] = [];
  for (let i = 0; i < lines.length; i += size) out.push(lines.slice(i, i + size));
  return out;
}

export function buildPptxFromMarkdown(markdown: string): Buffer {
  const slides = splitMarkdownIntoSlides(markdown);
  const entries: Array<{ name: string; data: Buffer }> = [];
  const slideOverrides: string[] = [];
  const presentationRels: string[] = [
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`,
    `<Relationship Id="rIdTheme" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>`,
  ];
  const sldIdLst: string[] = [];

  slides.forEach((slide, i) => {
    const n = i + 1;
    const rid = `rIdS${n}`;
    sldIdLst.push(`<p:sldId id="${255 + n}" r:id="${rid}"/>`);
    presentationRels.push(
      `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n}.xml"/>`,
    );
    slideOverrides.push(
      `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    );
    entries.push({
      name: `ppt/slides/slide${n}.xml`,
      data: Buffer.from(slideXml(slide, n, slides.length), 'utf8'),
    });
    entries.push({
      name: `ppt/slides/_rels/slide${n}.xml.rels`,
      data: Buffer.from(SLIDE_RELS_XML, 'utf8'),
    });
  });

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>` +
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>` +
    `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>` +
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>` +
    slideOverrides.join('') +
    `</Types>`;

  const presentationXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
    `<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>` +
    `<p:sldIdLst>${sldIdLst.join('')}</p:sldIdLst>` +
    `<p:sldSz cx="${PPTX_SLIDE_CX}" cy="${PPTX_SLIDE_CY}"/>` +
    `<p:notesSz cx="6858000" cy="9144000"/>` +
    `</p:presentation>`;

  const presentationRelsXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    presentationRels.join('') +
    `</Relationships>`;

  return writeZip([
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(PPTX_ROOT_RELS_XML, 'utf8') },
    { name: 'ppt/presentation.xml', data: Buffer.from(presentationXml, 'utf8') },
    { name: 'ppt/_rels/presentation.xml.rels', data: Buffer.from(presentationRelsXml, 'utf8') },
    { name: 'ppt/slideMasters/slideMaster1.xml', data: Buffer.from(SLIDE_MASTER_XML, 'utf8') },
    { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: Buffer.from(SLIDE_MASTER_RELS_XML, 'utf8') },
    { name: 'ppt/slideLayouts/slideLayout1.xml', data: Buffer.from(SLIDE_LAYOUT_XML, 'utf8') },
    { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: Buffer.from(SLIDE_LAYOUT_RELS_XML, 'utf8') },
    { name: 'ppt/theme/theme1.xml', data: Buffer.from(THEME_XML, 'utf8') },
    ...entries,
  ]);
}

interface DocParagraph {
  style: 'Normal' | 'Heading1' | 'Heading2' | 'Heading3';
  text: string;
  list?: boolean;
}

/** 列表标记只剥一次；不得在此处再写入项目符号。 */
export function stripListMarker(text: string): string {
  return String(text || '')
    .replace(/^\s*(?:[-*+]|\u2022|•|·)\s+/, '')
    .trim();
}

function markdownToParagraphs(markdown: string): DocParagraph[] {
  const paragraphs: DocParagraph[] = [];
  let inCodeFence = false;
  for (const rawLine of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trimEnd();
    if (/^```/.test(line.trim())) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (line.trim().length === 0) continue;
    if (inCodeFence) {
      for (const wrapped of wrapText(rawLine, 80)) {
        paragraphs.push({ style: 'Normal', text: wrapped });
      }
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = Math.min((heading[1] as string).length, 3);
      paragraphs.push({
        style: `Heading${level}` as DocParagraph['style'],
        text: stripInlineMarkdown(heading[2] ?? ''),
      });
      continue;
    }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      paragraphs.push({
        style: 'Normal',
        text: stripListMarker(stripInlineMarkdown(bullet[1] ?? '')),
        list: true,
      });
      continue;
    }
    paragraphs.push({ style: 'Normal', text: stripInlineMarkdown(line) });
  }
  return paragraphs;
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
}

function rFontsXml(): string {
  return `<w:rFonts w:ascii="${LATIN_FONT}" w:hAnsi="${LATIN_FONT}" w:eastAsia="${CJK_FONT}" w:cs="${CJK_FONT}"/>`;
}

function paragraphXml(paragraph: DocParagraph): string {
  const styleXml =
    paragraph.style === 'Normal'
      ? `<w:pPr><w:wordWrap w:val="on"/><w:autoSpaceDE w:val="1"/><w:autoSpaceDN w:val="1"/><w:spacing w:after="160"/></w:pPr>`
      : `<w:pPr><w:pStyle w:val="${paragraph.style}"/><w:wordWrap w:val="on"/><w:spacing w:after="160"/></w:pPr>`;
  const text = paragraph.list ? `\u2022 ${paragraph.text}` : paragraph.text;
  return (
    `<w:p>${styleXml}<w:r><w:rPr>${rFontsXml()}</w:rPr>` +
    `<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`
  );
}

function wrapAvoidLeadingPunct(text: string, maxChars: number): string[] {
  const lines = wrapText(text, maxChars);
  const out: string[] = [];
  for (const line of lines) {
    let rest = line;
    while (out.length > 0 && /^[、，。；：,.]/.test(rest)) {
      out[out.length - 1] = `${out[out.length - 1]}${rest[0]}`;
      rest = rest.slice(1).trim();
    }
    if (rest) out.push(rest);
  }
  return out.length ? out : lines;
}

function wrapText(text: string, maxChars: number): string[] {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return [];
  const out: string[] = [];
  let rest = raw;
  while (rest.length > maxChars) {
    let cut = maxChars;
    const window = rest.slice(0, maxChars + 1);
    const punct = Math.max(window.lastIndexOf('，'), window.lastIndexOf('。'), window.lastIndexOf('、'), window.lastIndexOf(' '), window.lastIndexOf('；'));
    if (punct >= Math.floor(maxChars * 0.45)) cut = punct + 1;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function clip(text: string, max: number): string {
  const t = String(text || '').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

function slideXml(slide: PptxSlideDraft, page: number, total: number): string {
  const kind = slide.kind || 'bullets';
  const footer = aParagraph(`${page} / ${total}`, 10, false, PPTX_MUTED);
  const shapes: string[] = [bgRect(), accentBar(kind)];
  const bulletLines = (lines: string[], pt: number) =>
    lines.map((line) => aParagraph(`• ${stripListMarker(line)}`, pt, false, PPTX_INK)).join('');
  if (kind === 'cover') {
    shapes.push(shapeBox(4, '标题', 548640, 1680000, 7800000, 1600000, aParagraph(slide.title, 36, true, PPTX_INK), false));
    shapes.push(
      shapeBox(
        5,
        '副标题',
        548640,
        3600000,
        7800000,
        1600000,
        aParagraph(slide.subtitle || slide.lines[0] || '', 18, false, PPTX_MUTED),
        false,
      ),
    );
    shapes.push(...coverOrbitIcon(40, 9000000, 2200000));
  } else if (kind === 'section') {
    shapes.push(
      shapeBox(4, '章节', 822960, 2200000, 10500000, 2000000, aParagraph(slide.title, 32, true, PPTX_INK), false),
    );
  } else if (kind === 'compare') {
    shapes.push(...compareDiagram(slide));
  } else if (kind === 'two_column') {
    shapes.push(
      shapeBox(
        4,
        '标题',
        548640,
        274320,
        11000000,
        1000000,
        aParagraph(slide.title, PPTX_CONTENT_TITLE_PT, true, PPTX_INK) +
          (slide.subtitle ? aParagraph(slide.subtitle, 14, false, PPTX_MUTED) : ''),
        false,
      ),
    );
    const left = bulletLines(
      slide.leftLines || slide.lines.slice(0, Math.ceil(slide.lines.length / 2)),
      PPTX_CONTENT_BODY_PT,
    );
    const right = bulletLines(
      slide.rightLines || slide.lines.slice(Math.ceil(slide.lines.length / 2)),
      PPTX_CONTENT_BODY_PT,
    );
    shapes.push(shapeBox(5, '左栏', 548640, 1400000, 5300000, 4800000, left || aParagraph(' ', 14, false), true));
    shapes.push(shapeBox(6, '右栏', 6200000, 1400000, 5300000, 4800000, right || aParagraph(' ', 14, false), true));
  } else if (kind === 'process') {
    shapes.push(...processFlow(slide));
  } else if (kind === 'timeline') {
    shapes.push(...timelineAxis(slide));
  } else if (kind === 'metrics') {
    shapes.push(...metricsKpiCards(slide));
  } else if (kind === 'matrix') {
    shapes.push(
      shapeBox(
        4,
        '标题',
        548640,
        274320,
        11000000,
        900000,
        aParagraph(slide.title, PPTX_CONTENT_TITLE_PT, true, PPTX_INK),
        false,
      ),
    );
    const cells = slide.lines.slice(0, 4);
    cells.forEach((line, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = 548640 + col * 5600000;
      const y = 1400000 + row * 2300000;
      shapes.push(roundRect(30 + i, `矩阵${i + 1}`, x, y, 5200000, 2100000, 'E7F2EE'));
      shapes.push(
        shapeBox(40 + i, `矩阵文案${i + 1}`, x + 120000, y + 160000, 4960000, 1780000, aParagraph(stripListMarker(line), 16, false, PPTX_INK), true),
      );
    });
  } else if (kind === 'closing') {
    shapes.push(...closingActionBand(slide));
  } else {
    shapes.push(
      shapeBox(
        4,
        '标题',
        548640,
        274320,
        11000000,
        1000000,
        aParagraph(slide.title, PPTX_CONTENT_TITLE_PT, true, PPTX_INK),
        false,
      ),
    );
    const body = bulletLines(slide.lines, PPTX_CONTENT_BODY_PT);
    shapes.push(shapeBox(5, '要点', 548640, 1180000, 11000000, 5100000, body || aParagraph(' ', 16, false), true));
  }
  shapes.push(shapeBox(200, '页码', 9000000, 6400000, 2500000, 300000, footer, false));
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
    `<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${PPTX_BG}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>` +
    `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
    `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
    shapes.join('') +
    `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
  );
}

function bgRect(): string {
  return filledRect(2, '背景', 0, 0, PPTX_SLIDE_CX, PPTX_SLIDE_CY, PPTX_BG);
}

function accentBar(kind: PptxSlideKind): string {
  if (kind === 'cover' || kind === 'closing') {
    return filledRect(3, '色带', 0, 0, PPTX_SLIDE_CX, 274320, PPTX_ACCENT);
  }
  if (kind === 'section') {
    return filledRect(3, '色带', 0, 0, 274320, PPTX_SLIDE_CY, PPTX_ACCENT);
  }
  return filledRect(3, '色带', 0, 0, PPTX_SLIDE_CX, 137160, PPTX_ACCENT);
}

function filledRect(id: number, name: string, x: number, y: number, cx: number, cy: number, color: string): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
    `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp>`
  );
}

function roundRect(id: number, name: string, x: number, y: number, cx: number, cy: number, color: string): string {
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 12000"/></a:avLst></a:prstGeom>` +
    `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp>`
  );
}

function presetShape(
  id: number,
  name: string,
  prst: string,
  x: number,
  y: number,
  cx: number,
  cy: number,
  fill: string | null,
  lineColor?: string,
): string {
  const fillXml = fill
    ? `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>`
    : `<a:noFill/>`;
  const lineXml = lineColor
    ? `<a:ln w="19050"><a:solidFill><a:srgbClr val="${lineColor}"/></a:solidFill></a:ln>`
    : `<a:ln><a:noFill/></a:ln>`;
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>${fillXml}${lineXml}</p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="zh-CN"/></a:p></p:txBody></p:sp>`
  );
}

function arrowConnector(id: number, name: string, x: number, y: number, cx: number, cy: number): string {
  return (
    `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${Math.max(cx, 20000)}" cy="${Math.max(cy, 20000)}"/></a:xfrm>` +
    `<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>` +
    `<a:ln w="25400"><a:solidFill><a:srgbClr val="${PPTX_ACCENT}"/></a:solidFill>` +
    `<a:tailEnd type="triangle" w="med" len="med"/></a:ln></p:spPr></p:cxnSp>`
  );
}

function coverOrbitIcon(id: number, x: number, y: number): string[] {
  return [
    presetShape(id, '轨道外圈', 'ellipse', x, y, 2200000, 2200000, null, PPTX_ACCENT),
    presetShape(id + 1, '轨道内圈', 'ellipse', x + 280000, y + 280000, 1640000, 1640000, null, '7AA89E'),
    presetShape(id + 2, '航天节点', 'ellipse', x + 860000, y + 860000, 480000, 480000, PPTX_ACCENT),
  ];
}

function processFlow(slide: PptxSlideDraft): string[] {
  const out = [
    shapeBox(
      4,
      '标题',
      548640,
      274320,
      11000000,
      800000,
      aParagraph(slide.title, PPTX_CONTENT_TITLE_PT, true, PPTX_INK) +
        aParagraph('流程方向 →', 12, false, PPTX_MUTED),
      false,
    ),
  ];
  const steps = slide.lines.slice(0, 4);
  const gap = 420000;
  const startX = 360000;
  const nodeW = Math.floor((PPTX_SLIDE_CX - startX * 2 - gap * Math.max(0, steps.length - 1)) / Math.max(steps.length, 1));
  const nodeY = 1980000;
  steps.forEach((line, i) => {
    const x = startX + i * (nodeW + gap);
    out.push(roundRect(50 + i, `步骤节点${i + 1}`, x, nodeY, nodeW, 2920000, i === 0 ? 'D7EDE7' : 'E7F2EE'));
    out.push(presetShape(60 + i, `步骤图标${i + 1}`, 'chevron', x + Math.floor(nodeW / 2) - 350000, nodeY + 160000, 700000, 420000, PPTX_ACCENT));
    const body = wrapAvoidLeadingPunct(stripListMarker(line), 11)
      .map((part) => aParagraph(part, 15, false, PPTX_INK))
      .join('');
    out.push(
      shapeBox(
        70 + i,
        `步骤文案${i + 1}`,
        x + 100000,
        nodeY + 680000,
        nodeW - 200000,
        2100000,
        aParagraph(`${i + 1}`, 20, true, PPTX_ACCENT) + body,
        true,
      ),
    );
    if (i < steps.length - 1) {
      out.push(arrowConnector(80 + i, `流程箭头${i + 1}`, x + nodeW + 40000, nodeY + 1280000, gap - 80000, 40000));
    }
  });
  return out;
}

function timelineAxis(slide: PptxSlideDraft): string[] {
  const out = [
    shapeBox(4, '标题', 548640, 274320, 11000000, 800000, aParagraph(slide.title, PPTX_CONTENT_TITLE_PT, true, PPTX_INK), false),
    filledRect(51, '时间轴', 700000, 3180000, 10800000, 50000, PPTX_ACCENT),
  ];
  const steps = slide.lines.slice(0, 4);
  steps.forEach((line, i) => {
    const x = 900000 + i * 2700000;
    const parsed = parseWeekRange(stripListMarker(line));
    out.push(presetShape(60 + i, `时间节点${i + 1}`, 'diamond', x + 700000, 3000000, 280000, 280000, PPTX_ACCENT));
    out.push(filledRect(70 + i, `阶段范围${i + 1}`, x, 3360000, 2200000, 90000, i % 2 === 0 ? '7AA89E' : '0F6A5A'));
    out.push(
      shapeBox(
        80 + i,
        `阶段${i + 1}`,
        x,
        1400000,
        2300000,
        1500000,
        aParagraph(parsed.range, 14, true, PPTX_ACCENT),
        true,
      ),
    );
    out.push(
      shapeBox(
        90 + i,
        `阶段说明${i + 1}`,
        x,
        3600000,
        2300000,
        2400000,
        aParagraph(parsed.detail, 14, false, PPTX_INK),
        true,
      ),
    );
  });
  return out;
}

function parseWeekRange(line: string): { range: string; detail: string } {
  const m = /^(第?\s*\d+\s*[-–—到至]+\s*\d+\s*周)[：:]?\s*(.*)$/.exec(line);
  if (m) return { range: m[1]!.replace(/\s+/g, ''), detail: m[2]!.trim() || line };
  const m2 = /^(第?\d+周)[：:]?\s*(.*)$/.exec(line);
  if (m2) return { range: m2[1]!, detail: m2[2]!.trim() || line };
  return { range: `阶段`, detail: line };
}

function compareDiagram(slide: PptxSlideDraft): string[] {
  const fields = parseCompareFields(slide);
  const out = [
    shapeBox(4, '标题', 548640, 274320, 11000000, 800000, aParagraph(slide.title, PPTX_CONTENT_TITLE_PT, true, PPTX_INK), false),
    roundRect(50, '对照左底', 480000, 1300000, 4700000, 3600000, 'E7F2EE'),
    roundRect(51, '对照右底', 7000000, 1300000, 4700000, 3600000, 'F3EFE6'),
    presetShape(52, '交叉节点', 'diamond', 5640000, 2480000, 900000, 900000, PPTX_ACCENT),
    arrowConnector(53, '对照箭头左', 5180000, 2900000, 460000, 40000),
    arrowConnector(54, '对照箭头右', 6540000, 2900000, 460000, 40000),
    shapeBox(60, '对照左标题', 600000, 1420000, 4400000, 500000, aParagraph('航天侧', 16, true, PPTX_ACCENT), false),
    shapeBox(61, '对照右标题', 7120000, 1420000, 4400000, 500000, aParagraph('生物侧', 16, true, PPTX_ACCENT), false),
    shapeBox(62, '对照左', 600000, 1960000, 4400000, 2700000, aParagraph(fields.left, 16, false, PPTX_INK), true),
    shapeBox(63, '对照右', 7120000, 1960000, 4400000, 2700000, aParagraph(fields.right, 16, false, PPTX_INK), true),
    shapeBox(64, '交叉标题', 5640000, 2680000, 900000, 500000, aParagraph('交叉', 16, true, 'FFFFFF'), false),
    roundRect(65, '交叉说明底', 5190000, 3480000, 1800000, 1400000, 'D7EDE7'),
    shapeBox(
      66,
      '交叉说明',
      5280000,
      3560000,
      1620000,
      1240000,
      aParagraph('交叉点', 12, true, PPTX_ACCENT) + aParagraph(fields.cross, 14, false, PPTX_INK),
      true,
    ),
    roundRect(70, '产出区', 480000, 5100000, 11220000, 1100000, 'D7EDE7'),
    shapeBox(71, '产出', 600000, 5220000, 10900000, 860000, aParagraph('产出', 14, true, PPTX_ACCENT) + aParagraph(fields.output, 16, false, PPTX_INK), true),
  ];
  return out;
}

function parseCompareFields(slide: PptxSlideDraft): { left: string; right: string; cross: string; output: string } {
  const lines = slide.lines.map((l) => stripListMarker(l));
  const pick = (label: string, fallback: string) => {
    const hit = lines.find((l) => l.startsWith(label));
    return hit ? hit.replace(new RegExp(`^${label}[：:]?`), '').trim() : fallback;
  };
  return {
    left: pick('航天侧', slide.leftLines?.[0] || lines[0] || ''),
    right: pick('生物侧', slide.rightLines?.[0] || lines[1] || ''),
    cross: pick('交叉点', lines[2] || ''),
    output: pick('产出', lines[3] || ''),
  };
}

function metricsKpiCards(slide: PptxSlideDraft): string[] {
  const out = [
    shapeBox(4, '标题', 548640, 274320, 11000000, 800000, aParagraph(slide.title, PPTX_CONTENT_TITLE_PT, true, PPTX_INK), false),
  ];
  slide.lines.slice(0, 4).forEach((line, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 548640 + col * 5600000;
    const y = 1280000 + row * 2400000;
    const parsed = parseMetricLine(stripListMarker(line));
    out.push(roundRect(50 + i, `KPI底${i + 1}`, x, y, 5200000, 2200000, 'E7F2EE'));
    out.push(presetShape(60 + i, `KPI图标${i + 1}`, 'ellipse', x + 200000, y + 280000, 360000, 360000, PPTX_ACCENT));
    out.push(
      shapeBox(
        70 + i,
        `KPI${i + 1}`,
        x + 680000,
        y + 180000,
        4200000,
        1840000,
        aParagraph(parsed.value, 44, true, PPTX_ACCENT) +
          aParagraph(parsed.unit, 14, false, PPTX_MUTED) +
          aParagraph(parsed.caption, 16, false, PPTX_INK),
        true,
      ),
    );
  });
  return out;
}

function parseMetricLine(line: string): { value: string; unit: string; caption: string } {
  const m = /^(\d+(?:\.\d+)?)\s*(小时|次|个|周|天|%|％|[A-Za-z]+)?\s*(.*)$/.exec(line);
  if (!m) return { value: line.slice(0, 8), unit: '', caption: line };
  const value = m[1]!;
  const unit = m[2] || '';
  const rest = (m[3] || '').trim();
  return { value, unit, caption: rest && rest !== line ? rest : rest };
}

function closingActionBand(slide: PptxSlideDraft): string[] {
  const actions = slide.lines.slice(0, 3).map((l) => stripListMarker(l));
  const out = [
    shapeBox(4, '标题', 548640, 360000, 8600000, 700000, aParagraph(slide.title, PPTX_CONTENT_TITLE_PT, true, PPTX_INK), false),
    presetShape(20, '收束轨道外', 'ellipse', 10200000, 380000, 1400000, 1400000, null, PPTX_ACCENT),
    presetShape(21, '收束轨道内', 'ellipse', 10420000, 600000, 960000, 960000, null, '7AA89E'),
    presetShape(22, '收束航天节点', 'ellipse', 10700000, 880000, 400000, 400000, PPTX_ACCENT),
    filledRect(40, '收束线', 700000, 2480000, 10800000, 40000, '7AA89E'),
  ];
  actions.forEach((text, i) => {
    const x = 700000 + i * 3700000;
    out.push(presetShape(41 + i, `收束节点${i + 1}`, 'diamond', x + 1500000, 2360000, 240000, 240000, PPTX_ACCENT));
    out.push(
      shapeBox(
        45 + i,
        `收束文案${i + 1}`,
        x,
        1480000,
        3400000,
        800000,
        aParagraph(text, 14, false, PPTX_INK),
        true,
      ),
    );
    if (i < actions.length - 1) {
      out.push(arrowConnector(48 + i, `收束箭头${i + 1}`, x + 3000000, 2460000, 500000, 40000));
    }
  });
  out.push(filledRect(50, '行动底带', 0, 4300000, PPTX_SLIDE_CX, 2558000, PPTX_ACCENT));
  out.push(shapeBox(51, '行动区标题', 548640, 4480000, 4000000, 400000, aParagraph('行动区', 14, true, 'FFFFFF'), false));
  actions.forEach((text, i) => {
    const x = 480000 + i * 3800000;
    out.push(roundRect(60 + i, `行动卡${i + 1}`, x, 5000000, 3500000, 1400000, 'F7F4EE'));
    out.push(
      shapeBox(
        70 + i,
        `行动${i + 1}`,
        x + 120000,
        5120000,
        3260000,
        1160000,
        aParagraph(`${i + 1}`, 16, true, PPTX_ACCENT) + aParagraph(text, 15, false, PPTX_INK),
        true,
      ),
    );
  });
  return out;
}

function shapeBox(
  id: number,
  name: string,
  x: number,
  y: number,
  cx: number,
  cy: number,
  paragraphs: string,
  clipOverflow: boolean,
): string {
  const fit = clipOverflow ? `<a:normAutofit fontScale="90000" lnSpcReduction="10000"/>` : `<a:noAutofit/>`;
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
    `<p:txBody><a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="t">` +
    `${fit}</a:bodyPr><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`
  );
}

function aParagraph(text: string, pt: number, bold: boolean, color = PPTX_INK): string {
  const sz = pt * 100;
  return (
    `<a:p><a:pPr marL="0" indent="0"><a:lnSpc><a:spcPts val="${Math.round(sz * 1.2)}"/></a:lnSpc></a:pPr>` +
    `<a:r><a:rPr lang="zh-CN" altLang="en-US" sz="${sz}"${bold ? ' b="1"' : ''} dirty="0">` +
    `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>` +
    `<a:latin typeface="${LATIN_FONT}"/><a:ea typeface="${CJK_FONT}"/><a:cs typeface="${CJK_FONT}"/>` +
    `</a:rPr><a:t>${escapeXml(text)}</a:t></a:r><a:endParaRPr lang="zh-CN" sz="${sz}"/></a:p>`
  );
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ensureExtension(filePath: string, ext: string): string {
  return filePath.toLowerCase().endsWith(ext) ? filePath : `${filePath}${ext}`;
}

const FONT_RPR = `<w:rPr>${`<w:rFonts w:ascii="${LATIN_FONT}" w:hAnsi="${LATIN_FONT}" w:eastAsia="${CJK_FONT}" w:cs="${CJK_FONT}"/>`}<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>`;

const CONTENT_TYPES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
  `</Types>`;

const ROOT_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `</Relationships>`;

const DOCUMENT_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `</Relationships>`;

const STYLES_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
  `<w:docDefaults><w:rPrDefault>${FONT_RPR}</w:rPrDefault></w:docDefaults>` +
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>${FONT_RPR}</w:style>` +
  headingStyle(1, 32) +
  headingStyle(2, 28) +
  headingStyle(3, 24) +
  `</w:styles>`;

function headingStyle(level: number, halfPointSize: number): string {
  return (
    `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/>` +
    `<w:basedOn w:val="Normal"/><w:rPr><w:b/>` +
    `<w:rFonts w:ascii="${LATIN_FONT}" w:hAnsi="${LATIN_FONT}" w:eastAsia="${CJK_FONT}" w:cs="${CJK_FONT}"/>` +
    `<w:sz w:val="${halfPointSize}"/><w:szCs w:val="${halfPointSize}"/></w:rPr></w:style>`
  );
}

const PPTX_ROOT_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>` +
  `</Relationships>`;

const SLIDE_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
  `</Relationships>`;

const SLIDE_MASTER_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>` +
  `</Relationships>`;

const SLIDE_LAYOUT_RELS_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>` +
  `</Relationships>`;

const SLIDE_MASTER_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
  `<p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>` +
  `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
  `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld>` +
  `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>` +
  `<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>` +
  `</p:sldMaster>`;

const SLIDE_LAYOUT_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank">` +
  `<p:cSld name="Blank"><p:spTree>` +
  `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
  `<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` +
  `</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const THEME_XML =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
  `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="DigitalMe">` +
  `<a:themeElements><a:clrScheme name="Office">` +
  `<a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>` +
  `<a:dk2><a:srgbClr val="1F4E79"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2>` +
  `<a:accent1><a:srgbClr val="0F6A5A"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2>` +
  `<a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4>` +
  `<a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6>` +
  `<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>` +
  `</a:clrScheme>` +
  `<a:fontScheme name="DigitalMe"><a:majorFont><a:latin typeface="${LATIN_FONT}"/><a:ea typeface="${CJK_FONT}"/><a:cs typeface="${CJK_FONT}"/></a:majorFont>` +
  `<a:minorFont><a:latin typeface="${LATIN_FONT}"/><a:ea typeface="${CJK_FONT}"/><a:cs typeface="${CJK_FONT}"/></a:minorFont></a:fontScheme>` +
  `<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>` +
  `<a:lnStyleLst><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>` +
  `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
  `<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>` +
  `</a:fmtScheme></a:themeElements></a:theme>`;
