/**
 * SearchConnector — Search/Research Connector 契约。
 * 2digime 上层不感知具体搜索 provider；Connector 实现（Bing/Google/Tavily…）都在适配器层。
 *
 * 上层保持统一：conversation domain 不写任何 provider 判断（OpenAI/Bing/Google/Tavily）。
 * evidence retrieval（read）是可选的：provider 可提供原生 source/citation/evidence，
 * 否则由 degraded connector 通过页面抓取提供 evidence chunk。
 */
import type { SearchSource } from './search-contract';

export interface ReadResult {
  /** 抓取到的正文纯文本（evidence chunk）。 */
  content: string;
  /** 检索时间（ISO，UTC）。 */
  retrievedAt: string;
}

export interface SearchConnector {
  readonly id: string;
  /** 执行一次真实外部搜索，返回来源条目（去重后）。失败抛错，由调用方按失败语义处理。 */
  search(query: string, options?: { signal?: AbortSignal }): Promise<SearchSource[]>;
  /** 可选：读取并提取指定 URL 的 evidence chunk（claim-grounded 需要）。失败返回 null。 */
  read?(url: string, options?: { signal?: AbortSignal; maxChars?: number }): Promise<ReadResult | null>;
}