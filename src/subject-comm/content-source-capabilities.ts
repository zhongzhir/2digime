/**
 * 极薄内容来源选择：按 requestedContentTypes 调用已有成熟开放能力。
 * 不自建搜索引擎，不 scraper 中心平台，不产出第二套 MediaItem。
 */
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
  publishedAt?: string;
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

function commonsPlain(value: unknown): string {
  const raw =
    value && typeof value === 'object' && 'value' in (value as Record<string, unknown>)
      ? String((value as { value?: unknown }).value || '')
      : String(value || '');
  return clipText(
    raw
      .replace(/<[^>]+>/g, ' ')
      .replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, '$1')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#039;|&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' '),
  ).trim();
}

function commonsMeta(media: Record<string, unknown>, key: string): string {
  const ext = media.extmetadata;
  if (!ext || typeof ext !== 'object') return '';
  return commonsPlain((ext as Record<string, unknown>)[key]);
}

function commonsDate(raw: string): string | undefined {
  const text = raw.trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?/);
  if (!match) return undefined;
  const iso = match[2] ? `${match[1]}T${match[2]}Z` : `${match[1]}T00:00:00Z`;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
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
    if (kind === 'audio' && detected !== 'audio') continue;
    if (/\.(djvu|pdf)(\?|$)/i.test(originalUrl || '') || /djvu|application\/pdf/i.test(mime)) continue;
    const displayUrl = thumbUrl || originalUrl || '';
    const mediaUrl = detected === 'image' ? displayUrl : originalUrl || displayUrl;
    if (!mediaUrl) continue;
    const pageUrl =
      asSafe(`https://commons.wikimedia.org/wiki/${encodeURI(String(item.title || ''))}`) || mediaUrl;
    const objectName = commonsMeta(media, 'ObjectName');
    const description = commonsMeta(media, 'ImageDescription');
    const title = clipTitle(
      objectName && objectName.toLowerCase() !== fileTitle.toLowerCase() ? objectName : fileTitle || pageUrl,
    );
    const snippet =
      description && description !== title && description.toLowerCase() !== fileTitle.toLowerCase()
        ? description.slice(0, 400)
        : '';
    const publishedAt = commonsDate(commonsMeta(media, 'DateTimeOriginal'));
    out.push({
      title,
      url: pageUrl,
      contentType: detected === 'video' ? 'video' : detected === 'audio' ? 'audio' : 'image',
      capability: endpoint.id,
      mediaUrl,
      thumbnailUrl: displayUrl,
      ...(mime ? { mimeType: mime.slice(0, 80) } : {}),
      ...(snippet ? { snippet } : {}),
      ...(publishedAt ? { publishedAt } : {}),
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

function peertubeListUrl(endpoint: OpenSourceEndpoint, query: string): string {
  if (query) return `${endpoint.url}?search=${encodeURIComponent(query)}&count=8&nsfw=false`;
  return `${originOf(endpoint.url)}/api/v1/videos?count=8&nsfw=false`;
}

function commonsListUrl(endpoint: OpenSourceEndpoint, kind: SourceContentKind, query: string): string {
  if (!query) {
    if (kind === 'video' || kind === 'audio') {
      return (
        `${endpoint.url}?action=query&format=json&generator=search` +
        `&gsrsearch=${encodeURIComponent(kind === 'audio' ? 'filetype:audio' : 'filetype:video')}&gsrnamespace=6&gsrlimit=8` +
        `&prop=imageinfo&iiprop=url|mime|size|extmetadata&iiurlwidth=1280`
      );
    }
    return (
      `${endpoint.url}?action=query&format=json&generator=allimages&gailimit=8` +
      `&prop=imageinfo&iiprop=url|mime|size|extmetadata&iiurlwidth=1280`
    );
  }
  const gsr =
    kind === 'video' ? `filetype:video ${query}` : kind === 'audio' ? `filetype:audio ${query}` : query;
  return (
    `${endpoint.url}?action=query&format=json&generator=search` +
    `&gsrsearch=${encodeURIComponent(gsr)}&gsrnamespace=6&gsrlimit=8` +
    `&prop=imageinfo&iiprop=url|mime|size|extmetadata&iiurlwidth=1280`
  );
}

function archiveSearchUrl(endpoint: OpenSourceEndpoint, kind: 'audio' | 'video', query: string): string {
  const mediatype = kind === 'video' ? 'movies' : 'audio';
  const q = query ? `${query} AND mediatype:${mediatype}` : `mediatype:${mediatype}`;
  return `${endpoint.url}?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&output=json&rows=4`;
}

function archiveDownloadUrl(identifier: string, name: string): string | undefined {
  const id = encodeURIComponent(identifier);
  const filePath = name
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
  if (!filePath) return undefined;
  return asSafe(`https://archive.org/download/${id}/${filePath}`);
}

function pickArchiveFile(files: unknown, kind: 'audio' | 'video'): string | undefined {
  if (!Array.isArray(files)) return undefined;
  const wanted = kind === 'audio' ? /\.(mp3|ogg|opus|m4a|wav|flac)$/i : /\.(mp4|webm|ogv|m4v)$/i;
  for (const row of files) {
    if (!row || typeof row !== 'object') continue;
    const name = String((row as { name?: unknown }).name || '');
    if (!wanted.test(name)) continue;
    if (/thumb|\.torrent$|_files\.xml/i.test(name)) continue;
    return name;
  }
  return undefined;
}

async function archiveHits(
  endpoint: OpenSourceEndpoint,
  fetchImpl: OpenMediaFetch,
  kind: 'audio' | 'video',
  query: string,
): Promise<OpenMediaHit[]> {
  const data = await readJson(fetchImpl, archiveSearchUrl(endpoint, kind, query));
  const response = data && typeof data === 'object' ? (data as { response?: { docs?: unknown } }).response : null;
  const docs = response && Array.isArray(response.docs) ? response.docs : [];
  const out: OpenMediaHit[] = [];
  for (const row of docs) {
    if (!row || typeof row !== 'object') continue;
    const doc = row as { identifier?: unknown; title?: unknown };
    const identifier = String(doc.identifier || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/.test(identifier)) continue;
    const meta = await readJson(fetchImpl, `https://archive.org/metadata/${encodeURIComponent(identifier)}`);
    const record = meta && typeof meta === 'object' ? (meta as { metadata?: unknown; files?: unknown }) : {};
    const metadata = record.metadata && typeof record.metadata === 'object' ? (record.metadata as Record<string, unknown>) : {};
    if (metadata['access-restricted-item'] === true || metadata['access-restricted-item'] === 'true') continue;
    const fileName = pickArchiveFile(record.files, kind);
    const mediaUrl = fileName ? archiveDownloadUrl(identifier, fileName) : undefined;
    if (!mediaUrl) continue;
    const title = clipTitle(String(doc.title || metadata.title || identifier));
    if (!title) continue;
    const page = asSafe(`https://archive.org/details/${encodeURIComponent(identifier)}`) || mediaUrl;
    out.push({
      title,
      url: page,
      contentType: kind,
      capability: endpoint.id,
      mediaUrl,
      snippet: clipText(String(metadata.description || title)).slice(0, 400),
    });
    if (out.length >= 4) break;
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
  const kinds = input.kinds.filter(
    (row): row is SourceContentKind => row === 'video' || row === 'image' || row === 'audio',
  );
  if (!kinds.length) return [];
  const fetchImpl = input.fetchImpl || safePublicHttpGet;
  const endpoints = input.endpoints || catalogEndpointsFor(kinds);
  const batches = await Promise.all(
    endpoints.map(async (endpoint) => {
      const wanted = endpoint.contentTypes.filter((type) => kinds.includes(type));
      const found: OpenMediaHit[] = [];
      if (!wanted.length) return found;
      try {
        if (endpoint.kind === 'peertube_search' && wanted.includes('video')) {
        const hits = peertubeHits(endpoint, await readJson(fetchImpl, peertubeListUrl(endpoint, query)));
        for (const hit of hits) found.push(hit);
      } else if (endpoint.kind === 'wikimedia_commons') {
        for (const kind of wanted) {
          const hits = commonsHits(endpoint, await readJson(fetchImpl, commonsListUrl(endpoint, kind, query)), kind);
          for (const hit of hits) found.push(hit);
        }
      } else if (endpoint.kind === 'itunes_podcast' && wanted.includes('audio')) {
        if (!query) return found;
        const episodeUrl =
          `${endpoint.url}?term=${encodeURIComponent(query)}&media=podcast&entity=podcastEpisode&limit=8`;
        const podcastUrl =
          `${endpoint.url}?term=${encodeURIComponent(query)}&media=podcast&entity=podcast&limit=4`;
        const hits = [
          ...itunesHits(endpoint, await readJson(fetchImpl, episodeUrl)),
          ...itunesHits(endpoint, await readJson(fetchImpl, podcastUrl)),
        ];
        for (const hit of hits) found.push(hit);
      } else if (endpoint.kind === 'itunes_rss' && wanted.includes('audio')) {
        const hits = itunesTopHits(endpoint, await readJson(fetchImpl, endpoint.url));
        for (const hit of hits) found.push(hit);
      } else if (endpoint.kind === 'internet_archive') {
        for (const kind of wanted) {
          if (kind !== 'audio' && kind !== 'video') continue;
          const hits = await archiveHits(endpoint, fetchImpl, kind, query);
          for (const hit of hits) found.push(hit);
        }
      }
    } catch {
      /* 单个开放来源失败不阻断其它来源 */
    }
    return found;
    }),
  );
  const out: OpenMediaHit[] = [];
  const seen = new Set<string>();
  for (const hit of batches.flat()) {
    const key = hit.feedUrl || hit.url;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  const playableFirst = [...out].sort((a, b) => Number(Boolean(b.mediaUrl)) - Number(Boolean(a.mediaUrl)));
  return playableFirst.slice(0, 16);
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
    ...(hit.publishedAt ? { publishedAt: hit.publishedAt } : {}),
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
