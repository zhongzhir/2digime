/**
 * RSS / Atom / Media RSS / JSON Feed 解析。XML 走 fast-xml-parser，不手写 namespace parser。
 */
import { XMLParser } from 'fast-xml-parser';
import { clipText, clipTitle } from './content-canonical';
import {
  asMediaExpression,
  inferContentType,
  isSafePublicMediaUrl,
  mergeOpenMedia,
  parseDurationSeconds,
  parsePositiveInt,
  type OpenMediaFields,
} from './content-media';

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
  kind?: 'rss' | 'atom' | 'json_feed';
}

function xmlParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    trimValues: true,
    isArray: (name) =>
      /^(item|entry|enclosure|author|link|category)$/i.test(name) ||
      /^(media:content|media:thumbnail|media:group|media:player)$/i.test(name),
  });
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

function attr(node: unknown, name: string): string {
  const rec = asRecord(node);
  if (!rec) return '';
  const direct = rec[`@_${name}`] ?? rec[name];
  return typeof direct === 'string' ? direct.trim() : String(direct || '').trim();
}

function textNode(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node).trim();
  const rec = asRecord(node);
  if (!rec) return '';
  if (typeof rec['#text'] === 'string') return rec['#text'].trim();
  if (typeof rec['@_href'] === 'string') return rec['@_href'].trim();
  return '';
}

function child(node: unknown, names: string[]): unknown {
  const rec = asRecord(node);
  if (!rec) return undefined;
  for (const name of names) {
    if (rec[name] != null) return rec[name];
    const found = Object.keys(rec).find((key) => key.toLowerCase() === name.toLowerCase());
    if (found) return rec[found];
  }
  return undefined;
}

function mediaNodes(node: unknown, local: string): unknown[] {
  const rec = asRecord(node);
  if (!rec) return [];
  const keys = Object.keys(rec).filter(
    (key) => key === `media:${local}` || key.toLowerCase() === `media:${local}` || key.toLowerCase() === local,
  );
  const out: unknown[] = [];
  for (const key of keys) out.push(...asArray(rec[key]));
  return out;
}

function pickContent(nodes: unknown[]): OpenMediaFields | undefined {
  const parsed = nodes
    .map((node) => {
      const url = isSafePublicMediaUrl(attr(node, 'url'));
      const player = mediaNodes(node, 'player')[0];
      const embedUrl = isSafePublicMediaUrl(attr(player, 'url'));
      const type = attr(node, 'type');
      const medium = attr(node, 'medium');
      const expression = asMediaExpression(attr(node, 'expression'));
      const isDefault = attr(node, 'isDefault').toLowerCase() === 'true';
      return {
        url,
        embedUrl,
        type,
        medium,
        expression,
        isDefault,
        duration: parseDurationSeconds(attr(node, 'duration')),
        width: parsePositiveInt(attr(node, 'width'), 8192),
        height: parsePositiveInt(attr(node, 'height'), 8192),
        fileSize: parsePositiveInt(attr(node, 'fileSize'), 50_000_000_000),
      };
    })
    .filter((row) => row.url || row.embedUrl);
  if (!parsed.length) return undefined;
  parsed.sort((a, b) => {
    const rank = (row: (typeof parsed)[number]) =>
      (row.isDefault ? 8 : 0) +
      (row.expression === 'full' ? 4 : row.expression === 'sample' ? 0 : 2) +
      (row.medium === 'video' ? 3 : row.medium === 'audio' ? 2 : row.medium === 'image' ? 1 : 0);
    return rank(b) - rank(a);
  });
  const primary = parsed[0]!;
  const contentType = inferContentType({ mimeType: primary.type, medium: primary.medium, mediaUrl: primary.url, embedUrl: primary.embedUrl });
  return {
    ...(contentType ? { contentType } : {}),
    ...(primary.url ? { mediaUrl: primary.url } : {}),
    ...(primary.embedUrl ? { embedUrl: primary.embedUrl } : {}),
    ...(primary.type ? { mimeType: primary.type } : {}),
    ...(primary.duration != null ? { durationSeconds: primary.duration } : {}),
    ...(primary.width != null ? { width: primary.width } : {}),
    ...(primary.height != null ? { height: primary.height } : {}),
    ...(primary.fileSize != null ? { enclosureLength: primary.fileSize } : {}),
    ...(primary.expression ? { mediaExpression: primary.expression } : {}),
    mediaProvenance: 'media_rss',
  };
}

function mediaFromItem(node: unknown): OpenMediaFields | undefined {
  const groups = mediaNodes(node, 'group');
  const groupedContent = groups.flatMap((group) => mediaNodes(group, 'content'));
  const direct = mediaNodes(node, 'content');
  const fromMedia = pickContent(groupedContent.length ? groupedContent : direct);
  const thumbs = [
    ...groups.flatMap((group) => mediaNodes(group, 'thumbnail')),
    ...mediaNodes(node, 'thumbnail'),
  ];
  const thumbnailUrl = thumbs.map((thumb) => isSafePublicMediaUrl(attr(thumb, 'url'))).find(Boolean);
  const player = mediaNodes(node, 'player')[0];
  const playerUrl = isSafePublicMediaUrl(attr(player, 'url'));
  const enclosures = asArray(child(node, ['enclosure']));
  let enclosure: OpenMediaFields | undefined;
  for (const enc of enclosures) {
    const url = isSafePublicMediaUrl(attr(enc, 'url'));
    if (!url) continue;
    const type = attr(enc, 'type');
    enclosure = {
      mediaUrl: url,
      ...(type ? { mimeType: type } : {}),
      ...(type && inferContentType({ mimeType: type }) ? { contentType: inferContentType({ mimeType: type }) } : {}),
      ...(parsePositiveInt(attr(enc, 'length'), 50_000_000_000) != null
        ? { enclosureLength: parsePositiveInt(attr(enc, 'length'), 50_000_000_000) }
        : {}),
      mediaProvenance: 'enclosure',
    };
    break;
  }
  const atomEnclosure = asArray(child(node, ['link'])).find((link) => attr(link, 'rel').toLowerCase() === 'enclosure');
  if (!enclosure && atomEnclosure) {
    const url = isSafePublicMediaUrl(attr(atomEnclosure, 'href'));
    if (url) {
      const type = attr(atomEnclosure, 'type');
      enclosure = {
        mediaUrl: url,
        ...(type ? { mimeType: type } : {}),
        ...(type && inferContentType({ mimeType: type }) ? { contentType: inferContentType({ mimeType: type }) } : {}),
        mediaProvenance: 'enclosure',
      };
    }
  }
  const title = textNode(child(node, ['media:title']));
  const description = textNode(child(node, ['media:description']));
  return mergeOpenMedia(fromMedia, enclosure, {
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...(playerUrl ? { embedUrl: playerUrl } : {}),
    ...(title || description ? { mediaProvenance: fromMedia?.mediaProvenance || enclosure?.mediaProvenance || 'media_rss' } : {}),
  });
}

function rssLink(node: unknown): string {
  const links = asArray(child(node, ['link']));
  for (const link of links) {
    const href = attr(link, 'href') || textNode(link);
    if (href) return href;
  }
  return textNode(child(node, ['guid']));
}

function atomLink(node: unknown): string {
  const links = asArray(child(node, ['link']));
  const alt = links.find((link) => {
    const rel = attr(link, 'rel').toLowerCase();
    return !rel || rel === 'alternate';
  }) || links[0];
  return attr(alt, 'href') || textNode(child(node, ['id']));
}

function authorName(node: unknown): string | undefined {
  const authors = asArray(child(node, ['author', 'dc:creator']));
  for (const author of authors) {
    const name = textNode(child(author, ['name'])) || textNode(author);
    if (name) return clipTitle(name).slice(0, 120);
  }
  const creator = textNode(child(node, ['dc:creator']));
  return creator ? clipTitle(creator).slice(0, 120) : undefined;
}

export function parseXmlFeed(xml: string): ParsedFeed | null {
  let doc: Record<string, unknown>;
  try {
    doc = xmlParser().parse(xml) as Record<string, unknown>;
  } catch {
    return null;
  }
  const rss = asRecord(child(doc, ['rss'])) || doc;
  const channel = asRecord(child(rss, ['channel']));
  const atom = asRecord(child(doc, ['feed']));
  if (channel) {
    const sourceTitle = clipTitle(textNode(child(channel, ['title'])) || '未命名来源');
    const items = asArray(child(channel, ['item'])).map((node) => {
      const media = mediaFromItem(node);
      return {
        title: clipTitle(textNode(child(node, ['title'])) || media?.mediaUrl || ''),
        url: rssLink(node),
        text: clipText(textNode(child(node, ['description', 'summary', 'content:encoded'])) || textNode(child(node, ['media:description'])) || ''),
        ...(textNode(child(node, ['pubDate', 'published', 'updated', 'dc:date']))
          ? { publishedAt: textNode(child(node, ['pubDate', 'published', 'updated', 'dc:date'])) }
          : {}),
        ...(authorName(node) ? { author: authorName(node) } : {}),
        ...(media && Object.keys(media).length ? { media } : {}),
      };
    });
    if (!items.length) return null;
    return { sourceTitle, items, kind: 'rss' };
  }
  if (atom) {
    const sourceTitle = clipTitle(textNode(child(atom, ['title'])) || '未命名来源');
    const items = asArray(child(atom, ['entry'])).map((node) => {
      const media = mediaFromItem(node);
      return {
        title: clipTitle(textNode(child(node, ['title'])) || ''),
        url: atomLink(node),
        text: clipText(textNode(child(node, ['summary', 'content'])) || ''),
        ...(textNode(child(node, ['published', 'updated'])) ? { publishedAt: textNode(child(node, ['published', 'updated'])) } : {}),
        ...(authorName(node) ? { author: authorName(node) } : {}),
        ...(media && Object.keys(media).length ? { media } : {}),
      };
    });
    if (!items.length) return null;
    return { sourceTitle, items, kind: 'atom' };
  }
  return null;
}

export function parseJsonFeed(body: string): ParsedFeed | { error: 'malformed_json' } {
  let doc: unknown;
  try {
    doc = JSON.parse(body) as unknown;
  } catch {
    return { error: 'malformed_json' };
  }
  const rec = asRecord(doc);
  if (!rec || !Array.isArray(rec.items)) return { error: 'malformed_json' };
  const sourceTitle = clipTitle(String(rec.title || '未命名来源'));
  const items: ParsedFeedItem[] = [];
  for (const raw of rec.items) {
    const item = asRecord(raw);
    if (!item) continue;
    const url = String(item.url || item.external_url || item.id || '').trim();
    const authors = asArray(item.authors ?? item.author).map((author) => {
      if (typeof author === 'string') return author;
      const row = asRecord(author);
      return row ? String(row.name || '').trim() : '';
    }).find(Boolean);
    const attachments = asArray(item.attachments);
    let attachment: OpenMediaFields | undefined;
    for (const att of attachments) {
      const row = asRecord(att);
      if (!row) continue;
      const mediaUrl = isSafePublicMediaUrl(row.url);
      if (!mediaUrl) continue;
      const mime = String(row.mime_type || '').trim();
      attachment = {
        mediaUrl,
        ...(mime ? { mimeType: mime } : {}),
        ...(mime && inferContentType({ mimeType: mime }) ? { contentType: inferContentType({ mimeType: mime }) } : {}),
        ...(parseDurationSeconds(row.duration_in_seconds) != null
          ? { durationSeconds: parseDurationSeconds(row.duration_in_seconds) }
          : {}),
        ...(parsePositiveInt(row.size_in_bytes, 50_000_000_000) != null
          ? { enclosureLength: parsePositiveInt(row.size_in_bytes, 50_000_000_000) }
          : {}),
        mediaProvenance: 'json_feed',
      };
      break;
    }
    const image = isSafePublicMediaUrl(item.image);
    const media = mergeOpenMedia(attachment, image ? { thumbnailUrl: image, mediaProvenance: 'json_feed' } : undefined);
    items.push({
      title: clipTitle(String(item.title || url)),
      url,
      text: clipText(String(item.summary || item.content_text || item.content_html || item.title || url)),
      ...(item.date_published ? { publishedAt: String(item.date_published) } : {}),
      ...(authors ? { author: clipTitle(authors).slice(0, 120) } : {}),
      ...(Object.keys(media).length ? { media } : {}),
    });
  }
  return { sourceTitle, items, kind: 'json_feed' };
}
