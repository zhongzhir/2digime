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
import { isAccessCard, markAccess, pageAccessState, type ExternalSeekHit } from './content-seek';
import {
  classifyCandidateRoles,
  defaultDiscoverIntent,
  interpretDiscoverIntent,
  isPrimaryContentRole,
  isRelatedInfoRole,
  isDomainLikeTitle,
  isGenericHubUrl,
} from './discover-intent';
import { allowsDefaultSupply } from './domestic-source-boundary';
import type { ContentPreferenceDirective } from './content-preferences';
import { isNetworkItemExpired, trustedPublishedMs } from './network-item';
import { completeStructured, type StructuredAttempt } from './structured-call';
import {
  catalogFeedUrls,
  listOpenCatalog,
  networkItemFromOpenHit,
  searchOpenMedia,
  searchOpenWorks,
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
  /** Derived task cache key, not an authoritative goal or profile. */
  selectionContextKey?: string;
  personal?: FeedSnapshot;
  lastView?: FeedSnapshot;
  /** 本轮排序后的完整 id，翻页从这里取，不把 ignore 当成删除。 */
  rankedIds?: string[];
}

const MIN_FEED = 6;
const MAX_FEED = 12;
const STALE_MS = 24 * 60 * 60 * 1000;
const LEAD = '看文章、图片、音频和视频。';

export function personalFeedCachePath(packageRoot: string): string {
  return path.join(packageRoot, 'content', 'personal-feed-cache.json');
}

function emptyCache(): FeedCacheFile {
  return { version: 1 };
}

function rememberShownIds(previous: string[] | undefined, next: string[], append: boolean): string[] {
  if (!append) return next;
  const ids = [...(previous || [])];
  for (const id of next) {
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function mergeDefaultFeed(
  existing: DiscoverCard[],
  incoming: DiscoverCard[],
  prefs: ContentPreferenceDirective[],
): { page: DiscoverCard[]; moreIds: string[] } {
  const validExisting = applyExplicitFeedback(
    existing.filter((card) => card.itemId && isConcreteContentCard(card) && !isAccessCard(card)),
    prefs,
  );
  const seen = new Set<string>();
  const front: DiscoverCard[] = [];
  for (const card of applyExplicitFeedback(
    incoming.filter((card) => card.itemId && isConcreteContentCard(card) && !isAccessCard(card)),
    prefs,
  )) {
    if (seen.has(card.itemId)) continue;
    seen.add(card.itemId);
    front.push(card);
  }
  const oldRest = validExisting.filter((card) => card.itemId && !seen.has(card.itemId));
  if (!front.length) {
    const page = validExisting.slice(0, MAX_FEED);
    return { page, moreIds: validExisting.slice(page.length).map((card) => card.itemId) };
  }
  const pageCap = front.length >= MIN_FEED ? Math.min(front.length, MAX_FEED) : Math.min(MIN_FEED, MAX_FEED);
  const page = front.concat(oldRest).slice(0, pageCap);
  const moreIds: string[] = [];
  for (const card of front.concat(oldRest)) {
    if (page.some((row) => row.itemId === card.itemId)) continue;
    moreIds.push(card.itemId);
  }
  return { page, moreIds };
}

function terminalDefaultNotice(notice: string, replenishing?: boolean): string {
  if (replenishing) return notice;
  return /正在恢复/.test(notice) ? '' : notice;
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
  onAttempt?: (attempt: StructuredAttempt) => void;
}): Promise<DiscoveryIntent[]> {
  const system = [
    '你在为这个人的 2digime 拟定内容发现方向。这不是搜索引擎运营，也不是为了让人刷得更久。',
    '只输出 JSON：{"intents":[{"topic":"","contentTypes":[],"purpose":"","freshness":"current|classic|unspecified","explorationMode":"core|adjacent|explore","searchQuery":""}]}。',
    '2 到 3 条。尽量包含一个核心方向、一个相邻方向、一个探索方向。不要写成固定栏目表。',
    'contentTypes 只允许 article / video / image / audio。在质量允许时，这一批可以包含不同媒介；不要默认三条都只搜文章，也不要写成固定比例。',
    'searchQuery 是发给公开搜索或开放媒体现货目录的最短必要主题词。只写公开主题，不要写成对某个人的描述。优先指向具体作品、节目、攻略或课程，而不是盘点文。video 指向可看的具体视频，image 指向具体图片作品，audio 指向可听的节目，article 指向可读正文。不要指定必须去哪个网站，不要搜十大盘点。',
    '用户这次主动提出的调整优先于历史偏好和近期打开。那是本次要求，不是长期「不喜欢某类内容」。调整已经指向具体内容时，searchQuery 必须能检索到那些对象本身，不要只搜新闻或评论。',
    '不要包含姓名、住址、账号、密钥。不要把完整数字之我、事实列表或偏好向量写进 searchQuery。',
    '除非用户明确搜索过、明确关注或明确写了内容偏好，不要把医疗/疾病、政治立场、宗教、性生活或其他高度敏感事实变成搜索词。',
    '一次性检索不得自动变成默认信息流的长期方向。只有用户明确加推、关注或写了内容偏好，才可以把该主题当作常驻方向。',
    '加推要找相近的新条目，不要只重复已经加推过的那一条。单条不喜欢只针对那一条，不要封禁整个主题。',
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
  // 先关隐藏推理快速要一份；被截断、空正文或解析不出时，保留推理并放大预算再要一次。
  // 模型明确返回空列表是有效答案；两次都拿不到可用结果才返回空，不另造搜索词。
  const outcome = await completeStructured<DiscoveryIntent[]>({
    chat: input.chatComplete,
    request: {
      baseUrl: input.model.baseUrl,
      ...(input.model.apiKey ? { apiKey: input.model.apiKey } : {}),
      model: input.model.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0,
      responseFormat: { type: 'json_object' },
    },
    parse: (text) => {
      const intents = discoveryIntentsFromModelText(text);
      const rec = parseJsonObject(text);
      const explicitEmpty = !!rec && Array.isArray(rec.intents) && rec.intents.length === 0;
      return intents.length || explicitEmpty ? intents : null;
    },
    ...(input.onAttempt ? { onAttempt: input.onAttempt } : {}),
  });
  return outcome.value || [];
}

function viewOf(input: {
  cards: DiscoverCard[];
  relatedCards?: DiscoverCard[];
  unjudgedCards?: DiscoverCard[];
  unjudgedTitle?: string;
  relatedTitle?: string;
  accessCards?: DiscoverCard[];
  preferences: DiscoverPreference[];
  notice: string;
  reasonCode: FeedReasonCode;
  feedMode: 'personal' | 'intent';
  networking: NetworkDiscoveryCode;
  lead?: string;
  replenishing?: boolean;
  supplyTrace?: Array<{ event: string; ms: number; count?: number }>;
  adjustment?: DiscoverView['adjustment'];
  searchQuery?: string;
}): DiscoverView {
  return {
    headline: '发现',
    lead: input.lead || LEAD,
    cards: input.cards,
    relatedCards: input.relatedCards || [],
    ...(input.relatedTitle ? { relatedTitle: input.relatedTitle } : {}),
    ...(input.unjudgedCards?.length
      ? { unjudgedCards: input.unjudgedCards, unjudgedTitle: input.unjudgedTitle || '这些还没完成判断，不是已确认的推荐' }
      : {}),
    ...(input.accessCards?.length ? { accessCards: input.accessCards } : {}),
    preferences: input.preferences,
    notice: input.notice,
    reasonCode: input.reasonCode,
    feedMode: input.feedMode,
    networking: input.networking,
    ...(input.replenishing ? { replenishing: true } : {}),
    ...(input.supplyTrace && input.supplyTrace.length ? { supplyTrace: input.supplyTrace } : {}),
    ...(input.adjustment ? { adjustment: input.adjustment } : {}),
    ...(input.searchQuery ? { searchQuery: input.searchQuery } : {}),
    feedTitle: '为你发现',
  };
}

const RECENT_DEFAULT_MS = 21 * 24 * 60 * 60 * 1000;

/** 只有来源声明了可信发布时间且超出窗口，才算"不是近期"。没有可信日期的内容不在这里被淘汰。图片/音视频是作品，不按新闻时效丢掉。 */
function isRecentDefaultItem(item: NetworkItem, nowIso?: string): boolean {
  const type = String(item.content.contentType || '');
  if (type === 'image' || type === 'video' || type === 'audio') return true;
  if (!nowIso) return true;
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) return true;
  const published = trustedPublishedMs(item, now);
  if (published === undefined) return true;
  return now - published <= RECENT_DEFAULT_MS;
}

/**
 * 候选池的机械排布：有可信发布日期的按发布时间新到旧；没有日期的排在其后，按入库时间新到旧。
 * 这只决定"先把谁放进候选池"，不是推荐排序；挑什么、怎么排由模型决定。
 */
function byTrustedRecency(items: NetworkItem[], nowIso?: string): NetworkItem[] {
  const now = nowIso ? Date.parse(nowIso) : Date.now();
  const nowMs = Number.isFinite(now) ? now : Date.now();
  const keyed = items.map((item) => ({ item, published: trustedPublishedMs(item, nowMs) }));
  keyed.sort((a, b) => {
    if (a.published !== undefined && b.published !== undefined) return b.published - a.published;
    if (a.published !== undefined) return -1;
    if (b.published !== undefined) return 1;
    return b.item.createdAt.localeCompare(a.item.createdAt);
  });
  return keyed.map((row) => row.item);
}

function candidatesForDefault(items: NetworkItem[], nowIso?: string): NetworkItem[] {
  const consumable = items.filter((item) => isConsumableItem(item, nowIso) && isRecentDefaultItem(item, nowIso));
  const inBound = consumable.filter((item) =>
    allowsDefaultSupply({ url: item.content.url, publisher: item.publisherDisplayName }),
  );
  const steady = inBound.filter((item) => item.provenance?.via !== 'search');
  return byTrustedRecency(steady.length ? steady : inBound, nowIso);
}

export function isAccessNetworkItem(item: NetworkItem): boolean {
  return pageAccessState({ title: item.content.title, text: item.content.text }) !== 'ok';
}

function isConsumableItem(item: NetworkItem, nowIso?: string): boolean {
  if (nowIso && isNetworkItemExpired(item, nowIso)) return false;
  if (!String(item.content.title || '').trim()) return false;
  if (isDomainLikeTitle(item.content.title, item.content.url)) return false;
  if (item.content.url && isGenericHubUrl(item.content.url)) return false;
  if (isAccessNetworkItem(item)) return false;
  const access = String(item.content.access || '');
  if (access && access !== 'open' && access !== 'public' && access !== 'available') {
    if (/restricted|paywall|login|unavailable/i.test(access)) return false;
  }
  return true;
}

function withCandidateHonesty(card: DiscoverCard, confirmed: boolean): DiscoverCard {
  const marked = markAccess(card);
  if (isAccessCard(marked)) return marked;
  if (confirmed) return marked;
  return {
    ...marked,
    textOrigin: marked.textOrigin || 'snippet',
    conditionStatus: marked.conditionStatus || 'unconfirmed',
    conditionNote: marked.conditionNote || '价格、课时、平台等条件未核实',
    objectKind: marked.objectKind || marked.contentType || 'article',
    entrancePurpose: marked.entrancePurpose || '去原站打开',
  };
}

function splitAccessCards(cards: DiscoverCard[]): { visible: DiscoverCard[]; access: DiscoverCard[] } {
  const visible: DiscoverCard[] = [];
  const access: DiscoverCard[] = [];
  for (const card of cards) {
    if (isAccessCard(card)) access.push(card);
    else visible.push(card);
  }
  return { visible, access };
}

function honestyFromJudgment(
  card: DiscoverCard,
  judgment?: { conditions?: string; medium?: string; entrance?: string; channel?: string; basis?: string },
): DiscoverCard {
  const marked = withCandidateHonesty(card, false);
  if (isAccessCard(marked)) return marked;
  const conditions =
    judgment?.conditions === 'met' ||
    judgment?.conditions === 'unconfirmed' ||
    judgment?.conditions === 'unmet'
      ? judgment.conditions
      : marked.conditionStatus || 'unconfirmed';
  const conditionNote =
    conditions === 'unconfirmed'
      ? judgment?.basis
        ? `未核实：${judgment.basis}`
        : marked.conditionNote
      : conditions === 'unmet'
        ? judgment?.basis
          ? `不完全符合：${judgment.basis}`
          : '来源写明的类型或风格和这次要的不一致。'
        : marked.conditionNote;
  return {
    ...marked,
    conditionStatus: conditions,
    objectKind: (judgment?.medium && judgment.medium !== 'unknown' ? judgment.medium : marked.objectKind) || marked.contentType || 'article',
    ...(conditionNote ? { conditionNote } : {}),
    ...(judgment?.channel === 'watch' || judgment?.channel === 'discover' || judgment?.channel === 'supplement'
      ? { channelUse: judgment.channel as 'watch' | 'discover' | 'supplement' }
      : {}),
    ...(judgment?.channel === 'supplement'
      ? { entrancePurpose: '补充入口，去原站打开；国内官方观看页未核实' }
      : judgment?.channel === 'discover'
        ? { entrancePurpose: '发现依据，不是观看入口' }
        : judgment?.entrance === 'excerpt'
          ? {
              excerpt: true,
              entrancePurpose: '部分匹配：去原站打开片段入口，不是完整节目',
              ...(judgment?.conditions === 'unmet' || judgment?.conditions === 'unconfirmed'
                ? {}
                : { conditionNote: marked.conditionNote || '部分匹配：当前页是片段，不是完整节目。' }),
            }
          : {}),
    ...(judgment?.basis && !marked.reason.includes('未核实') ? { reason: judgment.basis } : {}),
  };
}

async function matchSteeredObjects(input: {
  items: NetworkItem[];
  query: string;
  prefs: ContentPreferenceDirective[];
  now: string;
  chatComplete?: ChatCompleteFn;
  model?: { baseUrl: string; model: string; apiKey?: string };
}): Promise<{ cards: DiscoverCard[]; relatedCards: DiscoverCard[]; accessCards: DiscoverCard[] }> {
  const accessCards: DiscoverCard[] = [];
  const concrete: Array<{ item: NetworkItem; card: DiscoverCard }> = [];
  for (const item of input.items) {
    if (blocked(item, input.prefs)) continue;
    const raw = cardFromNetworkItem(
      item,
      '来源给出了标题和摘要。价格、课时、平台等条件未核实。还没有标成已确认。',
      item.provenance?.via === 'search' ? 'web' : 'directory',
    );
    const card = withCandidateHonesty(raw, false);
    if (isAccessCard(card) || isAccessNetworkItem(item)) {
      accessCards.push(isAccessCard(card) ? card : markAccess(card));
      continue;
    }
    if (!isConcreteContentCard(card)) continue;
    concrete.push({ item, card });
  }
  if (!concrete.length) return { cards: [], relatedCards: [], accessCards };
  if (!input.chatComplete || !input.model) {
    return { cards: concrete.map((row) => row.card).slice(0, MAX_FEED), relatedCards: [], accessCards };
  }
  const judged = await classifyCandidateRoles({
    query: input.query,
    intent: {
      ...defaultDiscoverIntent(input.query),
      objectWanted: 'work_itself',
      preferences: input.query,
    },
    candidates: concrete.map(({ card }) => ({
      id: card.itemId,
      title: card.title,
      url: card.url || '',
      summary: card.text || '',
      ...(card.contentType ? { contentType: card.contentType } : {}),
    })),
    chatComplete: input.chatComplete,
    model: input.model,
  });
  const cards: DiscoverCard[] = [];
  const relatedCards: DiscoverCard[] = [];
  for (const { card } of concrete) {
    if (judged.unjudgedIds.includes(card.itemId)) continue;
    const role = judged.roles.get(card.itemId);
    const judgment = judged.judgments.get(card.itemId);
    const honest = honestyFromJudgment(card, judgment);
    if (!role || role === 'UNRELATED' || role === 'HUB') continue;
    if (isPrimaryContentRole(role) && judgment?.conditions !== 'unmet') {
      cards.push({
        ...honest,
        ...(judgment?.conditions === 'unconfirmed' ? {} : { objectFidelity: 'PRIMARY_CONTENT' as const }),
      });
    } else if (isRelatedInfoRole(role) || (isPrimaryContentRole(role) && judgment?.conditions === 'unmet')) {
      relatedCards.push({ ...honest, objectFidelity: 'ABOUT_CONTENT' });
    }
  }
  return {
    cards: cards.slice(0, MAX_FEED),
    relatedCards: relatedCards.slice(0, 8),
    accessCards,
  };
}

function firstWaveCards(items: NetworkItem[], prefs: ContentPreferenceDirective[], nowIso?: string): {
  cards: DiscoverCard[];
  relatedCards: DiscoverCard[];
  accessCards: DiscoverCard[];
} {
  const cards: DiscoverCard[] = [];
  const accessCards: DiscoverCard[] = [];
  for (const item of items) {
    if (blocked(item, prefs)) continue;
    const accessItem = isAccessNetworkItem(item);
    if (!accessItem && !isConsumableItem(item, nowIso)) continue;
    const card = withCandidateHonesty(
      cardFromNetworkItem(
        item,
        '来源给出了标题和摘要。价格、课时、平台等条件未核实。还没有标成已确认。',
        item.provenance?.via === 'search' ? 'web' : 'directory',
      ),
      false,
    );
    if (isAccessCard(card) || accessItem) {
      accessCards.push(isAccessCard(card) ? card : markAccess({ ...card, title: item.content.title, text: item.content.text, reason: card.reason }));
      continue;
    }
    if (!isConcreteContentCard(card)) continue;
    cards.push(card);
    if (cards.length >= MAX_FEED) break;
  }
  return { cards, relatedCards: [], accessCards };
}

function applyExplicitFeedback(cards: DiscoverCard[], prefs: ContentPreferenceDirective[]): DiscoverCard[] {
  const blockedSources = new Set(
    prefs.filter((row) => row.kind === 'block' && row.targetType === 'source').map((row) => row.target),
  );
  const blockedItems = new Set(
    prefs.filter((row) => row.kind === 'block' && row.targetType === 'item').map((row) => row.target),
  );
  const reduced = new Set(
    prefs.filter((row) => row.kind === 'reduce' && row.targetType === 'item').map((row) => row.target),
  );
  const kept = cards.filter(
    (card) =>
      !blockedItems.has(card.itemId) && !(card.publisherSubjectId && blockedSources.has(card.publisherSubjectId)),
  );
  return [
    ...kept.filter((card) => !reduced.has(card.itemId)),
    ...kept.filter((card) => reduced.has(card.itemId)),
  ];
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
  prefs: ContentPreferenceDirective[] = [],
): Promise<DiscoverCard[]> {
  if (!ids?.length) return [];
  const byId = new Map(items.map((item) => [item.itemId, item]));
  const hasSteadyFeed = items.some((row) => row.provenance?.via !== 'search' && isConsumableItem(row, nowIso));
  const cards: DiscoverCard[] = [];
  for (const id of ids) {
    const item = byId.get(id) || (getItem ? await getItem(id) : undefined);
    if (!item || blocked(item, prefs) || (hasSteadyFeed && item.provenance?.via === 'search') || !isConsumableItem(item, nowIso)) continue;
    const card = cardFromNetworkItem(item, '继续看你这边已经挑出的内容。', 'directory');
    if (isConcreteContentCard(card)) cards.push(card);
  }
  return applyExplicitFeedback(cards, prefs);
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
  ingestHit?: (hit: ExternalSeekHit) => Promise<NetworkItem[]>;
  networking: NetworkDiscoveryCode;
}): boolean {
  return !!(
    input.networking !== 'DISABLED' &&
    (input.fetchOpenMedia || input.ingestHit)
  );
}

function canReplenishSupply(input: {
  searchWeb?: (query: string) => Promise<ExternalSeekHit[]>;
  fetchOpenMedia?: OpenMediaFetch;
  ingestHit?: (hit: ExternalSeekHit) => Promise<NetworkItem[]>;
  chatComplete?: ChatCompleteFn;
  model?: { baseUrl: string; model: string; apiKey?: string };
  networking: NetworkDiscoveryCode;
}): boolean {
  return canSearch(input) || canFetchOpenCatalog(input);
}

async function ingestCatalogFeeds(input: {
  ingestHit?: (hit: ExternalSeekHit) => Promise<NetworkItem[]>;
  networking: NetworkDiscoveryCode;
}): Promise<boolean> {
  if (!input.ingestHit || input.networking === 'DISABLED') return false;
  let replenished = false;
  await Promise.all(
    catalogFeedUrls(['article', 'video', 'audio', 'image']).map(async (feedUrl) => {
      try {
        const ingested = await input.ingestHit!({ title: 'open catalog', url: feedUrl });
        if (ingested.length) replenished = true;
      } catch {
        /* 单条目录失败不挡住其它目录 */
      }
    }),
  );
  return replenished;
}

async function ingestOpenCatalogMedia(input: {
  fetchOpenMedia?: OpenMediaFetch;
  putNetworkItem?: (item: NetworkItem) => Promise<void>;
  networking: NetworkDiscoveryCode;
  now: string;
}): Promise<boolean> {
  if (!input.fetchOpenMedia || input.networking === 'DISABLED') return false;
  let filled = false;
  try {
    const media = await listOpenCatalog({
      kinds: ['video', 'image', 'audio'],
      fetchImpl: input.fetchOpenMedia,
    });
    const works = await searchOpenWorks({ fetchImpl: input.fetchOpenMedia });
    const hits = interleaveHits(media, works).slice(0, 16);
    for (const hit of hits) {
      const item = networkItemFromOpenHit(hit, input.now, 'feed');
      if (!item) continue;
      if (input.putNetworkItem) {
        try {
          await input.putNetworkItem(item);
          filled = true;
        } catch {
          /* 单条媒介入库失败不挡住其它条目 */
        }
      } else {
        filled = true;
      }
    }
  } catch {
    /* 开放目录失败不挡住 RSS */
  }
  return filled;
}

function cacheFresh(snapshot: FeedSnapshot | undefined, nowMs: number): boolean {
  if (!snapshot?.generatedAt) return false;
  const at = Date.parse(snapshot.generatedAt);
  return Number.isFinite(at) && nowMs - at <= STALE_MS;
}

function repeatedWork(items: NetworkItem[]): boolean {
  if (items.length < 3) return false;
  const stems = items.map((item) => {
    const title = String(item.content.title || '').replace(/\s+/g, ' ').trim();
    const stem = title.replace(/(?:第\s*)?\d+\s*(?:章|节|回|话|集|期).*$/u, '').trim();
    return stem.length >= 2 && stem.length < title.length ? stem : '';
  });
  const stem = stems[0] || '';
  return stem.length > 0 && stems.every((row) => row === stem);
}

function hostOf(url?: string): string {
  try {
    return new URL(String(url || '')).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** 已取到的作品/媒介种类。按目录身份和 contentType，不是主题分类器。 */
export function presentationKind(item: NetworkItem): string {
  const type = String(item.content.contentType || 'article');
  if (type === 'video' || type === 'image' || type === 'audio') return type;
  const host = hostOf(item.content.url);
  if (host === 'bgm.tv' || host === 'bangumi.tv' || host.endsWith('steampowered.com')) return 'work';
  if (host === 'zh.wikivoyage.org') return 'guide';
  return type || 'article';
}

/**
 * 候选窗：先按来源轮转，再让已经取到、但还没进窗的作品/媒介有机会被模型看见。
 * 不是类型配额，也不为凑数塞无关条目。
 */
export function presentableFeedCandidates(items: NetworkItem[], limit = 24, perSource = 2): NetworkItem[] {
  const rotated = diverseFeedCandidates(items, limit, perSource);
  const kindsInPool = new Set(items.map(presentationKind));
  const kindsInWindow = new Set(rotated.map(presentationKind));
  const missing = [...kindsInPool].filter((kind) => kind !== 'article' && !kindsInWindow.has(kind));
  if (!missing.length) return rotated;
  const used = new Set(rotated.map((item) => item.itemId));
  const extras: NetworkItem[] = [];
  for (const kind of missing) {
    const found = items.find((item) => presentationKind(item) === kind && !used.has(item.itemId));
    if (!found) continue;
    extras.push(found);
    used.add(found.itemId);
  }
  if (!extras.length) return rotated;
  const out = rotated.slice();
  for (const extra of extras) {
    let replaceAt = -1;
    for (let i = out.length - 1; i >= 0; i -= 1) {
      if (presentationKind(out[i]!) === 'article') {
        replaceAt = i;
        break;
      }
    }
    if (replaceAt >= 0) out[replaceAt] = extra;
    else if (out.length < limit) out.push(extra);
  }
  return out;
}

/** 本轮按理解发出的检索结果必须进排序窗，不能被已有新闻池挤掉。 */
export function seatThisTurnItems(
  window: NetworkItem[],
  fresh: NetworkItem[],
  limit = 24,
  maxFresh = 8,
): NetworkItem[] {
  const extras: NetworkItem[] = [];
  const seen = new Set<string>();
  for (const item of fresh) {
    if (seen.has(item.itemId)) continue;
    if (isAccessNetworkItem(item)) continue;
    seen.add(item.itemId);
    extras.push(item);
    if (extras.length >= maxFresh) break;
  }
  if (!extras.length) return window;
  const extraIds = new Set(extras.map((item) => item.itemId));
  return [...extras, ...window.filter((item) => !extraIds.has(item.itemId))].slice(0, limit);
}

function interleaveHits<T>(left: T[], right: T[]): T[] {
  const out: T[] = [];
  const n = Math.max(left.length, right.length);
  for (let i = 0; i < n; i += 1) {
    if (i < left.length) out.push(left[i]!);
    if (i < right.length) out.push(right[i]!);
  }
  return out;
}

/** 默认信息流轮流取不同来源。同一作品的重复章节在还有其它来源时最多占几条；不同文章不按来源名额裁掉。只有一个来源时仍可看完已取到的内容。明确点播走检索，不走这里。 */
export function diverseFeedCandidates(items: NetworkItem[], limit = 24, perSource = 2): NetworkItem[] {
  const groups: NetworkItem[][] = [];
  const index = new Map<string, number>();
  for (const item of items) {
    const key = item.publisherSubjectId || item.itemId;
    let at = index.get(key);
    if (at === undefined) {
      at = groups.length;
      index.set(key, at);
      groups.push([]);
    }
    groups[at]!.push(item);
  }
  const capped = groups.map((group) => groups.length > 1 && repeatedWork(group));
  const out: NetworkItem[] = [];
  const cursors = groups.map(() => 0);
  while (out.length < limit) {
    let added = false;
    for (let i = 0; i < groups.length; i += 1) {
      const cursor = cursors[i] || 0;
      if (capped[i] && cursor >= perSource) continue;
      const item = groups[i]?.[cursor];
      if (!item) continue;
      cursors[i] = cursor + 1;
      out.push(item);
      added = true;
      if (out.length >= limit) break;
    }
    if (!added) break;
  }
  return out;
}

export async function ensurePersonalFeed(input: {
  packageRoot: string;
  selectionContextKey?: string;
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
  mode: 'open' | 'refresh' | 'reuse' | 'replenish' | 'more' | 'reset';
  /** catalog：只并行取公开目录。seated：检索后先交付有依据的候选。rank：只排序，不再检索。 */
  supplyPhase?: 'catalog' | 'full' | 'seated' | 'rank';
  /** 撤销时只读默认流缓存，不读调整后的 lastView。 */
  preferPersonalCache?: boolean;
  /** 代次已切换时不得回写缓存。 */
  isCurrentGeneration?: () => boolean;
  now?: string;
  adjustment?: DiscoverView['adjustment'];
}): Promise<{ view: DiscoverView; reasonCode: FeedReasonCode }> {
  const now = input.now || new Date().toISOString();
  const nowMs = Date.parse(now) || Date.now();
  const startedAt = Date.now();
  const supplyTrace: Array<{ event: string; ms: number; count?: number }> = [];
  const mark = (event: string, count?: number) => {
    supplyTrace.push(count === undefined ? { event, ms: Date.now() - startedAt } : { event, ms: Date.now() - startedAt, count });
  };
  let steeredQueries: string[] = [];
  const persistCache = async (file: FeedCacheFile) => {
    if (input.isCurrentGeneration && !input.isCurrentGeneration()) return;
    await writeCache(input.packageRoot, {...file, selectionContextKey: input.selectionContextKey || ''});
  };
  const prefs = input.preferenceRows || [];
  const recent = input.recentEvents || [];
  const cache = await readCache(input.packageRoot);
  if (!input.preferPersonalCache && (cache.selectionContextKey || '') !== (input.selectionContextKey || '')) {
    // Discard only the previous task's projection; default personal cache stays
    // available for revoke/session switch. Rejudge once when the task changes.
    delete cache.lastView;
    delete cache.rankedIds;
    if (input.selectionContextKey) input = {...input, mode:'reset'};
  } else if (input.selectionContextKey && input.mode === 'open' && cache.lastView?.itemIds.length) {
    input = {...input, mode:'reuse'};
  }
  if (input.mode === 'more' && cache.rankedIds?.length) {
    const delivered = new Set(cache.lastView?.itemIds || []);
    const nextIds = cache.rankedIds.filter((id) => !delivered.has(id));
    const nextCards = (await resolveCards(nextIds, input.items, input.getItem, now, prefs)).slice(0, MAX_FEED);
    if (nextCards.length) {
      const merged = [...(cache.lastView?.itemIds || [])];
      for (const id of nextCards.map((card) => card.itemId)) {
        if (!merged.includes(id)) merged.push(id);
      }
      cache.lastView = { itemIds: merged, generatedAt: now, mode: 'personal' };
      cache.rankedIds = cache.rankedIds.filter((id) => {
        const item = input.items.find((row) => row.itemId === id);
        return !item || !blocked(item, prefs);
      });
      await persistCache(cache);
      mark('FIRST_CARD_VISIBLE', nextCards.length);
      return {
        view: viewOf({
          cards: nextCards,
          preferences: input.preferences,
          notice: '',
          reasonCode: 'CACHED_FEED',
          feedMode: 'personal',
          networking: input.networking,
          supplyTrace,
        }),
        reasonCode: 'CACHED_FEED',
      };
    }
  }
  const cachedCards = await resolveCards(cache.personal?.itemIds, input.items, input.getItem, now, prefs);
  const lastCards = await resolveCards(cache.lastView?.itemIds, input.items, input.getItem, now, prefs);
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
  const previousShown = [...(cache.lastView?.itemIds || [])];
  let supplement: 'idle' | 'no_model' | 'no_query' | 'called' | 'called_empty' | 'failed' = 'idle';
  const finish = (view: DiscoverView, reasonCode: FeedReasonCode) => {
    const cards = applyExplicitFeedback(view.cards, prefs);
    const sameAsShown =
      input.mode === 'refresh' &&
      previousShown.length > 0 &&
      cards.length > 0 &&
      previousShown.length === cards.length &&
      previousShown.every((id) => cards.some((card) => card.itemId === id));
    const sameBatchNotice =
      supplement === 'no_query'
        ? '这次没有形成补充搜索，所以没有换出新内容。'
        : supplement === 'no_model'
          ? '这次没有可用的模型来形成补充搜索，所以没有换出新内容。'
          : supplement === 'called_empty'
            ? '补充搜索已经发出，没有返回新的内容。'
            : supplement === 'failed'
              ? '补充搜索没有完成，可以稍后再试。'
              : supplement === 'called'
                ? '补充搜索有返回，但没有换成不同的内容。'
                : '这次没有换出不同的内容。';
    const traced = viewOf({
      cards,
      relatedCards: view.relatedCards || [],
      ...(view.unjudgedCards?.length
        ? { unjudgedCards: view.unjudgedCards, ...(view.unjudgedTitle ? { unjudgedTitle: view.unjudgedTitle } : {}) }
        : {}),
      ...(view.accessCards?.length ? { accessCards: view.accessCards } : {}),
      ...(view.relatedTitle ? { relatedTitle: view.relatedTitle } : {}),
      preferences: view.preferences,
      notice: terminalDefaultNotice(
        sameAsShown && !String(view.notice || '').trim() ? sameBatchNotice : String(view.notice || ''),
        view.replenishing,
      ),
      reasonCode,
      feedMode: view.feedMode || 'personal',
      networking: (view.networking as NetworkDiscoveryCode) || networking,
      ...(view.lead ? { lead: view.lead } : {}),
      ...(view.replenishing ? { replenishing: true } : {}),
      ...(input.adjustment ? { adjustment: input.adjustment } : {}),
      supplyTrace,
      ...(steeredQueries.length ? { searchQuery: steeredQueries.join(' | ') } : {}),
    });
    return { view: traced, reasonCode };
  };

  if (input.mode === 'reuse') {
    const cards = input.preferPersonalCache ? cachedCards : lastCards.length ? lastCards : cachedCards;
    if (cards.length) {
      mark('LOCAL_FEED_READ', cards.length);
      mark('FIRST_CARD_VISIBLE', cards.length);
      return finish(
        viewOf({
          cards,
          preferences: input.preferences,
          notice: input.preferPersonalCache ? '已撤销这次调整，正在恢复默认推荐。' : noticeFor('CACHED_FEED', true),
          reasonCode: 'CACHED_FEED',
          feedMode: 'personal',
          networking: input.networking,
          ...(input.preferPersonalCache ? { replenishing: true } : {}),
        }),
        'CACHED_FEED',
      );
    }
    if (input.preferPersonalCache) {
      mark('FIRST_CARD_VISIBLE', 0);
      return finish(
        viewOf({
          cards: [],
          preferences: input.preferences,
          notice: '正在恢复默认推荐。',
          reasonCode: 'DIRECTORY_EMPTY',
          feedMode: 'personal',
          networking: input.networking,
          replenishing: true,
        }),
        'DIRECTORY_EMPTY',
      );
    }
  }

  if (input.mode === 'open') {
    mark('OPEN_DISCOVER');
    mark('LOCAL_FEED_READ', cachedCards.length);
    const localFromCache = cachedCards.length ? applyExplicitFeedback(cachedCards, prefs).slice(0, MAX_FEED) : [];
    // 缓存太少（少于一屏的最低数量）时，用目录里的候选补足；不让两三张旧卡片单独充当"今天的推荐"。
    const cachedIds = new Set(localFromCache.map((card) => card.itemId));
    const topUpNeeded = localFromCache.length < MIN_FEED;
    const localFromDirectory = topUpNeeded
      ? directoryCards(
          presentableFeedCandidates(
            candidatesForDefault(input.items, now).filter(
              (item) => !blocked(item, prefs) && !cachedIds.has(item.itemId),
            ),
            MAX_FEED,
            2,
          ),
          prefs,
          MAX_FEED - localFromCache.length,
          now,
        )
      : [];
    mark('DIRECTORY_READ', localFromDirectory.length || input.items.filter((item) => isConsumableItem(item, now)).length);
    let localCards = [...localFromCache, ...localFromDirectory].slice(0, MAX_FEED);
    let catalogFilled = false;
    if (!localCards.length && canFetchOpenCatalog({ ...input, networking })) {
      mark('CATALOG_START');
      const feedsFilled = await ingestCatalogFeeds({ ...input, networking });
      const mediaFilled = await ingestOpenCatalogMedia({ ...input, networking, now });
      catalogFilled = feedsFilled || mediaFilled;
      const reloaded = input.reloadItems
        ? candidatesForDefault(await input.reloadItems(), now).filter((item) => !blocked(item, prefs))
        : candidatesForDefault(input.items, now).filter((item) => !blocked(item, prefs));
      localCards = directoryCards(presentableFeedCandidates(reloaded, MAX_FEED, 2), prefs, MAX_FEED, now);
      mark('DIRECTORY_READ', localCards.length);
    }
    const fresh =
      localFromCache.length >= MIN_FEED ? cacheFresh(cache.personal, nowMs) : localCards.length >= MIN_FEED;
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
      await persistCache(cache);
      mark('FIRST_CARD_VISIBLE', localCards.length);
      return finish(
        viewOf({
          cards: localCards,
          preferences: input.preferences,
          notice: '',
          reasonCode: localFromCache.length ? 'CACHED_FEED' : catalogFilled ? 'REPLENISHED' : 'LOCAL_DIRECTORY',
          feedMode: 'personal',
          networking,
          replenishing,
        }),
        localFromCache.length ? 'CACHED_FEED' : catalogFilled ? 'REPLENISHED' : 'LOCAL_DIRECTORY',
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
  let items = candidatesForDefault(input.items, now).filter((item) => !blocked(item, prefs));
  const shown = new Set(
    input.mode === 'refresh' || input.mode === 'more'
      ? cache.lastView?.itemIds || cache.personal?.itemIds || []
      : [],
  );
  const opened = new Set(openedItemIds(recent));
  const boostedExact = new Set(
    prefs.filter((row) => row.kind === 'boost' && row.targetType === 'item').map((row) => row.target),
  );
  const unseen = items.filter((item) => !shown.has(item.itemId) && !opened.has(item.itemId));
  const diverseReady = presentableFeedCandidates(unseen, MIN_FEED, 2).length;
  const needReplenish =
    input.supplyPhase === 'rank'
      ? false
      : input.mode === 'refresh' || input.mode === 'reset'
        ? true
        : input.mode === 'more'
          ? diverseReady < MIN_FEED
          : input.mode === 'replenish'
            ? diverseReady < MIN_FEED || !cacheFresh(cache.personal, nowMs)
            : diverseReady < MIN_FEED;
  let replenished = false;
  let searchAttempted = false;
  const steered = !!input.adjustment;
  const restoreDefault = !steered && (input.mode === 'reset' || input.mode === 'replenish');
  const pageForDefault = (incoming: DiscoverCard[]) =>
    restoreDefault
      ? mergeDefaultFeed(cachedCards, incoming, prefs)
      : { page: incoming.slice(0, MAX_FEED), moreIds: incoming.slice(MAX_FEED).map((card) => card.itemId) };
  const freshSearchItems: NetworkItem[] = [];
  const freshAccessItems: NetworkItem[] = [];
  const rememberFresh = (item: NetworkItem | undefined) => {
    if (!item) return;
    if (isAccessNetworkItem(item)) {
      if (!freshAccessItems.some((row) => row.itemId === item.itemId)) freshAccessItems.push(item);
      return;
    }
    if (!isConsumableItem(item, now)) return;
    if (freshSearchItems.some((row) => row.itemId === item.itemId)) return;
    freshSearchItems.push(item);
  };

  if (input.mode === 'replenish' && input.supplyPhase === 'catalog') {
    mark('CATALOG_START');
    if (await ingestCatalogFeeds({ ...input, networking })) replenished = true;
    if (input.reloadItems) {
      items = candidatesForDefault(await input.reloadItems(), now).filter((item) => !blocked(item, prefs));
    }
    const cards = directoryCards(
      presentableFeedCandidates(
        items.filter((item) => !shown.has(item.itemId)),
        MAX_FEED,
        2,
      ),
      prefs,
      MAX_FEED,
      now,
    );
    mark('FIRST_CARD_VISIBLE', cards.length);
    return finish(
      viewOf({
        cards,
        preferences: input.preferences,
        notice: cards.length ? '这些是刚取到的公开来源。正在按你的情况继续挑。' : '',
        reasonCode: cards.length ? 'REPLENISHED' : 'DIRECTORY_EMPTY',
        feedMode: 'personal',
        networking,
        replenishing: true,
      }),
      cards.length ? 'REPLENISHED' : 'DIRECTORY_EMPTY',
    );
  }

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
      const item = networkItemFromOpenHit(hit, now, 'feed');
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
    const intentPromise =
      ranked && input.chatComplete && input.model && !steered
        ? proposeDiscoveryIntents({
            selfContext: formatSelfContext(selectSelfContext(input.digitalSelf, '')),
            chatComplete: input.chatComplete,
            model: input.model,
            now,
            ...(input.preferenceDirectives ? { preferenceDirectives: input.preferenceDirectives } : {}),
            ...(formatRecentRecommendationContext(recent, { includeOneOffSeeks: false })
              ? { recentContext: formatRecentRecommendationContext(recent, { includeOneOffSeeks: false }) }
              : {}),
          })
        : Promise.resolve([]);
    if (!steered && input.fetchOpenMedia && input.ingestHit) {
      await Promise.all(
        catalogFeedUrls(['article', 'video', 'audio', 'image']).map(async (feedUrl) => {
          try {
            const ingested = await input.ingestHit!({ title: 'open catalog', url: feedUrl });
            if (ingested.length) replenished = true;
          } catch {
            /* 目录 feed 失败不阻断 */
          }
        }),
      );
    }
    if (ranked && input.chatComplete && input.model) {
      if (steered && input.adjustment?.text) {
        try {
          const intent = await interpretDiscoverIntent({
            query: input.adjustment.text,
            chatComplete: input.chatComplete,
            model: input.model,
          });
          queries = intent.searchQueries.filter(Boolean);
          steeredQueries = queries.slice();
          intents = queries.map((searchQuery) => ({
            topic: intent.topic || searchQuery,
            contentTypes: intent.requestedMedia || [],
            purpose: 'learn',
            freshness: intent.freshness || 'unspecified',
            explorationMode: 'core' as const,
            searchQuery,
          }));
        } catch {
          queries = [];
          intents = [];
        }
        if (!queries.length) {
          const fallbackQuery = input.adjustment.text.trim().slice(0, 120);
          queries = [fallbackQuery];
          steeredQueries = queries.slice();
          intents = [
            {
              topic: fallbackQuery,
              contentTypes: [],
              purpose: 'learn',
              freshness: 'unspecified',
              explorationMode: 'core',
              searchQuery: fallbackQuery,
            },
          ];
        }
        mark('INTENT_QUERIES', queries.length);
      } else {
        intents = await intentPromise;
        queries = intents.map((row) => row.searchQuery).filter(Boolean);
        mark('INTENT_QUERIES', queries.length);
        if (!queries.length) supplement = 'no_query';
      }
    } else if (needReplenish) {
      supplement = 'no_model';
      mark('INTENT_QUERIES', 0);
    }
    if (input.fetchOpenMedia && !steered) {
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
            await acceptOpenHits(
              await searchOpenWorks({
                query: row.searchQuery || topic,
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
          await acceptOpenHits(await searchOpenWorks({ fetchImpl: input.fetchOpenMedia }));
        } catch {
          /* 开放目录失败不阻断 RSS */
        }
      }
    }
    if (input.reloadItems) items = candidatesForDefault(await input.reloadItems(), now).filter((item) => !blocked(item, prefs));
    const stillShort = items.filter((item) => !shown.has(item.itemId) && !opened.has(item.itemId)).length < MIN_FEED;
    let searchRaw = 0;
    const shouldSearch =
      stillShort ||
      input.mode === 'refresh' ||
      input.mode === 'more' ||
      input.mode === 'reset' ||
      !!input.adjustment;
    if (ranked && input.searchWeb && shouldSearch) {
      const planned = queries.slice(0, 2);
      searchAttempted = planned.length > 0;
      const searched = await Promise.all(
        planned.map(async (query) => {
          try {
            const hits = (await input.searchWeb!(query)).filter((hit) => allowsDefaultSupply({ url: hit.url }));
            return { hits, error: null as unknown };
          } catch (err) {
            return { hits: [] as ExternalSeekHit[], error: err };
          }
        }),
      );
      for (const row of searched) {
        if (row.error) {
          networking = classifySearchFailure(row.error);
          supplement = 'failed';
          break;
        }
        searchRaw += row.hits.length;
        if (row.hits.length) replenished = true;
        if (input.ingestHit) {
          await Promise.all(
            row.hits.slice(0, 6).map(async (hit) => {
              try {
                const ingested = await input.ingestHit!(hit);
                for (const item of ingested || []) rememberFresh(item);
              } catch {
                /* 单条摄入失败不阻断补量 */
              }
            }),
          );
        }
      }
      if (searchAttempted && supplement !== 'failed') {
        supplement = searchRaw > 0 ? 'called' : 'called_empty';
      }
    }
    if (searchAttempted) mark('SEARCH_RAW', searchRaw);
    mark('SEARCH_DONE', searchAttempted ? 1 : 0);
    if (input.reloadItems) items = candidatesForDefault(await input.reloadItems(), now).filter((item) => !blocked(item, prefs));
    else items = candidatesForDefault(items, now).filter((item) => !blocked(item, prefs));
    mark('NORMALIZE_DONE', items.length);
  }

  const pool = items.filter((item) => {
    if (shown.has(item.itemId)) return false;
    return true;
  });
  const alreadySeen = new Set([...opened, ...boostedExact]);
  const notYetOpened = pool.filter((item) => !alreadySeen.has(item.itemId));
  const openedAgain = pool.filter((item) => alreadySeen.has(item.itemId));
  const rankedPool = notYetOpened.length >= 3 ? notYetOpened : [...notYetOpened, ...openedAgain];
  const freshIds = new Set(freshSearchItems.map((item) => item.itemId));
  const freshInPool = rankedPool.filter((item) => freshIds.has(item.itemId));
  const freshMissing = freshSearchItems.filter((item) => !rankedPool.some((row) => row.itemId === item.itemId));
  let candidates = seatThisTurnItems(
    presentableFeedCandidates(rankedPool.filter((item) => !isAccessNetworkItem(item)), 24, 2),
    [...freshInPool, ...freshMissing],
    24,
    8,
  );
  if (input.supplyPhase === 'rank') {
    const ids = cache.rankedIds?.length ? cache.rankedIds : cache.lastView?.itemIds || [];
    const byId = new Map(items.map((item) => [item.itemId, item]));
    const seated: NetworkItem[] = [];
    for (const id of ids) {
      let item = byId.get(id);
      if (!item && input.getItem) item = await input.getItem(id);
      if (!item || blocked(item, prefs) || isAccessNetworkItem(item)) continue;
      seated.push(item);
    }
    if (seated.length) candidates = seated.slice(0, 24);
  }
  mark('CANDIDATES', candidates.length);
  const accessFromFresh = firstWaveCards(freshAccessItems, prefs, now).accessCards;
  const unusedIds = (page: DiscoverCard[], pool: NetworkItem[] = candidates) =>
    pool
      .filter(
        (item) =>
          !blocked(item, prefs) &&
          isConsumableItem(item, now) &&
          !page.some((card) => card.itemId === item.itemId),
      )
      .map((item) => item.itemId);

  if (input.supplyPhase === 'seated' && (candidates.length || accessFromFresh.length || freshSearchItems.length)) {
    const waveItems = freshSearchItems.length ? freshSearchItems : candidates;
    const matched = steered
      ? await matchSteeredObjects({
          items: waveItems,
          query: String(input.adjustment?.text || input.adjustment?.summary || ''),
          prefs,
          now,
          ...(input.chatComplete ? { chatComplete: input.chatComplete } : {}),
          ...(input.model ? { model: input.model } : {}),
        })
      : firstWaveCards(waveItems, prefs, now);
    const accessCards = [...(matched.accessCards || []), ...accessFromFresh].slice(0, 8);
    const page = matched.cards.slice(0, MAX_FEED);
    const relatedCards = 'relatedCards' in matched ? matched.relatedCards : [];
    const nearby = relatedCards.some((card) => card.conditionStatus === 'unmet');
    if (page.length || relatedCards.length) {
      const snapshot: FeedSnapshot = {
        itemIds: page.map((card) => card.itemId),
        generatedAt: now,
        mode: 'personal',
      };
      await persistCache({
        version: 1,
        ...(cache.personal ? { personal: cache.personal } : {}),
        lastView: snapshot,
        rankedIds: [...page.map((card) => card.itemId), ...unusedIds(page, waveItems.length ? waveItems : candidates)],
      });
    }
    mark('FIRST_CARD_VISIBLE', page.length);
    return finish(
      viewOf({
        cards: page,
        relatedCards,
        accessCards,
        preferences: input.preferences,
        notice: nearby && !page.some((card) => card.conditionStatus === 'met')
          ? '这次没有找到完全符合的对象。下面是来源里能看到的相近选择，并已标明哪里不合。没有把条件放宽。'
          : page.length
            ? '先按已经能确认的对象放在这里。价格、课时、平台等条件未核实的已标明，还没有标成已确认。'
            : relatedCards.length
              ? '先找到这些相关介绍，还不是这次要的对象本身。'
              : '',
        ...(relatedCards.length
          ? { relatedTitle: nearby ? '相近选择（不完全符合这次的条件）' : '相关介绍' }
          : {}),
        reasonCode: page.length || relatedCards.length ? 'REPLENISHED' : 'DIRECTORY_EMPTY',
        feedMode: 'personal',
        networking,
        replenishing: true,
      }),
      page.length || relatedCards.length ? 'REPLENISHED' : 'DIRECTORY_EMPTY',
    );
  }

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
            : networking === 'RATE_LIMITED'
              ? 'NETWORK_RATE_LIMITED'
              : networking === 'TEMPORARY_ERROR'
              ? 'NETWORK_TEMPORARY_ERROR'
              : items.length
                ? 'NO_CONSUMABLE_CANDIDATES'
                : 'DIRECTORY_EMPTY';
    if (input.mode === 'more') {
      return finish(
        viewOf({
          cards: [],
          preferences: input.preferences,
          notice: '暂时没有更多新内容。',
          reasonCode,
          feedMode: 'personal',
          networking,
        }),
        reasonCode,
      );
    }
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
    const openCards = pageForDefault(directoryCards(candidates, prefs, MAX_FEED, now));
    if (openCards.page.length) {
      const snapshot: FeedSnapshot = {
        itemIds: rememberShownIds(cache.lastView?.itemIds, openCards.page.map((card) => card.itemId), input.mode === 'more'),
        generatedAt: now,
        mode: 'personal',
      };
      await persistCache({
        version: 1,
        ...(steered && cache.personal ? { personal: cache.personal } : { personal: snapshot }),
        lastView: snapshot,
        rankedIds: [...snapshot.itemIds, ...openCards.moreIds, ...unusedIds(openCards.page)],
      });
      mark('FIRST_CARD_VISIBLE', openCards.page.length);
      return finish(
        viewOf({
          cards: openCards.page,
          preferences: input.preferences,
          notice: '',
          reasonCode: replenished ? 'REPLENISHED' : 'LOCAL_DIRECTORY',
          feedMode: 'personal',
          networking,
        }),
        replenished ? 'REPLENISHED' : 'LOCAL_DIRECTORY',
      );
    }
    const fallback = input.mode === 'more' ? [] : cachedCards.length ? cachedCards : lastCards;
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
        notice: input.mode === 'more' ? '暂时没有更多新内容。' : noticeFor(reasonCode, fallback.length > 0),
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
    const fetched =
      input.mode === 'more'
        ? []
        : candidates
            .map((item) => cardFromNetworkItem(item, '已经取到，这一轮还没排好顺序。', 'directory'))
            .filter(isConcreteContentCard);
    const page = fetched.slice(0, MAX_FEED);
    if (page.length) {
      cache.rankedIds = fetched.map((card) => card.itemId);
      const snapshot: FeedSnapshot = {
        itemIds: page.map((card) => card.itemId),
        generatedAt: now,
        mode: 'personal',
      };
      await persistCache({
        version: 1,
        ...(steered && cache.personal ? { personal: cache.personal } : { personal: snapshot }),
        lastView: snapshot,
        rankedIds: cache.rankedIds,
      });
      mark('FIRST_CARD_VISIBLE', page.length);
      return finish(
        viewOf({
          cards: page,
          preferences: input.preferences,
          notice: '已经取到这些内容。这一轮没能排好顺序，先按不同来源放在这里。',
          reasonCode: replenished ? 'REPLENISHED' : 'LOCAL_DIRECTORY',
          feedMode: 'personal',
          networking,
        }),
        replenished ? 'REPLENISHED' : 'LOCAL_DIRECTORY',
      );
    }
    const fallback = cachedCards.length ? cachedCards : lastCards;
    if (fallback.length) mark('FIRST_CARD_VISIBLE', fallback.length);
    return finish(
      viewOf({
        cards: fallback,
        preferences: input.preferences,
        notice:
          input.mode === 'more'
            ? '暂时没有更多新内容。'
            : fallback.length
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
  const ordered = selected.decisions
    .map((row) => {
      const item = byId.get(row.itemId);
      if (!item || blocked(item, prefs) || isAccessNetworkItem(item)) return null;
      const thisTurn = freshIds.has(item.itemId) || !!input.adjustment;
      const card = withCandidateHonesty(cardFromNetworkItem(item, row.reason, 'directory'), !thisTurn);
      return isConcreteContentCard(card) && !isAccessCard(card) ? card : null;
    })
    .filter((card): card is DiscoverCard => !!card);
  const { visible: rankedVisible, access: rankedAccess } = splitAccessCards(ordered);
  const shownIds = new Set(selected.shownItemIds);
  const incomingRank = rankedVisible.filter((card) => shownIds.has(card.itemId));
  const rankedLater = rankedVisible.filter((card) => !shownIds.has(card.itemId));
  const merged = pageForDefault(incomingRank.length ? incomingRank : rankedVisible);
  if (merged.page.length < MIN_FEED) {
    for (const card of rankedLater) {
      if (merged.page.length >= MIN_FEED) break;
      if (merged.page.some((row) => row.itemId === card.itemId)) continue;
      merged.page.push(card);
    }
    merged.moreIds = merged.moreIds.filter((id) => !merged.page.some((card) => card.itemId === id));
  }
  const cards = merged.page;
  const accessCards = [...rankedAccess, ...accessFromFresh].slice(0, 8);
  cache.rankedIds = [...new Set([
    ...cards.map((card) => card.itemId),
    ...merged.moreIds,
    ...rankedVisible.filter((card) => !shownIds.has(card.itemId)).map((card) => card.itemId),
    ...ordered.map((card) => card.itemId),
    ...unusedIds(cards),
  ])].filter((id) => {
    const item = byId.get(id) || input.items.find((row) => row.itemId === id);
    return !item || !blocked(item, prefs);
  });

  if (!cards.length) {
    const alreadyHave = input.mode === 'more' ? [] : candidates
      .map((item) => cardFromNetworkItem(item, '已经取到，这一轮没有排进推荐，先按来源放在这里。', 'directory'))
      .filter(isConcreteContentCard)
      .slice(0, MAX_FEED);
    const keptHave = pageForDefault(alreadyHave);
    if (keptHave.page.length) {
      const snapshot: FeedSnapshot = {
        itemIds: rememberShownIds(cache.lastView?.itemIds, keptHave.page.map((card) => card.itemId), false),
        generatedAt: now,
        mode: 'personal',
      };
      await persistCache({
        version: 1,
        ...(steered && cache.personal ? { personal: cache.personal } : { personal: snapshot }),
        lastView: snapshot,
        rankedIds: [...snapshot.itemIds, ...keptHave.moreIds, ...unusedIds(keptHave.page)],
      });
      mark('FIRST_CARD_VISIBLE', keptHave.page.length);
      return finish(
        viewOf({
          cards: keptHave.page,
          preferences: input.preferences,
          notice: '已经取到这些内容。这一轮没有排进推荐，先按不同来源放在这里。',
          reasonCode: replenished ? 'REPLENISHED' : 'LOCAL_DIRECTORY',
          feedMode: 'personal',
          networking,
        }),
        replenished ? 'REPLENISHED' : 'LOCAL_DIRECTORY',
      );
    }
    const fallback = input.mode === 'more' ? [] : cachedCards.length ? cachedCards : lastCards;
    if (fallback.length) mark('FIRST_CARD_VISIBLE', fallback.length);
    return finish(
      viewOf({
        cards: fallback,
        preferences: input.preferences,
        notice:
          input.mode === 'more'
            ? '暂时没有更多新内容。'
            : fallback.length
              ? noticeFor('CACHED_FEED', true)
              : '这次没有找到可以直接看的内容。',
        reasonCode: fallback.length ? 'CACHED_FEED' : 'MODEL_SELECTION_EMPTY',
        feedMode: 'personal',
        networking,
      }),
      fallback.length ? 'CACHED_FEED' : 'MODEL_SELECTION_EMPTY',
    );
  }

  const snapshot: FeedSnapshot = {
    itemIds: rememberShownIds(cache.lastView?.itemIds, cards.map((card) => card.itemId), input.mode === 'more'),
    generatedAt: now,
    mode: 'personal',
  };
  await persistCache({
    version: 1,
    ...(steered && cache.personal ? { personal: cache.personal } : { personal: snapshot }),
    lastView: snapshot,
    rankedIds: cache.rankedIds,
  });
  const reasonCode: FeedReasonCode = replenished ? 'REPLENISHED' : 'CACHED_FEED';
  mark('FIRST_CARD_VISIBLE', cards.length);
  return finish(
    viewOf({
      cards,
      accessCards,
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
