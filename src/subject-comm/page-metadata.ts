/**
 * 公开页必要 metadata。用成熟 HTML 解析器，不存全文，不自研爬虫。
 */
import { parse } from 'node-html-parser';
import { clipText, clipTitle, normalizeCanonicalUrl } from './content-canonical';

export interface PageMetadata {
  canonicalUrl: string;
  title: string;
  description: string;
  publishedAt?: string;
  author?: string;
  publisher?: string;
}

const FEED_TYPES = new Set([
  'application/rss+xml',
  'application/atom+xml',
  'application/rdf+xml',
]);

export interface FeedHint {
  url: string;
  type: 'rss' | 'atom' | 'unknown';
}

function attr(el: { getAttribute(name: string): string | undefined } | null, name: string): string {
  return String(el?.getAttribute(name) || '').trim();
}

function metaContent(root: ReturnType<typeof parse>, key: string): string {
  const byProp =
    root.querySelector(`meta[property="${key}"]`) ||
    root.querySelector(`meta[property="${key.toLowerCase()}"]`);
  if (byProp) return attr(byProp, 'content');
  const byName = root.querySelector(`meta[name="${key}"]`);
  return attr(byName, 'content');
}

function absUrl(href: string, base: string): string | null {
  try {
    return new URL(String(href || '').trim(), base).toString();
  } catch {
    return null;
  }
}

function feedKind(type: string): FeedHint['type'] {
  const t = type.toLowerCase();
  if (t.includes('atom')) return 'atom';
  if (t.includes('rss') || t.includes('rdf')) return 'rss';
  return 'unknown';
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function jsonLdArticles(root: ReturnType<typeof parse>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    const raw = script.text.trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const stack = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of stack) {
        const rec = asRecord(item);
        if (!rec) continue;
        if (Array.isArray(rec['@graph'])) {
          for (const row of rec['@graph']) {
            const inner = asRecord(row);
            if (inner) out.push(inner);
          }
        } else {
          out.push(rec);
        }
      }
    } catch {
      /* 损坏 JSON-LD 不得阻断其它 metadata */
    }
  }
  return out;
}

function typeOf(rec: Record<string, unknown>): string {
  const t = rec['@type'];
  if (Array.isArray(t)) return t.map((x) => String(x)).join(' ');
  return String(t || '');
}

function pickArticle(rows: Record<string, unknown>[]): Record<string, unknown> | null {
  return (
    rows.find((row) => /NewsArticle|Article|BlogPosting|WebPage/i.test(typeOf(row))) || rows[0] || null
  );
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  const rec = asRecord(value);
  if (rec && typeof rec.name === 'string') return rec.name.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const t = textOf(item);
      if (t) return t;
    }
  }
  return '';
}

export function discoverFeedHints(html: string, baseUrl: string): FeedHint[] {
  const root = parse(html);
  const seen = new Set<string>();
  const out: FeedHint[] = [];
  for (const link of root.querySelectorAll('link[rel]')) {
    const rel = attr(link, 'rel').toLowerCase();
    if (!/\balternate\b/.test(rel)) continue;
    const type = attr(link, 'type').toLowerCase();
    if (!FEED_TYPES.has(type)) continue;
    const href = attr(link, 'href');
    if (!href) continue;
    const abs = absUrl(href, baseUrl);
    if (!abs) continue;
    let canonical = '';
    try {
      canonical = normalizeCanonicalUrl(abs);
    } catch {
      continue;
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push({ url: canonical, type: feedKind(type) });
  }
  return out;
}

export function parsePageMetadata(html: string, fallbackUrl: string): PageMetadata {
  const root = parse(html);
  const base = fallbackUrl;
  const ld = pickArticle(jsonLdArticles(root));
  const canonicalHref =
    attr(root.querySelector('link[rel="canonical"]'), 'href') ||
    metaContent(root, 'og:url') ||
    textOf(ld?.url) ||
    fallbackUrl;
  const absCanonical = absUrl(canonicalHref, base) || fallbackUrl;
  let canonicalUrl = fallbackUrl;
  try {
    canonicalUrl = normalizeCanonicalUrl(absCanonical);
  } catch {
    try {
      canonicalUrl = normalizeCanonicalUrl(fallbackUrl);
    } catch {
      canonicalUrl = fallbackUrl;
    }
  }
  const title =
    metaContent(root, 'og:title') ||
    textOf(ld?.headline) ||
    textOf(ld?.name) ||
    (root.querySelector('title')?.text || '').trim() ||
    canonicalUrl;
  const description =
    metaContent(root, 'og:description') ||
    metaContent(root, 'description') ||
    textOf(ld?.description) ||
    title;
  const publishedAt = textOf(ld?.datePublished) || metaContent(root, 'article:published_time') || undefined;
  const author =
    textOf(ld?.author) ||
    metaContent(root, 'author') ||
    metaContent(root, 'article:author') ||
    undefined;
  const publisher = textOf(ld?.publisher) || metaContent(root, 'og:site_name') || undefined;
  return {
    canonicalUrl,
    title: clipTitle(title),
    description: clipText(description),
    ...(publishedAt ? { publishedAt } : {}),
    ...(author ? { author } : {}),
    ...(publisher ? { publisher } : {}),
  };
}
