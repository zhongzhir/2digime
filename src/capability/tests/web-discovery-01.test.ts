import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createServer } from 'node:http';
import { createWebDiscoveryGateway } from '../../relay-service/web-discovery-gateway';
import { createRelayServer, FileRelayStore, resolveManagedWebDiscoveryGateway } from '../../relay-service/server';
import { createAliyunIqsWebDiscoveryProvider } from '../adapters/aliyun-iqs-web-discovery';
import { createAliyunOpenSearchWebDiscoveryProvider } from '../adapters/aliyun-opensearch-web-discovery';
import {
  forbiddenWebDiscoveryKeys,
  parseWebDiscoveryRequest,
  webDiscoveryProviderFromConnector,
  WebDiscoveryError,
} from '../web-discovery';
import { createManagedWebDiscoveryConnector } from '../web-discovery-client';
import { readOrCreateInstallCapabilityToken } from '../install-capability-token';
import { readWebDiscoveryPreference, writeWebDiscoveryPreference } from '../web-discovery-preference';
import {
  discoverSearchCapabilities,
  PROFESSIONAL_SEARCH_CAPABILITY_ID,
  resolveWebDiscoveryPath,
} from '../search-capability-discovery';
import type { SearchConnector } from '../search-connector';

function mockConnector(hits: Array<{ title: string; url: string; snippet?: string }>, calls: { n: number }): SearchConnector {
  return {
    id: 'mock',
    async search() {
      calls.n += 1;
      return hits.map((row) => ({ ...row, sourceClass: 'external' as const }));
    },
  };
}

test('WEB_DISCOVERY rejects Digital Self / profile payload and keeps allowed query only', () => {
  assert.deepEqual(forbiddenWebDiscoveryKeys({ digitalSelf: '{}' }), ['digitalSelf']);
  assert.deepEqual(forbiddenWebDiscoveryKeys({ profile: 'x', facts: [] }), ['profile', 'facts']);
  const parsed = parseWebDiscoveryRequest({ query: '2026 AI agent new releases', limit: 5, institutionToken: 'org-quota' });
  assert.equal(parsed.query, '2026 AI agent new releases');
  assert.equal(parsed.limit, 5);
  assert.throws(
    () => parseWebDiscoveryRequest({ query: 'ai', digitalSelf: { facts: [] } }),
    /payload_rejected/,
  );
});

test('install token is random and stable; preference defaults to managed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-webdisc-'));
  const a = await readOrCreateInstallCapabilityToken(root);
  const b = await readOrCreateInstallCapabilityToken(root);
  assert.equal(a, b);
  assert.equal(a.length, 64);
  const pref = await readWebDiscoveryPreference(root);
  assert.equal(pref.path, 'managed');
  assert.equal(pref.enabled, true);
  const next = await writeWebDiscoveryPreference(root, { path: 'byok' });
  assert.equal(next.path, 'byok');
});

test('managed gateway caches public results and rate-limits per install token', async () => {
  const calls = { n: 0 };
  const gateway = createWebDiscoveryGateway({
    provider: webDiscoveryProviderFromConnector(
      mockConnector([{ title: 'AI', url: 'https://example.com/ai', snippet: 'public' }], calls),
      'mock',
    ),
    cacheTtlMs: 60_000,
    perInstallPerHour: 2,
    globalPerHour: 100,
  });
  const token = 'install-capability-token-test-0001';
  const first = await gateway.search({ body: { query: '2026 AI agents' }, installToken: token });
  const second = await gateway.search({ body: { query: '2026 AI agents' }, installToken: token });
  assert.equal(first.body.status, 'AVAILABLE');
  assert.equal(second.body.cacheState, 'hit');
  assert.equal(calls.n, 1);
  assert.equal(first.body.provider, 'web-discovery');
  const third = await gateway.search({ body: { query: 'another public topic' }, installToken: token });
  assert.equal(third.body.status, 'RATE_LIMITED');
  const other = await gateway.search({ body: { query: 'another public topic' }, installToken: 'install-capability-token-test-0002' });
  assert.equal(other.body.status, 'AVAILABLE');
});

test('gateway 429 from provider is RATE_LIMITED; missing secret is MANAGED_PROVIDER_SECRET_REQUIRED', async () => {
  const limited = createWebDiscoveryGateway({
    provider: {
      id: 'mock',
      async search() {
        throw new WebDiscoveryError('RATE_LIMITED', 'quota', 429);
      },
    },
  });
  const hit = await limited.search({ body: { query: 'today ai' }, installToken: 'install-capability-token-test-0001' });
  assert.equal(hit.body.status, 'RATE_LIMITED');

  const missing = createWebDiscoveryGateway({});
  const empty = await missing.search({ body: { query: 'today ai' }, installToken: 'install-capability-token-test-0001' });
  assert.equal(empty.body.error, 'MANAGED_PROVIDER_SECRET_REQUIRED');
  assert.equal(empty.body.status, 'TEMPORARY_UNAVAILABLE');
});

test('Relay POST /v1/web-discovery/search forwards query only and never logs Authorization', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-relay-wd-'));
  const seen: unknown[] = [];
  const { server, start } = createRelayServer({
    store: new FileRelayStore(root),
    port: 0,
    webDiscovery: createWebDiscoveryGateway({
      provider: {
        id: 'mock',
        async search(input) {
          seen.push(input);
          return [{ title: 'News', url: 'https://example.com/n', snippet: 'ok' }];
        },
      },
    }),
  });
  const addr = await start();
  try {
    const res = await fetch(`http://127.0.0.1:${addr.port}/v1/web-discovery/search`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-install-capability-token': 'install-capability-token-test-0001',
      },
      body: JSON.stringify({ query: '2026 AI agent new releases', limit: 3 }),
    });
    const json = (await res.json()) as { ok: boolean; provider: string; results: Array<{ url: string }> };
    assert.equal(json.ok, true);
    assert.equal(json.provider, 'web-discovery');
    assert.equal(json.results[0]?.url, 'https://example.com/n');
    assert.deepEqual(seen, [{ query: '2026 AI agent new releases', limit: 3 }]);

    const rejected = await fetch(`http://127.0.0.1:${addr.port}/v1/web-discovery/search`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-install-capability-token': 'install-capability-token-test-0001',
      },
      body: JSON.stringify({ query: 'ai', digitalSelf: { name: 'owner' } }),
    });
    assert.equal(rejected.status, 400);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('managed client + BYOK discovery path stay provider-agnostic at the app contract', async () => {
  const server = createServer((req, res) => {
    if (req.url === '/v1/web-discovery/search') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        status: 'AVAILABLE',
        provider: 'web-discovery',
        results: [{ title: 'Managed', url: 'https://example.com/m' }],
      }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  try {
    const managed = discoverSearchCapabilities({}, {
      webDiscoveryPath: 'managed',
      webDiscoveryGatewayUrl: `http://127.0.0.1:${port}`,
      webDiscoveryInstallToken: 'install-capability-token-test-0001',
    });
    assert.equal(managed[0]?.registration.id, PROFESSIONAL_SEARCH_CAPABILITY_ID);
    assert.equal(managed[0]?.registration.adapter.adapterId, 'web-discovery');
    const sources = await createManagedWebDiscoveryConnector({
      gatewayUrl: `http://127.0.0.1:${port}`,
      installToken: 'install-capability-token-test-0001',
    }).search('today ai');
    assert.equal(sources[0]?.url, 'https://example.com/m');
    assert.equal(sources[0]?.sourceClass, 'external');

    const byok = discoverSearchCapabilities({ GEMINI_API_KEY: '' }, {
      webDiscoveryPath: 'byok',
      apiKey: 'sk-test',
    });
    assert.equal(byok[0]?.registration.adapter.adapterId, 'gemini-search');
    assert.equal(resolveWebDiscoveryPath({ path: 'managed', byokKey: 'sk-test' }), 'managed');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('app package sources do not embed managed provider secrets', async () => {
  const root = process.cwd();
  const files = [
    'electron/renderer/app.js',
    'electron/renderer/index.html',
    'electron/preload.cjs',
    'electron/brand.cjs',
    'src/capability/web-discovery-client.ts',
    'src/runtime/digitalme-runtime.ts',
    'src/capability/adapters/aliyun-iqs-web-discovery.ts',
    'src/capability/adapters/aliyun-opensearch-web-discovery.ts',
    'src/relay-service/server.ts',
  ];
  const secret = /AIza[0-9A-Za-z_-]{20,}|WEB_DISCOVERY_PROVIDER_API_KEY\s*[:=]\s*['"][^'"]+|geminiApiKey\s*[:=]\s*['"]AIza/;
  for (const rel of files) {
    const text = await fs.readFile(path.join(root, rel), 'utf8');
    assert.equal(secret.test(text), false, rel);
    assert.equal(/geminiSearchResult/.test(text), false, rel);
    assert.equal(/aliyunSearchResult/.test(text), false, rel);
    assert.equal(/iqsSearchResult/.test(text), false, rel);
  }
  const settings = await fs.readFile(path.join(root, 'electron/renderer/index.html'), 'utf8');
  assert.match(settings, /联网发现/);
  assert.match(settings, /不会上传完整数字之我/);
  assert.match(settings, /高级联网设置/);
  assert.equal(/<h2>联网搜索<\/h2>/.test(settings), false);
  assert.ok(settings.indexOf('gemini-search-api-key') > settings.indexOf('advanced-web-discovery'));
});

test('Aliyun OpenSearch provider maps official fields and gateway still returns web-discovery', async () => {
  let authHeader = '';
  const provider = createAliyunOpenSearchWebDiscoveryProvider({
    apiKey: 'OS-test-not-a-real-key',
    endpoint: 'https://example.platform-cn-shanghai.opensearch.aliyuncs.com',
    workspace: 'tujimi',
    fetchImpl: async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      authHeader = String(headers.authorization || headers.Authorization || '');
      const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      assert.equal(body.query, '今天 AI 有什么重要进展');
      assert.equal(body.query_rewrite, false);
      assert.equal(body.history, undefined);
      assert.equal(Object.prototype.hasOwnProperty.call(body, 'digitalSelf'), false);
      return new Response(
        JSON.stringify({
          result: {
            search_result: [
              {
                title: '今日 AI 进展',
                link: 'https://example.org/ai-today',
                snippet: 'public note',
                meta_info: { publishedTime: '2026-09-20T00:00:00Z' },
              },
            ],
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });
  const hits = await provider.search({ query: '今天 AI 有什么重要进展', limit: 5 });
  assert.equal(provider.id, 'aliyun-opensearch');
  assert.equal(hits[0]?.title, '今日 AI 进展');
  assert.equal(hits[0]?.url, 'https://example.org/ai-today');
  assert.equal(hits[0]?.snippet, 'public note');
  assert.match(authHeader, /^Bearer OS-/);

  const gateway = createWebDiscoveryGateway({ provider });
  const result = await gateway.search({
    body: { query: '今天 AI 有什么重要进展' },
    installToken: 'install-capability-token-test-0001',
  });
  assert.equal(result.body.ok, true);
  assert.equal(result.body.provider, 'web-discovery');
  assert.equal(result.body.results?.[0]?.url, 'https://example.org/ai-today');
});

test('Relay env WEB_DISCOVERY_PROVIDER=aliyun-opensearch requires endpoint; missing config is not a client key prompt', async () => {
  const missing = resolveManagedWebDiscoveryGateway({
    WEB_DISCOVERY_PROVIDER: 'aliyun-opensearch',
    WEB_DISCOVERY_PROVIDER_API_KEY: 'OS-test-not-a-real-key',
  });
  const empty = await missing.search({
    body: { query: 'today ai' },
    installToken: 'install-capability-token-test-0001',
  });
  assert.equal(empty.body.error, 'MANAGED_PROVIDER_SECRET_REQUIRED');
  assert.equal(empty.body.status, 'TEMPORARY_UNAVAILABLE');
});

test('Aliyun IQS UnifiedSearch maps pageItems and never sends Digital Self', async () => {
  let authHeader = '';
  let requestUrl = '';
  const provider = createAliyunIqsWebDiscoveryProvider({
    apiKey: 'IQS-test-not-a-real-key',
    fetchImpl: async (url, init) => {
      requestUrl = String(url);
      const headers = init?.headers as Record<string, string>;
      authHeader = String(headers.authorization || headers.Authorization || '');
      const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
      assert.deepEqual(Object.keys(body).sort(), ['advancedParams', 'contents', 'engineType', 'query']);
      assert.equal(body.query, '今天人工智能有什么重要进展');
      assert.equal(body.engineType, 'Generic');
      assert.equal((body.contents as { mainText?: boolean }).mainText, false);
      assert.equal((body.contents as { rerankScore?: boolean }).rerankScore, false);
      assert.equal((body.advancedParams as { numResults?: number }).numResults, 8);
      assert.equal(body.history, undefined);
      assert.equal(Object.prototype.hasOwnProperty.call(body, 'digitalSelf'), false);
      return new Response(
        JSON.stringify({
          pageItems: [
            {
              title: '今日 AI 进展',
              link: 'https://example.org/ai-today',
              snippet: 'public note',
              publishedTime: '2026-09-20T00:00:00Z',
              hostname: 'example.org',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });
  const hits = await provider.search({ query: '今天人工智能有什么重要进展', limit: 8 });
  assert.equal(provider.id, 'aliyun-iqs');
  assert.equal(requestUrl, 'https://cloud-iqs.aliyuncs.com/search/unified');
  assert.equal(hits[0]?.title, '今日 AI 进展');
  assert.equal(hits[0]?.url, 'https://example.org/ai-today');
  assert.equal(hits[0]?.snippet, 'public note');
  assert.match(authHeader, /^Bearer IQS-/);

  const gateway = createWebDiscoveryGateway({ provider });
  const result = await gateway.search({
    body: { query: '今天人工智能有什么重要进展' },
    installToken: 'install-capability-token-test-0001',
  });
  assert.equal(result.body.ok, true);
  assert.equal(result.body.provider, 'web-discovery');
  assert.equal(result.body.results?.[0]?.url, 'https://example.org/ai-today');
});

test('China default IQS does not send GEMINI_API_KEY; OpenSearch stays optional', async () => {
  const geminiNotIqs = resolveManagedWebDiscoveryGateway({
    WEB_DISCOVERY_PROVIDER: 'aliyun-iqs',
    GEMINI_API_KEY: 'AIzaSy-not-for-iqs',
  });
  const rejected = await geminiNotIqs.search({
    body: { query: 'today ai' },
    installToken: 'install-capability-token-test-0001',
  });
  assert.equal(rejected.body.status, 'TEMPORARY_UNAVAILABLE');
  assert.equal(rejected.body.error, 'MANAGED_PROVIDER_SECRET_REQUIRED');
  assert.equal(/API Key|Gemini|IQS|Google Cloud/.test(JSON.stringify(rejected.body)), false);

  const unnamedWithIqsKey = resolveManagedWebDiscoveryGateway({
    WEB_DISCOVERY_PROVIDER_API_KEY: 'IQS-test-not-a-real-key',
    GEMINI_API_KEY: 'AIzaSy-not-for-iqs',
  });
  assert.equal(typeof unnamedWithIqsKey.search, 'function');
});

test('IQS provider failure stays TEMPORARY_UNAVAILABLE and does not ask for a client key', async () => {
  const provider = createAliyunIqsWebDiscoveryProvider({
    apiKey: 'IQS-test-not-a-real-key',
    fetchImpl: async () => new Response(JSON.stringify({ message: 'unavailable' }), { status: 503 }),
  });
  await assert.rejects(() => provider.search({ query: 'today ai' }), (err: unknown) => {
    assert.equal(err instanceof WebDiscoveryError, true);
    const typed = err as WebDiscoveryError;
    assert.equal(typed.status, 'TEMPORARY_UNAVAILABLE');
    assert.equal(/API Key|请配置|Google Cloud|阿里云控制台/.test(typed.message), false);
    return true;
  });
  const gateway = createWebDiscoveryGateway({ provider });
  const failed = await gateway.search({
    body: { query: 'today ai' },
    installToken: 'install-capability-token-test-0001',
  });
  assert.equal(failed.body.ok, false);
  assert.equal(failed.body.status, 'TEMPORARY_UNAVAILABLE');
  assert.equal(/API Key|请配置 Gemini|Google Cloud/.test(JSON.stringify(failed.body)), false);
});
