/**
 * known URL → oEmbed representation。不是 discovery/search。
 * 优先 HTML rel=alternate json+oembed / xml+oembed，不维护手工 provider 表。
 */
import { parse } from 'node-html-parser';
import { XMLParser } from 'fast-xml-parser';
import { safePublicHttpGet } from '../work-runtime/public-http-safety';
import { discoverOembedUrl, parsePageMetadata } from './page-metadata';
import {
  inferContentType,
  isSafePublicMediaUrl,
  parseOembedIframeSrc,
  parsePositiveInt,
  type OpenMediaFields,
} from './content-media';

export interface OEmbedResult {
  type?: string;
  title?: string;
  author_name?: string;
  provider_name?: string;
  thumbnail_url?: string;
  width?: number;
  height?: number;
  embedUrl?: string;
  mediaUrl?: string;
  htmlUnsafeRejected?: boolean;
  media: OpenMediaFields;
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function fromJson(body: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(body));
  } catch {
    return null;
  }
}

function fromXml(body: string): Record<string, unknown> | null {
  try {
    const doc = new XMLParser({ ignoreAttributes: false, trimValues: true }).parse(body) as Record<string, unknown>;
    return asRecord(doc.oembed) || asRecord(doc);
  } catch {
    return null;
  }
}

export function parseOembedBody(body: string, contentHint?: string): OEmbedResult | null {
  const rec =
    /xml/i.test(String(contentHint || '')) || /^\s*</.test(body) ? fromXml(body) || fromJson(body) : fromJson(body) || fromXml(body);
  if (!rec) return null;
  const type = String(rec.type || '').trim().toLowerCase();
  const title = String(rec.title || '').trim();
  const author = String(rec.author_name || '').trim();
  const provider = String(rec.provider_name || '').trim();
  const thumbnail = isSafePublicMediaUrl(rec.thumbnail_url);
  const html = String(rec.html || '');
  const htmlUnsafeRejected = !!(html && (/javascript:/i.test(html) || /<script/i.test(html)));
  const embedUrl = htmlUnsafeRejected ? undefined : parseOembedIframeSrc(html);
  const photoUrl = type === 'photo' ? isSafePublicMediaUrl(rec.url) : undefined;
  const width = parsePositiveInt(rec.width, 8192);
  const height = parsePositiveInt(rec.height, 8192);
  const contentType = inferContentType({ oembedType: type, mediaUrl: photoUrl, embedUrl });
  const media: OpenMediaFields = {
    ...(contentType ? { contentType } : {}),
    ...(author ? { author } : {}),
    ...(thumbnail ? { thumbnailUrl: thumbnail } : {}),
    ...(photoUrl ? { mediaUrl: photoUrl } : {}),
    ...(embedUrl ? { embedUrl } : {}),
    ...(width != null ? { width } : {}),
    ...(height != null ? { height } : {}),
    mediaProvenance: 'oembed',
    consumption: embedUrl ? 'OFFICIAL_EMBED' : photoUrl ? 'INLINE_MEDIA' : 'OPEN_SOURCE',
  };
  return {
    ...(type ? { type } : {}),
    ...(title ? { title } : {}),
    ...(author ? { author_name: author } : {}),
    ...(provider ? { provider_name: provider } : {}),
    ...(thumbnail ? { thumbnail_url: thumbnail } : {}),
    ...(width != null ? { width } : {}),
    ...(height != null ? { height } : {}),
    ...(embedUrl ? { embedUrl } : {}),
    ...(photoUrl ? { mediaUrl: photoUrl } : {}),
    ...(htmlUnsafeRejected ? { htmlUnsafeRejected: true } : {}),
    media,
  };
}

export async function resolveOEmbed(input: {
  url: string;
  html?: string;
  fetchImpl?: typeof safePublicHttpGet;
}): Promise<OEmbedResult | null> {
  const fetchImpl = input.fetchImpl || safePublicHttpGet;
  let endpoint = '';
  let html = input.html || '';
  if (!html) {
    try {
      const page = await fetchImpl(input.url, { accept: 'text/html, application/xhtml+xml, */*;q=0.1' }, undefined, {
        maxBodyBytes: 1_500_000,
      });
      if (page.status >= 200 && page.status < 300) html = page.body || '';
    } catch {
      return null;
    }
  }
  if (html) {
    const meta = parsePageMetadata(html, input.url);
    endpoint = meta.oembedUrl || discoverOembedUrl(html, input.url) || '';
  }
  if (!endpoint) return null;
  try {
    const got = await fetchImpl(endpoint, { accept: 'application/json+oembed, application/json, text/xml+oembed, application/xml, */*;q=0.1' });
    if (got.status < 200 || got.status >= 300) return null;
    return parseOembedBody(got.body || '');
  } catch {
    return null;
  }
}

export function hasOembedLink(html: string): boolean {
  const root = parse(html);
  return !!root.querySelector('link[rel][type="application/json+oembed"], link[rel][type="text/xml+oembed"]');
}
