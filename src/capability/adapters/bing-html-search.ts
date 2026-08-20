/**
 * BingHtmlSearchConnector — 真实 Web 搜索 Connector（v1）。
 * - 无需账号/无需 key：直接抓取 Bing HTML 搜索结果页；
 * - 仅存在于适配器层；上层只消费 SearchSource；
 * - 失败抛出带 kind 的错误，由 pipeline 按「诚实失败」语义处理。
 *
 * 解析说明：Bing 结果 URL 走 /ck/a 跳转，真实目标藏在 u=a1a<base64> 参数，
 * 其中 base64 字符串以 'a' 补足后解码即为最终 URL。
 */
import type { SearchConnector } from '../search-connector';
import type { SearchSource } from '../search-contract';

export interface BingHtmlSearchConnectorOptions {
  /** 每查询最多保留的来源数。 */
  maxResults?: number;
  timeoutMs?: number;
  /** 测试可注入的 fetch（默认全局 fetch）。 */
  fetchImpl?: typeof fetch;
  /** 测试可注入 user-agent。 */
  userAgent?: string;
}

export class BingSearchConnectorError extends Error {
  readonly kind: 'network' | 'blocked' | 'empty' | 'parse';
  readonly status: number | undefined;
  constructor(kind: BingSearchConnectorError['kind'], message: string, status?: number) {
    super(message);
    this.name = 'BingSearchConnectorError';
    this.kind = kind;
    this.status = status;
  }
}

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

/** 从 Bing 结果项中解码真实 URL（href 内含 u=a1a<base64>，base64 补 'a' 前缀）。 */
export function decodeBingRedirectUrl(hrefOrEncoded: string): string {
  if (!hrefOrEncoded) return '';
  // 兼容直接传入 u= 值（a1a...）与完整 /ck/a 链接两种形态（HTML 中 & 为 &amp;）
  const encoded = hrefOrEncoded.startsWith('a1a')
    ? hrefOrEncoded
    : /[?&](?:amp;)?u=([^&]+)/.exec(hrefOrEncoded)?.[1] || '';
  if (!encoded || !encoded.startsWith('a1a')) return '';
  try {
    const decoded = Buffer.from('a' + encoded.slice(3), 'base64').toString('utf8');
    if (/^https?:\/\//i.test(decoded)) return decoded;
  } catch {
    /* fallthrough */
  }
  return '';
}

/** 解析 Bing HTML 搜索结果页，返回 {title,url}[]。 */
export function parseBingSearchResults(html: string): Array<{ title: string; url: string }> {
  const out: Array<{ title: string; url: string }> = [];
  const h2Blocks = html.match(/<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/g) || [];
  for (const block of h2Blocks) {
    const href = /href="([^"]+)"/.exec(block)?.[1] || '';
    const rawTitle = block.replace(/<[^>]+>/g, '').trim().replace(/&amp;/g, '&').replace(/&#39;/g, "'");
    if (!href || !rawTitle) continue;
    const url = decodeBingRedirectUrl(href);
    if (!url) continue;
    out.push({ title: rawTitle.slice(0, 300), url });
  }
  return out;
}

export function createBingHtmlSearchConnector(options?: BingHtmlSearchConnectorOptions): SearchConnector {
  const maxResults = options?.maxResults ?? 8;
  const timeoutMs = options?.timeoutMs ?? 15_000;
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const userAgent = options?.userAgent ?? DEFAULT_UA;

  async function search(query: string, opts?: { signal?: AbortSignal }): Promise<SearchSource[]> {
    if (!query.trim()) return [];
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-cn&count=${maxResults + 2}`;
    let response: Response;
    const init: RequestInit = {
      headers: {
        'user-agent': userAgent,
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      },
    };
    if (opts?.signal) init.signal = opts.signal;
    try {
      response = await fetchImpl(url, init);
    } catch (err) {
      throw new BingSearchConnectorError('network', `Bing 搜索网络失败: ${(err as Error).message}`);
    }
    if (response.status === 202 || response.status === 403 || response.status === 429) {
      throw new BingSearchConnectorError('blocked', `Bing 拒绝搜索请求 (${response.status})`, response.status);
    }
    if (!response.ok) {
      throw new BingSearchConnectorError('network', `Bing 搜索返回 ${response.status}`, response.status);
    }
    const html = await response.text();
    const parsed = parseBingSearchResults(html);
    if (parsed.length === 0) {
      throw new BingSearchConnectorError('empty', 'Bing 未返回可解析结果');
    }
    const seen = new Set<string>();
    const sources: SearchSource[] = [];
    for (const p of parsed) {
      const host = /^https?:\/\/([^/]+)/.exec(p.url)?.[1] || '';
      if (!host || seen.has(host)) continue;
      seen.add(host);
      sources.push({ title: p.title, url: p.url, sourceClass: 'external' });
      if (sources.length >= maxResults) break;
    }
    if (sources.length === 0) {
      throw new BingSearchConnectorError('empty', 'Bing 未返回可用来源');
    }
    return sources;
  }

  return { id: 'bing-html', search };
}