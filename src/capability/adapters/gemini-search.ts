/**
 * GeminiSearchConnector — 真实 Google Search Grounding Connector（DIGITALME-SEARCH-PROVIDER-GEMINI-01）。
 *
 * 仅存在于 adapter 层；上层只消费 SearchConnector / SearchSource / Evidence。
 * conversation domain 不感知 provider（Google/Gemini/generativelanguage.googleapis.com/model id 只出现在本文件）。
 *
 * 链路：search(query) → Gemini generateContent(googleSearch tool)
 *      → groundingChunks(title/uri/domain) + groundingSupports(segment↔chunkIndex) + webSearchQueries
 *      → 映射为统一 SearchSource[]（groundingSupport 作为额外证据 signal）
 *      → read(url) → 解析 Google grounding redirect 到真实 URL + 抓取正文 evidence chunk。
 *
 * 依赖注入：apiKey、model、fetchImpl 可注入（测试/生产共用）；生产从环境读取。
 * 失败：抛 GeminiSearchConnectorError，由 pipeline 按现有失败语义处理（诚实失败 / degraded）。
 */
import type { SearchConnector, ReadResult } from '../search-connector';
import type { SearchSource, SourceType } from '../search-contract';
import { deriveSourceType, htmlToText } from './bing-html-search';

export interface GeminiSearchConnectorOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /** 每查询最多保留的来源数。 */
  maxResults?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** usage 回调（诊断/成本统计；不含 secret）。 */
  onUsage?: (usage: { promptTokens: number; completionTokens: number; thoughtsTokens?: number }) => void;
  /**
   * transient 失败重试：最多 initial + maxRetries 次（默认 2 次重试）。
   * 仅对明确 transient（429/500/502/503/504、网络 reset/timeout）重试；
   * 400/401/403 等 auth/invalid 不重试。指数退避 + jitter。
   */
  maxRetries?: number;
  /** 指数退避基数（ms），默认 400。 */
  retryBaseMs?: number;
  /** 退避上限（ms），默认 6000。 */
  retryMaxMs?: number;
  /** 重试诊断回调（不改变语义）。 */
  onRetry?: (info: { attempt: number; status?: number; message: string }) => void;
}

export class GeminiSearchConnectorError extends Error {
  readonly kind: 'network' | 'auth' | 'quota' | 'invalid' | 'empty' | 'model' | 'response';
  readonly status: number | undefined;
  readonly transient?: boolean;
  constructor(kind: GeminiSearchConnectorError['kind'], message: string, status?: number, transient?: boolean) {
    super(message);
    this.name = 'GeminiSearchConnectorError';
    this.kind = kind;
    this.status = status;
    if (transient !== undefined) this.transient = transient;
  }
}

const DEFAULT_MODEL = 'gemini-3.5-flash';
const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

interface GeminiChunk {
  web?: { uri?: string; title?: string; domain?: string };
}
interface GeminiSupport {
  segment?: { text?: string; startIndex?: number; endIndex?: number };
  groundingChunkIndices?: number[];
  confidenceScores?: number[];
}

/** 是否明确 transient（可重试）：429/5xx 或网络 reset/timeout；auth/invalid 不算。 */
function isTransientStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function classifyError(status: number, msg: string): GeminiSearchConnectorError {
  const m = (msg || '').toLowerCase();
  const transient = isTransientStatus(status);
  if (status === 401 || status === 403) return new GeminiSearchConnectorError('auth', `Gemini auth failed (${status}): ${msg}`, status, false);
  if (m.includes('quota') || m.includes('rate limit') || status === 429) {
    return new GeminiSearchConnectorError('quota', `Gemini quota/rate limited (${status}): ${msg}`, status, true);
  }
  if (m.includes('model') && (m.includes('not available') || m.includes('no longer'))) {
    return new GeminiSearchConnectorError('model', `Gemini model unavailable (${status}): ${msg}`, status, false);
  }
  if (status >= 500) return new GeminiSearchConnectorError('network', `Gemini server error (${status}): ${msg}`, status, true);
  return new GeminiSearchConnectorError('invalid', `Gemini request rejected (${status}): ${msg}`, status, false);
}

function isRetriable(err: unknown): boolean {
  const e = err as { transient?: boolean; kind?: string };
  if (e && e.transient === true) return true;
  // 网络 reset/timeout（fetch 抛错、无 status）也算 transient。
  if (e && e.kind === 'network' && !e.transient) return true;
  return false;
}

async function sleepMs(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

/** bounded exponential backoff + jitter。 */
function backoffMs(attempt: number, base: number, max: number): number {
  const exp = Math.min(base * Math.pow(2, attempt - 1), max);
  return Math.round(exp * (0.5 + Math.random() * 0.5));
}

export function createGeminiSearchConnector(options: GeminiSearchConnectorOptions): SearchConnector {
  const apiKey = options.apiKey;
  const model = options.model ?? DEFAULT_MODEL;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE;
  const maxResults = options.maxResults ?? 8;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const maxRetries = options.maxRetries ?? 2;
  const retryBaseMs = options.retryBaseMs ?? 400;
  const retryMaxMs = options.retryMaxMs ?? 6000;
  const userAgent = DEFAULT_UA;

  async function geminiGenerate(query: string, opts?: { signal?: AbortSignal }): Promise<{
    text: string;
    chunks: GeminiChunk[];
    supports: GeminiSupport[];
    queries: string[];
  }> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (attempt > 0 && opts?.signal?.aborted) {
        throw new GeminiSearchConnectorError('network', 'Gemini request aborted');
      }
      if (attempt > 0) {
        const delay = backoffMs(attempt, retryBaseMs, retryMaxMs);
        if (options.onRetry && lastErr) {
          const le = lastErr as { status?: number; message?: string };
          options.onRetry({
            attempt,
            message: String(le.message || le),
            ...(typeof le.status === 'number' ? { status: le.status } : {}),
          });
        }
        await sleepMs(delay);
      }
      try {
        return await geminiGenerateOnce(query, opts);
      } catch (err) {
        lastErr = err;
        if (!isRetriable(err)) throw err;
        // transient → 继续重试（最多 maxRetries 次）；全部失败后抛最后错误。
      }
    }
    throw lastErr;
  }

  async function geminiGenerateOnce(query: string, opts?: { signal?: AbortSignal }): Promise<{
    text: string;
    chunks: GeminiChunk[];
    supports: GeminiSupport[];
    queries: string[];
  }> {
    const url = `${baseUrl.replace(/\/+$/, '')}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      contents: [{ role: 'user', parts: [{ text: query }] }],
      tools: [{ googleSearch: {} }],
    };
    let response: Response;
    const init: RequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };
    if (opts?.signal) init.signal = opts.signal;
    try {
      response = await fetchImpl(url, init);
    } catch (err) {
      // 网络 reset / timeout：transient。
      throw new GeminiSearchConnectorError('network', `Gemini network failure: ${(err as Error).message}`, undefined, true);
    }
    if (!response.ok) {
      let msg = '';
      try {
        const j = await response.json() as { error?: { message?: string } };
        msg = (j.error && j.error.message) || JSON.stringify(j);
      } catch {
        msg = `HTTP ${response.status}`;
      }
      throw classifyError(response.status, msg);
    }
    let j: {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; groundingMetadata?: {
        groundingChunks?: Array<{ web?: { uri?: string; title?: string; domain?: string } }>;
        groundingSupports?: Array<GeminiSupport>;
        webSearchQueries?: unknown[];
      } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    } = {};
    try {
      j = (await response.json()) as typeof j;
    } catch {
      throw new GeminiSearchConnectorError('response', 'Gemini returned non-JSON');
    }
    if (options.onUsage && j.usageMetadata) {
      const t = j.usageMetadata.thoughtsTokenCount;
      options.onUsage({
        promptTokens: j.usageMetadata.promptTokenCount || 0,
        completionTokens: j.usageMetadata.candidatesTokenCount || 0,
        ...(typeof t === 'number' ? { thoughtsTokens: t } : {}),
      });
    }
    const cand = j.candidates && j.candidates[0];
    const gm = (cand && cand.groundingMetadata) || {};
    const chunks = Array.isArray(gm.groundingChunks) ? gm.groundingChunks : [];
    const supports = Array.isArray(gm.groundingSupports) ? gm.groundingSupports : [];
    const queries = Array.isArray(gm.webSearchQueries) ? gm.webSearchQueries.map((q: unknown) => String(q)) : [];
    const text = (cand && cand.content && cand.content.parts || []).map((p: any) => p.text || '').join('');
    if (chunks.length === 0) {
      throw new GeminiSearchConnectorError('empty', 'Gemini grounding returned no source chunks');
    }
    return { text, chunks, supports, queries };
  }

  async function search(query: string, opts?: { signal?: AbortSignal }): Promise<SearchSource[]> {
    if (!query.trim()) return [];
    const { chunks, supports } = await geminiGenerate(query, opts);
    const seenTitles = new Set<string>();
    const sources: SearchSource[] = [];
    for (const chunk of chunks) {
      const uri = chunk.web && chunk.web.uri;
      if (!uri) continue;
      // Google grounding chunk URLs 均为 vertexaisearch redirect（同一 host），不能按 host 去重；
      // 改按 title 去重保留多个不同来源。
      const title = (chunk.web && chunk.web.title) || uri;
      const titleKey = title.toLowerCase().trim();
      if (seenTitles.has(titleKey)) continue;
      seenTitles.add(titleKey);
      // 基于 redirect 解析后的真实 URL 判断来源类型，并让上层 host 去重作用于真实 host。
      const realUrl = await resolveGroundingUrl(uri, opts?.signal);
      const source: SearchSource = {
        title,
        url: realUrl || uri,
        sourceClass: 'external',
        sourceType: deriveSourceType(realUrl || uri, title),
        grounded: true,
      };
      // §七：把 grounding support signal 附到来源（segment 文本 + confidence）。
      const supportsForThisChunk = supports
        .map((s, idx) => ({ s, idx }))
        .filter(({ s }) => Array.isArray(s.groundingChunkIndices) && s.groundingChunkIndices.includes(chunks.indexOf(chunk)))
        .map(({ s }) => {
          const entry: { segment: string; confidence?: number } = {
            segment: (s.segment && s.segment.text) || '',
          };
          const conf = s.confidenceScores && s.confidenceScores[0];
          if (typeof conf === 'number') entry.confidence = conf;
          return entry;
        })
        .filter((x) => x.segment.length > 0);
      if (supportsForThisChunk.length > 0) source.groundingSupport = supportsForThisChunk;
      sources.push(source);
      if (sources.length >= maxResults) break;
    }
    if (sources.length === 0) {
      throw new GeminiSearchConnectorError('empty', 'Gemini grounding returned no usable sources');
    }
    return sources;
  }

  /** 仅对 Google grounding redirect host 做真实 URL 解析（bounded）；非 redirect 直接返回。 */
  async function resolveGroundingUrl(url: string, signal?: AbortSignal): Promise<string | null> {
    try {
      const host = new URL(url).hostname;
      const isRedirectHost =
        host === 'vertexaisearch.cloud.google.com' || host.endsWith('.vertexaisearch.cloud.google.com') ||
        host === 'googleusercontent.com' || host.endsWith('.googleusercontent.com');
      if (!isRedirectHost) return null;
      return await resolveRealUrl(url, signal);
    } catch {
      return null;
    }
  }

  /** 解析 Google grounding redirect 到真实 URL（跟随重定向）。HEAD 失败/仍为 redirect 时回退 GET。 */
  async function resolveRealUrl(url: string, signal?: AbortSignal): Promise<string | null> {
    if (!/^https?:\/\//i.test(url)) return null;
    const isGoogleRedirect = (u: string) => {
      try {
        const h = new URL(u).hostname;
        return h === 'vertexaisearch.cloud.google.com' || h.endsWith('.vertexaisearch.cloud.google.com') ||
          h === 'googleusercontent.com' || h.endsWith('.googleusercontent.com');
      } catch {
        return false;
      }
    };
    const headers = { 'user-agent': userAgent, 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' };
    // HEAD 优先（轻量）
    try {
      const init: RequestInit = { method: 'HEAD', redirect: 'follow', headers };
      if (signal) init.signal = signal;
      const res = await fetchImpl(url, init);
      const finalUrl = res.url || url;
      if (res.ok && finalUrl && !isGoogleRedirect(finalUrl)) return finalUrl;
    } catch {
      /* fallthrough to GET */
    }
    // GET 回退：跟随重定向拿到最终 URL
    try {
      const init: RequestInit = { method: 'GET', redirect: 'follow', headers };
      if (signal) init.signal = signal;
      const res = await fetchImpl(url, init);
      const finalUrl = res.url || url;
      if (res.ok && finalUrl && !isGoogleRedirect(finalUrl)) return finalUrl;
    } catch {
      return null;
    }
    return null;
  }

  /** URL Context：读取指定来源正文作为 evidence chunk（§六，不得只凭 search snippet）。
   *  先解析 redirect 到真实 URL 再抓取（更稳）；transient 网络/5xx 做 bounded retry（复用同一退避策略）。 */
  async function read(url: string, opts?: { signal?: AbortSignal; maxChars?: number }): Promise<ReadResult | null> {
    if (!/^https?:\/\//i.test(url)) return null;
    // 先解析 grounding redirect 到真实 URL，再用真实 URL 抓正文。
    const resolved = await resolveRealUrl(url, opts?.signal);
    const targets = [resolved && /^https?:\/\//i.test(resolved) ? resolved : url, resolved && /^https?:\/\//i.test(resolved) ? url : null].filter((u): u is string => !!u);
    for (const target of targets) {
      const result = await readOnce(target, opts);
      if (result) return result;
    }
    return null;
  }

  async function readOnce(url: string, opts?: { signal?: AbortSignal; maxChars?: number }): Promise<ReadResult | null> {
    const init: RequestInit = {
      headers: {
        'user-agent': userAgent,
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      },
    };
    if (opts?.signal) init.signal = opts.signal;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      if (attempt > 0 && opts?.signal?.aborted) return null;
      if (attempt > 0) await sleepMs(backoffMs(attempt, retryBaseMs, retryMaxMs));
      try {
        const response = await fetchImpl(url, init);
        if (response.status === 429 || (response.status >= 500 && response.status <= 599)) {
          if (attempt < maxRetries) continue;
          return null;
        }
        if (!response.ok) return null;
        const finalUrl = response.url || url;
        const html = await response.text();
        const content = htmlToText(html, opts?.maxChars ?? 6000);
        if (content.length < 40) return null;
        return { content, retrievedAt: new Date().toISOString(), resolvedUrl: finalUrl };
      } catch {
        // 网络 reset/timeout：transient，bounded retry；最终仍拿不到则返回 null（不阻断）。
        if (attempt >= maxRetries) return null;
      }
    }
    return null;
  }

  return { id: 'gemini-search', search, read };
}
