import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import pdfParse = require('pdf-parse/lib/pdf-parse.js');
import { contentDigest, normalizeText } from './digest';
import { readZipEntries } from './zip';

/**
 * 文件与文件夹抽取(P1.1 §5)。
 * - 每个条目独立结果 ok/warning;单文件失败不终止整体;
 * - 截断规则:规范化文本超过 MAX_EXTRACT_CHARS 时截断;
 *   digest / length / 正文 一律基于截断后的存储文本计算,三者必然一致;
 * - 无 materialsStale 等旧概念;本模块不触碰任何 Store。
 */
export const MAX_EXTRACT_CHARS = 200_000;

export const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.markdown', '.docx', '.pdf', '.pptx'] as const;

export interface ExtractionOutcome {
  sourcePath: string;
  status: 'ok' | 'warning';
  warning?: string;
  /** 规范化(NFC + LF)且可能截断后的存储文本。 */
  text?: string;
  truncated?: boolean;
  /** 基于存储文本(即截断后)的 digest。 */
  digest?: string;
  /** 存储文本的字符数。 */
  length?: number;
}

export async function extractFile(filePath: string): Promise<ExtractionOutcome> {
  const ext = path.extname(filePath).toLowerCase();
  try {
    let rawText: string;
    switch (ext) {
      case '.txt':
      case '.md':
      case '.markdown':
        rawText = await fs.readFile(filePath, 'utf8');
        break;
      case '.docx':
        rawText = extractDocxText(await fs.readFile(filePath));
        break;
      case '.pptx':
        rawText = extractPptxText(await fs.readFile(filePath));
        break;
      case '.pdf': {
        // 必须传纯 Uint8Array:pdf.js 的 fake-worker 克隆执行 new value.constructor(value),
        // Buffer 构造器会复制进 Node 内存池(<4KB 时 byteOffset≠0),而 Stream.makeSubStream
        // 按整个 ArrayBuffer 取流,视图偏移会使全部 xref 偏移错位(bad XRef entry)。
        const pooled = await fs.readFile(filePath);
        const plain = new Uint8Array(pooled.length);
        plain.set(pooled);
        rawText = (await pdfParse(plain)).text;
        break;
      }
      default:
        return warningOutcome(filePath, '格式暂不支持');
    }
    return finalizeText(filePath, rawText);
  } catch (error) {
    return warningOutcome(filePath, `无法读取: ${(error as Error).message}`);
  }
}

/**
 * 递归枚举文件夹：受支持文件抽取正文；不支持/失败以 warning 报告（不改变可抽取内容语义）。
 * 目录读取失败以 warning 条目报告,不中断。
 */
export async function extractFolder(folderPath: string): Promise<ExtractionOutcome[]> {
  const outcomes: ExtractionOutcome[] = [];
  await walk(folderPath, outcomes);
  return outcomes;
}

async function walk(dir: string, outcomes: ExtractionOutcome[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    outcomes.push(warningOutcome(dir, `无法读取: ${(error as Error).message}`));
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, outcomes);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if ((SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) {
        outcomes.push(await extractFile(fullPath));
      } else {
        // 透明度：记录跳过原因；不进入正文抽取（与原先静默跳过的纳入集合一致）
        outcomes.push(warningOutcome(fullPath, '格式暂不支持'));
      }
    }
  }
}

function finalizeText(sourcePath: string, rawText: string): ExtractionOutcome {
  const normalized = normalizeText(rawText);
  if (normalized.length === 0) {
    return warningOutcome(sourcePath, '空文件');
  }
  const truncated = normalized.length > MAX_EXTRACT_CHARS;
  const stored = truncated ? normalized.slice(0, MAX_EXTRACT_CHARS) : normalized;
  const outcome: ExtractionOutcome = {
    sourcePath,
    status: 'ok',
    text: stored,
    digest: contentDigest(stored),
    length: stored.length,
  };
  if (truncated) outcome.truncated = true;
  return outcome;
}

function warningOutcome(sourcePath: string, warning: string): ExtractionOutcome {
  return { sourcePath, status: 'warning', warning };
}

function extractDocxText(fileBytes: Buffer): string {
  const entries = readZipEntries(fileBytes);
  const documentXml = entries.get('word/document.xml');
  if (!documentXml) {
    throw new Error('not a docx: word/document.xml missing');
  }
  return xmlToText(documentXml.toString('utf8'), /<w:t[^>]*>([^<]*)<\/w:t>/g, /<\/w:p>/g);
}

function extractPptxText(fileBytes: Buffer): string {
  const entries = readZipEntries(fileBytes);
  const slideNames = [...entries.keys()]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));
  if (slideNames.length === 0) {
    throw new Error('not a pptx: no slides found');
  }
  const parts: string[] = [];
  for (const name of slideNames) {
    const xml = (entries.get(name) as Buffer).toString('utf8');
    parts.push(xmlToText(xml, /<a:t[^>]*>([^<]*)<\/a:t>/g, /<\/a:p>/g));
  }
  return parts.join('\n\n');
}

function slideNumber(name: string): number {
  const match = /slide(\d+)\.xml$/.exec(name);
  return match ? Number(match[1]) : 0;
}

/** 提取 runPattern 命中的文本,paragraphPattern 处断行,解码基本 XML 实体。 */
function xmlToText(xml: string, runPattern: RegExp, paragraphPattern: RegExp): string {
  const withBreaks = xml.replace(paragraphPattern, '\u0000');
  const parts: string[] = [];
  let cursor = 0;
  const combined = new RegExp(`${runPattern.source}|\u0000`, 'g');
  let match: RegExpExecArray | null;
  let current = '';
  while ((match = combined.exec(withBreaks)) !== null) {
    if (match[0] === '\u0000') {
      parts.push(current);
      current = '';
    } else {
      current += decodeXmlEntities(match[1] ?? '');
    }
    cursor = combined.lastIndex;
  }
  void cursor;
  if (current.length > 0) parts.push(current);
  return parts
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}
