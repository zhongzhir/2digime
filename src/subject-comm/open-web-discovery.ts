/**
 * 标准公开 Web 源发现：Feed Autodiscovery + sitemap fallback + 页 metadata。
 * 发现 URL，不建爬虫，不预索引全网。摄入仍走 ingestSource。
 */
import robotsParser from 'robots-parser';
import { XMLParser } from 'fast-xml-parser';
import { safePublicHttpGet } from '../work-runtime/public-http-safety';
import { normalizeCanonicalUrl, clipText, clipTitle, contentItemId, sourcePublisherId } from './content-canonical';
import { ingestSource, type IngestRecord, type IngestSourceInput } from './content-ingest';
import { discoverFeedHints, parsePageMetadata, type FeedHint, type PageMetadata } from './page-metadata';
import {
  NETWORK_ITEM_KIND_CONTENT,
  NETWORK_ITEM_SCHEMA_VERSION,
  NETWORK_ITEM_VISIBILITY_PUBLIC,
  validateNetworkItem,
  type NetworkItem,
  type NetworkItemDiscoveryVia,
} from './network-item';
import type { NetworkItemStore } from '../relay-service/network-item-store';
import type { ChatCompleteFn } from '../subject-core/structured-distill';
import type { ExternalSeekHit } from './content-seek';

export type OpenWebVia = NetworkItemDiscoveryVia;

export interface OpenWebDiscovery {
  siteCanonical: string;
  finalUrl: string;
  status: number;
  feeds: FeedHint[];
  sitemaps: string[];
  page?: PageMetadata;
  via: OpenWebVia;
  access: 'ok' | 'restricted' | 'unavailable' | 'rejected';
  reason?: string;
}

const UA = 'DigitalMe-readonly-lookup';
const DEFAULT_SITEMAP_LIMIT = 20;
const DEFAULT_SITEMAP_DEPTH = 1;
const DISCOVERY_MAX_BODY_BYTES = 1_500_000;

function xmlParser(): XMLParser {
  return new XMLParser({ ignoreAttributes: false, trimValues: true });
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function locOf(row: unknown): string {
  if (typeof row === 'string') return row.trim();
  if (row && typeof row === 'object' && 'loc' in row) {
    const loc = (row as { loc?: unknown }).loc;
    if (typeof loc === 'string') return loc.trim();
    if (loc && typeof loc === 'object' && '#text' in (loc as object)) {
      return String((loc as { '#text'?: string })['#text'] || '').trim();
    }
  }
  return '';
}

export function parseSitemapLocs(xml: string): { pages: string[]; childSitemaps: string[] } {
  const doc = xmlParser().parse(xml) as {
    urlset?: { url?: unknown };
    sitemapindex?: { sitemap?: unknown };
  };
  const pages = asArray(doc.urlset?.url).map(locOf).filter(Boolean);
  const childSitemaps = asArray(doc.sitemapindex?.sitemap).map(locOf).filter(Boolean);
  return { pages, childSitemaps };
}

function safeCanon(raw: string): string | null {
  try {
    return normalizeCanonicalUrl(raw);
  } catch {
    return null;
  }
}

async function get(
  url: string,
  fetchImpl: typeof safePublicHttpGet,
  accept: string,
): Promise<{ status: number; body: string; finalUrl: string } | { error: string }> {
  try {
    return await fetchImpl(
      url,
      { accept, 'user-agent': UA },
      3,
      { maxBodyBytes: DISCOVERY_MAX_BODY_BYTES },
    );
  } catch (err) {
    return { error: (err as { code?: string }).code || 'fetch_failed' };
  }
}

async function allowedByRobots(
  target: string,
  robots: ReturnType<typeof robotsParser> | null,
): Promise<boolean> {
  if (!robots) return true;
  return robots.isAllowed(target, UA) !== false;
}

export async function discoverOpenWebSource(input: {
  url: string;
  fetchImpl?: typeof safePublicHttpGet;
  maxSitemapUrls?: number;
  followSitemapIndex?: boolean;
}): Promise<OpenWebDiscovery> {
  const fetchImpl = input.fetchImpl || safePublicHttpGet;
  let start: string;
  try {
    start = normalizeCanonicalUrl(input.url);
  } catch (err) {
    return {
      siteCanonical: String(input.url || ''),
      finalUrl: String(input.url || ''),
      status: 0,
      feeds: [],
      sitemaps: [],
      via: 'page',
      access: 'rejected',
      reason: (err as { code?: string }).code || 'invalid_url',
    };
  }

  const pageGot = await get(
    start,
    fetchImpl,
    'text/html, application/xhtml+xml, application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1',
  );
  if ('error' in pageGot) {
    return {
      siteCanonical: start,
      finalUrl: start,
      status: 0,
      feeds: [],
      sitemaps: [],
      via: 'page',
      access: 'unavailable',
      reason: pageGot.error,
    };
  }
  const status = pageGot.status;
  const finalUrl = pageGot.finalUrl || start;
  if (status === 401 || status === 403) {
    return {
      siteCanonical: safeCanon(finalUrl) || start,
      finalUrl,
      status,
      feeds: [],
      sitemaps: [],
      via: 'page',
      access: 'restricted',
      reason: `http_${status}`,
    };
  }
  if (status === 404 || status === 410 || status < 200 || status >= 300) {
    return {
      siteCanonical: safeCanon(finalUrl) || start,
      finalUrl,
      status,
      feeds: [],
      sitemaps: [],
      via: 'page',
      access: 'unavailable',
      reason: `http_${status}`,
    };
  }

  const body = pageGot.body || '';
  const looksFeed = /<(rss|feed|channel|item|entry)[\s>]/i.test(body) && !/<html[\s>]/i.test(body);
  if (looksFeed) {
    const siteCanonical = safeCanon(finalUrl) || start;
    return {
      siteCanonical,
      finalUrl,
      status,
      feeds: [{ url: siteCanonical, type: /<feed[\s>]/i.test(body) ? 'atom' : 'rss' }],
      sitemaps: [],
      via: 'feed',
      access: 'ok',
    };
  }

  const page = parsePageMetadata(body, finalUrl);
  const feeds = discoverFeedHints(body, finalUrl);
  let sitemaps: string[] = [];
  let via: OpenWebVia = feeds.length ? 'autodiscovery' : 'page';

  if (!feeds.length) {
    const origin = new URL(finalUrl).origin;
    const robotsUrl = `${origin}/robots.txt`;
    const robotsGot = await get(robotsUrl, fetchImpl, 'text/plain, */*;q=0.1');
    const robots =
      'error' in robotsGot || robotsGot.status >= 400
        ? null
        : robotsParser(robotsUrl, robotsGot.body || '');
    const declared = robots?.getSitemaps?.() || [];
    const candidates = [...declared];
    if (!candidates.length) candidates.push(`${origin}/sitemap.xml`);
    for (const raw of candidates) {
      const abs = safeCanon(raw) || raw;
      if (!(await allowedByRobots(abs, robots))) continue;
      const mapGot = await get(abs, fetchImpl, 'application/xml, text/xml, */*;q=0.1');
      if ('error' in mapGot || mapGot.status < 200 || mapGot.status >= 300) continue;
      sitemaps.push(safeCanon(mapGot.finalUrl) || abs);
      const parsed = parseSitemapLocs(mapGot.body || '');
      if (parsed.childSitemaps.length && (input.followSitemapIndex ?? true)) {
        for (const child of parsed.childSitemaps.slice(0, DEFAULT_SITEMAP_DEPTH === 1 ? 2 : 0)) {
          const childCanon = safeCanon(child);
          if (!childCanon || !(await allowedByRobots(childCanon, robots))) continue;
          const childGot = await get(childCanon, fetchImpl, 'application/xml, text/xml, */*;q=0.1');
          if ('error' in childGot || childGot.status < 200 || childGot.status >= 300) continue;
          sitemaps.push(childCanon);
          if (sitemaps.length >= 4) break;
        }
      }
      if (sitemaps.length) {
        via = 'sitemap';
        break;
      }
    }
  }

  return {
    siteCanonical: page.canonicalUrl || safeCanon(finalUrl) || start,
    finalUrl,
    status,
    feeds,
    sitemaps: [...new Set(sitemaps)],
    page,
    via,
    access: 'ok',
  };
}

export async function ingestOpenWebSource(input: {
  url: string;
  store: NetworkItemStore;
  fetchImpl?: typeof safePublicHttpGet;
  now?: string;
  limit?: number;
  maxSitemapUrls?: number;
  enrich?: IngestSourceInput['enrich'];
}): Promise<{
  discovery: OpenWebDiscovery;
  records: IngestRecord[];
  items: NetworkItem[];
}> {
  const fetchImpl = input.fetchImpl || safePublicHttpGet;
  const discovery = await discoverOpenWebSource({
    url: input.url,
    fetchImpl,
    ...(input.maxSitemapUrls ? { maxSitemapUrls: input.maxSitemapUrls } : {}),
  });
  const records: IngestRecord[] = [];
  const items: NetworkItem[] = [];
  const ingestOne = async (sourceUrl: string, via: OpenWebVia, limit: number) => {
    try {
      const origin = new URL(sourceUrl).origin;
      const robotsUrl = `${origin}/robots.txt`;
      const robotsGot = await get(robotsUrl, fetchImpl, 'text/plain, */*;q=0.1');
      if (!('error' in robotsGot) && robotsGot.status < 400) {
        const robots = robotsParser(robotsUrl, robotsGot.body || '');
        if (robots.isAllowed(sourceUrl, UA) === false) {
          records.push({ status: 'rejected', reason: 'robots_disallow', canonicalUrl: sourceUrl });
          return;
        }
      }
    } catch {
      /* robots 读失败不得阻断公开页；SSRF 仍由 ingestSource 拒绝 */
    }
    const result = await ingestSource({
      sourceUrl,
      store: input.store,
      fetchImpl,
      limit,
      via,
      ...(input.now ? { now: input.now } : {}),
      ...(input.enrich ? { enrich: input.enrich } : {}),
    });
    records.push(...result.records);
    items.push(...result.items);
  };

  if (discovery.access !== 'ok') {
    records.push({
      status: discovery.access === 'restricted' ? 'rejected' : 'unavailable',
      canonicalUrl: discovery.finalUrl,
      ...(discovery.reason ? { reason: discovery.reason } : {}),
    });
    return { discovery, records, items };
  }

  if (discovery.feeds.length) {
    for (const feed of discovery.feeds.slice(0, 2)) {
      await ingestOne(feed.url, discovery.via === 'feed' ? 'feed' : 'autodiscovery', input.limit ?? 12);
    }
    return { discovery, records, items };
  }

  if (discovery.sitemaps.length) {
    const maxUrls = Math.min(Math.max(input.maxSitemapUrls ?? DEFAULT_SITEMAP_LIMIT, 1), 40);
    const pageUrls: string[] = [];
    for (const mapUrl of discovery.sitemaps.slice(0, 3)) {
      const got = await get(mapUrl, fetchImpl, 'application/xml, text/xml, */*;q=0.1');
      if ('error' in got || got.status < 200 || got.status >= 300) continue;
      const parsed = parseSitemapLocs(got.body || '');
      for (const loc of parsed.pages) {
        const canon = safeCanon(loc);
        if (!canon || pageUrls.includes(canon)) continue;
        pageUrls.push(canon);
        if (pageUrls.length >= maxUrls) break;
      }
      if (pageUrls.length >= maxUrls) break;
    }
    for (const pageUrl of pageUrls) {
      await ingestOne(pageUrl, 'sitemap', 1);
    }
    return { discovery, records, items };
  }

  await ingestOne(discovery.finalUrl, 'page', 1);
  return { discovery, records, items };
}

export async function indexSearchHits(input: {
  hits: ExternalSeekHit[];
  store: NetworkItemStore;
  now?: string;
  limit?: number;
}): Promise<NetworkItem[]> {
  const now = input.now || new Date().toISOString();
  const items: NetworkItem[] = [];
  const seen = new Set<string>();
  for (const hit of input.hits.slice(0, input.limit ?? 8)) {
    let canonical = '';
    try {
      canonical = normalizeCanonicalUrl(hit.url);
    } catch {
      continue;
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const host = (() => {
      try {
        return new URL(canonical).hostname.replace(/^www\./, '');
      } catch {
        return canonical;
      }
    })();
    const title = clipTitle(hit.title || canonical);
    const text = clipText(hit.snippet || hit.title || canonical);
    const raw: NetworkItem = {
      schemaVersion: NETWORK_ITEM_SCHEMA_VERSION,
      itemId: contentItemId(canonical),
      publisherSubjectId: sourcePublisherId(canonical),
      publisherDisplayName: clipTitle(host).slice(0, 80),
      kind: NETWORK_ITEM_KIND_CONTENT,
      createdAt: now,
      visibility: NETWORK_ITEM_VISIBILITY_PUBLIC,
      content: { title, text, url: canonical },
      provenance: {
        origin: 'publisher',
        actor: 'owner',
        statedAt: now,
        excerpt: text.slice(0, 400),
        via: 'search',
      },
    };
    const checked = validateNetworkItem(raw);
    if (!checked.ok) continue;
    const existing = input.store.get
      ? await input.store.get(checked.item.itemId, now)
      : (await input.store.list({ limit: 100 }, now)).items.find((row) => row.itemId === checked.item.itemId);
    if (existing) {
      items.push(existing);
      continue;
    }
    await input.store.put(checked.item);
    items.push(checked.item);
  }
  return items;
}

export async function proposeOpenWebQueries(input: {
  selfContext: string;
  preferenceDirectives?: string;
  chatComplete: ChatCompleteFn;
  model: { baseUrl: string; model: string; apiKey?: string };
}): Promise<string[]> {
  const system = [
    '你为用户的 2digime 拟定公开网页搜索词。',
    '只输出 JSON：{"queries":["..."]}，2 到 3 条。',
    '搜索词必须是可发给公开搜索引擎的主题，不要包含姓名、住址、账号、密钥或可识别个人身份的细节。',
    '不要指定必须关注的网站。不要输出 score。',
  ].join('\n');
  const preferenceBlock = input.preferenceDirectives?.trim()
    ? `\n用户明确的内容偏好指令：\n${input.preferenceDirectives.trim()}`
    : '';
  const user = `数字之我摘要（仅供本机理解，不要写进搜索词里的私人细节）：\n${input.selfContext.slice(0, 1200)}${preferenceBlock}`;
  try {
    const result = await input.chatComplete({
      baseUrl: input.model.baseUrl,
      ...(input.model.apiKey ? { apiKey: input.model.apiKey } : {}),
      model: input.model.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0,
      maxTokens: 400,
      timeoutMs: 60_000,
      responseFormat: { type: 'json_object' },
    });
    const start = result.text.indexOf('{');
    const end = result.text.lastIndexOf('}');
    if (start < 0 || end <= start) return [];
    const parsed = JSON.parse(result.text.slice(start, end + 1)) as { queries?: unknown };
    if (!Array.isArray(parsed.queries)) return [];
    const out: string[] = [];
    for (const row of parsed.queries) {
      const q = String(row || '').trim();
      if (q.length >= 2 && q.length <= 120) out.push(q);
      if (out.length >= 3) break;
    }
    return out;
  } catch {
    return [];
  }
}
