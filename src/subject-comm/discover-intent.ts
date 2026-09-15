/**
 * 发现页消费意图：由真实模型输出结构化 JSON。
 * 禁止按查询词 if/else 分流 consume / research。
 */
import type { ChatCompleteFn } from '../subject-core/structured-distill';

export type DiscoverIntentKind = 'consume' | 'research';
export type DiscoverObjectWanted = 'work_itself' | 'commentary' | 'mixed';
export type DiscoverFreshness = 'current' | 'classic' | 'unspecified';

export interface DiscoverIntent {
  intent: DiscoverIntentKind;
  requestedMedia: string[];
  objectWanted: DiscoverObjectWanted;
  freshness: DiscoverFreshness;
  popularityClaim: boolean;
  searchQueries: string[];
  suggestTalk: boolean;
  honestyNote?: string;
}

export type ContentPageRole =
  | 'PRIMARY_CONTENT'
  | 'SERIES'
  | 'EPISODE'
  | 'HUB'
  | 'LISTING'
  | 'COMMENTARY';

const PAGE_ROLES = new Set<string>([
  'PRIMARY_CONTENT',
  'SERIES',
  'EPISODE',
  'HUB',
  'LISTING',
  'COMMENTARY',
]);

export interface ConsumableCandidate {
  id: string;
  title: string;
  url: string;
  summary: string;
}

export function defaultDiscoverIntent(query: string): DiscoverIntent {
  const q = String(query || '').trim();
  return {
    intent: 'consume',
    requestedMedia: [],
    objectWanted: 'work_itself',
    freshness: 'unspecified',
    popularityClaim: false,
    searchQueries: q ? [q] : [],
    suggestTalk: false,
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

export function intentFromModelText(text: string, query: string): DiscoverIntent {
  const fallback = defaultDiscoverIntent(query);
  const rec = parseJsonObject(text);
  if (!rec) return fallback;
  const intent = rec.intent === 'research' ? 'research' : 'consume';
  const objectWanted =
    rec.objectWanted === 'commentary' || rec.objectWanted === 'mixed' ? rec.objectWanted : 'work_itself';
  const freshness =
    rec.freshness === 'current' || rec.freshness === 'classic' ? rec.freshness : 'unspecified';
  const requestedMedia = Array.isArray(rec.requestedMedia)
    ? rec.requestedMedia.map((row) => String(row || '').trim()).filter((row) => row.length >= 2).slice(0, 6)
    : [];
  const searchQueries: string[] = [];
  if (Array.isArray(rec.searchQueries)) {
    for (const row of rec.searchQueries) {
      const q = String(row || '').trim();
      if (q.length >= 2 && q.length <= 160) searchQueries.push(q);
      if (searchQueries.length >= 3) break;
    }
  }
  const popularityClaim = rec.popularityClaim === true;
  const suggestTalk = intent === 'research' || rec.suggestTalk === true;
  const honestyNote =
    popularityClaim && intent === 'consume'
      ? '没有跨平台统一播放榜，先找近期公开、可以看/听/读的内容。'
      : undefined;
  return {
    intent,
    requestedMedia,
    objectWanted: intent === 'research' && objectWanted === 'work_itself' ? 'mixed' : objectWanted,
    freshness,
    popularityClaim,
    searchQueries: searchQueries.length ? searchQueries : fallback.searchQueries,
    suggestTalk,
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
    '你在判断用户在「发现」里的意图。发现的强默认是消费内容（看/听/读），不是做研究任务。',
    '只输出 JSON，字段：intent, requestedMedia, objectWanted, freshness, popularityClaim, searchQueries, suggestTalk。',
    'intent: consume 或 research。',
    'requestedMedia: 如 article / video / image / audio。用户要读用 article，要看视频用 video，要看图用 image，要听用 audio。',
    'objectWanted: work_itself（要正文/作品/可看内容本身）/ commentary（要报道、盘点、行业分析）/ mixed。',
    'freshness: current / classic / unspecified。',
    'popularityClaim: 用户是否在要「最火/热门/排行」且你没有统一播放榜可引用。',
    'searchQueries: 1 到 2 条可发给公开搜索的词，指向具体可消费内容或开放内容出口；不要指定必须去哪个网站。',
    '若 intent=consume：搜索词指向文章/视频/图片/音频/播客本身，不要去搜排行榜、行业新闻、十大盘点，除非用户明确要这些。',
    'suggestTalk: 若更适合在「与兔机米」里深入分析则为 true。',
    '不要输出 score。不要编造播放量。',
  ].join('\n');
  try {
    const result = await input.chatComplete({
      baseUrl: input.model.baseUrl,
      ...(input.model.apiKey ? { apiKey: input.model.apiKey } : {}),
      model: input.model.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: query },
      ],
      temperature: 0,
      maxTokens: 500,
      timeoutMs: 45_000,
      responseFormat: { type: 'json_object' },
    });
    return intentFromModelText(result.text, query);
  } catch {
    return fallback;
  }
}

export function isDomainLikeTitle(title: string, url?: string): boolean {
  const raw = String(title || '').trim().toLowerCase();
  if (!raw) return true;
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

/** 机械 URL 结构：首页或搜索结果页。不是站点特例表。 */
export function isGenericHubUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  const path = (parsed.pathname || '/').replace(/\/+$/, '') || '/';
  if (path === '/' || /^\/index\.html?$/i.test(path)) return true;
  if (
    parsed.searchParams.has('q') ||
    parsed.searchParams.has('wd') ||
    parsed.searchParams.has('query') ||
    parsed.searchParams.has('search')
  ) {
    return true;
  }
  return false;
}

export function isPrimaryContentRole(role: ContentPageRole | undefined): boolean {
  return role === 'PRIMARY_CONTENT' || role === 'SERIES' || role === 'EPISODE';
}

export function isRelatedInfoRole(role: ContentPageRole | undefined): boolean {
  return role === 'COMMENTARY' || role === 'HUB' || role === 'LISTING';
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
}): Promise<Map<string, ContentPageRole>> {
  const ids = input.candidates.map((row) => row.id);
  if (!input.candidates.length || !input.chatComplete || !input.model) return new Map();
  const system = [
    '你在判断每个候选相对「用户这次请求」的角色。只输出 JSON：{"roles":[{"id":"","role":""}]}。',
    'role 只能是 PRIMARY_CONTENT、SERIES、EPISODE、HUB、LISTING、COMMENTARY。',
    'PRIMARY_CONTENT：用户这次要消费的对象本身，包括要读的那篇文章、要看的那条视频、要看的那张图、要听的那期节目。',
    'SERIES：一部作品或播客的主页/详情页。',
    'EPISODE：可直接看/读/听的一集、一章或一条内容。',
    'HUB：平台频道、分类、专题入口、网站首页。',
    'LISTING：榜单、集合、搜索页、把多部作品打包推荐的页面。',
    'COMMENTARY：候选不是对象本身，而是在谈论该对象的新闻、行业分析、盘点或介绍。',
    '不要因为候选是文章就标 COMMENTARY。用户要读的那篇文章是 PRIMARY_CONTENT；用户要看视频或听播客时，介绍/盘点多部作品的页面是 LISTING 或 COMMENTARY。',
    '不要看域名做决定。不要输出 score。',
  ].join('\n');
  const user = JSON.stringify({
    query: input.query,
    intent: input.intent.intent,
    objectWanted: input.intent.objectWanted,
    requestedMedia: input.intent.requestedMedia,
    candidates: input.candidates.map((row) => ({
      id: row.id,
      title: row.title,
      url: row.url,
      summary: row.summary.slice(0, 240),
    })),
  });
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
      maxTokens: 800,
      timeoutMs: 45_000,
      responseFormat: { type: 'json_object' },
    });
    return rolesFromModelText(result.text, ids);
  } catch {
    return new Map();
  }
}
