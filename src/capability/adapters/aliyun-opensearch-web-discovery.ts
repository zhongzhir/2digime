/**
 * Aliyun OpenSearch Web Search → WebDiscoveryProvider。
 * App / IPC / Discover / Talk 只看见 web-discovery；本文件停在 Relay 适配层。
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

export const ALIYUN_OPENSEARCH_PROVIDER_ID = 'aliyun-opensearch';
export const ALIYUN_OPENSEARCH_SERVICE_ID = 'ops-web-search-001';

export interface AliyunOpenSearchWebDiscoveryOptions {
  apiKey: string;
  endpoint: string;
  workspace?: string;
  serviceId?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface AliyunSearchRow {
  title?: string;
  link?: string;
  snippet?: string;
  content?: string;
  meta_info?: { publishedTime?: string };
}

function endpointOrigin(raw: string): string {
  const value = String(raw || '').trim().replace(/\/+$/, '');
  if (!value) return '';
  try {
    const url = value.includes('://') ? new URL(value) : new URL(`https://${value}`);
    if (url.protocol !== 'https:') return '';
    return url.origin;
  } catch {
    return '';
  }
}

function classifyHttp(status: number, code: string): WebDiscoveryError {
  const labeled = `${code || status}`.slice(0, 60);
  if (status === 401 || status === 403 || /unauthoriz|forbidden|invalid.*key|accessdenied/i.test(code)) {
    return new WebDiscoveryError('AUTH_FAILED', `aliyun_${labeled || 'auth'}`, status === 403 ? 403 : 401);
  }
  if (status === 429 || /throttl|ratelimit|quota|flowcontrol/i.test(code)) {
    return new WebDiscoveryError('RATE_LIMITED', `aliyun_${labeled || 'quota'}`, 429);
  }
  if (status === 503 || status === 504) {
    return new WebDiscoveryError('TEMPORARY_UNAVAILABLE', `aliyun_${labeled || 'unavailable'}`, status);
  }
  return new WebDiscoveryError('PROVIDER_ERROR', `aliyun_${labeled || 'error'}`, status >= 400 ? status : 502);
}

export function createAliyunOpenSearchWebDiscoveryProvider(
  options: AliyunOpenSearchWebDiscoveryOptions,
): WebDiscoveryProvider {
  const apiKey = String(options.apiKey || '').trim();
  const origin = endpointOrigin(options.endpoint);
  const workspace = String(options.workspace || 'default').trim() || 'default';
  const serviceId = String(options.serviceId || ALIYUN_OPENSEARCH_SERVICE_ID).trim() || ALIYUN_OPENSEARCH_SERVICE_ID;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const fetchImpl = options.fetchImpl || fetch;
  if (!apiKey || !origin) {
    throw new WebDiscoveryError('TEMPORARY_UNAVAILABLE', 'MANAGED_PROVIDER_CONFIG_REQUIRED', 503);
  }

  return {
    id: ALIYUN_OPENSEARCH_PROVIDER_ID,
    async search(input: WebDiscoverySearchInput): Promise<WebDiscoveryHit[]> {
      const query = String(input.query || '').trim();
      if (query.length < 2) {
        throw new WebDiscoveryError('PROVIDER_ERROR', 'query_too_short', 400);
      }
      const topK = Math.min(WEB_DISCOVERY_MAX_RESULTS, Math.max(1, input.limit || 8));
      const url = `${origin}/v3/openapi/workspaces/${encodeURIComponent(workspace)}/web-search/${encodeURIComponent(serviceId)}`;
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
              query_rewrite: false,
              top_k: topK,
              content_type: 'snippet',
              way: 'pro',
            }),
          },
          bound.signal,
        );
      } catch (err) {
        if (isTimeoutAbortReason(err) || bound.timedOut() || (err as { name?: string }).name === 'AbortError') {
          throw new WebDiscoveryError('TEMPORARY_UNAVAILABLE', 'aliyun_timeout', 503);
        }
        throw new WebDiscoveryError('TEMPORARY_UNAVAILABLE', 'aliyun_unreachable', 503);
      } finally {
        bound.dispose();
      }

      let json: {
        code?: string;
        http_code?: number;
        message?: string;
        result?: { search_result?: AliyunSearchRow[] };
      } = {};
      try {
        json = (await res.json()) as typeof json;
      } catch {
        json = {};
      }
      if (!res.ok) {
        throw classifyHttp(res.status, String(json.code || json.message || ''));
      }
      if (json.code && String(json.code).toLowerCase() !== 'success') {
        throw classifyHttp(Number(json.http_code || res.status || 502), String(json.code));
      }
      const rows = Array.isArray(json.result?.search_result) ? json.result.search_result : [];
      const out: WebDiscoveryHit[] = [];
      const seen = new Set<string>();
      for (const row of rows) {
        const urlHit = String(row.link || '').trim();
        if (!urlHit || seen.has(urlHit)) continue;
        seen.add(urlHit);
        const title = String(row.title || urlHit).slice(0, 240);
        const snippet = String(row.snippet || row.content || '').trim().slice(0, 500);
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
