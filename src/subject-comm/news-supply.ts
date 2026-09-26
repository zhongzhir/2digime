import { MemoryNetworkItemStore } from '../relay-service/network-item-store';
import type { NetworkItemStore } from '../relay-service/network-item-store';
import { ingestSource } from './content-ingest';
import { cardFromNetworkItem, type DiscoverCard } from './content-discover';
import { normalizeCanonicalUrl } from './content-canonical';


import { safePublicHttpGet } from '../work-runtime/public-http-safety';
import { parseXmlFeed, parseJsonFeed, type ParsedFeedItem } from './content-feed';
import { parse } from 'node-html-parser';

// Bounded feed body budget. A public podcast RSS with long episode history can exceed
// the small default page budget; this stays well below the media-download scale.
const FEED_MAX_BODY_BYTES = 8_000_000;
const FEED_FETCH_CONCURRENCY = 8;
const FEED_ITEMS_PER_SOURCE = 24;

export type SourceCategory = 'general' | 'tech' | 'business' | 'pevc' | 'policy' | 'culture' | 'audio';
export interface PublicSource { url: string; category: SourceCategory; label: string; }

// Public publisher endpoints, not preselected stories. Same neutral supply for every user.
// Every entry is a public Feed (RSS/Atom/JSON) reachable from mainland China; producers need
// no new work. Coverage spans general news, tech/AI, business/finance, PE/VC, policy and
// culture, plus Chinese tech/business/AI podcast feeds with standard MP3 enclosures.
export const PUBLIC_SOURCES: PublicSource[] = [
  // 综合新闻
  { url: 'https://www.chinanews.com.cn/rss/scroll-news.xml', category: 'general', label: '中国新闻网' },
  { url: 'http://www.people.com.cn/rss/politics.xml', category: 'general', label: '人民网·时政' },
  { url: 'http://www.news.cn/politics/news_politics.xml', category: 'general', label: '新华网·时政' },
  // 科技 / AI
  { url: 'https://www.ithome.com/rss/', category: 'tech', label: 'IT之家' },
  { url: 'https://www.qbitai.com/feed', category: 'tech', label: '量子位' },
  { url: 'https://www.leiphone.com/feed', category: 'tech', label: '雷峰网' },
  { url: 'https://www.geekpark.net/rss', category: 'tech', label: '极客公园' },
  { url: 'https://www.infoq.cn/feed', category: 'tech', label: 'InfoQ' },
  // 财经 / 商业 / 创投
  { url: 'http://www.people.com.cn/rss/finance.xml', category: 'business', label: '人民网·财经' },
  { url: 'http://www.news.cn/fortune/news_fortune.xml', category: 'business', label: '新华网·财经' },
  { url: 'https://www.tmtpost.com/rss.xml', category: 'business', label: '钛媒体' },
  { url: 'https://www.36kr.com/feed', category: 'pevc', label: '36氪' },
  // 文化 / 深度图文
  { url: 'http://www.people.com.cn/rss/culture.xml', category: 'culture', label: '人民网·文化' },
  { url: 'https://sspai.com/feed', category: 'culture', label: '少数派' },
  { url: 'https://www.ifanr.com/feed', category: 'tech', label: '爱范儿' },
  { url: 'https://www.gcores.com/rss', category: 'culture', label: '机核' },
  // 音频：公开中文播客 RSS，enclosure 直接给出 MP3。
  { url: 'https://sv101.fireside.fm/rss', category: 'audio', label: '硅谷101' },
  { url: 'https://feeds.fireside.fm/guiguzaozhidao/rss', category: 'audio', label: 'What\'s Next｜科技早知道' },
  { url: 'https://feeds.fireside.fm/101weekly/rss', category: 'audio', label: '101 Weekly' },
  { url: 'https://etw.fm/rss', category: 'audio', label: '声东击西' },
  { url: 'https://byte.coffee/feed', category: 'audio', label: 'Byte.Coffee' },
  { url: 'https://pythonhunter.org/feed', category: 'audio', label: '捕蛇者说' },
];

// Backward-compatible flat list of feed URLs.
export const PUBLIC_FEEDS = PUBLIC_SOURCES.map((row) => row.url);

export interface SourceHealth {
  url: string;
  label: string;
  category: SourceCategory;
  lastSuccessfulFetch?: string;
  lastFailure?: string;
  lastFailureReason?: string;
  contentCount: number;
  representationTypes: string[];
  availability: 'AVAILABLE' | 'TEMPORARY_UNAVAILABLE' | 'UNCONFIGURED';
}

// Minimal in-process health per source. Not a monitoring system; it only lets a temporarily
// dead Feed be skipped without dragging Discover down, and keeps provenance for evidence.
const sourceHealth = new Map<string, SourceHealth>();
export function sourceHealthSnapshot(): SourceHealth[] {
  return PUBLIC_SOURCES.map((row) => sourceHealth.get(row.url) ?? {
    url: row.url, label: row.label, category: row.category, contentCount: 0,
    representationTypes: [], availability: 'UNCONFIGURED',
  });
}
function markHealthy(source: PublicSource, types: string[]): void {
  const prev = sourceHealth.get(source.url);
  sourceHealth.set(source.url, {
    url: source.url, label: source.label, category: source.category,
    lastSuccessfulFetch: new Date().toISOString(),
    ...(prev?.lastFailure ? { lastFailure: prev.lastFailure } : {}),
    ...(prev?.lastFailureReason ? { lastFailureReason: prev.lastFailureReason } : {}),
    contentCount: types.length,
    representationTypes: [...new Set(types)],
    availability: 'AVAILABLE',
  });
}
function markFailed(source: PublicSource, reason: string): void {
  const prev = sourceHealth.get(source.url);
  sourceHealth.set(source.url, {
    url: source.url, label: source.label, category: source.category,
    ...(prev?.lastSuccessfulFetch ? { lastSuccessfulFetch: prev.lastSuccessfulFetch } : {}),
    lastFailure: new Date().toISOString(),
    lastFailureReason: reason.slice(0, 120),
    contentCount: 0,
    representationTypes: [],
    availability: 'TEMPORARY_UNAVAILABLE',
  });
}

async function parallelMap<T, R>(rows: T[], concurrency: number, fn: (row: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(rows.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
    while (next < rows.length) { const i = next++; out[i] = await fn(rows[i]!); }
  }));
  return out;
}

async function acquireOne(source: PublicSource, store: NetworkItemStore): Promise<DiscoverCard[]> {
  try {
    const fetched = await safePublicHttpGet(source.url, {}, 3, {
      timeoutMs: 8000,
      maxBodyBytes: FEED_MAX_BODY_BYTES,
    });
    const parsed = fetched.body.trim().startsWith('{')
      ? parseJsonFeed(fetched.body)
      : parseXmlFeed(fetched.body);
    // Feed items may carry an enclosure/media representation. Keep it on the
    // NetworkItem through the existing schema; no new content protocol is added.
    const mediaByUrl = new Map<string, ParsedFeedItem>();
    if (parsed && 'items' in parsed) {
      for (const row of parsed.items) {
        if (!row.media || !Object.keys(row.media).length) continue;
        try {
          mediaByUrl.set(normalizeCanonicalUrl(row.url), row);
        } catch {
          /* 非法 URL 不作为媒介证据 */
        }
      }
    }
    const result = await ingestSource({
      sourceUrl: source.url,
      store,
      limit: FEED_ITEMS_PER_SOURCE,
      via: 'feed',
      mediaByUrl,
      fetchImpl: async () => fetched,
    });
    if (!result.items.length) {
      markFailed(source, 'empty_feed');
      return [];
    }
    const cards = result.items.map((item) => {
      const entry = item.content.url ? mediaByUrl.get(item.content.url) : undefined;
      const full = entry?.bodyText;
      const body = full ? parse(full) : undefined;
      body
        ?.querySelectorAll('script,style,iframe')
        .forEach((node) => node.remove());
      return {
        ...cardFromNetworkItem(item, '', 'web'),
        ...(item.content.publishedAt ? { sourceFeedTimestamp: item.content.publishedAt } : {}),
        discoveredAt: new Date().toISOString(),
        dateProvenance: { feed: source.url },
        representation: {
          kind: 'external' as const,
          canonicalUrl: item.content.url || '',
          provenance: `feed:${source.url}`,
          resolvedAt: new Date().toISOString(),
          ...(entry?.updatedAt &&
          Number.isFinite(Date.parse(entry.updatedAt))
            ? { updatedAt: new Date(entry.updatedAt).toISOString() }
            : {}),
          ...(body?.textContent.trim()
            ? { bodyText: body.textContent.trim().slice(0, 60000) }
            : {}),
        },
      };
    });
    markHealthy(source, cards.map((card) => card.contentType || 'article'));
    return cards;
  } catch (err) {
    markFailed(source, (err as { code?: string }).code || (err as Error).name || 'fetch_failed');
    return [];
  }
}

export async function acquirePublicFeeds(
  store: NetworkItemStore = new MemoryNetworkItemStore(),
): Promise<DiscoverCard[]> {
  const batches = await parallelMap(PUBLIC_SOURCES, FEED_FETCH_CONCURRENCY, (source) => acquireOne(source, store));
  // Interleave mechanically so one publisher does not occupy the whole bounded model input.
  return Array.from({ length: FEED_ITEMS_PER_SOURCE }, (_, i) =>
    batches.flatMap((batch) => (batch[i] ? [batch[i]!] : [])),
  ).flat();
}

export { selectSupply } from './news-selection';
