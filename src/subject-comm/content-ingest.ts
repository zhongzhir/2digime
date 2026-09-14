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
  publishedAt?: string;
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
  const ogTitle =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
    fallbackUrl;
  const ogText =
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    ogTitle;
  const ogUrl =
    html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)?.[1] || fallbackUrl;
  return {
    title: xmlUnescape(ogTitle),
    url: xmlUnescape(ogUrl),
    text: xmlUnescape(ogText),
  };
}

async function toNetworkItem(input: {
  item: ParsedFeedItem;
  sourceUrl: string;
  sourceTitle: string;
  now: string;
  enrich?: ContentEnricher;
  existing?: NetworkItem;
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
  const raw: NetworkItem = {
    schemaVersion: NETWORK_ITEM_SCHEMA_VERSION,
    itemId: contentItemId(canonicalUrl),
    publisherSubjectId: sourcePublisherId(normalizeCanonicalUrl(input.sourceUrl)),
    publisherDisplayName: clipTitle(input.sourceTitle).slice(0, 80),
    kind: NETWORK_ITEM_KIND_CONTENT,
    createdAt,
    visibility: NETWORK_ITEM_VISIBILITY_PUBLIC,
    content: { title, text, url: canonicalUrl },
    provenance: {
      origin: 'publisher',
      actor,
      statedAt: input.now,
      excerpt: clipText(input.item.text || title).slice(0, 400),
    },
  };
  const checked = validateNetworkItem(raw);
  if (!checked.ok) return { status: 'rejected', reason: checked.reason };
  if (input.existing) {
    const same =
      input.existing.content.title === checked.item.content.title &&
      input.existing.content.text === checked.item.content.text &&
      input.existing.content.url === checked.item.content.url;
    return { item: checked.item, status: same ? 'duplicate' : 'updated' };
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
    fetched = await fetchImpl(input.sourceUrl, { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.1' });
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
  const looksFeed = /<(rss|feed|channel|item|entry)[\s>]/i.test(body);
  const parsed = looksFeed
    ? parseFeed(body)
    : { sourceTitle: clipTitle(parseHtmlPreview(body, fetched.finalUrl).title), items: [parseHtmlPreview(body, fetched.finalUrl)] };
  const limit = Math.min(Math.max(input.limit ?? 12, 1), 50);
  const records: IngestRecord[] = [];
  const items: NetworkItem[] = [];
  for (const rawItem of parsed.items.slice(0, limit)) {
    const itemIdGuess = (() => {
      try {
        return contentItemId(normalizeCanonicalUrl(rawItem.url));
      } catch {
        return '';
      }
    })();
    const existing = itemIdGuess ? await existingById(input.store, itemIdGuess, now) : undefined;
    const result = await toNetworkItem({
      item: rawItem,
      sourceUrl: input.sourceUrl,
      sourceTitle: parsed.sourceTitle,
      now,
      ...(input.enrich ? { enrich: input.enrich } : {}),
      ...(existing ? { existing } : {}),
    });
    if (result.status === 'rejected') {
      records.push({ status: 'rejected', reason: result.reason, sourceTitle: parsed.sourceTitle });
      continue;
    }
    await input.store.put(result.item);
    items.push(result.item);
    records.push({
      status: result.status,
      itemId: result.item.itemId,
      ...(result.item.content.url ? { canonicalUrl: result.item.content.url } : {}),
      sourceTitle: parsed.sourceTitle,
    });
  }
  return { sourceTitle: parsed.sourceTitle, records, items };
}
