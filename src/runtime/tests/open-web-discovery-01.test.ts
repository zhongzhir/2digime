import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../digitalme-runtime';
import { createCommandBus } from '../command-bus';
import { FileNetworkItemStore } from '../../relay-service/network-item-store';
import { writeDigitalSelf } from '../../subject-core/digital-self/store';
import type { DigitalSelf } from '../../subject-core/digital-self/types';

function selfOf(subjectId: string): DigitalSelf {
  const now = '2026-09-15T00:00:00.000Z';
  return {
    schemaVersion: 1,
    subjectId,
    updatedAt: now,
    understandings: [
      {
        id: 'u_1',
        text: '我长期关心核聚变研究进展。',
        facet: 'goals',
        status: 'current',
        confirmed: true,
        provenance: { origin: 'user_statement', actor: 'owner', statedAt: now },
        updatedAt: now,
      },
    ],
  };
}

test('Discover cold start uses search queries, not Digital Self, and indexes web hits', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-open-web-rt-'));
  const pkgDir = path.join(root, 'pkg');
  const searchQueries: string[] = [];
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    contentChat: async ({ messages }) => {
      const blob = messages.map((row) => String(row.content || '')).join('\n');
      if (blob.includes('拟定公开网页搜索词')) {
        return { text: '{"queries":["fusion energy progress"]}' };
      }
      const ids = [...blob.matchAll(/"itemId"\s*:\s*"(ni_[^"]+)"/g)].map((row) => row[1]!);
      const unique = [...new Set(ids)];
      return {
        text: JSON.stringify({
          decisions: unique.map((itemId) => ({
            itemId,
            decision: 'show',
            reason: '与你关心的公开科学进展有关',
          })),
        }),
      };
    },
    contentSearch: async (query) => {
      searchQueries.push(query);
      assert.equal(/核聚变研究进展|self\.json|preferencevector/i.test(query), false);
      return [{ title: 'Public fusion note', url: 'https://example.org/fusion-open', snippet: 'A public lab update.' }];
    },
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '公开网', targetDir: pkgDir });
  const overview = await bus.invoke('subject.getOverview', {});
  await writeDigitalSelf(pkgDir, selfOf(overview.subjectId));
  const discovered = await bus.invoke('content', { action: 'discover' });
  assert.ok(searchQueries.length >= 1);
  assert.equal(searchQueries.every((row) => !/核聚变研究进展/.test(row)), true);
  const store = new FileNetworkItemStore(path.join(pkgDir, 'content'));
  const listed = await store.list({ kind: 'content', limit: 20 }, new Date().toISOString());
  assert.equal(listed.items.some((item) => item.content.url === 'https://example.org/fusion-open'), true);
  assert.equal(listed.items.some((item) => item.provenance.via === 'search'), true);
  assert.equal(JSON.stringify(listed.items).includes('preferencevector'), false);
  assert.equal(discovered.view.cards.some((card) => card.url === 'https://example.org/fusion-open'), true);
  await runtime.stop();
});

test('networking disabled does not call external search on Discover', async () => {
  const pkgDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dm-open-web-off-')), 'pkg');
  const prevGemini = process.env.GEMINI_API_KEY;
  const prevModel = process.env.GEMINI_SEARCH_MODEL;
  const prevGeminiModel = process.env.GEMINI_MODEL;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_SEARCH_MODEL;
  delete process.env.GEMINI_MODEL;
  try {
    const runtime = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      searchCapability: false,
      contentChat: async () => ({ text: '{"decisions":[]}' }),
    });
    const bus = createCommandBus(runtime);
    await bus.invoke('subject.createPackage', { displayName: '离线发现', targetDir: pkgDir });
    const view = await bus.invoke('content', { action: 'discover' });
    assert.match(view.view.notice, /开启联网发现/);
    assert.equal(view.view.cards.length, 0);
    await runtime.stop();
  } finally {
    if (prevGemini) process.env.GEMINI_API_KEY = prevGemini;
    if (prevModel) process.env.GEMINI_SEARCH_MODEL = prevModel;
    if (prevGeminiModel) process.env.GEMINI_MODEL = prevGeminiModel;
  }
});
