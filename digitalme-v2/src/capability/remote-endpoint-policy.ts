/**
 * 受控远端端点白名单策略 — 确定性执行。
 * 本轮不做公网目录或动态发现；端点变更视为新对手方。
 */
import { createHash } from 'node:crypto';

export type AllowedRemoteProtocol = 'https' | 'loopback-http';

export interface RemoteEndpointModelPolicy {
  allowRealModel: boolean;
  maxTokens?: number;
  /** 对手方模型策略说明(审计用,非产品文案)。 */
  note?: string;
}

export interface RemoteEndpointPolicy {
  endpointId: string;
  /** 产品显示名,如「研究分析」。 */
  displayName: string;
  baseUrl: string;
  expectedAgentCardUrl: string;
  allowedHost: string;
  allowedProtocol: AllowedRemoteProtocol;
  /** 允许的远端 skill / capability id。 */
  capabilityAllowlist: readonly string[];
  modelPolicy: RemoteEndpointModelPolicy;
  maxTaskDuration: number;
  maxInputBytes: number;
  maxOutputBytes: number;
  maxCallsPerTask: number;
  enabled: boolean;
  /**
   * 独立短期凭证在 SecretAccessor 中的 key。
   * 不得复用模型主密钥 key。
   */
  credentialSecretKey?: string;
  /** 期望 Agent Card name(可选强校验)。 */
  expectedAgentName?: string;
  /** 禁止再委托(默认 true)。 */
  forbidRedelegate?: boolean;
  /** 禁止重定向到非白名单主机(默认 true)。 */
  forbidOffAllowlistRedirect?: boolean;
}

export interface AgentCardView {
  name?: string;
  description?: string;
  version?: string;
  supportedInterfaces?: Array<{
    url?: string;
    protocolBinding?: string;
    protocolVersion?: string;
  }>;
  skills?: Array<{
    id?: string;
    name?: string;
    description?: string;
    tags?: string[];
  }>;
  capabilities?: Record<string, unknown>;
}

export interface EndpointValidationResult {
  ok: boolean;
  reasons: string[];
  matchedSkillIds: string[];
  selectedInterfaceUrl?: string;
  protocolVersion?: string;
  endpointFingerprint: string;
}

export function fingerprintEndpointPolicy(policy: RemoteEndpointPolicy): string {
  const material = [
    policy.endpointId,
    normalizeBaseUrl(policy.baseUrl),
    normalizeBaseUrl(policy.expectedAgentCardUrl),
    policy.allowedHost,
    policy.allowedProtocol,
    [...policy.capabilityAllowlist].sort().join(','),
  ].join('|');
  return createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 24);
}

export function normalizeBaseUrl(url: string): string {
  return String(url || '')
    .trim()
    .replace(/\/+$/, '');
}

export function assertEndpointPolicyShape(policy: RemoteEndpointPolicy): void {
  if (!policy.endpointId?.trim()) throw policyError('endpointId required');
  if (!policy.baseUrl?.trim()) throw policyError('baseUrl required');
  if (!policy.expectedAgentCardUrl?.trim()) throw policyError('expectedAgentCardUrl required');
  if (!policy.allowedHost?.trim()) throw policyError('allowedHost required');
  if (policy.allowedProtocol !== 'https' && policy.allowedProtocol !== 'loopback-http') {
    throw policyError('allowedProtocol must be https|loopback-http');
  }
  if (!Array.isArray(policy.capabilityAllowlist) || policy.capabilityAllowlist.length === 0) {
    throw policyError('capabilityAllowlist required');
  }
  if (!policy.enabled) throw policyError(`endpoint disabled: ${policy.endpointId}`);

  const base = parseUrlStrict(policy.baseUrl);
  const card = parseUrlStrict(policy.expectedAgentCardUrl);
  assertHostProtocol(base, policy);
  assertHostProtocol(card, policy);
  if (base.hostname !== policy.allowedHost && !hostMatches(base.hostname, policy.allowedHost)) {
    throw policyError(`baseUrl host not allowed: ${base.hostname}`);
  }
  if (card.hostname !== policy.allowedHost && !hostMatches(card.hostname, policy.allowedHost)) {
    throw policyError(`agent card host not allowed: ${card.hostname}`);
  }
}

export function validateAgentCardAgainstPolicy(
  policy: RemoteEndpointPolicy,
  card: AgentCardView,
): EndpointValidationResult {
  const reasons: string[] = [];
  assertEndpointPolicyShape(policy);

  if (policy.expectedAgentName && card.name && card.name !== policy.expectedAgentName) {
    reasons.push(`agent name mismatch: expected ${policy.expectedAgentName}, got ${card.name}`);
  }

  const interfaces = Array.isArray(card.supportedInterfaces) ? card.supportedInterfaces : [];
  const matchedIface = interfaces.find((iface) => {
    if (!iface?.url) return false;
    try {
      const u = parseUrlStrict(iface.url);
      assertHostProtocol(u, policy);
      return (
        (u.hostname === policy.allowedHost || hostMatches(u.hostname, policy.allowedHost)) &&
        String(iface.protocolVersion || '').startsWith('1.')
      );
    } catch {
      return false;
    }
  });
  if (!matchedIface) {
    reasons.push('no allowlisted A2A 1.x interface on agent card');
  }

  const skills = Array.isArray(card.skills) ? card.skills : [];
  const matchedSkillIds = skills
    .map((s) => String(s?.id || '').trim())
    .filter((id) => id && policy.capabilityAllowlist.includes(id));
  if (matchedSkillIds.length === 0) {
    reasons.push(
      `no allowlisted skill; need one of: ${policy.capabilityAllowlist.join(', ')}`,
    );
  }

  return {
    ok: reasons.length === 0,
    reasons,
    matchedSkillIds,
    ...(matchedIface?.url ? { selectedInterfaceUrl: normalizeBaseUrl(matchedIface.url) } : {}),
    ...(matchedIface?.protocolVersion
      ? { protocolVersion: String(matchedIface.protocolVersion) }
      : {}),
    endpointFingerprint: fingerprintEndpointPolicy(policy),
  };
}

/**
 * 受控 fetch:默认禁止越过白名单主机的重定向。
 */
export async function fetchAllowlisted(
  url: string,
  policy: RemoteEndpointPolicy,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  assertEndpointPolicyShape(policy);
  const target = parseUrlStrict(url);
  assertHostProtocol(target, policy);
  if (target.hostname !== policy.allowedHost && !hostMatches(target.hostname, policy.allowedHost)) {
    throw policyError(`fetch host not allowlisted: ${target.hostname}`);
  }

  const timeoutMs = init.timeoutMs ?? policy.maxTaskDuration;
  const { timeoutMs: _t, redirect: _r, ...rest } = init as RequestInit & { timeoutMs?: number };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (rest.signal) {
    const upstream = rest.signal;
    if (upstream.aborted) controller.abort();
    else upstream.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(url, {
      ...rest,
      redirect: 'manual',
      signal: controller.signal,
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location') || '';
      if (!location) throw policyError('redirect without location');
      if (policy.forbidOffAllowlistRedirect !== false) {
        const next = new URL(location, url);
        if (
          next.hostname !== policy.allowedHost &&
          !hostMatches(next.hostname, policy.allowedHost)
        ) {
          throw policyError(`redirect host not allowlisted: ${next.hostname}`);
        }
        assertHostProtocol(next, policy);
      }
      throw policyError(`redirect not followed by default policy (${res.status})`);
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

export function buildResearchEndpointPolicy(input: {
  baseUrl: string;
  endpointId?: string;
  displayName?: string;
  enabled?: boolean;
  maxTaskDuration?: number;
  maxInputBytes?: number;
  maxOutputBytes?: number;
  maxCallsPerTask?: number;
  credentialSecretKey?: string;
}): RemoteEndpointPolicy {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const parsed = parseUrlStrict(baseUrl);
  const loopback = isLoopbackHost(parsed.hostname);
  return {
    endpointId: input.endpointId ?? 'ep_research_a2a_local',
    displayName: input.displayName ?? '研究分析能力',
    baseUrl,
    expectedAgentCardUrl: `${baseUrl}/.well-known/agent-card.json`,
    allowedHost: parsed.hostname,
    allowedProtocol: loopback ? 'loopback-http' : 'https',
    capabilityAllowlist: ['project_risk_brief'],
    modelPolicy: { allowRealModel: true, maxTokens: 1400 },
    maxTaskDuration: input.maxTaskDuration ?? 120_000,
    maxInputBytes: input.maxInputBytes ?? 256_000,
    maxOutputBytes: input.maxOutputBytes ?? 512_000,
    maxCallsPerTask: input.maxCallsPerTask ?? 1,
    enabled: input.enabled ?? true,
    expectedAgentName: 'Research Analysis Agent',
    forbidRedelegate: true,
    forbidOffAllowlistRedirect: true,
    ...(input.credentialSecretKey
      ? { credentialSecretKey: input.credentialSecretKey }
      : { credentialSecretKey: 'remote.endpoint.research-a2a.token' }),
  };
}

function assertHostProtocol(u: URL, policy: RemoteEndpointPolicy): void {
  if (policy.allowedProtocol === 'loopback-http') {
    if (!isLoopbackHost(u.hostname)) {
      throw policyError(`loopback-http requires loopback host, got ${u.hostname}`);
    }
    if (u.protocol !== 'http:') {
      throw policyError(`loopback-http requires http, got ${u.protocol}`);
    }
    return;
  }
  if (u.protocol !== 'https:') {
    throw policyError(`non-loopback endpoint requires https, got ${u.protocol}`);
  }
}

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === '127.0.0.1' || h === 'localhost' || h === '::1';
}

function hostMatches(actual: string, allowed: string): boolean {
  return actual.toLowerCase() === allowed.toLowerCase();
}

function parseUrlStrict(raw: string): URL {
  try {
    return new URL(raw);
  } catch {
    throw policyError(`invalid url: ${raw}`);
  }
}

function policyError(message: string): Error {
  return Object.assign(new Error(message), {
    stage: 'capability' as const,
    actionable: '远端端点策略校验未通过',
    code: 'remote_endpoint_policy',
  });
}
