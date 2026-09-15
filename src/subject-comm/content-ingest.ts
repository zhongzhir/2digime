/**
 * 低成本供给：RSS/Atom 或单 URL → 规范化 NetworkItem。
 * 不爬站、不托管原文、不写用户偏好。AI 描述只看内容本身。
 */
import { safePublicHttpGet } from '../work-runtime/public-http-safety';
import type { NetworkItemStore } from '../relay-service/network-item-store';
import {
  NETWORK_ITEM_KIND_CONTENT,
  NETWORK_ITEM_SCHEMA_VERSION,
  NETWORK_ITEM_VISIBILITY_PUBLIC,
  validateNetworkItem,
  type NetworkItem,
} from './network-item';
import {
  clipText,
  clipTitle,
  contentItemId,
  normalizeCanonicalUrl,
  sourcePublisherId,
} from './content-canonical';
import { parsePageMetadata } from './page-metadata';
import type { NetworkItemDiscoveryVia } from './network-item';
import { parseJsonFeed, parseXmlFeed } from './content-feed';
import { resolveOEmbed } from './content-oembed';
import {
  consumptionFor,
  looksLikeJsonFeed,
  looksLikeXmlFeed,
  mergeOpenMedia,
  type OpenMediaFields,
} from './content-media';

export type IngestStatus =
  | 'published'
  | 'updated'
  | 'duplicate'
  | 'rejected'
  | 'unavailable';

export interface IngestRecord {
  status: IngestStatus;
  canonicalUrl?: string;
  itemId?: string;
  reason?: string;
  sourceTitle?: string;
}

export interface ParsedFeedItem {
  title: string;
  url: string;
  text: string;
  publishedAt?: string | undefined;
  author?: string | undefined;
  media?: OpenMediaFields | undefined;
}

export interface ParsedFeed {
  sourceTitle: string;
  items: ParsedFeedItem[];
}

export type ContentEnricher = (input: {
  title: string;
  text: string;
  url: string;
}) => Promise<string | null>;

export interface IngestSourceInput {
  sourceUrl: string;
  store: NetworkItemStore;
  now?: string;
  limit?: number;
  enrich?: ContentEnricher;
  fetchImpl?: typeof safePublicHttpGet;
  via?: NetworkItemDiscoveryVia;
}

function xmlUnescape(raw: string): string {
  return String(raw || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .trim();
}

function innerTag(block: string, names: string[]): string {
  for (const name of names) {
    const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
    const match = block.match(re);
    if (match?.[1]) return xmlUnescape(match[1]);
  }
  return '';
}

function atomLink(block: string): string {
  const alt =
    block.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i) ||
    block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']alternate["'][^>]*\/?>/i) ||
    block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  return alt?.[1] ? xmlUnescape(alt[1]) : '';
}

function toIso(raw: string, fallback: string): string {
  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  return fallback;
}

export function parseFeed(xml: string): ParsedFeed {
  const structured = parseXmlFeed(xml);
  if (structured && structured.items.length) {
    return {
      sourceTitle: structured.sourceTitle,
      items: structured.items.map((item) => ({
        title: item.title,
        url: item.url,
        text: item.text || item.title,
        ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}),
        ...(item.author ? { author: item.author } : {}),
        ...(item.media ? { media: item.media } : {}),
      })),
    };
  }
  const sourceTitle = clipTitle(innerTag(xml, ['title']) || '未命名来源');
  const rssBlocks = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
    .map((m) => m[1] || '')
    .filter(Boolean);
  if (rssBlocks.length) {
    return {
      sourceTitle,
      items: rssBlocks.map((block) => ({
        title: innerTag(block, ['title']),
        url: innerTag(block, ['link']) || innerTag(block, ['guid']),
        text: innerTag(block, ['description', 'summary', 'content:encoded']),
        publishedAt: innerTag(block, ['pubDate', 'published', 'updated', 'dc:date']),
      })),
    };
  }
  const atomBlocks = [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)]
    .map((m) => m[1] || '')
    .filter(Boolean);
  return {
    sourceTitle,
    items: atomBlocks.map((block) => ({
      title: innerTag(block, ['title']),
      url: atomLink(block) || innerTag(block, ['id']),
      text: innerTag(block, ['summary', 'content']),
      publishedAt: innerTag(block, ['published', 'updated']),
    })),
  };
}

export function parseHtmlPreview(html: string, fallbackUrl: string): ParsedFeedItem {
  const meta = parsePageMetadata(html, fallbackUrl);
  const media = mergeOpenMedia(meta.media, {
    ...(meta.contentType ? { contentType: meta.contentType } : {}),
    ...(meta.author ? { author: meta.author } : {}),
    ...(meta.thumbnailUrl ? { thumbnailUrl: meta.thumbnailUrl } : {}),
    ...(meta.mediaUrl ? { mediaUrl: meta.mediaUrl } : {}),
    ...(meta.embedUrl ? { embedUrl: meta.embedUrl } : {}),
    ...(meta.durationSeconds != null ? { durationSeconds: meta.durationSeconds } : {}),
    ...(meta.width != null ? { width: meta.width } : {}),
    ...(meta.height != null ? { height: meta.height } : {}),
    ...(meta.access ? { access: meta.access } : {}),
    ...(meta.media?.mediaProvenance ? { mediaProvenance: meta.media.mediaProvenance } : meta.mediaUrl || meta.embedUrl ? { mediaProvenance: 'schema_org' } : {}),
  });
  return {
    title: meta.title,
    url: meta.canonicalUrl,
    text: meta.description,
    ...(meta.publishedAt ? { publishedAt: meta.publishedAt } : {}),
    ...(meta.author ? { author: meta.author } : {}),
    ...(Object.keys(media).length ? { media } : {}),
  };
}

function sameItem(a: NetworkItem, b: NetworkItem): boolean {
  return (
    a.content.title === b.content.title &&
    a.content.text === b.content.text &&
    a.content.url === b.content.url &&
    a.content.contentType === b.content.contentType &&
    a.content.thumbnailUrl === b.content.thumbnailUrl &&
    a.content.mediaUrl === b.content.mediaUrl &&
    a.content.embedUrl === b.content.embedUrl &&
    a.content.consumption === b.content.consumption &&
    a.content.access === b.content.access
  );
}

async function toNetworkItem(input: {
  item: ParsedFeedItem;
  sourceUrl: string;
  sourceTitle: string;
  now: string;
  enrich?: ContentEnricher;
  existing?: NetworkItem;
  via?: NetworkItemDiscoveryVia;
}): Promise<{ item: NetworkItem; status: 'published' | 'updated' | 'duplicate' } | { status: 'rejected'; reason: string }> {
  let canonicalUrl: string;
  try {
    canonicalUrl = normalizeCanonicalUrl(input.item.url);
  } catch (err) {
    return { status: 'rejected', reason: (err as { code?: string }).code || 'invalid_url' };
  }
  const title = clipTitle(input.item.title || canonicalUrl);
  let text = clipText(input.item.text || title);
  if (!title || !text) return { status: 'rejected', reason: 'empty_item' };
  let actor: 'owner' | 'model' = 'owner';
  if (input.enrich) {
    try {
      const extra = await input.enrich({ title, text, url: canonicalUrl });
      if (extra && extra.trim()) {
        text = clipText(extra.trim());
        actor = 'model';
      }
    } catch {
      /* 来源摘要仍可用；不把模型失败写成摄入失败 */
    }
  }
  const createdAt = input.existing?.createdAt || toIso(input.item.publishedAt || '', input.now);
  const media = input.item.media || {};
  const consumption = media.consumption || consumptionFor(media);
  const raw: NetworkItem = {
    schemaVersion: NETWORK_ITEM_SCHEMA_VERSION,
    itemId: contentItemId(canonicalUrl),
    publisherSubjectId: sourcePublisherId(normalizeCanonicalUrl(input.sourceUrl)),
    publisherDisplayName: clipTitle(input.sourceTitle).slice(0, 80),
    kind: NETWORK_ITEM_KIND_CONTENT,
    createdAt,
    visibility: NETWORK_ITEM_VISIBILITY_PUBLIC,
    content: {
      title,
      text,
      url: canonicalUrl,
      ...(media.contentType ? { contentType: media.contentType } : {}),
      ...(media.author || input.item.author ? { author: media.author || input.item.author } : {}),
      ...(input.item.publishedAt && Number.isFinite(Date.parse(input.item.publishedAt))
        ? { publishedAt: new Date(input.item.publishedAt).toISOString() }
        : {}),
      ...(media.thumbnailUrl ? { thumbnailUrl: media.thumbnailUrl } : {}),
      ...(media.mediaUrl ? { mediaUrl: media.mediaUrl } : {}),
      ...(media.embedUrl ? { embedUrl: media.embedUrl } : {}),
      ...(media.mimeType ? { mimeType: media.mimeType } : {}),
      ...(media.durationSeconds != null ? { durationSeconds: media.durationSeconds } : {}),
      ...(media.width != null ? { width: media.width } : {}),
      ...(media.height != null ? { height: media.height } : {}),
      ...(media.enclosureLength != null ? { enclosureLength: media.enclosureLength } : {}),
      ...(media.access ? { access: media.access } : { access: 'public' }),
      ...(consumption ? { consumption } : {}),
      ...(media.mediaExpression ? { mediaExpression: media.mediaExpression } : {}),
      ...(media.mediaProvenance ? { mediaProvenance: media.mediaProvenance } : {}),
    },
    provenance: {
      origin: 'publisher',
      actor,
      statedAt: input.now,
      excerpt: clipText(input.item.text || title).slice(0, 400),
      ...(input.via ? { via: input.via } : {}),
    },
  };
  const checked = validateNetworkItem(raw);
  if (!checked.ok) return { status: 'rejected', reason: checked.reason };
  if (input.existing) {
    const mergedMedia = mergeOpenMedia(
      {
        contentType: input.existing.content.contentType,
        author: input.existing.content.author,
        thumbnailUrl: input.existing.content.thumbnailUrl,
        mediaUrl: input.existing.content.mediaUrl,
        embedUrl: input.existing.content.embedUrl,
        mimeType: input.existing.content.mimeType,
        durationSeconds: input.existing.content.durationSeconds,
        width: input.existing.content.width,
        height: input.existing.content.height,
        enclosureLength: input.existing.content.enclosureLength,
        access: input.existing.content.access,
        consumption: input.existing.content.consumption,
        mediaExpression: input.existing.content.mediaExpression,
        mediaProvenance: input.existing.content.mediaProvenance,
      },
      media,
    );
    const merged: NetworkItem = {
      ...checked.item,
      createdAt: input.existing.createdAt,
      content: {
        title: checked.item.content.title,
        text: checked.item.content.text,
        ...(checked.item.content.url ? { url: checked.item.content.url } : {}),
        ...mergedMedia,
        consumption: mergedMedia.consumption || consumptionFor(mergedMedia),
      },
    };
    const mergedChecked = validateNetworkItem(merged);
    if (!mergedChecked.ok) return { item: checked.item, status: sameItem(input.existing, checked.item) ? 'duplicate' : 'updated' };
    return { item: mergedChecked.item, status: sameItem(input.existing, mergedChecked.item) ? 'duplicate' : 'updated' };
  }
  return { item: checked.item, status: 'published' };
}

async function existingById(store: NetworkItemStore, itemId: string, now: string): Promise<NetworkItem | undefined> {
  if (store.get) return store.get(itemId, now);
  const listed = await store.list({ limit: 100 }, now);
  return listed.items.find((item) => item.itemId === itemId);
}

export async function ingestSource(input: IngestSourceInput): Promise<{
  sourceTitle: string;
  records: IngestRecord[];
  items: NetworkItem[];
}> {
  const now = input.now || new Date().toISOString();
  const fetchImpl = input.fetchImpl || safePublicHttpGet;
  let fetched;
  try {
    fetched = await fetchImpl(input.sourceUrl, {
      accept:
        'application/feed+json, application/rss+xml, application/atom+xml, application/xml, text/xml, application/json;q=0.9, text/html;q=0.8, */*;q=0.1',
    });
  } catch (err) {
    return {
      sourceTitle: '',
      records: [{ status: 'unavailable', reason: (err as { code?: string }).code || 'fetch_failed', canonicalUrl: input.sourceUrl }],
      items: [],
    };
  }
  if (fetched.status < 200 || fetched.status >= 300) {
    return {
      sourceTitle: '',
      records: [{ status: 'unavailable', reason: `http_${fetched.status}`, canonicalUrl: fetched.finalUrl }],
      items: [],
    };
  }
  const body = fetched.body || '';
  if (looksLikeJsonFeed(body) || /^\s*\{/.test(body) && /"items"\s*:/.test(body.slice(0, 2000))) {
    const json = parseJsonFeed(body);
    if ('error' in json) {
      return {
        sourceTitle: '',
        records: [{ status: 'rejected', reason: json.error, canonicalUrl: fetched.finalUrl }],
        items: [],
      };
    }
    return persistParsed({
      parsed: json,
      sourceUrl: input.sourceUrl,
      store: input.store,
      now,
      limit: Math.min(Math.max(input.limit ?? 12, 1), 50),
      via: input.via || 'feed',
      ...(input.enrich ? { enrich: input.enrich } : {}),
    });
  }
  const looksFeed = looksLikeXmlFeed(body);
  const parsed = looksFeed
    ? parseFeed(body)
    : { sourceTitle: clipTitle(parseHtmlPreview(body, fetched.finalUrl).title), items: [parseHtmlPreview(body, fetched.finalUrl)] };
  if (!looksFeed) {
    const preview = parsed.items[0];
    const meta = parsePageMetadata(body, fetched.finalUrl);
    if (preview && meta.oembedUrl) {
      const oem = await resolveOEmbed({ url: fetched.finalUrl, html: body, fetchImpl });
      if (oem) preview.media = mergeOpenMedia(preview.media, oem.media);
    }
  }
  return persistParsed({
    parsed,
    sourceUrl: input.sourceUrl,
    store: input.store,
    now,
    limit: Math.min(Math.max(input.limit ?? 12, 1), 50),
    via: input.via || (looksFeed ? 'feed' : 'page'),
    ...(input.enrich ? { enrich: input.enrich } : {}),
  });
}

async function persistParsed(input: {
  parsed: ParsedFeed;
  sourceUrl: string;
  store: NetworkItemStore;
  now: string;
  limit: number;
  enrich?: ContentEnricher;
  via?: NetworkItemDiscoveryVia;
}): Promise<{ sourceTitle: string; records: IngestRecord[]; items: NetworkItem[] }> {
  const records: IngestRecord[] = [];
  const items: NetworkItem[] = [];
  for (const rawItem of input.parsed.items.slice(0, input.limit)) {
    const itemIdGuess = (() => {
      try {
        return contentItemId(normalizeCanonicalUrl(rawItem.url));
      } catch {
        return '';
      }
    })();
    const existing = itemIdGuess ? await existingById(input.store, itemIdGuess, input.now) : undefined;
    const result = await toNetworkItem({
      item: rawItem,
      sourceUrl: input.sourceUrl,
      sourceTitle: input.parsed.sourceTitle,
      now: input.now,
      ...(input.enrich ? { enrich: input.enrich } : {}),
      ...(existing ? { existing } : {}),
      ...(input.via ? { via: input.via } : {}),
    });
    if (result.status === 'rejected') {
      records.push({ status: 'rejected', reason: result.reason, sourceTitle: input.parsed.sourceTitle });
      continue;
    }
    await input.store.put(result.item);
    items.push(result.item);
    records.push({
      status: result.status,
      itemId: result.item.itemId,
      ...(result.item.content.url ? { canonicalUrl: result.item.content.url } : {}),
      sourceTitle: input.parsed.sourceTitle,
    });
  }
  return { sourceTitle: input.parsed.sourceTitle, records, items };
}
