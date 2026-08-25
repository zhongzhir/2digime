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

/** 探测环境是否已合法存在 Gemini 凭据（环境变量；不读 token/浏览器 cookie）。 */
export function resolveGeminiSearchCredential(env: NodeJS.ProcessEnv = process.env): {
  apiKey: string | null;
  model: string | null;
} {
  const apiKey = String(env.GEMINI_API_KEY || '').trim() || null;
  const model = String(env.GEMINI_SEARCH_MODEL || env.GEMINI_MODEL || '').trim() || null;
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
    availability: 'available',
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

/** 返回可注册的 search adapters（baseline 始终；professional 当凭据可探测）。 */
export function discoverSearchCapabilities(
  env: NodeJS.ProcessEnv = process.env,
): CapabilityAdapter[] {
  const out: CapabilityAdapter[] = [];

  const baseline = createSearchCapabilityAdapter({
    connector: createBingHtmlSearchConnector(),
    registration: baselineRegistration(),
  });
  out.push(baseline);

  const gem = resolveGeminiSearchCredential(env);
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
): Promise<'available' | 'needs_simple_setup' | 'unavailable'> {
  if (registration.id === BASELINE_SEARCH_CAPABILITY_ID) return 'available';
  if (registration.id === PROFESSIONAL_SEARCH_CAPABILITY_ID) {
    return resolveGeminiSearchCredential(env).apiKey ? 'available' : 'needs_simple_setup';
  }
  return 'unavailable';
}