/**
 * 极薄内容来源选择：按 requestedContentTypes 调用已有成熟开放能力。
 * 不自建搜索引擎，不 scraper 中心平台，不产出第二套 MediaItem。
 */
import { parse } from 'node-html-parser';
import { safePublicHttpGet, type SafePublicHttpGetResult } from '../work-runtime/public-http-safety';
import {
  consumptionFor,
  hasPlayableAudioRepresentation,
  inferContentType,
  isSafePublicMediaUrl,
  parseDurationSeconds,
  type NetworkContentType,
} from './content-media';
import {
  clipText,
  clipTitle,
  contentItemId,
  normalizeCanonicalUrl,
  sourcePublisherId,
} from './content-canonical';
import {
  NETWORK_ITEM_KIND_CONTENT,
  NETWORK_ITEM_SCHEMA_VERSION,
  NETWORK_ITEM_VISIBILITY_PUBLIC,
  validateNetworkItem,
  type NetworkItem,
} from './network-item';
import { catalogEndpointsFor, type OpenSourceEndpoint } from './open-source-catalog';

export type SourceContentKind = 'article' | 'video' | 'image' | 'audio';

export interface OpenMediaHit {
  title: string;
  url: string;
  snippet?: string;
  contentType: SourceContentKind;
  capability: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  embedUrl?: string;
  durationSeconds?: number;
  mimeType?: string;
  author?: string;
  feedUrl?: string;
  mediaExpression?: 'full' | 'sample';
}

export type OpenMediaFetch = (
  url: string,
  headers?: Record<string, string>,
) => Promise<Pick<SafePublicHttpGetResult, 'status' | 'body' | 'finalUrl'>>;

const NOW_FALLBACK = () => new Date().toISOString();

export function sourceKindsForRequest(requested: string[]): SourceContentKind[] {
  const wanted = requested.filter(
    (row): row is SourceContentKind => row === 'article' || row === 'video' || row === 'image' || row === 'audio',
  );
  return wanted.length ? wanted : ['article', 'video', 'image', 'audio'];
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(String(body || '').trim() || 'null');
  } catch {
    return null;
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function absUrl(base: string, raw: string): string {
  const value = String(raw || '').trim();
  if (!value) return '';
  try {
    return new URL(value, base).toString();
  } catch {
    return '';
  }
}

function asSafe(url: string | undefined): string | undefined {
  return url ? isSafePublicMediaUrl(url) : undefined;
}

async function readJson(
  fetchImpl: OpenMediaFetch,
  url: string,
): Promise<unknown> {
  const got = await fetchImpl(url, { accept: 'application/json, text/plain;q=0.8' });
  if (got.status < 200 || got.status >= 300) return null;
  return parseJson(got.body);
}

function peertubeHits(endpoint: OpenSourceEndpoint, data: unknown): OpenMediaHit[] {
  const rec = data && typeof data === 'object' ? (data as { data?: unknown }) : null;
  const rows = rec && Array.isArray(rec.data) ? rec.data : [];
  const origin = originOf(endpoint.url);
  const out: OpenMediaHit[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const url = asSafe(absUrl(origin, String(item.url || item.embedUrl || ''))) || '';
    if (!url) continue;
    const title = clipTitle(String(item.name || item.title || url));
    if (!title) continue;
    const thumb = asSafe(absUrl(origin, String(item.thumbnailUrl || item.thumbnailPath || '')));
    const embed = asSafe(absUrl(origin, String(item.embedUrl || item.embedPath || '')));
    const duration = parseDurationSeconds(item.duration);
    const account = item.account && typeof item.account === 'object' ? (item.account as Record<string, unknown>) : {};
    out.push({
      title,
      url,
      contentType: 'video',
      capability: endpoint.id,
      ...(thumb ? { thumbnailUrl: thumb } : {}),
      ...(embed ? { embedUrl: embed } : {}),
      ...(duration != null ? { durationSeconds: duration } : {}),
      ...(account.displayName ? { author: clipTitle(String(account.displayName)).slice(0, 80) } : {}),
      snippet: clipText(String(item.description || title)).slice(0, 400),
    });
    if (out.length >= 8) break;
  }
  return out;
}

function commonsHits(endpoint: OpenSourceEndpoint, data: unknown, kind: SourceContentKind): OpenMediaHit[] {
  const rec = data && typeof data === 'object' ? (data as { query?: { pages?: unknown } }) : null;
  const pages = rec?.query?.pages && typeof rec.query.pages === 'object' ? rec.query.pages : {};
  const out: OpenMediaHit[] = [];
  for (const page of Object.values(pages as Record<string, unknown>)) {
    if (!page || typeof page !== 'object') continue;
    const item = page as Record<string, unknown>;
    const fileTitle = String(item.title || '').replace(/^File:/i, '');
    const info = Array.isArray(item.imageinfo) ? item.imageinfo[0] : null;
    if (!info || typeof info !== 'object') continue;
    const media = info as Record<string, unknown>;
    const originalUrl = asSafe(String(media.url || ''));
    const thumbUrl = asSafe(String(media.thumburl || ''));
    if (!originalUrl && !thumbUrl) continue;
    const mime = String(media.mime || '');
    const detected = inferContentType({ mimeType: mime, mediaUrl: originalUrl || thumbUrl });
    if (kind === 'image' && detected !== 'image') continue;
    if (kind === 'video' && detected !== 'video') continue;
    if (/\.(djvu|pdf)(\?|$)/i.test(originalUrl || '') || /djvu|application\/pdf/i.test(mime)) continue;
    const displayUrl = thumbUrl || originalUrl || '';
    const mediaUrl = detected === 'image' ? displayUrl : originalUrl || displayUrl;
    if (!mediaUrl) continue;
    const pageUrl =
      asSafe(`https://commons.wikimedia.org/wiki/${encodeURI(String(item.title || ''))}`) || mediaUrl;
    out.push({
      title: clipTitle(fileTitle || pageUrl),
      url: pageUrl,
      contentType: detected === 'video' ? 'video' : 'image',
      capability: endpoint.id,
      mediaUrl,
      thumbnailUrl: displayUrl,
      ...(mime ? { mimeType: mime.slice(0, 80) } : {}),
      snippet: clipText(fileTitle).slice(0, 400),
    });
    if (out.length >= 8) break;
  }
  return out;
}

function itunesHits(endpoint: OpenSourceEndpoint, data: unknown): OpenMediaHit[] {
  const rec = data && typeof data === 'object' ? (data as { results?: unknown }) : null;
  const rows = rec && Array.isArray(rec.results) ? rec.results : [];
  const out: OpenMediaHit[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const page = asSafe(String(item.trackViewUrl || item.collectionViewUrl || '')) || '';
    const feedUrl = asSafe(String(item.feedUrl || ''));
    const kindName = String(item.kind || '');
    const isEpisode = kindName === 'podcast-episode';
    const episodeUrl = asSafe(String(item.episodeUrl || ''));
    const previewUrl = asSafe(String(item.previewUrl || ''));
    const candidate = episodeUrl || (isEpisode ? previewUrl : undefined);
    const mimeHint = String(item.episodeContentType || '');
    const mediaUrl =
      candidate && hasPlayableAudioRepresentation({ mediaUrl: candidate, mimeType: mimeHint })
        ? candidate
        : undefined;
    const url = page || feedUrl || mediaUrl || '';
    if (!url) continue;
    const title = clipTitle(String(item.trackName || item.collectionName || url));
    if (!title) continue;
    const duration = parseDurationSeconds(
      typeof item.trackTimeMillis === 'number' ? item.trackTimeMillis / 1000 : item.trackTimeMillis,
    );
    const thumb = asSafe(String(item.artworkUrl600 || item.artworkUrl160 || item.artworkUrl100 || ''));
    out.push({
      title,
      url,
      contentType: 'audio',
      capability: endpoint.id,
      ...(mediaUrl ? { mediaUrl } : {}),
      ...(thumb ? { thumbnailUrl: thumb } : {}),
      ...(mediaUrl && duration != null && duration > 0 ? { durationSeconds: duration } : {}),
      ...(item.artistName ? { author: clipTitle(String(item.artistName)).slice(0, 80) } : {}),
      ...(feedUrl ? { feedUrl } : {}),
      ...(mediaUrl && previewUrl && mediaUrl === previewUrl && !episodeUrl
        ? { mediaExpression: 'sample' as const }
        : {}),
      snippet: clipText(String(item.shortDescription || item.description || item.collectionName || title)).slice(0, 400),
    });
    if (out.length >= 8) break;
  }
  return out;
}

function itunesTopHits(endpoint: OpenSourceEndpoint, data: unknown): OpenMediaHit[] {
  const rec = data && typeof data === 'object' ? (data as { feed?: { entry?: unknown } }) : null;
  const rows = rec?.feed && Array.isArray(rec.feed.entry) ? rec.feed.entry : [];
  const out: OpenMediaHit[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const labelOf = (value: unknown) => {
      if (!value) return '';
      if (typeof value === 'string') return value;
      if (typeof value === 'object' && 'label' in value) return String((value as { label?: string }).label || '');
      return '';
    };
    const url = asSafe(labelOf(item.id) || labelOf(item.link)) || '';
    if (!url) continue;
    const title = clipTitle(labelOf(item['im:name']) || labelOf(item.title) || url);
    if (!title) continue;
    const images = Array.isArray(item['im:image']) ? item['im:image'] : [];
    const thumb = asSafe(labelOf(images[images.length - 1]));
    out.push({
      title,
      url,
      contentType: 'audio',
      capability: endpoint.id,
      ...(thumb ? { thumbnailUrl: thumb } : {}),
      ...(labelOf(item['im:artist']) ? { author: clipTitle(labelOf(item['im:artist'])).slice(0, 80) } : {}),
      snippet: clipText(labelOf(item.summary) || title).slice(0, 400),
    });
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * 国内公开视频列表页：扫描公开 HTML 属性里的直链 MP4 与其文章页链接。
 * 通用属性扫描，不写站点专用正文 selector，不调用平台内部接口。
 * 仅接受 http(s) 直链 MP4；找不到直链时该条不入池（不伪造直接播放）。
 */
export function listingVideoHits(endpoint: OpenSourceEndpoint, html: string): OpenMediaHit[] {
  const root = parse(html);
  const out: OpenMediaHit[] = [];
  const seen = new Set<string>();
  const MEDIA_ATTRS = ['video-src', 'data-video-src', 'data-src', 'data-video', 'data-url', 'src'];
  const PAGE_ATTRS = ['node-url', 'data-node-url', 'data-href'];
  for (const node of root.querySelectorAll('[video-src],[data-video-src],[data-src],[data-video],[data-url],video[src],source[src]')) {
    const rawVideo = MEDIA_ATTRS.map((attr) => node.getAttribute(attr)).find((value) => value && /\.(mp4|m4v|mov|webm|ogv)(\?|$)/i.test(value)) || '';
    const mediaUrl = asSafe(absUrl(endpoint.url, String(rawVideo).trim()));
    // Only accept a natively playable progressive container; never a page or HLS/DASH manifest.
    if (!mediaUrl || !/\.(mp4|m4v|mov|webm|ogv)(\?|$)/i.test(mediaUrl)) continue;
    if (seen.has(mediaUrl)) continue;
    // Page URL: the node's own attribute, else the nearest anchor inside the node or its parent.
    const scope = (node.parentNode as typeof node | null) ?? node;
    let pageUrl = '';
    for (const attr of PAGE_ATTRS) {
      pageUrl = asSafe(absUrl(endpoint.url, String(node.getAttribute(attr) || '').trim())) || '';
      if (pageUrl) break;
    }
    const anchor = node.querySelector('a[href]') || scope.querySelector('a[href]');
    if (!pageUrl && anchor) pageUrl = asSafe(absUrl(endpoint.url, String(anchor.getAttribute('href') || '').trim())) || '';
    // Title: same-node anchor text / title attr / image alt, else the nearest anchor text in scope.
    let titleText =
      clipTitle(String(node.querySelector('a')?.text || '').trim()) ||
      clipTitle(String(node.getAttribute('title') || '').trim()) ||
      clipTitle(String(node.querySelector('img')?.getAttribute('alt') || '').trim());
    if (!titleText) {
      // The nearest anchor is often an image-only link; prefer the longest readable anchor text.
      const candidates = [scope, scope.parentNode].filter(Boolean) as ReturnType<typeof parse>[];
      let best = '';
      for (const container of candidates) {
        for (const a of container.querySelectorAll('a')) {
          const text = clipTitle(String(a.text || '').trim());
          if (text.length > best.length && text.length <= 140) best = text;
        }
      }
      if (best) titleText = best;
    }
    seen.add(mediaUrl);
    out.push({
      title: titleText || clipTitle(pageUrl || mediaUrl),
      url: pageUrl || mediaUrl,
      contentType: 'video',
      capability: endpoint.id,
      mediaUrl,
      mimeType: /\.webm(\?|$)/i.test(mediaUrl) ? 'video/webm' : 'video/mp4',
      mediaExpression: 'full',
      snippet: clipText(titleText || pageUrl || mediaUrl).slice(0, 400),
    });
    if (out.length >= 8) break;
  }
  return out;
}

/**
 * 哔哩哔哩官方公开播放器（player.bilibili.com）。只从公开列表页读取视频 id 与其标题，
 * 组装官方 embed；不调用平台内部 API，不解析私有播放地址。找不到标题时退回页面标题。
 */
export function bilibiliHits(endpoint: OpenSourceEndpoint, html: string): OpenMediaHit[] {
  const root = parse(html);
  const out: OpenMediaHit[] = [];
  const seen = new Set<string>();
  for (const anchor of root.querySelectorAll('a[href*="/video/BV"]')) {
    const href = String(anchor.getAttribute('href') || '');
    const bvid = (href.match(/BV[0-9A-Za-z]{10}/) || [])[0];
    if (!bvid || seen.has(bvid)) continue;
    const card = anchor.closest('.bili-video-card') || (anchor.parentNode as typeof anchor | null);
    const anchorText = clipTitle(String(anchor.text || '').trim());
    const title =
      clipTitle(String(anchor.getAttribute('title') || '').trim()) ||
      clipTitle(String(card?.querySelector('.bili-video-card__title')?.getAttribute('title') || '').trim()) ||
      clipTitle(String(anchor.querySelector('img')?.getAttribute('alt') || '').trim()) ||
      clipTitle(String(card?.querySelector('.bili-video-card__title')?.text || '').trim()) ||
      (anchorText.length > 6 ? anchorText : '');
    seen.add(bvid);
    out.push({
      title: title || bvid,
      url: `https://www.bilibili.com/video/${bvid}`,
      contentType: 'video',
      capability: endpoint.id,
      embedUrl: `https://player.bilibili.com/player.html?bvid=${bvid}&autoplay=0`,
      mediaExpression: 'full',
      snippet: clipText(title || bvid).slice(0, 400),
    });
    if (out.length >= 8) break;
  }
  return out;
}

function peertubeListUrl(endpoint: OpenSourceEndpoint, query: string): string {
  if (query) return `${endpoint.url}?search=${encodeURIComponent(query)}&count=8&nsfw=false`;
  return `${originOf(endpoint.url)}/api/v1/videos?count=8&nsfw=false`;
}

function commonsListUrl(endpoint: OpenSourceEndpoint, kind: SourceContentKind, query: string): string {
  if (!query) {
    if (kind === 'video') {
      return (
        `${endpoint.url}?action=query&format=json&generator=search` +
        `&gsrsearch=${encodeURIComponent('filetype:video')}&gsrnamespace=6&gsrlimit=8` +
        `&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=1280`
      );
    }
    return (
      `${endpoint.url}?action=query&format=json&generator=allimages&gailimit=8` +
      `&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=1280`
    );
  }
  const gsr = kind === 'video' ? `filetype:video ${query}` : query;
  return (
    `${endpoint.url}?action=query&format=json&generator=search` +
    `&gsrsearch=${encodeURIComponent(gsr)}&gsrnamespace=6&gsrlimit=8` +
    `&prop=imageinfo&iiprop=url|mime|size&iiurlwidth=1280`
  );
}

export async function searchOpenMedia(input: {
  query: string;
  kinds: SourceContentKind[];
  fetchImpl?: OpenMediaFetch;
  endpoints?: OpenSourceEndpoint[];
}): Promise<OpenMediaHit[]> {
  const query = String(input.query || '').trim();
  const kinds = input.kinds.filter(
    (row): row is SourceContentKind => row === 'video' || row === 'image' || row === 'audio',
  );
  if (!kinds.length) return [];
  const fetchImpl = input.fetchImpl || safePublicHttpGet;
  const endpoints = input.endpoints || catalogEndpointsFor(kinds);
  // Endpoints are independent; fan out concurrently (bounded) and dedup in registry order so
  // the domestic source still wins while a slow overseas endpoint cannot hold up the rest.
  const perEndpoint = await Promise.all(endpoints.map(async (endpoint): Promise<OpenMediaHit[]> => {
    const wanted = endpoint.contentTypes.filter((type) => kinds.includes(type));
    if (!wanted.length) return [];
    const hits: OpenMediaHit[] = [];
    try {
      if (endpoint.kind === 'peertube_search' && wanted.includes('video')) {
        hits.push(...peertubeHits(endpoint, await readJson(fetchImpl, peertubeListUrl(endpoint, query))));
      } else if (endpoint.kind === 'wikimedia_commons') {
        for (const kind of wanted) {
          hits.push(...commonsHits(endpoint, await readJson(fetchImpl, commonsListUrl(endpoint, kind, query)), kind));
        }
      } else if (endpoint.kind === 'itunes_podcast' && wanted.includes('audio')) {
        if (!query) return [];
        const episodeUrl =
          `${endpoint.url}?term=${encodeURIComponent(query)}&media=podcast&entity=podcastEpisode&limit=8`;
        const podcastUrl =
          `${endpoint.url}?term=${encodeURIComponent(query)}&media=podcast&entity=podcast&limit=4`;
        hits.push(
          ...itunesHits(endpoint, await readJson(fetchImpl, episodeUrl)),
          ...itunesHits(endpoint, await readJson(fetchImpl, podcastUrl)),
        );
      } else if (endpoint.kind === 'media_listing' && wanted.includes('video')) {
        const got = await fetchImpl(endpoint.url, { accept: 'text/html, application/xhtml+xml, */*;q=0.1' });
        if (got.status >= 200 && got.status < 300) hits.push(...listingVideoHits(endpoint, got.body || ''));
      } else if (endpoint.kind === 'bilibili_listing' && wanted.includes('video')) {
        const got = await fetchImpl(endpoint.url, { accept: 'text/html, application/xhtml+xml, */*;q=0.1' });
        if (got.status >= 200 && got.status < 300) hits.push(...bilibiliHits(endpoint, got.body || ''));
      } else if (endpoint.kind === 'itunes_rss' && wanted.includes('audio')) {
        hits.push(...itunesTopHits(endpoint, await readJson(fetchImpl, endpoint.url)));
      }
    } catch {
      /* 单个开放来源失败不阻断其它来源 */
    }
    return hits;
  }));
  // Interleave sources round-robin so one large listing cannot crowd out the others.
  const out: OpenMediaHit[] = [];
  const seen = new Set<string>();
  const depth = perEndpoint.reduce((max, hits) => Math.max(max, hits.length), 0);
  for (let i = 0; i < depth && out.length < 16; i++) {
    for (const hits of perEndpoint) {
      const hit = hits[i];
      if (!hit) continue;
      const key = (hit.capability === 'itunes-podcast-search' || hit.capability === 'itunes-top-podcasts') ? (hit.feedUrl || hit.url) : hit.url;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(hit);
      if (out.length >= 16) break;
    }
  }
  return out;
}

/** 无用户查询时列出开放目录样本。不是按人排序，也不从 Digital Self 抽关键词。 */
export async function listOpenCatalog(input: {
  kinds?: SourceContentKind[];
  fetchImpl?: OpenMediaFetch;
  endpoints?: OpenSourceEndpoint[];
} = {}): Promise<OpenMediaHit[]> {
  return searchOpenMedia({
    query: '',
    kinds: input.kinds && input.kinds.length ? input.kinds : ['video', 'image', 'audio'],
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    ...(input.endpoints ? { endpoints: input.endpoints } : {}),
  });
}

export function networkItemFromOpenHit(hit: OpenMediaHit, now?: string): NetworkItem | null {
  let canonical = '';
  try {
    canonical = normalizeCanonicalUrl(hit.url);
  } catch {
    return null;
  }
  const createdAt = now || NOW_FALLBACK();
  const contentType = hit.contentType as NetworkContentType;
  const media = {
    contentType,
    ...(hit.mediaUrl ? { mediaUrl: hit.mediaUrl } : {}),
    ...(hit.thumbnailUrl ? { thumbnailUrl: hit.thumbnailUrl } : {}),
    ...(hit.embedUrl ? { embedUrl: hit.embedUrl } : {}),
    ...(hit.mimeType ? { mimeType: hit.mimeType } : {}),
    ...(hit.durationSeconds != null ? { durationSeconds: hit.durationSeconds } : {}),
    ...(hit.author ? { author: hit.author } : {}),
    ...(hit.mediaExpression ? { mediaExpression: hit.mediaExpression } : {}),
    access: 'public' as const,
    consumption: consumptionFor({
      contentType,
      ...(hit.mediaUrl ? { mediaUrl: hit.mediaUrl } : {}),
      ...(hit.embedUrl ? { embedUrl: hit.embedUrl } : {}),
    }),
    mediaProvenance: 'schema_org' as const,
  };
  const host = (() => {
    try {
      return new URL(canonical).hostname.replace(/^www\./, '');
    } catch {
      return hit.capability;
    }
  })();
  const checked = validateNetworkItem({
    schemaVersion: NETWORK_ITEM_SCHEMA_VERSION,
    itemId: contentItemId(canonical),
    publisherSubjectId: sourcePublisherId(canonical),
    publisherDisplayName: clipTitle(host).slice(0, 80) || 'Open source',
    kind: NETWORK_ITEM_KIND_CONTENT,
    createdAt,
    visibility: NETWORK_ITEM_VISIBILITY_PUBLIC,
    content: {
      title: clipTitle(hit.title),
      text: clipText(hit.snippet || hit.title),
      url: canonical,
      ...media,
    },
    provenance: {
      origin: 'publisher',
      actor: 'owner',
      statedAt: createdAt,
      excerpt: clipText(hit.snippet || hit.title).slice(0, 400),
      via: 'search',
    },
  });
  return checked.ok ? checked.item : null;
}

export function catalogFeedUrls(kinds: string[]): string[] {
  return catalogEndpointsFor(kinds)
    .filter((row) => row.kind === 'media_rss')
    .map((row) => row.url);
}
