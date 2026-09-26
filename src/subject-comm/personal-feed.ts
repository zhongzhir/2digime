/**
 * 最薄个人 Discover Feed 编排：读缓存、不足时补候选、交给 2digime 选择、留下 ID 列表。
 * 不是中心推荐，不写用户画像，不把 Digital Self 发给搜索。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile } from '../infrastructure/fs-atomic';
import type { ChatCompleteFn } from '../subject-core/structured-distill';
import type { DigitalSelf } from '../subject-core/digital-self/types';
import { formatSelfContext, selectSelfContext } from '../intelligence/self-context';
import type { NetworkItem } from './network-item';
import { selectNetworkItems } from './personal-selection';
import { appendNetworkContentFeedback, createAiJudgmentFeedback } from './network-content-feedback';
import {
  cardFromNetworkItem,
  isConcreteContentCard,
  type DiscoverCard,
  type DiscoverPreference,
  type DiscoverView,
} from './content-discover';
import type { ExternalSeekHit } from './content-seek';
import { isDomainLikeTitle, isGenericHubUrl } from './discover-intent';
import type { ContentPreferenceDirective } from './content-preferences';
import { isNetworkItemExpired } from './network-item';
import {
  catalogFeedUrls,
  listOpenCatalog,
  networkItemFromOpenHit,
  searchOpenMedia,
  sourceKindsForRequest,
  type OpenMediaFetch,
} from './content-source-capabilities';
import {
  classifySearchFailure,
  humanNetworkNotice,
  type FeedReasonCode,
  type NetworkDiscoveryCode,
} from './network-discovery-state';
import {
  formatRecentRecommendationContext,
  openedItemIds,
  type RecentRecommendationEvent,
} from './recent-recommendation-state';

export interface DiscoveryIntent {
  topic: string;
  contentTypes: string[];
  purpose: string;
  freshness: 'current' | 'classic' | 'unspecified';
  explorationMode: 'core' | 'adjacent' | 'explore';
  searchQuery: string;
}

interface FeedSnapshot {
  itemIds: string[];
  generatedAt: string;
  mode: 'personal' | 'intent';
  query?: string;
}

interface FeedCacheFile {
  version: 1;
  personal?: FeedSnapshot;
  lastView?: FeedSnapshot;
}

const MIN_FEED = 6;
const MAX_FEED = 12;
const STALE_MS = 24 * 60 * 60 * 1000;
const LEAD =
  '这里可以直接看文章、图片、音频和视频。兔机米按你的数字之我挑选，不是中心推荐。';

export function personalFeedCachePath(packageRoot: string): string {
  return path.join(packageRoot, 'content', 'personal-feed-cache.json');
}

function emptyCache(): FeedCacheFile {
  return { version: 1 };
}

async function readCache(packageRoot: string): Promise<FeedCacheFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(personalFeedCachePath(packageRoot), 'utf8')) as FeedCacheFile;
    if (!parsed || parsed.version !== 1) return emptyCache();
    return parsed;
  } catch {
    return emptyCache();
  }
}

async function writeCache(packageRoot: string, file: FeedCacheFile): Promise<void> {
  await fs.mkdir(path.dirname(personalFeedCachePath(packageRoot)), { recursive: true });
  await atomicWriteFile(personalFeedCachePath(packageRoot), `${JSON.stringify(file, null, 2)}\n`);
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = String(text || '').indexOf('{');
  const end = String(text || '').lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function discoveryIntentsFromModelText(text: string): DiscoveryIntent[] {
  const rec = parseJsonObject(text);
  const rows = rec && Array.isArray(rec.intents) ? rec.intents : [];
  const out: DiscoveryIntent[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const topic = String(item.topic || '').trim().slice(0, 80);
    const searchQuery = String(item.searchQuery || topic).trim().slice(0, 120);
    if (searchQuery.length < 2) continue;
    const freshness =
      item.freshness === 'current' || item.freshness === 'classic' ? item.freshness : 'unspecified';
    const explorationMode =
      item.explorationMode === 'adjacent' || item.explorationMode === 'explore' ? item.explorationMode : 'core';
    const contentTypes = Array.isArray(item.contentTypes)
      ? item.contentTypes.map((value) => String(value || '').trim()).filter(Boolean).slice(0, 4)
      : [];
    out.push({
      topic: topic || searchQuery,
      contentTypes,
      purpose: String(item.purpose || '').trim().slice(0, 120),
      freshness,
      explorationMode,
      searchQuery,
    });
    if (out.length >= 3) break;
  }
  return out;
}

export async function proposeDiscoveryIntents(input: {
  selfContext: string;
  preferenceDirectives?: string;
  recentContext?: string;
  chatComplete: ChatCompleteFn;
  model: { baseUrl: string; model: string; apiKey?: string };
  now?: string;
}): Promise<DiscoveryIntent[]> {
  const system = [
    '你在为这个人的 2digime 拟定内容发现方向。这不是搜索引擎运营，也不是为了让人刷得更久。',
    '只输出 JSON：{"intents":[{"topic":"","contentTypes":[],"purpose":"","freshness":"current|classic|unspecified","explorationMode":"core|adjacent|explore","searchQuery":""}]}。',
    '2 到 3 条。尽量包含一个核心方向、一个相邻方向、一个探索方向。不要写成固定栏目表。',
    'contentTypes 只允许 article / video / image / audio。在质量允许时，这一批可以包含不同媒介；不要默认三条都只搜文章，也不要写成固定比例。',
    'searchQuery 是发给公开搜索或开放媒体现货目录的最短必要主题词。只写公开主题，不要写成对某个人的描述。video 指向可看的具体视频，image 指向具体图片作品，audio 指向可听的节目，article 指向可读正文。不要指定必须去哪个网站，不要搜十大盘点。',
    '不要包含姓名、住址、账号、密钥。不要把完整数字之我、事实列表或偏好向量写进 searchQuery。',
    '除非用户明确搜索过、明确关注或明确写了内容偏好，不要把医疗/疾病、政治立场、宗教、性生活或其他高度敏感事实变成搜索词。',
    '优化目标是对人有用、相关、质量高、有必要新鲜度与多样性，而不是延长使用时间或增加打开次数。',
  ].join('\n');
  const user = [
    `当前时间：${input.now || new Date().toISOString()}`,
    `数字之我摘要（仅供本机理解）：\n${input.selfContext.slice(0, 1200)}`,
    input.preferenceDirectives?.trim() ? `用户明确的内容偏好：\n${input.preferenceDirectives.trim()}` : '',
    input.recentContext?.trim() || '',
  ]
    .filter(Boolean)
    .join('\n\n');
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
      thinking: 'disabled',
      maxTokens: 700,
      timeoutMs: 30_000,
      responseFormat: { type: 'json_object' },
    });
    return discoveryIntentsFromModelText(result.text);
  } catch {
    return [];
  }
}

function viewOf(input: {
  cards: DiscoverCard[];
  relatedCards?: DiscoverCard[];
  preferences: DiscoverPreference[];
  notice: string;
  reasonCode: FeedReasonCode;
  feedMode: 'personal' | 'intent';
  networking: NetworkDiscoveryCode;
  lead?: string;
  replenishing?: boolean;
  supplyTrace?: Array<{ event: string; ms: number; count?: number }>;
}): DiscoverView {
  return {
    headline: '发现',
    lead: input.lead || LEAD,
    cards: input.cards,
    relatedCards: input.relatedCards || [],
    preferences: input.preferences,
    notice: input.notice,
    reasonCode: input.reasonCode,
    feedMode: input.feedMode,
    networking: input.networking,
    ...(input.replenishing ? { replenishing: true } : {}),
    ...(input.supplyTrace && input.supplyTrace.length ? { supplyTrace: input.supplyTrace } : {}),
    feedTitle: '为你发现',
  };
}

function isConsumableItem(item: NetworkItem, nowIso?: string): boolean {
  if (nowIso && isNetworkItemExpired(item, nowIso)) return false;
  if (!String(item.content.title || '').trim()) return false;
  if (isDomainLikeTitle(item.content.title, item.content.url)) return false;
  if (item.content.url && isGenericHubUrl(item.content.url)) return false;
  const access = String(item.content.access || '');
  if (access && access !== 'open' && access !== 'public' && access !== 'available') {
    if (/restricted|paywall|login|unavailable/i.test(access)) return false;
  }
  return true;
}

function blocked(item: NetworkItem, prefs: ContentPreferenceDirective[]): boolean {
  return prefs.some((row) => {
    if (row.kind !== 'block') return false;
    if (row.targetType === 'item') return row.target === item.itemId;
    return !!item.publisherSubjectId && row.target === item.publisherSubjectId;
  });
}

async function resolveCards(
  ids: string[] | undefined,
  items: NetworkItem[],
  getItem?: (itemId: string) => Promise<NetworkItem | undefined>,
  nowIso?: string,
): Promise<DiscoverCard[]> {
  if (!ids?.length) return [];
  const byId = new Map(items.map((item) => [item.itemId, item]));
  const cards: DiscoverCard[] = [];
  for (const id of ids) {
    const item = byId.get(id) || (getItem ? await getItem(id) : undefined);
    if (!item || !isConsumableItem(item, nowIso)) continue;
    const card = cardFromNetworkItem(item, '继续看你这边已经挑出的内容。', 'directory');
    if (isConcreteContentCard(card)) cards.push(card);
  }
  return cards;
}

function directoryCards(
  items: NetworkItem[],
  prefs: ContentPreferenceDirective[],
  limit: number,
  nowIso?: string,
): DiscoverCard[] {
  const cards: DiscoverCard[] = [];
  for (const item of items) {
    if (!isConsumableItem(item, nowIso) || blocked(item, prefs)) continue;
    const card = cardFromNetworkItem(item, '来自你这边已经有的内容。', 'directory');
    if (!isConcreteContentCard(card)) continue;
    cards.push(card);
    if (cards.length >= limit) break;
  }
  return cards;
}

function canSearch(input: {
  searchWeb?: (query: string) => Promise<ExternalSeekHit[]>;
  fetchOpenMedia?: OpenMediaFetch;
  chatComplete?: ChatCompleteFn;
  model?: { baseUrl: string; model: string; apiKey?: string };
  networking: NetworkDiscoveryCode;
}): boolean {
  return !!(
    (input.searchWeb || input.fetchOpenMedia) &&
    input.chatComplete &&
    input.model &&
    input.networking !== 'DISABLED'
  );
}

function canFetchOpenCatalog(input: {
  fetchOpenMedia?: OpenMediaFetch;
  networking: NetworkDiscoveryCode;
}): boolean {
  return !!(input.fetchOpenMedia && input.networking !== 'DISABLED');
}

function canReplenishSupply(input: {
  searchWeb?: (query: string) => Promise<ExternalSeekHit[]>;
  fetchOpenMedia?: OpenMediaFetch;
  chatComplete?: ChatCompleteFn;
  model?: { baseUrl: string; model: string; apiKey?: string };
  networking: NetworkDiscoveryCode;
}): boolean {
  return canSearch(input) || canFetchOpenCatalog(input);
}

function cacheFresh(snapshot: FeedSnapshot | undefined, nowMs: number): boolean {
  if (!snapshot?.generatedAt) return false;
  const at = Date.parse(snapshot.generatedAt);
  return Number.isFinite(at) && nowMs - at <= STALE_MS;
}

export async function ensurePersonalFeed(input: {
  packageRoot: string;
  digitalSelf: DigitalSelf;
  items: NetworkItem[];
  preferences: DiscoverPreference[];
  preferenceDirectives?: string;
  preferenceRows?: ContentPreferenceDirective[];
  recentEvents?: RecentRecommendationEvent[];
  feedbackFile: string;
  networking: NetworkDiscoveryCode;
  chatComplete?: ChatCompleteFn;
  model?: { baseUrl: string; model: string; apiKey?: string };
  searchWeb?: (query: string) => Promise<ExternalSeekHit[]>;
  ingestHit?: (hit: ExternalSeekHit) => Promise<NetworkItem[]>;
  fetchOpenMedia?: OpenMediaFetch;
  putNetworkItem?: (item: NetworkItem) => Promise<void>;
  reloadItems?: () => Promise<NetworkItem[]>;
  getItem?: (itemId: string) => Promise<NetworkItem | undefined>;
  mode: 'open' | 'refresh' | 'reuse' | 'replenish';
  now?: string;
}): Promise<{ view: DiscoverView; reasonCode: FeedReasonCode }> {
  const now = input.now || new Date().toISOString();
  const nowMs = Date.parse(now) || Date.now();
  const startedAt = Date.now();
  const supplyTrace: Array<{ event: string; ms: number; count?: number }> = [];
  const mark = (event: string, count?: number) => {
    supplyTrace.push(count === undefined ? { event, ms: Date.now() - startedAt } : { event, ms: Date.now() - startedAt, count });
  };
  const prefs = input.preferenceRows || [];
  const recent = input.recentEvents || [];
  const cache = await readCache(input.packageRoot);
  const cachedCards = await resolveCards(cache.personal?.itemIds, input.items, input.getItem, now);
  const lastCards = await resolveCards(cache.lastView?.itemIds, input.items, input.getItem, now);
  let networking = input.networking;
  const noticeFor = (reasonCode: FeedReasonCode, hasCards: boolean, extra = ''): string => {
    if (extra) return extra;
    if (hasCards && (reasonCode === 'CACHED_FEED' || reasonCode === 'REPLENISHED' || reasonCode === 'LOCAL_DIRECTORY')) {
      return '';
    }
    return humanNetworkNotice({
      networking,
      hasCachedCards: hasCards,
      hasLocalItems: input.items.some((item) => isConsumableItem(item, now)),
    });
  };
  const finish = (view: DiscoverView, reasonCode: FeedReasonCode) => {
    const traced = viewOf({
      cards: view.cards,
      relatedCards: view.relatedCards || [],
      preferences: view.preferences,
      notice: view.notice,
      reasonCode,
      feedMode: view.feedMode || 'personal',
      networking: (view.networking as NetworkDiscoveryCode) || networking,
      ...(view.lead ? { lead: view.lead } : {}),
      ...(view.replenishing ? { replenishing: true } : {}),
      supplyTrace,
    });
    return { view: traced, reasonCode };
  };

  if (input.mode === 'reuse') {
    const cards = lastCards.length ? lastCards : cachedCards;
    if (cards.length) {
      mark('LOCAL_FEED_READ', cards.length);
      mark('FIRST_CARD_VISIBLE', cards.length);
      return finish(
        viewOf({
          cards,
          preferences: input.preferences,
          notice: noticeFor('CACHED_FEED', true),
          reasonCode: 'CACHED_FEED',
          feedMode: cache.lastView?.mode || 'personal',
          networking: input.networking,
        }),
        'CACHED_FEED',
      );
    }
  }

  if (input.mode === 'open') {
    mark('OPEN_DISCOVER');
    mark('LOCAL_FEED_READ', cachedCards.length);
    const localFromCache = cachedCards.length ? cachedCards.slice(0, MAX_FEED) : [];
    const localFromDirectory = localFromCache.length ? [] : directoryCards(input.items, prefs, MAX_FEED, now);
    mark('DIRECTORY_READ', localFromDirectory.length || input.items.filter((item) => isConsumableItem(item, now)).length);
    const localCards = localFromCache.length ? localFromCache : localFromDirectory;
    const fresh = localFromCache.length ? cacheFresh(cache.personal, nowMs) : localCards.length >= MIN_FEED;
    const replenishing = canReplenishSupply({ ...input, networking }) && (localCards.length < MIN_FEED || !fresh);
    if (localCards.length) {
      const snapshot: FeedSnapshot = {
        itemIds: localCards.map((card) => card.itemId),
        generatedAt:
          localFromCache.length && cache.personal && cache.personal.generatedAt
            ? cache.personal.generatedAt
            : now,
        mode: 'personal',
      };
      cache.lastView = snapshot;
      if (!cache.personal) cache.personal = snapshot;
      await writeCache(input.packageRoot, cache);
      mark('FIRST_CARD_VISIBLE', localCards.length);
      return finish(
        viewOf({
          cards: localCards,
          preferences: input.preferences,
          notice: '',
          reasonCode: localFromCache.length ? 'CACHED_FEED' : 'LOCAL_DIRECTORY',
          feedMode: 'personal',
          networking,
          replenishing,
        }),
        localFromCache.length ? 'CACHED_FEED' : 'LOCAL_DIRECTORY',
      );
    }
    if (replenishing) {
      return finish(
        viewOf({
          cards: [],
          preferences: input.preferences,
          notice: '',
          reasonCode: 'DIRECTORY_EMPTY',
          feedMode: 'personal',
          networking,
          replenishing: true,
        }),
        'DIRECTORY_EMPTY',
      );
    }
    const reasonCode: FeedReasonCode =
      networking === 'DISABLED'
        ? 'NETWORK_DISABLED'
        : networking === 'NOT_CONFIGURED'
          ? 'NETWORK_NOT_CONFIGURED'
          : 'DIRECTORY_EMPTY';
    return finish(
      viewOf({
        cards: [],
        preferences: input.preferences,
        notice: noticeFor(reasonCode, false),
        reasonCode,
        feedMode: 'personal',
        networking,
      }),
      reasonCode,
    );
  }

  if (input.mode === 'replenish') mark('REPLENISH_START');
  let items = input.items.filter((item) => isConsumableItem(item, now) && !blocked(item, prefs));
  const shown = new Set(input.mode === 'refresh' ? (cache.lastView?.itemIds || cache.personal?.itemIds || []) : []);
  const opened = new Set(openedItemIds(recent));
  const needReplenish =
    input.mode === 'replenish'
      ? items.filter((item) => !shown.has(item.itemId) && !opened.has(item.itemId)).length < MIN_FEED ||
        !cacheFresh(cache.personal, nowMs)
      : items.filter((item) => !shown.has(item.itemId) && !opened.has(item.itemId)).length < MIN_FEED;
  let replenished = false;
  let searchAttempted = false;

  const acceptOpenHits = async (openHits: Awaited<ReturnType<typeof searchOpenMedia>>) => {
    if (openHits.length) replenished = true;
    for (const hit of openHits.slice(0, 6)) {
      if (hit.feedUrl && input.ingestHit) {
        try {
          await input.ingestHit({ title: hit.title, url: hit.feedUrl, ...(hit.snippet ? { snippet: hit.snippet } : {}) });
          continue;
        } catch {
          /* feed 失败则收下单条 */
        }
      }
      const item = networkItemFromOpenHit(hit, now);
      if (!item) continue;
      if (input.putNetworkItem) {
        try {
          await input.putNetworkItem(item);
        } catch {
          items.push(item);
        }
      } else {
        items.push(item);
      }
    }
  };

  if (needReplenish && networking !== 'DISABLED' && (input.searchWeb || input.fetchOpenMedia)) {
    const ranked = !!(input.chatComplete && input.model);
    let queries: string[] = [];
    let intents: Awaited<ReturnType<typeof proposeDiscoveryIntents>> = [];
    if (ranked && input.chatComplete && input.model) {
      const selfContext = formatSelfContext(selectSelfContext(input.digitalSelf, ''));
      intents = await proposeDiscoveryIntents({
        selfContext,
        chatComplete: input.chatComplete,
        model: input.model,
        now,
        ...(input.preferenceDirectives ? { preferenceDirectives: input.preferenceDirectives } : {}),
        ...(formatRecentRecommendationContext(recent)
          ? { recentContext: formatRecentRecommendationContext(recent) }
          : {}),
      });
      queries = intents.map((row) => row.searchQuery).filter(Boolean);
    }
    if (input.fetchOpenMedia) {
      if (ranked && intents.length) {
        const topic = queries[0] || '';
        for (const row of intents.slice(0, 3)) {
          const kinds = sourceKindsForRequest(row.contentTypes).filter(
            (kind) => kind === 'video' || kind === 'image' || kind === 'audio',
          );
          const mediaKinds = kinds.length ? kinds : (['video', 'image', 'audio'] as const);
          try {
            await acceptOpenHits(
              await searchOpenMedia({
                query: row.searchQuery || topic,
                kinds: [...mediaKinds],
                fetchImpl: input.fetchOpenMedia,
              }),
            );
          } catch {
            /* 单个媒介来源失败不阻断其它媒介 */
          }
        }
      } else if (!ranked) {
        try {
          await acceptOpenHits(
            await listOpenCatalog({
              kinds: ['video', 'image', 'audio'],
              fetchImpl: input.fetchOpenMedia,
            }),
          );
        } catch {
          /* 开放目录失败不阻断 RSS */
        }
      }
      if (input.ingestHit) {
        for (const feedUrl of catalogFeedUrls(['video', 'audio', 'article', 'image'])) {
          try {
            const ingested = await input.ingestHit({ title: 'open catalog', url: feedUrl });
            if (ingested.length) replenished = true;
          } catch {
            /* 目录 feed 失败不阻断 */
          }
        }
      }
    }
    if (input.reloadItems) items = (await input.reloadItems()).filter((item) => isConsumableItem(item, now) && !blocked(item, prefs));
    const stillShort = items.filter((item) => !shown.has(item.itemId) && !opened.has(item.itemId)).length < MIN_FEED;
    if (ranked && input.searchWeb && stillShort) {
      for (const query of queries.slice(0, 2)) {
        searchAttempted = true;
        try {
          const hits = await input.searchWeb(query);
          if (hits.length) replenished = true;
          if (input.ingestHit) {
            for (const hit of hits.slice(0, 6)) {
              try {
                await input.ingestHit(hit);
              } catch {
                /* 单条摄入失败不阻断补量 */
              }
            }
          }
        } catch (err) {
          networking = classifySearchFailure(err);
          break;
        }
      }
    }
    mark('SEARCH_DONE', searchAttempted ? 1 : 0);
    if (input.reloadItems) items = (await input.reloadItems()).filter((item) => isConsumableItem(item, now) && !blocked(item, prefs));
    else items = items.filter((item) => isConsumableItem(item, now) && !blocked(item, prefs));
    mark('NORMALIZE_DONE', items.length);
  }

  const pool = items.filter((item) => {
    if (shown.has(item.itemId)) return false;
    return true;
  });
  const freshPool = pool.filter((item) => !opened.has(item.itemId));
  const candidates = (freshPool.length >= 3 ? freshPool : pool).slice(0, 24);

  if (!candidates.length) {
    if (searchAttempted && !replenished && networking === 'AVAILABLE') {
      networking = 'TEMPORARY_ERROR';
    }
    const fallback = lastCards.length ? lastCards : cachedCards;
    const reasonCode: FeedReasonCode =
      networking === 'DISABLED'
        ? 'NETWORK_DISABLED'
        : networking === 'NOT_CONFIGURED'
          ? 'NETWORK_NOT_CONFIGURED'
          : networking === 'AUTH_FAILED'
            ? 'NETWORK_AUTH_FAILED'
            : networking === 'TEMPORARY_ERROR' || networking === 'RATE_LIMITED'
              ? 'NETWORK_TEMPORARY_ERROR'
              : items.length
                ? 'NO_CONSUMABLE_CANDIDATES'
                : 'DIRECTORY_EMPTY';
    if (fallback.length) mark('FIRST_CARD_VISIBLE', fallback.length);
    return finish(
      viewOf({
        cards: fallback,
        preferences: input.preferences,
        notice: noticeFor(reasonCode, fallback.length > 0),
        reasonCode,
        feedMode: 'personal',
        networking,
      }),
      reasonCode,
    );
  }

  if (!input.chatComplete || !input.model) {
    const openCards = directoryCards(candidates, prefs, MAX_FEED, now);
    if (openCards.length) {
      const snapshot: FeedSnapshot = {
        itemIds: openCards.map((card) => card.itemId),
        generatedAt: now,
        mode: 'personal',
      };
      await writeCache(input.packageRoot, { version: 1, personal: snapshot, lastView: snapshot });
      mark('FIRST_CARD_VISIBLE', openCards.length);
      return finish(
        viewOf({
          cards: openCards,
          preferences: input.preferences,
          notice: '',
          reasonCode: replenished ? 'REPLENISHED' : 'LOCAL_DIRECTORY',
          feedMode: 'personal',
          networking,
        }),
        replenished ? 'REPLENISHED' : 'LOCAL_DIRECTORY',
      );
    }
    const fallback = cachedCards.length ? cachedCards : lastCards;
    if (fallback.length) mark('FIRST_CARD_VISIBLE', fallback.length);
    const reasonCode: FeedReasonCode = fallback.length
      ? 'CACHED_FEED'
      : networking === 'DISABLED'
        ? 'NETWORK_DISABLED'
        : 'DIRECTORY_EMPTY';
    return finish(
      viewOf({
        cards: fallback,
        preferences: input.preferences,
        notice: noticeFor(reasonCode, fallback.length > 0),
        reasonCode,
        feedMode: 'personal',
        networking,
      }),
      reasonCode,
    );
  }

  const recentContext = formatRecentRecommendationContext(recent);
  const selected = await selectNetworkItems({
    digitalSelf: input.digitalSelf,
    items: candidates,
    chatComplete: input.chatComplete,
    model: input.model,
    ...(input.preferenceDirectives ? { preferenceDirectives: input.preferenceDirectives } : {}),
    ...(recentContext ? { selectionNotes: recentContext } : {}),
  });
  mark('SELECT_DONE', selected.ok ? selected.decisions.length : 0);
  if (!selected.ok) {
    const fallback = cachedCards.length ? cachedCards : lastCards;
    if (fallback.length) mark('FIRST_CARD_VISIBLE', fallback.length);
    return finish(
      viewOf({
        cards: fallback,
        preferences: input.preferences,
        notice: fallback.length
          ? '暂时无法获取新内容，可以稍后再试或检查联网设置。'
          : '这次没能判断哪些内容值得看。',
        reasonCode: fallback.length ? 'CACHED_FEED' : 'MODEL_SELECTION_EMPTY',
        feedMode: 'personal',
        networking,
      }),
      fallback.length ? 'CACHED_FEED' : 'MODEL_SELECTION_EMPTY',
    );
  }

  await fs.mkdir(path.dirname(input.feedbackFile), { recursive: true });
  for (const row of selected.decisions) {
    await appendNetworkContentFeedback(
      input.feedbackFile,
      createAiJudgmentFeedback({
        subjectId: input.digitalSelf.subjectId,
        contentId: row.itemId,
        action: row.decision === 'show' ? 'SHOW' : 'IGNORE',
      }),
    );
  }
  const byId = new Map(candidates.map((item) => [item.itemId, item]));
  const cards = selected.decisions
    .filter((row) => row.decision === 'show')
    .map((row) => {
      const item = byId.get(row.itemId);
      if (!item) return null;
      const card = cardFromNetworkItem(item, row.reason, 'directory');
      return isConcreteContentCard(card) ? card : null;
    })
    .filter((card): card is DiscoverCard => !!card)
    .slice(0, MAX_FEED);

  if (!cards.length) {
    const fallback = cachedCards.length ? cachedCards : lastCards;
    if (fallback.length) mark('FIRST_CARD_VISIBLE', fallback.length);
    return finish(
      viewOf({
        cards: fallback,
        preferences: input.preferences,
        notice: fallback.length ? noticeFor('CACHED_FEED', true) : '这次没有找到可以直接看的内容。',
        reasonCode: fallback.length ? 'CACHED_FEED' : 'MODEL_SELECTION_EMPTY',
        feedMode: 'personal',
        networking,
      }),
      fallback.length ? 'CACHED_FEED' : 'MODEL_SELECTION_EMPTY',
    );
  }

  const snapshot: FeedSnapshot = {
    itemIds: cards.map((card) => card.itemId),
    generatedAt: now,
    mode: 'personal',
  };
  await writeCache(input.packageRoot, { version: 1, personal: snapshot, lastView: snapshot });
  const reasonCode: FeedReasonCode = replenished ? 'REPLENISHED' : 'CACHED_FEED';
  mark('FIRST_CARD_VISIBLE', cards.length);
  return finish(
    viewOf({
      cards,
      preferences: input.preferences,
      notice: '',
      reasonCode,
      feedMode: 'personal',
      networking,
    }),
    reasonCode,
  );
}

export async function rememberIntentFeed(
  packageRoot: string,
  cards: DiscoverCard[],
  query: string,
  now?: string,
): Promise<void> {
  if (!cards.length) return;
  const cache = await readCache(packageRoot);
  cache.lastView = {
    itemIds: cards.map((card) => card.itemId),
    generatedAt: now || new Date().toISOString(),
    mode: 'intent',
    query,
  };
  await writeCache(packageRoot, cache);
}

export async function readLastFeedQuery(packageRoot: string): Promise<string> {
  const cache = await readCache(packageRoot);
  return String(cache.lastView?.query || '').trim();
}
