/**
 * 极薄 HTTP 下载：跟随 redirect、校验 status、timeout、SHA256、失败清理。
 * 不理解任务，不绑定单一厂商。优先 Node/Electron 原生 fetch。
 */
import { createWriteStream, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

export type DownloadFailureKind = 'http_status' | 'timeout' | 'integrity' | 'response';

export class DownloadError extends Error {
  readonly failureKind: DownloadFailureKind;
  readonly safeDetail: string;
  readonly httpStatus?: number;
  constructor(kind: DownloadFailureKind, safeDetail: string, httpStatus?: number) {
    super(safeDetail);
    this.name = 'DownloadError';
    this.failureKind = kind;
    this.safeDetail = safeDetail;
    if (httpStatus !== undefined) this.httpStatus = httpStatus;
  }
}

export interface DownloadVerifiedInput {
  url: string;
  dest: string;
  expectedSha256: string;
  signal?: AbortSignal;
  /** 连上并对到响应头的上限。 */
  connectTimeoutMs?: number;
  /** 下载过程中无字节进度的上限。 */
  idleTimeoutMs?: number;
  userAgent?: string;
}

const DEFAULT_CONNECT_MS = 20_000;
const DEFAULT_IDLE_MS = 60_000;

function composeSignal(signals: AbortSignal[]): AbortSignal {
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === 'function') return anyFn(signals);
  const ac = new AbortController();
  const abort = () => ac.abort();
  for (const s of signals) {
    if (s.aborted) {
      ac.abort();
      break;
    }
    s.addEventListener('abort', abort, { once: true });
  }
  return ac.signal;
}

async function unlinkQuiet(file: string): Promise<void> {
  try {
    await fs.unlink(file);
  } catch {
    /* ignore */
  }
}

export async function downloadVerifiedFile(input: DownloadVerifiedInput): Promise<{ sha256: string; bytes: number }> {
  if (typeof fetch !== 'function') {
    throw new DownloadError('response', 'runtime_fetch_unavailable');
  }
  const dest = path.resolve(input.dest);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await unlinkQuiet(dest);

  const connectMs = input.connectTimeoutMs ?? DEFAULT_CONNECT_MS;
  const idleMs = input.idleTimeoutMs ?? DEFAULT_IDLE_MS;
  const connectAc = new AbortController();
  const connectTimer = setTimeout(() => connectAc.abort(), connectMs);
  const signals = [connectAc.signal];
  if (input.signal) signals.push(input.signal);
  const headerSignal = composeSignal(signals);

  let res: Response;
  try {
    res = await fetch(input.url, {
      redirect: 'follow',
      signal: headerSignal,
      headers: {
        'User-Agent': input.userAgent || '2digime',
        Accept: 'application/octet-stream',
      },
    });
  } catch (err) {
    clearTimeout(connectTimer);
    if (input.signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
      throw new DownloadError('timeout', 'connect_or_headers_timeout');
    }
    throw new DownloadError(
      'response',
      err instanceof Error ? err.message.slice(0, 240) : 'fetch_failed',
    );
  }
  clearTimeout(connectTimer);

  if (!res.ok) {
    throw new DownloadError('http_status', `http_${res.status}`, res.status);
  }
  if (!res.body) {
    throw new DownloadError('response', 'empty_body');
  }

  const hash = createHash('sha256');
  let bytes = 0;
  const idleAc = new AbortController();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const bumpIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => idleAc.abort(), idleMs);
  };
  bumpIdle();
  if (input.signal?.aborted) {
    throw new DownloadError('timeout', 'aborted');
  }
  const onUserAbort = () => idleAc.abort();
  input.signal?.addEventListener('abort', onUserAbort, { once: true });

  const nodeStream = Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream);
  nodeStream.on('data', (chunk: Buffer | string) => {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buf.length;
    hash.update(buf);
    bumpIdle();
  });

  const out = createWriteStream(dest);
  try {
    await Promise.race([
      pipeline(nodeStream, out),
      new Promise<never>((_, reject) => {
        idleAc.signal.addEventListener(
          'abort',
          () => reject(new DownloadError('timeout', 'idle_timeout')),
          { once: true },
        );
      }),
    ]);
  } catch (err) {
    nodeStream.destroy();
    out.destroy();
    await unlinkQuiet(dest);
    if (err instanceof DownloadError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new DownloadError('timeout', 'idle_timeout');
    }
    throw new DownloadError(
      'response',
      err instanceof Error ? err.message.slice(0, 240) : 'stream_failed',
    );
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    input.signal?.removeEventListener('abort', onUserAbort);
  }

  const sha256 = hash.digest('hex');
  const expected = input.expectedSha256.replace(/^sha256:/i, '').trim().toLowerCase();
  if (sha256 !== expected) {
    await unlinkQuiet(dest);
    throw new DownloadError('integrity', 'sha256_mismatch');
  }
  return { sha256, bytes };
}
