import { randomUUID } from 'node:crypto';
/**
 * Relay 上极薄的 Managed AI Gateway。
 * 负责：provider credential / allowance / metering / rate limit / forward / normalize / failure。
 * 不负责：Digital Self / ranking / memory / planning / recommendation。
 */
import type { ChatCompleteOptions, ChatCompleteResult, ChatMessage } from '../infrastructure/model-http';
import { chatComplete, ModelHttpError } from '../infrastructure/model-http';
import {
  bumpGlobalSpend,
  createTrialAllowance,
  hashInstallTokenToPrincipalId,
  remainingPercent,
  remainingTokens,
  refreshAllowanceStatus,
  type AiAllowance,
  type TokenUsage,
  type createFileAiAllowanceStore,
} from './ai-allowance';

export type ManagedAiGatewayStatus =
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

export const FORBIDDEN_AI_INFERENCE_KEYS = [
  'digitalSelf',
  'self',
  'selfJson',
  'self.json',
  'facts',
  'preferences',
  'embeddings',
  'profile',
  'interest',
  'memory',
  'ranking',
  'history',
] as const;

const ALLOWED_BODY_KEYS = new Set([
  'messages',
  'temperature',
  'maxTokens',
  'tools',
  'toolChoice',
  'responseFormat',
  'idempotencyKey',
]);

export interface ManagedAiProviderConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ManagedAiGatewayOptions {
  provider?: ManagedAiProviderConfig | null;
  store: ReturnType<typeof createFileAiAllowanceStore>;
  trialTokenLimit?: number;
  globalTokenCeiling?: number;
  globalDailyRequests?: number;
  /**
   * 短窗口 burst 防护，不是用户额度。
   * 默认 15s / 16 次：覆盖实测 tool-loop 峰值（4–5 次/2–3s）和单回合上限
   * （Digital Self interpret + first + MAX_TOOL_ROUNDS=8 + final ≈ 11 HTTP），
   * 不把日历小时内 30 次内部 inference 当成普通用户硬上限。
   */
  burstWindowMs?: number;
  burstMax?: number;
  structuredThinking?: ChatCompleteOptions['thinking'];
  toolThinking?: ChatCompleteOptions['thinking'];
  maxOutputTokens?: number;
  maxInputChars?: number;
  concurrency?: number;
  timeoutMs?: number;
  /** provider 瞬时失败最多再试几次（不含首次）。默认 2。 */
  maxProviderRetries?: number;
  retryBackoffMs?: number;
  now?: () => number;
  complete?: typeof chatComplete;
  log?: (event: string, fields: Record<string, string | number | boolean | undefined>) => void;
}

export interface ManagedAiGatewayResult {
  statusCode: number;
  body: {
    ok: boolean;
    status: ManagedAiGatewayStatus;
    text?: string;
    toolCalls?: ChatCompleteResult['toolCalls'];
    finishReason?: string;
    truncated?: boolean;
    usage?: TokenUsage;
    remainingPercent?: number;
    error?: string;
    provider?: string;
    retryAfterMs?: number;
  };
}

/** 实测复杂任务峰值 4–5 HTTP/2–3s；单回合最多约 11 次内部 inference。 */
export const DEFAULT_BURST_WINDOW_MS = 15_000;
export const DEFAULT_BURST_MAX = 16;

export function pruneBurstTimestamps(stamps: number[], nowMs: number, windowMs: number): number[] {
  return stamps.filter((at) => nowMs - at < windowMs && at <= nowMs);
}

export function burstRetryAfterMs(stamps: number[], nowMs: number, windowMs: number): number {
  if (!stamps.length) return 0;
  const oldest = stamps[0] || nowMs;
  return Math.max(1, windowMs - (nowMs - oldest));
}

interface ReplayRow {
  at: number;
  result: ChatCompleteResult;
  usage: TokenUsage;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function parseProviderUsage(usage: unknown, fallback: { inputChars: number; outputChars: number }): TokenUsage {
  const parsed = usage && typeof usage === 'object' ? (usage as Record<string, unknown>) : {};
  const input =
    num(parsed.inputTokens) ??
    num(parsed.prompt_tokens) ??
    num(parsed.input_tokens);
  const output =
    num(parsed.outputTokens) ??
    num(parsed.completion_tokens) ??
    num(parsed.output_tokens);
  const total = num(parsed.totalTokens) ?? num(parsed.total_tokens);
  const inputTokens = input ?? Math.max(1, Math.ceil(fallback.inputChars / 4));
  const outputTokens = output ?? Math.max(0, Math.ceil(fallback.outputChars / 4));
  const totalTokens = total ?? inputTokens + outputTokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens: Math.max(totalTokens, inputTokens + outputTokens),
  };
}

export function forbiddenAiInferenceKeys(body: unknown): string[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  return Object.keys(body as Record<string, unknown>).filter((key) =>
    (FORBIDDEN_AI_INFERENCE_KEYS as readonly string[]).includes(key),
  );
}

export function parseAiInferenceRequest(
  body: unknown,
  limits: { maxInputChars: number; maxOutputTokens: number },
): {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens: number;
  tools?: ChatCompleteOptions['tools'];
  toolChoice?: ChatCompleteOptions['toolChoice'];
  responseFormat?: ChatCompleteOptions['responseFormat'];
  idempotencyKey?: string;
  inputChars: number;
} {
  const forbidden = forbiddenAiInferenceKeys(body);
  if (forbidden.length) {
    throw Object.assign(new Error('payload_rejected'), { status: 'PAYLOAD_REJECTED' as const, forbidden });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('invalid_json'), { status: 'PAYLOAD_REJECTED' as const });
  }
  const rec = body as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (!ALLOWED_BODY_KEYS.has(key)) {
      throw Object.assign(new Error('payload_rejected'), { status: 'PAYLOAD_REJECTED' as const, forbidden: [key] });
    }
  }
  if (!Array.isArray(rec.messages) || rec.messages.length === 0) {
    throw Object.assign(new Error('missing_messages'), { status: 'PAYLOAD_REJECTED' as const });
  }
  const messages = rec.messages as ChatMessage[];
  const inputChars = messages.reduce((sum, row) => sum + String(row?.content || '').length, 0);
  if (inputChars > limits.maxInputChars) {
    throw Object.assign(new Error('payload_too_large'), { status: 'PAYLOAD_REJECTED' as const });
  }
  const maxTokensRaw = num(rec.maxTokens);
  const maxTokens = Math.min(limits.maxOutputTokens, Math.max(1, Math.floor(maxTokensRaw ?? limits.maxOutputTokens)));
  const temperature = num(rec.temperature);
  const idempotencyKey = typeof rec.idempotencyKey === 'string' && rec.idempotencyKey.trim() ? rec.idempotencyKey.trim() : undefined;
  return {
    messages,
    maxTokens,
    inputChars,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(Array.isArray(rec.tools) ? { tools: rec.tools as ChatCompleteOptions['tools'] } : {}),
    ...(rec.toolChoice === 'auto' || rec.toolChoice === 'none' ? { toolChoice: rec.toolChoice } : {}),
    ...(rec.responseFormat && typeof rec.responseFormat === 'object'
      ? { responseFormat: rec.responseFormat as ChatCompleteOptions['responseFormat'] }
      : {}),
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

function httpStatusOf(status: ManagedAiGatewayStatus): number {
  if (status === 'AVAILABLE' || status === 'ALLOWANCE_EXHAUSTED') return 200;
  if (
    status === 'RATE_LIMITED' ||
    status === 'LOCAL_RATE_LIMITED' ||
    status === 'CONCURRENCY_BUSY' ||
    status === 'GLOBAL_CEILING' ||
    status === 'PROVIDER_RATE_LIMITED'
  ) {
    return 429;
  }
  if (status === 'AUTH_FAILED' || status === 'TEMPORARY_UNAVAILABLE' || status === 'PROVIDER_TIMEOUT') return 503;
  if (status === 'PAYLOAD_REJECTED') return 400;
  return 502;
}

function classifyProviderError(err: unknown): { status: ManagedAiGatewayStatus; message: string } {
  if (err instanceof ModelHttpError) {
    if (err.kind === 'unauthorized') return { status: 'AUTH_FAILED', message: 'provider_auth' };
    if (err.kind === 'rate_limited') return { status: 'PROVIDER_RATE_LIMITED', message: 'provider_rate' };
    if (err.kind === 'timeout') return { status: 'PROVIDER_TIMEOUT', message: 'timeout' };
    if (err.kind === 'aborted') return { status: 'TEMPORARY_UNAVAILABLE', message: 'aborted' };
    if (err.kind === 'network') return { status: 'TEMPORARY_UNAVAILABLE', message: 'network' };
    if (err.kind === 'server_error') return { status: 'PROVIDER_5XX', message: 'provider_5xx' };
    return { status: 'PROVIDER_ERROR', message: err.kind };
  }
  return { status: 'PROVIDER_ERROR', message: 'provider_error' };
}

function isRetryableProviderStatus(status: ManagedAiGatewayStatus, message: string): boolean {
  if (message === 'aborted') return false;
  return status === 'PROVIDER_RATE_LIMITED' || status === 'PROVIDER_5XX' || status === 'PROVIDER_TIMEOUT';
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    if (signal?.aborted) return Promise.reject(new ModelHttpError('aborted', 'request aborted by caller'));
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new ModelHttpError('aborted', 'request aborted by caller'));
    };
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        reject(new ModelHttpError('aborted', 'request aborted by caller'));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export function createManagedAiGateway(options: ManagedAiGatewayOptions): {
  ready: boolean;
  infer: (input: {
    body: unknown;
    installToken?: string;
    requestId?: string;
    signal?: AbortSignal;
  }) => Promise<ManagedAiGatewayResult>;
  allowance: (input: { installToken?: string }) => Promise<{
    statusCode: number;
    body: {
      ok: boolean;
      status?: string;
      source?: string;
      remainingPercent?: number;
      error?: string;
    };
  }>;
} {
  const trialTokenLimit = options.trialTokenLimit ?? 5_000_000;
  const globalTokenCeiling = options.globalTokenCeiling ?? 50_000_000;
  const globalDailyRequests = options.globalDailyRequests ?? 2_000;
  const burstWindowMs = Math.max(1_000, options.burstWindowMs ?? DEFAULT_BURST_WINDOW_MS);
  const burstMax = Math.max(1, Math.floor(options.burstMax ?? DEFAULT_BURST_MAX));
  const maxOutputTokens = options.maxOutputTokens ?? 2_048;
  const maxInputChars = options.maxInputChars ?? 100_000;
  const concurrencyCap = options.concurrency ?? 8;
  const timeoutMs = options.timeoutMs ?? 90_000;
  const maxProviderRetries = Math.max(0, Math.min(2, Math.floor(options.maxProviderRetries ?? 2)));
  const retryBackoffMs = Math.max(0, options.retryBackoffMs ?? 200);
  const now = options.now || Date.now;
  const complete = options.complete || chatComplete;
  const log = options.log || (() => undefined);
  const provider = options.provider || null;
  const store = options.store;
  const replay = new Map<string, ReplayRow>();
  const bursts = new Map<string, number[]>();
  const locks = new Map<string, Promise<unknown>>();
  let inFlight = 0;

  function enqueue<T>(principalId: string, fn: () => Promise<T>): Promise<T> {
    const prev = locks.get(principalId) || Promise.resolve();
    const run = prev.then(fn, fn);
    locks.set(
      principalId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  async function loadOrCreateAllowance(principalId: string, nowIso: string): Promise<AiAllowance> {
    const existing = await store.get(principalId);
    if (existing) return refreshAllowanceStatus(existing, nowIso);
    const trial = createTrialAllowance({
      principalId,
      tokenLimit: trialTokenLimit,
      provider: 'managed-ai',
      model: provider?.model || 'managed-ai',
      nowIso,
    });
    await store.put(trial);
    return trial;
  }

  async function allowance(input: { installToken?: string }) {
    const token = String(input.installToken || '').trim();
    if (token.length < 32) {
      return { statusCode: 401, body: { ok: false, error: 'missing_install_token' } };
    }
    const principalId = hashInstallTokenToPrincipalId(token);
    const nowIso = new Date(now()).toISOString();
    const row = await loadOrCreateAllowance(principalId, nowIso);
    return {
      statusCode: 200,
      body: {
        ok: true,
        source: row.source,
        status: row.status,
        remainingPercent: remainingPercent(row),
      },
    };
  }

  async function infer(input: {
    body: unknown;
    installToken?: string;
    requestId?: string;
    signal?: AbortSignal;
  }): Promise<ManagedAiGatewayResult> {
    const started = now();
    const rawId = String(input.requestId || (input.body as { idempotencyKey?: string })?.idempotencyKey || '');
    const correlationId = /^[A-Za-z0-9._:-]{1,128}$/.test(rawId) ? rawId : randomUUID();
    const requestLog = (event: string, fields: Record<string, string | number | boolean | undefined>) => log(event, { requestId: correlationId, stage: 'gateway', ...fields });
    const token = String(input.installToken || '').trim();
    if (token.length < 32) {
      return { statusCode: 401, body: { ok: false, status: 'AUTH_FAILED', error: 'missing_install_token' } };
    }
    if (!provider) {
      requestLog('ai_inference', { status: 'TEMPORARY_UNAVAILABLE', reason: 'provider_unconfigured' });
      return {
        statusCode: 503,
        body: { ok: false, status: 'TEMPORARY_UNAVAILABLE', error: 'managed_ai_unavailable' },
      };
    }
    let parsed: ReturnType<typeof parseAiInferenceRequest>;
    try {
      parsed = parseAiInferenceRequest(input.body, { maxInputChars, maxOutputTokens });
    } catch (err) {
      const status = ((err as { status?: ManagedAiGatewayStatus }).status || 'PAYLOAD_REJECTED') as ManagedAiGatewayStatus;
      requestLog('ai_inference', { status, stage: 'validation', reason: 'payload_rejected', httpStatus: httpStatusOf(status) });
      return { statusCode: httpStatusOf(status), body: { ok: false, status, error: 'payload_rejected' } };
    }
    const principalId = hashInstallTokenToPrincipalId(token);
    const requestId = String(parsed.idempotencyKey || input.requestId || '').trim();

    if (requestId) {
      const cached = replay.get(requestId);
      if (cached && now() - cached.at < 15 * 60_000) {
        const cachedRow = await store.get(principalId);
        return {
          statusCode: cached.result.truncated || cached.result.finishReason === 'length' ? 502 : 200,
          body: {
            ok: !(cached.result.truncated || cached.result.finishReason === 'length'),
            status: cached.result.truncated || cached.result.finishReason === 'length' ? 'PROVIDER_ERROR' : 'AVAILABLE',
            ...(cached.result.truncated || cached.result.finishReason === 'length' ? { error: 'truncated' } : {}),
            text: cached.result.text,
            ...(cached.result.toolCalls ? { toolCalls: cached.result.toolCalls } : {}),
            ...(cached.result.finishReason ? { finishReason: cached.result.finishReason } : {}),
            ...(cached.result.truncated ? { truncated: true } : {}),
            usage: cached.usage,
            ...(cachedRow ? { remainingPercent: remainingPercent(cachedRow) } : {}),
            provider: 'managed-ai',
          },
        };
      }
      const billed = await store.getIdempotency(requestId);
      if (billed) {
        return {
          statusCode: 200,
          body: {
            ok: false,
            status: 'TEMPORARY_UNAVAILABLE',
            error: 'duplicate_request',
            usage: billed.usage,
          },
        };
      }
    }

    // Burst 按入场次数计，不按 provider 完成次数计。
    // 同一 principal 的 enqueue 会串行等待上一次 complete；若只在出队后打点，
    // 真实 latency 下 15s 窗口永远凑不满 16 次，abuse 门形同虚设。
    const admitAt = now();
    const admitted = pruneBurstTimestamps(bursts.get(principalId) || [], admitAt, burstWindowMs);
    if (admitted.length >= burstMax) {
      const retryAfterMs = burstRetryAfterMs(admitted, admitAt, burstWindowMs);
      requestLog('ai_inference', {
        status: 'LOCAL_RATE_LIMITED',
        principal: principalId,
        limitType: 'burst',
        count: admitted.length,
        limit: burstMax,
        windowMs: burstWindowMs,
        retryAfterMs,
      });
      return {
        statusCode: 429,
        body: {
          ok: false,
          status: 'LOCAL_RATE_LIMITED' as const,
          error: 'rate_limited',
          retryAfterMs,
        },
      };
    }
    admitted.push(admitAt);
    bursts.set(principalId, admitted);

    return enqueue(principalId, async () => {
      if (input.signal?.aborted) {
        return {
          statusCode: 503,
          body: { ok: false, status: 'TEMPORARY_UNAVAILABLE' as const, error: 'aborted' },
        };
      }
      if (inFlight >= concurrencyCap) {
        requestLog('ai_inference', { status: 'CONCURRENCY_BUSY', principal: principalId, inFlight, limitType: 'concurrency' });
        return {
          statusCode: 429,
          body: { ok: false, status: 'CONCURRENCY_BUSY' as const, error: 'concurrency' },
        };
      }
      inFlight += 1;
      const isToolExchange = !!parsed.tools?.length || parsed.messages.some(message => message.role === 'tool');
      const thinking = isToolExchange ? options.toolThinking
        : parsed.responseFormat?.type === 'json_object' ? options.structuredThinking : undefined;
      const deadlineAt = started + timeoutMs;
      const requestAbort = new AbortController();
      const onCallerAbort = () => requestAbort.abort('caller');
      if (input.signal?.aborted) onCallerAbort();
      else input.signal?.addEventListener('abort', onCallerAbort, { once: true });
      const deadlineTimer = setTimeout(() => requestAbort.abort('deadline'), Math.max(0, deadlineAt - now()));
      const checkRequest = () => {
        if (now() >= deadlineAt || requestAbort.signal.reason === 'deadline') {
          requestAbort.abort('deadline');
          throw new ModelHttpError('timeout', 'request deadline');
        }
        if (requestAbort.signal.aborted) throw new ModelHttpError('aborted', 'request aborted by caller');
      };
      try {
      const nowMs = now();
      const nowIso = new Date(nowMs).toISOString();
      const global = await store.readGlobal();
      const dayRequests = global.day === nowIso.slice(0, 10) ? global.dayRequests : 0;
      if (global.tokensUsed >= globalTokenCeiling || dayRequests >= globalDailyRequests) {
        const nextDay = Date.parse(`${nowIso.slice(0, 10)}T00:00:00.000Z`) + 86_400_000;
        const retryAfterMs = global.tokensUsed >= globalTokenCeiling ? 0 : Math.max(1, nextDay - nowMs);
        requestLog('ai_inference', {
          status: 'GLOBAL_CEILING',
          reason: 'global_ceiling',
          principal: principalId,
          limitType: 'global_ceiling',
          tokensUsed: global.tokensUsed,
          tokenCeiling: globalTokenCeiling,
          dayRequests,
          dailyRequestLimit: globalDailyRequests,
          retryAfterMs,
        });
        return {
          statusCode: 429,
          body: { ok: false, status: 'GLOBAL_CEILING' as const, error: 'global_ceiling', retryAfterMs },
        };
      }

      let row = await loadOrCreateAllowance(principalId, nowIso);
      row = refreshAllowanceStatus(row, nowIso);
      if (row.status !== 'ACTIVE' || remainingTokens(row) <= 0) {
        requestLog('ai_inference', {
          status: 'ALLOWANCE_EXHAUSTED',
          principal: principalId,
          limitType: 'allowance',
          used: row.tokensUsed,
          limit: row.tokenLimit,
        });
        return {
          statusCode: 200,
          body: {
            ok: false,
            status: 'ALLOWANCE_EXHAUSTED',
            remainingPercent: 0,
            error: 'allowance_exhausted',
          },
        };
      }

      let result: ChatCompleteResult;
      try {
        result = await (async () => {
          let lastErr: unknown;
          for (let attempt = 0; attempt <= maxProviderRetries; attempt++) {
            checkRequest();
            try {
              requestLog('ai_inference', { stage: 'provider_start', attempt: attempt + 1, timeoutMs: deadlineAt - now(), maxTokens: parsed.maxTokens, model: provider.model, thinking: thinking?.type || 'provider_default' });
              const completed = await complete({
                baseUrl: provider.baseUrl,
                apiKey: provider.apiKey,
                model: provider.model,
                messages: parsed.messages,
                maxTokens: parsed.maxTokens,
                timeoutMs: Math.max(1, deadlineAt - now()),
                signal: requestAbort.signal,
                ...(thinking ? { thinking } : {}),
                ...(parsed.temperature !== undefined ? { temperature: parsed.temperature } : {}),
                ...(parsed.tools ? { tools: parsed.tools } : {}),
                ...(parsed.toolChoice ? { toolChoice: parsed.toolChoice } : {}),
                ...(parsed.responseFormat ? { responseFormat: parsed.responseFormat } : {}),
              });
              checkRequest();
              return completed;
            } catch (err) {
              lastErr = err;
              const mapped = classifyProviderError(err);
              if (!isRetryableProviderStatus(mapped.status, mapped.message) || attempt >= maxProviderRetries) {
                throw err;
              }
              requestLog('ai_inference', {
                status: mapped.status,
                principal: principalId,
                reason: mapped.message,
                retry: attempt + 1,
              });
              checkRequest();
              await sleep(Math.min(retryBackoffMs * 4 ** attempt, Math.max(0, deadlineAt - now())), requestAbort.signal);
              checkRequest();
            }
          }
          throw lastErr;
        })();
      } catch (err) {
        const mapped = classifyProviderError(err);
        requestLog('ai_inference', {
          status: mapped.status,
          principal: principalId,
          latencyMs: now() - started,
          reason: mapped.message,
          stage: 'provider_failure',
          gatewayHttpStatus: httpStatusOf(mapped.status),
          providerHttpStatus: err instanceof ModelHttpError ? err.status : undefined,
          cancellation: requestAbort.signal.aborted ? String(requestAbort.signal.reason) : mapped.message === 'timeout' ? 'deadline' : undefined,
          cancelSent: requestAbort.signal.aborted,
          supplierStopConfirmed: false,
        });
        return { statusCode: httpStatusOf(mapped.status), body: { ok: false, status: mapped.status, error: mapped.message } };
      }

      const usage = parseProviderUsage(result.usage, {
        inputChars: parsed.inputChars,
        outputChars: String(result.text || '').length,
      });
      row.tokensUsed += usage.totalTokens;
      row.inputTokens += usage.inputTokens;
      row.outputTokens += usage.outputTokens;
      row.requestCount += 1;
      row = refreshAllowanceStatus(row, nowIso);
      await store.put(row);
      await store.putGlobal(bumpGlobalSpend(global, usage, nowIso));
      if (requestId) {
        await store.putIdempotency({
          requestId,
          principalId,
          usage,
          at: nowIso,
        });
        replay.set(requestId, { at: now(), result, usage });
      }
      const truncated = !!result.truncated || result.finishReason === 'length';
      requestLog('ai_inference', {
        status: truncated ? 'PROVIDER_ERROR' : 'AVAILABLE',
        stage: 'provider_result',
        gatewayHttpStatus: truncated ? 502 : 200,
        providerHttpStatus: result.providerMeta?.httpStatus,
        providerResponseId: result.providerMeta?.responseId,
        returnedModel: result.providerMeta?.model,
        reasoningLength: result.providerMeta?.reasoningLength,
        reasoningTokens: result.providerMeta?.reasoningTokens,
        reason: truncated ? 'truncated' : undefined,
        finishReason: /^[a-z_]{1,40}$/.test(result.finishReason || '') ? result.finishReason : undefined,
        outputLength: result.text.length,
        usageSource: result.usage ? 'provider' : 'estimated',
        principal: principalId,
        provider: provider.provider,
        model: provider.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        remaining: remainingTokens(row),
        latencyMs: now() - started,
      });
      return {
        statusCode: truncated ? 502 : 200,
        body: {
          ok: !truncated,
          status: truncated ? 'PROVIDER_ERROR' : 'AVAILABLE',
          ...(truncated ? { error: 'truncated' } : {}),
          text: result.text,
          ...(result.toolCalls ? { toolCalls: result.toolCalls } : {}),
          ...(result.finishReason ? { finishReason: result.finishReason } : {}),
          ...(result.truncated ? { truncated: true } : {}),
          usage,
          remainingPercent: remainingPercent(row),
          provider: 'managed-ai',
        },
      };
      } finally {
        clearTimeout(deadlineTimer);
        input.signal?.removeEventListener('abort', onCallerAbort);
        inFlight = Math.max(0, inFlight - 1);
      }
    });
  }

  return { ready: !!provider, infer, allowance };
}
