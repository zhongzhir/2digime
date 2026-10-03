/**
 * 发现里几处"让模型输出一段 JSON"的调用共用的升级策略。
 *
 * 不是第二套规划器：只处理机械事实——响应是否被截断、正文是否为空、JSON 是否解析得出。
 * 第 1 次：关闭隐藏推理，小预算，快。BYOK 端点会遵守；托管网关不转发该字段，等于普通请求。
 * 第 2 次：保留推理（复杂判断需要），预算和超时都放大。
 * 两次都没有可用结果，就如实返回 null，调用方负责说明"这次没有完成判断"，不用默认值冒充。
 */
import type { ChatCompleteOptions, ChatCompleteResult } from '../infrastructure/model-http';
import type { ChatCompleteFn } from '../subject-core/structured-distill';

export interface StructuredPass {
  maxTokens: number;
  timeoutMs: number;
  disableThinking: boolean;
}

export interface StructuredAttempt {
  pass: number;
  maxTokens: number;
  disableThinking: boolean;
  ms: number;
  finishReason?: string;
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
  onAttempt?: (attempt: StructuredAttempt) => void;
}): Promise<{ value: T | null; attempts: number; lastError?: unknown }> {
  const passes = input.passes || SHORT_JSON_PASSES;
  let attempts = 0;
  let lastError: unknown;
  for (let i = 0; i < passes.length; i += 1) {
    const pass = passes[i]!;
    if (input.signal?.aborted) break;
    attempts += 1;
    const started = Date.now();
    const note: StructuredAttempt = {
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
        timeoutMs: pass.timeoutMs,
        ...(input.signal ? { signal: input.signal } : {}),
        ...(pass.disableThinking ? { thinking: { type: 'disabled' as const } } : {}),
      });
      note.truncated = !!result.truncated;
      note.textLength = (result.text || '').length;
      if (result.finishReason) note.finishReason = result.finishReason;
      // 被截断的半截 JSON 即使碰巧能解析，也不算完成。
      const value = result.truncated ? null : input.parse(result.text || '');
      note.parsed = value !== null;
      note.ms = Date.now() - started;
      input.onAttempt?.(note);
      if (value !== null) return { value, attempts };
    } catch (err) {
      lastError = err;
      note.ms = Date.now() - started;
      note.error = err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120);
      input.onAttempt?.(note);
      if (input.signal?.aborted) break;
    }
  }
  return { value: null, attempts, ...(lastError !== undefined ? { lastError } : {}) };
}
