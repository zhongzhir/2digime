/**
 * ConversationSearch — 对话信息能力主框架（DIGITALME-CONVERSATION-QUALITY-RECOVERY-01）。
 *
 * 层：2digime → SearchNeedDecision（模型判断）→ External Capability Contract
 *     → Search/Research Connector → 真实外部能力。
 *
 * 正式链路：search → candidate sources → read/retrieve evidence → evidence chunks
 *     → claim-grounded synthesis → citation（绑定 evidence，禁止凭 URL 猜引用）。
 *
 * 纯编排：不持有 Store，不写 Owner 事实。搜索产物一律 sourceClass='external'，
 * 不进入 userVisibleFacts / growth 事件（唯一入口在壳层按既有成长规则收口）。
 *
 * 依赖注入：chat 完成真实模型调用（决策/综合），connector 完成真实搜索与 evidence 读取——
 * 两者在测试中都可替换为 fake，保证离线可测；生产由壳层注入真实实现。
 */
import type { SearchConnector } from './search-connector';
import { deriveSourceType } from './adapters/bing-html-search';
import {
  type SearchMode,
  type SearchNeed,
  type SearchEvidence,
  type SearchSource,
  type SearchRound,
  type ResearchGap,
  type CitationReport,
  EXTERNAL_SOURCE_CLASS,
  hasUsableWebEvidence,
} from './search-contract';
import {
  classifySearchClosure,
  type CapabilityResolution,
} from './capability-closure';

export interface ConversationChatResult {
  text: string;
  finishReason?: string;
  truncated?: boolean;
}

export type ConversationChat = (messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>, opts?: {
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json_object';
}) => Promise<ConversationChatResult>;

export interface ConversationSearchOptions {
  userText: string;
  /** 最近对话轮次（不含当前用户句），用于综合上下文。 */
  turns?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Digital Me 已确认本人事实（owner context）。 */
  subjectFacts?: string[];
  /** 当前日期（YYYY-MM-DD），注入时效性。 */
  currentDate?: string;
  chat: ConversationChat;
  connector: SearchConnector;
  /** 显式 degraded fallback connector（如 Bing）。主 connector（如 Gemini）provider 失败时，
   *  由编排显式使用 fallback 并标记 providerDegraded；不得把 fallback 结果标成正式 grounded search。 */
  fallbackConnector?: SearchConnector;
  /** 主 provider 标识（供诊断/日志，不含 secret）。 */
  providerId?: string;
  /** 显式任务特征硬覆盖（优先级最高）：用户明确说不搜索 → no_search。 */
  noSearchOverride?: boolean;
  /** 显式任务特征：用户明确要快速搜索。 */
  webSearchHint?: boolean;
  /** 显式任务特征：用户明确要深入研究。 */
  deepResearchHint?: boolean;
  /** 最大查询数（web_search 每轮默认 2）。 */
  maxQueries?: number;
  /** 深度研究最大搜索轮数。 */
  maxResearchIterations?: number;
  /** 每题最多抓取 evidence 的来源数（默认 4）。 */
  maxEvidenceReads?: number;
  signal?: AbortSignal;
}

export interface ConversationSearchDecision {
  mode: SearchMode;
  queries: string[];
}

export interface ConversationSearchReply {
  mode: SearchMode;
  text: string;
  evidence: SearchEvidence;
  /** 是否有真实外部来源参与。 */
  usedExternal: boolean;
}

export class ConversationSearchError extends Error {
  readonly kind: 'decision' | 'search' | 'synthesis' | 'override';
  constructor(kind: ConversationSearchError['kind'], message: string) {
    super(message);
    this.name = 'ConversationSearchError';
    this.kind = kind;
  }
}

/** 最终合成独立 output budget：research reasoning（决策/gap）用小预算，最终答案给足。 */
const SYNTHESIS_MAX_TOKENS = 4096;
/**
 * 决策/研究推理（plan/gap）预算：与最终答案分离。
 * 必须足够容纳 deepseek-v4 的 reasoning_content + 含证据的 JSON 输出，
 * 否则 reasoning 会吃光预算导致 content 为空/截断。仍与最终答案预算分离。
 */
const RESEARCH_MAX_TOKENS = 4000;
/** 决策（短 JSON）预算，留足余量避免 reasoning 挤占。 */
const DECISION_MAX_TOKENS = 1200;

/**
 * 决策系统提示：模型结构化判断 SearchNeed（mode/reason/freshness/external/complexity），
 * 不做关键词 if/else；硬覆盖仅限用户显式意图（不要联网/搜索一下/深入研究）。
 */
function decisionSystemPrompt(currentDate?: string): string {
  const dateLine = currentDate ? `今天是${currentDate}。` : '';
  return (
    `${dateLine}你是搜索决策器。判断这条用户消息是否需要外部网络信息，输出结构化决策。` +
    '只输出JSON：{"mode":"no_search"|"web_search"|"deep_research","reason":"一句话理由",' +
    '"freshnessRequired":布尔（答案是否随时间变化/需要最新状态）,' +
    '"externalVerificationRequired":布尔（是否需外部权威事实核验、本地知识可能过时）,' +
    '"researchComplexity":1-5整数（交叉验证需求强度）,' +
    '"queries":[...]}。' +
    '规则：常识/推理/写作/本人已有上下文足够→no_search（queries空）；' +
    '最新信息/实时事实核验/价格政策新闻/公司产品现状/统计数据/汇率/人口等具体现实数字，本地模型知识可能过时→web_search（1-3条精炼查询）；' +
    '需要准确确认特定年份/特定日期的现实世界日历、节假日、官方时间安排（如某年春节、某年某节、选举/考试/赛事日期）→web_search（这类答案随年份/日历规则变化，本地记忆可能过时或记错，必须外部核验）→externalVerificationRequired=true；' +
    '需要权威来源核验的主张（医学健康、科学事实、法规政策、有争议的说法）→web_search（即使你自以为知道，也核实来源一致性）；' +
    '涉及「当前/最新」的个性化推荐（如参赛技术栈、可报名赛事、市场在售方案）→web_search（获取最新可用性与趋势）；' +
    '多主体比较/复杂调研/行业趋势/投资研究，需大量来源交叉验证→deep_research（2-4条覆盖多个角度的查询）。' +
    '稳定不变的常识（如"水在标准大气压下 100°C 沸腾""一年有十二个月"）无需搜索→no_search。' +
    '不要输出JSON以外内容。'
  );
}

/** 用户显式意图硬覆盖：仅这三类明确表达，不扩关键词。 */
function detectExplicitHints(userText: string): {
  noSearch: boolean;
  webSearch: boolean;
  deepResearch: boolean;
} {
  const text = userText || '';
  const noSearch = /不要搜索|别搜索|别查|不用搜索|无需搜索|不要联网|不用联网|别联网/.test(text);
  const webSearch = /搜索一下|查一下|搜一下|查一查|查查|上网查|搜搜|快速搜索|帮我搜/.test(text);
  const deepResearch = /深入研究|深度调研|调研一下|做一次.*研究|深入分析|做个调研|全面调研/.test(text);
  return { noSearch, webSearch, deepResearch };
}

/**
 * Fail-safe 降级探测（仅当模型决策失败时）：问题明显涉及当前外部事实时的极小固定信号集。
 * 这不是产品规则关键词表，是「判断失败不代表永远 no_search」的兜底。
 */
function hasStrongCurrentFactSignal(text: string): boolean {
  const t = text || '';
  return (
    /(今天|最新|现在|目前|当前|今年|去年|实时|近况)/.test(t) ||
    /\b(19|20)\d{2}\b/.test(t) ||
    /(汇率|股价|价格|新闻|政策|数据|人口|普查|排名|名单|结果|财报|新品|发布会)/.test(t)
  );
}

/** 决策：硬覆盖（仅显式意图）优先，其次模型结构化判断。判断失败时降级暴露，不假装实时。 */
export async function decideSearchNeed(opts: ConversationSearchOptions): Promise<SearchNeed> {
  if (opts.noSearchOverride || opts.deepResearchHint || opts.webSearchHint) {
    if (opts.noSearchOverride) return { mode: 'no_search', queries: [], reason: '用户明确不要搜索' };
    if (opts.deepResearchHint) return { mode: 'deep_research', queries: [], reason: '用户明确要深入研究' };
    if (opts.webSearchHint) return { mode: 'web_search', queries: [], reason: '用户明确要搜索' };
  }
  const hints = detectExplicitHints(opts.userText);
  if (hints.noSearch) return { mode: 'no_search', queries: [], reason: '用户明确不要搜索' };
  if (hints.deepResearch) return { mode: 'deep_research', queries: [], reason: '用户明确要深入研究' };
  if (hints.webSearch) return { mode: 'web_search', queries: [], reason: '用户明确要搜索' };

  const userPrompt = `用户消息：${opts.userText}\n请决策。`;
  try {
    const result = await opts.chat(
      [
        { role: 'system', content: decisionSystemPrompt(opts.currentDate) },
        { role: 'user', content: userPrompt },
      ],
      { temperature: 0, maxTokens: DECISION_MAX_TOKENS, responseFormat: 'json_object' },
    );
    const parsed = parseDecisionJson(result.text);
    if (parsed) return parsed;
    // 模型决策失败：问题明显涉及当前外部事实 → degraded web_search，暴露降级状态。
    if (hasStrongCurrentFactSignal(opts.userText)) {
      return {
        mode: 'web_search',
        queries: [opts.userText.slice(0, 100)],
        reason: '搜索决策器判断失败，但问题明显涉及当前外部事实，降级为 web_search',
        freshnessRequired: true,
        externalVerificationRequired: true,
        researchComplexity: 1,
        degraded: true,
      };
    }
    return { mode: 'no_search', queries: [], reason: '模型决策失败且无当前外部事实信号', degraded: true };
  } catch {
    if (hasStrongCurrentFactSignal(opts.userText)) {
      return {
        mode: 'web_search',
        queries: [opts.userText.slice(0, 100)],
        reason: '搜索决策器调用失败，但问题明显涉及当前外部事实，降级为 web_search',
        freshnessRequired: true,
        externalVerificationRequired: true,
        researchComplexity: 1,
        degraded: true,
      };
    }
    return { mode: 'no_search', queries: [], reason: '搜索决策器调用失败', degraded: true };
  }
}

function parseDecisionJson(text: string): SearchNeed | null {
  try {
    const obj = JSON.parse(text) as {
      mode?: string;
      queries?: unknown;
      reason?: string;
      freshnessRequired?: unknown;
      externalVerificationRequired?: unknown;
      researchComplexity?: unknown;
    };
    const mode = String(obj.mode || '');
    if (mode === 'no_search' || mode === 'web_search' || mode === 'deep_research') {
      const queries = Array.isArray(obj.queries)
        ? obj.queries.map((q) => String(q).trim()).filter(Boolean).slice(0, 6)
        : [];
      if (mode === 'web_search' && queries.length === 0) return null;
      if (mode === 'deep_research' && queries.length === 0) {
        const need: SearchNeed = { mode, queries: [] };
        if (typeof obj.reason === 'string') need.reason = obj.reason;
        return need;
      }
      const need: SearchNeed = { mode, queries };
      if (typeof obj.reason === 'string') need.reason = obj.reason;
      if (typeof obj.freshnessRequired === 'boolean') need.freshnessRequired = obj.freshnessRequired;
      if (typeof obj.externalVerificationRequired === 'boolean') need.externalVerificationRequired = obj.externalVerificationRequired;
      if (typeof obj.researchComplexity === 'number') need.researchComplexity = obj.researchComplexity;
      return need;
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

/** 由决策提取查询；web_search 无查询时由调用方用用户问题兜底。 */
function queriesForNeed(need: SearchNeed, maxQueries: number): string[] {
  return need.queries.slice(0, maxQueries);
}

/** 执行一组查询，返回 {query, sources}[]（去重主机）。 */
async function runSearchRound(
  connector: SearchConnector,
  queries: string[],
  signal?: AbortSignal,
  opts?: ConversationSearchOptions,
  degradedState?: { used: boolean },
): Promise<SearchRound[]> {
  const rounds: SearchRound[] = [];
  const seenHosts = new Set<string>();
  for (const query of queries) {
    if (!query || !query.trim()) continue;
    const sources = await searchWithFallback(opts, connector, query, signal, degradedState);
    const filtered = sources.filter((s) => {
      const host = /^https?:\/\/([^/]+)/.exec(s.url)?.[1] || '';
      if (!host || seenHosts.has(host)) return false;
      seenHosts.add(host);
      return true;
    });
    rounds.push({ query, sources: filtered });
  }
  return rounds.filter((r) => r.sources.length > 0);
}

/**
 * 单条查询执行（含 §三 的 degraded 语义）：
 * 主 connector 抛 provider 失败 → 仅该调用进入显式 degraded fallback（保留 providerDegraded 标记），
 * 不把整场 research 重跑成 Bing 路径；fallback 也失败则诚实失败兜底。
 */
async function searchWithFallback(
  opts: ConversationSearchOptions | undefined,
  connector: SearchConnector,
  query: string,
  signal?: AbortSignal,
  degradedState?: { used: boolean },
): Promise<SearchSource[]> {
  try {
    const sources = await connector.search(query, signal ? { signal } : undefined);
    if (!hasUsableWebEvidence(sources)) {
      throw Object.assign(new Error('search returned no usable evidence'), { kind: 'empty' });
    }
    return sources;
  } catch (err) {
    if (opts?.fallbackConnector && isProviderFailure(err)) {
      if (degradedState) degradedState.used = true;
      return await opts.fallbackConnector.search(query, signal ? { signal } : undefined);
    }
    throw err;
  }
}

/**
 * Evidence retrieval：read/retrieve evidence chunk。
 * search → candidate sources → read → evidence chunks。抓取失败不阻断，证据缺失时综合如实降级。
 */
async function retrieveEvidence(
  connector: SearchConnector,
  rounds: SearchRound[],
  maxReads: number,
  signal?: AbortSignal,
): Promise<SearchRound[]> {
  if (!connector.read || maxReads <= 0) return rounds;
  let reads = 0;
  for (const round of rounds) {
    for (const source of round.sources) {
      if (reads >= maxReads) return rounds;
      if (source.evidenceChunk) continue;
      try {
        const readOpts: { maxChars?: number; signal?: AbortSignal } = { maxChars: 6000 };
        if (signal) readOpts.signal = signal;
        const result = await connector.read(source.url, readOpts);
        if (result && result.content && result.content.trim().length >= 40) {
          source.evidenceChunk = result.content.trim();
          source.retrievedAt = result.retrievedAt;
          // 若 provider redirect 解析出真实 URL，更新来源 URL 供 citation 指向真实页面。
          if (result.resolvedUrl && /^https?:\/\//i.test(result.resolvedUrl)) {
            source.url = result.resolvedUrl;
            const realType = deriveSourceType(result.resolvedUrl, source.title);
            source.sourceType = realType;
          }
          reads += 1;
        }
      } catch {
        /* 单源抓取失败：保留来源但无 chunk，综合时不可引用其细节 */
      }
    }
  }
  return rounds;
}

/** web_search pipeline：决策 → 执行 → 读 evidence → claim-grounded 综合成文。 */
export async function runWebSearch(
  opts: ConversationSearchOptions,
  need: SearchNeed,
): Promise<ConversationSearchReply> {
  const queries = queriesForNeed(need, opts.maxQueries ?? 2);
  const effectiveQueries = queries.length > 0 ? queries : [opts.userText.slice(0, 100)];
  const degradedState = { used: false };
  const rounds = await runSearchRound(opts.connector, effectiveQueries, opts.signal, opts, degradedState);
  const maxReads = opts.maxEvidenceReads ?? 4;
  const readRounds = await retrieveEvidence(opts.connector, rounds, maxReads, opts.signal);
  if (!hasUsableWebEvidence(readRounds.flatMap((r) => r.sources))) {
    throw Object.assign(new Error('search returned no usable evidence'), { kind: 'empty' });
  }
  const evidence: SearchEvidence = {
    mode: 'web_search',
    rounds: readRounds,
    iterations: 1,
    ...(need.degraded ? { degraded: true } : {}),
    ...(degradedState.used ? { providerDegraded: true } : {}),
  };
  const text = await synthesizeSearchAnswer(opts, evidence);
  evidence.citationReport = verifyCitations(text, readRounds);
  return {
    mode: 'web_search',
    text,
    evidence,
    usedExternal: readRounds.some((r) => r.sources.length > 0),
  };
}

/** Deep Research 首轮规划：为深度研究生成多角度查询（当决策未给 queries 时）。 */
async function planResearchQueries(opts: ConversationSearchOptions, need: SearchNeed): Promise<string[]> {
  const prompt =
    `用户要深入研究：${opts.userText}\n` +
    '请规划 2-3 条互不重叠的搜索查询，覆盖研究问题的不同角度（现状、关键数据、权威来源、地域差异等），' +
    '不要包含「深入研究」之类的指令词。输出JSON：{"queries":[...]}。只输出JSON。';
  try {
    const result = await opts.chat(
      [
        { role: 'system', content: '你是深度研究规划器。为研究问题生成精炼搜索查询，只输出JSON。' },
        { role: 'user', content: prompt },
      ],
      { temperature: 0, maxTokens: RESEARCH_MAX_TOKENS, responseFormat: 'json_object' },
    );
    const json = safeParseJson(result.text) as { queries?: unknown } | null;
    const queries = Array.isArray(json?.queries)
      ? (json.queries as unknown[]).map((q) => String(q).trim()).filter(Boolean).slice(0, 3)
      : [];
    return queries;
  } catch {
    return [];
  }
}

/** 从 coverage.missing 派生兜底 followup 查询（gap 模型失败但确实有缺失时）。 */
function deriveFallbackQueries(coverage: { covered: string[]; missing: string[] }, userText: string): string[] {
  const out: string[] = [];
  for (const m of coverage.missing.slice(0, 3)) {
    const t = String(m || '').trim();
    if (t && t.length > 4) out.push(t.slice(0, 120));
  }
  if (out.length === 0) return [];
  return out;
}

/** Deep Research gap 评估：coverage evaluation → ResearchGap[]（驱动后续轮真实 gap 查询）。 */
async function evaluateCoverageGaps(
  opts: ConversationSearchOptions,
  need: SearchNeed,
  rounds: SearchRound[],
): Promise<{ coverage: { covered: string[]; missing: string[] }; gaps: ResearchGap[] }> {
  const sources = rounds.flatMap((r) => r.sources);
  const sourceBlock = sources.length
    ? sources
        .map((s, i) => {
          const chunk = s.evidenceChunk ? s.evidenceChunk.slice(0, 1200) : '（无正文）';
          return `[${i + 1}] ${s.title} (${s.url}) type=${s.sourceType || 'unknown'}\n${chunk}`;
        })
        .join('\n\n')
    : '（暂无可用来源）';
  const gapPrompt =
    `用户问题：${opts.userText}\n` +
    (need.freshnessRequired ? `（问题要求时效性，今天是${opts.currentDate || '未知'}）\n` : '') +
    `已获取来源与证据：\n${sourceBlock}\n\n` +
    '评估证据覆盖：目标主体/地区/时间/主题是否已被支持？哪些关键信息仍缺失（例如关键数字、最新状态、权威一手来源、冲突核验）？' +
    '对每一个真实缺口生成一条 followupQuery。' +
    '输出JSON：{"coverage":{"covered":[...],"missing":[...]},' +
    '"gaps":[{"missingQuestion":"缺失的关键问题","whyNeeded":"为什么需要","preferredSourceType":"official|news|reference|secondary（可选）","followupQuery":"精确补充搜索查询"}]}。' +
    '若证据已充分覆盖所有关键方面：gaps 返回空数组。只输出JSON。';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await opts.chat(
        [
          { role: 'system', content: '你是深度研究助理。基于已获取证据找出真实信息缺口，只输出JSON。' },
          { role: 'user', content: gapPrompt },
        ],
        { temperature: attempt === 0 ? 0 : 0.3, maxTokens: RESEARCH_MAX_TOKENS, responseFormat: 'json_object' },
      );
      const json = safeParseJson(result.text) as {
        coverage?: { covered?: unknown; missing?: unknown };
        gaps?: unknown;
      } | null;
      if (!json) continue;
      const gaps = Array.isArray(json.gaps)
        ? (json.gaps as Array<Record<string, unknown>>)
            .map((g) => {
              const gap: ResearchGap = {
                missingQuestion: String(g.missingQuestion || '').trim(),
                whyNeeded: String(g.whyNeeded || '').trim(),
                followupQuery: String(g.followupQuery || '').trim(),
              };
              if (typeof g.preferredSourceType === 'string' && g.preferredSourceType.length > 0) {
                gap.preferredSourceType = g.preferredSourceType;
              }
              return gap;
            })
            .filter((g) => g.followupQuery.length > 0 && g.missingQuestion.length > 0)
            .slice(0, 3)
        : [];
      const covered = Array.isArray(json.coverage?.covered)
        ? (json.coverage.covered as unknown[]).map((x) => String(x)).filter(Boolean)
        : [];
      const missing = Array.isArray(json.coverage?.missing)
        ? (json.coverage.missing as unknown[]).map((x) => String(x)).filter(Boolean)
        : [];
      return { coverage: { covered, missing }, gaps };
    } catch {
      /* retry once */
    }
  }
  return { coverage: { covered: [], missing: [] }, gaps: [] };
}

/** deep_research：plan → 首轮查询 → 读 evidence → coverage/gap → 仅对真实 gap 追加查询 → 综合。 */
export async function runDeepResearch(
  opts: ConversationSearchOptions,
  need: SearchNeed,
): Promise<ConversationSearchReply> {
  const maxIterations = opts.maxResearchIterations ?? 3;
  const planned =
    need.queries.length > 0
      ? need.queries.slice(0, 3)
      : await planResearchQueries(opts, need);
  const firstQueries = planned.length > 0 ? planned : [opts.userText.replace(/^(深入研究|深度调研|调研一下)[：:\s]*/, '').slice(0, 100)].filter(Boolean);
  const allRounds: SearchRound[] = [];
  const seenHosts = new Set<string>();
  const degradedState = { used: false };

  async function execRound(queries: string[]): Promise<SearchRound[]> {
    const rounds: SearchRound[] = [];
    for (const query of queries) {
      if (!query || !query.trim()) continue;
      const sources = await searchWithFallback(opts, opts.connector, query, opts.signal, degradedState);
      const filtered = sources.filter((s) => {
        const host = /^https?:\/\/([^/]+)/.exec(s.url)?.[1] || '';
        if (!host || seenHosts.has(host)) return false;
        seenHosts.add(host);
        return true;
      });
      rounds.push({ query, sources: filtered });
    }
    return rounds.filter((r) => r.sources.length > 0);
  }

  const maxReads = opts.maxEvidenceReads ?? 5;
  const round1 = await execRound(firstQueries);
  allRounds.push(...(await retrieveEvidence(opts.connector, round1, maxReads, opts.signal)));
  let iterations = round1.length > 0 ? 1 : 0;
  if (!hasUsableWebEvidence(allRounds.flatMap((r) => r.sources))) {
    throw Object.assign(new Error('search returned no usable evidence'), { kind: 'empty' });
  }

  // Round 2+：coverage evaluation → 只针对真实 gap 查询（非「+最新进展 2026」拼接）。
  const researchGaps: ResearchGap[] = [];
  let coverage = { covered: [] as string[], missing: [] as string[] };
  let followups: string[] = [];
  if (maxIterations >= 2 && allRounds.length > 0) {
    const evaluated = await evaluateCoverageGaps(opts, need, allRounds);
    coverage = evaluated.coverage;
    researchGaps.push(...evaluated.gaps);
    followups = researchGaps.map((g) => g.followupQuery).filter(Boolean).slice(0, 3);
    // gap 模型未产出 but 明显有缺失：用 missing 派生兜底查询（纠偏/补漏）。
    if (followups.length === 0) {
      followups = deriveFallbackQueries(coverage, opts.userText);
    }
    if (followups.length > 0) {
      let round2 = await execRound(followups);
      // 一次性重试：规避 Bing 瞬时空结果/限流（bounded，不是无限 retry）。
      if (round2.length === 0) {
        await new Promise((r) => setTimeout(r, 1500));
        round2 = await execRound(followups);
      }
      allRounds.push(...(await retrieveEvidence(opts.connector, round2, Math.max(2, maxReads), opts.signal)));
      if (round2.length > 0) iterations += 1;
    }
  }

  const evidence: SearchEvidence = {
    mode: 'deep_research',
    rounds: allRounds,
    iterations,
    ...(need.degraded ? { degraded: true } : {}),
    ...(degradedState.used ? { providerDegraded: true } : {}),
    research: {
      plan: firstQueries,
      unresolvedQuestions: researchGaps.map((g) => g.missingQuestion),
      gaps: researchGaps.map((g) => g.missingQuestion),
      researchGaps,
      coverage,
    },
  };
  const text = await synthesizeSearchAnswer(opts, evidence);
  evidence.citationReport = verifyCitations(text, allRounds);
  return {
    mode: 'deep_research',
    text,
    evidence,
    usedExternal: allRounds.some((r) => r.sources.length > 0),
  };
}

/** 构建综合输入：每个来源附 evidence chunk（claim-grounded 的原料），并附一手来源偏好。 */
function buildSynthesisInput(opts: ConversationSearchOptions, evidence: SearchEvidence): string {
  let user = `用户问题：${opts.userText}\n`;
  if (evidence.degraded) {
    user += '\n【注意】本次联网核验不稳定/降级。请如实说明核验程度，不要假装确认实时信息。\n';
  }
  let index = 1;
  const indexedSources: Array<{ index: number; source: SearchSource }> = [];
  evidence.rounds.forEach((round) => {
    round.sources.forEach((s) => {
      indexedSources.push({ index, source: s });
      index += 1;
    });
  });

  if (indexedSources.length === 0) {
    user += '\n（本次未能获取到可用网络来源）\n';
  } else {
    user += '\n==== 网络来源与证据 ====\n';
    for (const { index: n, source: s } of indexedSources) {
      user += `[${n}] 标题：${s.title}\n    URL：${s.url}\n`;
      if (s.sourceType) user += `    来源类型：${s.sourceType}\n`;
      if (s.retrievedAt) user += `    检索时间：${s.retrievedAt}\n`;
      if (s.evidenceChunk) {
        const chunk = s.evidenceChunk.length > 2200 ? s.evidenceChunk.slice(0, 2200) + '…' : s.evidenceChunk;
        user += `    证据片段：\n${chunk}\n`;
      } else {
        user += `    证据片段：（未能抓取正文，仅标题/URL 可参考，不得编造其具体内容）\n`;
      }
    }
  }
  if (evidence.research && evidence.research.unresolvedQuestions?.length) {
    user += `\n---- 尚未充分覆盖的问题 ----\n${evidence.research.unresolvedQuestions.map((q) => `- ${q}`).join('\n')}\n`;
  }
  return user;
}

/** 综合成文：evidence chunks + owner context + 历史轮次 → 自然答案 + 绑定证据的引用。 */
export async function synthesizeSearchAnswer(
  opts: ConversationSearchOptions,
  evidence: SearchEvidence,
): Promise<string> {
  const dateLine = opts.currentDate ? `今天是${opts.currentDate}。` : '';
  const system =
    `你是数字之我 2digime，一个拥有本人确认事实的数字主体。${dateLine}` +
    '请基于下方「网络来源与证据」回答用户问题，同时可结合你掌握的「已确认本人信息」。' +
    '要求：\n' +
    '1) 明确区分「来源事实」「推理」与「本人已知信息」三类，不要混淆；\n' +
    '2) 关键事实旁标注来源编号，如 [1][2]；只允许引用上方真实给出的来源；\n' +
    '3) 引用必须绑定证据：只有某个来源的「证据片段」实际支撑该主张，才能用其编号引用；' +
    '不得仅凭 URL 或标题猜引用，不得把没有证据片段的来源当作具体事实依据；\n' +
    '4) 结尾给出「来源」列表：编号 + 标题 + URL（仅列真实来源）；\n' +
    '5) 若不同来源存在冲突，如实说明差异，不要悄悄选一个；\n' +
    '6) 时效性：涉及最新动态要体现当前日期；搜索没覆盖到的，诚实说明「目前公开信息有限」；\n' +
    '7) 一手/官方来源优先：对价格/规格/政策/公司公告/论文类问题，优先引用一手来源；' +
    '若只有二手来源，允许回答但自然表达「依据二手报道」，不要伪装成官方确认；\n' +
    '8) 直接输出最终答案，不要输出推理过程或提纲。';

  const subjectBlock = opts.subjectFacts && opts.subjectFacts.length > 0
    ? `\n==== 已确认本人信息 ====\n${opts.subjectFacts.map((f) => `- ${f}`).join('\n')}\n`
    : '';

  const user = buildSynthesisInput(opts, evidence);
  const turns = opts.turns && opts.turns.length > 0
    ? `\n==== 最近对话 ====\n${opts.turns.map((t) => `${t.role === 'user' ? '用户' : '我'}：${t.content.slice(0, 200)}`).join('\n')}\n`
    : '';

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: system },
    ...(turns ? [{ role: 'user' as const, content: turns }] : []),
    { role: 'user', content: `${user}${subjectBlock}` },
  ];

  const first = await opts.chat(messages, { temperature: 0.3, maxTokens: SYNTHESIS_MAX_TOKENS });
  let text = String(first.text || '').trim();
  let truncated = first.truncated === true || first.finishReason === 'length';

  // 检测 final answer 被长度截断：允许一次 bounded continuation（同一回答的恢复，不是第二轮研究）。
  if (truncated && text.length > 0) {
    const continuation = await opts.chat(
      [
        ...messages,
        { role: 'assistant', content: text },
        { role: 'user', content: '请从上一条回复的截断处继续，直接接着写，不要重复已经写过的内容，并补全「来源」列表。' },
      ],
      { temperature: 0.3, maxTokens: Math.min(SYNTHESIS_MAX_TOKENS, 2048) },
    );
    const cont = String(continuation.text || '').trim();
    if (cont.length > 0) {
      text = `${text}\n${cont}`.trim();
      truncated = continuation.truncated === true || continuation.finishReason === 'length';
    }
  }

  if (!text) {
    // 一次重试：模型偶发空输出
    const retry = await opts.chat(messages, { temperature: 0.5, maxTokens: SYNTHESIS_MAX_TOKENS });
    text = String(retry.text || '').trim();
    if (text.length > 0) {
      truncated = retry.truncated === true || retry.finishReason === 'length';
    }
  }
  if (!text) {
    throw new ConversationSearchError('synthesis', '综合生成无输出');
  }
  return text;
}

/**
 * 引用绑定验证：claim → citation → evidence chunk 的最小可验证性。
 * citation URL 可打开只是最低门；这里验证正文 [n] 是否映射到真实来源且有证据支撑。
 */
export function verifyCitations(text: string, rounds: SearchRound[]): CitationReport {
  const sources = rounds.flatMap((r) => r.sources);
  const refs = (text.match(/\[\d+\]/g) || []).map((m) => parseInt(m.slice(1, -1), 10));
  const cited = [...new Set(refs)].filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const outOfRange = cited.filter((n) => n < 1 || n > sources.length);
  const ungrounded = cited.filter(
    (n) => {
      if (n < 1 || n > sources.length) return false;
      const src = sources[n - 1];
      return !(src && src.evidenceChunk);
    },
  );
  const validCount = cited.length - outOfRange.length - ungrounded.length;
  return { cited, outOfRange, ungrounded, validCount };
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 诚实失败（frozen semantics 3.10）：网络/provider 失败时，
 * 以自然语言说明无法获取最新网络信息，并基于已有知识作答；不假装实时。
 */
export async function buildHonestFailureReply(opts: ConversationSearchOptions): Promise<string> {
  const dateLine = opts.currentDate ? `今天是${opts.currentDate}。` : '';
  const system =
    `你是数字之我 2digime。${dateLine}刚才尝试联网获取最新信息失败了。` +
    '请用自然、口语化的中文回答：先如实说明「现在没能获取到最新网络信息，我先根据已有知识回答」' +
    '，再基于你已有的知识直接回答用户问题。不得假装查询到了实时信息，不得编造来源 URL。';
  const subjectBlock = opts.subjectFacts && opts.subjectFacts.length > 0
    ? `\n==== 已确认本人信息 ====\n${opts.subjectFacts.map((f) => `- ${f}`).join('\n')}\n`
    : '';
  const turns = opts.turns && opts.turns.length > 0
    ? `\n==== 最近对话 ====\n${opts.turns.map((t) => `${t.role === 'user' ? '用户' : '我'}：${t.content.slice(0, 200)}`).join('\n')}\n`
    : '';
  const result = await opts.chat(
    [
      { role: 'system', content: system },
      ...(turns ? [{ role: 'user' as const, content: turns }] : []),
      { role: 'user', content: `用户问题：${opts.userText}\n${subjectBlock}` },
    ],
    { temperature: 0.3, maxTokens: 1600 },
  );
  return String(result.text || '').trim();
}

/** 判断是否 provider（搜索/证据读取）失败（区别于综合/决策失败）。 */
function isProviderFailure(err: unknown): boolean {
  const e = err as { kind?: string };
  const kind = e && e.kind;
  if (!kind) return false;
  return [
    'network', 'auth', 'quota', 'invalid', 'empty', 'blocked', 'model', 'response',
    'search', // 由 connector 抛出的搜索失败
    'timeout',
  ].includes(kind);
}

async function runModeWithConnector(
  opts: ConversationSearchOptions,
  need: SearchNeed,
  connector: SearchConnector,
  providerId: string | undefined,
  providerDegraded: boolean,
): Promise<ConversationSearchReply> {
  const runOpts: ConversationSearchOptions = { ...opts, connector };
  if (providerId) runOpts.providerId = providerId;
  let reply: ConversationSearchReply;
  if (need.mode === 'deep_research') {
    reply = await runDeepResearch(runOpts, need);
  } else {
    reply = await runWebSearch(runOpts, need);
  }
  if (providerDegraded) {
    reply.evidence.providerDegraded = true;
    reply.evidence.providerId = providerId || 'bing-html(degraded)';
  } else if (providerId) {
    reply.evidence.providerId = providerId;
  }
  return reply;
}

/** 主入口：决策 + 执行 + 综合。主 provider 失败时显式回退 degraded fallback；否则诚实失败。 */
export async function runConversationSearch(opts: ConversationSearchOptions): Promise<ConversationSearchReply> {
  const need = await decideSearchNeed(opts);
  if (need.mode === 'no_search') {
    return {
      mode: 'no_search',
      text: '',
      evidence: { mode: 'no_search', rounds: [], ...(need.degraded ? { degraded: true } : {}) },
      usedExternal: false,
    };
  }
  try {
    return await runModeWithConnector(opts, need, opts.connector, opts.providerId, false);
  } catch (err) {
    // 主 provider（connector.search/read）失败 → 显式回退 degraded fallback（不得 silent / 不得标成正式 grounded）。
    if (opts.fallbackConnector && isProviderFailure(err)) {
      try {
        return await runModeWithConnector(opts, need, opts.fallbackConnector, 'bing-html(degraded)', true);
      } catch (fallbackErr) {
        // fallback 也失败 → 诚实失败兜底。
        try {
          const honestText = await buildHonestFailureReply(opts);
          return {
            mode: need.mode,
            text: honestText,
            evidence: { mode: need.mode, rounds: [], providerDegraded: true, providerId: 'bing-html(degraded)' },
            usedExternal: false,
          };
        } catch {
          throw new ConversationSearchError(
            'search',
            `搜索失败：${fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)}`,
          );
        }
      }
    }
    // 非 provider 失败（如综合失败）或无可回退：诚实失败回退，不把协议错误抛到用户面。
    try {
      const honestText = await buildHonestFailureReply(opts);
      return {
        mode: need.mode,
        text: honestText,
        evidence: { mode: need.mode, rounds: [], ...(need.degraded ? { degraded: true } : {}) },
        usedExternal: false,
      };
    } catch {
      throw new ConversationSearchError(
        'search',
        `搜索失败：${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export function hasExternalSources(evidence: SearchEvidence): boolean {
  return evidence.rounds.some((r) => r.sources.some((s) => s.sourceClass === EXTERNAL_SOURCE_CLASS));
}

/**
 * CAPABILITY-FALLBACK-CLOSURE-01 — Search/Research 闭包执行入口。
 * 执行前先按能力合同做闭包分类（OPTIMAL / BASELINE / LIMITED / UNAVAILABLE）；
 * 需要外部信息但没有任何可用联网能力时，不发起注定失败的搜索，直接给出诚实的 LIMITED 回复。
 * professionalSearchUsable / baselineSearchUsable / modelUsable 由调用方按
 * 既有 SearchConnector 与模型配置的可用性传入（不做供应商判断）。
 */
export interface ClosureSearchState {
  professionalSearchUsable?: boolean;
  baselineSearchUsable?: boolean;
  modelUsable?: boolean;
}

export interface ClosureSearchResult {
  resolution: CapabilityResolution;
  reply: ConversationSearchReply;
}

export async function runClosureSearch(
  opts: ConversationSearchOptions & ClosureSearchState,
): Promise<ClosureSearchResult> {
  const need = await decideSearchNeed(opts);
  const resolution = classifySearchClosure({
    need,
    professionalSearchUsable: opts.professionalSearchUsable ?? false,
    baselineSearchUsable: opts.baselineSearchUsable ?? false,
    modelUsable: opts.modelUsable ?? false,
  });
  const webNeeded = need.mode === 'web_search' || need.mode === 'deep_research';
  const noWebCapability =
    !opts.baselineSearchUsable && !opts.professionalSearchUsable;
  if (webNeeded && noWebCapability) {
    const honestText = await buildHonestFailureReply(opts);
    return {
      resolution,
      reply: {
        mode: need.mode,
        text: honestText,
        evidence: { mode: need.mode, rounds: [] },
        usedExternal: false,
      },
    };
  }
  const reply = await runConversationSearch(opts);
  if (webNeeded) {
    if (!reply.usedExternal) {
      return {
        resolution: classifySearchClosure({
          need,
          professionalSearchUsable: false,
          baselineSearchUsable: false,
          modelUsable: opts.modelUsable ?? false,
        }),
        reply,
      };
    }
    if (reply.evidence.providerDegraded) {
      return {
        resolution: classifySearchClosure({
          need,
          professionalSearchUsable: false,
          baselineSearchUsable: opts.baselineSearchUsable ?? true,
          modelUsable: opts.modelUsable ?? false,
        }),
        reply,
      };
    }
  }
  return { resolution, reply };
}
