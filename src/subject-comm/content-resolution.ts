import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import robotsParser from 'robots-parser';
import { safePublicHttpGet } from '../work-runtime/public-http-safety';
import { parsePageMetadata } from './page-metadata';
import type { DiscoverCard } from './content-discover';

/** Ephemeral local consumption result, never a new content store or Relay payload. */
export interface ContentRepresentation {
  kind: 'news' | 'article' | 'image' | 'audio' | 'video' | 'external';
  canonicalUrl: string;
  bodyText?: string;
  updatedAt?: string;
  topic?: string;
  provenance: string;
  resolvedAt: string;
}

export async function resolveContent(
  card: DiscoverCard,
  fetchImpl = safePublicHttpGet,
): Promise<DiscoverCard> {
  const representation: ContentRepresentation = {
    kind: 'external',
    canonicalUrl: card.url || '',
    provenance: 'external-only',
    resolvedAt: new Date().toISOString(),
    ...(card.representation?.topic ? { topic: card.representation.topic } : {}),
    ...(card.representation?.updatedAt
      ? { updatedAt: card.representation.updatedAt }
      : {}),
  };
  const fallback = { ...card, representation };
  if (
    !card.url ||
    card.access === 'loginRequired' ||
    card.access === 'subscriptionRequired'
  )
    return fallback;
  if (card.representation?.bodyText) return card;
  try {
    const robotsUrl = new URL('/robots.txt', card.url).href;
    const robots = await fetchImpl(robotsUrl, {}, 3, {
      timeoutMs: 6000,
      maxBodyBytes: 128000,
    });
    if (
      robots.status !== 404 &&
      (robots.status !== 200 ||
        robotsParser(robotsUrl, robots.body).isAllowed(card.url, '2digime') ===
          false)
    )
      return fallback;
    const page = await fetchImpl(card.url, { accept: 'text/html' }, 3, {
      timeoutMs: 8000,
      maxBodyBytes: 1500000,
    });
    if (page.status !== 200) return fallback;
    const meta = parsePageMetadata(page.body, page.finalUrl);
    if (
      meta.requiresSubscription ||
      meta.access === 'loginRequired' ||
      meta.access === 'subscriptionRequired'
    )
      return fallback;
    const dom = new JSDOM(page.body, { url: page.finalUrl }); // No script execution or resource fetching.
    try {
      const updated = meta.updatedAt;
      const kind = card.contentType || meta.contentType || 'article';
      const article =
        kind === 'article' || kind === 'news'
          ? new Readability(dom.window.document).parse()
          : null;
      const bodyText = article?.textContent?.trim();
      return {
        ...card,
        ...(meta.publisher ? { publisherDisplayName: meta.publisher } : {}),
        ...(meta.author ? { author: meta.author } : {}),
        ...(!card.publishedAt &&
        meta.publishedAt &&
        Number.isFinite(Date.parse(meta.publishedAt))
          ? { publishedAt: new Date(meta.publishedAt).toISOString() }
          : {}),
        ...(meta.thumbnailUrl ? { thumbnailUrl: meta.thumbnailUrl } : {}),
        representation: {
          ...representation,
          kind: ['article', 'news', 'audio', 'video', 'image'].includes(kind)
            ? (kind as ContentRepresentation['kind'])
            : 'external',
          canonicalUrl: meta.canonicalUrl,
          provenance: bodyText ? 'readability' : 'structured-metadata',
          ...(bodyText ? { bodyText: bodyText.slice(0, 60000) } : {}),
          ...(updated && Number.isFinite(Date.parse(updated))
            ? { updatedAt: new Date(updated).toISOString() }
            : {}),
        },
      };
    } finally {
      dom.window.close();
    }
  } catch {
    return fallback;
  }
}
