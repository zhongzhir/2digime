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
  perPrincipalPerHour?: number;
  maxOutputTokens?: number;
  maxInputChars?: number;
  concurrency?: number;
  timeoutMs?: number;
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
  };
}

interface ReplayRow {
  at: number;
  result: ChatCompleteResult;
  usage: TokenUsage;
}

interface WindowCount {
  hour: number;
  count: number;
}

function hourBucket(nowMs: number): number {
  return Math.round(nowMs / 3_600_000);
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
  if (status === 'AVAILABLE') return 200;
  if (status === 'ALLOWANCE_EXHAUSTED') return 200;
  if (status === 'RATE_LIMITED') return 429;
  if (status === 'AUTH_FAILED') return 503;
  if (status === 'TEMPORARY_UNAVAILABLE') return 503;
  if (status === 'PAYLOAD_REJECTED') return 400;
  return 502;
}

function classifyProviderError(err: unknown): { status: ManagedAiGatewayStatus; message: string } {
  if (err instanceof ModelHttpError) {
    if (err.kind === 'unauthorized') return { status: 'AUTH_FAILED', message: 'provider_auth' };
    if (err.kind === 'rate_limited') return { status: 'RATE_LIMITED', message: 'provider_rate' };
    if (err.kind === 'timeout' || err.kind === 'aborted' || err.kind === 'network') {
      return { status: 'TEMPORARY_UNAVAILABLE', message: err.kind };
    }
    if (err.kind === 'server_error') return { status: 'TEMPORARY_UNAVAILABLE', message: 'provider_5xx' };
    return { status: 'PROVIDER_ERROR', message: err.kind };
  }
  return { status: 'PROVIDER_ERROR', message: 'provider_error' };
}

export function createManagedAiGateway(options: ManagedAiGatewayOptions): {
  ready: boolean;
  infer: (input: {
    body: unknown;
    installToken?: string;
    requestId?: string;
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
  const perPrincipalPerHour = options.perPrincipalPerHour ?? 30;
  const maxOutputTokens = options.maxOutputTokens ?? 2_048;
  const maxInputChars = options.maxInputChars ?? 100_000;
  const concurrencyCap = options.concurrency ?? 8;
  const timeoutMs = options.timeoutMs ?? 90_000;
  const now = options.now || Date.now;
  const complete = options.complete || chatComplete;
  const log = options.log || (() => undefined);
  const provider = options.provider || null;
  const store = options.store;
  const replay = new Map<string, ReplayRow>();
  const perPrincipal = new Map<string, WindowCount>();
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

  async function infer(input: { body: unknown; installToken?: string; requestId?: string }): Promise<ManagedAiGatewayResult> {
    const started = now();
    const token = String(input.installToken || '').trim();
    if (token.length < 32) {
      return { statusCode: 401, body: { ok: false, status: 'AUTH_FAILED', error: 'missing_install_token' } };
    }
    if (!provider) {
      log('ai_inference', { status: 'TEMPORARY_UNAVAILABLE', reason: 'provider_unconfigured' });
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
      return { statusCode: httpStatusOf(status), body: { ok: false, status, error: 'payload_rejected' } };
    }
    const principalId = hashInstallTokenToPrincipalId(token);
    const requestId = String(parsed.idempotencyKey || input.requestId || '').trim();

    if (requestId) {
      const cached = replay.get(requestId);
      if (cached && now() - cached.at < 15 * 60_000) {
        const cachedRow = await store.get(principalId);
        return {
          statusCode: 200,
          body: {
            ok: true,
            status: 'AVAILABLE',
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

    return enqueue(principalId, async () => {
      if (inFlight >= concurrencyCap) {
        return {
          statusCode: 429,
          body: { ok: false, status: 'RATE_LIMITED' as const, error: 'concurrency' },
        };
      }
      const hour = hourBucket(now());
      const window = perPrincipal.get(principalId) || { hour, count: 0 };
      if (window.hour !== hour) {
        window.hour = hour;
        window.count = 0;
      }
      if (window.count >= perPrincipalPerHour) {
        return { statusCode: 429, body: { ok: false, status: 'RATE_LIMITED' as const, error: 'rate_limited' } };
      }

      const nowIso = new Date(now()).toISOString();
      const global = await store.readGlobal();
      const dayRequests = global.day === nowIso.slice(0, 10) ? global.dayRequests : 0;
      if (global.tokensUsed >= globalTokenCeiling || dayRequests >= globalDailyRequests) {
        log('ai_inference', { status: 'RATE_LIMITED', reason: 'global_ceiling' });
        return { statusCode: 429, body: { ok: false, status: 'RATE_LIMITED' as const, error: 'global_ceiling' } };
      }

      let row = await loadOrCreateAllowance(principalId, nowIso);
      row = refreshAllowanceStatus(row, nowIso);
      if (row.status !== 'ACTIVE' || remainingTokens(row) <= 0) {
        log('ai_inference', {
          status: 'ALLOWANCE_EXHAUSTED',
          principal: principalId,
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

      inFlight += 1;
      window.count += 1;
      perPrincipal.set(principalId, window);
      let result: ChatCompleteResult;
      try {
        result = await complete({
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          model: provider.model,
          messages: parsed.messages,
          maxTokens: parsed.maxTokens,
          timeoutMs,
          ...(parsed.temperature !== undefined ? { temperature: parsed.temperature } : {}),
          ...(parsed.tools ? { tools: parsed.tools } : {}),
          ...(parsed.toolChoice ? { toolChoice: parsed.toolChoice } : {}),
          ...(parsed.responseFormat ? { responseFormat: parsed.responseFormat } : {}),
        });
      } catch (err) {
        inFlight -= 1;
        const mapped = classifyProviderError(err);
        log('ai_inference', {
          status: mapped.status,
          principal: principalId,
          latencyMs: now() - started,
          reason: mapped.message,
        });
        return { statusCode: httpStatusOf(mapped.status), body: { ok: false, status: mapped.status, error: mapped.message } };
      }
      inFlight -= 1;

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
      log('ai_inference', {
        status: 'AVAILABLE',
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
        statusCode: 200,
        body: {
          ok: true,
          status: 'AVAILABLE',
          text: result.text,
          ...(result.toolCalls ? { toolCalls: result.toolCalls } : {}),
          ...(result.finishReason ? { finishReason: result.finishReason } : {}),
          ...(result.truncated ? { truncated: true } : {}),
          usage,
          remainingPercent: remainingPercent(row),
          provider: 'managed-ai',
        },
      };
    });
  }

  return { ready: !!provider, infer, allowance };
}
