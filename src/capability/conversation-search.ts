/**
 * ConversationSearch — 对话信息能力主框架（DIGITALME-CONVERSATION-SEARCH-RESEARCH-01）。
 *
 * 层：2digime → Conversation/Research Need（决策）→ External Capability Contract
 *     → Search/Research Connector → 真实外部能力。
 *
 * 纯编排：不持有 Store，不写 Owner 事实。搜索产物一律 sourceClass='external'，
 * 不进入 userVisibleFacts / growth 事件（唯一入口在壳层按既有成长规则收口）。
 *
 * 依赖注入：chat 完成真实模型调用（决策/综合），connector 完成真实搜索——两者在
 * 测试中都可替换为 fake，保证离线可测；生产由壳层注入真实实现。
 */
import type { SearchConnector } from './search-connector';
import {
  type SearchMode,
  type SearchNeed,
  type SearchEvidence,
  type SearchSource,
  type SearchRound,
  EXTERNAL_SOURCE_CLASS,
} from './search-contract';

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

/** 决策系统提示：模型判断 + 明确任务特征，不做关键词 if/else。 */
function decisionSystemPrompt(currentDate?: string): string {
  const dateLine = currentDate ? `今天是${currentDate}。` : '';
  return (
    `${dateLine}你是搜索决策器。判断这条用户消息是否需要外部网络信息。` +
    '只输出JSON：{"mode":"no_search"|"web_search"|"deep_research","queries":[...]}。' +
    '规则：常识/推理/写作/本人已有上下文足够→no_search（不搜索，queries空）；' +
    '最新信息/实时事实核验/价格政策新闻/公司产品现状，本地模型知识可能过时→web_search（给出1-3条精炼查询）；' +
    '多主体比较/复杂调研/行业趋势/投资研究，需大量来源交叉验证→deep_research（给出2-4条覆盖多个角度的查询）。' +
    '不要输出JSON以外内容。'
  );
}

function detectExplicitHints(userText: string): {
  noSearch: boolean;
  webSearch: boolean;
  deepResearch: boolean;
} {
  const text = userText || '';
  const noSearch = /不要搜索|别搜索|别查|不用搜索|无需搜索|不要联网|不用联网|别联网/.test(text);
  const webSearch = /搜索一下|查一下|搜一下|查一查|查查|上网查|搜搜|快速搜索|帮我搜|查查最新/.test(text);
  const deepResearch = /深入研究|深度调研|调研一下|做一次.*研究|深入分析|做个调研|全面调研/.test(text);
  return { noSearch, webSearch, deepResearch };
}

/** 决策：硬覆盖（明确任务特征）优先，其次模型判断。决策失败回退 no_search（不得阻断对话）。 */
export async function decideSearchNeed(opts: ConversationSearchOptions): Promise<ConversationSearchDecision> {
  if (opts.noSearchOverride || opts.deepResearchHint || opts.webSearchHint) {
    if (opts.noSearchOverride) return { mode: 'no_search', queries: [] };
    if (opts.deepResearchHint) return { mode: 'deep_research', queries: [] };
    if (opts.webSearchHint) return { mode: 'web_search', queries: [] };
  }
  const hints = detectExplicitHints(opts.userText);
  if (hints.noSearch) return { mode: 'no_search', queries: [] };
  if (hints.deepResearch) return { mode: 'deep_research', queries: [] };
  if (hints.webSearch) return { mode: 'web_search', queries: [] };

  const userPrompt = `用户消息：${opts.userText}\n请决策。`;
  try {
    const result = await opts.chat(
      [
        { role: 'system', content: decisionSystemPrompt(opts.currentDate) },
        { role: 'user', content: userPrompt },
      ],
      { temperature: 0, maxTokens: 200, responseFormat: 'json_object' },
    );
    const parsed = parseDecisionJson(result.text);
    if (!parsed) {
      // 模型返回不可解析 JSON：诚实回退 no_search，不伪造决策。
      return { mode: 'no_search', queries: [] };
    }
    return parsed;
  } catch {
    return { mode: 'no_search', queries: [] };
  }
}

function parseDecisionJson(text: string): ConversationSearchDecision | null {
  try {
    const obj = JSON.parse(text) as { mode?: string; queries?: unknown };
    const mode = String(obj.mode || '');
    if (mode === 'no_search' || mode === 'web_search' || mode === 'deep_research') {
      const queries = Array.isArray(obj.queries)
        ? obj.queries.map((q) => String(q).trim()).filter(Boolean).slice(0, 6)
        : [];
      if (mode === 'web_search' && queries.length === 0) return null;
      return { mode, queries };
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

/** 由决策补充缺失查询（deep_research 无 queries 时）。 */
function queriesForNeed(need: SearchNeed, maxQueries: number): string[] {
  if (need.queries.length > 0) return need.queries.slice(0, maxQueries);
  if (need.mode === 'web_search') return [];
  return []; // deep_research 由研究循环生成首轮查询
}

/** 执行一组查询，返回 {query, sources}[]（去重主机）。 */
async function runSearchRound(
  connector: SearchConnector,
  queries: string[],
  signal?: AbortSignal,
): Promise<SearchRound[]> {
  const rounds: SearchRound[] = [];
  const seenHosts = new Set<string>();
  for (const query of queries) {
    const sources = await connector.search(query, signal ? { signal } : undefined);
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

/** web_search pipeline：决策 → 执行 → 综合成文（带来源）。 */
export async function runWebSearch(
  opts: ConversationSearchOptions,
  need: SearchNeed,
): Promise<ConversationSearchReply> {
  const queries = queriesForNeed(need, opts.maxQueries ?? 2);
  if (queries.length === 0) {
    throw new ConversationSearchError('search', 'web_search 无可用查询');
  }
  const rounds = await runSearchRound(opts.connector, queries, opts.signal);
  const evidence: SearchEvidence = { mode: 'web_search', rounds, iterations: 1 };
  const text = await synthesizeSearchAnswer(opts, evidence);
  return {
    mode: 'web_search',
    text,
    evidence,
    usedExternal: rounds.some((r) => r.sources.length > 0),
  };
}

/** deep_research 最小闭环：goal → 首轮查询 → 阅读/找 gap → 追加搜索（>=2 轮）→ 综合。 */
export async function runDeepResearch(
  opts: ConversationSearchOptions,
  need: SearchNeed,
): Promise<ConversationSearchReply> {
  const maxIterations = opts.maxResearchIterations ?? 3;
  const firstQueries =
    need.queries.length > 0
      ? need.queries.slice(0, 3)
      : [opts.userText.slice(0, 80), `${opts.userText.slice(0, 60)} 最新进展 2026`].filter(Boolean);
  const allRounds: SearchRound[] = [];
  const seenHosts = new Set<string>();

  async function execRound(queries: string[]): Promise<SearchRound[]> {
    const rounds: SearchRound[] = [];
    for (const query of queries) {
      const sources = await opts.connector.search(query, opts.signal ? { signal: opts.signal } : undefined);
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

  allRounds.push(...(await execRound(firstQueries)));

  // 追加轮：基于已有证据找 gap 与补充查询
  let unresolvedQuestions: string[] = [];
  if (maxIterations >= 2) {
    const gapPrompt =
      `用户问题：${opts.userText}\n` +
      `已获得以下来源标题：\n${allRounds.map((r) => r.sources.map((s) => `- ${s.title} (${s.url})`).join('\n')).join('\n')}\n` +
      '还缺少哪些关键信息？输出JSON：{"follow_up_queries":[...1-3条补充搜索查询...],"unresolved_questions":[...尚无法回答的问题...]}';
    try {
      const gapResult = await opts.chat(
        [
          { role: 'system', content: '你是深度研究助理。基于已获取来源，找出信息缺口与补充查询。只输出JSON。' },
          { role: 'user', content: gapPrompt },
        ],
        { temperature: 0, maxTokens: 300, responseFormat: 'json_object' },
      );
      const gapJson = safeParseJson(gapResult.text) as {
        follow_up_queries?: unknown;
        unresolved_questions?: unknown;
      } | null;
      const followUps = Array.isArray(gapJson?.follow_up_queries)
        ? gapJson.follow_up_queries.map((q) => String(q).trim()).filter(Boolean).slice(0, 3)
        : [];
      unresolvedQuestions = Array.isArray(gapJson?.unresolved_questions)
        ? gapJson.unresolved_questions.map((q) => String(q).trim()).filter(Boolean)
        : [];
      if (followUps.length > 0) {
        allRounds.push(...(await execRound(followUps)));
      }
    } catch {
      /* gap 轮失败不阻断：仍有首轮证据可综合 */
    }
  }

  const evidence: SearchEvidence = {
    mode: 'deep_research',
    rounds: allRounds,
    iterations: Math.max(2, allRounds.length > 0 ? 1 : 0),
    research: {
      plan: firstQueries,
      unresolvedQuestions,
      gaps: unresolvedQuestions,
    },
  };
  const text = await synthesizeSearchAnswer(opts, evidence);
  return {
    mode: 'deep_research',
    text,
    evidence,
    usedExternal: allRounds.some((r) => r.sources.length > 0),
  };
}

/** 综合成文：owner context + 历史轮次 + 结构化来源 → 自然答案 + 引用。 */
export async function synthesizeSearchAnswer(
  opts: ConversationSearchOptions,
  evidence: SearchEvidence,
): Promise<string> {
  const dateLine = opts.currentDate ? `今天是${opts.currentDate}。` : '';
  const system =
    `你是数字之我 2digime，一个拥有本人确认事实的数字主体。${dateLine}` +
    '请基于下方「网络搜索结果」回答用户问题，同时可结合你掌握的「已确认本人信息」。' +
    '要求：\n' +
    '1) 明确区分「来源事实」「推理」与「本人已知信息」三类，不要混淆；\n' +
    '2) 关键事实旁标注来源编号，如 [1][2]；只能引用下方真实给出的来源，不得编造 URL；\n' +
    '3) 结尾给出「来源」列表：编号 + 标题 + URL（仅列真实来源）；\n' +
    '4) 若不同来源存在冲突，如实说明差异，不要悄悄选一个；\n' +
    '5) 时效性：涉及最新动态要体现当前日期；搜索没覆盖到的，诚实说明「目前公开信息有限」；\n' +
    '6) 自然、口语化、直接回答问题，不罗列链接、不输出分析提纲或内部标签。';

  const subjectBlock = opts.subjectFacts && opts.subjectFacts.length > 0
    ? `\n==== 已确认本人信息 ====\n${opts.subjectFacts.map((f) => `- ${f}`).join('\n')}\n`
    : '\n==== 已确认本人信息 ====\n（暂无）\n';

  let user = `用户问题：${opts.userText}\n${subjectBlock}\n==== 网络搜索结果 ====\n`;
  let index = 1;
  evidence.rounds.forEach((round, i) => {
    user += `\n-- 搜索 ${i + 1}（${round.query}）--\n`;
    round.sources.forEach((s) => {
      user += `[${index}] 标题：${s.title}\n    URL：${s.url}\n`;
      index += 1;
    });
  });
  if (index === 1) {
    user += '（本次未能获取到可用网络来源）\n';
  }
  if (evidence.research && evidence.research.unresolvedQuestions?.length) {
    user += `\n---- 尚无法回答的问题 ----\n${evidence.research.unresolvedQuestions.map((q) => `- ${q}`).join('\n')}\n`;
  }
  const turns = opts.turns && opts.turns.length > 0
    ? `\n==== 最近对话 ====\n${opts.turns.map((t) => `${t.role === 'user' ? '用户' : '我'}：${t.content.slice(0, 200)}`).join('\n')}\n`
    : '';

  const result = await opts.chat(
    [
      { role: 'system', content: system },
      ...(turns ? [{ role: 'user' as const, content: turns }] : []),
      { role: 'user', content: user },
    ],
    { temperature: 0.3, maxTokens: 1600 },
  );
  let text = String(result.text || '').trim();
  if (!text) {
    // 一次重试：模型偶发空输出
    const retry = await opts.chat(
      [
        { role: 'system', content: system },
        ...(turns ? [{ role: 'user' as const, content: turns }] : []),
        { role: 'user', content: user },
      ],
      { temperature: 0.5, maxTokens: 1600 },
    );
    text = String(retry.text || '').trim();
  }
  if (!text) {
    throw new ConversationSearchError('synthesis', '综合生成无输出');
  }
  return text;
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
    { temperature: 0.3, maxTokens: 800 },
  );
  return String(result.text || '').trim();
}

/** 主入口：决策 + 执行 + 综合。失败时按语义回退。 */
export async function runConversationSearch(opts: ConversationSearchOptions): Promise<ConversationSearchReply> {
  const need = await decideSearchNeed(opts);
  if (need.mode === 'no_search') {
    return { mode: 'no_search', text: '', evidence: { mode: 'no_search', rounds: [] }, usedExternal: false };
  }
  try {
    if (need.mode === 'deep_research') {
      return await runDeepResearch(opts, need);
    }
    return await runWebSearch(opts, need);
  } catch (err) {
    // 搜索/综合失败：诚实失败回退，不把协议错误抛到用户面。
    try {
      const honestText = await buildHonestFailureReply(opts);
      return {
        mode: need.mode,
        text: honestText,
        evidence: { mode: need.mode, rounds: [] },
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