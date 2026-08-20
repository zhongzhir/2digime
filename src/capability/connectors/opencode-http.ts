/**
 * OpenCode HTTP connector — connector/adapter 层。
 * 只通过正在运行的 `opencode serve` OpenAPI 调用；禁止 spawn `opencode run`。
 * 上层仍消费 ExecutorTaskPackage / 产出 ExecutorRunResult，不另建 Job 真相源。
 * 内部模型 ID 不得进入 Agent identity 或用户面。
 */
import { promises as fs } from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import type { ExecutorRunResult, ExecutorTaskPackage } from '../../execution/external-executor-contract';

export interface OpenCodeHttpConnectorOptions {
  baseUrl: string;
  username?: string;
  password: string;
  /** 仅内部运行配置，例如 opencode-go/kimi-k2.7-code */
  internalModel: string;
  timeoutMs?: number;
}

export interface OpenCodeHttpRunInput {
  pkg: ExecutorTaskPackage;
  prompt: string;
  evidenceDir: string;
  signal: AbortSignal;
  reportProgress?: (note: string) => void;
}

export interface OpenCodeHttpPartialResult {
  exitCode: number | null;
  summary: string;
  claimedChangedFiles?: string[];
  sessionId?: string;
  assistantMessageId?: string;
  httpPathsUsed: string[];
  serverVersion?: string;
  authEnabled: true;
  opencodeRunInvoked: false;
  internalModel: { providerID: string; modelID: string };
}

export function parseInternalModelRef(raw: string): { providerID: string; modelID: string } {
  const text = String(raw || '').trim();
  const slash = text.indexOf('/');
  if (slash <= 0 || slash === text.length - 1) {
    throw new Error('内部模型配置无效');
  }
  return { providerID: text.slice(0, slash), modelID: text.slice(slash + 1) };
}

export function buildOpenCodePromptMessage(prompt: string, model: { providerID: string; modelID: string }) {
  return {
    model,
    parts: [{ type: 'text' as const, text: prompt }],
  };
}

function basicAuthHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
}

function joinUrl(baseUrl: string, pathname: string): URL {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(pathname.replace(/^\//, ''), base);
}

async function httpJson(input: {
  baseUrl: string;
  method: string;
  pathname: string;
  authHeader: string;
  body?: unknown;
  timeoutMs: number;
  signal?: AbortSignal;
  accept?: string;
}): Promise<{ status: number; text: string; json: unknown }> {
  const url = joinUrl(input.baseUrl, input.pathname);
  const payload = input.body === undefined ? null : Buffer.from(JSON.stringify(input.body));
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port ? Number(url.port) : 80,
        path: `${url.pathname}${url.search}`,
        method: input.method,
        headers: {
          Authorization: input.authHeader,
          Accept: input.accept || 'application/json',
          ...(payload
            ? { 'Content-Type': 'application/json', 'Content-Length': payload.length }
            : {}),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: unknown = null;
          if (text) {
            try {
              json = JSON.parse(text) as unknown;
            } catch {
              json = null;
            }
          }
          resolve({ status: res.statusCode || 0, text, json });
        });
      },
    );
    req.setTimeout(input.timeoutMs, () => {
      req.destroy(new Error('HTTP 调用超时'));
    });
    const onAbort = () => {
      req.destroy(new Error('aborted'));
    };
    if (input.signal) {
      if (input.signal.aborted) {
        onAbort();
        return;
      }
      input.signal.addEventListener('abort', onAbort, { once: true });
    }
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractPermissionAsk(payload: unknown): { sessionID: string; permissionID: string } | null {
  const root = asRecord(payload);
  if (!root) return null;
  const type = String(root.type || root.event || '');
  const props = asRecord(root.properties) || asRecord(root.data) || root;
  const sessionID = String(props.sessionID || props.sessionId || '');
  const permissionID = String(
    props.permissionID || props.permissionId || props.requestID || props.requestId || props.id || '',
  );
  if (!sessionID || !permissionID) return null;
  if (type && !/permission/i.test(type)) return null;
  if (!type && !props.permission && !props.permissionID && !props.requestID) return null;
  return { sessionID, permissionID };
}

function startPermissionAutoReply(input: {
  baseUrl: string;
  authHeader: string;
  sessionId: string;
  signal: AbortSignal;
  pathsUsed: string[];
}): { stop: () => void } {
  const url = joinUrl(input.baseUrl, '/event');
  let stopped = false;
  let req: http.ClientRequest | null = null;
  const replied = new Set<string>();

  const reply = (ask: { sessionID: string; permissionID: string }) => {
    if (ask.sessionID !== input.sessionId) return;
    if (replied.has(ask.permissionID)) return;
    replied.add(ask.permissionID);
    const pathname = `/session/${encodeURIComponent(ask.sessionID)}/permissions/${encodeURIComponent(ask.permissionID)}`;
    input.pathsUsed.push(`POST ${pathname}`);
    void httpJson({
      baseUrl: input.baseUrl,
      method: 'POST',
      pathname,
      authHeader: input.authHeader,
      body: { response: 'always' },
      timeoutMs: 15_000,
      signal: input.signal,
    }).catch(() => {
      const v2 = `/api/session/${encodeURIComponent(ask.sessionID)}/permission/${encodeURIComponent(ask.permissionID)}/reply`;
      input.pathsUsed.push(`POST ${v2}`);
      return httpJson({
        baseUrl: input.baseUrl,
        method: 'POST',
        pathname: v2,
        authHeader: input.authHeader,
        body: { reply: 'always' },
        timeoutMs: 15_000,
        signal: input.signal,
      }).catch(() => undefined);
    });
  };

  const connect = () => {
    if (stopped || input.signal.aborted) return;
    req = http.request(
      {
        hostname: url.hostname,
        port: url.port ? Number(url.port) : 80,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          Authorization: input.authHeader,
          Accept: 'text/event-stream',
        },
      },
      (res) => {
        input.pathsUsed.push('GET /event');
        let buf = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buf += chunk;
          const parts = buf.split(/\n\n/);
          buf = parts.pop() || '';
          for (const block of parts) {
            const dataLines = block
              .split(/\r?\n/)
              .filter((l) => l.startsWith('data:'))
              .map((l) => l.slice(5).trim())
              .join('');
            if (!dataLines) continue;
            try {
              const ask = extractPermissionAsk(JSON.parse(dataLines) as unknown);
              if (ask) reply(ask);
            } catch {
              /* ignore malformed SSE */
            }
          }
        });
      },
    );
    req.on('error', () => undefined);
    req.end();
  };

  connect();
  return {
    stop: () => {
      stopped = true;
      req?.destroy();
    },
  };
}

function textFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  const texts: string[] = [];
  for (const part of parts) {
    const rec = asRecord(part);
    if (!rec) continue;
    if (rec.type === 'text' && typeof rec.text === 'string') texts.push(rec.text);
  }
  return texts.join('\n').trim();
}

function summarizeAssistant(payload: unknown): { summary: string; messageId?: string; failed: boolean } {
  const rec = asRecord(payload);
  const info = rec ? asRecord(rec.info) || rec : null;
  const parts = rec?.parts;
  const summary = textFromParts(parts) || String(info?.error ? asRecord(info.error)?.message || '' : '');
  const failed = Boolean(info && (info.error || info.finish === 'error'));
  return {
    summary: summary.slice(0, 12000),
    ...(typeof info?.id === 'string' ? { messageId: info.id } : {}),
    failed,
  };
}

export async function probeOpenCodeHttpHealth(options: OpenCodeHttpConnectorOptions): Promise<{
  healthy: boolean;
  version?: string;
  authEnabled: true;
}> {
  const username = options.username || 'opencode';
  const authHeader = basicAuthHeader(username, options.password);
  const res = await httpJson({
    baseUrl: options.baseUrl,
    method: 'GET',
    pathname: '/global/health',
    authHeader,
    timeoutMs: 10_000,
  });
  const rec = asRecord(res.json);
  return {
    healthy: res.status === 200 && rec?.healthy === true,
    ...(typeof rec?.version === 'string' ? { version: rec.version } : {}),
    authEnabled: true,
  };
}

export async function fetchOpenCodeOpenApiPaths(options: OpenCodeHttpConnectorOptions): Promise<string[]> {
  const username = options.username || 'opencode';
  const authHeader = basicAuthHeader(username, options.password);
  const res = await httpJson({
    baseUrl: options.baseUrl,
    method: 'GET',
    pathname: '/doc',
    authHeader,
    timeoutMs: 20_000,
  });
  const rec = asRecord(res.json);
  const paths = rec ? asRecord(rec.paths) : null;
  return paths ? Object.keys(paths) : [];
}

export async function runOpenCodeHttpCoding(input: OpenCodeHttpRunInput, options: OpenCodeHttpConnectorOptions): Promise<OpenCodeHttpPartialResult> {
  const httpPathsUsed: string[] = [];
  const username = options.username || 'opencode';
  const authHeader = basicAuthHeader(username, options.password);
  const model = parseInternalModelRef(options.internalModel);
  const timeoutMs = options.timeoutMs ?? 600_000;

  httpPathsUsed.push('GET /global/health');
  const health = await probeOpenCodeHttpHealth(options);
  if (!health.healthy) {
    throw Object.assign(new Error('备用代码执行能力当前不可用。'), {
      stage: 'capability' as const,
      actionable: '备用代码执行能力当前不可用，任务未完成。',
    });
  }

  httpPathsUsed.push('POST /session');
  const created = await httpJson({
    baseUrl: options.baseUrl,
    method: 'POST',
    pathname: '/session',
    authHeader,
    body: { title: 'digitalme-coding' },
    timeoutMs: 30_000,
    signal: input.signal,
  });
  const session = asRecord(created.json);
  const sessionId = typeof session?.id === 'string' ? session.id : '';
  if (created.status >= 300 || !sessionId) {
    throw Object.assign(new Error('备用代码执行能力未能开始任务。'), {
      stage: 'capability' as const,
      actionable: '备用代码执行能力未能开始任务，任务未完成。',
    });
  }

  await fs.writeFile(
    path.join(input.evidenceDir, 'opencode-http-session.json'),
    `${JSON.stringify(
      {
        sessionId,
        directory: session?.directory,
    workingDirectory: input.pkg.workingDirectory,
        serverVersion: health.version || session?.version,
        internalModel: model,
        opencodeRunInvoked: false,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const events = startPermissionAutoReply({
    baseUrl: options.baseUrl,
    authHeader,
    sessionId,
    signal: input.signal,
    pathsUsed: httpPathsUsed,
  });
  await new Promise((r) => setTimeout(r, 400));

  try {
    input.reportProgress?.('正在修改项目文件');
    const messagePath = `/session/${encodeURIComponent(sessionId)}/message`;
    httpPathsUsed.push(`POST ${messagePath}`);
    const messageRes = await httpJson({
      baseUrl: options.baseUrl,
      method: 'POST',
      pathname: messagePath,
      authHeader,
      body: buildOpenCodePromptMessage(input.prompt, model),
      timeoutMs,
      signal: input.signal,
    });
    if (messageRes.status >= 300) {
      throw Object.assign(new Error('备用代码执行能力未能完成修改。'), {
        stage: 'capability' as const,
        actionable: '备用代码执行能力未能完成修改，任务未完成。',
      });
    }

    const parsed = summarizeAssistant(messageRes.json);
    httpPathsUsed.push(`GET /session/${sessionId}/message`);
    httpPathsUsed.push(`GET /session/${sessionId}/diff`);
    const diffRes = await httpJson({
      baseUrl: options.baseUrl,
      method: 'GET',
      pathname: `/session/${encodeURIComponent(sessionId)}/diff`,
      authHeader,
      timeoutMs: 30_000,
      signal: input.signal,
    });

    await fs.writeFile(
      path.join(input.evidenceDir, 'opencode-http-result.json'),
      `${JSON.stringify(
        {
          status: messageRes.status,
          summary: parsed.summary.slice(0, 4000),
          failed: parsed.failed,
          diff: diffRes.json,
          httpPathsUsed,
          opencodeRunInvoked: false,
        },
        null,
        2,
      )}\n`,
      'utf8',
    );

    const result: OpenCodeHttpPartialResult = {
      exitCode: parsed.failed ? 1 : 0,
      summary: parsed.summary || '已返回执行结果',
      sessionId,
      ...(parsed.messageId ? { assistantMessageId: parsed.messageId } : {}),
      httpPathsUsed: [...new Set(httpPathsUsed)],
      ...(health.version ? { serverVersion: health.version } : {}),
      authEnabled: true,
      opencodeRunInvoked: false,
      internalModel: model,
    };
    return result;
  } finally {
    events.stop();
  }
}

export function toExecutorPartial(result: OpenCodeHttpPartialResult): Pick<ExecutorRunResult, 'summary' | 'claimedChangedFiles' | 'exitCode' | 'status'> & {
  exitCode: number | null;
  summary: string;
} {
  return {
    summary: result.summary,
    claimedChangedFiles: result.claimedChangedFiles || [],
    exitCode: result.exitCode,
    status: result.exitCode === 0 ? 'succeeded' : 'failed',
  };
}
