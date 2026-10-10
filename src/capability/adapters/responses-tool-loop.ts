import {
  ModelHttpError,
  type ChatMessage,
  type ChatToolDefinition,
} from '../../infrastructure/model-http';

export type UnifiedCapabilityStage =
  | 'request_started'
  | 'reasoning'
  | 'searching'
  | 'reading_source'
  | 'answering'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface UnifiedCapabilityEvent {
  stage: UnifiedCapabilityStage;
  elapsedMs: number;
  providerEventType?: string;
  toolType?: 'web_search' | 'web_extractor' | 'function';
}

export type SourceReadStatus = 'read' | 'snippet_only' | 'read_failed';

export interface UnifiedSourceEvidence {
  url: string;
  title?: string;
  discoveredBy: 'web_search' | 'model_output';
  readStatus: SourceReadStatus;
  readMethod?: string;
  readError?: string;
}

export interface ResponsesToolTrace {
  provider: 'responses';
  responseId?: string;
  status?: string;
  finishReason?: string;
  elapsedMs: number;
  firstToolCallMs?: number;
  firstOutputTextMs?: number;
  webSearchCalls: number;
  webExtractorCalls: number;
  functionCalls: number;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    estimatedCostCny: number;
  };
  sources: UnifiedSourceEvidence[];
}

export interface ResponsesTurnOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools?: ChatToolDefinition[];
  timeoutMs?: number;
  maxOutputTokens?: number;
  /** Digital Self interpretation uses the same transport without exposing web tools. */
  includeWebTools?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: UnifiedCapabilityEvent) => void;
}

export interface ResponsesTurnResult {
  text: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  status: 'complete' | 'incomplete';
  finishReason?: string;
  trace: ResponsesToolTrace;
}

const DEFAULT_TIMEOUT_MS = 240_000;
export const RESPONSES_MAX_OUTPUT_TOKENS = 8192;
export const RESPONSES_WEB_TOOLS: Array<Record<string, unknown>> = [
  { type: 'web_search' },
  { type: 'web_extractor' },
];

export function supportsResponsesToolLoop(config: { baseUrl: string; model: string }): boolean {
  try {
    const url = new URL(config.baseUrl);
    return url.protocol === 'https:' &&
      /\.cn-beijing\.maas\.aliyuncs\.com$/i.test(url.hostname) &&
      String(config.model || '').trim().length > 0;
  } catch {
    return false;
  }
}

export async function runResponsesTurn(options: ResponsesTurnOptions): Promise<ResponsesTurnResult> {
  const started = Date.now();
  const controller = new AbortController();
  const emit = (
    stage: UnifiedCapabilityStage,
    providerEventType?: string,
    toolType?: UnifiedCapabilityEvent['toolType'],
  ) => options.onEvent?.({
    stage,
    elapsedMs: Date.now() - started,
    ...(providerEventType ? { providerEventType } : {}),
    ...(toolType ? { toolType } : {}),
  });
  emit('request_started');
  const timeout = setTimeout(
    () => controller.abort(new ModelHttpError('timeout', 'Responses request timed out')),
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const onExternalAbort = () =>
    controller.abort(new ModelHttpError('aborted', 'Responses request aborted by caller'));
  if (options.signal) {
    if (options.signal.aborted) {
      clearTimeout(timeout);
      emit('cancelled');
      throw new ModelHttpError('aborted', 'Responses request aborted by caller');
    }
    options.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const { instructions, input } = responsesInput(options.messages);
  const responseTools = [
    ...(options.includeWebTools === false ? [] : RESPONSES_WEB_TOOLS),
    ...(options.tools || [])
      .filter((tool) => tool.function.name !== 'web_search' && tool.function.name !== 'news_search')
      .map((tool) => ({
        type: 'function',
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      })),
  ];
  const body: Record<string, unknown> = {
    model: options.model,
    input,
    store: false,
    reasoning: { effort: 'low' },
    enable_thinking: true,
    max_output_tokens: options.maxOutputTokens ?? RESPONSES_MAX_OUTPUT_TOKENS,
    stream: true,
  };
  if (responseTools.length) {
    body.tools = responseTools;
    body.tool_choice = 'auto';
  }
  if (instructions) body.instructions = instructions;

  try {
    const response = await fetch(options.baseUrl.replace(/\/+$/, '') + '/responses', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + options.apiKey,
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw classifyHttpStatus(response.status, await safeReadBody(response));
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let terminal: Record<string, unknown> | null = null;
    let firstToolCallMs: number | undefined;
    let firstOutputTextMs: number | undefined;
    let sawReasoning = false;
    let sawAnswering = false;
    const textDeltas: string[] = [];
    const acceptEvent = (event: ParsedSseEvent | null) => {
      if (!event || event.done) return;
      const type = event.type;
      const payload = event.payload;
      if (type.includes('reasoning') && !sawReasoning) {
        sawReasoning = true;
        emit('reasoning', type);
      }
      if (type === 'response.output_text.delta') {
        if (firstOutputTextMs === undefined) firstOutputTextMs = Date.now() - started;
        if (!sawAnswering) {
          sawAnswering = true;
          emit('answering', type);
        }
        if (typeof payload.delta === 'string') textDeltas.push(payload.delta);
      }
      const item = asRecord(payload.item);
      const itemType = String(item.type || '');
      const isSearch = type.includes('web_search_call') || itemType === 'web_search_call';
      const isRead = type.includes('web_extractor') || itemType === 'web_extractor_call' || isPageReadItem(item);
      const isFunction = type.includes('function_call') || itemType === 'function_call';
      if ((isSearch || isRead || isFunction) && firstToolCallMs === undefined) {
        firstToolCallMs = Date.now() - started;
      }
      if (isSearch && /searching|in_progress|added/.test(type)) emit('searching', type, 'web_search');
      if (isRead && /in_progress|added|done/.test(type)) emit('reading_source', type, 'web_extractor');
      if (isFunction && /in_progress|added/.test(type)) emit('reasoning', type, 'function');
      if (type === 'response.completed' || type === 'response.incomplete' || type === 'response.failed') {
        terminal = Object.keys(asRecord(payload.response)).length ? asRecord(payload.response) : payload;
      }
      if (type === 'error') terminal = payload;
    };

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      let boundary = findSseBoundary(buffer);
      while (boundary) {
        acceptEvent(parseSseBlock(buffer.slice(0, boundary.index)));
        buffer = buffer.slice(boundary.index + boundary.length);
        boundary = findSseBoundary(buffer);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) acceptEvent(parseSseBlock(buffer));

    const finalResponse = terminal as Record<string, any> | null;
    if (!finalResponse) throw new ModelHttpError('bad_response', 'Responses stream has no terminal event');
    if (finalResponse.status === 'failed' || finalResponse.type === 'error') {
      const error = asRecord(finalResponse.error);
      const code = String(error.code || 'response_failed').slice(0, 80);
      throw new ModelHttpError('server_error', 'Responses failed: ' + code);
    }
    const output = Array.isArray(finalResponse.output) ? finalResponse.output : [];
    const text = responseText(output) || textDeltas.join('');
    const toolCalls = responseFunctionCalls(output);
    const finishReason = String(asRecord(finalResponse.incomplete_details).reason || '');
    const incomplete = finalResponse.status === 'incomplete' || !!finishReason;
    if (!text.trim() && !toolCalls.length && !incomplete) {
      throw new ModelHttpError('bad_response', 'Responses stream has no final text or function call');
    }
    const trace = buildTrace(finalResponse, output, Date.now() - started, {
      ...(firstToolCallMs !== undefined ? { firstToolCallMs } : {}),
      ...(firstOutputTextMs !== undefined ? { firstOutputTextMs } : {}),
      ...(finishReason ? { finishReason } : {}),
    });
    emit('completed');
    return {
      text: text.trim(),
      ...(toolCalls.length ? { toolCalls } : {}),
      status: incomplete ? 'incomplete' : 'complete',
      ...(finishReason ? { finishReason } : {}),
      trace,
    };
  } catch (error) {
    const mapped = classifyFetchFailure(error, controller.signal);
    (mapped as ModelHttpError & { noRetry?: boolean }).noRetry = true;
    emit(mapped.kind === 'aborted' ? 'cancelled' : 'failed');
    throw mapped;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}

function responsesInput(messages: ChatMessage[]): { instructions: string; input: unknown[] } {
  const instructions = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .filter(Boolean)
    .join('\n\n');
  const input: unknown[] = [];
  for (const message of messages) {
    if (message.role === 'system') continue;
    if (message.role === 'assistant' && message.tool_calls?.length) {
      if (message.content) {
        input.push({ role: 'assistant', content: [{ type: 'output_text', text: message.content }] });
      }
      for (const call of message.tool_calls) {
        input.push({
          type: 'function_call',
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        });
      }
      continue;
    }
    if (message.role === 'tool') {
      input.push({ type: 'function_call_output', call_id: message.tool_call_id || '', output: message.content });
      continue;
    }
    input.push({
      role: message.role,
      content: [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: message.content }],
    });
  }
  return { instructions, input };
}

interface ParsedSseEvent {
  type: string;
  payload: Record<string, any>;
  done?: boolean;
}

function parseSseBlock(block: string): ParsedSseEvent | null {
  let namedEvent = '';
  const data: string[] = [];
  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.startsWith('event:')) namedEvent = line.slice(6).trim();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  const raw = data.join('\n');
  if (!raw || raw === '[DONE]') return { type: namedEvent || 'done', payload: {}, done: true };
  try {
    const payload = asRecord(JSON.parse(raw));
    return { type: String(payload.type || namedEvent || 'unknown'), payload };
  } catch {
    throw new ModelHttpError('bad_response', 'Invalid Responses SSE event');
  }
}

function findSseBoundary(buffer: string): { index: number; length: number } | null {
  const match = /\r?\n\r?\n/.exec(buffer);
  return match ? { index: match.index, length: match[0].length } : null;
}

function responseText(output: unknown[]): string {
  const parts: string[] = [];
  for (const raw of output) {
    const item = asRecord(raw);
    if (item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const rawPart of item.content) {
      const part = asRecord(rawPart);
      if (part.type === 'output_text' && typeof part.text === 'string') parts.push(part.text);
    }
  }
  return parts.join('\n');
}

function responseFunctionCalls(output: unknown[]): Array<{ id: string; name: string; arguments: string }> {
  return output.map(asRecord).filter((item) => item.type === 'function_call').map((item) => ({
    id: String(item.call_id || item.id || ''),
    name: String(item.name || ''),
    arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments || {}),
  })).filter((call) => call.id && call.name);
}

function buildTrace(
  response: Record<string, any>,
  output: unknown[],
  elapsedMs: number,
  timing: { firstToolCallMs?: number; firstOutputTextMs?: number; finishReason?: string },
): ResponsesToolTrace {
  const items = output.map(asRecord);
  const searchItems = items.filter((item) => item.type === 'web_search_call');
  const readItems = items.filter(isPageReadItem);
  const functionItems = items.filter((item) => item.type === 'function_call');
  const usageRaw = asRecord(response.usage);
  const inputTokens = numberOrZero(usageRaw.input_tokens);
  const outputTokens = numberOrZero(usageRaw.output_tokens);
  const reasoningTokens = numberOrZero(asRecord(usageRaw.output_tokens_details).reasoning_tokens);
  const xTools = asRecord(usageRaw.x_tools);
  const webSearchCalls = numberOrFallback(asRecord(xTools.web_search).count, searchItems.length);
  const webExtractorCalls = numberOrFallback(
    asRecord(xTools.web_extractor).count,
    readItems.filter((item) => item.type === 'web_extractor_call').length,
  );
  return {
    provider: 'responses',
    ...(typeof response.id === 'string' ? { responseId: response.id } : {}),
    ...(typeof response.status === 'string' ? { status: response.status } : {}),
    ...(timing.finishReason ? { finishReason: timing.finishReason } : {}),
    elapsedMs,
    ...(timing.firstToolCallMs !== undefined ? { firstToolCallMs: timing.firstToolCallMs } : {}),
    ...(timing.firstOutputTextMs !== undefined ? { firstOutputTextMs: timing.firstOutputTextMs } : {}),
    webSearchCalls,
    webExtractorCalls,
    functionCalls: functionItems.length,
    usage: {
      inputTokens,
      outputTokens,
      reasoningTokens,
      totalTokens: inputTokens + outputTokens,
      estimatedCostCny: (inputTokens * 0.8 + outputTokens * 2.7) / 1_000_000 + webSearchCalls * 0.004,
    },
    sources: normalizeSources(searchItems, readItems, responseText(output)),
  };
}

function isPageReadItem(item: Record<string, any>): boolean {
  return item.type === 'web_extractor_call' ||
    (Array.isArray(item.urls) && (item.status === 'completed' || item.status === 'failed') &&
      ('output' in item || 'error' in item));
}

function normalizeSources(
  searchItems: Record<string, any>[],
  readItems: Record<string, any>[],
  text: string,
): UnifiedSourceEvidence[] {
  const byUrl = new Map<string, UnifiedSourceEvidence>();
  for (const item of searchItems) {
    const sources = asRecord(item.action).sources;
    if (!Array.isArray(sources)) continue;
    for (const raw of sources) {
      const source = asRecord(raw);
      const url = safeHttpUrl(source.url);
      if (!url) continue;
      byUrl.set(url, {
        url,
        ...(typeof source.title === 'string' && source.title.trim() ? { title: source.title.trim() } : {}),
        discoveredBy: 'web_search',
        readStatus: 'snippet_only',
      });
    }
  }
  for (const item of readItems) {
    const rawUrls = Array.isArray(item.urls) ? item.urls : [];
    const output = typeof item.output === 'string' ? item.output.trim() : '';
    for (const raw of rawUrls) {
      const url = safeHttpUrl(raw);
      if (!url) continue;
      const previous = byUrl.get(url);
      const read = item.status === 'completed' && output.length > 0 && (
        rawUrls.length === 1 || output.includes(String(raw)) || output.includes(url)
      );
      const readStatus: SourceReadStatus = read
        ? 'read'
        : previous?.readStatus === 'snippet_only' && item.status === 'completed'
          ? 'snippet_only'
          : 'read_failed';
      const readError = !read
        ? typeof item.error === 'string'
          ? item.error.slice(0, 300)
          : item.status === 'completed'
            ? 'provider extractor output did not identify this URL'
            : 'provider extractor did not complete'
        : '';
      byUrl.set(url, {
        url,
        ...(previous?.title ? { title: previous.title } : {}),
        discoveredBy: previous?.discoveredBy ?? 'model_output',
        readStatus,
        readMethod: String(item.type || 'provider_page_read'),
        ...(readError ? { readError } : {}),
      });
    }
  }
  const links = /\[([^\]]{1,300})\]\((https?:\/\/[^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = links.exec(text))) {
    const url = safeHttpUrl(match[2]);
    if (!url) continue;
    const previous = byUrl.get(url);
    byUrl.set(url, {
      url,
      title: String(match[1] || '').trim(),
      discoveredBy: previous?.discoveredBy ?? 'model_output',
      readStatus: previous?.readStatus ?? 'snippet_only',
      ...(previous?.readMethod ? { readMethod: previous.readMethod } : {}),
      ...(previous?.readError ? { readError: previous.readError } : {}),
    });
  }
  return [...byUrl.values()];
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? value as Record<string, any> : {};
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function numberOrFallback(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function classifyHttpStatus(status: number, detail: string): ModelHttpError {
  const suffix = detail ? ': ' + detail : '';
  if (status === 401 || status === 403) return new ModelHttpError('unauthorized', 'Responses authentication failed (' + status + ')' + suffix, status);
  if (status === 429) return new ModelHttpError('rate_limited', 'Responses rate limited (429)' + suffix, status);
  if (status >= 500) return new ModelHttpError('server_error', 'Responses provider error (' + status + ')' + suffix, status);
  return new ModelHttpError('bad_request', 'Responses request rejected (' + status + ')' + suffix, status);
}

function classifyFetchFailure(error: unknown, signal: AbortSignal): ModelHttpError {
  if (error instanceof ModelHttpError) return error;
  if (signal.aborted) {
    return signal.reason instanceof ModelHttpError
      ? signal.reason
      : new ModelHttpError('aborted', 'Responses request aborted');
  }
  return new ModelHttpError('network', 'Responses network failure: ' + (error as Error).message);
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '';
  }
}
