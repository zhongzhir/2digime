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

/** 外部来源条目：一律标记 external，默认不写入本人事实。 */
export interface SearchSource {
  title: string;
  url: string;
  snippet?: string;
  sourceClass: 'external';
}

/** 决策产物：搜索模式 + 待执行查询。 */
export interface SearchNeed {
  mode: SearchMode;
  queries: string[];
}

/** 一轮搜索的结果（一条 query 一组来源）。 */
export interface SearchRound {
  query: string;
  sources: SearchSource[];
}

/** deep_research 内部工作区（默认不展示给用户）。 */
export interface ResearchPlan {
  plan?: string[];
  unresolvedQuestions?: string[];
  gaps?: string[];
}

/** 搜索证据：供综合成文与测试断言使用。 */
export interface SearchEvidence {
  mode: SearchMode;
  rounds: SearchRound[];
  /** deep_research 实际执行的搜索轮数（>=2 时满足最小闭环）。 */
  iterations?: number;
  research?: ResearchPlan;
}

export const EXTERNAL_SOURCE_CLASS = 'external' as const;

export function isExternalSource(source: SearchSource): boolean {
  return source.sourceClass === 'external';
}