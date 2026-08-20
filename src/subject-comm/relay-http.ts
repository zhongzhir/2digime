/**
 * Relay HTTP — Node/Electron 主进程真实连接实现。
 *
 * 明确不使用 global fetch / Undici dispatcher。
 * 每次请求：新建 http(s).Agent → 发完 destroy，避免断网后 keep-alive / TLS session 僵死。
 * Relay 主机解析优先 IPv4，降低 Windows 恢复网络后 IPv6 路由半残导致的长时间失败。
 */
import * as dns from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import { URL } from 'node:url';

export interface RelayHttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** 默认 15s */
  timeoutMs?: number;
}

export interface RelayHttpResponse {
  status: number;
  text: string;
}

export type RelayHttpFn = (req: RelayHttpRequest) => Promise<RelayHttpResponse>;

export interface RelayHttpErrorDiagnostics {
  category: string;
  phase: string;
  name: string;
  code: string;
  causeCode: string;
  message: string;
}

function asErr(error: unknown): NodeJS.ErrnoException & {
  cause?: NodeJS.ErrnoException;
  name?: string;
} {
  return error as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException; name?: string };
}

export function diagnoseRelayHttpError(
  error: unknown,
  phase: string,
): RelayHttpErrorDiagnostics {
  const err = asErr(error);
  const code = String(err.code || '').toUpperCase();
  const causeCode = String(err.cause?.code || '').toUpperCase();
  const message = `${err.message || ''} ${err.cause?.message || ''}`.trim();
  const combined = `${code} ${causeCode} ${message}`.toLowerCase();

  let category = 'relay_unavailable';
  if (/enotfound|eai_again|getaddrinfo|dns/.test(combined)) category = 'relay_dns';
  else if (/enetunreach|ehostunreach|enetdown|enetworkdown/.test(combined)) {
    category = 'relay_network_down';
  } else if (/econnrefused/.test(combined)) category = 'relay_refused';
  else if (/econnreset|epipe|und_err_socket/.test(combined)) category = 'relay_reset';
  else if (/timed?\s*out|etimedout|und_err_.*timeout|abort/.test(combined)) {
    category = 'relay_timeout';
  } else if (/cert|ssl|tls|unable to verify/.test(combined)) category = 'relay_tls';
  else if (/proxy/.test(combined)) category = 'relay_proxy';

  return {
    category,
    phase,
    name: String(err.name || 'Error'),
    code: code || 'NONE',
    causeCode: causeCode || 'NONE',
    message: message.slice(0, 240),
  };
}

export function relayNetworkError(error: unknown, phase: string): Error {
  const diag = diagnoseRelayHttpError(error, phase);
  const err = new Error(`${phase}:${diag.name}/${diag.code}:${diag.message}`);
  (err as Error & { category?: string }).category = diag.category;
  (err as Error & { cause?: unknown }).cause = error;
  (err as Error & { diagnostics?: RelayHttpErrorDiagnostics }).diagnostics = diag;
  return err;
}

/** 强制 A 记录优先，避免 Windows 断网恢复后 IPv6 半通拖死连接。 */
function relayLookup(
  hostname: string,
  options: dns.LookupOneOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string,
    family: number,
  ) => void,
): void {
  dns.lookup(hostname, { ...options, family: 4 }, (err, address, family) => {
    if (!err && address) {
      callback(null, address, family);
      return;
    }
    // IPv4 不可用时再回退默认解析
    dns.lookup(hostname, options, callback);
  });
}

function createRelayAgent(isHttps: boolean): http.Agent | https.Agent {
  const opts: http.AgentOptions = {
    keepAlive: false,
    maxSockets: 1,
    maxFreeSockets: 0,
    scheduling: 'lifo',
  };
  if (isHttps) {
    return new https.Agent({
      ...opts,
      // 禁止跨请求复用 TLS session ticket
      maxCachedSessions: 0,
    });
  }
  return new http.Agent(opts);
}

/**
 * Electron 主进程 / Node20 共用的真实 HTTP(S) 实现。
 * 不经过 global fetch。
 */
export const defaultRelayHttp: RelayHttpFn = (req) =>
  new Promise<RelayHttpResponse>((resolve, reject) => {
    let settled = false;
    let agent: http.Agent | https.Agent | null = null;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      try {
        agent?.destroy();
      } catch {
        /* ignore */
      }
      agent = null;
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
    const timeoutMs = req.timeoutMs ?? 15_000;
    const headers: Record<string, string> = {
      connection: 'close',
      ...(req.headers || {}),
    };
    if (req.body != null && headers['content-length'] == null) {
      headers['content-length'] = Buffer.byteLength(req.body, 'utf8').toString();
    }

    agent = createRelayAgent(isHttps);

    const request = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: req.method || 'GET',
        headers,
        agent,
        servername: isHttps ? url.hostname : undefined,
        lookup: relayLookup as unknown as http.RequestOptions['lookup'],
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

    request.setTimeout(timeoutMs, () => {
      request.destroy(
        relayNetworkError(new Error(`timeout after ${timeoutMs}ms`), 'relay_timeout'),
      );
    });
    request.on('error', (error) => {
      finish(() => reject(relayNetworkError(error, 'relay_request')));
    });

    if (req.body != null) request.write(req.body, 'utf8');
    request.end();
  });
