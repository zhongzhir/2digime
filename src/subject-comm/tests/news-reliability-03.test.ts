import test from 'node:test';
import assert from 'node:assert/strict';
import { createSearchFallback, createDashScopeSearch, type SearchProviderEvidence } from '../../capability/supplemental-search';
import { selectSupply } from '../news-selection';
import { resolveContent } from '../content-resolution';
import type { DiscoverCard } from '../content-discover';

test('provider quota/auth failures fall through; failed providers are not hammered for the second query', async () => {
  let calls = 0; let rows: SearchProviderEvidence[] = [];
  const search = createSearchFallback([
    { id: 'quota', search: async () => { calls++; throw Object.assign(Error(), { status: 429 }); } },
    { id: 'auth', search: async () => { throw Object.assign(Error(), { status: 401 }); } },
    { id: 'absent' },
    { id: 'working', search: async () => [{ title: 'Grounded', url: 'https://publisher.example/story' }] },
  ], value => { rows = value; });
  assert.equal((await search('public query')).length, 1);
  assert.deepEqual(rows.map(r => r.status), ['RATE_LIMITED', 'FAILED', 'UNCONFIGURED', 'AVAILABLE']);
  await search('another public query'); assert.equal(calls, 1);
  const unavailable = createSearchFallback([{ id: 'absent' }, { id: 'failed', search: async () => { throw Error(); } }], () => {});
  assert.deepEqual(await unavailable('public query'), []);
});

test('DashScope only consumes provider search metadata, never generated links in prose', async () => {
  const search = createDashScopeSearch('test-only', async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    assert.equal(request.parameters.enable_search, true);
    assert.equal(request.parameters.search_options.enable_source, true);
    return new Response(JSON.stringify({ output: { choices: [{ message: { content: 'https://invented.example' } }],
      search_info: { search_results: [{ title: 'Evidence', url: 'https://publisher.example' }, { title: 'bad', url: 'file:///private' }] } } }));
  });
  assert.deepEqual(await search('public'), [{ title: 'Evidence', url: 'https://publisher.example' }]);
});

test('two-stage selection bounds model input; one length failure does not empty the pool', async () => {
  const cards: DiscoverCard[] = Array.from({ length: 120 }, (_, i) => ({ itemId: `c${i}`, title: `Story ${i}`,
    url: `https://publisher.example/${i}`, text: 'Public material', reason: '' }));
  let stage1Seen = 0; let failed = false;
  const result = await selectSupply({ cards, query: 'Relevant articles', selfContext: '', preferences: '',
    model: { baseUrl: '', model: '' }, resolve: false,
    chatComplete: async options => {
      const sys = String(options.messages[0]?.content || '');
      const input = JSON.parse(options.messages[1]!.content) as { candidates: unknown[] };
      if (!sys.includes('groups') && sys.includes('"selected"')) {
        assert.ok(input.candidates.length <= 20);
        assert.ok((options.maxTokens || 0) <= 4096);
        stage1Seen += input.candidates.length;
        if (!failed) { failed = true; return { text: '', finishReason: 'length', truncated: true }; }
        return { text: JSON.stringify({ selected: input.candidates.map((_, i) => ({ id: i, type: 'article' })) }) };
      }
      assert.ok(input.candidates.length <= 12);
      return { text: JSON.stringify({ groups: input.candidates.map((_, i) => ({ ids: [i], type: 'article', reason: 'Relevant' })) }) };
    },
  });
  // The failed batch is split and retried, so every candidate is still presented to the model.
  assert.ok(stage1Seen >= 120);
  assert.ok(result.length >= 1 && result.length <= 12);
  assert.ok(result.every(c => cards.some(source => source.url === c.url)));
});

test('canonical duplicate keeps the richer feed provenance instead of the first occurrence', async () => {
  const cards: DiscoverCard[] = [
    { itemId: 'dir', title: 'Same story', text: '', reason: '', url: 'https://publisher.example/x', contentType: 'news', publishedAt: '2026-09-24T06:56:32.000Z' },
    { itemId: 'feed', title: 'Same story', text: '', reason: '', url: 'https://publisher.example/x', contentType: 'news', publishedAt: '2026-09-24T06:56:32.000Z',
      sourceFeedTimestamp: '2026-09-24T06:56:32.000Z', dateProvenance: { feed: 'https://publisher.example/feed' } },
  ];
  await selectSupply({ cards, query: 'today', selfContext: '', preferences: '', model: { baseUrl: '', model: '' }, resolve: false,
    chatComplete: async options => {
      const sys = String(options.messages[0]?.content || '');
      const input = JSON.parse(options.messages[1]!.content);
      if (!sys.includes('groups') && sys.includes('"selected"')) {
        assert.equal(input.candidates.length, 1);
        assert.equal(input.candidates[0].sourceFeedTimestamp, '2026-09-24T06:56:32.000Z');
        return { text: JSON.stringify({ selected: [{ id: 0, type: 'news' }] }) };
      }
      return { text: '{"groups":[]}' };
    } });
});

test('a same-event group survives when only a non-first member carries a valid date', async () => {
  const cards: DiscoverCard[] = [
    { itemId: 'u', title: 'Undated wire snippet', text: 'x', reason: '', url: 'https://wire.example/a', contentType: 'news' },
    { itemId: 'd', title: 'Dated report', text: 'y', reason: '', url: 'https://paper.example/b', contentType: 'news', publishedAt: '2026-09-24T06:00:00.000Z' },
  ];
  const selected = await selectSupply({ cards, query: 'today event', selfContext: '', preferences: '',
    model: { baseUrl: '', model: '' }, resolve: false,
    chatComplete: async options => {
      const sys = String(options.messages[0]?.content || '');
      assert.equal(JSON.parse(options.messages[1]!.content).candidates.length, 2);
      return !sys.includes('groups')
        ? { text: JSON.stringify({ selected: [{ id: 0, type: 'news' }, { id: 1, type: 'news' }] }) }
        : { text: JSON.stringify({ groups: [{ ids: [0, 1], type: 'news', reason: 'same event' }] }) };
    } });
  assert.equal(selected.length, 1);
  assert.equal(selected[0]?.itemId, 'd');
  assert.equal(selected[0]?.sources?.length, 2);
});

test('original publication is reconciled even when feed already supplies full body; all dates retain provenance', async () => {
  const feedDate = '2026-09-24T04:15:24.000Z';
  const original = '2026-09-10T06:38:03.000Z';
  const card: DiscoverCard = { itemId: 'old', title: 'Republished article', text: '', reason: '', url: 'https://publisher.example/old',
    publishedAt: feedDate, sourceFeedTimestamp: feedDate, discoveredAt: '2026-09-24T06:00:00Z', dateProvenance: { feed: 'https://publisher.example/feed' },
    representation: { kind: 'article', canonicalUrl: 'https://publisher.example/old', bodyText: 'Public full feed body', provenance: 'feed:https://publisher.example/feed', resolvedAt: feedDate } };
  const resolved = await resolveContent(card, async url => ({ status: 200, finalUrl: url,
    body: url.endsWith('/robots.txt') ? 'User-agent: *\nAllow: /' : `<script type="application/ld+json">{"@type":"Article","datePublished":"${original}","dateModified":"${feedDate}"}</script><article><p>Original</p></article>` }));
  assert.equal(resolved.originalPublishedAt, original);
  assert.equal(resolved.publishedAt, feedDate);
  assert.equal(resolved.sourceFeedTimestamp, feedDate);
  assert.equal(resolved.discoveredAt, card.discoveredAt);
  assert.equal(resolved.updatedAt, feedDate);
  assert.ok(resolved.dateProvenance?.original?.includes('publisher.example/old'));
  const selected = await selectSupply({ cards: [resolved], query: 'Today news', selfContext: '', preferences: '',
    model: { baseUrl: '', model: '' }, resolve: false, chatComplete: async options => {
      const sys = String(options.messages[0]?.content || '');
      const c = JSON.parse(options.messages[1]!.content).candidates[0];
      assert.equal(c.publishedAt, original); assert.equal(c.sourceFeedTimestamp, feedDate);
      return !sys.includes('groups') ? { text: '{"selected":[]}' } : { text: '{"groups":[]}' };
    } });
  assert.deepEqual(selected, []);
});
