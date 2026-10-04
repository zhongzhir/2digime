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
  type CandidateJudgment,
  defaultDiscoverIntent,
  extractMentionedWorks,
  interpretDiscoverIntent,
  isDomainLikeTitle,
  isGenericHubUrl,
  isPrimaryContentRole,
  isSiteEntranceUrl,
  localCalendarDate,
  objectFidelity,
  strictRequestedTypes,
  type ContentPageRole,
  type DiscoverIntent,
  type ObjectFidelity,
} from './discover-intent';
import { type NewsHeadline } from './news-headlines';
import { allowsDefaultSupply, filterDefaultSupply } from './domestic-source-boundary';
import { hasDirectMediaRepresentation, mergeSeekCardSets } from './discover-search-generation';
import {
  networkItemFromOpenHit,
  searchOpenMedia,
  searchOpenWorks,
  type OpenMediaFetch,
} from './content-source-capabilities';
import { classifySearchFailure, SEARCH_QUOTA_NOTICE } from './network-discovery-state';

export interface ExternalSeekHit {
  title: string;
  url: string;
  snippet?: string;
  publishedAt?: string;
  publisherDisplayName?: string;
  textOrigin?: 'snippet' | 'body';
  /** 点播一部作品时多取一些章节。默认信息流不传，由摄入方保持小批量。 */
  limit?: number;
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
  searchCalled?: boolean;
  rawSearchHits?: number;
  excludedHub?: number;
  excludedDomainTitle?: number;
  excludedPlaceholder?: number;
  /** 链接或标题与已有候选完全相同、合并掉的条数。 */
  duplicates?: number;
  /** 分页判断后仍没送去判断的候选数。它们列为未判断，不算无关。 */
  notSentToJudge?: number;
  /** 送去判断的页数，每页最多 JUDGE_PAGE 条。 */
  judgePages?: number;
  searchFailed?: boolean;
  /** 联网搜索额度用完。与"没有结果"和网络故障分开。 */
  searchRateLimited?: boolean;
}

export interface ContentSeekResult {
  cards: DiscoverCard[];
  relatedCards: DiscoverCard[];
  /** 取到了，但相关性判断没完成。不是已确认推荐，也不是确认无关。 */
  unjudgedCards: DiscoverCard[];
  /** 验证、登录墙和读取失败。不是未判断的内容。 */
  accessCards: DiscoverCard[];
  intent: DiscoverIntent;
  usedDirectory: boolean;
  usedExternal: boolean;
  notice: string;
  trace: SeekTrace;
}

const CONSUME_EMPTY = '这次没有找到可以直接看的内容。';
const MAX_CARDS = 12;
const JUDGE_PAGE = 16;
/** 开始下一页判断前至少要剩的时间；不够就停在这里，留给已经拿到的结果交付。 */
const JUDGE_PAGE_ROOM_MS = 25_000;

const isQuotaError = (err: unknown) => classifySearchFailure(err) === 'RATE_LIMITED';

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
  const preferred = [...intent.searchQueries, intent.topic]
    .map((row) => String(row || '').trim())
    .filter((value) => value.length >= 2);
  const terms: string[] = [];
  for (const row of preferred.length ? preferred : directorySeekTerms(query)) {
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

function isPlaceholderTitle(title: string): boolean {
  return /^(title|untitled|undefined|null)$/i.test(title.trim());
}

function isConcreteCandidate(card: DiscoverCard): boolean {
  if (!card.title.trim() || isPlaceholderTitle(card.title)) return false;
  if (isDomainOnlyCard(card)) return false;
  if (card.url && isGenericHubUrl(card.url)) return false;
  return true;
}

/** 拉取到的页面本身是验证或拒绝，不是用户问题里的关键词。 */
export function pageAccessState(input: { title?: string; text?: string }): 'ok' | 'challenge' | 'login' | 'unreadable' {
  const text = String(input.text || '').replace(/\s+/g, ' ').trim();
  const title = String(input.title || '').trim();
  const blob = `${title}\n${text}`;
  if (/安全验证|人机验证|captcha|verify you are human|are you a human/i.test(title)) return 'challenge';
  if (title.length < 48 && /请登录|登录后继续|sign in to continue|log in to continue|login required/i.test(title)) {
    return 'login';
  }
  if (title.length < 80 && /^(403|404)\b|forbidden|page not found|无法访问|读取失败/i.test(title)) return 'unreadable';
  if (/安全验证|人机验证|captcha|verify you are human|are you a human|access denied|just a moment/i.test(blob) && text.length < 500) {
    return 'challenge';
  }
  if (/请登录|登录后继续|sign in to continue|log in to continue|login required/i.test(blob) && text.length < 400) {
    return 'login';
  }
  return 'ok';
}

export function isAccessCard(card: { accessState?: string }): boolean {
  return card.accessState === 'challenge' || card.accessState === 'login' || card.accessState === 'unreadable';
}

export function markAccess(card: DiscoverCard): DiscoverCard {
  const state = pageAccessState({ title: card.title, text: card.text });
  if (state === 'ok') return card;
  card.accessState = state;
  card.unavailable = true;
  card.entrancePurpose = '访问验证，不是内容入口';
  card.reason =
    state === 'login'
      ? '这个页面要登录，不是正文。入口还在，来源摘要只说明当时给出了什么。'
      : state === 'unreadable'
        ? '正文没有读到。下面保留来源摘要和入口，没有把它当成已经读过。'
        : '这个页面是访问验证，不是正文。可以打开原站；搜索摘要只说明当时给出了什么。';
  return card;
}

function attachCandidateHonesty(card: DiscoverCard, judgment?: { conditions?: string; medium?: string; entrance?: string; basis?: string }): DiscoverCard {
  const marked = markAccess(card);
  if (isAccessCard(marked)) return marked;
  const conditions = judgment?.conditions === 'met' || judgment?.conditions === 'unconfirmed' ? judgment.conditions : 'none';
  const objectKind = (judgment?.medium && judgment.medium !== 'unknown' ? judgment.medium : marked.contentType) || 'article';
  const entrance = judgment?.entrance || 'none';
  const entrancePurpose =
    entrance === 'full'
      ? '去原站打开完整入口'
      : entrance === 'excerpt'
        ? '去原站打开片段入口'
        : entrance === 'unverified'
          ? '入口未核实，去原站打开'
          : '去原站打开';
  const conditionNote =
    conditions === 'unconfirmed'
      ? judgment?.basis
        ? `未核实：${judgment.basis}`
        : '用户提出的条件未核实'
      : undefined;
  return {
    ...marked,
    conditionStatus: conditions,
    objectKind,
    entrancePurpose,
    ...(conditionNote ? { conditionNote } : {}),
  };
}

export function publishedLocalDay(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return localCalendarDate(new Date(parsed));
}

export function cardsFromNewsHeadlines(rows: NewsHeadline[]): DiscoverCard[] {
  return filterDefaultSupply(rows).slice(0, 8).map((row, index) => {
    const url = canonicalOf(row.url) || row.url;
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      host = '';
    }
    const aggregator = /(^|\.)news\.google\.com$/i.test(host);
    const card: DiscoverCard = {
      itemId: `news_${index}_${url}`,
      title: row.title,
      text: row.snippet && row.snippet !== row.title ? row.snippet : '',
      url,
      reason: aggregator
        ? '新闻来源给出的标题和发布时间。打开的是聚合入口，没有解析出媒体原文。还没有读取正文。'
        : '新闻来源给出的标题、来源和发布时间。还没有读取正文。',
      source: 'web',
      contentType: 'article',
      textOrigin: 'snippet',
      linkKind: aggregator ? 'aggregator' : 'original',
      ...(aggregator ? { entryUrl: url } : {}),
      ...(row.publishedAt ? { publishedAt: row.publishedAt } : {}),
      ...(row.publisherName ? { publisherDisplayName: row.publisherName } : {}),
      ...(row.publisherUrl ? { publisherUrl: row.publisherUrl } : {}),
    };
    return markAccess(card);
  });
}

/** 当天报道只收来源发布时间落在用户本地今天、且已经判为具体报道的条目。 */
export function splitCurrentReports(input: {
  primary: DiscoverCard[];
  related: DiscoverCard[];
  today: string;
}): { todayReports: DiscoverCard[]; background: DiscoverCard[] } {
  const todayReports: DiscoverCard[] = [];
  const moved: DiscoverCard[] = [];
  for (const card of input.primary) {
    if (card.accessState === 'challenge' || card.accessState === 'unreadable') {
      moved.push(card);
      continue;
    }
    const day = publishedLocalDay(card.publishedAt);
    if (day === input.today) {
      todayReports.push(card);
      continue;
    }
    if (!day) {
      moved.push({ ...card, reason: '来源没有给出发布时间，不能当作这一天的报道。' });
      continue;
    }
    moved.push({ ...card, reason: `来源发布时间是 ${day}，不是这一天。` });
  }
  return { todayReports, background: [...moved, ...input.related] };
}

export function snippetCardsFromHits(hits: ExternalSeekHit[]): DiscoverCard[] {
  return hits.slice(0, 8).map((hit, index) => {
    const url = canonicalOf(hit.url) || hit.url;
    return webCardFromHit(hit, `snippet_${index}_${url}`);
  });
}

function webCardFromHit(hit: ExternalSeekHit, itemId: string): DiscoverCard {
  const title = String(hit.title || hit.url).slice(0, 240);
  const snippet = String(hit.snippet || '').trim();
  const card: DiscoverCard = {
    itemId,
    title,
    text: snippet && snippet !== title ? snippet.slice(0, 800) : '',
    url: canonicalOf(hit.url) || hit.url,
    reason: '公开网页来源，不是目录推荐。',
    source: 'web',
    textOrigin: hit.textOrigin || 'snippet',
    ...(hit.publishedAt ? { publishedAt: hit.publishedAt } : {}),
    ...(hit.publisherDisplayName ? { publisherDisplayName: hit.publisherDisplayName } : {}),
  };
  return markAccess(card);
}

const ENTRANCE_CHECK_MS = 10_000;

// 入口是否真的打得开：只认连接层失败（证书、域名、拒绝连接、超时）和页面已不存在。
// 读取用的不是浏览器，其余状态码、内容过大或类型不支持都不代表浏览器里打不开；
// 解析到内网地址（例如本机代理的 fake-ip）时不读，也不能据此说打不开。
async function entranceOpens(openPage: OpenMediaFetch | undefined, url: string | undefined): Promise<boolean> {
  if (!openPage || !url) return true;
  let timer: NodeJS.Timeout | undefined;
  try {
    const res = await Promise.race([
      openPage(url),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error('entrance check timeout'), { code: 'timeout' })), ENTRANCE_CHECK_MS);
      }),
    ]);
    return res.status !== 404 && res.status !== 410;
  } catch (err) {
    const code = (err as { code?: string } | undefined)?.code;
    return code === 'too_large' || code === 'content_type' || code === 'redirect' || code === 'ssrf';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function programsFromSources(input: {
  query: string;
  intent: DiscoverIntent;
  sources: DiscoverCard[];
  searchWeb: (query: string) => Promise<ExternalSeekHit[]>;
  chatComplete: ChatCompleteFn;
  model: { baseUrl: string; model: string; apiKey?: string };
  seenUrls: Set<string>;
  openPage?: OpenMediaFetch;
  signal?: AbortSignal;
}): Promise<{ verified: DiscoverCard[]; unverified: DiscoverCard[]; quotaHit: boolean }> {
  const verified: DiscoverCard[] = [];
  const unverified: DiscoverCard[] = [];
  if (!input.sources.length) return { verified, unverified, quotaHit: false };
  const works = await extractMentionedWorks({
    query: input.query,
    intent: input.intent,
    sources: input.sources.map((card) => ({ id: card.itemId, title: card.title, text: card.text || '' })),
    chatComplete: input.chatComplete,
    model: input.model,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!works.length || input.signal?.aborted) return { verified, unverified, quotaHit: false };
  const sourceById = new Map(input.sources.map((card) => [card.itemId, card]));
  // 搜索有配额（网关按安装计次）：两两核实；一次搜索失败或被限流后不再发新的核实，其余如实标为未核实。
  let searchBlocked = false;
  let quotaHit = false;
  type Checked = {
    work: (typeof works)[number];
    card: DiscoverCard | null;
    judgment: CandidateJudgment | undefined;
    miss: 'pending' | 'broken' | 'uncertain';
  };
  const checkOne = async (work: (typeof works)[number], index: number): Promise<Checked> => {
    if (searchBlocked || input.signal?.aborted) return { work, card: null, judgment: undefined, miss: 'pending' };
    let hits: ExternalSeekHit[] = [];
    try {
      hits = await input.searchWeb(work.searchQuery);
    } catch (err) {
      searchBlocked = true;
      if (isQuotaError(err)) quotaHit = true;
      hits = [];
    }
    const candidates: DiscoverCard[] = [];
    for (const hit of hits) {
      const canonical = canonicalOf(hit.url);
      if (!canonical || input.seenUrls.has(canonical)) continue;
      if (!allowsDefaultSupply({ url: canonical })) continue;
      if (isSiteEntranceUrl(canonical) || isGenericHubUrl(canonical) || isDomainLikeTitle(hit.title, canonical)) continue;
      const card = webCardFromHit({ ...hit, url: canonical }, `work_${index}_${candidates.length}_${canonical}`);
      if (isAccessCard(card)) continue;
      candidates.push(card);
      if (candidates.length >= 3) break;
    }
    if (!candidates.length || input.signal?.aborted) return { work, card: null, judgment: undefined, miss: 'pending' };
    // 这里只核实页面是不是这部作品本身；口碑、长短这些条件的依据来自提到它的那篇文章。
    const { preferences: _preferences, ...workIntent } = input.intent;
    const judged = await classifyCandidateRoles({
      query: work.kind ? `《${work.title}》（${work.kind}）` : `《${work.title}》`,
      intent: { ...workIntent, topic: work.title, popularityClaim: false },
      candidates: candidates.map((card) => ({
        id: card.itemId,
        title: card.title,
        url: card.url || '',
        summary: card.text || '',
      })),
      chatComplete: input.chatComplete,
      model: input.model,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const requiresPlayable = input.intent.requestedMedia.some((row) => row === 'video' || row === 'audio');
    const pages = candidates.filter((row) => {
      if (!isPrimaryContentRole(judged.roles.get(row.itemId))) return false;
      if (requiresPlayable && judged.judgments.get(row.itemId)?.medium === 'article') return false;
      return true;
    });
    if (!requiresPlayable) {
      const page = pages[0];
      if (page) return { work, card: page, judgment: judged.judgments.get(page.itemId), miss: 'pending' };
      return { work, card: null, judgment: undefined, miss: 'pending' };
    }
    // 完整且来源可信的入口优先；片段可以给，但要标明；自称全集却看不出来源的页面不算核实到的入口。
    const entranceOf = (card: DiscoverCard) => judged.judgments.get(card.itemId)?.entrance;
    const usable = [
      ...pages.filter((card) => entranceOf(card) === 'full'),
      ...pages.filter((card) => entranceOf(card) === 'excerpt'),
    ];
    for (const card of usable) {
      if (input.signal?.aborted) break;
      if (await entranceOpens(input.openPage, card.url)) {
        return { work, card, judgment: judged.judgments.get(card.itemId), miss: 'pending' };
      }
    }
    return { work, card: null, judgment: undefined, miss: usable.length ? 'broken' : pages.length ? 'uncertain' : 'pending' };
  };
  const checked: Checked[] = [];
  for (let index = 0; index < works.length; index += 2) {
    checked.push(...(await Promise.all(works.slice(index, index + 2).map((work, j) => checkOne(work, index + j)))));
  }
  const taken = new Set<string>();
  const notChecked = new Map<string, Record<Checked['miss'], string[]>>();
  for (const row of checked) {
    const source = sourceById.get(row.work.sourceId);
    if (!source) continue;
    const key = row.card ? canonicalOf(row.card.url) : '';
    if (row.card && key && !taken.has(key)) {
      taken.add(key);
      input.seenUrls.add(key);
      const medium = row.work.medium !== 'unknown' ? row.work.medium : row.judgment?.medium;
      verified.push({
        ...row.card,
        objectFidelity: 'PRIMARY_CONTENT',
        ...(medium === 'video' || medium === 'audio' ? { contentType: medium } : {}),
        ...(row.judgment?.summary ? { text: row.judgment.summary } : {}),
        ...(row.judgment?.entrance === 'excerpt' ? { excerpt: true } : {}),
        reason: `推荐依据来自「${source.title}」${row.work.basis ? `：${row.work.basis}` : '。'}`,
        basisSource: { title: source.title, ...(source.url ? { url: source.url } : {}) },
      });
      continue;
    }
    const marks = notChecked.get(source.itemId) || { pending: [], broken: [], uncertain: [] };
    marks[row.miss].push(`《${row.work.title}》`);
    notChecked.set(source.itemId, marks);
  }
  // 未核实的作品不单独成卡：标在提到它们的那篇文章上，文章仍只是依据。
  for (const [sourceId, marks] of notChecked) {
    const source = sourceById.get(sourceId)!;
    const tails: Record<Checked['miss'], string> = {
      pending: quotaHit ? '还没有核实，这个小时的联网搜索额度已经用完。' : '还没有核实到作品页或观看入口。',
      uncertain: '找到的页面没能确认是完整节目或可信来源。',
      broken: '找到的作品页目前打不开。',
    };
    const groups = (['pending', 'uncertain', 'broken'] as const).filter((key) => marks[key].length);
    const reason =
      groups.length === 1
        ? `这篇提到了${marks[groups[0]!].join('')}，${tails[groups[0]!]}`
        : `这篇提到了${groups.map((key) => marks[key].join('')).join('')}。${groups.map((key) => `${marks[key].join('')}${tails[key]}`).join('')}`;
    unverified.push({ ...source, objectFidelity: 'ABOUT_CONTENT', reason });
  }
  return { verified, unverified, quotaHit };
}

export async function seekContent(input: {
  query: string;
  items: NetworkItem[];
  searchWeb?: (query: string) => Promise<ExternalSeekHit[]>;
  chatComplete?: ChatCompleteFn;
  model?: { baseUrl: string; model: string; apiKey?: string };
  ingestHit?: (hit: ExternalSeekHit) => Promise<NetworkItem[]>;
  fetchOpenMedia?: OpenMediaFetch;
  /** 只用来确认核实到的作品页能否打开。 */
  openPage?: OpenMediaFetch;
  newsHeadlines?: NewsHeadline[];
  intent?: DiscoverIntent;
  skipWeb?: boolean;
  skipOpenMedia?: boolean;
  previous?: { cards: DiscoverCard[]; relatedCards: DiscoverCard[] };
  signal?: AbortSignal;
  /** 这次请求的交付期限（epoch ms）。只用来决定还要不要开始下一页判断。 */
  deadlineAt?: number;
}): Promise<ContentSeekResult> {
  const query = String(input.query || '').trim();
  const emptyIntent = defaultDiscoverIntent(query);
  if (!query) {
    return {
      cards: [],
      relatedCards: [],
      unjudgedCards: [],
      accessCards: [],
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
          ...(input.signal ? { signal: input.signal } : {}),
        })
      : emptyIntent);
  if (input.signal?.aborted) {
    return {
      cards: [],
      relatedCards: [],
      unjudgedCards: [],
      accessCards: [],
      intent,
      usedDirectory: false,
      usedExternal: false,
      notice: '这次搜索已经取消。',
      trace: emptyTrace(query, intent),
    };
  }
  const requiredTypes = strictRequestedTypes(intent);
  const queryByUrl = new Map<string, string>();

  const directoryHits = matchDirectoryForSeek(input.items, query).filter(
    (item) =>
      allowsDefaultSupply({ url: item.content.url, publisher: item.publisherDisplayName }) &&
      !isDomainLikeTitle(item.content.title, item.content.url) &&
      !(item.content.url && isGenericHubUrl(item.content.url)),
  );
  const cards: DiscoverCard[] = directoryHits.map((item) =>
    cardFromNetworkItem(item, '目录里已有这条内容。', 'directory'),
  );
  const seenUrls = new Set(cards.map((card) => canonicalOf(card.url)).filter(Boolean));
  const seenIds = new Set(cards.map((card) => card.itemId));
  const reportDay = intent.reportDay;
  // "当下/最近"只是时效偏好，不是指定某一天；按天筛选只在模型判定为新闻报道并给出日期时才启用。
  const datedNews = intent.newsFeed === true && !!reportDay;

  let usedExternal = false;
  let searchFailed = false;
  let searchRateLimited = false;
  let searchCalled = false;
  let rawSearchHits = 0;
  let excludedHub = 0;
  let excludedDomain = 0;
  let excludedPlaceholder = 0;
  if (input.newsHeadlines?.length) {
    for (const card of cardsFromNewsHeadlines(input.newsHeadlines)) {
      const canonical = canonicalOf(card.url);
      if (canonical && seenUrls.has(canonical)) continue;
      if (seenIds.has(card.itemId)) continue;
      if (canonical) seenUrls.add(canonical);
      seenIds.add(card.itemId);
      usedExternal = true;
      cards.push(card);
    }
  }
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
          if (hit.feedUrl && input.ingestHit && !hit.mediaUrl && mediaOfKind > 0) continue;
          if (hit.feedUrl && input.ingestHit && !hit.mediaUrl) {
            try {
              const ingested = await input.ingestHit({
                title: hit.title,
                url: hit.feedUrl,
                limit: 12,
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
          if (!hit.mediaUrl && !hit.embedUrl) continue;
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
  if (input.fetchOpenMedia && !input.skipOpenMedia && cards.length === 0) {
    try {
      const workQueries = openMediaQueries(query, intent);
      for (const topicQuery of workQueries) {
        if (cards.length >= 24) break;
        const workHits = await searchOpenWorks({
          query: topicQuery,
          fetchImpl: input.fetchOpenMedia,
        });
        for (const hit of workHits) {
          const item = networkItemFromOpenHit(hit);
          if (!item) continue;
          const canonical = canonicalOf(item.content.url);
          if (canonical && seenUrls.has(canonical)) continue;
          if (seenIds.has(item.itemId)) continue;
          if (canonical) seenUrls.add(canonical);
          seenIds.add(item.itemId);
          usedExternal = true;
          if (canonical) queryByUrl.set(canonical, topicQuery);
          cards.push(
            cardFromNetworkItem(
              item,
              hit.pageKind === 'guide' ? '开放攻略来源，不是目录推荐。' : '开放作品来源，不是目录推荐。',
              'web',
            ),
          );
          if (cards.length >= 24) break;
        }
      }
    } catch {
      /* 作品 / 攻略目录失败不阻断网页搜索 */
    }
  }

  if (input.searchWeb && !input.skipWeb) {
    searchCalled = true;
    const queries = intent.searchQueries.length ? intent.searchQueries : [query];
    const webHits: Array<ExternalSeekHit & { searchQuery: string; entrance?: boolean }> = [];
    const seenHit = new Set<string>();
    const queryList = queries.slice(0, 3);
    const batches = await Promise.all(
      queryList.map(async (q) => {
        try {
          return { q, web: await input.searchWeb!(q), failed: false, quota: false };
        } catch (err) {
          return { q, web: [] as ExternalSeekHit[], failed: true, quota: isQuotaError(err) };
        }
      }),
    );
    for (const batch of batches) {
      if (batch.failed) searchFailed = true;
      if (batch.quota) searchRateLimited = true;
      const web = batch.web;
      const q = batch.q;
      try {
        rawSearchHits += web.length;
        for (const hit of web) {
          const canonical = canonicalOf(hit.url);
          if (!canonical || seenHit.has(canonical) || seenUrls.has(canonical)) continue;
          if (!allowsDefaultSupply({ url: canonical })) continue;
          if (isSiteEntranceUrl(canonical)) {
            seenHit.add(canonical);
            webHits.push({ ...hit, url: canonical, searchQuery: q, entrance: true });
            continue;
          }
          if (isGenericHubUrl(canonical)) {
            excludedHub += 1;
            continue;
          }
          if (isDomainLikeTitle(hit.title, canonical)) {
            excludedDomain += 1;
            continue;
          }
          if (isPlaceholderTitle(hit.title || '')) {
            excludedPlaceholder += 1;
            continue;
          }
          seenHit.add(canonical);
          webHits.push({ ...hit, url: canonical, searchQuery: q });
        }
      } catch {
        searchFailed = true;
      }
    }
    const bodyHits = webHits.slice(0, 8);
    const snippetHits = webHits.slice(8);
    const ingestedGroups = await Promise.all(
      bodyHits.map(async (hit) => {
        if (!input.ingestHit) return { hit, items: [] as NetworkItem[] };
        try {
          return { hit, items: await input.ingestHit(hit) };
        } catch {
          return { hit, items: [] as NetworkItem[] };
        }
      }),
    );
    const pushSnippet = (hit: (typeof webHits)[number]) => {
      if (cards.length >= 24) return;
      const canonical = canonicalOf(hit.url);
      if (canonical && seenUrls.has(canonical)) return;
      if (canonical) {
        seenUrls.add(canonical);
        queryByUrl.set(canonical, hit.searchQuery);
      }
      usedExternal = true;
      cards.push(webCardFromHit(hit, `seek_${seenUrls.size}`));
    };
    for (const group of ingestedGroups) {
      const hit = group.hit;
      let added = false;
      for (const item of group.items) {
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
        const card = cardFromNetworkItem(item, '公开网页来源，不是目录推荐。', 'web');
        card.textOrigin = 'body';
        cards.push(markAccess(card));
        if (cards.length >= 24) break;
      }
      if (!added && hit.entrance) {
        excludedHub += 1;
        continue;
      }
      if (!added) pushSnippet(hit);
    }
    for (const hit of snippetHits) pushSnippet(hit);
  }

  // 链接已按 canonical URL 去重；同一站点上标题完全相同的再合并一次，然后才送判断。
  const sameEntry = (card: DiscoverCard) => {
    const title = String(card.title || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!title) return '';
    let host = '';
    try {
      host = card.url ? new URL(card.url).hostname : '';
    } catch {
      host = '';
    }
    return `${host}|${title}`;
  };
  const seenEntry = new Set<string>();
  let duplicates = 0;
  const concrete = cards.filter(isConcreteCandidate).filter((card) => {
    const key = sameEntry(card);
    if (!key) return true;
    if (seenEntry.has(key)) {
      duplicates += 1;
      return false;
    }
    seenEntry.add(key);
    return true;
  });
  const fidelity = new Map<string, ObjectFidelity | 'UNJUDGED'>();
  const unjudgedIds = new Set<string>();
  const judgments = new Map<string, CandidateJudgment>();
  const toJudge = concrete.filter((card) => !isAccessCard(card));
  const sentIds = new Set<string>();
  let judgePages = 0;
  const judging = !!(input.chatComplete && input.model);
  // 超过一页的候选按页依次判断。已经够一屏主结果、或剩余时间不够再判一页时停下；
  // 停下时没送去的候选列为"还没判断"，不当作无关，也不悄悄丢掉。
  const roomForPage = () => !input.deadlineAt || input.deadlineAt - Date.now() > JUDGE_PAGE_ROOM_MS;
  const primaryJudged = () => [...judgments.values()].filter((row) => isPrimaryContentRole(row.role)).length;
  for (let start = 0; judging && start < toJudge.length; start += JUDGE_PAGE) {
    if (input.signal?.aborted) break;
    if (start > 0 && (primaryJudged() >= MAX_CARDS || !roomForPage())) break;
    const page = toJudge.slice(start, start + JUDGE_PAGE);
    judgePages += 1;
    for (const card of page) sentIds.add(card.itemId);
    const judged = await classifyCandidateRoles({
      query,
      intent,
      candidates: page.map((card) => ({
        id: card.itemId,
        title: card.title,
        url: card.url || '',
        summary: card.text || '',
        ...(card.contentType ? { contentType: card.contentType } : {}),
        ...(card.publishedAt ? { publishedAt: card.publishedAt } : {}),
        ...(card.durationSeconds ? { durationSeconds: card.durationSeconds } : {}),
      })),
      chatComplete: input.chatComplete!,
      model: input.model!,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    for (const id of judged.unjudgedIds) unjudgedIds.add(id);
    for (const [id, row] of judged.judgments) judgments.set(id, row);
    for (const card of page) {
      if (unjudgedIds.has(card.itemId)) continue;
      const role = judged.roles.get(card.itemId);
      if (!role) continue;
      const backgroundRole: ContentPageRole[] = ['LISTING', 'HUB', 'COMMENTARY'];
      fidelity.set(
        card.itemId,
        datedNews && backgroundRole.includes(role) ? 'ABOUT_CONTENT' : objectFidelity(role, intent),
      );
    }
  }
  const notSent = new Set(judging ? toJudge.filter((card) => !sentIds.has(card.itemId)).map((card) => card.itemId) : []);

  const primary: DiscoverCard[] = [];
  const related: DiscoverCard[] = [];
  const unjudged: DiscoverCard[] = [];
  const access: DiscoverCard[] = [];
  for (const card of concrete) {
    if (isAccessCard(card)) {
      access.push(card);
      continue;
    }
    if (notSent.has(card.itemId)) {
      unjudged.push({ ...card, reason: '这条还没送去判断，不代表不相关。' });
      continue;
    }
    // 形态由页面本身决定：模型从内容判断出是视频/音频节目，就算有效推荐，即使没有直接播放文件。
    // 能否应用内播放只看媒体字段，不影响是否入选。
    const judgment = judgments.get(card.itemId);
    const matchedType =
      typeMatches(card, requiredTypes) ||
      (!!judgment && requiredTypes.includes(judgment.medium) && judgment.role !== 'UNRELATED');
    let kind = fidelity.get(card.itemId);
    if (unjudgedIds.has(card.itemId)) kind = 'UNJUDGED';
    if (!kind) {
      kind = requiredTypes.length && !matchedType ? 'ABOUT_CONTENT' : 'PRIMARY_CONTENT';
    }
    if (requiredTypes.length && kind === 'PRIMARY_CONTENT' && !matchedType) {
      kind = 'ABOUT_CONTENT';
    }
    // 自称完整却看不出来源或是否完整的观看页，不当作已确认的观看入口。
    const uncertainEntrance = kind === 'PRIMARY_CONTENT' && judgment?.entrance === 'unverified' && intent.intent === 'consume';
    if (uncertainEntrance) kind = 'ABOUT_CONTENT';
    fidelity.set(card.itemId, kind);
    if (kind === 'UNJUDGED') {
      if (datedNews && reportDay && publishedLocalDay(card.publishedAt) === reportDay) {
        unjudged.push({
          ...card,
          reason: `来源日期是 ${reportDay}，但这轮没有完成判断，还不能当成已确认的这一天报道。`,
        });
      } else {
        unjudged.push(card);
      }
      continue;
    }
    if (kind === 'UNRELATED') continue;
    if (intent.intent === 'research') {
      if (kind === 'PRIMARY_CONTENT' || kind === 'ABOUT_CONTENT') {
        primary.push(attachCandidateHonesty({ ...card, objectFidelity: 'PRIMARY_CONTENT' }, judgment));
      }
    } else if (kind === 'PRIMARY_CONTENT' && matchedType) {
      const basis = judgment?.basis || '';
      const medium = judgment?.medium;
      const confirmed = judgment?.conditions !== 'unconfirmed';
      primary.push(
        attachCandidateHonesty(
          {
            ...card,
            ...(confirmed ? { objectFidelity: 'PRIMARY_CONTENT' as const } : {}),
            ...(medium && medium !== 'unknown' && !hasDirectMediaRepresentation(card) ? { contentType: medium } : {}),
            ...(basis ? { reason: basis } : {}),
            ...(judgment?.summary ? { text: judgment.summary } : {}),
            ...(judgment?.entrance === 'excerpt' ? { excerpt: true } : {}),
          },
          judgment,
        ),
      );
    } else if (kind === 'ABOUT_CONTENT') {
      const basis = judgment?.basis || '';
      related.push(
        attachCandidateHonesty(
          {
            ...card,
            objectFidelity: 'ABOUT_CONTENT',
            ...(uncertainEntrance
              ? { reason: `${basis ? `${basis} ` : ''}没能确认这是完整节目或来自可信来源，不当作已确认的观看入口。` }
              : basis
                ? { reason: basis }
                : {}),
            ...(judgment?.summary ? { text: judgment.summary } : {}),
          },
          judgment,
        ),
      );
    }
  }

  // 片单、榜单和评论只作依据，不冒充对象本身：模型从这次读到的原文里取出被点名的对象，
  // 再用同一个搜索核实对象页；核实不到的只作"提到过"列出，并注明未核实。
  const wantsNamedWorks =
    intent.intent === 'consume' &&
    !datedNews &&
    (requiredTypes.some((row) => row === 'video' || row === 'audio') || primary.length === 0);
  if (
    wantsNamedWorks &&
    input.searchWeb &&
    !input.skipWeb &&
    input.chatComplete &&
    input.model &&
    primary.length < MAX_CARDS &&
    !input.signal?.aborted
  ) {
    const sources = concrete
      .filter((card) => {
        const role = judgments.get(card.itemId)?.role;
        return (
          (role === 'LISTING' || role === 'COMMENTARY') &&
          fidelity.get(card.itemId) !== 'UNRELATED' &&
          String(card.text || '').trim().length >= 40
        );
      })
      .slice(0, 6);
    const found = await programsFromSources({
      query,
      intent,
      sources,
      searchWeb: input.searchWeb,
      chatComplete: input.chatComplete,
      model: input.model,
      seenUrls,
      ...(input.openPage ? { openPage: input.openPage } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (found.quotaHit) searchRateLimited = true;
    primary.unshift(...found.verified);
    const annotated = new Set(found.unverified.map((card) => card.itemId));
    const rest = related.filter((card) => !annotated.has(card.itemId));
    related.length = 0;
    related.push(...found.unverified, ...rest);
  }
  // 完整节目排在片段前面；片段保留，并标明是片段。
  const ordered = [...primary.filter((card) => !card.excerpt), ...primary.filter((card) => card.excerpt)];
  primary.length = 0;
  primary.push(...ordered);

  const placed = datedNews && reportDay
    ? splitCurrentReports({ primary, related, today: reportDay })
    : { todayReports: primary, background: related };
  let visible = placed.todayReports.slice(0, MAX_CARDS);
  let relatedVisible = intent.intent === 'research' ? [] : placed.background.slice(0, 6);
  if (input.previous) {
    const merged = mergeSeekCardSets(input.previous, { cards: visible, relatedCards: relatedVisible });
    visible = merged.cards.slice(0, MAX_CARDS);
    relatedVisible = merged.relatedCards;
  }
  const unjudgedVisible = unjudged.slice(0, 8);
  const visibleIds = new Set([...visible, ...relatedVisible, ...unjudgedVisible].map((card) => card.itemId));

  const traceItems: SeekTraceItem[] = concrete.map((card) => {
    const rawKind = fidelity.get(card.itemId);
    const unjudgedCard = rawKind === 'UNJUDGED';
    const kind = unjudgedCard ? undefined : rawKind;
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
      ...(kind ? { fidelity: kind } : {}),
      typeMatched: matchedType,
      selected: kind === 'PRIMARY_CONTENT' && matchedType,
      visible: isVisible,
      reason: notSent.has(card.itemId)
        ? '还没送去判断，不代表不相关。'
        : unjudgedCard
          ? '这轮没有完成相关性判断。'
          : card.reason,
    };
  });
  const trace: SeekTrace = {
    query,
    topic: intent.topic,
    mode: intent.intent,
    requestedContentTypes: intent.requestedMedia,
    rawCandidates: concrete.length,
    topicMatched: traceItems.filter(
      (row) => row.fidelity === 'PRIMARY_CONTENT' || row.fidelity === 'ABOUT_CONTENT',
    ).length,
    typeMatched: traceItems.filter((row) => row.typeMatched).length,
    primaryContent: traceItems.filter((row) => row.fidelity === 'PRIMARY_CONTENT').length,
    aboutContent: traceItems.filter((row) => row.fidelity === 'ABOUT_CONTENT').length,
    unrelated: traceItems.filter((row) => row.fidelity === 'UNRELATED').length,
    selected: traceItems.filter((row) => row.selected).length,
    visible: visible.length,
    items: traceItems,
    ...(searchCalled
      ? {
          searchCalled: true,
          rawSearchHits,
          excludedHub,
          excludedDomainTitle: excludedDomain,
          excludedPlaceholder,
          ...(searchFailed ? { searchFailed: true } : {}),
        }
      : { searchCalled: false }),
    ...(duplicates ? { duplicates } : {}),
    ...(judgePages ? { judgePages } : {}),
    ...(notSent.size ? { notSentToJudge: notSent.size } : {}),
    ...(searchRateLimited ? { searchRateLimited: true } : {}),
  };

  let notice = '';
  if (!visible.length && searchRateLimited) {
    notice = SEARCH_QUOTA_NOTICE;
  } else if (datedNews && reportDay && !visible.length) {
    notice = `没有找到发布日期是 ${reportDay} 的具体报道。综述、其它日期和还没判断完的条目不能当作这一天的结果。`;
  } else if (datedNews && reportDay && visible.length) {
    notice = `这一组只包括来源发布时间是 ${reportDay}、并且判断为具体报道的条目。综述在补充背景里。还没读到的正文仍标为来源摘要。`;
  } else if (intent.newsFeed === true && !reportDay) {
    notice = visible.length
      ? '这次没有明确报道日期，没有按某一天筛选。'
      : '这次没有明确报道日期，也没有找到可确认的报道。日期不清楚时需要再说一次要哪一天。';
  } else if (!visible.length) {
    if (searchFailed && rawSearchHits === 0 && !directoryHits.length) {
      notice = '暂时无法获取新内容，可以稍后再试或检查联网设置。';
    } else if (!input.searchWeb && !directoryHits.length) {
      notice = '还没有新内容。开启联网发现后，兔机米还可以从公开网络帮你找到更多内容。';
    } else if (searchCalled && rawSearchHits === 0 && !directoryHits.length) {
      notice = '搜索已经发出，这次没有返回结果。';
    } else if (searchCalled && rawSearchHits > 0 && concrete.length === 0) {
      notice =
        excludedHub > 0
          ? '搜索有返回，但都是网站入口，没有从中取出具体报道。'
          : '搜索有返回，但没有可以直接看的内容。';
    } else if (unjudgedVisible.length > 0) {
      notice = '搜索有返回，但这轮没有完成相关性判断，所以没有把它们当成已确认的推荐。可以打开看看，或再搜一次。';
    } else if (relatedVisible.length > 0) {
      notice = requiredTypes.some((row) => row === 'audio' || row === 'video')
        ? requiredTypes.includes('audio')
          ? '没有找到这个音频节目本身，只找到了介绍文章。介绍不能当作已经听完。'
          : '没有找到这个视频节目本身，只找到了介绍文章。介绍不能当作已经看完。'
        : '先找到这些相关介绍，还不是这次要的对象本身。';
    } else if (concrete.length > 0 && trace.unrelated === concrete.length) {
      notice = '搜索有返回，判断后和这次要找的对不上。';
    } else if (intent.intent === 'consume') {
      notice = honestEmptyNotice(intent);
    } else {
      notice = '这次更适合当作分析材料。可点「问兔机米」，或到「与兔机米」里继续。';
    }
  } else if (unjudgedVisible.length > 0) {
    notice = '还有一些结果这轮没有完成判断，没有放进推荐。';
  } else if (intent.honestyNote) {
    notice = intent.honestyNote;
  } else if (intent.intent === 'research' && intent.suggestTalk) {
    notice = '这更像需要深入分析的材料。可点「问兔机米」继续。';
  }
  if (searchRateLimited && notice !== SEARCH_QUOTA_NOTICE) {
    notice = `${notice ? `${notice} ` : ''}这个小时的联网搜索额度已经用完，还有一部分没能搜索，下一个整点后恢复。`;
  }

  return {
    cards: visible,
    relatedCards: relatedVisible,
    unjudgedCards: unjudgedVisible,
    accessCards: access.slice(0, 8),
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
