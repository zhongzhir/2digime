/**
 * Conversation Search & Research — External Capability Contract (frozen semantics).
 * 该契约位于能力层之上：provider 细节（Bing/Google/Tavily…）只存在于 Connector 实现，
 * 上层一律只消费 SearchSource / SearchNeed / SearchEvidence。
 *
 * 关键不变式：
 * - SearchSource.sourceClass 固定为 'external'：网络搜索结果绝不自动成为 Owner 事实；
 *   只有 Owner 确认或表达才进入既有成长规则。
 * - 决策输入 = 模型判断 + 明确任务特征；不是关键词 if/else 树。
 */
export type SearchMode = 'no_search' | 'web_search' | 'deep_research';

/** 来源类型（可推导时）：一手/官方 > 新闻 > 参考/二手 > 未知。不建白名单，靠结构推导。 */
export type SourceType = 'official' | 'primary' | 'news' | 'reference' | 'secondary' | 'unknown';

/**
 * 外部来源条目：一律标记 external，默认不写入本人事实。
 * 支持 evidence grounding：search → read → evidence chunk → claim-grounded synthesis。
 */
export interface SearchSource {
  title: string;
  url: string;
  snippet?: string;
  sourceClass: 'external';
  /** 检索到的正文证据片段（evidence chunk），供 claim-grounded synthesis 使用。 */
  evidenceChunk?: string;
  /** 检索时间（ISO，UTC）。 */
  retrievedAt?: string;
  /** 可推导的来源类型（一手/官方/新闻/参考/二手）。 */
  sourceType?: SourceType;
  /** Google Grounding support 信号（§七）：answer segment ↔ 该来源 chunk 的映射。
   *  仅作额外 signal；Digital Me 最终 citation 仍须绑定 evidenceChunk，不因 Gemini 说 grounded 就自动信任。 */
  groundingSupport?: { segment: string; confidence?: number }[];
  /** 该来源是否经 provider grounding 标记（google search grounding 命中）。 */
  grounded?: boolean;
}

/** 决策产物：搜索模式 + 待执行查询 + 结构化搜索需要。 */
export interface SearchNeed {
  mode: SearchMode;
  queries: string[];
  /** 模型给出决策理由。 */
  reason?: string;
  /** 是否要求最新时效（答案随时间变化）。 */
  freshnessRequired?: boolean;
  /** 是否需要外部权威事实核验（模型知识可能过时）。 */
  externalVerificationRequired?: boolean;
  /** 研究复杂度 1-5（交叉验证需求）。 */
  researchComplexity?: number;
  /** true 表示决策器降级（classifier 失败但问题明显涉及当前外部事实），须暴露 degraded 状态。 */
  degraded?: boolean;
}

/** 一轮搜索的结果（一条 query 一组来源）。 */
export interface SearchRound {
  query: string;
  sources: SearchSource[];
}

/** Deep Research gap：第二轮/后续轮只针对真实缺口查询。 */
export interface ResearchGap {
  missingQuestion: string;
  whyNeeded: string;
  preferredSourceType?: string;
  followupQuery: string;
}

/** deep_research 内部工作区（默认不展示给用户）。 */
export interface ResearchPlan {
  plan?: string[];
  unresolvedQuestions?: string[];
  gaps?: string[];
  /** 结构化 gap（coverage evaluation 产物，驱动后续轮查询）。 */
  researchGaps?: ResearchGap[];
  /** 首轮 coverage 评估：已覆盖 / 缺失主题。 */
  coverage?: { covered: string[]; missing: string[] };
}

/** 引用绑定验证报告：claim → citation → evidence chunk 的最小可验证性。 */
export interface CitationReport {
  /** 正文出现的引用编号。 */
  cited: number[];
  /** 超出真实来源范围的引用（无效）。 */
  outOfRange: number[];
  /** 引用了但无 evidence chunk 支撑的编号（不可核验）。 */
  ungrounded: number[];
  /** 有效且被证据支撑的引用数。 */
  validCount: number;
}

/** 搜索证据：供综合成文与测试断言使用。 */
export interface SearchEvidence {
  mode: SearchMode;
  rounds: SearchRound[];
  /** deep_research 实际执行的搜索轮数（>=2 时满足最小闭环）。 */
  iterations?: number;
  research?: ResearchPlan;
  /** 引用绑定验证报告（claim→citation→evidence chunk）。 */
  citationReport?: CitationReport;
  /** 决策 degraded 状态：true 时综合须如实暴露。 */
  degraded?: boolean;
  /** 主 provider 不可用、实际使用 degraded fallback（如 Bing）时 true；不得标成正式 grounded search。 */
  providerDegraded?: boolean;
  /** 实际使用的 provider id（diagnostic，不含 secret）。 */
  providerId?: string;
}

export const EXTERNAL_SOURCE_CLASS = 'external' as const;

export function isExternalSource(source: SearchSource): boolean {
  return source.sourceClass === 'external';
}

/**
 * 当前 web search 的可用结果合同（复用 SearchSource，不用字数阈值）。
 * HTTP 200 / 空结构成功 ≠ 能力成功：必须至少有一条可检索的外部来源条目。
 */
export function isUsableWebEvidenceItem(source: SearchSource | null | undefined): boolean {
  if (!source || source.sourceClass !== EXTERNAL_SOURCE_CLASS) return false;
  const url = String(source.url || '').trim();
  if (!/^https?:\/\//i.test(url)) return false;
  const title = String(source.title || '').trim();
  return title.length > 0 || url.length > 0;
}

/** 一轮/一次 search 是否具备足以支撑当前事实检索的 evidence/source item。 */
export function hasUsableWebEvidence(sources: readonly SearchSource[] | null | undefined): boolean {
  if (!sources || sources.length === 0) return false;
  return sources.some((s) => isUsableWebEvidenceItem(s));
}