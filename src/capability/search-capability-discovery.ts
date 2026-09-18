/**
 * Search/Research capability discovery — 复用现有 SearchConnector，不做第二套 inventory。
 * 判断仅：
 *   available            — 连接器可直接使用
 *   needs_simple_setup    — 有凭据来源但未配置（本环境无）
 *   unavailable           — 无凭据/连接器不可用
 * 品牌与 API 逻辑只在此层；上层只消费 availability + displayName。
 */
import type { CapabilityRegistration } from './registration';
import type { CapabilityAdapter } from './adapter';
import { createBingHtmlSearchConnector } from './adapters/bing-html-search';
import { createGeminiSearchConnector } from './adapters/gemini-search';
import { createSearchCapabilityAdapter } from './adapters/search-adapter';
import { createManagedWebDiscoveryConnector } from './web-discovery-client';
import type { WebDiscoveryPath } from './web-discovery-preference';

export const BASELINE_SEARCH_CAPABILITY_ID = 'cap_baseline_web_search';
export const PROFESSIONAL_SEARCH_CAPABILITY_ID = 'cap_gemini_web_search';
export const WEB_DISCOVERY_CAPABILITY_ID = PROFESSIONAL_SEARCH_CAPABILITY_ID;
/** SecretStore providerId；与模型凭证共用 FileSecretStore，不是第二套存储。 */
export const GEMINI_SEARCH_PROVIDER_ID = 'gemini-search';

export interface DiscoverSearchOptions {
  includeBaseline?: boolean;
  apiKey?: string | null;
  model?: string | null;
  webDiscoveryPath?: WebDiscoveryPath;
  webDiscoveryGatewayUrl?: string | null;
  webDiscoveryInstallToken?: string | null;
  webDiscoveryFetch?: typeof fetch;
}

/** 探测 Gemini 凭据：显式 apiKey（SecretStore）优先，环境变量仅开发 fallback。 */
export function resolveGeminiSearchCredential(
  env: NodeJS.ProcessEnv = process.env,
  explicit?: { apiKey?: string | null; model?: string | null },
): {
  apiKey: string | null;
  model: string | null;
} {
  const apiKey =
    String(explicit?.apiKey || '').trim() || String(env.GEMINI_API_KEY || '').trim() || null;
  const model =
    String(explicit?.model || '').trim() ||
    String(env.GEMINI_SEARCH_MODEL || env.GEMINI_MODEL || '').trim() ||
    null;
  return { apiKey, model };
}

export function resolveWebDiscoveryGatewayUrl(
  env: NodeJS.ProcessEnv = process.env,
  explicit?: { gatewayUrl?: string | null | undefined },
): string | null {
  return String(explicit?.gatewayUrl || env.DIGITALME_WEB_DISCOVERY_URL || '').trim() || null;
}

/**
 * 产品默认 managed。测试只注入 Gemini key、未声明 path / gateway 时保持 BYOK，以免破坏既有凭据探测。
 */
export function resolveWebDiscoveryPath(input: {
  path?: WebDiscoveryPath | undefined;
  gatewayUrl?: string | null | undefined;
  byokKey?: string | null | undefined;
}): WebDiscoveryPath {
  if (input.path === 'managed' || input.path === 'byok') return input.path;
  if (input.gatewayUrl) return 'managed';
  if (input.byokKey) return 'byok';
  return 'managed';
}

function baselineRegistration(): CapabilityRegistration {
  return {
    id: BASELINE_SEARCH_CAPABILITY_ID,
    kind: 'tool',
    displayName: '基础搜索',
    description: '检索公开网页来源（无需账号）。覆盖可能有限。',
    inputContract: { acceptsGoal: true, acceptsSnapshot: true, acceptsSubjectContext: true },
    outputArtifactTypes: ['document'],
    permissions: ['network'],
    cost: { estimate: 'free' },
    latencyEstimate: 'seconds',
    location: 'remote',
    availability: 'unavailable',
    adapter: { type: 'local-tool', adapterId: 'baseline-bing-search' },
  };
}

function professionalRegistration(adapterId: string): CapabilityRegistration {
  return {
    id: PROFESSIONAL_SEARCH_CAPABILITY_ID,
    kind: 'tool',
    displayName: '联网搜索',
    description: '使用已发现的联网搜索能力检索并整理来源。',
    inputContract: { acceptsGoal: true, acceptsSnapshot: true, acceptsSubjectContext: true },
    outputArtifactTypes: ['document'],
    permissions: ['network'],
    cost: { estimate: 'free' },
    latencyEstimate: 'seconds',
    location: 'remote',
    availability: 'available',
    adapter: { type: 'local-tool', adapterId },
  };
}

function wantBaseline(env: NodeJS.ProcessEnv, opts?: DiscoverSearchOptions): boolean {
  return opts?.includeBaseline === true || env.DIGITALME_V2_BASELINE_SEARCH === '1';
}

/** 返回可注册的 search adapters。默认不注册 Bing baseline。托管网关或 BYOK 任一可用即注册 WEB_DISCOVERY。 */
export function discoverSearchCapabilities(
  env: NodeJS.ProcessEnv = process.env,
  opts?: DiscoverSearchOptions,
): CapabilityAdapter[] {
  const out: CapabilityAdapter[] = [];

  if (wantBaseline(env, opts)) {
    const baseline = createSearchCapabilityAdapter({
      connector: createBingHtmlSearchConnector(),
      registration: { ...baselineRegistration(), availability: 'available' },
    });
    out.push(baseline);
  }

  const gem = resolveGeminiSearchCredential(env, opts);
  const gatewayUrl = resolveWebDiscoveryGatewayUrl(env, { gatewayUrl: opts?.webDiscoveryGatewayUrl });
  const path = resolveWebDiscoveryPath({
    path: opts?.webDiscoveryPath,
    gatewayUrl,
    byokKey: gem.apiKey,
  });

  if (path === 'byok' && gem.apiKey) {
    const model = gem.model || 'gemini-3.6-flash';
    out.push(
      createSearchCapabilityAdapter({
        connector: createGeminiSearchConnector({ apiKey: gem.apiKey, model }),
        registration: professionalRegistration('gemini-search'),
      }),
    );
    return out;
  }

  if (path === 'managed' && gatewayUrl) {
    out.push(
      createSearchCapabilityAdapter({
        connector: createManagedWebDiscoveryConnector({
          gatewayUrl,
          installToken: String(opts?.webDiscoveryInstallToken || 'test-install-capability-token-0001'),
          ...(opts?.webDiscoveryFetch ? { fetchImpl: opts.webDiscoveryFetch } : {}),
        }),
        registration: professionalRegistration('web-discovery'),
      }),
    );
  }
  return out;
}

/** 探测某 search capability 是否可用（available / needs_simple_setup / unavailable）。 */
export async function probeSearchAvailability(
  registration: CapabilityRegistration,
  env: NodeJS.ProcessEnv = process.env,
  opts?: DiscoverSearchOptions,
): Promise<'available' | 'needs_simple_setup' | 'unavailable'> {
  if (registration.id === BASELINE_SEARCH_CAPABILITY_ID) {
    return wantBaseline(env, opts) ? 'available' : 'unavailable';
  }
  if (registration.id === PROFESSIONAL_SEARCH_CAPABILITY_ID) {
    const gem = resolveGeminiSearchCredential(env, opts);
    const gatewayUrl = resolveWebDiscoveryGatewayUrl(env, { gatewayUrl: opts?.webDiscoveryGatewayUrl });
    const path = resolveWebDiscoveryPath({
      path: opts?.webDiscoveryPath,
      gatewayUrl,
      byokKey: gem.apiKey,
    });
    if (path === 'byok') return gem.apiKey ? 'available' : 'needs_simple_setup';
    if (gatewayUrl) return 'available';
    return gem.apiKey ? 'available' : 'needs_simple_setup';
  }
  return 'unavailable';
}
