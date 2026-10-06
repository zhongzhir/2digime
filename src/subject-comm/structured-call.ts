/**
 * 发现里几处"让模型输出一段 JSON"的调用共用的升级策略。
 *
 * 不是第二套规划器：只处理机械事实——响应是否被截断、正文是否为空、JSON 是否解析得出。
 * 第 1 次：关闭隐藏推理，小预算，快。BYOK 端点会遵守；托管网关不转发该字段，等于普通请求。
 * 第 2 次：保留推理（复杂判断需要），预算和超时都放大。
 * 两次都没有可用结果，就如实返回 null，调用方负责说明"这次没有完成判断"，不用默认值冒充。
 */
import type { ChatCompleteOptions, ChatCompleteResult, ModelCallDiagnostic } from '../infrastructure/model-http';
import type { ChatCompleteFn } from '../subject-core/structured-distill';

export interface StructuredPass {
  maxTokens: number;
  timeoutMs: number;
  disableThinking: boolean;
}

export interface StructuredAttempt {
  stage: string;
  httpStatus: number | null;
  parseError: ModelCallDiagnostic['parseError'];
  cancellation: ModelCallDiagnostic['cancellation'];
  failure: ModelCallDiagnostic['failure'];
  pass: number;
  maxTokens: number;
  disableThinking: boolean;
  ms: number;
  finishReason: string | null;
  outputLength: number | null;
  truncated: boolean;
  textLength: number;
  parsed: boolean;
  error?: string;
}

export const SHORT_JSON_PASSES: StructuredPass[] = [
  { maxTokens: 1024, timeoutMs: 30_000, disableThinking: true },
  { maxTokens: 4096, timeoutMs: 90_000, disableThinking: false },
];

export const JUDGMENT_JSON_PASSES: StructuredPass[] = [
  { maxTokens: 2048, timeoutMs: 45_000, disableThinking: true },
  { maxTokens: 4096, timeoutMs: 90_000, disableThinking: false },
];

export async function completeStructured<T>(input: {
  chat: ChatCompleteFn;
  request: Omit<ChatCompleteOptions, 'maxTokens' | 'timeoutMs' | 'thinking' | 'signal'>;
  parse: (text: string) => T | null;
  passes?: StructuredPass[];
  signal?: AbortSignal;
  deadlineAt?: number;
  stage?: string;
  onAttempt?: (attempt: StructuredAttempt) => void;
}): Promise<{ value: T | null; attempts: number; lastError?: unknown }> {
  const passes = input.passes || SHORT_JSON_PASSES;
  let attempts = 0;
  let lastError: unknown;
  for (let i = 0; i < passes.length; i += 1) {
    const pass = passes[i]!;
    if (input.signal?.aborted || (input.deadlineAt !== undefined && Date.now() >= input.deadlineAt)) break;
    attempts += 1;
    const started = Date.now();
    const note: StructuredAttempt = {
      stage: input.stage || input.request.stage || 'structured', httpStatus: null, parseError: null, cancellation: null, failure: null,
      finishReason: null, outputLength: null,
      pass: i + 1,
      maxTokens: pass.maxTokens,
      disableThinking: pass.disableThinking,
      ms: 0,
      truncated: false,
      textLength: 0,
      parsed: false,
    };
    try {
      const result: ChatCompleteResult = await input.chat({
        ...input.request,
        maxTokens: pass.maxTokens,
        timeoutMs: Math.min(pass.timeoutMs, input.deadlineAt === undefined ? Infinity : input.deadlineAt - started),
        ...(input.deadlineAt !== undefined ? { deadlineAt: input.deadlineAt } : {}),
        stage: note.stage,
        ...(input.signal ? { signal: input.signal } : {}),
        ...(pass.disableThinking ? { thinking: { type: 'disabled' as const } } : {}),
      });
      note.truncated = !!result.truncated;
      note.textLength = (result.text || '').length;
      note.outputLength = note.textLength;
      note.httpStatus = result.diagnostic?.httpStatus ?? null;
      if (result.finishReason && /^[a-z_]{1,40}$/.test(result.finishReason)) note.finishReason = result.finishReason;
      // 被截断的半截 JSON 即使碰巧能解析，也不算完成。
      const expired = input.signal?.aborted || (input.deadlineAt !== undefined && Date.now() >= input.deadlineAt);
      note.cancellation = expired ? (input.signal?.reason === 'user' ? 'user' : input.signal?.reason === 'superseded' ? 'superseded' : input.signal?.aborted && input.signal.reason !== 'deadline' ? 'caller' : 'deadline') : null;
      note.failure = expired ? 'cancelled' : result.truncated ? 'truncated' : !(result.text || '').trim() ? 'empty' : null;
      let value: T | null = null;
      if (!expired && !result.truncated && (result.text || '').trim()) {
        try { value = input.parse(result.text); } catch { note.parseError = 'schema'; }
        if (value === null) note.parseError = 'schema';
      }
      if (note.parseError) note.failure = 'format';
      note.parsed = value !== null;
      note.ms = Date.now() - started;
      input.onAttempt?.(note);
      if (value !== null) return { value, attempts };
      if (expired || note.failure === 'truncated') break;
    } catch (err) {
      lastError = err;
      note.ms = Date.now() - started;
      const detail = (err as { diagnostic?: ModelCallDiagnostic }).diagnostic;
      note.httpStatus = detail?.httpStatus ?? null; note.parseError = detail?.parseError ?? null;
      note.outputLength = detail?.outputLength ?? null; note.finishReason = detail?.finishReason ?? null;
      note.cancellation = detail?.cancellation ?? (input.signal?.aborted ? (input.signal.reason === 'user' ? 'user' : input.signal.reason === 'superseded' ? 'superseded' : 'caller') : null);
      note.failure = detail?.failure ?? 'network';
      note.error = note.failure || 'unknown'; // Never log raw provider/error text.
      input.onAttempt?.(note);
      if (input.signal?.aborted || note.cancellation || ['network','http','empty','truncated'].includes(note.failure || '')) break;
    }
  }
  return { value: null, attempts, ...(lastError !== undefined ? { lastError } : {}) };
}
