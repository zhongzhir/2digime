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
const FEED_MAX_BODY_BYTES = 4_000_000;

// Public publisher endpoints, not preselected stories. Same neutral supply for every user.
// Each entry is a public Feed, not a preselected story, and is reachable from mainland China.
export const PUBLIC_FEEDS = [
  // 新闻 / 综合
  'https://www.chinanews.com.cn/rss/scroll-news.xml',
  // 科技 / AI / 商业 + 深度图文
  'https://www.ithome.com/rss/',
  'https://sspai.com/feed',
  'https://www.ifanr.com/feed',
  'https://www.gcores.com/rss',
  // 音频：公开中文播客 RSS，enclosure 直接给出 MP3。
  'https://sv101.fireside.fm/rss',
];

export async function acquirePublicFeeds(
  store: NetworkItemStore = new MemoryNetworkItemStore(),
): Promise<DiscoverCard[]> {
  const batches = await Promise.all(
    PUBLIC_FEEDS.map(async (sourceUrl) => {
      try {
        const fetched = await safePublicHttpGet(sourceUrl, {}, 3, {
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
          sourceUrl,
          store,
          limit: 36,
          via: 'feed',
          mediaByUrl,
          fetchImpl: async () => fetched,
        });
        return result.items.map((item) => {
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
            dateProvenance: { feed: sourceUrl },
            representation: {
              kind: 'external' as const,
              canonicalUrl: item.content.url || '',
              provenance: `feed:${sourceUrl}`,
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
      } catch {
        return [];
      }
    }),
  );
  // Interleave mechanically so one publisher does not occupy the whole bounded model input.
  return Array.from({ length: 36 }, (_, i) =>
    batches.flatMap((batch) => (batch[i] ? [batch[i]!] : [])),
  ).flat();
}

export { selectSupply } from './news-selection';
