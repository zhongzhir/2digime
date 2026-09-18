/**
 * 极薄内容来源选择：按 requestedContentTypes 调用已有成熟开放能力。
 * 不自建搜索引擎，不 scraper 中心平台，不产出第二套 MediaItem。
 */
import { safePublicHttpGet, type SafePublicHttpGetResult } from '../work-runtime/public-http-safety';
import {
  consumptionFor,
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
    const mediaUrl = asSafe(String(media.url || ''));
    if (!mediaUrl) continue;
    const mime = String(media.mime || '');
    const detected = inferContentType({ mimeType: mime, mediaUrl });
    if (kind === 'image' && detected !== 'image') continue;
    if (kind === 'video' && detected !== 'video') continue;
    if (/\.(djvu|pdf)(\?|$)/i.test(mediaUrl) || /djvu/i.test(mime)) continue;
    const pageUrl =
      asSafe(`https://commons.wikimedia.org/wiki/${encodeURI(String(item.title || ''))}`) || mediaUrl;
    out.push({
      title: clipTitle(fileTitle || pageUrl),
      url: pageUrl,
      contentType: detected === 'video' ? 'video' : 'image',
      capability: endpoint.id,
      mediaUrl,
      thumbnailUrl: mediaUrl,
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
    const mediaUrl = asSafe(String(item.episodeUrl || item.previewUrl || ''));
    const detected = inferContentType({
      mimeType: String(item.episodeContentType || item.kind || ''),
      mediaUrl,
      ogType: item.kind === 'podcast-episode' || item.kind === 'podcast' ? 'music' : undefined,
    });
    const url = page || feedUrl || mediaUrl || '';
    if (!url) continue;
    const title = clipTitle(String(item.trackName || item.collectionName || url));
    if (!title) continue;
    const duration = parseDurationSeconds(
      typeof item.trackTimeMillis === 'number' ? item.trackTimeMillis / 1000 : item.trackTimeMillis,
    );
    const thumb = asSafe(String(item.artworkUrl600 || item.artworkUrl160 || item.artworkUrl100 || ''));
    const isEpisode = String(item.kind || '') === 'podcast-episode' || Boolean(mediaUrl && !feedUrl);
    out.push({
      title,
      url,
      contentType: 'audio',
      capability: endpoint.id,
      ...(mediaUrl && (detected === 'audio' || /\.(m4a|mp3|aac|ogg)(\?|$)/i.test(mediaUrl)) ? { mediaUrl } : {}),
      ...(thumb ? { thumbnailUrl: thumb } : {}),
      ...(duration != null && duration > 0 ? { durationSeconds: duration } : {}),
      ...(item.artistName ? { author: clipTitle(String(item.artistName)).slice(0, 80) } : {}),
      ...(feedUrl ? { feedUrl } : {}),
      ...(isEpisode && mediaUrl && /previewUrl/i.test(String(item.previewUrl || '')) && item.previewUrl === mediaUrl
        ? { mediaExpression: 'sample' as const }
        : {}),
      snippet: clipText(String(item.shortDescription || item.description || item.collectionName || title)).slice(0, 400),
    });
    if (out.length >= 8) break;
  }
  return out;
}

export async function searchOpenMedia(input: {
  query: string;
  kinds: SourceContentKind[];
  fetchImpl?: OpenMediaFetch;
  endpoints?: OpenSourceEndpoint[];
}): Promise<OpenMediaHit[]> {
  const query = String(input.query || '').trim();
  if (!query) return [];
  const kinds = input.kinds.filter(
    (row): row is SourceContentKind => row === 'video' || row === 'image' || row === 'audio',
  );
  if (!kinds.length) return [];
  const fetchImpl = input.fetchImpl || safePublicHttpGet;
  const endpoints = input.endpoints || catalogEndpointsFor(kinds);
  const out: OpenMediaHit[] = [];
  const seen = new Set<string>();
  for (const endpoint of endpoints) {
    const wanted = endpoint.contentTypes.filter((type) => kinds.includes(type));
    if (!wanted.length) continue;
    try {
      if (endpoint.kind === 'peertube_search' && wanted.includes('video')) {
        const url = `${endpoint.url}?search=${encodeURIComponent(query)}&count=8&nsfw=false`;
        const hits = peertubeHits(endpoint, await readJson(fetchImpl, url));
        for (const hit of hits) {
          if (seen.has(hit.url)) continue;
          seen.add(hit.url);
          out.push(hit);
        }
      } else if (endpoint.kind === 'wikimedia_commons') {
        for (const kind of wanted) {
          const gsr = kind === 'video' ? `filetype:video ${query}` : query;
          const url =
            `${endpoint.url}?action=query&format=json&generator=search` +
            `&gsrsearch=${encodeURIComponent(gsr)}&gsrnamespace=6&gsrlimit=8` +
            `&prop=imageinfo&iiprop=url|mime|size`;
          const hits = commonsHits(endpoint, await readJson(fetchImpl, url), kind);
          for (const hit of hits) {
            if (seen.has(hit.url)) continue;
            seen.add(hit.url);
            out.push(hit);
          }
        }
      } else if (endpoint.kind === 'itunes_podcast' && wanted.includes('audio')) {
        const episodeUrl =
          `${endpoint.url}?term=${encodeURIComponent(query)}&media=podcast&entity=podcastEpisode&limit=8`;
        const podcastUrl =
          `${endpoint.url}?term=${encodeURIComponent(query)}&media=podcast&entity=podcast&limit=4`;
        const hits = [
          ...itunesHits(endpoint, await readJson(fetchImpl, episodeUrl)),
          ...itunesHits(endpoint, await readJson(fetchImpl, podcastUrl)),
        ];
        for (const hit of hits) {
          const key = hit.feedUrl || hit.url;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(hit);
        }
      }
    } catch {
      /* 单个开放来源失败不阻断其它来源 */
    }
    if (out.length >= 16) break;
  }
  return out.slice(0, 16);
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
