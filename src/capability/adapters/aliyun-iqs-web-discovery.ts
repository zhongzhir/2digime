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
  log?: (event: string, fields: Record<string, string | number | boolean | undefined>) => void;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function readField(value: unknown, names: string[]): unknown {
  const rec = asRecord(value);
  if (!rec) return undefined;
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const [key, field] of Object.entries(rec)) {
    if (wanted.has(key.toLowerCase())) return field;
  }
  return undefined;
}

function readString(value: unknown, names: string[]): string {
  const field = readField(value, names);
  return field == null ? '' : String(field).trim();
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || (text[0] !== '{' && text[0] !== '[')) return value;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return value;
  }
}

/** Official UnifiedSearch HTTP schema: top-level pageItems[]. Do not assume results/items. */
export function readIqsPageItems(json: unknown): unknown[] {
  const parsed = parseMaybeJson(json);
  if (Array.isArray(parsed)) return parsed;
  const root = asRecord(parsed);
  if (!root) return [];
  const direct = parseMaybeJson(readField(root, ['pageItems']));
  if (Array.isArray(direct)) return direct;
  const data = asRecord(parseMaybeJson(readField(root, ['data'])));
  const nestedData = parseMaybeJson(data ? readField(data, ['pageItems']) : undefined);
  if (Array.isArray(nestedData)) return nestedData;
  const result = asRecord(parseMaybeJson(readField(root, ['result'])));
  const nestedResult = parseMaybeJson(result ? readField(result, ['pageItems']) : undefined);
  if (Array.isArray(nestedResult)) return nestedResult;
  return [];
}

export function normalizeIqsPageItems(rows: unknown[], limit: number): WebDiscoveryHit[] {
  const topK = Math.min(IQS_FIRST_STAGE_MAX_RESULTS, Math.max(1, limit));
  const out: WebDiscoveryHit[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const rawUrl = readString(row, ['link', 'url']);
    const urlHit = rawUrl.startsWith('//') ? `https:${rawUrl}` : rawUrl;
    if (!/^https?:\/\//i.test(urlHit) || seen.has(urlHit)) continue;
    seen.add(urlHit);
    const title = (readString(row, ['title']) || urlHit).slice(0, 240);
    const snippet = readString(row, ['snippet', 'summary']).slice(0, 500);
    out.push({
      title,
      url: urlHit.slice(0, 500),
      ...(snippet ? { snippet } : {}),
    });
    if (out.length >= topK) break;
  }
  return out;
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

function normalizationError(upstreamCount: number, normalizedCount: number): WebDiscoveryError {
  return new WebDiscoveryError(
    'PROVIDER_ERROR',
    `NORMALIZATION_ERROR:upstreamCount=${upstreamCount};normalizedCount=${normalizedCount}`,
    502,
  );
}

export function createAliyunIqsWebDiscoveryProvider(
  options: AliyunIqsWebDiscoveryOptions,
): WebDiscoveryProvider {
  const apiKey = String(options.apiKey || '').trim();
  const url = unifiedSearchUrl(options.endpoint || '');
  const timeoutMs = options.timeoutMs ?? 8_000;
  const fetchImpl = options.fetchImpl || fetch;
  const log = options.log || (() => undefined);
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

      let rawText = '';
      try {
        rawText = await res.text();
      } catch {
        rawText = '';
      }
      const contentType = String((res.headers.get('content-type') || '').split(';')[0] || '')
        .trim()
        .slice(0, 60);
      const bodyChars = rawText.length;
      let json: unknown = {};
      let parsed = false;
      try {
        json = parseMaybeJson(rawText.replace(/^\uFEFF/, '')) ?? {};
        if (typeof json === 'string') json = parseMaybeJson(json);
        parsed = typeof json === 'object' && json !== null;
      } catch {
        json = {};
      }
      if (!parsed && rawText.trim()) {
        try {
          json = JSON.parse(rawText.replace(/^\uFEFF/, '').replace(/^[^{[]+/, '').trim());
          parsed = typeof json === 'object' && json !== null;
        } catch {
          parsed = false;
        }
      }
      const rec = asRecord(json);
      const jsonKeys = rec ? Object.keys(rec).slice(0, 12).join(',') : '';
      if (!res.ok) {
        throw classifyHttp(res.status, String(rec?.code || rec?.errorCode || rec?.message || rec?.Code || ''));
      }
      if (!parsed) {
        log('iqs_unified_search', {
          httpStatus: res.status,
          pageItemsCount: 0,
          normalizedCount: 0,
        });
        throw new WebDiscoveryError('PROVIDER_ERROR', `iqs_invalid_json:${contentType}:${bodyChars}`, 502);
      }
      const rows = readIqsPageItems(json);
      const out = normalizeIqsPageItems(rows, topK);
      log('iqs_unified_search', {
        httpStatus: res.status,
        pageItemsCount: rows.length,
        normalizedCount: out.length,
        ...(jsonKeys ? { jsonKeys: jsonKeys.slice(0, 120) } : {}),
        bodyChars,
      });
      if (rows.length > 0 && out.length === 0) {
        throw normalizationError(rows.length, 0);
      }
      return out;
    },
  };
}
