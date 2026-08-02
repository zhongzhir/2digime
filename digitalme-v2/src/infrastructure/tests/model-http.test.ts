import test from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { ModelHttpError, chatComplete, chatCompleteStream } from '../model-http';

let server: http.Server;
let baseOrigin: string;

test.before(async () => {
  server = http.createServer((req, res) => {
    if (req.url?.startsWith('/unauthorized/')) {
      res.writeHead(401).end('{"error":"bad key"}');
    } else if (req.url?.startsWith('/ratelimited/')) {
      res.writeHead(429).end('{"error":"slow down"}');
    } else if (req.url?.startsWith('/broken/')) {
      res.writeHead(503).end('{"error":"upstream"}');
    } else if (req.url?.startsWith('/slow/')) {
      // 故意不响应,触发 timeout / abort
    } else if (req.url?.startsWith('/stream/')) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"lo"}}]}\n\n');
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: 'Hello from model' } }],
          usage: { total_tokens: 42 },
        }),
      );
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.after(() => {
  server.close();
});

const baseOptions = { model: 'test-model', messages: [{ role: 'user' as const, content: 'hi' }] };

test('200 正常响应解析', async () => {
  const result = await chatComplete({ ...baseOptions, baseUrl: `${baseOrigin}/ok` });
  assert.equal(result.text, 'Hello from model');
  assert.equal(result.usage?.totalTokens, 42);
});

test('401 → unauthorized', async () => {
  await assert.rejects(
    () => chatComplete({ ...baseOptions, baseUrl: `${baseOrigin}/unauthorized` }),
    (error: unknown) => error instanceof ModelHttpError && error.kind === 'unauthorized' && error.status === 401,
  );
});

test('429 → rate_limited', async () => {
  await assert.rejects(
    () => chatComplete({ ...baseOptions, baseUrl: `${baseOrigin}/ratelimited` }),
    (error: unknown) => error instanceof ModelHttpError && error.kind === 'rate_limited',
  );
});

test('5xx → server_error', async () => {
  await assert.rejects(
    () => chatComplete({ ...baseOptions, baseUrl: `${baseOrigin}/broken` }),
    (error: unknown) => error instanceof ModelHttpError && error.kind === 'server_error' && error.status === 503,
  );
});

test('超时 → timeout(非失败伪装)', async () => {
  await assert.rejects(
    () => chatComplete({ ...baseOptions, baseUrl: `${baseOrigin}/slow`, timeoutMs: 150 }),
    (error: unknown) => error instanceof ModelHttpError && error.kind === 'timeout',
  );
});

test('调用方 abort → aborted', async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(
    () => chatComplete({ ...baseOptions, baseUrl: `${baseOrigin}/slow`, signal: controller.signal }),
    (error: unknown) => error instanceof ModelHttpError && error.kind === 'aborted',
  );
});

test('连接失败 → network', async () => {
  await assert.rejects(
    () => chatComplete({ ...baseOptions, baseUrl: 'http://127.0.0.1:1/ok', timeoutMs: 2000 }),
    (error: unknown) => error instanceof ModelHttpError && error.kind === 'network',
  );
});

test('流式最小版:增量上报并拼合全文', async () => {
  const deltas: string[] = [];
  const result = await chatCompleteStream({
    ...baseOptions,
    baseUrl: `${baseOrigin}/stream`,
    onDelta: (d) => deltas.push(d),
  });
  assert.equal(result.text, 'Hello');
  assert.deepEqual(deltas, ['Hel', 'lo']);
});
