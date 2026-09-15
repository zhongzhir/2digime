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
  isPrimaryContentRole,
  isRelatedInfoRole,
  type DiscoverIntent,
} from './discover-intent';

export interface ExternalSeekHit {
  title: string;
  url: string;
  snippet?: string;
}

export interface ContentSeekResult {
  cards: DiscoverCard[];
  relatedCards: DiscoverCard[];
  intent: DiscoverIntent;
  usedDirectory: boolean;
  usedExternal: boolean;
  notice: string;
}

const CONSUME_EMPTY = '这次没有找到可直接消费的内容。';
const MAX_CARDS = 12;

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
    };
  }

  const intent =
    input.chatComplete && input.model
      ? await interpretDiscoverIntent({
          query,
          chatComplete: input.chatComplete,
          model: input.model,
        })
      : emptyIntent;

  const directoryHits = matchDirectoryForSeek(input.items, query).filter(
    (item) => !isDomainLikeTitle(item.content.title, item.content.url) && !(item.content.url && isGenericHubUrl(item.content.url)),
  );
  const cards: DiscoverCard[] = directoryHits.map((item) =>
    cardFromNetworkItem(item, '目录里已有这条内容。', 'directory'),
  );
  const seenUrls = new Set(cards.map((card) => canonicalOf(card.url)).filter(Boolean));
  const seenIds = new Set(cards.map((card) => card.itemId));

  let usedExternal = false;
  if (input.searchWeb) {
    const queries = intent.searchQueries.length ? intent.searchQueries : [query];
    const webHits: ExternalSeekHit[] = [];
    const seenHit = new Set<string>();
    for (const q of queries.slice(0, 2)) {
      try {
        const web = await input.searchWeb(q);
        for (const hit of web) {
          const canonical = canonicalOf(hit.url);
          if (!canonical || seenHit.has(canonical) || seenUrls.has(canonical)) continue;
          if (isGenericHubUrl(canonical) || isDomainLikeTitle(hit.title, canonical)) continue;
          seenHit.add(canonical);
          webHits.push({ ...hit, url: canonical });
        }
      } catch {
        /* 外部搜索失败时仍返回目录命中 */
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
            cards.push(cardFromNetworkItem(item, '公开网页来源，不是目录推荐。', 'web'));
            if (cards.length >= MAX_CARDS) break;
          }
        } catch {
          /* 单条摄入失败则退回搜索命中本身 */
        }
      }
      if (!added && cards.length < MAX_CARDS) {
        const canonical = canonicalOf(hit.url);
        if (canonical && seenUrls.has(canonical)) continue;
        if (canonical) seenUrls.add(canonical);
        usedExternal = true;
        cards.push(webCardFromHit(hit, `seek_${seenUrls.size}`));
      }
      if (cards.length >= MAX_CARDS) break;
    }
  }

  const concrete = cards.filter(isConcreteCandidate);
  let primary = concrete;
  let related: DiscoverCard[] = [];
  if (input.chatComplete && input.model && concrete.length) {
    const roles = await classifyCandidateRoles({
      query,
      intent,
      candidates: concrete.map((card) => ({
        id: card.itemId,
        title: card.title,
        url: card.url || '',
        summary: card.text || '',
      })),
      chatComplete: input.chatComplete,
      model: input.model,
    });
    if (roles.size) {
      primary = [];
      related = [];
      for (const card of concrete) {
        const role = roles.get(card.itemId);
        if (isPrimaryContentRole(role)) primary.push(card);
        else if (isRelatedInfoRole(role)) related.push(card);
      }
      if (intent.intent === 'research') {
        related = [...primary.filter((card) => !isPrimaryContentRole(roles.get(card.itemId))), ...related];
        primary = primary.filter((card) => isPrimaryContentRole(roles.get(card.itemId)));
        if (!primary.length && intent.objectWanted !== 'work_itself') {
          /* 研究请求：相关信息单独成组，不把报道冒充可消费主卡 */
        }
      }
    }
  }

  primary = primary.slice(0, MAX_CARDS);
  related = related.slice(0, 6);

  let notice = '';
  if (!primary.length) {
    notice =
      intent.intent === 'consume'
        ? CONSUME_EMPTY
        : '这次更适合当作分析材料。可点「问兔机米」，或到「与兔机米」里继续。';
    if (!input.searchWeb && !directoryHits.length) {
      notice = '还没有新内容。开启联网发现后，兔机米还可以从公开网络帮你找到更多内容。';
    }
  } else if (intent.honestyNote) {
    notice = intent.honestyNote;
  } else if (intent.intent === 'research' && intent.suggestTalk) {
    notice = '这更像需要深入分析的材料。可点「问兔机米」继续。';
  }

  return {
    cards: primary,
    relatedCards: related,
    intent,
    usedDirectory: directoryHits.length > 0,
    usedExternal,
    notice,
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
