/**
 * WEB_DISCOVERY — 产品能力，不是 GEMINI_SEARCH。
 * 上层只看见 query → 公共结果；provider 细节停在 gateway / BYOK adapter。
 */
import { createHash } from 'node:crypto';
import { forbiddenPersonalizationKeys, normalizeQueryKey } from '../subject-comm/network-item';
import type { SearchConnector } from './search-connector';
import type { SearchSource } from './search-contract';

export const WEB_DISCOVERY_STATUSES = [
  'AVAILABLE',
  'RATE_LIMITED',
  'AUTH_FAILED',
  'PROVIDER_ERROR',
  'TEMPORARY_UNAVAILABLE',
] as const;

export type WebDiscoveryStatus = (typeof WEB_DISCOVERY_STATUSES)[number];

export const WEB_DISCOVERY_MAX_QUERY_CHARS = 200;
export const WEB_DISCOVERY_MAX_RESULTS = 12;

export const WEB_DISCOVERY_ALLOWED_BODY_KEYS = [
  'query',
  'contenttypes',
  'freshness',
  'limit',
  'institutiontoken',
] as const;

const EXTRA_FORBIDDEN = new Set([
  'facts',
  'factlist',
  'recent',
  'history',
  'selfjson',
  'preferencevector',
  'recommendationstate',
  'browsinghistory',
  'digitalself',
  'userid',
  'subjectid',
]);

export interface WebDiscoveryHit {
  title: string;
  url: string;
  snippet?: string;
}

export interface WebDiscoverySearchInput {
  query: string;
  contentTypes?: string[];
  freshness?: string;
  limit?: number;
}

export interface WebDiscoveryProvider {
  readonly id: string;
  search(input: WebDiscoverySearchInput): Promise<WebDiscoveryHit[]>;
}

export class WebDiscoveryError extends Error {
  readonly status: WebDiscoveryStatus;
  readonly httpStatus: number;
  readonly kind: string;
  constructor(status: WebDiscoveryStatus, message: string, httpStatus = 502) {
    super(message);
    this.name = 'WebDiscoveryError';
    this.status = status;
    this.httpStatus = httpStatus;
    this.kind =
      status === 'AUTH_FAILED' ? 'auth' : status === 'RATE_LIMITED' ? 'quota' : 'network';
  }
}

export function hashWebDiscoveryQuery(query: string, extra = ''): string {
  return createHash('sha256').update(`${query}\n${extra}`).digest('hex');
}

export function sanitizeDiscoveryQuery(raw: unknown): string {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, WEB_DISCOVERY_MAX_QUERY_CHARS);
}

export function forbiddenWebDiscoveryKeys(raw: Record<string, unknown>): string[] {
  const personal = forbiddenPersonalizationKeys(raw);
  const extra = Object.keys(raw).filter((key) => EXTRA_FORBIDDEN.has(normalizeQueryKey(key)));
  return [...new Set([...personal, ...extra])];
}

export function disallowedWebDiscoveryBodyKeys(raw: Record<string, unknown>): string[] {
  const allowed = new Set<string>(WEB_DISCOVERY_ALLOWED_BODY_KEYS);
  return Object.keys(raw).filter((key) => !allowed.has(normalizeQueryKey(key)));
}

export function parseWebDiscoveryRequest(raw: unknown): WebDiscoverySearchInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new WebDiscoveryError('PROVIDER_ERROR', 'invalid_body', 400);
  }
  const rec = raw as Record<string, unknown>;
  const forbidden = forbiddenWebDiscoveryKeys(rec);
  if (forbidden.length) {
    throw new WebDiscoveryError('PROVIDER_ERROR', `payload_rejected:${forbidden[0]}`, 400);
  }
  const unknown = disallowedWebDiscoveryBodyKeys(rec);
  if (unknown.length) {
    throw new WebDiscoveryError('PROVIDER_ERROR', `payload_rejected:${unknown[0]}`, 400);
  }
  const query = sanitizeDiscoveryQuery(rec.query);
  if (query.length < 2) {
    throw new WebDiscoveryError('PROVIDER_ERROR', 'query_too_short', 400);
  }
  const limitRaw = Number(rec.limit);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(WEB_DISCOVERY_MAX_RESULTS, Math.max(1, Math.floor(limitRaw)))
    : 8;
  const contentTypes = Array.isArray(rec.contentTypes)
    ? rec.contentTypes.map((row) => String(row || '').trim()).filter(Boolean).slice(0, 6)
    : undefined;
  const freshness = rec.freshness == null ? undefined : String(rec.freshness).trim().slice(0, 32);
  return {
    query,
    ...(contentTypes && contentTypes.length ? { contentTypes } : {}),
    ...(freshness ? { freshness } : {}),
    limit,
  };
}

export function hitsToSearchSources(hits: WebDiscoveryHit[]): SearchSource[] {
  const seen = new Set<string>();
  const out: SearchSource[] = [];
  for (const hit of hits) {
    const url = String(hit.url || '').trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      title: String(hit.title || url).slice(0, 240),
      url,
      sourceClass: 'external',
      ...(hit.snippet ? { snippet: String(hit.snippet).slice(0, 500) } : {}),
    });
  }
  return out;
}

/** 把已有 SearchConnector 收成可替换的 WebDiscoveryProvider。id 保持 web-discovery，不把 gemini 写进 App contract。 */
export function webDiscoveryProviderFromConnector(
  connector: SearchConnector,
  providerImpl = 'managed',
): WebDiscoveryProvider {
  return {
    id: providerImpl,
    async search(input) {
      const sources = await connector.search(input.query);
      return sources
        .filter((row) => String(row.url || '').trim())
        .slice(0, input.limit || WEB_DISCOVERY_MAX_RESULTS)
        .map((row) => ({
          title: String(row.title || row.url),
          url: String(row.url),
          ...(row.snippet ? { snippet: String(row.snippet).slice(0, 500) } : {}),
        }));
    },
  };
}
