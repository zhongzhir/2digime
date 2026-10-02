/**
 * 发现页消费意图：由真实模型输出结构化 JSON。
 * 禁止按查询词 if/else 分流 consume / research。
 */
import type { ChatCompleteFn } from '../subject-core/structured-distill';

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
  honestyNote?: string;
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
}

export function localCalendarDate(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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
  const honestyNote =
    popularityClaim && intent === 'consume'
      ? '没有跨平台统一播放榜，先找近期公开、可以看/听/读的内容。'
      : undefined;
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
    ...(honestyNote ? { honestyNote } : {}),
  };
}

export async function interpretDiscoverIntent(input: {
  query: string;
  chatComplete: ChatCompleteFn;
  model: { baseUrl: string; model: string; apiKey?: string };
}): Promise<DiscoverIntent> {
  const query = String(input.query || '').trim();
  const fallback = defaultDiscoverIntent(query);
  if (!query) return fallback;
  const system = [
    '你在判断用户在「发现」里这一次主动搜索的意图。这是 CURRENT_SEARCH_MODE，不是为你发现。',
    '只输出 JSON，字段：mode, topic, requestedContentTypes, objectWanted, freshness, popularityClaim, searchQueries, suggestTalk。',
    'mode: consume 或 research。发现的强默认是 consume（看/听/读），不是做研究任务。',
    'topic: 用户这次要的主题短词，不要整句。例如「找几个 AI 视频看看」的 topic 是 AI。',
    'requestedContentTypes: 只允许 article / video / image / audio。点名要看视频、影像、纪录片、片子→["video"]；要图/摄影作品→["image"]；要听、曲子、播客、音乐→["audio"]；要读文章或新闻报道→["article"]。说「内容」且未点名媒介→[]。',
    '例子：「最近值得看的 AI 内容」→ topic:AI, requestedContentTypes:[]；「找几个 AI 视频看看」→ ["video"]；「找一些航天摄影作品」→ ["image"]；「给我听点科技播客」→ ["audio"]；「今天的新闻」→ ["article"]。',
    'objectWanted: primary_content（要作品/正文本身）/ commentary（要报道、盘点、行业分析）/ mixed。',
    'freshness: current / classic / unspecified。',
    'popularityClaim: 用户是否在要「最火/热门/排行」且你没有统一播放榜可引用。',
    'searchQueries: 1 到 3 条发给公开搜索和开放目录的检索词，不要照抄用户整句。必须留在这次的 topic 与 requestedContentTypes 内。',
    '托管搜索只按查询文本返回结果，不会另吃时效或新闻分类参数。用户消息里有今天的日期。若 freshness 为 current，第一条 searchQuery 要包含这个日期，用来找具体报道，而不是栏目名或百科词条。',
    '若 requestedContentTypes 含 image/video/audio：词应是对应开放目录实际用来找作品本身的常用检索写法；需要时可包含该主题在目录里常见的其它语种名称。不要写排行榜或十大盘点。',
    '不要把当前搜索扩写成用户平时可能喜欢的其它主题。不要加入这次没要求的相邻领域。',
    '若 mode=consume：搜索词指向具体可消费对象本身，不要去搜排行榜、行业新闻、十大盘点，除非用户明确要这些。',
    'suggestTalk: 若更适合在「与兔机米」里深入分析则为 true。',
    '不要使用数字之我、长期偏好或最近浏览去扩大范围。不要输出 score。不要编造播放量。',
  ].join('\n');
  try {
    const today = localCalendarDate();
    const ask = (maxTokens: number) =>
      input.chatComplete({
        baseUrl: input.model.baseUrl,
        ...(input.model.apiKey ? { apiKey: input.model.apiKey } : {}),
        model: input.model.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `${query}\n今天的日期是 ${today}。` },
        ],
        temperature: 0,
        maxTokens,
        timeoutMs: 45_000,
        responseFormat: { type: 'json_object' },
      });
    let result = await ask(800);
    if (result.truncated || !parseJsonObject(result.text)) {
      result = await ask(1600);
    }
    return intentFromModelText(result.text, query);
  } catch {
    return fallback;
  }
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

export function rolesFromModelText(text: string, ids: string[]): Map<string, ContentPageRole> {
  const rec = parseJsonObject(text);
  const out = new Map<string, ContentPageRole>();
  const rows = rec && Array.isArray(rec.roles) ? rec.roles : [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const recRow = row as Record<string, unknown>;
    const id = String(recRow.id || '').trim();
    const role = String(recRow.role || '')
      .trim()
      .toUpperCase();
    if (!ids.includes(id) || !PAGE_ROLES.has(role)) continue;
    out.set(id, role as ContentPageRole);
  }
  return out;
}

export async function classifyCandidateRoles(input: {
  query: string;
  intent: DiscoverIntent;
  candidates: ConsumableCandidate[];
  chatComplete?: ChatCompleteFn;
  model?: { baseUrl: string; model: string; apiKey?: string };
}): Promise<{ roles: Map<string, ContentPageRole>; unjudgedIds: string[] }> {
  const empty = { roles: new Map<string, ContentPageRole>(), unjudgedIds: [] as string[] };
  if (!input.candidates.length || !input.chatComplete || !input.model) return empty;
  const system = [
    '你在判断每个候选相对「用户这次搜索」的对象忠实度。只输出 JSON：{"roles":[{"id":"","role":""}]}。',
    'role 只能是 PRIMARY_CONTENT、SERIES、EPISODE、HUB、LISTING、COMMENTARY、UNRELATED。',
    'PRIMARY_CONTENT：相对用户这次请求要消费的对象本身。未点名媒介时，主题匹配的文章、视频、图片、音频都是 PRIMARY_CONTENT；不要因为是 Article 就标 COMMENTARY。',
    'SERIES：一部作品或播客的主页/详情页。',
    'EPISODE：可直接看/读/听的一集、一章或一条内容。',
    'HUB：平台频道、分类、专题入口、网站首页。',
    'LISTING：榜单、集合、搜索页、把多部作品打包推荐的页面。',
    'COMMENTARY：候选不是这次要消费的对象，而是在谈论该对象。仅当用户点名要视频/图片/音频时，介绍它们的文章才是 COMMENTARY。',
    'UNRELATED：主题不在这次搜索范围内。即使它可能符合用户平时其它兴趣，也标 UNRELATED。',
    '用户要视频：具体视频是 PRIMARY_CONTENT；《最佳视频榜单》文章是 LISTING/COMMENTARY。',
    '用户要摄影作品：具体照片/图集是 PRIMARY_CONTENT；盘点文章是 COMMENTARY。',
    '用户要播客或音乐：可播放的音频或进入播放的页面是 PRIMARY_CONTENT；介绍文章是 COMMENTARY。',
    '用户要「AI 内容」且未点名媒介：一篇具体 AI 文章是 PRIMARY_CONTENT。',
    '若 freshness 为 current：带发布时间、且标题和正文对得上的具体报道才是 PRIMARY_CONTENT。查询里的日期只是线索，不是时效证据。综述、盘点、事件日历、百科栏目、词条说明和网站首页不是当天报道，标 LISTING、HUB 或 UNRELATED，不要标 PRIMARY_CONTENT。没有发布时间的候选，不要因为它出现在搜索里就当成当天新闻。',
    '每个候选都要有一条 role。不要看域名做决定。不要输出 score。不要用用户长期偏好扩大范围。',
  ].join('\n');
  const today = localCalendarDate();
  const chat = input.chatComplete;
  const model = input.model;
  const roles = new Map<string, ContentPageRole>();
  const unjudgedIds: string[] = [];
  const batchSize = 4;

  const judgeBatch = async (batch: ConsumableCandidate[]): Promise<Map<string, ContentPageRole> | null> => {
    const ids = batch.map((row) => row.id);
    const user = JSON.stringify({
      query: input.query,
      mode: input.intent.intent,
      topic: input.intent.topic,
      scope: 'current_search',
      objectWanted: input.intent.objectWanted,
      freshness: input.intent.freshness,
      today,
      requestedContentTypes: input.intent.requestedMedia,
      candidates: batch.map((row) => ({
        id: row.id,
        title: row.title,
        url: row.url,
        contentType: row.contentType || '',
        ...(row.publishedAt ? { publishedAt: row.publishedAt } : {}),
        summary: row.summary.slice(0, 240),
      })),
    });
    const attempts: Array<{ maxTokens: number; jsonObject: boolean }> = [
      { maxTokens: 1600, jsonObject: true },
      { maxTokens: 4096, jsonObject: false },
    ];
    for (const attempt of attempts) {
      try {
        const result = await chat({
          baseUrl: model.baseUrl,
          ...(model.apiKey ? { apiKey: model.apiKey } : {}),
          model: model.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0,
          maxTokens: attempt.maxTokens,
          timeoutMs: 45_000,
          ...(attempt.jsonObject ? { responseFormat: { type: 'json_object' as const } } : {}),
        });
        const parsed = rolesFromModelText(result.text, ids);
        if (parsed.size) return parsed;
        if (!result.truncated && parseJsonObject(result.text)) return parsed;
      } catch {
        /* 这一轮失败就换预算再判，不结束整次搜索 */
      }
    }
    return null;
  };

  for (let index = 0; index < input.candidates.length; index += batchSize) {
    const batch = input.candidates.slice(index, index + batchSize);
    const judged = await judgeBatch(batch);
    if (!judged) {
      unjudgedIds.push(...batch.map((row) => row.id));
      continue;
    }
    for (const [id, role] of judged) roles.set(id, role);
    for (const row of batch) {
      if (!judged.has(row.id)) unjudgedIds.push(row.id);
    }
  }
  return { roles, unjudgedIds };
}
