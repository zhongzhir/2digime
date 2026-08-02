/**
 * Model HTTP(P1.1 §4):OpenAI-compatible /chat/completions 最小实现。
 * - 纯 HTTP 原语:不含任务状态逻辑,不读写 Store;
 * - provider 细节(baseUrl、密钥)由 model Adapter 注入,本模块不做路由;
 * - timeout / abort / 401 / 429 / 5xx 明确分类。
 */
export type ModelHttpErrorKind =
  | 'unauthorized' // 401 / 403
  | 'rate_limited' // 429
  | 'server_error' // 5xx
  | 'bad_request' // 其余 4xx
  | 'timeout' // 本模块超时
  | 'aborted' // 调用方 AbortSignal
  | 'network' // DNS / 连接失败
  | 'bad_response'; // 2xx 但响应体不符合契约

export class ModelHttpError extends Error {
  readonly kind: ModelHttpErrorKind;
  readonly status: number | undefined;

  constructor(kind: ModelHttpErrorKind, message: string, status?: number) {
    super(message);
    this.name = 'ModelHttpError';
    this.kind = kind;
    this.status = status;
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompleteOptions {
  baseUrl: string; // 例:https://api.example.com/v1
  apiKey?: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number; // 默认 120s
  signal?: AbortSignal;
}

export interface ChatCompleteResult {
  text: string;
  usage?: { totalTokens?: number };
}

const DEFAULT_TIMEOUT_MS = 120_000;

export async function chatComplete(options: ChatCompleteOptions): Promise<ChatCompleteResult> {
  const body = JSON.parse(await requestCompletion(options, false)) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { total_tokens?: number };
  };
  const text = body.choices?.[0]?.message?.content;
  if (typeof text !== 'string') {
    throw new ModelHttpError('bad_response', 'response missing choices[0].message.content');
  }
  const result: ChatCompleteResult = { text };
  if (typeof body.usage?.total_tokens === 'number') {
    result.usage = { totalTokens: body.usage.total_tokens };
  }
  return result;
}

/** 流式最小版:SSE 增量经 onDelta 上报,返回完整文本。 */
export async function chatCompleteStream(
  options: ChatCompleteOptions & { onDelta: (delta: string) => void },
): Promise<ChatCompleteResult> {
  const raw = await requestCompletion(options, true);
  let text = '';
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice('data:'.length).trim();
    if (payload === '[DONE]') break;
    try {
      const chunk = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
      const delta = chunk.choices?.[0]?.delta?.content;
      if (typeof delta === 'string' && delta.length > 0) {
        text += delta;
        options.onDelta(delta);
      }
    } catch {
      throw new ModelHttpError('bad_response', 'invalid SSE chunk');
    }
  }
  if (text.length === 0) {
    throw new ModelHttpError('bad_response', 'stream produced no content');
  }
  return { text };
}

async function requestCompletion(options: ChatCompleteOptions, stream: boolean): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new ModelHttpError('timeout', `timeout after ${timeoutMs}ms`)), timeoutMs);
  const onExternalAbort = () =>
    controller.abort(new ModelHttpError('aborted', 'request aborted by caller'));
  if (options.signal) {
    if (options.signal.aborted) {
      clearTimeout(timeout);
      throw new ModelHttpError('aborted', 'request aborted by caller');
    }
    options.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const url = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`;
    const payload: Record<string, unknown> = {
      model: options.model,
      messages: options.messages,
      stream,
    };
    if (options.temperature !== undefined) payload.temperature = options.temperature;
    if (options.maxTokens !== undefined) payload.max_tokens = options.maxTokens;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      throw classifyFetchFailure(error, controller.signal);
    }
    if (!response.ok) {
      throw classifyHttpStatus(response.status, await safeReadBody(response));
    }
    try {
      return await response.text();
    } catch (error) {
      throw classifyFetchFailure(error, controller.signal);
    }
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}

function classifyHttpStatus(status: number, bodySnippet: string): ModelHttpError {
  const detail = bodySnippet ? `: ${bodySnippet}` : '';
  if (status === 401 || status === 403) {
    return new ModelHttpError('unauthorized', `authentication failed (${status})${detail}`, status);
  }
  if (status === 429) {
    return new ModelHttpError('rate_limited', `rate limited (429)${detail}`, status);
  }
  if (status >= 500) {
    return new ModelHttpError('server_error', `provider server error (${status})${detail}`, status);
  }
  return new ModelHttpError('bad_request', `request rejected (${status})${detail}`, status);
}

function classifyFetchFailure(error: unknown, signal: AbortSignal): ModelHttpError {
  if (error instanceof ModelHttpError) return error;
  if (signal.aborted) {
    const reason = signal.reason;
    if (reason instanceof ModelHttpError) return reason;
    return new ModelHttpError('aborted', 'request aborted');
  }
  return new ModelHttpError('network', `network failure: ${(error as Error).message}`);
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 200);
  } catch {
    return '';
  }
}
