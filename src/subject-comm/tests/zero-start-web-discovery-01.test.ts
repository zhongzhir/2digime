import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { ensurePersonalFeed } from '../personal-feed';
import { classifySearchFailure } from '../network-discovery-state';
import { WebDiscoveryError } from '../../capability/web-discovery';
import type { DigitalSelf } from '../../subject-core/digital-self/types';

const NOW = '2026-09-18T00:00:00.000Z';

function selfOf(subjectId: string): DigitalSelf {
  return {
    schemaVersion: 1,
    subjectId,
    updatedAt: NOW,
    understandings: [
      {
        id: 'u_1',
        text: '关心人工智能与开放工具',
        facet: 'goals',
        status: 'current',
        confirmed: true,
        provenance: { origin: 'user_statement', actor: 'owner', statedAt: NOW },
        updatedAt: NOW,
      },
    ],
  };
}

test('429 / quota maps to RATE_LIMITED and Feed does not throw', async () => {
  assert.equal(classifySearchFailure(new WebDiscoveryError('RATE_LIMITED', 'quota', 429)), 'RATE_LIMITED');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-zero-429-'));
  const result = await ensurePersonalFeed({
    packageRoot: root,
    digitalSelf: selfOf('subj_a'),
    items: [],
    preferences: [],
    feedbackFile: path.join(root, 'content', 'network-content-feedback.jsonl'),
    networking: 'AVAILABLE',
    chatComplete: async () => ({
      text: JSON.stringify({
        intents: [
          {
            topic: 'AI agents',
            contentTypes: ['article'],
            purpose: 'learn',
            freshness: 'current',
            explorationMode: 'core',
            searchQuery: '2026 AI agent new releases',
          },
        ],
      }),
    }),
    model: { baseUrl: 'http://127.0.0.1', model: 'stub' },
    searchWeb: async () => {
      throw new WebDiscoveryError('RATE_LIMITED', 'quota', 429);
    },
    mode: 'replenish',
    now: NOW,
  });
  assert.equal(result.view.networking, 'RATE_LIMITED');
  assert.equal(result.reasonCode, 'NETWORK_RATE_LIMITED');
  assert.match(result.view.notice, /搜索额度已经用完/);
  assert.equal(/没有找到|检查联网/.test(result.view.notice), false);
});

test('zero-start runtime uses managed gateway without Gemini BYOK; payload is query only', async () => {
  const seen: string[] = [];
  const runtime = createDigitalMeRuntime({
    documentCapability: 'none',
    registerOpenAiStub: false,
    searchCapability: false,
    webDiscoveryPath: 'managed',
    webDiscoveryGatewayUrl: 'http://127.0.0.1:9',
    webDiscoveryInstallToken: 'install-capability-token-test-0001',
    webDiscoveryFetch: async (_url, init) => {
      seen.push(String(init?.body || ''));
      assert.equal(/digitalSelf|self\.json|preference/.test(String(init?.body || '')), false);
      return new Response(
        JSON.stringify({
          ok: true,
          status: 'AVAILABLE',
          provider: 'web-discovery',
          results: [{ title: 'Today in AI', url: 'https://example.com/ai-today', snippet: 'public note' }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    },
  });
  try {
    const impl = (
      runtime as unknown as {
        resolveContentSearch: () =>
          | ((query: string) => Promise<Array<{ title: string; url: string }>>)
          | undefined;
      }
    ).resolveContentSearch();
    assert.ok(impl, 'managed search should exist without BYOK');
    const hits = await impl('2026 AI agent new releases');
    assert.equal(hits[0]?.url, 'https://example.com/ai-today');
    assert.match(seen[0] || '', /2026 AI agent new releases/);
  } finally {
    await runtime.stop();
  }
});
