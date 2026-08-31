import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `dmv2-${prefix}-`));
}

function utf16BeHex(text: string): string {
  let hex = 'FEFF';
  for (const ch of String(text || '')) {
    const code = ch.codePointAt(0) || 0;
    if (code > 0xffff) {
      const c = code - 0x10000;
      hex += (0xd800 + (c >> 10)).toString(16).toUpperCase().padStart(4, '0');
      hex += (0xdc00 + (c & 0x3ff)).toString(16).toUpperCase().padStart(4, '0');
    } else {
      hex += code.toString(16).toUpperCase().padStart(4, '0');
    }
  }
  return hex;
}

function assemblePdf(objects: string[]): Buffer {
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

/** 构造最小合法 PDF(单页单文本对象,xref 偏移精确计算)。仅适合 Latin-1。 */
export function buildMinimalPdf(text: string): Buffer {
  const stream = `BT /F1 24 Tf 72 720 Td (${text}) Tj ET`;
  return assemblePdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]);
}

/**
 * 无隐私中文 PDF：用 ActualText + ToUnicode，供 pdf.js 提取「张元林」等汉字。
 * 不嵌入真实字体文件；提取依赖标记文本，不是视觉渲染。
 */
export function buildChineseTextPdf(text: string): Buffer {
  const raw = String(text || '').trim() || '张元林';
  const chars = [...raw];
  const bfchar = chars
    .map((ch, i) => {
      const cid = (i + 1).toString(16).toUpperCase().padStart(4, '0');
      const uni = (ch.codePointAt(0) || 0).toString(16).toUpperCase().padStart(4, '0');
      return `<${cid}> <${uni}>`;
    })
    .join('\n');
  const tj = chars.map((_, i) => (i + 1).toString(16).toUpperCase().padStart(4, '0')).join('');
  const cmap =
    '/CIDInit /ProcSet findresource begin\n' +
    '12 dict begin\nbegincmap\n' +
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n' +
    '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n' +
    '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n' +
    `${chars.length} beginbfchar\n${bfchar}\nendbfchar\n` +
    'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n';
  const actualHex = utf16BeHex(raw);
  const stream =
    `BT /F1 12 Tf 72 700 Td\n` +
    `/Span << /ActualText <${actualHex}> >> BDC\n` +
    `<${tj}> Tj\nEMC\nET`;
  return assemblePdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /FontDescriptor /FontName /Dummy /Flags 4 /FontBBox [0 -200 1000 800] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /Dummy /Encoding /Identity-H /DescendantFonts [7 0 R] /ToUnicode 8 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Dummy /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 5 0 R /DW 500 >>',
    `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`,
  ]);
}

/** Helvetica 无法承载中文：正文提取应失败，不得声称已读。 */
export function buildUnreadableChinesePdf(): Buffer {
  return buildMinimalPdf('    ');
}
