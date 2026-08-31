/**
 * 主体资料检索层 — 导入正文分块索引，供对话 / 做事 / 协作规划共用。
 * 不是第二套 GrowthEvent 存储；删除资料时同步失效。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { nowIso } from '../shared/ids';

export const MATERIAL_INDEX_FILE = 'material-index.json';

export type MaterialChunkKind = 'name' | 'education' | 'experience' | 'contact' | 'other';
export type MaterialSensitivity = 'normal' | 'sensitive';

export interface MaterialChunk {
  chunkId: string;
  materialRef: string;
  sourceFileName: string;
  text: string;
  summary: string;
  start: number;
  end: number;
  sensitivity: MaterialSensitivity;
  kind: MaterialChunkKind;
}

export interface MaterialDetectedFields {
  name?: string;
  education: string[];
  experience: string[];
  sensitiveKinds: string[];
}

export interface MaterialIndexRecord {
  materialRef: string;
  sourceFileName: string;
  extractedLength: number;
  readStatus: 'read' | 'partial' | 'failed';
  indexedAt: string;
  summary: string;
  detected: MaterialDetectedFields;
  chunks: MaterialChunk[];
}

interface MaterialIndexFile {
  records: MaterialIndexRecord[];
}

const SENSITIVE_RE =
  /身份证(号)?|证件号|\b\d{17}[\dXx]\b|手机号|联系电话|电话号码|电话[：:]|住址|家庭住址|家庭地址|银行卡|卡号|社保|病历|诊断|工资|薪资|收入|财务|健康/i;

const NAME_LINE_RE = /(?:姓名|名字)\s*[：:]\s*([^\n，。；;]{1,20})/;
const EDUCATION_RE = /教育(经历|背景)?\s*[：:]?\s*([^\n]{2,80})/;
const EXPERIENCE_RE = /(?:工作经历|任职|负责)\s*[：:]?\s*([^\n]{4,160})/;

export function isSensitiveMaterialText(text: string): boolean {
  return SENSITIVE_RE.test(String(text || ''));
}

export function detectMaterialFields(text: string): MaterialDetectedFields {
  const raw = String(text || '');
  const nameMatch = NAME_LINE_RE.exec(raw);
  const education: string[] = [];
  const experience: string[] = [];
  const edu = EDUCATION_RE.exec(raw);
  if (edu?.[2]) education.push(edu[2].trim());
  const exp = EXPERIENCE_RE.exec(raw);
  if (exp?.[1]) experience.push(exp[1].trim());
  if (/大学|学院|本科|硕士|博士|高中/.test(raw) && education.length === 0) {
    const line = raw.split(/\r?\n/).find((l) => /大学|学院|本科|硕士/.test(l));
    if (line) education.push(line.replace(/^教育(经历|背景)?\s*[：:]?\s*/, '').trim());
  }
  const sensitiveKinds: string[] = [];
  if (/身份证|\b\d{17}[\dXx]\b/.test(raw)) sensitiveKinds.push('身份证');
  if (/手机号|联系电话|电话号码|电话[：:]/.test(raw)) sensitiveKinds.push('电话');
  if (/住址|家庭住址|家庭地址/.test(raw)) sensitiveKinds.push('住址');
  if (/银行卡|卡号|工资|薪资|收入|财务/.test(raw)) sensitiveKinds.push('财务');
  if (/病历|诊断|健康/.test(raw)) sensitiveKinds.push('健康');
  return {
    ...(nameMatch?.[1] ? { name: nameMatch[1].trim() } : {}),
    education,
    experience,
    sensitiveKinds,
  };
}

function chunkKindForText(text: string): MaterialChunkKind {
  if (/(?:姓名|名字)\s*[：:]/.test(text)) return 'name';
  if (/教育(经历|背景)?/.test(text) || /大学|学院|本科|硕士/.test(text)) return 'education';
  if (/工作经历|任职|负责/.test(text)) return 'experience';
  if (isSensitiveMaterialText(text)) return 'contact';
  return 'other';
}

function summarizeChunk(text: string): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length <= 80 ? t : `${t.slice(0, 77)}…`;
}

export function chunkMaterialText(input: {
  materialRef: string;
  sourceFileName: string;
  text: string;
}): MaterialChunk[] {
  const text = String(input.text || '').replace(/\r\n/g, '\n');
  if (!text.trim()) return [];
  const parts: Array<{ start: number; end: number; text: string }> = [];
  const blocks = text.split(/\n{2,}/);
  let cursor = 0;
  for (const block of blocks) {
    const idx = text.indexOf(block, cursor);
    const start = idx >= 0 ? idx : cursor;
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      cursor = start + block.length;
      continue;
    }
    let buf = '';
    let bufStart = start;
    const flush = () => {
      const piece = buf.trim();
      if (!piece) return;
      parts.push({ start: bufStart, end: bufStart + piece.length, text: piece });
      buf = '';
    };
    for (const line of lines) {
      if (isSensitiveMaterialText(line) && buf) flush();
      if (!buf) bufStart = text.indexOf(line, bufStart >= 0 ? bufStart : start);
      if (bufStart < 0) bufStart = start;
      buf = buf ? `${buf}\n${line}` : line;
      if (buf.length >= 420 || isSensitiveMaterialText(line)) flush();
    }
    flush();
    cursor = start + block.length;
  }
  if (parts.length === 0) {
    parts.push({ start: 0, end: text.length, text: text.trim() });
  }
  return parts.map((p, i) => ({
    chunkId: `${input.materialRef}#c${i + 1}`,
    materialRef: input.materialRef,
    sourceFileName: input.sourceFileName,
    text: p.text,
    summary: summarizeChunk(p.text),
    start: p.start,
    end: p.end,
    sensitivity: isSensitiveMaterialText(p.text) ? 'sensitive' : 'normal',
    kind: chunkKindForText(p.text),
  }));
}

export function buildMaterialIndexRecord(input: {
  materialRef: string;
  sourceFileName: string;
  text: string;
  readStatus: 'read' | 'partial' | 'failed';
}): MaterialIndexRecord {
  const extractedLength = String(input.text || '').trim().length;
  const detected = detectMaterialFields(input.text);
  const chunks = extractedLength
    ? chunkMaterialText({
        materialRef: input.materialRef,
        sourceFileName: input.sourceFileName,
        text: input.text,
      })
    : [];
  const summaryParts = [`已读取 ${extractedLength} 字`];
  if (detected.name) summaryParts.push(`姓名 ${detected.name}`);
  if (detected.education.length) summaryParts.push('含教育经历');
  if (detected.experience.length) summaryParts.push('含工作经历');
  return {
    materialRef: input.materialRef,
    sourceFileName: input.sourceFileName,
    extractedLength,
    readStatus: input.readStatus,
    indexedAt: nowIso(),
    summary: summaryParts.join('；'),
    detected,
    chunks,
  };
}

export function formatMaterialReadResult(record: MaterialIndexRecord): string {
  const n = record.extractedLength.toLocaleString('zh-CN');
  const kinds: string[] = [];
  if (record.detected.name) kinds.push('姓名');
  if (record.detected.education.length) kinds.push('教育');
  if (record.detected.experience.length) kinds.push('经历');
  const kindPart = kinds.length ? `识别到${kinds.join('、')}，` : '';
  return `已读取 ${n} 字，已可用于对话和做事；${kindPart}敏感信息不会自动对外使用。`;
}

export function indexFilePath(packageRoot: string): string {
  return path.join(packageRoot, MATERIAL_INDEX_FILE);
}

async function readIndexFile(packageRoot: string): Promise<MaterialIndexFile> {
  try {
    const raw = await fs.readFile(indexFilePath(packageRoot), 'utf8');
    const parsed = JSON.parse(raw) as MaterialIndexFile;
    if (!parsed || !Array.isArray(parsed.records)) return { records: [] };
    return parsed;
  } catch {
    return { records: [] };
  }
}

async function writeIndexFile(packageRoot: string, file: MaterialIndexFile): Promise<void> {
  await fs.writeFile(indexFilePath(packageRoot), JSON.stringify(file, null, 2), 'utf8');
}

export async function upsertMaterialIndex(
  packageRoot: string,
  record: MaterialIndexRecord,
): Promise<void> {
  const file = await readIndexFile(packageRoot);
  const next = file.records.filter((r) => r.materialRef !== record.materialRef);
  next.push(record);
  await writeIndexFile(packageRoot, { records: next });
}

export async function dropMaterialIndex(packageRoot: string, materialRef: string): Promise<void> {
  const file = await readIndexFile(packageRoot);
  const next = file.records.filter((r) => r.materialRef !== materialRef);
  await writeIndexFile(packageRoot, { records: next });
}

export async function listMaterialIndex(packageRoot: string): Promise<MaterialIndexRecord[]> {
  const file = await readIndexFile(packageRoot);
  return file.records.slice();
}

export interface MaterialRetrievalHit {
  chunk: MaterialChunk;
  score: number;
  detectedName?: string;
}

export function retrieveFromRecords(
  records: readonly MaterialIndexRecord[],
  query: string,
  opts?: { maxChunks?: number; includeSensitive?: boolean },
): MaterialRetrievalHit[] {
  const q = String(query || '').trim();
  const maxChunks = opts?.maxChunks ?? 4;
  const includeSensitive = opts?.includeSensitive === true;
  const hits: MaterialRetrievalHit[] = [];
  const qName = /名字|姓名|我叫|我是谁/.test(q);
  const qEdu = /学历|教育|毕业|学校|大学/.test(q);
  const qExp = /经历|工作|任职|介绍|简介|履历/.test(q);
  for (const rec of records) {
    for (const chunk of rec.chunks) {
      if (!includeSensitive && chunk.sensitivity === 'sensitive') continue;
      let score = 0;
      if (qName && (chunk.kind === 'name' || rec.detected.name)) score += 8;
      if (qEdu && chunk.kind === 'education') score += 6;
      if (qExp && chunk.kind === 'experience') score += 6;
      const tokens = q.replace(/[，。？?、\s]+/g, ' ').split(' ').filter((t) => t.length >= 2);
      for (const tok of tokens) {
        if (chunk.text.includes(tok)) score += 2;
      }
      if (!q) score += chunk.kind === 'experience' || chunk.kind === 'name' ? 2 : 1;
      if (score <= 0 && (qName || qEdu || qExp || q.length < 4)) {
        if (chunk.kind === 'name' || chunk.kind === 'education' || chunk.kind === 'experience') {
          score = 1;
        }
      }
      if (score > 0) {
        hits.push({
          chunk,
          score,
          ...(rec.detected.name ? { detectedName: rec.detected.name } : {}),
        });
      }
    }
  }
  hits.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: MaterialRetrievalHit[] = [];
  for (const hit of hits) {
    if (seen.has(hit.chunk.chunkId)) continue;
    seen.add(hit.chunk.chunkId);
    out.push(hit);
    if (out.length >= maxChunks) break;
  }
  return out;
}

export function isMaterialBackedIdentityQuery(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  return /我叫什么名字|我的名字是什么|我叫啥|我的姓名|我叫什么$|我的名字/.test(t);
}

export function buildMaterialGroundedReply(hits: readonly MaterialRetrievalHit[]): string | null {
  if (!hits.length) return null;
  const named = hits.find((h) => h.detectedName);
  const nameChunk = hits.find((h) => h.chunk.kind === 'name');
  const source = (named || nameChunk || hits[0])?.chunk.sourceFileName || '资料';
  const name =
    named?.detectedName ||
    NAME_LINE_RE.exec(nameChunk?.chunk.text || hits[0]?.chunk.text || '')?.[1]?.trim();
  if (name) {
    return `根据你上传的${source}，你的名字是${name}。这是来自简历的读取结果，若有误可以纠正。`;
  }
  const edu = hits.find((h) => h.chunk.kind === 'education');
  if (edu && /学历|教育|毕业|学校/.test(hits.map((h) => h.chunk.text).join(''))) {
    return `根据你上传的${edu.chunk.sourceFileName}，相关教育信息是：${edu.chunk.summary}。来自简历，可纠正。`;
  }
  const exp = hits.find((h) => h.chunk.kind === 'experience');
  if (exp) {
    return `根据你上传的${exp.chunk.sourceFileName}，相关经历是：${exp.chunk.summary}。来自简历，可纠正。`;
  }
  return null;
}

export function outboundSafeDetectedKinds(records: readonly MaterialIndexRecord[]): string[] {
  const kinds = new Set<string>();
  for (const rec of records) {
    if (rec.detected.name) kinds.add('姓名');
    if (rec.detected.education.length) kinds.add('教育');
    if (rec.detected.experience.length) kinds.add('经历');
  }
  return [...kinds];
}
