import { MemoryNetworkItemStore } from '../relay-service/network-item-store';
import type { NetworkItemStore } from '../relay-service/network-item-store';
import { ingestSource } from './content-ingest';
import { cardFromNetworkItem, type DiscoverCard } from './content-discover';
import { normalizeCanonicalUrl } from './content-canonical';


import { safePublicHttpGet } from '../work-runtime/public-http-safety';
import { parseXmlFeed, parseJsonFeed } from './content-feed';
import { parse } from 'node-html-parser';

// Public publisher endpoints, not preselected stories. Same neutral supply for every user.
export const PUBLIC_FEEDS = [
  'https://www.chinanews.com.cn/rss/scroll-news.xml',
  'https://www.ithome.com/rss/',
  'https://sspai.com/feed',
  'https://www.ifanr.com/feed',
  'https://www.gcores.com/rss',
];

export async function acquirePublicFeeds(
  store: NetworkItemStore = new MemoryNetworkItemStore(),
): Promise<DiscoverCard[]> {
  const batches = await Promise.all(
    PUBLIC_FEEDS.map(async (sourceUrl) => {
      try {
        const fetched = await safePublicHttpGet(sourceUrl, {}, 3, {
          timeoutMs: 8000,
          maxBodyBytes: 1500000,
        });
        const parsed = fetched.body.trim().startsWith('{')
          ? parseJsonFeed(fetched.body)
          : parseXmlFeed(fetched.body);
        const result = await ingestSource({
          sourceUrl,
          store,
          limit: 36,
          via: 'feed',
          fetchImpl: async () => fetched,
        });
        return result.items.map((item) => {
          const entry =
            parsed && 'items' in parsed
              ? parsed.items.find((row) => {
                  try {
                    return normalizeCanonicalUrl(row.url) === item.content.url;
                  } catch {
                    return false;
                  }
                })
              : undefined;
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
