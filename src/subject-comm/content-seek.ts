/**
 * 主动获取：自然语言 → 中立目录匹配 + 可选外部搜索。
 * 去重按 canonical URL；保留来源链接；不爬站、不写偏好。
 * 发现主结果是可消费内容项，不是网站/频道入口。
 */
import type { ChatCompleteFn } from '../subject-core/structured-distill';
import type { NetworkItem } from './network-item';
import { searchContentDirectory } from './content-directory';
import { normalizeCanonicalUrl } from './content-canonical';
import { cardFromNetworkItem, type DiscoverCard } from './content-discover';
import {
  classifyCandidateRoles,
  defaultDiscoverIntent,
  interpretDiscoverIntent,
  isDomainLikeTitle,
  isGenericHubUrl,
  objectFidelity,
  strictRequestedTypes,
  type DiscoverIntent,
  type ObjectFidelity,
} from './discover-intent';
import {
  hasDirectMediaRepresentation,
  mergeSeekCardSets,
} from './discover-search-generation';
import {
  networkItemFromOpenHit,
  searchOpenMedia,
  type OpenMediaFetch,
} from './content-source-capabilities';

export interface ExternalSeekHit {
  title: string;
  url: string;
  snippet?: string;
}

export interface SeekTraceItem {
  contentId: string;
  canonicalUrl?: string;
  title: string;
  contentType?: string;
  origin: 'directory' | 'search';
  searchQuery?: string;
  fidelity?: ObjectFidelity;
  typeMatched?: boolean;
  selected?: boolean;
  visible?: boolean;
  reason?: string;
}

export interface SeekTrace {
  query: string;
  topic: string;
  mode: 'consume' | 'research';
  requestedContentTypes: string[];
  rawCandidates: number;
  topicMatched: number;
  typeMatched: number;
  primaryContent: number;
  aboutContent: number;
  unrelated: number;
  selected: number;
  visible: number;
  items: SeekTraceItem[];
}

export interface ContentSeekResult {
  cards: DiscoverCard[];
  relatedCards: DiscoverCard[];
  intent: DiscoverIntent;
  usedDirectory: boolean;
  usedExternal: boolean;
  notice: string;
  trace: SeekTrace;
}

const CONSUME_EMPTY = '这次没有找到可以直接看的内容。';
const MAX_CARDS = 12;

function emptyTrace(query: string, intent: DiscoverIntent): SeekTrace {
  return {
    query,
    topic: intent.topic,
    mode: intent.intent,
    requestedContentTypes: intent.requestedMedia,
    rawCandidates: 0,
    topicMatched: 0,
    typeMatched: 0,
    primaryContent: 0,
    aboutContent: 0,
    unrelated: 0,
    selected: 0,
    visible: 0,
    items: [],
  };
}

function honestEmptyNotice(intent: DiscoverIntent): string {
  const types = strictRequestedTypes(intent);
  const topic = intent.topic || '这次要的';
  if (types.includes('video')) return `这次没有找到可以直接观看的 ${topic} 视频。`;
  if (types.includes('audio')) return `这次没有找到可以直接听的 ${topic} 音频。`;
  if (types.includes('image')) return `这次没有找到可以直接看的 ${topic} 图片。`;
  return CONSUME_EMPTY;
}

function typeMatches(card: DiscoverCard, required: string[]): boolean {
  if (!required.length) return true;
  const declared = String(card.contentType || '');
  if (required.includes(declared)) return true;
  const media = required.some((row) => row === 'video' || row === 'audio' || row === 'image');
  if (!declared && required.includes('article') && !media) return true;
  return false;
}

export function directorySeekTerms(query: string): string[] {
  const raw = String(query || '').trim();
  if (!raw) return [];
  const stripped = raw
    .replace(/^(请|帮我|麻烦|想|要)?(找|搜|看看|查一下|查)?(一下|一些)?/u, '')
    .replace(/(相关)?(的)?(文章|新闻|内容|资料|报道)(吧|啊)?$/u, '')
    .trim();
  const terms: string[] = [raw];
  if (stripped && stripped !== raw) terms.push(stripped);
  for (const part of raw.split(/[\s,，。？?！!、；;]+/)) {
    if (part.length >= 2) terms.push(part);
  }
  for (const match of raw.matchAll(/[A-Za-z][A-Za-z0-9\-]{1,}/g)) {
    terms.push(match[0]);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of terms) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out.slice(0, 8);
}

export function openMediaQueries(query: string, intent: DiscoverIntent): string[] {
  const terms: string[] = [];
  for (const row of [...intent.searchQueries, intent.topic, ...directorySeekTerms(query)]) {
    const value = String(row || '').trim();
    if (value.length >= 2) terms.push(value);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of terms) {
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= 3) break;
  }
  return out;
}

export function matchDirectoryForSeek(items: NetworkItem[], query: string): NetworkItem[] {
  const seen = new Set<string>();
  const matched: NetworkItem[] = [];
  for (const term of directorySeekTerms(query)) {
    for (const item of searchContentDirectory(items, { q: term, limit: 20 })) {
      if (seen.has(item.itemId)) continue;
      seen.add(item.itemId);
      matched.push(item);
    }
  }
  return matched.slice(0, 12);
}

export function isDomainOnlyCard(card: Pick<DiscoverCard, 'title' | 'url'>): boolean {
  return isDomainLikeTitle(card.title, card.url);
}

function canonicalOf(url?: string): string {
  if (!url) return '';
  try {
    return normalizeCanonicalUrl(url);
  } catch {
    return '';
  }
}

function isConcreteCandidate(card: DiscoverCard): boolean {
  if (!card.title.trim()) return false;
  if (isDomainOnlyCard(card)) return false;
  if (card.url && isGenericHubUrl(card.url)) return false;
  return true;
}

function webCardFromHit(hit: ExternalSeekHit, itemId: string): DiscoverCard {
  return {
    itemId,
    title: String(hit.title || hit.url).slice(0, 240),
    text: String(hit.snippet || hit.title || '').slice(0, 800),
    url: canonicalOf(hit.url) || hit.url,
    reason: '公开网页来源，不是目录推荐。',
    source: 'web',
  };
}

export async function seekContent(input: {
  query: string;
  items: NetworkItem[];
  searchWeb?: (query: string) => Promise<ExternalSeekHit[]>;
  chatComplete?: ChatCompleteFn;
  model?: { baseUrl: string; model: string; apiKey?: string };
  ingestHit?: (hit: ExternalSeekHit) => Promise<NetworkItem[]>;
  fetchOpenMedia?: OpenMediaFetch;
  intent?: DiscoverIntent;
  skipWeb?: boolean;
  skipOpenMedia?: boolean;
  previous?: { cards: DiscoverCard[]; relatedCards: DiscoverCard[] };
}): Promise<ContentSeekResult> {
  const query = String(input.query || '').trim();
  const emptyIntent = defaultDiscoverIntent(query);
  if (!query) {
    return {
      cards: [],
      relatedCards: [],
      intent: emptyIntent,
      usedDirectory: false,
      usedExternal: false,
      notice: '请先说想看什么。',
      trace: emptyTrace(query, emptyIntent),
    };
  }

  const intent =
    input.intent ||
    (input.chatComplete && input.model
      ? await interpretDiscoverIntent({
          query,
          chatComplete: input.chatComplete,
          model: input.model,
        })
      : emptyIntent);
  const requiredTypes = strictRequestedTypes(intent);
  const queryByUrl = new Map<string, string>();

  const directoryHits = matchDirectoryForSeek(input.items, query).filter(
    (item) => !isDomainLikeTitle(item.content.title, item.content.url) && !(item.content.url && isGenericHubUrl(item.content.url)),
  );
  const cards: DiscoverCard[] = directoryHits.map((item) =>
    cardFromNetworkItem(item, '目录里已有这条内容。', 'directory'),
  );
  const seenUrls = new Set(cards.map((card) => canonicalOf(card.url)).filter(Boolean));
  const seenIds = new Set(cards.map((card) => card.itemId));

  let usedExternal = false;
  let searchFailed = false;
  const mediaKinds = intent.requestedMedia.filter(
    (row): row is 'video' | 'image' | 'audio' => row === 'video' || row === 'image' || row === 'audio',
  );
  if (mediaKinds.length && input.fetchOpenMedia && !input.skipOpenMedia) {
    const mediaQueries = openMediaQueries(query, intent);
    try {
      for (const topicQuery of mediaQueries) {
        const openHits = await searchOpenMedia({
          query: topicQuery,
          kinds: mediaKinds,
          fetchImpl: input.fetchOpenMedia,
        });
        let mediaOfKind = cards.filter((card) => mediaKinds.includes(card.contentType as 'video' | 'image' | 'audio')).length;
        if (mediaOfKind >= 16) break;
        for (const hit of openHits) {
          let ingestedFeed = false;
          if (hit.feedUrl && input.ingestHit) {
            try {
              const ingested = await input.ingestHit({
                title: hit.title,
                url: hit.feedUrl,
                ...(hit.snippet ? { snippet: hit.snippet } : {}),
              });
              for (const item of ingested) {
                const canonical = canonicalOf(item.content.url);
                if (canonical && seenUrls.has(canonical)) continue;
                if (seenIds.has(item.itemId)) continue;
                if (isDomainLikeTitle(item.content.title, item.content.url)) continue;
                if (item.content.url && isGenericHubUrl(item.content.url)) continue;
                if (canonical) seenUrls.add(canonical);
                seenIds.add(item.itemId);
                usedExternal = true;
                ingestedFeed = true;
                if (canonical) queryByUrl.set(canonical, topicQuery);
                cards.push(cardFromNetworkItem(item, '开放媒体来源，不是目录推荐。', 'web'));
                if (cards.filter((card) => mediaKinds.includes(card.contentType as 'video' | 'image' | 'audio')).length >= 16) {
                  break;
                }
              }
            } catch {
              /* 单条播客 feed 失败则用条目本身 */
            }
          }
          if (ingestedFeed) continue;
          const item = networkItemFromOpenHit(hit);
          if (!item) continue;
          const canonical = canonicalOf(item.content.url);
          if (canonical && seenUrls.has(canonical)) continue;
          if (seenIds.has(item.itemId)) continue;
          if (canonical) seenUrls.add(canonical);
          seenIds.add(item.itemId);
          usedExternal = true;
          if (canonical) queryByUrl.set(canonical, topicQuery);
          cards.push(cardFromNetworkItem(item, '开放媒体来源，不是目录推荐。', 'web'));
          mediaOfKind = cards.filter((card) => mediaKinds.includes(card.contentType as 'video' | 'image' | 'audio')).length;
          if (mediaOfKind >= 16) break;
        }
      }
    } catch {
      /* 开放媒体来源失败不阻断文章搜索 */
    }
  }

  if (input.searchWeb && !input.skipWeb) {
    const queries = intent.searchQueries.length ? intent.searchQueries : [query];
    const webHits: Array<ExternalSeekHit & { searchQuery: string }> = [];
    const seenHit = new Set<string>();
    for (const q of queries.slice(0, 2)) {
      try {
        const web = await input.searchWeb(q);
        for (const hit of web) {
          const canonical = canonicalOf(hit.url);
          if (!canonical || seenHit.has(canonical) || seenUrls.has(canonical)) continue;
          if (isGenericHubUrl(canonical) || isDomainLikeTitle(hit.title, canonical)) continue;
          seenHit.add(canonical);
          webHits.push({ ...hit, url: canonical, searchQuery: q });
        }
      } catch {
        searchFailed = true;
      }
    }
    for (const hit of webHits) {
      let added = false;
      if (input.ingestHit) {
        try {
          const ingested = await input.ingestHit(hit);
          for (const item of ingested) {
            const canonical = canonicalOf(item.content.url);
            if (canonical && seenUrls.has(canonical)) continue;
            if (seenIds.has(item.itemId)) continue;
            if (isDomainLikeTitle(item.content.title, item.content.url)) continue;
            if (item.content.url && isGenericHubUrl(item.content.url)) continue;
            if (canonical) seenUrls.add(canonical);
            seenIds.add(item.itemId);
            usedExternal = true;
            added = true;
            if (canonical) queryByUrl.set(canonical, hit.searchQuery);
            cards.push(cardFromNetworkItem(item, '公开网页来源，不是目录推荐。', 'web'));
            if (cards.length >= 24) break;
          }
        } catch {
          /* 单条摄入失败则退回搜索命中本身 */
        }
      }
      if (!added && cards.length < 24) {
        const canonical = canonicalOf(hit.url);
        if (canonical && seenUrls.has(canonical)) continue;
        if (canonical) {
          seenUrls.add(canonical);
          queryByUrl.set(canonical, hit.searchQuery);
        }
        usedExternal = true;
        cards.push(webCardFromHit(hit, `seek_${seenUrls.size}`));
      }
      if (cards.length >= 24) break;
    }
  }

  const concrete = cards.filter(isConcreteCandidate);
  const fidelity = new Map<string, ObjectFidelity>();
  if (input.chatComplete && input.model && concrete.length) {
    const roles = await classifyCandidateRoles({
      query,
      intent,
      candidates: concrete.map((card) => ({
        id: card.itemId,
        title: card.title,
        url: card.url || '',
        summary: card.text || '',
        ...(card.contentType ? { contentType: card.contentType } : {}),
      })),
      chatComplete: input.chatComplete,
      model: input.model,
    });
    if (roles.size) {
      for (const card of concrete) {
        fidelity.set(card.itemId, objectFidelity(roles.get(card.itemId), intent));
      }
    }
  }

  const primary: DiscoverCard[] = [];
  const related: DiscoverCard[] = [];
  for (const card of concrete) {
    const matchedType = typeMatches(card, requiredTypes);
    let kind = fidelity.get(card.itemId);
    if (hasDirectMediaRepresentation(card) && matchedType) {
      kind = 'PRIMARY_CONTENT';
    }
    if (!kind) {
      kind = requiredTypes.length && !matchedType ? 'ABOUT_CONTENT' : 'PRIMARY_CONTENT';
    }
    if (requiredTypes.length && kind === 'PRIMARY_CONTENT' && !matchedType) {
      kind = 'ABOUT_CONTENT';
    }
    fidelity.set(card.itemId, kind);
    if (kind === 'UNRELATED') continue;
    if (intent.intent === 'research') {
      if (kind === 'PRIMARY_CONTENT' || kind === 'ABOUT_CONTENT') {
        primary.push({ ...card, objectFidelity: 'PRIMARY_CONTENT' });
      }
    } else if (kind === 'PRIMARY_CONTENT' && matchedType) {
      primary.push({ ...card, objectFidelity: 'PRIMARY_CONTENT' });
    } else if (kind === 'ABOUT_CONTENT') {
      related.push({ ...card, objectFidelity: 'ABOUT_CONTENT' });
    }
  }

  let visible = primary.slice(0, MAX_CARDS);
  let relatedVisible = intent.intent === 'research' ? [] : related.slice(0, 6);
  if (input.previous) {
    const merged = mergeSeekCardSets(input.previous, { cards: visible, relatedCards: relatedVisible });
    visible = merged.cards.slice(0, MAX_CARDS);
    relatedVisible = merged.relatedCards;
  }
  const visibleIds = new Set([...visible, ...relatedVisible].map((card) => card.itemId));

  const traceItems: SeekTraceItem[] = concrete.map((card) => {
    const kind = fidelity.get(card.itemId) || 'UNRELATED';
    const canonical = canonicalOf(card.url);
    const matchedType = typeMatches(card, requiredTypes);
    const isVisible = visibleIds.has(card.itemId);
    const searchQuery = canonical ? queryByUrl.get(canonical) : undefined;
    return {
      contentId: card.itemId,
      ...(card.url ? { canonicalUrl: card.url } : {}),
      title: card.title,
      ...(card.contentType ? { contentType: card.contentType } : {}),
      origin: card.source === 'web' ? 'search' : 'directory',
      ...(searchQuery ? { searchQuery } : {}),
      fidelity: kind,
      typeMatched: matchedType,
      selected: kind === 'PRIMARY_CONTENT' && matchedType,
      visible: isVisible,
      reason: card.reason,
    };
  });
  const trace: SeekTrace = {
    query,
    topic: intent.topic,
    mode: intent.intent,
    requestedContentTypes: intent.requestedMedia,
    rawCandidates: concrete.length,
    topicMatched: traceItems.filter((row) => row.fidelity !== 'UNRELATED').length,
    typeMatched: traceItems.filter((row) => row.typeMatched).length,
    primaryContent: traceItems.filter((row) => row.fidelity === 'PRIMARY_CONTENT').length,
    aboutContent: traceItems.filter((row) => row.fidelity === 'ABOUT_CONTENT').length,
    unrelated: traceItems.filter((row) => row.fidelity === 'UNRELATED').length,
    selected: traceItems.filter((row) => row.selected).length,
    visible: visible.length,
    items: traceItems,
  };

  let notice = '';
  if (!visible.length) {
    if (searchFailed && !directoryHits.length) {
      notice = '暂时无法获取新内容，可以稍后再试或检查联网设置。';
    } else if (!input.searchWeb && !directoryHits.length) {
      notice = '还没有新内容。开启联网发现后，兔机米还可以从公开网络帮你找到更多内容。';
    } else if (intent.intent === 'consume') {
      notice = honestEmptyNotice(intent);
    } else {
      notice = '这次更适合当作分析材料。可点「问兔机米」，或到「与兔机米」里继续。';
    }
  } else if (intent.honestyNote) {
    notice = intent.honestyNote;
  } else if (intent.intent === 'research' && intent.suggestTalk) {
    notice = '这更像需要深入分析的材料。可点「问兔机米」继续。';
  }

  return {
    cards: visible,
    relatedCards: relatedVisible,
    intent,
    usedDirectory: directoryHits.length > 0,
    usedExternal,
    notice,
    trace,
  };
}

export function formatSeekContext(result: ContentSeekResult): string {
  const rows = [...result.cards, ...result.relatedCards].slice(0, 8);
  if (!rows.length) return '';
  return rows
    .map((card) => `- ${card.title}${card.url ? `\n  来源：${card.url}` : ''}`)
    .join('\n');
}

export function formatContentAskContext(card: DiscoverCard): string {
  return [
    '【正在讨论的内容】',
    card.itemId ? `contentId: ${card.itemId}` : '',
    `标题：${card.title || ''}`,
    card.contentType ? `类型：${card.contentType}` : '',
    card.publisherDisplayName ? `来源：${card.publisherDisplayName}` : '',
    card.url ? `链接：${card.url}` : '',
    card.text ? `摘要：${String(card.text).slice(0, 600)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
