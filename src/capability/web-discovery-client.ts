import type { SearchConnector } from './search-connector';
import {
  hitsToSearchSources,
  parseWebDiscoveryRequest,
  WebDiscoveryError,
  type WebDiscoveryStatus,
} from './web-discovery';

export interface ManagedWebDiscoveryClientOptions {
  gatewayUrl: string;
  installToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const WEB_STATUSES = ['AVAILABLE', 'RATE_LIMITED', 'AUTH_FAILED', 'PROVIDER_ERROR', 'TEMPORARY_UNAVAILABLE'] as const;

function classifyHttp(status: number, bodyStatus?: string): WebDiscoveryStatus {
  const labeled = String(bodyStatus || '').toUpperCase();
  if ((WEB_STATUSES as readonly string[]).includes(labeled)) return labeled as WebDiscoveryStatus;
  if (status === 429) return 'RATE_LIMITED';
  if (status === 401 || status === 403) return 'AUTH_FAILED';
  if (status === 503) return 'TEMPORARY_UNAVAILABLE';
  return 'PROVIDER_ERROR';
}

function httpStatusOf(status: WebDiscoveryStatus): number {
  if (status === 'RATE_LIMITED') return 429;
  if (status === 'AUTH_FAILED') return 401;
  if (status === 'TEMPORARY_UNAVAILABLE') return 503;
  return 502;
}

export function createManagedWebDiscoveryConnector(
  options: ManagedWebDiscoveryClientOptions,
): SearchConnector {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const base = options.gatewayUrl.replace(/\/+$/, '');

  return {
    id: 'web-discovery',
    async search(query) {
      const parsed = parseWebDiscoveryRequest({ query, limit: 8 });
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetchImpl(`${base}/v1/web-discovery/search`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-install-capability-token': options.installToken,
          },
          body: JSON.stringify({ query: parsed.query, limit: parsed.limit }),
          signal: ac.signal,
        });
      } catch (err) {
        const aborted = ac.signal.aborted || (err as { name?: string }).name === 'AbortError';
        throw new WebDiscoveryError(
          'TEMPORARY_UNAVAILABLE',
          aborted ? 'web_discovery_timeout' : 'web_discovery_unreachable',
          503,
        );
      } finally {
        clearTimeout(timer);
      }

      let json: {
        ok?: boolean;
        status?: string;
        error?: string;
        results?: Array<{ title?: string; url?: string; snippet?: string }>;
      } = {};
      try {
        json = (await res.json()) as typeof json;
      } catch {
        json = {};
      }
      const status = classifyHttp(res.status, json.status);
      if (status !== 'AVAILABLE') {
        throw new WebDiscoveryError(status, String(json.error || status).slice(0, 80), httpStatusOf(status));
      }
      const results = Array.isArray(json.results) ? json.results : [];
      return hitsToSearchSources(
        results.map((row) => ({
          title: String(row.title || row.url || ''),
          url: String(row.url || ''),
          ...(row.snippet ? { snippet: String(row.snippet) } : {}),
        })),
      );
    },
  };
}
