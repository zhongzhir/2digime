import type { SearchConnector } from './search-connector';
import type { ModelCallDiagnostic } from '../infrastructure/model-http';
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
  onDiagnostic?: (row: ModelCallDiagnostic) => void;
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
    async search(query, opts) {
      const parsed = parseWebDiscoveryRequest({ query, limit: 8 });
      const ac = new AbortController();
      const onAbort = () => ac.abort();
      if (opts?.signal) {
        if (opts.signal.aborted) {
          throw new WebDiscoveryError('TEMPORARY_UNAVAILABLE', 'web_discovery_aborted', 503);
        }
        opts.signal.addEventListener('abort', onAbort, { once: true });
      }
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
        clearTimeout(timer); opts?.signal?.removeEventListener('abort', onAbort);
        const aborted = ac.signal.aborted || (err as { name?: string }).name === 'AbortError';
        throw Object.assign(new WebDiscoveryError(
          'TEMPORARY_UNAVAILABLE',
          aborted ? (opts?.signal?.aborted ? 'web_discovery_aborted' : 'web_discovery_timeout') : 'web_discovery_unreachable',
          503,
        ), { diagnostic: { stage: 'discover.search', httpStatus: null, finishReason: null, outputLength: null, parseError: null,
          cancellation: aborted ? (opts?.signal?.reason === 'user' ? 'user' : opts?.signal?.reason === 'superseded' ? 'superseded' : 'deadline') : null, failure: aborted ? 'cancelled' : 'network' } });
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
        throw Object.assign(new WebDiscoveryError('PROVIDER_ERROR', ac.signal.aborted ? 'web_discovery_aborted' : 'web_discovery_format', res.status), {
          diagnostic: { stage: 'discover.search', httpStatus: res.status, finishReason: null, outputLength: null, parseError: ac.signal.aborted ? null : 'json', cancellation: opts?.signal?.aborted ? (opts.signal.reason === 'user' ? 'user' : opts.signal.reason === 'superseded' ? 'superseded' : 'deadline') : ac.signal.aborted ? 'deadline' : null, failure: ac.signal.aborted ? 'cancelled' : 'format' },
        });
      } finally {
        clearTimeout(timer);
        opts?.signal?.removeEventListener('abort', onAbort);
      }

      if (ac.signal.aborted) {
        throw Object.assign(new WebDiscoveryError('TEMPORARY_UNAVAILABLE', 'web_discovery_aborted', res.status), {
          diagnostic: { stage: 'discover.search', httpStatus: res.status, finishReason: null, outputLength: null, parseError: null,
            cancellation: opts?.signal?.aborted ? (opts.signal.reason === 'user' ? 'user' : opts.signal.reason === 'superseded' ? 'superseded' : opts.signal.reason === 'deadline' ? 'deadline' : 'caller') : 'deadline', failure: 'cancelled' },
        });
      }
      if (!json || typeof json !== 'object' || Array.isArray(json) || !Array.isArray(json.results) && json.ok !== false) {
        throw Object.assign(new WebDiscoveryError('PROVIDER_ERROR', 'web_discovery_format', res.status), { diagnostic: { stage: 'discover.search', httpStatus: res.status, finishReason: null, outputLength: null, parseError: 'envelope', cancellation: null, failure: 'format' } });
      }
      const status = classifyHttp(res.status, json.status);
      if (status !== 'AVAILABLE' || json.ok === false || !res.ok) {
        throw Object.assign(new WebDiscoveryError(status, status, res.status), { diagnostic: { stage: 'discover.search', httpStatus: res.status, finishReason: null, outputLength: null, parseError: null, cancellation: null, failure: 'http' } });
      }
      const results = Array.isArray(json.results) ? json.results : [];
      options.onDiagnostic?.({ stage: 'discover.search', httpStatus: res.status, finishReason: null, outputLength: results.length, parseError: null, cancellation: null, failure: null });
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
