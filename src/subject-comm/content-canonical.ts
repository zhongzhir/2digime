/**
 * 内容侧规范身份。不是 ranking score，也不是 NetworkItem 整包 payload hash。
 * 同一篇文章用规范化 URL 得到同一 itemId，重复摄入覆盖而非分叉。
 */
import { createHash } from 'node:crypto';

const TRACKING_KEYS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'fbclid',
  'gclid',
  'gbraid',
  'wbraid',
  'mc_cid',
  'mc_eid',
]);

export function normalizeCanonicalUrl(raw: string): string {
  const trimmed = String(raw || '').trim();
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw Object.assign(new Error('只允许 http 或 https 原文链接'), { code: 'protocol' });
  }
  parsed.hash = '';
  parsed.hostname = parsed.hostname.replace(/\.$/, '').toLowerCase();
  const kept = new URLSearchParams();
  parsed.searchParams.forEach((value, key) => {
    if (!TRACKING_KEYS.has(key.toLowerCase())) kept.append(key, value);
  });
  const query = kept.toString();
  parsed.search = query ? `?${query}` : '';
  let path = parsed.pathname || '/';
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  parsed.pathname = path;
  return parsed.toString();
}

export function contentItemId(canonicalUrl: string): string {
  const digest = createHash('sha256').update(canonicalUrl).digest('hex').slice(0, 40);
  return `ni_${digest}`;
}

export function sourcePublisherId(sourceUrl: string): string {
  const digest = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 32);
  return `src_${digest}`;
}

export function clipTitle(raw: string): string {
  return collapseWs(raw).slice(0, 240);
}

export function clipText(raw: string): string {
  return collapseWs(raw).slice(0, 8000);
}

function collapseWs(raw: string): string {
  return String(raw || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
