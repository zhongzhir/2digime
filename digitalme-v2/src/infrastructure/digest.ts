import { createHash } from 'node:crypto';

/**
 * Digest 与规范化规则(P1.1 §8):
 * - 文本:Unicode NFC 规范化 + 换行统一为 LF 后按 UTF-8 计算 sha256;
 * - 二进制:按原始字节计算;
 * - 同输入重复计算必须一致(纯函数,无时间/随机成分)。
 */
export function normalizeText(text: string): string {
  return text.normalize('NFC').replace(/\r\n?/g, '\n');
}

export function contentDigest(input: string | Buffer): string {
  const data = typeof input === 'string' ? Buffer.from(normalizeText(input), 'utf8') : input;
  return createHash('sha256').update(data).digest('hex');
}

/**
 * 相对引用路径规范化:统一 '/' 分隔;拒绝绝对路径、盘符与 '..' 段。
 * 供 ContentStore 等在拼接管理目录前做安全校验。
 */
export function normalizeRelRef(ref: string): string {
  const unified = ref.replace(/\\/g, '/');
  if (/^([a-zA-Z]:|\/|~)/.test(unified)) {
    throw new Error(`content ref must be relative: ${ref}`);
  }
  const segments = unified.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new Error('content ref is empty');
  }
  for (const seg of segments) {
    if (seg === '.' || seg === '..') {
      throw new Error(`content ref must not contain dot segments: ${ref}`);
    }
  }
  return segments.join('/');
}

/** 文件名安全化:去除路径分隔与保留字符,限制长度。 */
export function sanitizeFileName(name: string, fallback = 'file'): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim();
  const limited = cleaned.slice(0, 120);
  return limited.length > 0 ? limited : fallback;
}
