import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../digitalme-runtime';
import { createCommandBus } from '../command-bus';
import { FileNetworkItemStore } from '../../relay-service/network-item-store';
import { MemoryNetworkItemStore } from '../../relay-service/network-item-store';
import { ingestSource } from '../../subject-comm/content-ingest';
import type { ChatToolCall } from '../../infrastructure/model-http';

function toolCall(id: string, name: string, args: object): ChatToolCall {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

const RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Example Publisher</title>
    <item>
      <title>Fusion progress this week</title>
      <link>https://example.org/fusion</link>
      <description>A lab published new confinement results.</description>
    </item>
  </channel>
</rss>`;

test('Talk query hits directory; seek keeps provenance and can add web sources', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-content-seek-rt-'));
  const pkgDir = path.join(root, 'pkg');
  const ingested = await ingestSource({
    sourceUrl: 'https://example.org/feed.xml',
    store: new MemoryNetworkItemStore(),
    now: '2026-09-14T07:00:00.000Z',
    fetchImpl: async () => ({ status: 200, body: RSS, finalUrl: 'https://example.org/feed.xml' }),
  });
  let talkSawSource = false;
  let discoverRound = 0;
  let directoryCandidateId = '';
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    contentChat: async ({ messages }) => {
      discoverRound += 1;
      if (discoverRound === 1) {
        const sourceMessage = messages.find((row) => row.content.startsWith('【当前已建立 Source'));
        const candidates = JSON.parse(String(sourceMessage?.content || '').split('\n').slice(1).join('\n')) as Array<{
          candidateId: string;
          url: string;
        }>;
        directoryCandidateId = String(candidates.find((row) => row.url === 'https://example.org/fusion')?.candidateId || '');
        assert.ok(directoryCandidateId, 'the bounded Source window must reach the same final-selection model');
        return { text: '', toolCalls: [toolCall('search', 'web_search', { query: 'fusion progress' })] };
      }
      const payload = JSON.parse(String([...messages].reverse().find((row) => row.role === 'tool')?.content || '{}')) as {
        candidates?: Array<{ candidateId: string; url: string }>;
      };
      const webCandidateId = String(payload.candidates?.find((row) => /iaea\.org/i.test(row.url))?.candidateId || '');
      assert.ok(webCandidateId);
      return {
        text: '',
        toolCalls: [toolCall('present', 'present_results', {
          summary: '本地来源和新搜索结果都已核对到候选身份。',
          selections: [
            { candidateId: directoryCandidateId, why: '已有来源中的直接进展', placement: 'main' },
            { candidateId: webCandidateId, why: '公开机构补充材料', placement: 'related' },
          ],
        })],
      };
    },
    contentSearch: async () => [
      { title: 'IAEA fusion notes', url: 'https://www.iaea.org/topics/fusion', snippet: 'Public fusion overview.' },
    ],
    talkChat: async ({ messages }) => {
      const blob = messages.map((row) => String(row.content || '')).join('\n');
      if (blob.includes('https://example.org/fusion')) talkSawSource = true;
      return { text: '目录里有 Fusion progress this week，来源 https://example.org/fusion' };
    },
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', {
    displayName: '检索主体',
    targetDir: pkgDir,
  });
  const local = new FileNetworkItemStore(path.join(pkgDir, 'content'));
  for (const item of ingested.items) await local.put(item);

  const talked = await bus.invoke('talk', { text: '帮我找 fusion 进展' });
  assert.equal(talkSawSource, true);
  assert.match(talked.view.turns.map((turn) => turn.text).join('\n'), /example\.org\/fusion/);

  const sought = await bus.invoke('content', { action: 'seek', text: '帮我找 fusion 进展' });
  let view = sought.view;
  if (view.replenishing) {
    const gen = view.searchGenerationId;
    view = (
      await bus.invoke(
        'content',
        gen ? { action: 'replenish', searchGenerationId: gen } : { action: 'replenish' },
      )
    ).view;
  }
  assert.equal(view.cards.some((card) => card.url === 'https://example.org/fusion' && card.source === 'directory'), true);
  assert.equal(
    [...view.cards, ...(view.relatedCards || []), ...(view.unjudgedCards || [])]
      .some((card) => /iaea\.org/i.test(String(card.url || ''))),
    true,
  );
  await runtime.stop();
});
