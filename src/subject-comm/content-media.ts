/**
 * 开放媒体字段的机械归一。不托管文件，不猜语义，不建第二套 MediaItem。
 */
import { parse } from 'node-html-parser';
import { assertSafePublicHttpUrl } from '../work-runtime/public-http-safety';

export const NETWORK_CONTENT_TYPES = ['article', 'image', 'audio', 'video', 'other'] as const;
export type NetworkContentType = (typeof NETWORK_CONTENT_TYPES)[number];

export const CONSUMPTION_MODES = ['INLINE_MEDIA', 'OFFICIAL_EMBED', 'OPEN_SOURCE'] as const;
export type ConsumptionMode = (typeof CONSUMPTION_MODES)[number];

export const MEDIA_ACCESS = ['public', 'loginRequired', 'subscriptionRequired', 'unknown'] as const;
export type MediaAccess = (typeof MEDIA_ACCESS)[number];

export const MEDIA_PROVENANCES = [
  'rss',
  'atom',
  'json_feed',
  'media_rss',
  'enclosure',
  'schema_org',
  'oembed',
  'opengraph',
] as const;
export type MediaProvenance = (typeof MEDIA_PROVENANCES)[number];

export const MEDIA_EXPRESSIONS = ['full', 'sample', 'nonstop'] as const;
export type MediaExpression = (typeof MEDIA_EXPRESSIONS)[number];

const PROVENANCE_RANK: Record<MediaProvenance, number> = {
  media_rss: 50,
  enclosure: 40,
  json_feed: 40,
  rss: 30,
  atom: 30,
  schema_org: 25,
  oembed: 15,
  opengraph: 10,
};

export interface OpenMediaFields {
  contentType?: NetworkContentType | undefined;
  author?: string | undefined;
  thumbnailUrl?: string | undefined;
  mediaUrl?: string | undefined;
  embedUrl?: string | undefined;
  mimeType?: string | undefined;
  durationSeconds?: number | undefined;
  width?: number | undefined;
  height?: number | undefined;
  enclosureLength?: number | undefined;
  access?: MediaAccess | undefined;
  consumption?: ConsumptionMode | undefined;
  mediaExpression?: MediaExpression | undefined;
  mediaProvenance?: MediaProvenance | undefined;
}

const TYPE_SET = new Set<string>(NETWORK_CONTENT_TYPES);
const CONSUMPTION_SET = new Set<string>(CONSUMPTION_MODES);
const ACCESS_SET = new Set<string>(MEDIA_ACCESS);
const PROVENANCE_SET = new Set<string>(MEDIA_PROVENANCES);
const EXPRESSION_SET = new Set<string>(MEDIA_EXPRESSIONS);

export function isSafePublicMediaUrl(raw: unknown): string | undefined {
  const value = String(raw || '').trim();
  if (!value || value.length > 2000) return undefined;
  try {
    const parsed = assertSafePublicHttpUrl(value);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

export function parseDurationSeconds(raw: unknown): number | undefined {
  if (raw == null || raw === '') return undefined;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return Math.min(Math.round(raw), 7 * 24 * 3600);
  }
  const text = String(raw).trim();
  if (!text) return undefined;
  if (/^\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    if (Number.isFinite(n) && n >= 0) return Math.min(Math.round(n), 7 * 24 * 3600);
  }
  const iso = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(text);
  if (iso) {
    const days = Number(iso[1] || 0);
    const hours = Number(iso[2] || 0);
    const minutes = Number(iso[3] || 0);
    const seconds = Number(iso[4] || 0);
    const total = days * 86400 + hours * 3600 + minutes * 60 + seconds;
    if (total >= 0) return Math.min(Math.round(total), 7 * 24 * 3600);
  }
  const clock = /^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/.exec(text);
  if (clock) {
    const h = Number(clock[1]);
    const m = Number(clock[2]);
    const s = Number(clock[3] || 0);
    return Math.min(h * 3600 + m * 60 + s, 7 * 24 * 3600);
  }
  return undefined;
}

export function parsePositiveInt(raw: unknown, max: number): number | undefined {
  const n = typeof raw === 'number' ? raw : Number(String(raw || '').trim());
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const rounded = Math.round(n);
  if (rounded > max) return undefined;
  return rounded;
}

function mimeContentType(mime: string): NetworkContentType | undefined {
  const t = mime.toLowerCase();
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('audio/')) return 'audio';
  if (t.startsWith('video/')) return 'video';
  return undefined;
}

function suffixHint(url: string): NetworkContentType | undefined {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (/\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(path)) return 'image';
    if (/\.(aac|flac|m4a|mp3|ogg|opus|wav)$/i.test(path)) return 'audio';
    if (/\.(m4v|mkv|mov|mp4|ogv|webm)$/i.test(path)) return 'video';
  } catch {
    /* 非法 URL 不作为类型证据 */
  }
  return undefined;
}

export function inferContentType(input: {
  schemaType?: string | undefined;
  mimeType?: string | undefined;
  medium?: string | undefined;
  oembedType?: string | undefined;
  ogType?: string | undefined;
  mediaUrl?: string | undefined;
  embedUrl?: string | undefined;
}): NetworkContentType | undefined {
  const schema = String(input.schemaType || '').toLowerCase();
  if (/videoobject|movie|tvepisode|video/.test(schema) && /object|movie|episode|video/.test(schema)) {
    if (/videoobject|movie|tvepisode/.test(schema) || schema === 'video') return 'video';
  }
  if (/videoobject/.test(schema)) return 'video';
  if (/audioobject/.test(schema)) return 'audio';
  if (/imageobject/.test(schema)) return 'image';
  if (/article|newsarticle|blogposting/.test(schema)) return 'article';
  if (input.mimeType) {
    const fromMime = mimeContentType(input.mimeType);
    if (fromMime) return fromMime;
  }
  const medium = String(input.medium || '').toLowerCase();
  if (medium === 'video') return 'video';
  if (medium === 'audio') return 'audio';
  if (medium === 'image') return 'image';
  const oembed = String(input.oembedType || '').toLowerCase();
  if (oembed === 'video') return 'video';
  if (oembed === 'photo') return 'image';
  const og = String(input.ogType || '').toLowerCase();
  if (og === 'video' || og.startsWith('video.')) return 'video';
  if (og === 'music' || og.startsWith('music.') || og.startsWith('audio')) return 'audio';
  if (og === 'article') return 'article';
  if (input.mediaUrl) {
    const hinted = suffixHint(input.mediaUrl);
    if (hinted) return hinted;
  }
  if (input.embedUrl) return 'video';
  return undefined;
}

export function consumptionFor(input: {
  contentType?: NetworkContentType | undefined;
  mediaUrl?: string | undefined;
  embedUrl?: string | undefined;
  access?: MediaAccess | undefined;
}): ConsumptionMode {
  if (input.access === 'subscriptionRequired' || input.access === 'loginRequired') return 'OPEN_SOURCE';
  if (input.embedUrl) return 'OFFICIAL_EMBED';
  if (input.mediaUrl && (input.contentType === 'image' || input.contentType === 'audio' || input.contentType === 'video')) {
    return 'INLINE_MEDIA';
  }
  return 'OPEN_SOURCE';
}

export function mergeOpenMedia(...layers: Array<OpenMediaFields | undefined>): OpenMediaFields {
  const ranked = layers
    .filter((row): row is OpenMediaFields => !!row && Object.keys(row).length > 0)
    .sort((a, b) => (PROVENANCE_RANK[b.mediaProvenance || 'opengraph'] || 0) - (PROVENANCE_RANK[a.mediaProvenance || 'opengraph'] || 0));
  const out: OpenMediaFields = {};
  for (const layer of ranked) {
    (Object.keys(layer) as Array<keyof OpenMediaFields>).forEach((key) => {
      if (out[key] == null && layer[key] != null) {
        (out as Record<string, unknown>)[key as string] = layer[key];
      }
    });
  }
  if (out.access === 'subscriptionRequired' || out.access === 'loginRequired') {
    out.consumption = 'OPEN_SOURCE';
  } else if (!out.consumption) {
    out.consumption = consumptionFor(out);
  }
  return out;
}

export function parseOembedIframeSrc(html: string): string | undefined {
  const raw = String(html || '').trim();
  if (!raw) return undefined;
  if (/javascript:/i.test(raw) || /<script/i.test(raw)) return undefined;
  try {
    const root = parse(raw);
    const iframe = root.querySelector('iframe');
    if (!iframe) return undefined;
    const src = String(iframe.getAttribute('src') || '').trim();
    return isSafePublicMediaUrl(src);
  } catch {
    return undefined;
  }
}

export function asContentType(raw: unknown): NetworkContentType | undefined {
  const value = String(raw || '').trim();
  return TYPE_SET.has(value) ? (value as NetworkContentType) : undefined;
}

export function asConsumption(raw: unknown): ConsumptionMode | undefined {
  const value = String(raw || '').trim();
  return CONSUMPTION_SET.has(value) ? (value as ConsumptionMode) : undefined;
}

export function asAccess(raw: unknown): MediaAccess | undefined {
  const value = String(raw || '').trim();
  return ACCESS_SET.has(value) ? (value as MediaAccess) : undefined;
}

export function asMediaProvenance(raw: unknown): MediaProvenance | undefined {
  const value = String(raw || '').trim();
  return PROVENANCE_SET.has(value) ? (value as MediaProvenance) : undefined;
}

export function asMediaExpression(raw: unknown): MediaExpression | undefined {
  const value = String(raw || '').trim().toLowerCase();
  return EXPRESSION_SET.has(value) ? (value as MediaExpression) : undefined;
}

export function looksLikeJsonFeed(body: string, contentType?: string): boolean {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('application/feed+json')) return true;
  const trimmed = String(body || '').trim();
  if (!trimmed.startsWith('{')) return false;
  if (type.includes('application/json') || !type) {
    return /jsonfeed\.org\/version/i.test(trimmed.slice(0, 800)) || /"version"\s*:\s*"https:\/\/jsonfeed\.org/i.test(trimmed.slice(0, 800));
  }
  return false;
}

export function looksLikeXmlFeed(body: string): boolean {
  return /<(rss|feed|channel|item|entry)[\s>]/i.test(body);
}
