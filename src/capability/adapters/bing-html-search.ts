/**
 * BingHtmlSearchConnector — 真实 Web 搜索 Connector（v1）。
 * - 无需账号/无需 key：直接抓取 Bing HTML 搜索结果页；
 * - 仅存在于适配器层；上层只消费 SearchSource；
 * - 失败抛出带 kind 的错误，由 pipeline 按「诚实失败」语义处理。
 *
 * 解析说明：Bing 结果 URL 走 /ck/a 跳转，真实目标藏在 u=a1a<base64> 参数，
 * 其中 base64 字符串以 'a' 补足后解码即为最终 URL。
 */
import type { SearchConnector, ReadResult } from '../search-connector';
import {
  bindTimeoutSignal,
  fetchWithDeadline,
  isTimeoutAbortReason,
  throwIfAborted,
} from '../search-connector';
import type { SearchSource, SourceType } from '../search-contract';

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
  readonly kind: 'network' | 'blocked' | 'empty' | 'parse' | 'timeout';
  readonly status: number | undefined;
  readonly transient?: boolean;
  constructor(kind: BingSearchConnectorError['kind'], message: string, status?: number, transient?: boolean) {
    super(message);
    this.name = 'BingSearchConnectorError';
    this.kind = kind;
    this.status = status;
    if (transient !== undefined) this.transient = transient;
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

/** 解析 Bing HTML 搜索结果页，返回 {title,url,snippet?}[]。优先有机结果块，避免视频模块 h2。 */
export function parseBingSearchResults(html: string): Array<{ title: string; url: string; snippet?: string }> {
  const organic = parseBingAlgoResults(html);
  if (organic.length) return organic;
  const out: Array<{ title: string; url: string; snippet?: string }> = [];
  const h2Blocks = html.match(/<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/g) || [];
  for (const block of h2Blocks) {
    const href = /href="([^"]+)"/.exec(block)?.[1] || '';
    const rawTitle = block.replace(/<[^>]+>/g, '').trim().replace(/&amp;/g, '&').replace(/&#39;/g, "'");
    if (!href || !rawTitle) continue;
    const url = decodeBingRedirectUrl(href) || (/^https?:\/\//i.test(href) ? href : '');
    if (!url) continue;
    out.push({ title: rawTitle.slice(0, 300), url });
  }
  return out;
}

function parseBingAlgoResults(html: string): Array<{ title: string; url: string; snippet?: string }> {
  const out: Array<{ title: string; url: string; snippet?: string }> = [];
  const blocks = html.match(/<li[^>]*class="[^"]*\bb_algo\b[^"]*"[\s\S]*?<\/li>/gi) || [];
  for (const block of blocks) {
    const href = /<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"/i.exec(block)?.[1] || '';
    const titleHtml = /<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(block)?.[1] || '';
    const rawTitle = titleHtml.replace(/<[^>]+>/g, '').trim().replace(/&amp;/g, '&').replace(/&#39;/g, "'");
    if (!href || !rawTitle) continue;
    const url = decodeBingRedirectUrl(href) || (/^https?:\/\//i.test(href) ? href : '');
    if (!url) continue;
    const caption = /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block)?.[1] || '';
    const snippet = caption.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280);
    out.push({
      title: rawTitle.slice(0, 300),
      url,
      ...(snippet.length >= 12 ? { snippet } : {}),
    });
  }
  return out;
}

/**
 * 推导来源类型（可推导时）：不建巨型 domain 白名单，用结构特征。
 * 优先级：政府/机构官方 > 一手（厂商官网） > 新闻 > 参考（wiki/百科）> 二手 > 未知。
 */
export function deriveSourceType(url: string, title?: string): SourceType {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return 'unknown';
  }
  // 国家/地区二级域（.com.cn/.co.jp/.com.hk 等）：归一到基础域再判断，
  // 使 apple.com.cn → apple.com、gov.cn 等地区官方镜像统一进入同一套结构推导（不建大名单）。
  const countryTldMatch = /^(.+)\.(com|co|net|org|gov|ac|edu)\.(cn|jp|kr|hk|tw|sg|my|au|uk|de|fr|ca|in|it|es|br|mx|ru|za|id|th|vn|ph|nz)$/.exec(host);
  const baseHost = countryTldMatch ? `${countryTldMatch[1]}.${countryTldMatch[2]}` : host;
  // 政府/国际机构
  if (
    host.endsWith('.gov') || host === 'gov.cn' || host.endsWith('.gov.cn') || host.endsWith('.go.jp') ||
    host.endsWith('.gouv.fr') || host.endsWith('.gov.uk') || host === 'who.int' ||
    host.endsWith('.who.int') || host.endsWith('.un.org') || host.endsWith('.europa.eu') ||
    host.endsWith('.edu') || host.endsWith('.edu.cn') || host.endsWith('.ac.cn') ||
    host === 'nber.org' || host === 'imf.org' || host === 'worldbank.org' || host === 'oecd.org' ||
    host === 'iea.org'
  ) {
    return 'official';
  }
  // 参考/百科
  if (host.endsWith('wikipedia.org') || host.endsWith('wikimedia.org') || host.endsWith('baike.baidu.com')) {
    return 'reference';
  }
  // 一手/厂商官网（产品/价格/政策/公告优先）；baseHost 覆盖 apple.com.cn→apple.com 等地区镜像
  if (host === 'openai.com' || host === 'deepseek.com' || host === 'anthropic.com' || host === 'google.com' ||
    host === 'microsoft.com' || host === 'apple.com' || host === 'alibaba.com' || host === 'tencent.com' ||
    host === 'baidu.com' || host === 'nvidia.com' || host === 'meta.com' || host === 'amazon.com' ||
    baseHost === 'openai.com' || baseHost === 'deepseek.com' || baseHost === 'anthropic.com' || baseHost === 'google.com' ||
    baseHost === 'microsoft.com' || baseHost === 'apple.com' || baseHost === 'alibaba.com' || baseHost === 'tencent.com' ||
    baseHost === 'baidu.com' || baseHost === 'nvidia.com' || baseHost === 'meta.com' || baseHost === 'amazon.com') {
    return 'official';
  }
  // 新闻媒体
  const newsHosts = ['reuters.com', 'apnews.com', 'bloomberg.com', 'ft.com', 'wsj.com', 'cnn.com',
    'bbc.com', 'economist.com', 'nikkei.com', 'theguardian.com', 'nytimes.com', 'scmp.com',
    'zaobao.com', '36kr.com', 'ithome.com', 'ifeng.com', 'sina.com.cn', 'sohu.com', 'qq.com',
    '163.com', 'thepaper.cn', 'caixin.com', 'yicai.com', 'jiemian.com', 'huxiu.com', 'pingwest.com'];
  if (newsHosts.some((h) => host === h || host.endsWith('.' + h)) ||
    newsHosts.some((h) => baseHost === h || baseHost.endsWith('.' + h))) {
    return 'news';
  }
  // 二手聚合/博客/论坛
  if (host.endsWith('medium.com') || host.endsWith('zhihu.com') || host.endsWith('reddit.com') ||
    host.endsWith('github.com') || host.endsWith('csdn.net') || host.endsWith('juejin.cn')) {
    return 'secondary';
  }
  void title;
  return 'unknown';
}

/** HTML → 纯文本（evidence chunk）。 */
export function htmlToText(html: string, maxChars = 8000): string {
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h1|h2|h3|h4|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&hellip;/gi, '…')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–');
  text = text
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  if (text.length > maxChars) text = text.slice(0, maxChars);
  return text;
}

export function createBingHtmlSearchConnector(options?: BingHtmlSearchConnectorOptions): SearchConnector {
  const maxResults = options?.maxResults ?? 8;
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch;
  const userAgent = options?.userAgent ?? DEFAULT_UA;

  async function read(url: string, opts?: { signal?: AbortSignal; maxChars?: number }): Promise<ReadResult | null> {
    if (!/^https?:\/\//i.test(url)) return null;
    const bound = bindTimeoutSignal({ timeoutMs, parent: opts?.signal });
    try {
      const init: RequestInit = {
        headers: {
          'user-agent': userAgent,
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        },
        signal: bound.signal,
      };
      const response = await fetchWithDeadline(fetchImpl, url, init, bound.signal);
      if (!response.ok) return null;
      const html = await response.text();
      const content = htmlToText(html, opts?.maxChars ?? 8000);
      if (content.length < 40) return null;
      return { content, retrievedAt: new Date().toISOString() };
    } catch {
      return null; // 页面抓取失败不阻断搜索（evidence 缺失时综合如实降级）
    } finally {
      bound.dispose();
    }
  }

  async function search(query: string, opts?: { signal?: AbortSignal }): Promise<SearchSource[]> {
    if (!query.trim()) return [];
    const bound = bindTimeoutSignal({ timeoutMs, parent: opts?.signal });
    try {
      const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-cn&count=${maxResults + 2}`;
      let response: Response;
      const init: RequestInit = {
        headers: {
          'user-agent': userAgent,
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        signal: bound.signal,
      };
      try {
        throwIfAborted(bound.signal);
        response = await fetchWithDeadline(fetchImpl, url, init, bound.signal);
      } catch (err) {
        if (bound.timedOut() || isTimeoutAbortReason(err) || isTimeoutAbortReason(bound.signal.reason)) {
          throw new BingSearchConnectorError('timeout', `Bing search timed out after ${timeoutMs}ms`, undefined, true);
        }
        throw new BingSearchConnectorError('network', `Bing 搜索网络失败: ${(err as Error).message}`, undefined, true);
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
        sources.push({
          title: p.title,
          url: p.url,
          sourceClass: 'external',
          sourceType: deriveSourceType(p.url, p.title),
          ...('snippet' in p && p.snippet ? { snippet: p.snippet } : {}),
        });
        if (sources.length >= maxResults) break;
      }
      if (sources.length === 0) {
        throw new BingSearchConnectorError('empty', 'Bing 未返回可用来源');
      }
      return sources;
    } catch (err) {
      if (bound.timedOut() && !(err instanceof BingSearchConnectorError && err.kind === 'timeout')) {
        throw new BingSearchConnectorError('timeout', `Bing search timed out after ${timeoutMs}ms`, undefined, true);
      }
      throw err;
    } finally {
      bound.dispose();
    }
  }

  return { id: 'bing-html', search, read };
}