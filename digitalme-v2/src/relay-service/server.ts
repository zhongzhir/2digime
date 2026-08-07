/**
 * 最小 Relay Service — 加密邮局：路由 / 暂存 / ACK / 幂等 / TTL。
 * 不解释业务明文；不存 SubjectPackage。
 *
 * 用法: node dist/relay-service/server.js
 * 或:  node scripts/start-relay-service.cjs
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

export interface RelayStoredEnvelope {
  version: 1;
  envelopeId: string;
  fromEndpointId: string;
  toEndpointId: string;
  keyId: string;
  createdAt: string;
  expiresAt?: string;
  sealed: unknown;
  signatureB64: string;
  ackedAt?: string;
  storedAt: string;
}

export interface RelayStore {
  putIfAbsent(env: RelayStoredEnvelope): Promise<{ inserted: boolean }>;
  listForRecipient(toEndpointId: string, opts?: { includeAcked?: boolean }): Promise<RelayStoredEnvelope[]>;
  ack(toEndpointId: string, envelopeId: string): Promise<{ ok: boolean }>;
  purgeExpired(nowIso: string): Promise<number>;
}

function safeId(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 40);
}

/** 文件系统原子友好存储：每 envelope 一文件；envelopeId 唯一。 */
export class FileRelayStore implements RelayStore {
  constructor(private readonly dataDir: string) {}

  private fileFor(envelopeId: string): string {
    return path.join(this.dataDir, 'envelopes', `${safeId(envelopeId)}.json`);
  }

  async putIfAbsent(env: RelayStoredEnvelope): Promise<{ inserted: boolean }> {
    await fs.mkdir(path.join(this.dataDir, 'envelopes'), { recursive: true });
    const file = this.fileFor(env.envelopeId);
    try {
      await fs.access(file);
      return { inserted: false };
    } catch {
      /* create */
    }
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(env, null, 2)}\n`, 'utf8');
    try {
      await fs.rename(tmp, file);
      return { inserted: true };
    } catch {
      // 并发：已存在
      await fs.unlink(tmp).catch(() => undefined);
      return { inserted: false };
    }
  }

  async listForRecipient(
    toEndpointId: string,
    opts: { includeAcked?: boolean } = {},
  ): Promise<RelayStoredEnvelope[]> {
    const dir = path.join(this.dataDir, 'envelopes');
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      return [];
    }
    const out: RelayStoredEnvelope[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(dir, name), 'utf8');
        const env = JSON.parse(raw) as RelayStoredEnvelope;
        if (env.toEndpointId !== toEndpointId) continue;
        if (!opts.includeAcked && env.ackedAt) continue;
        out.push(env);
      } catch {
        /* skip corrupt */
      }
    }
    out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return out;
  }

  async ack(toEndpointId: string, envelopeId: string): Promise<{ ok: boolean }> {
    const file = this.fileFor(envelopeId);
    try {
      const raw = await fs.readFile(file, 'utf8');
      const env = JSON.parse(raw) as RelayStoredEnvelope;
      if (env.toEndpointId !== toEndpointId) return { ok: false };
      if (!env.ackedAt) {
        env.ackedAt = new Date().toISOString();
        const tmp = `${file}.${process.pid}.tmp`;
        await fs.writeFile(tmp, `${JSON.stringify(env, null, 2)}\n`, 'utf8');
        await fs.rename(tmp, file);
      }
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  async purgeExpired(nowIso: string): Promise<number> {
    const dir = path.join(this.dataDir, 'envelopes');
    let names: string[] = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      return 0;
    }
    let n = 0;
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(dir, name);
      try {
        const env = JSON.parse(await fs.readFile(file, 'utf8')) as RelayStoredEnvelope;
        if (env.expiresAt && env.expiresAt < nowIso) {
          await fs.unlink(file);
          n += 1;
        }
      } catch {
        /* ignore */
      }
    }
    return n;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(raw),
  });
  res.end(raw);
}

/** 安全日志：仅 envelopeId / opaque endpoint / state / 错误类别。 */
function logSafe(event: string, fields: Record<string, string | number | boolean | undefined>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), event, ...fields });
  console.log(line);
}

export function createRelayServer(options: {
  store: RelayStore;
  host?: string;
  port?: number;
  defaultTtlMs?: number;
}): { server: ReturnType<typeof createServer>; start: () => Promise<{ host: string; port: number }> } {
  const host = options.host || process.env.RELAY_HOST || '127.0.0.1';
  const port = options.port ?? Number(process.env.RELAY_PORT || 8787);
  const defaultTtlMs = options.defaultTtlMs ?? 7 * 24 * 3600 * 1000;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${host}:${port}`);
      if (req.method === 'GET' && url.pathname === '/health') {
        sendJson(res, 200, { ok: true, role: 'relay', plaintext: false });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/v1/envelopes') {
        const body = JSON.parse(await readBody(req)) as RelayStoredEnvelope;
        if (!body.envelopeId || !body.toEndpointId || !body.fromEndpointId || !body.sealed) {
          sendJson(res, 400, { ok: false, error: 'invalid_envelope' });
          return;
        }
        // 拒绝疑似明文业务字段
        const sealedStr = JSON.stringify(body.sealed);
        if (/\"intent\"|\"seeking\"|\"offering\"|\"events\"/.test(sealedStr) && !('ciphertextB64' in (body.sealed as object))) {
          sendJson(res, 400, { ok: false, error: 'plaintext_rejected' });
          return;
        }
        const storedAt = new Date().toISOString();
        const expiresAt =
          body.expiresAt || new Date(Date.now() + defaultTtlMs).toISOString();
        const { inserted } = await options.store.putIfAbsent({
          version: 1,
          envelopeId: body.envelopeId,
          fromEndpointId: body.fromEndpointId,
          toEndpointId: body.toEndpointId,
          keyId: body.keyId,
          createdAt: body.createdAt || storedAt,
          expiresAt,
          sealed: body.sealed,
          signatureB64: body.signatureB64,
          storedAt,
        });
        logSafe('envelope_submit', {
          envelopeId: body.envelopeId,
          from: body.fromEndpointId,
          to: body.toEndpointId,
          duplicate: !inserted,
        });
        sendJson(res, 200, {
          ok: true,
          duplicate: !inserted,
          state: inserted ? 'delivered-to-relay' : 'duplicate',
        });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/v1/envelopes') {
        const to = url.searchParams.get('to') || '';
        if (!to) {
          sendJson(res, 400, { ok: false, error: 'missing_to' });
          return;
        }
        await options.store.purgeExpired(new Date().toISOString());
        const items = await options.store.listForRecipient(to, { includeAcked: false });
        logSafe('envelope_fetch', { to, count: items.length });
        sendJson(res, 200, { items });
        return;
      }
      const ackMatch = url.pathname.match(/^\/v1\/envelopes\/([^/]+)\/ack$/);
      if (req.method === 'POST' && ackMatch) {
        const envelopeId = decodeURIComponent(ackMatch[1]!);
        const body = JSON.parse(await readBody(req) || '{}') as { endpointId?: string };
        if (!body.endpointId) {
          sendJson(res, 400, { ok: false, error: 'missing_endpointId' });
          return;
        }
        const r = await options.store.ack(body.endpointId, envelopeId);
        logSafe('envelope_ack', {
          envelopeId,
          to: body.endpointId,
          ok: r.ok,
        });
        sendJson(res, 200, r);
        return;
      }
      sendJson(res, 404, { ok: false, error: 'not_found' });
    } catch (err) {
      logSafe('relay_error', {
        category: 'handler_error',
        message: err instanceof Error ? err.message.slice(0, 80) : 'unknown',
      });
      sendJson(res, 500, { ok: false, error: 'internal' });
    }
  });

  return {
    server,
    start: () =>
      new Promise((resolve, reject) => {
        server.listen(port, host, () => resolve({ host, port }));
        server.on('error', reject);
      }),
  };
}

async function main(): Promise<void> {
  const dataDir =
    process.env.RELAY_DATA_DIR || path.join(process.cwd(), '.relay-data');
  await fs.mkdir(dataDir, { recursive: true });
  const store = new FileRelayStore(dataDir);
  const { start } = createRelayServer({ store });
  const addr = await start();
  logSafe('relay_listen', { host: addr.host, port: addr.port, dataDir });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ event: 'relay_fatal', category: 'startup' }));
    process.exit(1);
  });
}
