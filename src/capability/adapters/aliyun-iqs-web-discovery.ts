/**
 * Aliyun IQS UnifiedSearch → WebDiscoveryProvider。
 * App / IPC / Discover / Talk 只看见 web-discovery；本文件停在 Relay 适配层。
 * 不接 GenericSearch、网页解析、多模态。
 */
import {
  bindTimeoutSignal,
  fetchWithDeadline,
  isTimeoutAbortReason,
} from '../search-connector';
import {
  WebDiscoveryError,
  WEB_DISCOVERY_MAX_RESULTS,
  type WebDiscoveryHit,
  type WebDiscoveryProvider,
  type WebDiscoverySearchInput,
} from '../web-discovery';

export const ALIYUN_IQS_PROVIDER_ID = 'aliyun-iqs';
export const ALIYUN_IQS_UNIFIED_SEARCH_ORIGIN = 'https://cloud-iqs.aliyuncs.com';
export const ALIYUN_IQS_UNIFIED_SEARCH_PATH = '/search/unified';
export const ALIYUN_IQS_ENGINE_TYPE = 'Generic';
const IQS_FIRST_STAGE_MAX_RESULTS = 10;

export interface AliyunIqsWebDiscoveryOptions {
  apiKey: string;
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface IqsPageItem {
  title?: string;
  link?: string;
  url?: string;
  snippet?: string;
  summary?: string;
  publishedTime?: string;
  hostname?: string;
  hostLogo?: string;
}

function unifiedSearchUrl(raw: string): string {
  const value = String(raw || ALIYUN_IQS_UNIFIED_SEARCH_ORIGIN).trim().replace(/\/+$/, '');
  if (!value) return `${ALIYUN_IQS_UNIFIED_SEARCH_ORIGIN}${ALIYUN_IQS_UNIFIED_SEARCH_PATH}`;
  try {
    const url = value.includes('://') ? new URL(value) : new URL(`https://${value}`);
    if (url.protocol !== 'https:') return '';
    if (/\/search\/unified\/?$/i.test(url.pathname)) {
      return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    }
    return `${url.origin}${ALIYUN_IQS_UNIFIED_SEARCH_PATH}`;
  } catch {
    return '';
  }
}

function classifyHttp(status: number, code: string): WebDiscoveryError {
  const labeled = `${code || status}`.slice(0, 60);
  if (status === 401 || status === 403 || /unauthoriz|forbidden|invalid.*key|accessdenied|apikey/i.test(code)) {
    return new WebDiscoveryError('AUTH_FAILED', `iqs_${labeled || 'auth'}`, status === 403 ? 403 : 401);
  }
  if (status === 429 || /throttl|ratelimit|quota|flowcontrol/i.test(code)) {
    return new WebDiscoveryError('RATE_LIMITED', `iqs_${labeled || 'quota'}`, 429);
  }
  if (status === 503 || status === 504 || status === 408) {
    return new WebDiscoveryError('TEMPORARY_UNAVAILABLE', `iqs_${labeled || 'unavailable'}`, status);
  }
  return new WebDiscoveryError('PROVIDER_ERROR', `iqs_${labeled || 'error'}`, status >= 400 ? status : 502);
}

function pageItemsFrom(json: {
  pageItems?: IqsPageItem[];
  data?: { pageItems?: IqsPageItem[] };
  result?: { pageItems?: IqsPageItem[] };
}): IqsPageItem[] {
  if (Array.isArray(json.pageItems)) return json.pageItems;
  if (Array.isArray(json.data?.pageItems)) return json.data.pageItems;
  if (Array.isArray(json.result?.pageItems)) return json.result.pageItems;
  return [];
}

export function createAliyunIqsWebDiscoveryProvider(
  options: AliyunIqsWebDiscoveryOptions,
): WebDiscoveryProvider {
  const apiKey = String(options.apiKey || '').trim();
  const url = unifiedSearchUrl(options.endpoint || '');
  const timeoutMs = options.timeoutMs ?? 8_000;
  const fetchImpl = options.fetchImpl || fetch;
  if (!apiKey || !url) {
    throw new WebDiscoveryError('TEMPORARY_UNAVAILABLE', 'MANAGED_PROVIDER_CONFIG_REQUIRED', 503);
  }

  return {
    id: ALIYUN_IQS_PROVIDER_ID,
    async search(input: WebDiscoverySearchInput): Promise<WebDiscoveryHit[]> {
      const query = String(input.query || '').trim();
      if (query.length < 2) {
        throw new WebDiscoveryError('PROVIDER_ERROR', 'query_too_short', 400);
      }
      const topK = Math.min(
        IQS_FIRST_STAGE_MAX_RESULTS,
        Math.min(WEB_DISCOVERY_MAX_RESULTS, Math.max(1, input.limit || 8)),
      );
      const bound = bindTimeoutSignal({ timeoutMs });
      let res: Response;
      try {
        res = await fetchWithDeadline(
          fetchImpl,
          url,
          {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              query,
              engineType: ALIYUN_IQS_ENGINE_TYPE,
              contents: {
                mainText: false,
                markdownText: false,
                summary: false,
                rerankScore: false,
              },
              advancedParams: {
                numResults: topK,
              },
            }),
          },
          bound.signal,
        );
      } catch (err) {
        if (isTimeoutAbortReason(err) || bound.timedOut() || (err as { name?: string }).name === 'AbortError') {
          throw new WebDiscoveryError('TEMPORARY_UNAVAILABLE', 'iqs_timeout', 503);
        }
        throw new WebDiscoveryError('TEMPORARY_UNAVAILABLE', 'iqs_unreachable', 503);
      } finally {
        bound.dispose();
      }

      let json: {
        code?: string | number;
        message?: string;
        errorCode?: string;
        pageItems?: IqsPageItem[];
        data?: { pageItems?: IqsPageItem[] };
        result?: { pageItems?: IqsPageItem[] };
      } = {};
      try {
        json = (await res.json()) as typeof json;
      } catch {
        json = {};
      }
      if (!res.ok) {
        throw classifyHttp(res.status, String(json.code || json.errorCode || json.message || ''));
      }
      const code = String(json.code || '').toLowerCase();
      if (code && code !== 'success' && code !== 'ok' && code !== '200' && code !== '0') {
        throw classifyHttp(res.status || 502, String(json.code || json.errorCode || json.message || ''));
      }
      const rows = pageItemsFrom(json);
      const out: WebDiscoveryHit[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        const urlHit = String(row.link || row.url || '').trim();
        if (!urlHit || seen.has(urlHit)) continue;
        seen.add(urlHit);
        const title = String(row.title || urlHit).slice(0, 240);
        const snippet = String(row.snippet || row.summary || '').trim().slice(0, 500);
        out.push({
          title,
          url: urlHit.slice(0, 500),
          ...(snippet ? { snippet } : {}),
        });
        if (out.length >= topK) break;
      }
      return out;
    },
  };
}
