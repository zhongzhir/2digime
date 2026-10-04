import { randomUUID } from 'node:crypto';
import type { ChatCompleteFn } from '../subject-core/structured-distill';
import type { ChatCompleteResult, ModelCallDiagnostic } from '../infrastructure/model-http';

export type ManagedAiStatus =
  | 'AVAILABLE'
  | 'ALLOWANCE_EXHAUSTED'
  | 'RATE_LIMITED'
  | 'LOCAL_RATE_LIMITED'
  | 'CONCURRENCY_BUSY'
  | 'GLOBAL_CEILING'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_5XX'
  | 'AUTH_FAILED'
  | 'PROVIDER_ERROR'
  | 'TEMPORARY_UNAVAILABLE'
  | 'PAYLOAD_REJECTED';

export const MANAGED_AI_EXHAUSTED_NOTICE = '兔机米提供的免费 AI 额度已经用完。';
export const MANAGED_AI_BUSY_NOTICE = '模型服务当前比较忙，请稍后再试。';
export const MANAGED_AI_LOCAL_RATE_NOTICE = '这一会儿请求比较多，请稍后再试。';
export const MANAGED_AI_GLOBAL_CEILING_NOTICE = '模型服务当前已达运营上限，请稍后再试。';

const HUMAN: Record<ManagedAiStatus, string> = {
  AVAILABLE: '',
  ALLOWANCE_EXHAUSTED: MANAGED_AI_EXHAUSTED_NOTICE,
  RATE_LIMITED: MANAGED_AI_BUSY_NOTICE,
  LOCAL_RATE_LIMITED: MANAGED_AI_LOCAL_RATE_NOTICE,
  CONCURRENCY_BUSY: MANAGED_AI_BUSY_NOTICE,
  GLOBAL_CEILING: MANAGED_AI_GLOBAL_CEILING_NOTICE,
  PROVIDER_RATE_LIMITED: MANAGED_AI_BUSY_NOTICE,
  PROVIDER_TIMEOUT: '模型响应超时，请稍后再试。',
  PROVIDER_5XX: '模型服务暂时出错，请稍后再试。',
  AUTH_FAILED: '兔机米提供的 AI 服务暂时不可用。',
  PROVIDER_ERROR: '这次没有得到模型回复，请稍后再试。',
  TEMPORARY_UNAVAILABLE: '暂时无法联系模型服务，请稍后再试。',
  PAYLOAD_REJECTED: '这次内容无法发送给模型服务。',
};

export class ManagedAiError extends Error {
  diagnostic?: ModelCallDiagnostic;
  readonly status: ManagedAiStatus;
  readonly userNotice: boolean;
  readonly reason?: string;

  constructor(status: ManagedAiStatus, message?: string, reason?: string) {
    super(message || HUMAN[status] || HUMAN.PROVIDER_ERROR);
    this.name = 'ManagedAiError';
    this.status = status;
    this.userNotice = true;
    if (reason) this.reason = reason;
  }
}

export function isManagedAiUserNotice(err: unknown): boolean {
  if (err instanceof ManagedAiError) return true;
  const msg = String((err as { message?: string })?.message || '');
  return msg.includes('免费 AI 额度已经用完');
}

export function managedAiHumanMessage(status: string, fallback?: string): string {
  const key = String(status || '').toUpperCase() as ManagedAiStatus;
  return HUMAN[key] || fallback || HUMAN.PROVIDER_ERROR;
}

export interface ManagedAiClientOptions {
  gatewayUrl: string;
  installToken: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface ManagedAiAllowanceView {
  source: string;
  status: string;
  remainingPercent: number;
}

const STATUSES: readonly ManagedAiStatus[] = [
  'AVAILABLE',
  'ALLOWANCE_EXHAUSTED',
  'RATE_LIMITED',
  'LOCAL_RATE_LIMITED',
  'CONCURRENCY_BUSY',
  'GLOBAL_CEILING',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_TIMEOUT',
  'PROVIDER_5XX',
  'AUTH_FAILED',
  'PROVIDER_ERROR',
  'TEMPORARY_UNAVAILABLE',
  'PAYLOAD_REJECTED',
];

export function classifyManagedAiFailure(input: {
  httpStatus: number;
  bodyStatus?: string;
  bodyError?: string;
}): ManagedAiStatus {
  const err = String(input.bodyError || '').toLowerCase();
  if (err === 'concurrency') return 'CONCURRENCY_BUSY';
  if (err === 'rate_limited') return 'LOCAL_RATE_LIMITED';
  if (err === 'global_ceiling') return 'GLOBAL_CEILING';
  if (err === 'provider_rate') return 'PROVIDER_RATE_LIMITED';
  if (err === 'timeout') return 'PROVIDER_TIMEOUT';
  if (err === 'provider_5xx') return 'PROVIDER_5XX';
  const labeled = String(input.bodyStatus || '').toUpperCase();
  if ((STATUSES as readonly string[]).includes(labeled)) return labeled as ManagedAiStatus;
  if (input.httpStatus === 429) return 'RATE_LIMITED';
  if (input.httpStatus === 401 || input.httpStatus === 403) return 'AUTH_FAILED';
  if (input.httpStatus === 503) return 'TEMPORARY_UNAVAILABLE';
  return 'PROVIDER_ERROR';
}

function classifyHttp(status: number, bodyStatus?: string, bodyError?: string): ManagedAiStatus {
  return classifyManagedAiFailure({
    httpStatus: status,
    ...(bodyStatus ? { bodyStatus } : {}),
    ...(bodyError ? { bodyError } : {}),
  });
}

export function createManagedAiChatComplete(options: ManagedAiClientOptions): ChatCompleteFn {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = options.timeoutMs ?? 90_000;
  const base = options.gatewayUrl.replace(/\/+$/, '');

  return async (input) => {
    const ac = new AbortController();
    const diagnostic: ModelCallDiagnostic = { stage: input.stage || 'model', requestId: randomUUID(), httpStatus: null,
      finishReason: null, outputLength: null, parseError: null, cancellation: null, failure: null };
    const fail = (status: ManagedAiStatus, failure: ModelCallDiagnostic['failure'], message?: string): never => {
      diagnostic.failure = failure;
      throw Object.assign(new ManagedAiError(status, message), { diagnostic: { ...diagnostic } });
    };
    const onAbort = () => {
      diagnostic.cancellation = input.signal?.reason === 'deadline' ? 'deadline'
        : input.signal?.reason === 'user' ? 'user' : input.signal?.reason === 'superseded' ? 'superseded' : 'caller';
      ac.abort(input.signal?.reason);
    };
    if (input.signal) {
      if (input.signal.aborted) { onAbort(); fail('TEMPORARY_UNAVAILABLE', 'cancelled', '这次请求已取消。'); }
      input.signal.addEventListener('abort', onAbort, { once: true });
    }
    const remaining = Math.min(input.timeoutMs ?? timeoutMs, input.deadlineAt === undefined ? Infinity : input.deadlineAt - Date.now());
    if (remaining <= 0) { diagnostic.cancellation = 'deadline'; input.signal?.removeEventListener('abort', onAbort); fail('PROVIDER_TIMEOUT', 'timeout'); }
    const timer = setTimeout(() => { diagnostic.cancellation = 'deadline'; ac.abort('deadline'); }, remaining);
    const idempotencyKey = diagnostic.requestId!;
    let res!: Response;
    try {
      res = await fetchImpl(`${base}/v1/ai/inference`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-install-capability-token': options.installToken,
          'x-request-id': idempotencyKey,
        },
        body: JSON.stringify({
          messages: input.messages,
          ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
          ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
          ...(input.responseFormat ? { responseFormat: input.responseFormat } : {}),
          ...(input.tools && input.tools.length ? { tools: input.tools } : {}),
          ...(input.toolChoice ? { toolChoice: input.toolChoice } : {}),
          ...(input.thinking ? { thinking: input.thinking } : {}),
          idempotencyKey,
        }),
        signal: ac.signal,
      });
      diagnostic.httpStatus = res.status;
    } catch (err) {
      clearTimeout(timer); input.signal?.removeEventListener('abort', onAbort);
      if (diagnostic.cancellation === 'deadline') fail('PROVIDER_TIMEOUT', 'timeout');
      if (ac.signal.aborted) fail('TEMPORARY_UNAVAILABLE', 'cancelled', '这次请求已取消。');
      fail('TEMPORARY_UNAVAILABLE', 'network');
    }

    let json: {
      ok?: boolean;
      status?: string;
      error?: string;
      text?: string;
      toolCalls?: ChatCompleteResult['toolCalls'];
      finishReason?: string;
      truncated?: boolean;
      usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    } = {};
    try {
      json = (await res.json()) as typeof json;
    } catch (err) {
      if (ac.signal.aborted) {
        clearTimeout(timer); input.signal?.removeEventListener('abort', onAbort);
        fail(diagnostic.cancellation === 'deadline' ? 'PROVIDER_TIMEOUT' : 'TEMPORARY_UNAVAILABLE', diagnostic.cancellation === 'deadline' ? 'timeout' : 'cancelled');
      }
      diagnostic.parseError = 'json';
      clearTimeout(timer); input.signal?.removeEventListener('abort', onAbort);
      fail('PROVIDER_ERROR', 'format', '模型服务返回了无法解析的格式。');
    }
    clearTimeout(timer); input.signal?.removeEventListener('abort', onAbort);
    if (ac.signal.aborted) fail(diagnostic.cancellation === 'deadline' ? 'PROVIDER_TIMEOUT' : 'TEMPORARY_UNAVAILABLE', diagnostic.cancellation === 'deadline' ? 'timeout' : 'cancelled');
    if (!json || typeof json !== 'object' || Array.isArray(json)) { diagnostic.parseError = 'envelope'; fail('PROVIDER_ERROR', 'format', '模型服务返回了无效格式。'); }
    diagnostic.finishReason = typeof json.finishReason === 'string' && /^[a-z_]{1,40}$/.test(json.finishReason) ? json.finishReason : null;
    diagnostic.outputLength = typeof json.text === 'string' ? json.text.length : null;
    const status = classifyHttp(res.status, json.status, json.error);
    if (status !== 'AVAILABLE' || json.ok === false) {
      fail(status, 'http');
    }
    const text = typeof json.text === 'string' ? json.text : '';
    const toolCalls = Array.isArray(json.toolCalls) ? json.toolCalls : undefined;
    const truncated = json.truncated === true || json.finishReason === 'length';
    if (!text.trim() && !(toolCalls && toolCalls.length) && !truncated) {
      fail('PROVIDER_ERROR', 'empty', '模型服务返回了空正文。');
    }
    diagnostic.failure = truncated ? 'truncated' : null;
    return {
      diagnostic,
      text,
      ...(toolCalls && toolCalls.length ? { toolCalls } : {}),
      ...(json.finishReason ? { finishReason: json.finishReason } : {}),
      ...(truncated ? { truncated: true as const } : {}),
      ...(json.usage &&
      typeof json.usage.totalTokens === 'number' &&
      typeof json.usage.inputTokens === 'number' &&
      typeof json.usage.outputTokens === 'number'
        ? {
            usage: {
              inputTokens: json.usage.inputTokens,
              outputTokens: json.usage.outputTokens,
              totalTokens: json.usage.totalTokens,
            },
          }
        : {}),
    };
  };
}

export async function fetchManagedAiAllowance(
  options: ManagedAiClientOptions,
): Promise<ManagedAiAllowanceView | null> {
  const fetchImpl = options.fetchImpl || fetch;
  const base = options.gatewayUrl.replace(/\/+$/, '');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), options.timeoutMs ?? 8_000);
  try {
    const res = await fetchImpl(`${base}/v1/ai/allowance`, {
      method: 'GET',
      headers: { 'x-install-capability-token': options.installToken },
      signal: ac.signal,
    });
    const json = (await res.json()) as ManagedAiAllowanceView & { ok?: boolean };
    if (!res.ok || json.ok === false) return null;
    return {
      source: String(json.source || 'TRIAL'),
      status: String(json.status || 'ACTIVE'),
      remainingPercent: Number(json.remainingPercent || 0),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
