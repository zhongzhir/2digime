/**
 * 统一 A2A 连接探测合同。
 * verify / RemoteEndpointPolicy 校验 / checkAvailability / saveRemoteCapability 必须共用本 helper，
 * 禁止各自拼接探测请求。
 */
import { randomUUID } from 'node:crypto';
import { A2A_PROTOCOL_VERSION } from '@a2a-js/sdk';
import {
  assertEndpointPolicyShape,
  buildResearchEndpointPolicy,
  fetchAllowlisted,
  validateAgentCardAgainstPolicy,
  type AgentCardView,
  type EndpointValidationResult,
  type RemoteEndpointPolicy,
} from './remote-endpoint-policy';

/** SDK 正式版本头；缺省时服务端会回落 0.3 并可能 500。 */
export const A2A_VERSION_HEADER = 'A2A-Version';

/** 无副作用探测：查询不存在的 Task。协议成功时可得到 Task not found。 */
export const A2A_PROTOCOL_PROBE_METHOD = 'GetTask';

/** 方法/协议不匹配类错误码 — 不得视为可连接。 */
const PROTOCOL_MISMATCH_CODES = new Set([-32600, -32601, -32602, -32009]);

export type ConnectionProbeStage =
  | 'policy'
  | 'card'
  | 'protocol_probe'
  | 'skill'
  | 'registration'
  | 'ok';

export interface ConnectionProbeDiagnostic {
  stage: ConnectionProbeStage;
  normalizedBaseUrl: string;
  agentCardUrl: string;
  interfaceUrl: string | null;
  jsonRpcMethod: string;
  httpStatus: number | null;
  jsonRpcErrorCode: number | null;
  jsonRpcErrorMessage: string | null;
  reasons: string[];
}

export interface ConnectionProbeResult {
  ok: boolean;
  agent_card_valid: boolean;
  a2a_protocol_probe_valid: boolean;
  required_skill_available: boolean;
  connection_contract_match: boolean;
  policy: RemoteEndpointPolicy | null;
  validation: EndpointValidationResult | null;
  card: AgentCardView | null;
  diagnostic: ConnectionProbeDiagnostic;
}

function emptyDiagnostic(baseUrl = ''): ConnectionProbeDiagnostic {
  return {
    stage: 'policy',
    normalizedBaseUrl: baseUrl,
    agentCardUrl: '',
    interfaceUrl: null,
    jsonRpcMethod: A2A_PROTOCOL_PROBE_METHOD,
    httpStatus: null,
    jsonRpcErrorCode: null,
    jsonRpcErrorMessage: null,
    reasons: [],
  };
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = String(raw || '')
    .trim()
    .replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const u = new URL(trimmed);
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '::1') u.hostname = '127.0.0.1';
    const pathPart = u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host}${pathPart}`;
  } catch {
    return trimmed;
  }
}

function isProtocolValidJsonRpcBody(body: unknown): {
  valid: boolean;
  errorCode: number | null;
  errorMessage: string | null;
  reason?: string;
} {
  if (!body || typeof body !== 'object') {
    return { valid: false, errorCode: null, errorMessage: null, reason: 'response is not json object' };
  }
  const obj = body as Record<string, unknown>;
  if (obj.jsonrpc !== '2.0') {
    return { valid: false, errorCode: null, errorMessage: null, reason: 'jsonrpc version missing or not 2.0' };
  }
  if ('result' in obj) {
    return { valid: true, errorCode: null, errorMessage: null };
  }
  const err = obj.error;
  if (!err || typeof err !== 'object') {
    return { valid: false, errorCode: null, errorMessage: null, reason: 'neither result nor error' };
  }
  const code = Number((err as { code?: unknown }).code);
  const message = String((err as { message?: unknown }).message || '');
  if (!Number.isFinite(code)) {
    return { valid: false, errorCode: null, errorMessage: message, reason: 'jsonrpc error missing code' };
  }
  if (PROTOCOL_MISMATCH_CODES.has(code)) {
    return {
      valid: false,
      errorCode: code,
      errorMessage: message,
      reason: `protocol/method mismatch code=${code}`,
    };
  }
  // 领域级错误（如 Task not found）视为协议探测成功
  return { valid: true, errorCode: code, errorMessage: message };
}

/**
 * 正式连接探测：Card + Skill + 无副作用 GetTask（A2A 1.0）。
 */
export async function probeA2AConnection(input: {
  baseUrl: string;
  policy?: RemoteEndpointPolicy;
  requiredSkillId?: string;
  timeoutMs?: number;
}): Promise<ConnectionProbeResult> {
  const requiredSkillId = input.requiredSkillId || 'project_risk_brief';
  const normalizedBaseUrl = normalizeBaseUrl(input.baseUrl);
  const diagnostic = emptyDiagnostic(normalizedBaseUrl);
  const fail = (
    stage: ConnectionProbeStage,
    reason: string,
    partial: Partial<ConnectionProbeResult> = {},
  ): ConnectionProbeResult => {
    diagnostic.stage = stage;
    diagnostic.reasons.push(reason);
    return {
      ok: false,
      agent_card_valid: partial.agent_card_valid === true,
      a2a_protocol_probe_valid: false,
      required_skill_available: partial.required_skill_available === true,
      connection_contract_match: false,
      policy: partial.policy ?? null,
      validation: partial.validation ?? null,
      card: partial.card ?? null,
      diagnostic,
    };
  };

  if (!normalizedBaseUrl) {
    return fail('policy', 'baseUrl required');
  }

  let policy: RemoteEndpointPolicy;
  try {
    policy = input.policy || buildResearchEndpointPolicy({ baseUrl: normalizedBaseUrl });
    assertEndpointPolicyShape(policy);
  } catch (err) {
    return fail('policy', err instanceof Error ? err.message : String(err));
  }
  diagnostic.agentCardUrl = policy.expectedAgentCardUrl;

  let card: AgentCardView;
  let validation: EndpointValidationResult;
  try {
    const res = await fetchAllowlisted(policy.expectedAgentCardUrl, policy, {
      method: 'GET',
      timeoutMs: input.timeoutMs ?? Math.min(15_000, policy.maxTaskDuration),
    });
    diagnostic.httpStatus = res.status;
    if (!res.ok) {
      return fail('card', `agent card HTTP ${res.status}`, { policy });
    }
    const contentType = res.headers.get('content-type') || '';
    if (/text\/html/i.test(contentType)) {
      return fail('card', 'agent card returned HTML', { policy });
    }
    card = (await res.json()) as AgentCardView;
    validation = validateAgentCardAgainstPolicy(policy, card);
    if (!validation.ok) {
      const skillMissing = validation.reasons.some((r) => /allowlisted skill/i.test(r));
      return fail(skillMissing ? 'skill' : 'card', validation.reasons.join('; ') || 'agent card validation failed', {
        policy,
        validation,
        card,
        agent_card_valid: !skillMissing,
        required_skill_available: false,
      });
    }
  } catch (err) {
    return fail('card', err instanceof Error ? err.message : String(err), { policy });
  }

  const skillOk = (validation.matchedSkillIds || []).includes(requiredSkillId);
  if (!skillOk) {
    return fail('skill', `required skill unavailable: ${requiredSkillId}`, {
      policy,
      validation,
      card,
      agent_card_valid: true,
      required_skill_available: false,
    });
  }

  const interfaceUrl = validation.selectedInterfaceUrl
    ? normalizeBaseUrl(validation.selectedInterfaceUrl)
    : null;
  diagnostic.interfaceUrl = interfaceUrl;
  if (!interfaceUrl) {
    return fail('protocol_probe', 'agent card has no selectable A2A interface URL', {
      policy,
      validation,
      card,
      agent_card_valid: true,
      required_skill_available: true,
    });
  }

  // 端点必须与 Card / 白名单策略一致（回环别名已在 hostMatches 中等价）
  try {
    const iface = new URL(interfaceUrl.endsWith('/') ? interfaceUrl : `${interfaceUrl}/`);
    const expectedHost = new URL(policy.baseUrl).hostname;
    if (
      iface.hostname.toLowerCase() !== expectedHost.toLowerCase() &&
      !(
        ['127.0.0.1', 'localhost', '::1'].includes(iface.hostname.toLowerCase()) &&
        ['127.0.0.1', 'localhost', '::1'].includes(expectedHost.toLowerCase())
      )
    ) {
      return fail('protocol_probe', `interface host mismatch: ${iface.hostname} vs ${expectedHost}`, {
        policy,
        validation,
        card,
        agent_card_valid: true,
        required_skill_available: true,
      });
    }
  } catch (err) {
    return fail('protocol_probe', err instanceof Error ? err.message : String(err), {
      policy,
      validation,
      card,
      agent_card_valid: true,
      required_skill_available: true,
    });
  }

  const probeUrl = interfaceUrl.endsWith('/') ? interfaceUrl : `${interfaceUrl}/`;
  diagnostic.jsonRpcMethod = A2A_PROTOCOL_PROBE_METHOD;
  let probeHttpStatus: number | null = null;
  let probeBody: unknown = null;
  try {
    const probeRes = await fetchAllowlisted(probeUrl, policy, {
      method: 'POST',
      timeoutMs: input.timeoutMs ?? Math.min(15_000, policy.maxTaskDuration),
      headers: {
        'content-type': 'application/json',
        Accept: 'application/json',
        [A2A_VERSION_HEADER]: A2A_PROTOCOL_VERSION || '1.0',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `probe-${randomUUID()}`,
        method: A2A_PROTOCOL_PROBE_METHOD,
        params: { id: `dm-probe-${randomUUID()}`, tenant: '' },
      }),
    });
    probeHttpStatus = probeRes.status;
    diagnostic.httpStatus = probeRes.status;
    const contentType = probeRes.headers.get('content-type') || '';
    if (/text\/html/i.test(contentType)) {
      return fail('protocol_probe', 'A2A endpoint returned HTML', {
        policy,
        validation,
        card,
        agent_card_valid: true,
        required_skill_available: true,
      });
    }
    if (probeRes.status === 404 || probeRes.status === 500 || probeRes.status < 200 || probeRes.status >= 300) {
      let errHint = '';
      try {
        probeBody = await probeRes.json();
        const parsed = isProtocolValidJsonRpcBody(probeBody);
        diagnostic.jsonRpcErrorCode = parsed.errorCode;
        diagnostic.jsonRpcErrorMessage = parsed.errorMessage;
        errHint = parsed.errorMessage ? `: ${parsed.errorMessage}` : '';
      } catch {
        /* ignore */
      }
      return fail(
        'protocol_probe',
        `A2A protocol probe HTTP ${probeRes.status}${errHint}`,
        {
          policy,
          validation,
          card,
          agent_card_valid: true,
          required_skill_available: true,
        },
      );
    }
    probeBody = await probeRes.json();
  } catch (err) {
    return fail('protocol_probe', err instanceof Error ? err.message : String(err), {
      policy,
      validation,
      card,
      agent_card_valid: true,
      required_skill_available: true,
    });
  }

  const parsed = isProtocolValidJsonRpcBody(probeBody);
  diagnostic.jsonRpcErrorCode = parsed.errorCode;
  diagnostic.jsonRpcErrorMessage = parsed.errorMessage;
  if (!parsed.valid) {
    return fail('protocol_probe', parsed.reason || 'invalid A2A JSON-RPC response', {
      policy,
      validation,
      card,
      agent_card_valid: true,
      required_skill_available: true,
    });
  }

  diagnostic.stage = 'ok';
  diagnostic.httpStatus = probeHttpStatus;
  return {
    ok: true,
    agent_card_valid: true,
    a2a_protocol_probe_valid: true,
    required_skill_available: true,
    connection_contract_match: true,
    policy,
    validation,
    card,
    diagnostic,
  };
}

export function connectionProbeUserMessage(result: ConnectionProbeResult): string {
  return '无法连接研究分析能力，请确认服务正在运行并检查地址。';
}

export function scrubConnectionDiagnostic(diag: ConnectionProbeDiagnostic): ConnectionProbeDiagnostic {
  return {
    stage: diag.stage,
    normalizedBaseUrl: diag.normalizedBaseUrl,
    agentCardUrl: diag.agentCardUrl,
    interfaceUrl: diag.interfaceUrl,
    jsonRpcMethod: diag.jsonRpcMethod,
    httpStatus: diag.httpStatus,
    jsonRpcErrorCode: diag.jsonRpcErrorCode,
    jsonRpcErrorMessage: diag.jsonRpcErrorMessage
      ? String(diag.jsonRpcErrorMessage).slice(0, 240)
      : null,
    reasons: (diag.reasons || []).map((r) => String(r).slice(0, 240)),
  };
}
