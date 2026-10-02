/**
 * 公开页必要 metadata。用成熟 HTML 解析器，不存全文，不自研爬虫。
 */
import { parse } from 'node-html-parser';
import { clipText, clipTitle, normalizeCanonicalUrl } from './content-canonical';
import {
  inferContentType,
  isSafePublicMediaUrl,
  parseDurationSeconds,
  parsePositiveInt,
  type MediaAccess,
  type MediaExpression,
  type NetworkContentType,
  type OpenMediaFields,
} from './content-media';

export interface PageMetadata {
  canonicalUrl: string;
  title: string;
  description: string;
  publishedAt?: string;
  author?: string;
  publisher?: string;
  contentType?: NetworkContentType;
  thumbnailUrl?: string;
  mediaUrl?: string;
  embedUrl?: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  access?: MediaAccess;
  mediaExpression?: MediaExpression;
  oembedUrl?: string;
  schemaType?: string;
  ogType?: string;
  requiresSubscription?: boolean;
  media?: OpenMediaFields;
}

const FEED_TYPES = new Set([
  'application/rss+xml',
  'application/atom+xml',
  'application/rdf+xml',
  'application/feed+json',
]);

const OEMBED_TYPES = new Set(['application/json+oembed', 'text/xml+oembed']);

export interface FeedHint {
  url: string;
  type: 'rss' | 'atom' | 'json' | 'unknown';
}

function isPlaceholderTitle(title: string): boolean {
  return /^(title|untitled|undefined|null)$/i.test(title.trim());
}

function plainText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function articleExcerpt(root: ReturnType<typeof parse>, description: string, title: string): string {
  const scope = root.querySelector('article') || root.querySelector('main') || root.querySelector('body');
  let paragraph = '';
  if (scope) {
    for (const node of scope.querySelectorAll('p')) {
      const text = plainText(node.text || '');
      if (text.length < 40 || text === title.trim()) continue;
      paragraph = text.slice(0, 280);
      break;
    }
  }
  const meta = plainText(description);
  if (!paragraph) return meta;
  const chrome = ['header', 'footer', 'nav']
    .map((sel) => plainText(root.querySelector(sel)?.text || ''))
    .join(' ');
  const sloganInChrome = meta.length > 0 && chrome.includes(meta.slice(0, Math.min(24, meta.length)));
  if (!meta || meta === title.trim() || sloganInChrome) return paragraph;
  return meta;
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
  if (t.includes('feed+json') || t === 'application/json') return 'json';
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

function isArticleSchema(type: string): boolean {
  return /NewsArticle|BlogPosting|(?:^|\s)Article(?:\s|$)/i.test(type);
}

function isMediaObjectSchema(type: string): boolean {
  return /VideoObject|AudioObject|ImageObject/i.test(type);
}

function pickCreative(rows: Record<string, unknown>[]): Record<string, unknown> | null {
  const article = rows.find((row) => isArticleSchema(typeOf(row)));
  const media = rows.find((row) => isMediaObjectSchema(typeOf(row)));
  if (article && media) return article;
  return (
    rows.find((row) => /VideoObject/i.test(typeOf(row))) ||
    rows.find((row) => /AudioObject/i.test(typeOf(row))) ||
    rows.find((row) => /ImageObject/i.test(typeOf(row))) ||
    rows.find((row) => /TVEpisode|Episode|CreativeWorkSeries/i.test(typeOf(row))) ||
    article ||
    rows.find((row) => /WebPage/i.test(typeOf(row))) ||
    rows[0] ||
    null
  );
}

function urlFromLd(value: unknown, base: string): string | undefined {
  if (typeof value === 'string') {
    const abs = absUrl(value, base);
    return abs ? isSafePublicMediaUrl(abs) : undefined;
  }
  const rec = asRecord(value);
  if (rec) {
    const nested = rec.contentUrl || rec.url || rec.embedUrl;
    if (nested) return urlFromLd(nested, base);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = urlFromLd(item, base);
      if (found) return found;
    }
  }
  return undefined;
}

function truthyFlag(value: unknown): boolean {
  if (value === true) return true;
  const text = String(value || '').trim().toLowerCase();
  return text === 'true' || text === '1';
}

export function discoverOembedUrl(html: string, baseUrl: string): string | undefined {
  const root = parse(html);
  for (const link of root.querySelectorAll('link[rel]')) {
    const rel = attr(link, 'rel').toLowerCase();
    if (!/\balternate\b/.test(rel)) continue;
    const type = attr(link, 'type').toLowerCase();
    if (!OEMBED_TYPES.has(type)) continue;
    const href = attr(link, 'href');
    if (!href) continue;
    const abs = absUrl(href, baseUrl);
    if (!abs) continue;
    return isSafePublicMediaUrl(abs);
  }
  return undefined;
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
  const ldRows = jsonLdArticles(root);
  const ld = pickCreative(ldRows);
  const schemaType = ld ? typeOf(ld) : '';
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
  const rawTitle =
    metaContent(root, 'og:title') ||
    textOf(ld?.headline) ||
    textOf(ld?.name) ||
    (root.querySelector('title')?.text || '').trim() ||
    '';
  const title = isPlaceholderTitle(rawTitle) ? '' : rawTitle || canonicalUrl;
  const metaDescription =
    metaContent(root, 'og:description') ||
    metaContent(root, 'description') ||
    textOf(ld?.description) ||
    '';
  const description = articleExcerpt(root, metaDescription, title);
  const publishedAt =
    textOf(ld?.datePublished) ||
    textOf(ld?.uploadDate) ||
    metaContent(root, 'article:published_time') ||
    undefined;
  const author =
    textOf(ld?.author) ||
    metaContent(root, 'author') ||
    metaContent(root, 'article:author') ||
    undefined;
  const publisher = textOf(ld?.publisher) || metaContent(root, 'og:site_name') || undefined;
  const ogType = metaContent(root, 'og:type');
  const html5Video = attr(root.querySelector('video source, video'), 'src');
  const html5Audio = attr(root.querySelector('audio source, audio'), 'src');
  const schemaMedia = urlFromLd(ld?.contentUrl, base);
  const schemaEmbed = urlFromLd(ld?.embedUrl, base);
  const schemaThumb = urlFromLd(ld?.thumbnailUrl || ld?.image, base);
  const ogImage = isSafePublicMediaUrl(absUrl(metaContent(root, 'og:image'), base) || '');
  const thumbnailUrl = schemaThumb || ogImage;
  const ogVideo = isSafePublicMediaUrl(absUrl(metaContent(root, 'og:video') || metaContent(root, 'og:video:url'), base) || '');
  const ogAudio = isSafePublicMediaUrl(absUrl(metaContent(root, 'og:audio'), base) || '');
  const mediaUrl =
    schemaMedia ||
    isSafePublicMediaUrl(absUrl(html5Video || html5Audio, base) || '') ||
    ogVideo ||
    ogAudio;
  const embedUrl = schemaEmbed;
  const durationSeconds = parseDurationSeconds(ld?.duration);
  const width = parsePositiveInt(ld?.width, 8192);
  const height = parsePositiveInt(ld?.height, 8192);
  const requiresSubscription = truthyFlag(ld?.requiresSubscription);
  const access: MediaAccess | undefined = requiresSubscription ? 'subscriptionRequired' : undefined;
  const contentType = inferContentType({
    schemaType,
    ogType,
  });
  const oembedUrl = discoverOembedUrl(html, base);
  const schemaFields: OpenMediaFields | undefined =
    schemaMedia || schemaEmbed || schemaThumb || schemaType
      ? {
          ...(contentType ? { contentType } : {}),
          ...(author ? { author } : {}),
          ...(schemaThumb ? { thumbnailUrl: schemaThumb } : {}),
          ...(schemaMedia ? { mediaUrl: schemaMedia } : {}),
          ...(schemaEmbed ? { embedUrl: schemaEmbed } : {}),
          ...(durationSeconds != null ? { durationSeconds } : {}),
          ...(width != null ? { width } : {}),
          ...(height != null ? { height } : {}),
          ...(access ? { access } : {}),
          mediaProvenance: 'schema_org',
        }
      : undefined;
  const ogFields: OpenMediaFields | undefined =
    ogImage || ogVideo || ogAudio || ogType
      ? {
          ...(inferContentType({ ogType }) ? { contentType: inferContentType({ ogType }) } : {}),
          ...(ogImage ? { thumbnailUrl: ogImage } : {}),
          ...(ogVideo || ogAudio ? { mediaUrl: ogVideo || ogAudio } : {}),
          mediaProvenance: 'opengraph',
        }
      : undefined;
  return {
    canonicalUrl,
    title: clipTitle(title),
    description: clipText(description),
    ...(publishedAt ? { publishedAt } : {}),
    ...(author ? { author } : {}),
    ...(publisher ? { publisher } : {}),
    ...(contentType ? { contentType } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(mediaUrl ? { mediaUrl } : {}),
    ...(embedUrl ? { embedUrl } : {}),
    ...(durationSeconds != null ? { durationSeconds } : {}),
    ...(width != null ? { width } : {}),
    ...(height != null ? { height } : {}),
    ...(access ? { access } : {}),
    ...(oembedUrl ? { oembedUrl } : {}),
    ...(schemaType ? { schemaType } : {}),
    ...(ogType ? { ogType } : {}),
    ...(requiresSubscription ? { requiresSubscription: true } : {}),
    ...((schemaFields || ogFields) ? { media: { ...ogFields, ...schemaFields } } : {}),
  };
}
