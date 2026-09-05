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

export const BASELINE_SEARCH_CAPABILITY_ID = 'cap_baseline_web_search';
export const PROFESSIONAL_SEARCH_CAPABILITY_ID = 'cap_gemini_web_search';
/** SecretStore providerId；与模型凭证共用 FileSecretStore，不是第二套存储。 */
export const GEMINI_SEARCH_PROVIDER_ID = 'gemini-search';

export interface DiscoverSearchOptions {
  includeBaseline?: boolean;
  apiKey?: string | null;
  model?: string | null;
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

function professionalRegistration(): CapabilityRegistration {
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
    adapter: { type: 'local-tool', adapterId: 'gemini-search' },
  };
}

function wantBaseline(env: NodeJS.ProcessEnv, opts?: DiscoverSearchOptions): boolean {
  return opts?.includeBaseline === true || env.DIGITALME_V2_BASELINE_SEARCH === '1';
}

/** 返回可注册的 search adapters。默认不注册 Bing baseline；Gemini 仅当凭据存在。 */
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
  if (gem.apiKey) {
    const model = gem.model || 'gemini-3.6-flash';
    const professional = createSearchCapabilityAdapter({
      connector: createGeminiSearchConnector({ apiKey: gem.apiKey, model }),
      registration: professionalRegistration(),
    });
    out.push(professional);
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
    return resolveGeminiSearchCredential(env, opts).apiKey ? 'available' : 'needs_simple_setup';
  }
  return 'unavailable';
}
