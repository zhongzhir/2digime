import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { writeZip } from './zip';

/**
 * 导出器(P1.1 §7):Markdown → .md;Markdown/文本 → .docx(OOXML,Word/WPS 可打开)。
 * 导出是只读投影:不回写、不改变 Artifact 权威内容。
 * DOCX 构建思路摘取重写自 Legacy outputs/document.js,零代码复制。
 */
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

export function buildDocxFromMarkdown(markdown: string): Buffer {
  const paragraphs = markdownToParagraphs(markdown);
  const body = paragraphs.map(paragraphXml).join('');
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${body}<w:sectPr/></w:body></w:document>`;

  return writeZip([
    { name: '[Content_Types].xml', data: Buffer.from(CONTENT_TYPES_XML, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(ROOT_RELS_XML, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(DOCUMENT_RELS_XML, 'utf8') },
    { name: 'word/styles.xml', data: Buffer.from(STYLES_XML, 'utf8') },
  ]);
}

interface DocParagraph {
  style: 'Normal' | 'Heading1' | 'Heading2' | 'Heading3';
  text: string;
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
      paragraphs.push({ style: 'Normal', text: rawLine });
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
      paragraphs.push({ style: 'Normal', text: `\u2022 ${stripInlineMarkdown(bullet[1] ?? '')}` });
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

function paragraphXml(paragraph: DocParagraph): string {
  const styleXml =
    paragraph.style === 'Normal' ? '' : `<w:pPr><w:pStyle w:val="${paragraph.style}"/></w:pPr>`;
  return `<w:p>${styleXml}<w:r><w:t xml:space="preserve">${escapeXml(paragraph.text)}</w:t></w:r></w:p>`;
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
  `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>` +
  `<w:rPr><w:sz w:val="22"/></w:rPr></w:style>` +
  headingStyle(1, 32) +
  headingStyle(2, 28) +
  headingStyle(3, 24) +
  `</w:styles>`;

function headingStyle(level: number, halfPointSize: number): string {
  return (
    `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/>` +
    `<w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="${halfPointSize}"/></w:rPr></w:style>`
  );
}
