/**
 * 国内默认新闻：公开 RSS + 可选托管搜索。
 * 不把 Google News 聚合当作默认供给。模型决定要不要用；这里只取条目、来源和发布时间。
 */
import { parseFeed } from './content-ingest';
import { catalogFeedUrls } from './content-source-capabilities';
import { allowsDefaultSupply, classifyResolvedDefaultSource, filterDefaultSupply } from './domestic-source-boundary';

export interface NewsHeadline {
  title: string;
  url: string;
  publisherName?: string;
  publisherUrl?: string;
  /** 来源给出的发布时间，ISO。没有就不填，调用方不得把它说成当天。 */
  publishedAt?: string;
  /** 这次取到条目的时间。不是发布时间，也不是事件时间。 */
  fetchedAt: string;
  snippet: string;
  /** 新闻源只给了标题和摘要。没有读取原文。 */
  bodyRead: false;
}

export type NewsSearchHit = {
  title: string;
  url: string;
  snippet?: string;
  publisherName?: string;
  publishedAt?: string;
};

const RECENT_NEWS_MS = 21 * 24 * 60 * 60 * 1000;

function attr(raw: string, name: string): string {
  const match = raw.match(new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'i'));
  return match?.[1] ? match[1].trim() : '';
}

function stripHtml(raw: string): string {
  return String(raw || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRecent(publishedAt: string | undefined, nowMs: number): boolean {
  if (!publishedAt) return true;
  const at = Date.parse(publishedAt);
  return Number.isFinite(at) && nowMs - at <= RECENT_NEWS_MS;
}

export function headlinesFromRss(xml: string, fetchedAt: string, publisherFallback = ''): NewsHeadline[] {
  const feed = parseFeed(xml);
  const blocks = [...String(xml || '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1] || '');
  const out: NewsHeadline[] = [];
  for (let index = 0; index < feed.items.length && out.length < 8; index += 1) {
    const item = feed.items[index];
    if (!item) continue;
    const title = String(item.title || '').replace(/\s+/g, ' ').trim();
    const url = String(item.url || '').trim();
    if (!title || !url) continue;
    const block = blocks[index] || '';
    const source = block.match(/<source\b([^>]*)>([\s\S]*?)<\/source>/i);
    const publisherName = source ? stripHtml(source[2] || '') : publisherFallback;
    const publisherUrl = source ? attr(source[1] || '', 'url') : '';
    const parsed = item.publishedAt ? Date.parse(item.publishedAt) : NaN;
    const publishedAt = Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
    out.push({
      title: title.slice(0, 240),
      url,
      ...(publisherName ? { publisherName: publisherName.slice(0, 80) } : {}),
      ...(publisherUrl ? { publisherUrl } : {}),
      ...(publishedAt ? { publishedAt } : {}),
      fetchedAt,
      snippet: stripHtml(item.text || title).slice(0, 240),
      bodyRead: false,
    });
  }
  return out;
}

function newestPublishedMs(rows: NewsHeadline[]): number {
  let newest = 0;
  for (const row of rows) {
    const at = row.publishedAt ? Date.parse(row.publishedAt) : NaN;
    if (Number.isFinite(at) && at > newest) newest = at;
  }
  return newest;
}

async function headlinesFromCatalog(
  fetchImpl: typeof fetch,
  fetchedAt: string,
  nowMs: number,
  signal?: AbortSignal,
): Promise<NewsHeadline[]> {
  const feeds = catalogFeedUrls(['article']);
  const batches = await Promise.all(
    feeds.map(async (url) => {
      try {
        const response = await fetchImpl(url, {
          headers: {
            accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
            'user-agent': 'digitalme-news',
          },
          ...(signal ? { signal } : {}),
        });
        if (!response.ok) return [] as NewsHeadline[];
        const xml = await response.text();
        if (!/<rss|<feed|<item|<entry/i.test(xml)) return [] as NewsHeadline[];
        const rows = headlinesFromRss(xml, fetchedAt);
        const newest = newestPublishedMs(rows);
        if (newest && nowMs - newest > RECENT_NEWS_MS) return [] as NewsHeadline[];
        return rows.filter((row) => isRecent(row.publishedAt, nowMs));
      } catch {
        return [] as NewsHeadline[];
      }
    }),
  );
  return batches.flat();
}

async function headlinesFromSearch(
  query: string,
  searchWeb: (q: string) => Promise<NewsSearchHit[]>,
  fetchImpl: typeof fetch,
  fetchedAt: string,
  signal?: AbortSignal,
): Promise<NewsHeadline[]> {
  const hits = await searchWeb(query);
  const out: NewsHeadline[] = [];
  for (const hit of hits.slice(0, 12)) {
    const url = String(hit.url || '').trim();
    if (!url) continue;
    const classified = await classifyResolvedDefaultSource(
      { url, publisher: hit.publisherName },
      fetchImpl,
      signal,
    );
    if (classified.decision !== 'allow') continue;
    out.push({
      title: String(hit.title || classified.url).slice(0, 240),
      url: classified.url,
      ...(hit.publisherName ? { publisherName: hit.publisherName.slice(0, 80) } : {}),
      ...(hit.publishedAt ? { publishedAt: hit.publishedAt } : {}),
      fetchedAt,
      snippet: String(hit.snippet || hit.title || '').slice(0, 240),
      bodyRead: false,
    });
    if (out.length >= 8) break;
  }
  return out;
}

export async function fetchNewsHeadlines(
  query: string,
  fetchImpl: typeof fetch = fetch,
  now = new Date(),
  signal?: AbortSignal,
  searchWeb?: (query: string) => Promise<NewsSearchHit[]>,
): Promise<NewsHeadline[]> {
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  if (q.length < 2) return [];
  const fetchedAt = now.toISOString();
  const nowMs = now.getTime();
  const catalog = await headlinesFromCatalog(fetchImpl, fetchedAt, nowMs, signal);
  let searched: NewsHeadline[] = [];
  if (searchWeb) {
    try {
      searched = await headlinesFromSearch(q, searchWeb, fetchImpl, fetchedAt, signal);
    } catch {
      searched = [];
    }
  }
  const merged: NewsHeadline[] = [];
  const seen = new Set<string>();
  const datedCatalog = catalog.filter((row) => row.publishedAt);
  const datedSearch = searched.filter((row) => row.publishedAt);
  const rest = [...catalog.filter((row) => !row.publishedAt), ...searched.filter((row) => !row.publishedAt)];
  for (const row of [...datedCatalog, ...datedSearch, ...rest]) {
    if (!allowsDefaultSupply({ url: row.url, publisher: row.publisherName })) continue;
    const key = row.url;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(row);
    if (merged.length >= 8) break;
  }
  return filterDefaultSupply(merged);
}
