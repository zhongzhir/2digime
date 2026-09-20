/**
 * Relay 上极薄的 Web Discovery Gateway。
 * 只做 query forwarding / 规范化 / 公共缓存 / 配额。不做推荐、不做画像。
 */
import { GeminiSearchConnectorError } from '../capability/adapters/gemini-search';
import {
  hashWebDiscoveryQuery,
  parseWebDiscoveryRequest,
  WebDiscoveryError,
  WEB_DISCOVERY_MAX_RESULTS,
  type WebDiscoveryHit,
  type WebDiscoveryProvider,
  type WebDiscoveryStatus,
} from '../capability/web-discovery';

export const WEB_DISCOVERY_CACHE_VERSION = 'iqs-pageitems-1';

export interface WebDiscoveryGatewayOptions {
  provider?: WebDiscoveryProvider | null;
  now?: () => number;
  cacheTtlMs?: number;
  perInstallPerHour?: number;
  globalPerHour?: number;
  log?: (event: string, fields: Record<string, string | number | boolean | undefined>) => void;
}

interface CacheRow {
  at: number;
  results: WebDiscoveryHit[];
  provider: string;
}

interface WindowCount {
  hour: number;
  count: number;
}

export interface WebDiscoveryGatewayResult {
  statusCode: number;
  body: {
    ok: boolean;
    status: WebDiscoveryStatus;
    provider?: string;
    provenance?: 'provider' | 'cache';
    cacheState?: 'hit' | 'miss' | 'none';
    results?: WebDiscoveryHit[];
    error?: string;
  };
}

function hourBucket(nowMs: number): number {
  return Math.floor(nowMs / 3_600_000);
}

function classifyProviderError(err: unknown): WebDiscoveryError {
  if (err instanceof WebDiscoveryError) return err;
  const rec = err as { kind?: string; status?: number; message?: string };
  const status = Number(rec.status || 0);
  const kind = String(rec.kind || '').toLowerCase();
  const message = String(rec.message || err || '').slice(0, 80);
  if (err instanceof GeminiSearchConnectorError) {
    if (err.kind === 'auth') return new WebDiscoveryError('AUTH_FAILED', message, 401);
    if (err.kind === 'quota') return new WebDiscoveryError('RATE_LIMITED', message, 429);
    if (err.kind === 'timeout') return new WebDiscoveryError('TEMPORARY_UNAVAILABLE', message, 503);
    return new WebDiscoveryError('PROVIDER_ERROR', message, 502);
  }
  if (kind === 'auth' || status === 401 || status === 403) {
    return new WebDiscoveryError('AUTH_FAILED', message, 401);
  }
  if (kind === 'quota' || status === 429) {
    return new WebDiscoveryError('RATE_LIMITED', message, 429);
  }
  return new WebDiscoveryError('PROVIDER_ERROR', message || 'provider_error', 502);
}

export function createWebDiscoveryGateway(options: WebDiscoveryGatewayOptions = {}): {
  search: (input: { body: unknown; installToken?: string; authorizationHeader?: string }) => Promise<WebDiscoveryGatewayResult>;
} {
  const cache = new Map<string, CacheRow>();
  const perInstall = new Map<string, WindowCount>();
  let global: WindowCount = { hour: 0, count: 0 };
  const cacheTtlMs = options.cacheTtlMs ?? 15 * 60 * 1000;
  const perInstallPerHour = options.perInstallPerHour ?? 30;
  const globalPerHour = options.globalPerHour ?? 400;
  const now = options.now || (() => Date.now());
  const log = options.log || (() => undefined);

  function bump(mapHour: WindowCount, hour: number): WindowCount {
    if (mapHour.hour !== hour) return { hour, count: 1 };
    return { hour, count: mapHour.count + 1 };
  }

  return {
    async search(input) {
      const started = now();
      if (input.authorizationHeader) {
        log('web_discovery_auth_header_ignored', { present: true });
      }
      const token = String(input.installToken || '').trim();
      if (token.length < 16) {
        log('web_discovery_reject', { reason: 'missing_install_token' });
        return {
          statusCode: 400,
          body: { ok: false, status: 'PROVIDER_ERROR', error: 'missing_install_token' },
        };
      }

      let parsed;
      try {
        parsed = parseWebDiscoveryRequest(input.body);
      } catch (err) {
        const typed = err instanceof WebDiscoveryError ? err : classifyProviderError(err);
        log('web_discovery_reject', { reason: typed.message.slice(0, 40) });
        return {
          statusCode: typed.httpStatus,
          body: { ok: false, status: typed.status, error: typed.message.slice(0, 80) },
        };
      }

      if (!options.provider) {
        log('web_discovery_unavailable', { reason: 'MANAGED_PROVIDER_SECRET_REQUIRED' });
        return {
          statusCode: 503,
          body: {
            ok: false,
            status: 'TEMPORARY_UNAVAILABLE',
            error: 'MANAGED_PROVIDER_SECRET_REQUIRED',
          },
        };
      }

      const hour = hourBucket(now());
      global = bump(global, hour);
      const prev = perInstall.get(token) || { hour, count: 0 };
      const nextInstall = bump(prev, hour);
      perInstall.set(token, nextInstall);
      if (nextInstall.count > perInstallPerHour || global.count > globalPerHour) {
        log('web_discovery_limit', {
          provider: options.provider.id,
          latencyMs: now() - started,
          cacheHit: false,
          quota: true,
        });
        return {
          statusCode: 429,
          body: { ok: false, status: 'RATE_LIMITED', error: 'rate_limited' },
        };
      }

      const extra = `${WEB_DISCOVERY_CACHE_VERSION}|${(parsed.contentTypes || []).join(',')}|${parsed.freshness || ''}|${parsed.limit || 8}`;
      const queryHash = hashWebDiscoveryQuery(parsed.query, extra);
      const cached = cache.get(queryHash);
      if (cached && now() - cached.at <= cacheTtlMs) {
        log('web_discovery_ok', {
          provider: cached.provider,
          latencyMs: now() - started,
          cacheHit: true,
          resultCount: cached.results.length,
        });
        return {
          statusCode: 200,
          body: {
            ok: true,
            status: 'AVAILABLE',
            provider: 'web-discovery',
            provenance: 'cache',
            cacheState: 'hit',
            results: cached.results,
          },
        };
      }

      try {
        const raw = await options.provider.search(parsed);
        const results = raw.slice(0, parsed.limit || WEB_DISCOVERY_MAX_RESULTS).map((row) => ({
          title: String(row.title || row.url).slice(0, 240),
          url: String(row.url || '').slice(0, 500),
          ...(row.snippet ? { snippet: String(row.snippet).slice(0, 500) } : {}),
        }));
        cache.set(queryHash, { at: now(), results, provider: options.provider.id });
        log('web_discovery_ok', {
          provider: options.provider.id,
          latencyMs: now() - started,
          cacheHit: false,
          resultCount: results.length,
        });
        return {
          statusCode: 200,
          body: {
            ok: true,
            status: 'AVAILABLE',
            provider: 'web-discovery',
            provenance: 'provider',
            cacheState: 'miss',
            results,
          },
        };
      } catch (err) {
        const typed = classifyProviderError(err);
        log('web_discovery_provider', {
          provider: options.provider.id,
          latencyMs: now() - started,
          cacheHit: false,
          httpStatus: typed.httpStatus,
        });
        return {
          statusCode: typed.httpStatus,
          body: { ok: false, status: typed.status, error: typed.message.slice(0, 80) },
        };
      }
    },
  };
}
