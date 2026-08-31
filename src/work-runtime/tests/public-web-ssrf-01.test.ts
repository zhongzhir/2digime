/**
 * 公开网页 DNS/IP SSRF 边界：真实解析 + 钉死地址，不用 hostname 黑名单凑绿。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  assertSafePublicDestination,
  assertSafePublicHttpUrl,
  classifyPublicWebQuery,
  createPinnedLookup,
  defaultLookupAddresses,
  defaultSafePublicHttpGet,
  executePublicWebQuery,
  formatPublicWebFailureActionable,
  isBlockedPublicIp,
  resolvePublicRedirect,
} from '../public-web-query';
import { createBingHtmlSearchConnector } from '../../capability/adapters/bing-html-search';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { waitForJobTerminal } from '../job-runner';
import * as http from 'node:http';

function lookupOf(map: Record<string, string[] | (() => string[])>) {
  return async (hostname: string): Promise<string[]> => {
    const hit = map[hostname];
    if (typeof hit === 'function') return hit();
    if (hit) return hit;
    throw Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
  };
}

test('IP 分类：loopback / RFC1918 / link-local / ULA / 映射地址均拒绝，公网 IP 放行', () => {
  assert.equal(isBlockedPublicIp('127.0.0.1'), true);
  assert.equal(isBlockedPublicIp('10.1.2.3'), true);
  assert.equal(isBlockedPublicIp('192.168.1.8'), true);
  assert.equal(isBlockedPublicIp('169.254.10.1'), true);
  assert.equal(isBlockedPublicIp('172.16.0.1'), true);
  assert.equal(isBlockedPublicIp('0.0.0.0'), true);
  assert.equal(isBlockedPublicIp('224.0.0.1'), true);
  assert.equal(isBlockedPublicIp('::1'), true);
  assert.equal(isBlockedPublicIp('fc00::1'), true);
  assert.equal(isBlockedPublicIp('fd12:3456::1'), true);
  assert.equal(isBlockedPublicIp('fe80::1'), true);
  assert.equal(isBlockedPublicIp('::ffff:127.0.0.1'), true);
  assert.equal(isBlockedPublicIp('::ffff:10.0.0.1'), true);
  assert.equal(isBlockedPublicIp('8.8.8.8'), false);
  assert.equal(isBlockedPublicIp('1.1.1.1'), false);
  assert.equal(isBlockedPublicIp('2001:4860:4860::8888'), false);
});

test('真实 DNS：localtest.me 解析为 127.0.0.1 并在连接前被拒绝', async () => {
  const addresses = await defaultLookupAddresses('localtest.me');
  assert.ok(
    addresses.some((addr) => addr === '127.0.0.1' || addr.startsWith('127.') || addr === '0000:0000:0000:0000:0000:0000:0000:0001' || addr === '::1'),
    `localtest.me 未解析到 loopback：${addresses.join(',')}`,
  );
  await assert.rejects(
    () => assertSafePublicDestination('http://localtest.me/'),
    (err: unknown) => {
      assert.equal((err as { code?: string }).code, 'ssrf');
      assert.match(String((err as Error).message), /内网|不可路由|127/);
      return true;
    },
  );
  assert.doesNotThrow(() => assertSafePublicHttpUrl('http://localtest.me/'));
});

test('自定义域名解析到内网/ULA/link-local 均被拒绝', async () => {
  const cases: Array<[string, string]> = [
    ['10.8.0.1', 'http://corp-intranet.test/'],
    ['192.168.10.2', 'http://home-router.test/'],
    ['169.254.1.1', 'http://link-local.test/'],
    ['::1', 'http://v6-loop.test/'],
    ['fc00::abcd', 'http://ula.test/'],
    ['fe80::1', 'http://v6-link.test/'],
  ];
  for (const [ip, url] of cases) {
    await assert.rejects(
      () =>
        assertSafePublicDestination(url, lookupOf({ [new URL(url).hostname]: [ip] })),
      (err: unknown) => {
        assert.equal((err as { code?: string }).code, 'ssrf', `${url} → ${ip}`);
        return true;
      },
    );
  }
});

test('公网 IP 允许钉死并请求；Host/SNI 保持原域名', async () => {
  const seen: Array<{ pin: string; servername: string; host: string }> = [];
  const result = await defaultSafePublicHttpGet('https://example.com/path', undefined, 3, {
    lookupAddresses: lookupOf({ 'example.com': ['8.8.8.8'] }),
    transport: async ({ pin, servername, url, headers }) => {
      seen.push({ pin, servername, host: String(headers.host || '') });
      assert.equal(url.hostname, 'example.com');
      return { status: 200, body: 'public-ok', headers: { 'content-type': 'text/plain' } };
    },
  });
  assert.equal(result.status, 200);
  assert.equal(result.body, 'public-ok');
  assert.equal(seen[0]?.pin, '8.8.8.8');
  assert.equal(seen[0]?.servername, 'example.com');
  assert.match(seen[0]?.host || '', /example\.com/);
});

test('DNS rebinding：首次公网钉死后不会改用二次私网解析', async () => {
  let calls = 0;
  const pins: string[] = [];
  const lookup = async () => {
    calls += 1;
    return calls === 1 ? ['8.8.8.8'] : ['10.0.0.9'];
  };
  const first = await defaultSafePublicHttpGet('http://rebind.test/one', undefined, 3, {
    lookupAddresses: lookup,
    transport: async ({ pin }) => {
      pins.push(pin);
      return { status: 200, body: 'first', headers: { 'content-type': 'text/plain' } };
    },
  });
  assert.equal(first.body, 'first');
  assert.deepEqual(pins, ['8.8.8.8']);
  assert.equal(calls, 1);
  await assert.rejects(
    () =>
      defaultSafePublicHttpGet('http://rebind.test/two', undefined, 3, {
        lookupAddresses: lookup,
        transport: async () => {
          throw new Error('私网解析后不得发请求');
        },
      }),
    (err: unknown) => (err as { code?: string }).code === 'ssrf',
  );
  const pinnedLookup = createPinnedLookup('8.8.8.8', 4);
  await new Promise<void>((resolve, reject) => {
    pinnedLookup('rebind.test', { all: false }, (err: Error | null, address: string | import('node:dns').LookupAddress[]) => {
      if (err) reject(err);
      else {
        assert.equal(address, '8.8.8.8');
        resolve();
      }
    });
  });
});

test('公开地址重定向到内网被拒绝，且重定向前释放当前响应', async () => {
  const hops: string[] = [];
  await assert.throws(() => resolvePublicRedirect('https://example.com/from', 'http://127.0.0.1/secret'));
  await assert.rejects(
    () =>
      defaultSafePublicHttpGet('http://public.test/start', undefined, 3, {
        lookupAddresses: lookupOf({
          'public.test': ['8.8.8.8'],
          '127.0.0.1': ['127.0.0.1'],
        }),
        transport: async ({ url, pin }) => {
          hops.push(`${url.hostname}|${pin}`);
          return {
            status: 302,
            headers: { location: 'http://127.0.0.1/internal' },
            body: 'redirect-body-should-be-dropped',
          };
        },
      }),
    (err: unknown) => {
      assert.equal((err as { code?: string }).code, 'ssrf');
      return true;
    },
  );
  assert.deepEqual(hops, ['public.test|8.8.8.8']);
});

test('pageRead.resolvedUrl 为内网时不得返回成功成果', async () => {
  const query = classifyPublicWebQuery('访问 https://example.com/project 看看说明');
  assert.ok(query);
  const blocked = await executePublicWebQuery(query, {
    lookupAddresses: lookupOf({ 'example.com': ['8.8.8.8'] }),
    pageRead: async () => ({
      content: '不该出现在成果里的内网正文',
      resolvedUrl: 'http://127.0.0.1/admin',
    }),
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.diagnostics.failureClass, 'ssrf');
    assert.match(formatPublicWebFailureActionable(blocked), /失败分类：ssrf/);
    assert.match(blocked.blocker, /不安全|内网/);
  }
});

test('Work Job：SSRF 失败保留 Task/Job，不写伪成果', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-ssrf-job-'));
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    publicPageRead: async () => ({
      content: 'secret',
      resolvedUrl: 'http://169.254.1.1/meta',
    }),
  });
  await runtime.createPackage({ displayName: 'ssrf', targetDir: path.join(root, 'pkg') });
  const submitted = await runtime.submitTask({
    goal: '访问 https://example.com/x 看看项目说明',
    contextRefs: [],
  });
  const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId);
  assert.equal(job.status, 'failed');
  assert.match(String(job.failure?.actionable || ''), /失败分类|不安全|内网/);
  const detail = await runtime.getTask({ taskId: submitted.taskId });
  assert.equal((detail.artifactIds || []).length, 0);
  assert.ok(detail.task);
  await runtime.stop();
});

async function listenLoopbackSecret(): Promise<{ server: http.Server; port: number; hits: string[] }> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method || 'GET'} ${req.url || '/'}`);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><body><p>ssrf-secret-loopback-should-never-be-read-by-public-page-read</p></body></html>');
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { server, port, hits };
}

test('生产 pageRead：localtest.me 指向本机监听端口时请求数为 0', async () => {
  const { server, port, hits } = await listenLoopbackSecret();
  try {
    const addresses = await defaultLookupAddresses('localtest.me');
    assert.ok(
      addresses.some((addr) => addr === '127.0.0.1' || addr.startsWith('127.')),
      `localtest.me 未解析到 loopback：${addresses.join(',')}`,
    );
    const connector = createBingHtmlSearchConnector();
    const read = await connector.read!(`http://localtest.me:${port}/probe`);
    assert.equal(read, null);
    assert.equal(hits.length, 0, `本机服务被命中：${hits.join(' | ')}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('生产 pageRead：公开地址重定向到 localtest.me 本机端口，请求数仍为 0', async () => {
  const { server, port, hits } = await listenLoopbackSecret();
  try {
    const connector = createBingHtmlSearchConnector({
      http: {
        lookupAddresses: async (hostname) => {
          if (hostname === 'public.test') return ['8.8.8.8'];
          return defaultLookupAddresses(hostname);
        },
        transport: async ({ url }) => {
          if (url.hostname === 'public.test') {
            return {
              status: 302,
              headers: { location: `http://localtest.me:${port}/via-redirect` },
              body: 'redirect',
            };
          }
          throw new Error(`不得对 ${url.hostname} 建立传输`);
        },
      },
    });
    const read = await connector.read!('http://public.test/start');
    assert.equal(read, null);
    assert.equal(hits.length, 0, `重定向后本机服务被命中：${hits.join(' | ')}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  }
});

test('生产 pageRead：正常公开网页读取继续成功', async () => {
  const connector = createBingHtmlSearchConnector({
    http: {
      lookupAddresses: lookupOf({ 'example.com': ['8.8.8.8'] }),
      transport: async ({ url, servername, headers }) => {
        assert.equal(url.hostname, 'example.com');
        assert.equal(servername, 'example.com');
        assert.match(String(headers.host || ''), /example\.com/);
        return {
          status: 200,
          headers: { 'content-type': 'text/html' },
          body:
            '<html><body><p>这是一段足够长的公开网页正文，用于确认安全连接器在通过 DNS/IP 校验并钉死地址后仍能提取 evidence chunk。</p></body></html>',
        };
      },
    },
  });
  const read = await connector.read!('https://example.com/about');
  assert.ok(read);
  assert.match(read.content, /公开网页正文/);
  assert.equal(read.resolvedUrl, 'https://example.com/about');
});
