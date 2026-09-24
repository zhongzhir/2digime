import { createGeminiSearchConnector } from './adapters/gemini-search';
import { createManagedWebDiscoveryConnector } from './web-discovery-client';

export type SearchProviderStatus = 'AVAILABLE' | 'RATE_LIMITED' | 'UNCONFIGURED' | 'FAILED';
export interface SearchProviderEvidence { provider: string; status: SearchProviderStatus; attempted: boolean; count: number; httpStatus?: number; }
export interface SupplementalHit { title: string; url: string; snippet?: string; }
export interface SupplementalProvider { id: string; search?: (query: string) => Promise<SupplementalHit[]>; }

// Failures are isolated for this acquisition, not persisted as a second capability registry.
export function createSearchFallback(providers: SupplementalProvider[], report: (rows: SearchProviderEvidence[]) => void) {
  const rows: SearchProviderEvidence[] = providers.map(p => ({ provider: p.id, status: 'UNCONFIGURED', attempted: false, count: 0 }));
  return async (query: string): Promise<SupplementalHit[]> => {
    for (let i = 0; i < providers.length; i++) {
      const provider = providers[i]!;
      const row = rows[i]!;
      if (!provider.search || (row.attempted && row.status !== 'AVAILABLE')) continue;
      row.attempted = true;
      try {
        const hits = await provider.search(query);
        row.status = 'AVAILABLE'; row.count += hits.length;
        report(rows.map(r => ({ ...r })));
        if (hits.length) return hits;
      } catch (error) {
        const e = error as { status?: number; kind?: string };
        row.status = e.status === 429 || e.kind === 'quota' ? 'RATE_LIMITED' : 'FAILED';
        if (typeof e.status === 'number') row.httpStatus = e.status;
        report(rows.map(r => ({ ...r })));
      }
    }
    report(rows.map(r => ({ ...r })));
    return []; // Search supplements the candidate pool; it never owns Feed availability.
  };
}

export function createDashScopeSearch(apiKey: string, fetchImpl = fetch): (query: string) => Promise<SupplementalHit[]> {
  return async query => {
    const response = await fetchImpl('https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation', {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'qwen-plus', input: { messages: [{ role: 'user', content: query.slice(0, 1200) }] },
        parameters: { enable_search: true, enable_thinking: false, search_options: { enable_source: true, forced_search: true }, max_tokens: 256, result_format: 'message' } }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw Object.assign(new Error('Search provider failed'), { status: response.status });
    const json = await response.json() as { output?: { search_info?: { search_results?: Array<{ title?: string; url?: string }> } } };
    // Only provider grounding metadata, never URLs invented in assistant prose.
    return (json.output?.search_info?.search_results || []).slice(0, 12)
      .filter(r => r.url && /^https?:\/\//.test(r.url))
      .map(r => ({ title: String(r.title || r.url), url: r.url! }));
  };
}

export function discoverSupplementalSearch(input: { geminiKey?: string | null; geminiModel?: string | null; dashscopeKey?: string;
  gatewayUrl?: string | null; installToken?: string; managedFirst?: boolean; fetchImpl?: typeof fetch;
  report: (rows: SearchProviderEvidence[]) => void }) {
  const gemini = input.geminiKey ? createGeminiSearchConnector({ apiKey: input.geminiKey, ...(input.geminiModel ? { model: input.geminiModel } : {}), maxRetries: 0, timeoutMs: 12000 }) : undefined;
  const managed = input.gatewayUrl && input.installToken ? createManagedWebDiscoveryConnector({ gatewayUrl: input.gatewayUrl, installToken: input.installToken, ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}) }) : undefined;
  const providers: SupplementalProvider[] = [
    { id: 'gemini', ...(gemini ? { search: q => gemini.search(q) } : {}) },
    { id: 'dashscope', ...(input.dashscopeKey ? { search: createDashScopeSearch(input.dashscopeKey) } : {}) },
    { id: 'managed', ...(managed ? { search: q => managed.search(q) } : {}) },
  ];
  if (input.managedFirst) providers.unshift(providers.pop()!);
  return createSearchFallback(providers, input.report);
}
