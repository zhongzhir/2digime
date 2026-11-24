import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import PptxGenJS from 'pptxgenjs';
import type { PptxSlideDraft } from './export';

const CJK_FONT = 'Microsoft YaHei';
const INK = '1B2430';
const MUTED = '5C6773';
const ACCENT = '0F6A5A';
const PALE = 'E7F2EE';
const BG = 'F7F4EE';

export interface OfficeTable {
  headers: string[];
  rows: string[][];
}

export interface OfficeImage {
  alt: string;
  type: 'png' | 'jpg';
  data: Buffer;
}

export interface OfficeRichContent {
  markdown: string;
  tables: OfficeTable[];
  images: OfficeImage[];
}

export function extractOfficeRichContent(markdown: string): OfficeRichContent {
  const lines = String(markdown || '').replace(/\r\n?/g, '\n').split('\n');
  const tables: OfficeTable[] = [];
  const images: OfficeImage[] = [];
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] || '';
    const image = /^\s*!\[([^\]]*)\]\(data:image\/(png|jpe?g);base64,([A-Za-z0-9+/=\s]+)\)\s*$/i.exec(line);
    if (image) {
      const type = String(image[2]).toLowerCase() === 'png' ? 'png' : 'jpg';
      const data = Buffer.from(String(image[3] || '').replace(/\s+/g, ''), 'base64');
      if (data.length > 0) images.push({ alt: image[1] || '图片', type, data });
      continue;
    }
    const next = lines[i + 1] || '';
    if (isTableRow(line) && /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(next)) {
      const headers = parseTableRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i] || '')) {
        rows.push(parseTableRow(lines[i] || ''));
        i += 1;
      }
      i -= 1;
      tables.push({ headers, rows });
      continue;
    }
    kept.push(line);
  }
  return { markdown: kept.join('\n'), tables, images };
}

export async function buildMatureDocxFromMarkdown(markdown: string): Promise<Buffer> {
  const rich = extractOfficeRichContent(markdown);
  const title = firstHeading(markdown) || '兔机米成果';
  const children: Array<Paragraph | Table> = [];
  for (const raw of rich.markdown.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const levels = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3] as const;
      const level = levels[Math.min(2, (heading[1]?.length || 1) - 1)] || HeadingLevel.HEADING_1;
      children.push(new Paragraph({
        heading: level,
        children: [new TextRun({ text: cleanInline(heading[2] || ''), font: CJK_FONT })],
        spacing: { before: 180, after: 120 },
      }));
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    children.push(new Paragraph({
      ...(bullet ? { bullet: { level: 0 } } : {}),
      children: [new TextRun({ text: cleanInline(bullet?.[1] || line), font: CJK_FONT, size: 22 })],
      spacing: { after: 120, line: 360 },
    }));
  }
  for (const table of rich.tables) children.push(buildDocxTable(table));
  for (const image of rich.images) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new ImageRun({
        type: image.type,
        data: image.data,
        transformation: { width: 520, height: 292 },
        altText: { title: image.alt, description: image.alt, name: image.alt },
      })],
      spacing: { before: 180, after: 80 },
    }));
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: image.alt, font: CJK_FONT, color: MUTED, size: 18 })],
      spacing: { after: 160 },
    }));
  }
  const doc = new Document({
    creator: '兔机米',
    title,
    description: '由兔机米生成的可编辑 Word 成果',
    styles: {
      default: { document: { run: { font: CJK_FONT, size: 22, color: INK } } },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', run: { font: CJK_FONT, size: 40, bold: true, color: INK } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', run: { font: CJK_FONT, size: 34, bold: true, color: INK } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', run: { font: CJK_FONT, size: 28, bold: true, color: ACCENT } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', run: { font: CJK_FONT, size: 24, bold: true, color: INK } },
      ],
    },
    sections: [{
      properties: { page: { margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } },
      headers: { default: new Header({ children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: title, font: CJK_FONT, size: 18, color: MUTED })],
      })] }) },
      footers: { default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: '兔机米 · ', font: CJK_FONT, size: 18, color: MUTED }),
          new TextRun({ children: [PageNumber.CURRENT], font: CJK_FONT, size: 18, color: MUTED }),
        ],
      })] }) },
      children,
    }],
  });
  return Packer.toBuffer(doc);
}

function buildDocxTable(table: OfficeTable): Table {
  const width = Math.max(1, table.headers.length);
  const cells = (row: string[], header: boolean) => Array.from({ length: width }, (_, index) => new TableCell({
    children: [new Paragraph({
      children: [new TextRun({ text: cleanInline(row[index] || ''), font: CJK_FONT, size: 20, bold: header, color: header ? 'FFFFFF' : INK })],
      spacing: { before: 60, after: 60 },
    })],
    shading: header ? { fill: ACCENT } : index % 2 ? { fill: 'F3EFE6' } : { fill: 'FFFFFF' },
    width: { size: Math.floor(100 / width), type: WidthType.PERCENTAGE },
  }));
  return new Table({
    rows: [new TableRow({ children: cells(table.headers, true), tableHeader: true }), ...table.rows.map((row) => new TableRow({ children: cells(row, false) }))],
    width: { size: 100, type: WidthType.PERCENTAGE },
  });
}

export async function buildMaturePptxFromDrafts(
  drafts: readonly PptxSlideDraft[],
  rich: Pick<OfficeRichContent, 'tables' | 'images'>,
): Promise<Buffer> {
  const normalizedDrafts = compactLongDeck(drafts);
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = '兔机米';
  pptx.company = 'Digital Me';
  pptx.subject = '由兔机米生成的可编辑 PowerPoint 成果';
  pptx.title = normalizedDrafts[0]?.title || '兔机米成果';
  pptx.theme = {
    headFontFace: CJK_FONT,
    bodyFontFace: CJK_FONT,
  };
  const total = normalizedDrafts.length + rich.tables.length + rich.images.length;
  let page = 0;
  for (const draft of normalizedDrafts) {
    page += 1;
    const slide = pptx.addSlide();
    slide.background = { color: BG };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.12, line: { color: ACCENT }, fill: { color: ACCENT } });
    if (draft.kind === 'cover') {
      slide.addText(draft.title, { x: 0.7, y: 1.65, w: 8.4, h: 1.1, fontFace: CJK_FONT, fontSize: 30, bold: true, color: INK, margin: 0 });
      slide.addText(draft.subtitle || draft.lines[0] || 'Digital Me', { x: 0.7, y: 3.1, w: 8.8, h: 0.8, fontFace: CJK_FONT, fontSize: 17, color: MUTED, margin: 0 });
      slide.addShape(pptx.ShapeType.ellipse, { x: 10.1, y: 2.1, w: 1.7, h: 1.7, line: { color: ACCENT, width: 2 }, fill: { color: BG, transparency: 100 } });
    } else {
      slide.addText(draft.title, { x: 0.6, y: 0.45, w: 12.1, h: 0.65, fontFace: CJK_FONT, fontSize: 24, bold: true, color: INK, margin: 0, breakLine: false });
      const lines = (draft.lines || []).filter(Boolean).slice(0, 8);
      const text = lines.map((line) => ({ text: line, options: { bullet: { indent: 18 }, breakLine: true } }));
      slide.addText(text, { x: 0.8, y: 1.45, w: 11.7, h: 4.9, fontFace: CJK_FONT, fontSize: 17, color: INK, breakLine: false, margin: 0.12, valign: 'middle', fit: 'shrink' });
    }
    addPptxFooter(slide, page, total);
  }
  for (const [index, table] of rich.tables.entries()) {
    page += 1;
    const slide = pptx.addSlide();
    slide.background = { color: BG };
    slide.addText(`表格 ${index + 1}`, { x: 0.6, y: 0.45, w: 12.1, h: 0.65, fontFace: CJK_FONT, fontSize: 24, bold: true, color: INK, margin: 0 });
    const rows: PptxGenJS.TableRow[] = [table.headers, ...table.rows].map((row, rowIndex) => row.map((text) => rowIndex === 0
      ? { text, options: { bold: true, color: 'FFFFFF', fill: { color: ACCENT } } }
      : { text }));
    slide.addTable(rows, {
      x: 0.7, y: 1.35, w: 11.9, h: 4.9,
      fontFace: CJK_FONT, fontSize: 15, color: INK,
      border: { type: 'solid', color: 'C9D4D0', pt: 1 },
      fill: { color: 'FFFFFF' }, margin: 0.08,
      rowH: 0.55,
      bold: false,
      valign: 'middle',
    });
    addPptxFooter(slide, page, total);
  }
  for (const [index, image] of rich.images.entries()) {
    page += 1;
    const slide = pptx.addSlide();
    slide.background = { color: BG };
    slide.addText(image.alt || `图片 ${index + 1}`, { x: 0.6, y: 0.45, w: 12.1, h: 0.65, fontFace: CJK_FONT, fontSize: 24, bold: true, color: INK, margin: 0 });
    slide.addImage({ data: `data:image/${image.type};base64,${image.data.toString('base64')}`, x: 2.15, y: 1.35, w: 9.0, h: 5.05, transparency: 0 });
    addPptxFooter(slide, page, total);
  }
  const output = await pptx.write({ outputType: 'nodebuffer', compression: true });
  return Buffer.from(output as Uint8Array);
}

function compactLongDeck(drafts: readonly PptxSlideDraft[]): PptxSlideDraft[] {
  if (drafts.length <= 16) return [...drafts];
  const first = drafts[0];
  const body = drafts.slice(1).map((draft) => {
    const detail = (draft.lines || []).filter(Boolean).join('；');
    return detail ? `${draft.title}：${detail}` : draft.title;
  }).filter(Boolean);
  const compacted: PptxSlideDraft[] = first ? [{ ...first, lines: [...first.lines] }] : [];
  for (let i = 0; i < body.length; i += 6) {
    const chunk = body.slice(i, i + 6);
    compacted.push({
      kind: 'bullets',
      title: `内容摘要 ${i + 1}—${i + chunk.length}`,
      lines: chunk,
    });
  }
  return compacted;
}

function addPptxFooter(slide: PptxGenJS.Slide, page: number, total: number): void {
  slide.addText(`${page} / ${total}`, { x: 11.7, y: 7.05, w: 1.0, h: 0.2, fontFace: CJK_FONT, fontSize: 8, color: MUTED, margin: 0, align: 'right' });
}

function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line) && parseTableRow(line).length >= 2;
}

function parseTableRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((cell) => cleanInline(cell.trim()));
}

function firstHeading(markdown: string): string | undefined {
  return String(markdown || '').split(/\r?\n/).map((line) => /^#\s+(.*)$/.exec(line)?.[1]).find(Boolean)?.trim();
}

function cleanInline(text: string): string {
  return String(text || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
}
