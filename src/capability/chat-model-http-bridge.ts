/**
 * 把兔机米已经连接的 ChatCompleteFn 临时投影成仅回环可访问的
 * OpenAI-compatible /chat/completions 与 /responses 端点，供本次获取的成熟 Agent 使用。
 *
 * 不落盘模型凭证，不把管理网关协议暴露给第三方 runtime；进程结束即关闭。
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { ChatCompleteFn } from '../subject-core/structured-distill';
import type {
  ChatMessage,
  ChatToolCall,
  ChatToolDefinition,
} from '../infrastructure/model-http';

export interface LocalChatModelBridge {
  baseUrl: string;
  apiKey: string;
  close(): Promise<void>;
}

function textContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((part) => {
      if (!part || typeof part !== 'object') return '';
      const row = part as { type?: string; text?: string; content?: string };
      return typeof row.text === 'string'
        ? row.text
        : typeof row.content === 'string'
          ? row.content
          : '';
    })
    .filter(Boolean)
    .join('\n');
}

function normalizeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  const out: ChatMessage[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as {
      role?: string;
      content?: unknown;
      tool_call_id?: string;
      tool_calls?: ChatToolCall[];
    };
    if (!['system', 'user', 'assistant', 'tool'].includes(String(row.role || ''))) continue;
    out.push({
      role: row.role as ChatMessage['role'],
      content: textContent(row.content),
      ...(row.tool_call_id ? { tool_call_id: String(row.tool_call_id) } : {}),
      ...(Array.isArray(row.tool_calls) ? { tool_calls: row.tool_calls } : {}),
    });
  }
  return out;
}

function normalizeTools(value: unknown): ChatToolDefinition[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tools = value.filter((item): item is ChatToolDefinition => {
    if (!item || typeof item !== 'object') return false;
    const row = item as Partial<ChatToolDefinition>;
    return row.type === 'function' && Boolean(row.function?.name) && Boolean(row.function?.parameters);
  });
  return tools.length ? tools : undefined;
}

function normalizeResponsesTools(value: unknown): ChatToolDefinition[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tools: ChatToolDefinition[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (row.type !== 'function' || typeof row.name !== 'string' || !row.name.trim()) continue;
    tools.push({
      type: 'function',
      function: {
        name: row.name,
        description: typeof row.description === 'string' ? row.description : '',
        parameters: row.parameters && typeof row.parameters === 'object' && !Array.isArray(row.parameters)
          ? row.parameters as Record<string, unknown>
          : { type: 'object', properties: {} },
      },
    });
  }
  return tools.length ? tools : undefined;
}

function normalizeResponsesInput(body: Record<string, unknown>): ChatMessage[] {
  const out: ChatMessage[] = [];
  if (typeof body.instructions === 'string' && body.instructions.trim()) {
    out.push({ role: 'system', content: body.instructions });
  }
  const rows = typeof body.input === 'string' ? [{ role: 'user', content: body.input }] : body.input;
  if (!Array.isArray(rows)) return out;
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (row.type === 'function_call' && typeof row.name === 'string') {
      out.push({
        role: 'assistant',
        content: '',
        tool_calls: [{
          id: String(row.call_id || row.id || ''),
          type: 'function',
          function: {
            name: row.name,
            arguments: typeof row.arguments === 'string' ? row.arguments : JSON.stringify(row.arguments || {}),
          },
        }],
      });
      continue;
    }
    if (row.type === 'function_call_output') {
      out.push({ role: 'tool', content: textContent(row.output), tool_call_id: String(row.call_id || '') });
      continue;
    }
    const role = String(row.role || '');
    if (!['user', 'assistant', 'developer', 'system'].includes(role)) continue;
    out.push({
      role: role === 'developer' || role === 'system' ? 'system' : role as 'user' | 'assistant',
      content: textContent(row.content),
    });
  }
  return out;
}

async function readJson(req: IncomingMessage, limit = 8 * 1024 * 1024): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > limit) throw new Error('payload_too_large');
    chunks.push(buf);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_payload');
  return parsed as Record<string, unknown>;
}

function completionEnvelope(input: {
  id: string;
  model: string;
  text: string;
  toolCalls?: ChatToolCall[];
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}) {
  return {
    id: input.id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: input.model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: input.text || null,
        ...(input.toolCalls?.length ? { tool_calls: input.toolCalls } : {}),
      },
      finish_reason: input.toolCalls?.length ? 'tool_calls' : 'stop',
    }],
    ...(input.usage
      ? {
          usage: {
            prompt_tokens: input.usage.inputTokens,
            completion_tokens: input.usage.outputTokens,
            total_tokens: input.usage.totalTokens,
          },
        }
      : {}),
  };
}

function writeSse(
  res: ServerResponse,
  input: { id: string; model: string; text: string; toolCalls?: ChatToolCall[] },
): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const base = {
    id: input.id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: input.model,
  };
  const send = (row: Record<string, unknown>) => res.write(`data: ${JSON.stringify(row)}\n\n`);
  send({ ...base, choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] });
  if (input.text) {
    send({ ...base, choices: [{ index: 0, delta: { content: input.text }, finish_reason: null }] });
  }
  for (const [index, call] of (input.toolCalls || []).entries()) {
    send({
      ...base,
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index,
            id: call.id,
            type: 'function',
            function: call.function,
          }],
        },
        finish_reason: null,
      }],
    });
  }
  send({
    ...base,
    choices: [{
      index: 0,
      delta: {},
      finish_reason: input.toolCalls?.length ? 'tool_calls' : 'stop',
    }],
  });
  res.end('data: [DONE]\n\n');
}

function responsesEnvelope(input: {
  id: string;
  model: string;
  text: string;
  toolCalls?: ChatToolCall[];
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}) {
  const output: Record<string, unknown>[] = [];
  if (input.text) {
    output.push({
      id: `msg_${randomUUID().replace(/-/g, '')}`,
      type: 'message',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: input.text, annotations: [] }],
    });
  }
  for (const call of input.toolCalls || []) {
    output.push({
      id: `fc_${randomUUID().replace(/-/g, '')}`,
      type: 'function_call',
      status: 'completed',
      call_id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
    });
  }
  return {
    id: input.id,
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model: input.model,
    output,
    parallel_tool_calls: true,
    ...(input.usage
      ? {
          usage: {
            input_tokens: input.usage.inputTokens,
            output_tokens: input.usage.outputTokens,
            total_tokens: input.usage.totalTokens,
          },
        }
      : {}),
  };
}

function writeResponsesSse(res: ServerResponse, response: ReturnType<typeof responsesEnvelope>): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  const emit = (row: Record<string, unknown>) => res.write(`data: ${JSON.stringify(row)}\n\n`);
  emit({ type: 'response.created', response: { ...response, status: 'in_progress', output: [] } });
  for (const [output_index, item] of response.output.entries()) {
    emit({ type: 'response.output_item.added', output_index, item });
    emit({ type: 'response.output_item.done', output_index, item });
  }
  emit({ type: 'response.completed', response });
  res.end();
}

export async function startLocalChatModelBridge(input: {
  complete: ChatCompleteFn;
  model: string;
  signal?: AbortSignal;
}): Promise<LocalChatModelBridge> {
  const apiKey = randomBytes(24).toString('base64url');
  const server = createServer(async (req, res) => {
    const pathname = (() => {
      try {
        return new URL(req.url || '/', 'http://127.0.0.1').pathname;
      } catch {
        return '';
      }
    })();
    const chatRequest = pathname === '/v1/chat/completions';
    const responsesRequest = pathname === '/v1/responses';
    if (req.method !== 'POST' || (!chatRequest && !responsesRequest)) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'not_found' } }));
      return;
    }
    if (req.headers.authorization !== `Bearer ${apiKey}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'unauthorized' } }));
      return;
    }
    const ac = new AbortController();
    const abort = () => ac.abort('client_closed');
    req.once('aborted', abort);
    try {
      const body = await readJson(req);
      const messages = responsesRequest ? normalizeResponsesInput(body) : normalizeMessages(body.messages);
      if (!messages.length) throw new Error('messages_required');
      const model = String(body.model || input.model).trim() || input.model;
      const tools = responsesRequest ? normalizeResponsesTools(body.tools) : normalizeTools(body.tools);
      const result = await input.complete({
        baseUrl: 'http://127.0.0.1',
        model,
        messages,
        ...(typeof body.temperature === 'number' ? { temperature: body.temperature } : {}),
        ...(typeof body.max_tokens === 'number'
          ? { maxTokens: body.max_tokens }
          : typeof body.max_completion_tokens === 'number'
            ? { maxTokens: body.max_completion_tokens }
            : {}),
        ...(tools ? { tools } : {}),
        ...(body.tool_choice === 'none' ? { toolChoice: 'none' as const } : tools ? { toolChoice: 'auto' as const } : {}),
        signal: ac.signal,
        stage: 'acquired-coding-runtime',
      });
      const id = `${responsesRequest ? 'resp' : 'chatcmpl'}_${randomUUID().replace(/-/g, '')}`;
      const completeUsage =
        result.usage &&
        typeof result.usage.inputTokens === 'number' &&
        typeof result.usage.outputTokens === 'number' &&
        typeof result.usage.totalTokens === 'number'
          ? {
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
              totalTokens: result.usage.totalTokens,
            }
          : undefined;
      const payload = {
        id,
        model,
        text: String(result.text || ''),
        ...(result.toolCalls?.length ? { toolCalls: result.toolCalls } : {}),
        ...(completeUsage ? { usage: completeUsage } : {}),
      };
      if (responsesRequest) {
        const response = responsesEnvelope(payload);
        if (body.stream === true) writeResponsesSse(res, response);
        else {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(response));
        }
      } else if (body.stream === true) writeSse(res, payload);
      else {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(completionEnvelope(payload)));
      }
    } catch (err) {
      if (res.headersSent) {
        res.end();
      } else {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: err instanceof Error ? err.message : 'bridge_failed' } }));
      }
    } finally {
      req.removeListener('aborted', abort);
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('local_bridge_port_unavailable');
  }
  const close = () => new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  if (input.signal) {
    if (input.signal.aborted) await close();
    else input.signal.addEventListener('abort', () => void close(), { once: true });
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    apiKey,
    close,
  };
}
