/**
 * SearchConnector — Search/Research Connector 契约。
 * 2digime 上层不感知具体搜索 provider；Connector 实现（Bing/Google/Tavily…）都在适配器层。
 */
import type { SearchSource } from './search-contract';

export interface SearchConnector {
  readonly id: string;
  /** 执行一次真实外部搜索，返回来源条目（去重后）。失败抛错，由调用方按失败语义处理。 */
  search(query: string, options?: { signal?: AbortSignal }): Promise<SearchSource[]>;
}