import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../digitalme-runtime';
import { createCommandBus } from '../command-bus';
import { providerCredentialKey } from '../../infrastructure/secret-store';
import { shouldApplyDiscoverView } from '../../subject-comm/discover-search-generation';

function responseFor(label: string) {
  const url = `https://example.com/articles/${label.toLowerCase()}-result`;
  return {
    id: `resp_${label}`,
    status: 'completed',
    output: [
      {
        type: 'web_search_call',
        status: 'completed',
        action: { sources: [{ title: `${label} source`, url }] },
      },
      {
        type: 'function_call',
        call_id: `call_${label}`,
        name: 'present_results',
        arguments: JSON.stringify({
          summary: `${label} complete`,
          results: [{
            title: `${label} result`,
            url,
            summary: `${label} summary`,
            why: '符合当前请求',
            readStatus: 'snippet_only',
          }],
        }),
      },
    ],
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

function delayedSse(label: string, delayMs: number, signal?: AbortSignal | null): Promise<Response> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      resolve(new Response(
        `data: ${JSON.stringify({ type: 'response.completed', response: responseFor(label) })}\n\n`,
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      ));
    }, delayMs);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason || Object.assign(new Error('aborted'), { name: 'AbortError' }));
    };
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

test('unified Discover A→B→C keeps only generation C as current', async () => {
  const originalFetch = globalThis.fetch;
  const providerId = 'openai-compatible';
  const pkgDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dm-unified-generation-')), 'pkg');
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body || '{}')) as Record<string, unknown>;
    const request = JSON.stringify(body);
    const label = request.includes('request C') ? 'C' : request.includes('request B') ? 'B' : 'A';
    return delayedSse(label, label === 'A' ? 80 : label === 'B' ? 40 : 5, init?.signal);
  };
  const runtime = createDigitalMeRuntime({
    registerOpenAiStub: false,
    searchCapability: false,
    openaiCompatible: {
      providerId,
      baseUrl: 'https://ws-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      model: 'qwen3.8-flash',
    },
    secrets: {
      get: async (key) => key === providerCredentialKey(providerId) ? 'not-a-real-key' : null,
    },
  });
  try {
    const bus = createCommandBus(runtime);
    await bus.invoke('subject.createPackage', { displayName: '统一搜索代次', targetDir: pkgDir });
    const aPromise = bus.invoke('content', { action: 'seek', text: 'request A', searchGenerationId: 'sg_a' });
    const bPromise = bus.invoke('content', { action: 'seek', text: 'request B', searchGenerationId: 'sg_b' });
    const c = await bus.invoke('content', { action: 'seek', text: 'request C', searchGenerationId: 'sg_c' });
    const [a, b] = await Promise.all([aPromise, bPromise]);

    assert.equal(a.view.searchGenerationId, 'sg_a');
    assert.equal(b.view.searchGenerationId, 'sg_b');
    assert.equal(c.view.searchGenerationId, 'sg_c');
    assert.equal(shouldApplyDiscoverView({ searchGenerationId: 'sg_c', feedMode: 'intent' }, a.view), false);
    assert.equal(shouldApplyDiscoverView({ searchGenerationId: 'sg_c', feedMode: 'intent' }, b.view), false);
    assert.deepEqual(c.view.cards.map((card) => card.title), ['C result']);

    const stable = await bus.invoke('content', { action: 'replenish', searchGenerationId: 'sg_c' });
    assert.equal(stable.view.searchGenerationId, 'sg_c');
    assert.deepEqual(stable.view.cards.map((card) => card.title), ['C result']);
  } finally {
    globalThis.fetch = originalFetch;
    await runtime.stop();
  }
});

