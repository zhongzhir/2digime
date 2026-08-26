/**
 * DIGITALME-SEARCH-PROVIDER-GEMINI-01B — Gemini adapter 确定性测试。
 *
 * 覆盖：
 *  1. source normalization：deriveSourceType 对官方产品页（含 .com.cn 地区镜像）/普通媒体/未知来源。
 *  2. transient bounded retry：503→success、503×2→success、503×3→exhausted 抛错、
 *     401 不重试、网络错误重试。
 *  3. 与 conversation domain 无 provider 特判（本套件仅测 adapter/分类边界）。
 *
 * 离线确定性：全部注入 fake fetchImpl，不访问网络。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createGeminiSearchConnector, GeminiSearchConnectorError } from '../gemini-search';
import { deriveSourceType } from '../bing-html-search';

function groundingResponse(chunks: Array<{ uri: string; title?: string; domain?: string }>) {
  return {
    candidates: [
      {
        content: { parts: [{ text: 'ok' }] },
        groundingMetadata: {
          groundingChunks: chunks.map((c) => ({ web: c })),
          groundingSupports: [],
          webSearchQueries: ['q'],
        },
      },
    ],
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
  };
}

/** 构造可按序返回响应的 fake fetch（数组为空时抛网络错误）。 */
function fakeFetch(responses: Array<{ status?: number; body?: unknown }>) {
  let i = 0;
  return (async (input: string | URL | Request) => {
    const idx = i;
    i += 1;
    const spec = responses[idx];
    if (!spec) {
      throw new Error('simulated network reset');
    }
    const status = spec.status ?? 200;
    return new Response(JSON.stringify(spec.body ?? groundingResponse([])), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

describe('gemini-search-01', () => {
  describe('source normalization (deriveSourceType)', () => {
    it('A: 官方产品页（中国大陆地区镜像）→ official', () => {
      assert.equal(deriveSourceType('https://www.apple.com.cn/iphone-16-pro/'), 'official');
      assert.equal(deriveSourceType('https://www.apple.com/iphone-16-pro/'), 'official');
      assert.equal(deriveSourceType('https://www.microsoft.com.cn/pricing'), 'official');
      assert.equal(deriveSourceType('https://www.gov.cn/policy'), 'official');
    });

    it('B: 普通媒体 → 非 official（news）', () => {
      assert.equal(deriveSourceType('https://www.reuters.com/tech/apple'), 'news');
      assert.equal(deriveSourceType('https://www.ithome.com/0/800/'), 'news');
      assert.equal(deriveSourceType('https://techcrunch.com/apple'), 'unknown');
    });

    it('C: 未知来源 → unknown', () => {
      assert.equal(deriveSourceType('https://example.com/random'), 'unknown');
      assert.equal(deriveSourceType('not a url'), 'unknown');
    });

    it('D: Gemini search 基于 redirect 解析后真实 URL 归一 sourceType（复用 deriveSourceType）', async () => {
      const connector = createGeminiSearchConnector({
        apiKey: 'test-key',
        fetchImpl: (async (input: string | URL | Request) => {
          const u = String(input);
          if (u.includes('vertexaisearch.cloud.google.com')) {
            // 模拟 fetch 跟随 redirect 后 res.url 为真实 URL
            const r = new Response('<html><body><p>Apple 官方中国大陆 iPhone 16 Pro 页面正文内容。</p></body></html>', { status: 200 });
            Object.defineProperty(r, 'url', { value: 'https://www.apple.com.cn/iphone-16-pro/' });
            return r;
          }
          return new Response(JSON.stringify(groundingResponse([
            { uri: 'https://vertexaisearch.cloud.google.com/redirect/abc', title: 'Apple 官方', domain: 'www.apple.com.cn' },
          ])), { status: 200, headers: { 'content-type': 'application/json' } });
        }) as unknown as typeof fetch,
      });
      const sources = await connector.search('iPhone 16 Pro 价格');
      assert.equal(sources.length, 1);
      assert.equal(sources[0]!.sourceType, 'official');
      assert.equal(sources[0]!.grounded, true);
      assert.equal(sources[0]!.url, 'https://www.apple.com.cn/iphone-16-pro/');
    });
  });

  describe('transient bounded retry', () => {
    it('E: 503 → success（1 次重试后成功，onUsage 只计成功那次）', async () => {
      let retries: Array<{ attempt: number; status?: number }> = [];
      const connector = createGeminiSearchConnector({
        apiKey: 'test-key',
        fetchImpl: fakeFetch([
          { status: 503, body: { error: { message: 'model currently experiencing high demand' } } },
          { body: groundingResponse([{ uri: 'https://x.com', title: 'X', domain: 'x.com' }]) },
        ]),
        onRetry: (i) => {
          if (typeof i.status === 'number') retries.push({ attempt: i.attempt, status: i.status });
          else retries.push({ attempt: i.attempt });
        },
      });
      const sources = await connector.search('q');
      assert.equal(sources.length, 1);
      assert.deepEqual(retries.map((r) => r.attempt), [1]);
      assert.equal(retries[0]!.status, 503);
    });

    it('F: 503 ×2 → success（最多 initial + maxRetries 次）', async () => {
      let retries = 0;
      const connector = createGeminiSearchConnector({
        apiKey: 'test-key',
        fetchImpl: fakeFetch([
          { status: 503, body: { error: { message: 'high demand' } } },
          { status: 503, body: { error: { message: 'high demand' } } },
          { body: groundingResponse([{ uri: 'https://x.com', title: 'X', domain: 'x.com' }]) },
        ]),
        onRetry: () => { retries += 1; },
      });
      const sources = await connector.search('q');
      assert.equal(sources.length, 1);
      assert.equal(retries, 2);
    });

    it('G: 503 ×3 → retry exhausted 抛错（不无限重试）', async () => {
      let retries = 0;
      const connector = createGeminiSearchConnector({
        apiKey: 'test-key',
        fetchImpl: fakeFetch([
          { status: 503, body: { error: { message: 'high demand' } } },
          { status: 503, body: { error: { message: 'high demand' } } },
          { status: 503, body: { error: { message: 'high demand' } } },
        ]),
        onRetry: () => { retries += 1; },
      });
      await assert.rejects(() => connector.search('q'), (err: unknown) => {
        const e = err as GeminiSearchConnectorError;
        return e.name === 'GeminiSearchConnectorError' && e.kind === 'network' && e.transient === true;
      });
      assert.equal(retries, 2); // initial + 2 retries = 3 attempts，不再更多
    });

    it('H: 401 → 立即 auth 失败，不重试', async () => {
      let calls = 0;
      const connector = createGeminiSearchConnector({
        apiKey: 'bad-key',
        fetchImpl: (async (input: string | URL | Request) => {
          calls += 1;
          return new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 401 });
        }) as unknown as typeof fetch,
      });
      await assert.rejects(() => connector.search('q'), (err: unknown) => {
        const e = err as GeminiSearchConnectorError;
        return e.kind === 'auth';
      });
      assert.equal(calls, 1, 'auth 不应重试');
    });

    it('I: 网络 reset（fetch 抛错）→ 重试后成功', async () => {
      let retries = 0;
      const connector = createGeminiSearchConnector({
        apiKey: 'test-key',
        fetchImpl: fakeFetch([
          undefined as unknown as { status?: number; body?: unknown }, // fetch 抛 network
          { body: groundingResponse([{ uri: 'https://x.com', title: 'X', domain: 'x.com' }]) },
        ]),
        onRetry: () => { retries += 1; },
      });
      const sources = await connector.search('q');
      assert.equal(sources.length, 1);
      assert.equal(retries, 1);
    });

    it('J: timeoutMs 约束 fetch；到期后 search 结束且不返回迟到结果', async () => {
      let lateWrites = 0;
      const connector = createGeminiSearchConnector({
        apiKey: 'test-key',
        timeoutMs: 60,
        maxRetries: 0,
        fetchImpl: (async (_input: string | URL | Request, init?: RequestInit) => {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
              lateWrites += 1;
              resolve();
            }, 2_000);
            init?.signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                const err = new Error('aborted');
                err.name = 'AbortError';
                reject(err);
              },
              { once: true },
            );
          });
          return new Response(JSON.stringify(groundingResponse([{ uri: 'https://late.example', title: 'LATE' }])), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        }) as unknown as typeof fetch,
      });
      const started = Date.now();
      await assert.rejects(() => connector.search('q'), (err: unknown) => {
        const e = err as GeminiSearchConnectorError;
        return e.name === 'GeminiSearchConnectorError' && (e.kind === 'timeout' || e.transient === true);
      });
      const elapsed = Date.now() - started;
      assert.ok(elapsed < 800, `timeout 应在数百毫秒内结束，实际 ${elapsed}ms`);
      await new Promise((r) => setTimeout(r, 80));
      assert.equal(lateWrites, 0, 'abort 后不得把迟到响应写回');
    });

    it('K: empty grounding chunks 视为能力失败（非成功）', async () => {
      const connector = createGeminiSearchConnector({
        apiKey: 'test-key',
        fetchImpl: fakeFetch([{ body: groundingResponse([]) }]),
      });
      await assert.rejects(() => connector.search('q'), (err: unknown) => {
        const e = err as GeminiSearchConnectorError;
        return e.kind === 'empty';
      });
    });
  });
});