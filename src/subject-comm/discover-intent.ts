/**
 * 发现页消费意图：由真实模型输出结构化 JSON。
 * 禁止按查询词 if/else 分流 consume / research。
 */
import type { ChatCompleteFn } from '../subject-core/structured-distill';
import { completeStructured, JUDGMENT_JSON_PASSES, type StructuredAttempt } from './structured-call';

export type DiscoverIntentKind = 'consume' | 'research';
export type DiscoverObjectWanted = 'work_itself' | 'commentary' | 'mixed';
export type DiscoverFreshness = 'current' | 'classic' | 'unspecified';
export type ObjectFidelity = 'PRIMARY_CONTENT' | 'ABOUT_CONTENT' | 'UNRELATED';

export interface DiscoverIntent {
  intent: DiscoverIntentKind;
  topic: string;
  requestedMedia: string[];
  objectWanted: DiscoverObjectWanted;
  freshness: DiscoverFreshness;
  popularityClaim: boolean;
  searchQueries: string[];
  suggestTalk: boolean;
  scope: 'current_search';
  /** 模型决定这次要不要用已连接的新闻来源。不是查询词路由。 */
  newsFeed?: boolean;
  /** 模型给出的报道日期 YYYY-MM-DD。要今天时就是用户本地今天。 */
  reportDay?: string;
  honestyNote?: string;
  /** 用户希望在哪里看：应用内播放 / 去原站 / 都可以。由模型从请求里读出，缺省 any。 */
  viewing?: 'in_app' | 'original_site' | 'any';
  /** 用户这次明确提出的质量、风格、时长等偏好，一句话。推荐依据按它来写，不编造。 */
  preferences?: string;
}

export type ContentPageRole =
  | 'PRIMARY_CONTENT'
  | 'SERIES'
  | 'EPISODE'
  | 'HUB'
  | 'LISTING'
  | 'COMMENTARY'
  | 'UNRELATED';

const PAGE_ROLES = new Set<string>([
  'PRIMARY_CONTENT',
  'SERIES',
  'EPISODE',
  'HUB',
  'LISTING',
  'COMMENTARY',
  'UNRELATED',
]);

const MEDIA_TYPES = new Set(['article', 'video', 'image', 'audio']);

export interface ConsumableCandidate {
  id: string;
  title: string;
  url: string;
  summary: string;
  contentType?: string;
  publishedAt?: string;
  /** 来源给出的时长（秒）。没有就不传，不估算。 */
  durationSeconds?: number;
}

export function localCalendarDate(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export class DiscoverIntentError extends Error {
  readonly kind: 'model' | 'parse';

  constructor(kind: 'model' | 'parse', message: string) {
    super(message);
    this.name = 'DiscoverIntentError';
    this.kind = kind;
  }
}

export function defaultDiscoverIntent(query: string): DiscoverIntent {
  const q = String(query || '').trim();
  return {
    intent: 'consume',
    topic: q.slice(0, 80),
    requestedMedia: [],
    objectWanted: 'work_itself',
    freshness: 'unspecified',
    popularityClaim: false,
    searchQueries: q ? [q] : [],
    suggestTalk: false,
    scope: 'current_search',
  };
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

function asMediaType(raw: unknown): string | undefined {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'video' || value === '视频') return 'video';
  if (value === 'audio' || value === '音频' || value === '播客' || value === 'podcast') return 'audio';
  if (value === 'image' || value === '图片' || value === 'photo' || value === '摄影') return 'image';
  if (value === 'article' || value === '文章') return 'article';
  return MEDIA_TYPES.has(value) ? value : undefined;
}

function asObjectWanted(raw: unknown): DiscoverObjectWanted {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'commentary' || value === 'about_content') return 'commentary';
  if (value === 'mixed') return 'mixed';
  return 'work_itself';
}

export function intentFromModelText(text: string, query: string): DiscoverIntent {
  const fallback = defaultDiscoverIntent(query);
  const rec = parseJsonObject(text);
  if (!rec) return fallback;
  const intent = rec.intent === 'research' || rec.mode === 'research' ? 'research' : 'consume';
  const objectWanted = asObjectWanted(rec.objectWanted);
  const freshness =
    rec.freshness === 'current' || rec.freshness === 'classic' ? rec.freshness : 'unspecified';
  const mediaRaw = Array.isArray(rec.requestedContentTypes)
    ? rec.requestedContentTypes
    : Array.isArray(rec.requestedMedia)
      ? rec.requestedMedia
      : [];
  const requestedMedia = mediaRaw.map(asMediaType).filter((row): row is string => !!row).slice(0, 6);
  const searchQueries: string[] = [];
  if (Array.isArray(rec.searchQueries)) {
    for (const row of rec.searchQueries) {
      const q = String(row || '').trim();
      if (q.length >= 2 && q.length <= 160) searchQueries.push(q);
      if (searchQueries.length >= 3) break;
    }
  }
  const topic = String(rec.topic || '').trim().slice(0, 80) || fallback.topic;
  const popularityClaim = rec.popularityClaim === true;
  const suggestTalk = intent === 'research' || rec.suggestTalk === true;
  const newsFeed = rec.newsFeed === true;
  const reportDayRaw = String(rec.reportDay || '').trim();
  const reportDay = /^\d{4}-\d{2}-\d{2}$/.test(reportDayRaw) ? reportDayRaw : undefined;
  const honestyNote =
    popularityClaim && intent === 'consume'
      ? '没有跨平台统一榜单。下面的推荐依据来自来源里能看到的评价、口碑和内容特点，不是官方排名。'
      : undefined;
  const viewing =
    rec.viewing === 'in_app' || rec.viewing === 'original_site' ? rec.viewing : 'any';
  const preferences = String(rec.preferences || '').trim().slice(0, 160);
  return {
    intent,
    topic,
    requestedMedia,
    objectWanted: intent === 'research' && objectWanted === 'work_itself' ? 'mixed' : objectWanted,
    freshness,
    popularityClaim,
    searchQueries: searchQueries.length ? searchQueries : fallback.searchQueries,
    suggestTalk,
    scope: 'current_search',
    ...(newsFeed ? { newsFeed: true } : {}),
    ...(reportDay ? { reportDay } : {}),
    ...(honestyNote ? { honestyNote } : {}),
    ...(viewing !== 'any' ? { viewing } : {}),
    ...(preferences ? { preferences } : {}),
  };
}

export async function interpretDiscoverIntent(input: {
  query: string;
  chatComplete: ChatCompleteFn;
  model: { baseUrl: string; model: string; apiKey?: string };
  signal?: AbortSignal;
  onAttempt?: (attempt: StructuredAttempt) => void;
}): Promise<DiscoverIntent> {
  const query = String(input.query || '').trim();
  const fallback = defaultDiscoverIntent(query);
  if (!query) return fallback;
  const system = [
    '你在判断用户在「发现」里这一次主动搜索的意图。这是 CURRENT_SEARCH_MODE，不是为你发现。',
    '只输出 JSON，字段：mode, topic, requestedContentTypes, objectWanted, freshness, popularityClaim, searchQueries, suggestTalk, newsFeed, reportDay, viewing, preferences。',
    'mode: consume 或 research。发现的强默认是 consume（看/听/读），不是做研究任务。',
    'topic: 用户这次要的主题短词，不要整句。例如「找几个 AI 视频看看」的 topic 是 AI。',
    'requestedContentTypes: 只允许 article / video / image / audio。点名要看视频、影像、纪录片、片子→["video"]；要图/摄影作品→["image"]；要听、曲子、播客、音乐→["audio"]；要读文章或新闻报道→["article"]。说「内容」且未点名媒介→[]。',
    '例子：「最近值得看的 AI 内容」→ topic:AI, requestedContentTypes:[]；「找几个 AI 视频看看」→ ["video"]；「找一些航天摄影作品」→ ["image"]；「给我听点科技播客」→ ["audio"]；「今天的新闻」→ ["article"]。',
    'objectWanted: primary_content（要作品/正文本身）/ commentary（要报道、盘点、行业分析）/ mixed。',
    'freshness: current / classic / unspecified。current 表示用户在意时效：当下、最近、最新、这阵子。它不等于「今天发布」；只有用户明确要某一天（今天、昨天、某月某日）才算指定日期。',
    'popularityClaim: 用户是否在要「最好/最火/热门/口碑/排行」这类带评价的推荐。为 true 时 searchQueries 里第一条仍然指向作品/节目本身（节目名、系列、官方主页或播放页这类具体对象），另一条才带能找到评价依据的词（如 口碑、评分、获奖），避免全部搜回行业盘点文章。',
    'searchQueries: 1 到 3 条发给公开搜索和开放目录的检索词，不要照抄用户整句。必须留在这次的 topic 与 requestedContentTypes 内。',
    '搜索只按查询文本返回结果，不会另吃时效或新闻分类参数。仅当用户明确要某一天的报道时，第一条 searchQuery 才包含那一天的日期；「当下/最近/最新」不要写成今天的日期。',
    'viewing: 用户说了想在哪里看——「在这里看/应用里播放」填 in_app，「去原站/官网看」填 original_site，没提就填 any。',
    'preferences: 用户这次明确提出的质量、风格、时长、人群等偏好，用一句话保留（例如「口碑好、长视频」）。没有就留空。不要加用户没说的偏好。',
    '若 requestedContentTypes 含 image/video/audio：词应是对应开放目录实际用来找作品本身的常用检索写法；需要时可包含该主题在目录里常见的其它语种名称。不要写排行榜或十大盘点。',
    '不要把当前搜索扩写成用户平时可能喜欢的其它主题。不要加入这次没要求的相邻领域。',
    '若 mode=consume：搜索词指向具体可消费对象本身，不要去搜排行榜、行业新闻、十大盘点，除非用户明确要这些。',
    'suggestTalk: 若更适合在「与兔机米」里深入分析则为 true。',
    'newsFeed: 这次要看近期公开报道，并且应该使用已连接的新闻来源时为 true。图片、音频、视频作品和稳定知识为 false。',
    'reportDay: 仅当用户明确要某一天的报道时才填，写成 YYYY-MM-DD；要今天就填用户消息里的今天。「当下/最近/最新/最好」不是指定某一天，省略。',
    'newsFeed 只用于新闻报道。节目、纪录片、播客、影视、图片、音乐、教程等作品推荐即使要「最新/当下」，也是 false。',
    '不要使用数字之我、长期偏好或最近浏览去扩大范围。不要输出 score。不要编造播放量。',
  ].join('\n');
  const today = localCalendarDate();
  const outcome = await completeStructured<DiscoverIntent>({
    chat: input.chatComplete,
    request: {
      baseUrl: input.model.baseUrl,
      ...(input.model.apiKey ? { apiKey: input.model.apiKey } : {}),
      model: input.model.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `${query}\n今天的日期是 ${today}。` },
      ],
      temperature: 0,
      responseFormat: { type: 'json_object' },
    },
    passes: JUDGMENT_JSON_PASSES,
    parse: (text) => (parseJsonObject(text) ? intentFromModelText(text, query) : null),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.onAttempt ? { onAttempt: input.onAttempt } : {}),
  });
  if (outcome.value) return outcome.value;
  if (input.signal?.aborted) throw new DiscoverIntentError('model', '这次搜索已经取消。');
  if (outcome.lastError instanceof Error) throw outcome.lastError;
  throw new DiscoverIntentError('parse', '这次模型没有给出可用的搜索意图。');
}

export function isDomainLikeTitle(title: string, url?: string): boolean {
  const raw = String(title || '').trim().toLowerCase();
  if (!raw) return true;
  if (/\.(avif|bmp|gif|jpe?g|png|svg|webp|aac|flac|m4a|mp3|ogg|opus|wav|m4v|mkv|mov|mp4|ogv|webm)$/i.test(raw)) {
    return false;
  }
  if (/^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}\/?$/i.test(raw)) return true;
  if (!url) return false;
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return false;
  }
  const compact = raw.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  if (compact === host || compact === host.split('.')[0]) return true;
  if (raw === String(url).toLowerCase()) return true;
  return false;
}

function parsedPublicUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function isSearchResultsUrl(parsed: URL): boolean {
  return (
    parsed.searchParams.has('q') ||
    parsed.searchParams.has('wd') ||
    parsed.searchParams.has('query') ||
    parsed.searchParams.has('search')
  );
}

/** 机械 URL 结构：首页或搜索结果页。不是站点特例表。 */
export function isGenericHubUrl(raw: string): boolean {
  const parsed = parsedPublicUrl(raw);
  if (!parsed) return false;
  const path = (parsed.pathname || '/').replace(/\/+$/, '') || '/';
  if (path === '/' || /^\/index\.html?$/i.test(path)) return true;
  return isSearchResultsUrl(parsed);
}

/** 网站首页。搜索结果页不是可继续取报道的入口。 */
export function isSiteEntranceUrl(raw: string): boolean {
  const parsed = parsedPublicUrl(raw);
  if (!parsed || isSearchResultsUrl(parsed)) return false;
  const path = (parsed.pathname || '/').replace(/\/+$/, '') || '/';
  return path === '/' || /^\/index\.html?$/i.test(path);
}

export function isPrimaryContentRole(role: ContentPageRole | undefined): boolean {
  return role === 'PRIMARY_CONTENT' || role === 'SERIES' || role === 'EPISODE';
}

export function isRelatedInfoRole(role: ContentPageRole | undefined): boolean {
  return role === 'COMMENTARY' || role === 'HUB' || role === 'LISTING';
}

export function objectFidelity(role: ContentPageRole | undefined, intent?: DiscoverIntent): ObjectFidelity {
  if (isPrimaryContentRole(role)) return 'PRIMARY_CONTENT';
  const mediaStrict = intent
    ? intent.requestedMedia.filter((row) => row === 'video' || row === 'audio' || row === 'image')
    : [];
  if (
    role === 'COMMENTARY' &&
    (!intent || intent.intent === 'consume') &&
    mediaStrict.length === 0
  ) {
    return 'PRIMARY_CONTENT';
  }
  if (isRelatedInfoRole(role)) return 'ABOUT_CONTENT';
  return 'UNRELATED';
}

export function strictRequestedTypes(intent: DiscoverIntent): string[] {
  if (intent.intent !== 'consume') return [];
  return intent.requestedMedia.filter(
    (row) => row === 'article' || row === 'video' || row === 'audio' || row === 'image',
  );
}

export type CandidateMedium = 'article' | 'video' | 'audio' | 'image' | 'unknown';

export interface CandidateJudgment {
  role: ContentPageRole;
  /** 模型从页面内容判断的主要消费形态。不要求页面有直接播放文件。 */
  medium: CandidateMedium;
  /** 推荐依据：只来自候选材料里可见的评价、口碑、内容特点，没有就为空。 */
  basis: string;
  /** 去掉导航、赞助、目录杂项后的简短摘要。只依据候选给出的文字，没有可用信息则为空。 */
  summary: string;
  /** 用户这次明确提出的条件（高分、长视频、适合周末……）材料是否确认满足；没提条件为 none。 */
  conditions: CandidateConditions;
}

export type CandidateConditions = 'met' | 'unconfirmed' | 'none';

const CANDIDATE_MEDIA = new Set(['article', 'video', 'audio', 'image']);
const CANDIDATE_CONDITIONS = new Set(['met', 'unconfirmed', 'none']);

export function judgmentsFromModelText(text: string, ids: string[]): Map<string, CandidateJudgment> {
  const rec = parseJsonObject(text);
  const out = new Map<string, CandidateJudgment>();
  const rows = rec && Array.isArray(rec.roles) ? rec.roles : [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const recRow = row as Record<string, unknown>;
    const id = String(recRow.id || '').trim();
    const role = String(recRow.role || '')
      .trim()
      .toUpperCase();
    if (!ids.includes(id) || !PAGE_ROLES.has(role)) continue;
    const mediumRaw = asMediaType(recRow.medium);
    const conditionsRaw = String(recRow.conditions || '').trim().toLowerCase();
    out.set(id, {
      role: role as ContentPageRole,
      medium: mediumRaw && CANDIDATE_MEDIA.has(mediumRaw) ? (mediumRaw as CandidateMedium) : 'unknown',
      basis: String(recRow.basis || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      summary: String(recRow.summary || '').replace(/\s+/g, ' ').trim().slice(0, 240),
      conditions: CANDIDATE_CONDITIONS.has(conditionsRaw) ? (conditionsRaw as CandidateConditions) : 'none',
    });
  }
  return out;
}

export function rolesFromModelText(text: string, ids: string[]): Map<string, ContentPageRole> {
  const out = new Map<string, ContentPageRole>();
  for (const [id, row] of judgmentsFromModelText(text, ids)) out.set(id, row.role);
  return out;
}

export async function classifyCandidateRoles(input: {
  query: string;
  intent: DiscoverIntent;
  candidates: ConsumableCandidate[];
  chatComplete?: ChatCompleteFn;
  model?: { baseUrl: string; model: string; apiKey?: string };
  signal?: AbortSignal;
  onAttempt?: (attempt: StructuredAttempt) => void;
}): Promise<{
  roles: Map<string, ContentPageRole>;
  judgments: Map<string, CandidateJudgment>;
  unjudgedIds: string[];
  attempts: number;
}> {
  const empty = {
    roles: new Map<string, ContentPageRole>(),
    judgments: new Map<string, CandidateJudgment>(),
    unjudgedIds: [] as string[],
    attempts: 0,
  };
  if (!input.candidates.length || !input.chatComplete || !input.model) return empty;
  const system = [
    '你在判断每个候选相对「用户这次搜索」的对象忠实度，并写出推荐依据。只输出 JSON：{"roles":[{"id":"","role":"","medium":"","conditions":"","basis":"","summary":""}]}。',
    'role 只能是 PRIMARY_CONTENT、SERIES、EPISODE、HUB、LISTING、COMMENTARY、UNRELATED。',
    'PRIMARY_CONTENT：相对用户这次请求要消费的对象本身。未点名媒介时，主题匹配的文章、视频、图片、音频都是 PRIMARY_CONTENT；不要因为是 Article 就标 COMMENTARY。',
    'SERIES：一部作品、节目或播客的主页/详情页。',
    'EPISODE：一集、一章或一条具体内容。',
    'HUB：平台频道、分类、专题入口、网站首页。',
    'LISTING：榜单、集合、搜索页、把多部作品打包推荐的页面。',
    'COMMENTARY：候选不是这次要消费的对象，而是在谈论该对象。仅当用户点名要视频/图片/音频时，介绍它们的文章才是 COMMENTARY。',
    'UNRELATED：主题不在这次搜索范围内。即使它可能符合用户平时其它兴趣，也标 UNRELATED。',
    '用户这次在 query / preferences 里明确提出的条件（例如纪录片、长视频、适合周末看、高分、口碑好）也属于这次的范围：候选虽然是作品本身，但明显不满足这些条件（例如要长视频，它只是几分钟的片段），标 UNRELATED。durationSeconds 是来源给出的时长，没有就是不知道。',
    'conditions：用户这次没有提出这类条件写 none；候选材料能确认满足写 met；材料不足以确认写 unconfirmed，并在 basis 里写明哪一条还没确认。只看候选材料，不凭作品名气替材料确认。',
    '能不能在应用里直接播放，与它是否符合这次请求无关，不能因此判为 PRIMARY_CONTENT。',
    'medium：该候选本身主要是 article / video / audio / image 哪一种，由页面内容判断；看不出就写 unknown。节目主页、系列页、单集页是否有直接播放文件，不影响 role，也不影响 medium。',
    '用户要视频或节目：具体视频、节目主页、系列页、单集页都是有效的推荐对象，用户可以去原站观看；《最佳视频榜单》这类文章是 LISTING/COMMENTARY。',
    '用户要摄影作品：具体照片/图集是 PRIMARY_CONTENT；盘点文章是 COMMENTARY。',
    '用户要播客或音乐：节目、专辑或单集页面是 PRIMARY_CONTENT；介绍文章是 COMMENTARY。',
    '用户要「AI 内容」且未点名媒介：一篇具体 AI 文章是 PRIMARY_CONTENT。',
    '仅当 newsFeed 为 true（用户要的是某段时间的新闻报道）时：带发布时间、且标题和正文对得上的具体报道才是 PRIMARY_CONTENT。综述、盘点、事件日历、百科栏目、词条说明和网站首页不是报道，标 LISTING、HUB 或 UNRELATED。没有发布时间的候选，不要当成新闻。newsFeed 不是 true 时，freshness 只是用户对时效的偏好：来源给出的发布时间可以作为依据，但没有日期的好作品不因此被排除。',
    'basis：一句话说明为什么值得推荐。只能依据候选的标题、摘要、发布时间和其中明确出现的评价、口碑、获奖、内容特点，并对照用户这次的 preferences。材料里没有评价依据时留空，不要编造排名、评分、播放量。popularityClaim 为 true 时尤其不能凭空说"最好"。',
    'summary：把候选给出的文字整理成一两句有用的介绍。去掉导航、赞助、版权、目录、推广这类与内容无关的杂项；只能用候选原文里已有的信息，不要补充；原文里没有有用信息就留空。',
    '每个候选都要有一条 role。不要看域名做决定。不要输出 score。不要用用户长期偏好扩大范围。',
  ].join('\n');
  const today = localCalendarDate();
  const chat = input.chatComplete;
  const model = input.model;
  const batchSize = 4;
  let attempts = 0;

  const judgeBatch = async (batch: ConsumableCandidate[]): Promise<Map<string, CandidateJudgment> | null> => {
    const ids = batch.map((row) => row.id);
    const user = JSON.stringify({
      query: input.query,
      mode: input.intent.intent,
      topic: input.intent.topic,
      scope: 'current_search',
      objectWanted: input.intent.objectWanted,
      freshness: input.intent.freshness,
      newsFeed: input.intent.newsFeed === true,
      popularityClaim: input.intent.popularityClaim,
      ...(input.intent.preferences ? { preferences: input.intent.preferences } : {}),
      ...(input.intent.reportDay ? { reportDay: input.intent.reportDay } : {}),
      today,
      requestedContentTypes: input.intent.requestedMedia,
      candidates: batch.map((row) => ({
        id: row.id,
        title: row.title,
        url: row.url,
        contentType: row.contentType || '',
        ...(row.publishedAt ? { publishedAt: row.publishedAt } : {}),
        ...(row.durationSeconds ? { durationSeconds: row.durationSeconds } : {}),
        summary: row.summary.slice(0, 400),
      })),
    });
    const outcome = await completeStructured<Map<string, CandidateJudgment>>({
      chat,
      request: {
        baseUrl: model.baseUrl,
        ...(model.apiKey ? { apiKey: model.apiKey } : {}),
        model: model.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        responseFormat: { type: 'json_object' },
      },
      passes: JUDGMENT_JSON_PASSES,
      parse: (text) => {
        const parsed = judgmentsFromModelText(text, ids);
        return parsed.size ? parsed : null;
      },
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onAttempt ? { onAttempt: input.onAttempt } : {}),
    });
    attempts += outcome.attempts;
    return outcome.value;
  };

  const batches: ConsumableCandidate[][] = [];
  for (let index = 0; index < input.candidates.length; index += batchSize) {
    batches.push(input.candidates.slice(index, index + batchSize));
  }
  // 各批互不依赖，并行判断；任一批失败只影响它自己的候选。
  const results = await Promise.all(batches.map((batch) => judgeBatch(batch)));
  const roles = new Map<string, ContentPageRole>();
  const judgments = new Map<string, CandidateJudgment>();
  const unjudgedIds: string[] = [];
  batches.forEach((batch, i) => {
    const judged = results[i];
    if (!judged) {
      unjudgedIds.push(...batch.map((row) => row.id));
      return;
    }
    for (const [id, row] of judged) {
      judgments.set(id, row);
      roles.set(id, row.role);
    }
    for (const row of batch) {
      if (!judged.has(row.id)) unjudgedIds.push(row.id);
    }
  });
  return { roles, judgments, unjudgedIds, attempts };
}

export interface MentionedWork {
  title: string;
  kind: string;
  medium: CandidateMedium;
  sourceId: string;
  /** 只转述来源材料对这部作品的评价或介绍。 */
  basis: string;
  searchQuery: string;
}

const groundKey = (value: string) =>
  String(value || '')
    .replace(/[《》〈〉「」『』“”"'‘’\s·・:：,，。.!！?？()（）\-—_]/g, '')
    .toLowerCase();

/**
 * 从这次实际读到的片单、榜单、评论里取出被点名、并符合这次请求的作品。
 * 只收原文里出现过的名字（机械核对），作品是否存在、去哪里看由调用方用现有搜索再核实。
 */
export async function extractMentionedWorks(input: {
  query: string;
  intent: DiscoverIntent;
  sources: Array<{ id: string; title: string; text: string }>;
  chatComplete?: ChatCompleteFn;
  model?: { baseUrl: string; model: string; apiKey?: string };
  signal?: AbortSignal;
  onAttempt?: (attempt: StructuredAttempt) => void;
}): Promise<MentionedWork[]> {
  if (!input.sources.length || !input.chatComplete || !input.model) return [];
  const system = [
    '你在读用户这次搜索读到的片单、榜单和评论文章，从中取出被明确点名、并且符合用户这次请求的具体作品（节目、剧集、电影、纪录片、播客、专辑等）。只输出 JSON：{"works":[{"title":"","kind":"","medium":"","sourceId":"","basis":"","searchQuery":""}]}。',
    'title：作品名，必须和材料原文里写的一致，不翻译、不补全、不改写。材料没有点名的作品不要输出。',
    'kind：材料能确定的作品类型，例如纪录片、电视剧、电影、综艺、播客；不确定就留空。',
    'medium：video、audio 或 unknown。',
    'sourceId：这部作品出现在哪一篇材料里。',
    'basis：只转述这篇材料对这部作品的评价或介绍。材料里没有的评分、排名、时长、播放量一律不写，不要编造。',
    'searchQuery：用来找到这部作品能直接观看或收听的页面（正片、播放页、官方节目页）的搜索词，不是找百科或影评；材料提到播出平台时可以带上。',
    '按用户这次的条件挑（例如长视频、纪录片、适合周末），明显不符合的不要输出。最多 4 部，挑材料里评价最明确的，宁缺毋滥；多篇材料提到的同一部只输出一次。',
  ].join('\n');
  const user = JSON.stringify({
    query: input.query,
    topic: input.intent.topic,
    requestedContentTypes: input.intent.requestedMedia,
    ...(input.intent.preferences ? { preferences: input.intent.preferences } : {}),
    sources: input.sources.map((row) => ({ id: row.id, title: row.title, text: row.text.slice(0, 1800) })),
  });
  const byId = new Map(input.sources.map((row) => [row.id, groundKey(`${row.title}\n${row.text}`)]));
  const outcome = await completeStructured<MentionedWork[]>({
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
    passes: JUDGMENT_JSON_PASSES,
    parse: (text) => {
      const rec = parseJsonObject(text);
      if (!rec || !Array.isArray(rec.works)) return null;
      const seen = new Set<string>();
      const out: MentionedWork[] = [];
      for (const row of rec.works) {
        if (!row || typeof row !== 'object') continue;
        const r = row as Record<string, unknown>;
        const title = String(r.title || '').replace(/[《》]/g, '').trim().slice(0, 80);
        const sourceId = String(r.sourceId || '').trim();
        const key = groundKey(title);
        const source = byId.get(sourceId);
        if (key.length < 2 || !source || !source.includes(key) || seen.has(key)) continue;
        seen.add(key);
        const medium = asMediaType(r.medium);
        out.push({
          title,
          kind: String(r.kind || '').trim().slice(0, 20),
          medium: medium === 'video' || medium === 'audio' ? medium : 'unknown',
          sourceId,
          basis: String(r.basis || '').replace(/\s+/g, ' ').trim().slice(0, 200),
          searchQuery: String(r.searchQuery || '').trim().slice(0, 80) || title,
        });
        if (out.length >= 4) break;
      }
      return out;
    },
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.onAttempt ? { onAttempt: input.onAttempt } : {}),
  });
  return outcome.value || [];
}
