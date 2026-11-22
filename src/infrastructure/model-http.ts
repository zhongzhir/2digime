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

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
}

export interface ChatCompleteOptions {
  /** Transient request metadata; never contains prompt/body/credentials. */
  deadlineAt?: number;
  stage?: string;
  baseUrl: string; // 例:https://api.example.com/v1
  apiKey?: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number; // 默认 120s
  signal?: AbortSignal;
  /** OpenAI-compatible response_format：json_object，或当前端点支持时的 json_schema。 */
  responseFormat?:
    | { type: 'json_object' }
    | {
        type: 'json_schema';
        json_schema: {
          name: string;
          strict?: boolean;
          schema: Record<string, unknown>;
        };
      };
  /** OpenAI-compatible tool calling. 工具是能力合同，不是任务类型枚举。 */
  tools?: ChatToolDefinition[];
  toolChoice?: 'auto' | 'none';
  /**
   * 短 JSON 判断不必先写长推理。当前端点接受 `{ type: 'disabled' }`。
   * 端点拒绝时由调用方再试一次不带该字段的请求。
   */
  thinking?: { type: 'disabled' };
}

export interface ChatCompleteResult {
  /** Provider transport metadata only; never includes reasoning or response bodies. */
  providerMeta?: { httpStatus: number; responseId?: string; model?: string; reasoningLength: number; reasoningTokens?: number };
  diagnostic?: ModelCallDiagnostic;
  text: string;
  toolCalls?: ChatToolCall[];
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  /** OpenAI-compatible finish_reason: stop | length | content_filter | ... */
  finishReason?: string;
  /** true when provider stopped due to token/length limit (or equivalent). */
  truncated?: boolean;
}

export interface ModelCallDiagnostic {
  stage: string;
  requestId?: string;
  httpStatus: number | null;
  finishReason: string | null;
  outputLength: number | null;
  parseError: 'json' | 'envelope' | 'schema' | null;
  cancellation: 'deadline' | 'user' | 'superseded' | 'caller' | null;
  failure: 'truncated' | 'empty' | 'format' | 'network' | 'cancelled' | 'timeout' | 'http' | null;
}

export function parseChatUsage(usage: unknown): { inputTokens: number; outputTokens: number; totalTokens: number } | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const row = usage as Record<string, unknown>;
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
  const input = num(row.prompt_tokens) ?? num(row.input_tokens) ?? num(row.inputTokens);
  const output = num(row.completion_tokens) ?? num(row.output_tokens) ?? num(row.outputTokens);
  const total = num(row.total_tokens) ?? num(row.totalTokens);
  if (input === undefined && output === undefined && total === undefined) return undefined;
  const inputTokens = input ?? 0;
  const outputTokens = output ?? 0;
  const totalTokens = total ?? inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

const DEFAULT_TIMEOUT_MS = 120_000;
/** 对话长文默认上限；调用方可覆盖。 */
export const DEFAULT_CHAT_MAX_TOKENS = 4096;

export async function chatComplete(options: ChatCompleteOptions): Promise<ChatCompleteResult> {
  const response = await requestCompletion(options, false);
  const body = JSON.parse(response.text) as {
    model?: string;
    id?: string;
    choices?: Array<{
      message?: {
        content?: string | null;
        reasoning_content?: string | null;
        tool_calls?: ChatToolCall[];
      };
      finish_reason?: string | null;
    }>;
    usage?: {
      total_tokens?: number;
      prompt_tokens?: number;
      completion_tokens?: number;
      completion_tokens_details?: { reasoning_tokens?: number };
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  const choice = body.choices?.[0];
  const message = choice?.message;
  const finishReason = typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined;
  // 用户面只取 final content；reasoning_content 一律不进入返回正文（即使 content 为空）。
  const content = message?.content;
  const contentText = typeof content === 'string' ? content : '';
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : undefined;
  const truncated = finishReason === 'length';
  const usage = parseChatUsage(body.usage);
  const reasoningTokens = body.usage?.completion_tokens_details?.reasoning_tokens;
  const providerMeta = { httpStatus: response.httpStatus, reasoningLength: typeof message?.reasoning_content === 'string' ? message.reasoning_content.length : 0,
    ...(typeof body.id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(body.id) ? { responseId: body.id } : {}),
    ...(typeof body.model === 'string' && /^[A-Za-z0-9._/-]{1,80}$/.test(body.model) ? { model: body.model } : {}),
    ...(typeof reasoningTokens === 'number' && Number.isFinite(reasoningTokens) ? { reasoningTokens } : {}) };
  if (contentText.trim().length === 0 && !(toolCalls && toolCalls.length > 0)) {
    // token 上限耗尽且无 final 正文：仍标 truncated，供上层显示「回复未完成」
    if (truncated) {
      return {
        text: '',
        finishReason,
        truncated: true,
        ...(usage ? { usage } : {}),
        providerMeta,
      };
    }
    throw new ModelHttpError(
      'bad_response',
      'response missing usable choices[0].message.content (reasoning discarded)',
    );
  }
  const result: ChatCompleteResult = {
    text: contentText,
    providerMeta,
    ...(toolCalls && toolCalls.length ? { toolCalls } : {}),
    ...(finishReason ? { finishReason } : {}),
    ...(truncated ? { truncated: true } : {}),
  };
  if (usage) result.usage = usage;
  return result;
}

/** 流式最小版:SSE 增量经 onDelta 上报,返回完整文本。忽略 reasoning 增量。 */
export async function chatCompleteStream(
  options: ChatCompleteOptions & { onDelta: (delta: string) => void },
): Promise<ChatCompleteResult> {
  const raw = await requestCompletion(options, true);
  let text = '';
  let finishReason: string | undefined;
  for (const line of raw.text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice('data:'.length).trim();
    if (payload === '[DONE]') break;
    try {
      const chunk = JSON.parse(payload) as {
        choices?: Array<{
          delta?: { content?: string; reasoning_content?: string };
          finish_reason?: string | null;
        }>;
      };
      const choice = chunk.choices?.[0];
      if (typeof choice?.finish_reason === 'string' && choice.finish_reason) {
        finishReason = choice.finish_reason;
      }
      // 只追加 final content delta；reasoning_content 丢弃
      const delta = choice?.delta?.content;
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
  const truncated = finishReason === 'length';
  return {
    text,
    ...(finishReason ? { finishReason } : {}),
    ...(truncated ? { truncated: true } : {}),
  };
}

async function requestCompletion(options: ChatCompleteOptions, stream: boolean): Promise<{ text: string; httpStatus: number }> {
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
    if (options.responseFormat) payload.response_format = options.responseFormat;
    if (options.tools && options.tools.length > 0) payload.tools = options.tools;
    if (options.toolChoice) payload.tool_choice = options.toolChoice;
    if (options.thinking) payload.thinking = options.thinking;

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
      return { text: await response.text(), httpStatus: response.status };
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
