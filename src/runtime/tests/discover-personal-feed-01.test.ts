import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createDigitalMeRuntime } from '../digitalme-runtime';
import { createCommandBus } from '../command-bus';
import { FileNetworkItemStore } from '../../relay-service/network-item-store';
import { writeDigitalSelf } from '../../subject-core/digital-self/store';
import { digitalSelfBytes } from '../../subject-comm/content-discover';
import { listRecentRecommendationEvents } from '../../subject-comm/recent-recommendation-state';
import { FEED_01_SEED_ITEMS } from '../../subject-comm/tests/subject-network-feed-01-seed';
import type { DigitalSelf } from '../../subject-core/digital-self/types';

function selfOf(subjectId: string): DigitalSelf {
  const now = '2026-09-18T00:00:00.000Z';
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

function showAllChat() {
  return async ({ messages }: { messages: Array<{ content?: string }> }) => {
    const blob = messages.map((row) => String(row.content || '')).join('\n');
    if (blob.includes('拟定内容发现方向') || blob.includes('拟定公开网页搜索词')) {
      return {
        text: '{"intents":[{"topic":"fusion energy","contentTypes":["article"],"purpose":"learn","freshness":"current","explorationMode":"core","searchQuery":"fusion energy progress"}]}',
      };
    }
    const ids = [...blob.matchAll(/"itemId"\s*:\s*"(ni_[^"]+)"/g)].map((row) => row[1]!);
    return {
      text: JSON.stringify({
        decisions: [...new Set(ids)].map((itemId) => ({
          itemId,
          decision: 'show',
          reason: '与你关心的公开科学进展有关',
        })),
      }),
    };
  };
}

async function hashSelf(pkgDir: string): Promise<string> {
  return createHash('sha256')
    .update((await digitalSelfBytes(pkgDir))!)
    .digest('hex');
}

test('Discover command keeps last feed on search auth failure and does not rewrite Digital Self', async () => {
  const pkgDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'dm-personal-feed-rt-')), 'pkg');
  let failSearch = false;
  const runtime = createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    searchCapability: false,
    contentChat: showAllChat(),
    contentSearch: async () => {
      if (failSearch) {
        throw Object.assign(new Error('invalid api key'), { status: 401, kind: 'unauthorized' });
      }
      return [];
    },
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', { displayName: '个人发现', targetDir: pkgDir });
  const overview = await bus.invoke('subject.getOverview', {});
  await writeDigitalSelf(pkgDir, selfOf(overview.subjectId));
  const store = new FileNetworkItemStore(path.join(pkgDir, 'content'));
  for (const item of FEED_01_SEED_ITEMS.slice(0, 8)) await store.put(item);
  const before = await hashSelf(pkgDir);
  const first = await bus.invoke('content', { action: 'discover' });
  assert.ok(first.view.cards.length >= 4, 'expected a personal feed from local directory');
  assert.equal(
    first.view.reasonCode === 'CACHED_FEED' ||
      first.view.reasonCode === 'REPLENISHED' ||
      first.view.reasonCode === 'LOCAL_DIRECTORY',
    true,
  );
  failSearch = true;
  const refreshed = await bus.invoke('content', { action: 'refresh' });
  assert.ok(refreshed.view.cards.length >= 1);
  assert.match(String(refreshed.view.notice || ''), /暂时无法|检查连接|检查联网/);
  assert.equal(/NETWORK_AUTH_FAILED|CACHED_FEED/.test(String(refreshed.view.notice || '')), false);

  const openedId = first.view.cards[0]!.itemId;
  await bus.invoke('content', { action: 'open', itemId: openedId });
  await bus.invoke('content', { action: 'asked', itemId: openedId });
  const emptySeek = await bus.invoke('content', { action: 'seek', text: '' });
  assert.ok(emptySeek.view.cards.length >= 1, 'empty seek must fall back to personal feed, not refuse');
  const recent = await listRecentRecommendationEvents(pkgDir);
  assert.equal(recent.some((row) => row.type === 'opened' && row.itemId === openedId), true);
  assert.equal(recent.some((row) => row.type === 'asked_2digime'), true);
  await bus.invoke('content', { action: 'resetRecent' });
  assert.equal((await listRecentRecommendationEvents(pkgDir)).length, 0);
  assert.equal(await hashSelf(pkgDir), before);
  await runtime.stop();
});

test('UI empty copy is projected from notice, not a hardcoded Settings lie', async () => {
  const html = await fs.readFile(path.join(process.cwd(), 'electron/renderer/index.html'), 'utf8');
  assert.match(html, /id="content-discover-empty-text"/);
  assert.equal(/开启联网发现后，这里会按你的数字之我挑选内容/.test(html), false);
  const js = await fs.readFile(path.join(process.cwd(), 'electron/renderer/content-discover.js'), 'utf8');
  assert.match(js, /emptyText.textContent/);
  assert.equal(js.includes('view.reasonCode'), false);
  assert.match(js, /action: 'refresh'/);
  assert.match(js, /action: 'replenish'/);
  assert.match(js, /兔机米正在准备一些值得看的内容/);
  assert.equal(js.includes('目前还没有可展示的内容'), false);
  assert.equal(html.includes('目前还没有可展示的内容'), false);
  assert.match(js, /resetRecent/);
});
