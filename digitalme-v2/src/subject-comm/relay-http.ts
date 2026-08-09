/**
 * Relay HTTP — 每次请求独立连接，避免断网后全局 fetch/keep-alive 连接池僵死。
 * 不改变 Relay 协议；仅替换客户端传输实现。
 */
import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';

export interface RelayHttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** 默认 20s */
  timeoutMs?: number;
}

export interface RelayHttpResponse {
  status: number;
  text: string;
}

export type RelayHttpFn = (req: RelayHttpRequest) => Promise<RelayHttpResponse>;

function categorizeNetworkError(error: unknown): string {
  const err = error as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException };
  const code = String(err.code || err.cause?.code || '').toUpperCase();
  const message = `${err.message || ''} ${err.cause?.message || ''}`.toLowerCase();
  if (
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'EPIPE' ||
    code === 'ETIMEDOUT' ||
    code === 'UND_ERR_CONNECT_TIMEOUT' ||
    code === 'UND_ERR_SOCKET' ||
    code === 'UND_ERR_HEADERS_TIMEOUT' ||
    code === 'ABORT_ERR' ||
    /network|offline|socket|econnreset|enotfound|econnrefused|timed?\s*out|fetch failed/.test(
      message,
    )
  ) {
    return 'relay_unavailable';
  }
  return 'relay_unavailable';
}

export function relayNetworkError(error: unknown, label: string): Error {
  const err = new Error(`${label}:${(error as Error)?.message || String(error)}`);
  (err as Error & { category?: string }).category = categorizeNetworkError(error);
  (err as Error & { cause?: unknown }).cause = error;
  return err;
}

/**
 * 使用 node:http(s) 且 keepAlive=false：每次新建 TCP/TLS，网络恢复后无需重建 Runtime。
 * 不复用全局 fetch / undici Agent。
 */
export const defaultRelayHttp: RelayHttpFn = (req) =>
  new Promise<RelayHttpResponse>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    let url: URL;
    try {
      url = new URL(req.url);
    } catch (error) {
      finish(() => reject(relayNetworkError(error, 'relay_bad_url')));
      return;
    }

    const isHttps = url.protocol === 'https:';
    const lib = isHttps ? https : http;
    const timeoutMs = req.timeoutMs ?? 20_000;
    const headers: Record<string, string> = { ...(req.headers || {}) };
    if (req.body != null && headers['content-length'] == null) {
      headers['content-length'] = Buffer.byteLength(req.body, 'utf8').toString();
    }

    const request = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: req.method || 'GET',
        headers,
        // 关键：禁止 keep-alive 池，避免断网后僵尸 socket 被复用
        agent: false,
        timeout: timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.on('end', () => {
          finish(() =>
            resolve({
              status: response.statusCode || 0,
              text: Buffer.concat(chunks).toString('utf8'),
            }),
          );
        });
        response.on('error', (error) => {
          finish(() => reject(relayNetworkError(error, 'relay_response')));
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(relayNetworkError(new Error(`timeout after ${timeoutMs}ms`), 'relay_timeout'));
    });
    request.on('error', (error) => {
      finish(() => reject(relayNetworkError(error, 'relay_request')));
    });

    if (req.body != null) request.write(req.body, 'utf8');
    request.end();
  });
