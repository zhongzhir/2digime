import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestSource } from '../content-ingest';
import { MemoryNetworkItemStore } from '../../relay-service/network-item-store';
import { resolveContent } from '../content-resolution';
import { selectSupply } from '../news-supply';
import { parsePageMetadata } from '../page-metadata';
import { parseJsonFeed, parseXmlFeed } from '../content-feed';
import type { DiscoverCard } from '../content-discover';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { JSDOM } from 'jsdom';

test('formal renderer exposes plain-text reading and passes quoted body only on explicit Ask', async () => {
  const html = await fs.readFile('electron/renderer/index.html', 'utf8');
  const script = await fs.readFile('electron/renderer/content-discover.js', 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://local.invalid' });
  try {
    let asked: { bodyText?: string } | undefined;
    const window = dom.window as unknown as {
      digitalMe: unknown; TalkPage: unknown; ContentDiscoverPage: { renderView: (view: unknown) => void }; eval: (code: string) => void;
    };
    window.digitalMe = { invoke: async () => ({}) };
    window.TalkPage = { setContentContext: (context: { bodyText?: string }) => { asked = context; } };
    window.eval(script);
    const body = 'Public article <script>window.attacked=true</script>';
    window.ContentDiscoverPage.renderView({ headline:'发现', lead:'', notice:'', preferences:[], cards:[{
      ...card, contentType:'news', publishedAt:'2026-09-23T10:00:00Z', publisherDisplayName:'Publisher',
      representation:{kind:'news',canonicalUrl:card.url,bodyText:body,provenance:'readability',resolvedAt:new Date().toISOString()},
    }] });
    const reader = [...dom.window.document.querySelectorAll('summary')].find(node => node.textContent === '直接阅读');
    assert.ok(reader);
    assert.ok(reader.parentElement?.textContent?.includes(body));
    assert.equal(reader.parentElement?.querySelector('script'), null);
    assert.equal(asked, undefined);
    const ask = [...dom.window.document.querySelectorAll('button')].find(node => node.textContent === '问兔机米');
    assert.ok(ask); ask.click();
    assert.equal((asked as {bodyText?:string}|undefined)?.bodyText, body);
  } finally { dom.window.close(); }
});

test('reingest preserves publisher date; acquisition time never replaces unknown publication', async () => {
  const store = new MemoryNetworkItemStore();
  const sourceUrl = 'https://publisher.example/feed';
  const fetchImpl = async () => ({
    status: 200,
    finalUrl: sourceUrl,
    body: '<rss><channel><title>Publisher</title><item><title>Real event</title><link>https://publisher.example/item/1</link><pubDate>Wed, 23 Sep 2026 10:00:00 GMT</pubDate></item><item><title>Undated</title><link>https://publisher.example/item/2</link></item></channel></rss>',
  });
  await ingestSource({ sourceUrl, store, fetchImpl });
  const again = await ingestSource({ sourceUrl, store, fetchImpl });
  assert.equal(again.items[0]?.content.publishedAt, '2026-09-23T10:00:00.000Z');
  assert.equal(again.items[1]?.content.publishedAt, undefined);
});

test('NewsArticle remains news; feed full content is independent of summary', () => {
  const meta = parsePageMetadata(
    '<script type="application/ld+json">{"@type":"NewsArticle","headline":"Event","datePublished":"2026-09-23T10:00:00Z"}</script>',
    'https://publisher.example/item',
  );
  assert.equal(meta.contentType, 'news');
  const rss = parseXmlFeed(
    '<rss><channel><title>P</title><item><title>T</title><link>https://publisher.example/1</link><description>Summary</description><content:encoded><![CDATA[<p>Full body</p>]]></content:encoded></item></channel></rss>',
  );
  assert.equal(rss?.items[0]?.bodyText, '<p>Full body</p>');
  const json = parseJsonFeed(
    JSON.stringify({
      version: 'https://jsonfeed.org/version/1.1',
      title: 'P',
      items: [
        {
          id: 'https://publisher.example/1',
          title: 'T',
          summary: 'Short',
          content_text: 'Full content',
        },
      ],
    }),
  );
  assert.ok('items' in json && json.items[0]?.bodyText === 'Full content');
});

const card: DiscoverCard = {
  itemId: 'n1',
  title: 'Article',
  text: 'Summary',
  url: 'https://publisher.example/a',
  reason: '',
};

test('network discovery opt-out does not call direct feeds or search', async () => {
  const root=path.join(await fs.mkdtemp(path.join(os.tmpdir(),'news-offline-test-')),'package');
  let externalCalls=0;
  const runtime=createDigitalMeRuntime({registerOpenAiStub:false,webDiscoveryEnabled:false,
    contentCandidateSupply:async()=>{externalCalls++;return [];},
    contentSearch:async()=>{externalCalls++;return [];},
  });
  const bus=createCommandBus(runtime);
  await bus.invoke('subject.createPackage',{displayName:'Offline',targetDir:root});
  await bus.invoke('content',{action:'seek',text:'Current news'});
  assert.equal(externalCalls,0);
});
test('resolver refuses restricted pages and robots, returns only inert plain text', async () => {
  let requests = 0;
  const denied = await resolveContent(
    { ...card, access: 'subscriptionRequired' },
    async () => {
      requests++;
      throw Error();
    },
  );
  assert.equal(requests, 0);
  assert.equal(denied.representation?.kind, 'external');
  const robot = await resolveContent(card, async (url) => ({
    status: 200,
    finalUrl: url,
    body: 'User-agent: *\nDisallow: /',
  }));
  assert.equal(robot.representation?.bodyText, undefined);
  const paywall = await resolveContent(card, async (url) => ({
    status: 200,
    finalUrl: url,
    body: url.endsWith('robots.txt')
      ? 'User-agent: *\nAllow: /'
      : '<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script><article>Secret subscription content</article>',
  }));
  assert.equal(paywall.representation?.bodyText, undefined);
  const article = await resolveContent(card, async (url) => ({
    status: 200,
    finalUrl: url,
    body: url.endsWith('robots.txt')
      ? 'User-agent: *\nAllow: /'
      : `<html><title>Article</title><body><article><h1>Article</h1><p>${'Public article text. '.repeat(80)}</p><script>throw Error('must not execute')</script></article></body></html>`,
  }));
  assert.ok(article.representation?.bodyText?.includes('Public article text.'));
  assert.ok(!article.representation?.bodyText?.includes('<script>'));
});

test('selection can only reference supplied candidates, clusters retain sources, undated news rejected', async () => {
  const cards = [
    { ...card, publishedAt: '2026-09-23T10:00:00Z' },
    {
      ...card,
      itemId: 'n2',
      url: 'https://second.example/b',
      publishedAt: '2026-09-23T11:00:00Z',
    },
    { ...card, itemId: 'n3', url: 'https://third.example/c' },
  ];
  const result = await selectSupply({
    cards,
    query: 'Recent news',
    selfContext: '',
    preferences: '',
    model: { baseUrl: '', model: '' },
    resolve: false,
    chatComplete: async () => ({
      text: JSON.stringify({
        groups: [
          { ids: [0, 0, 1, 999], type: 'news', reason: 'same event' },
          { ids: [2], type: 'news', reason: 'invalid date' },
        ],
      }),
    }),
  });
  assert.equal(result.length, 1);
  assert.equal(result[0]?.sources?.length, 2);
  assert.equal(result[0]?.url, card.url);
  await assert.rejects(
    selectSupply({
      cards,
      query: 'news',
      selfContext: '',
      preferences: '',
      model: { baseUrl: '', model: '' },
      resolve: false,
      chatComplete: async () => ({ text: 'invalid' }),
    }),
  );
});

test('formal command joins direct supply and search, clusters locally and leaves Digital Self unchanged', async () => {
  const root = path.join(
    await fs.mkdtemp(path.join(os.tmpdir(), 'news-command-test-')),
    'package',
  );
  let supplyCalls = 0,
    searchCalls = 0;
  const supplied = {
    ...card,
    publishedAt: '2026-09-23T10:00:00Z',
    representation: {
      kind: 'news' as const,
      canonicalUrl: card.url!,
      bodyText: 'Already resolved public text',
      provenance: 'feed:https://publisher.example/feed',
      resolvedAt: new Date().toISOString(),
    },
  };
  const runtime = createDigitalMeRuntime({
    registerOpenAiStub: false,
    subjectUnderstanding: {
      enabled: true,
      model: {
        baseUrl: 'https://model.example',
        model: 'test',
        providerId: 'test',
      },
      chatComplete: async (options) => ({
        text: options.messages[0]?.content.includes('groups')
          ? JSON.stringify({
              groups: [
                {
                  ids: [0, 1],
                  type: 'news',
                  reason: 'Same event from two publishers',
                },
              ],
            })
          : JSON.stringify({
              mode: 'consume',
              topic: 'test',
              requestedContentTypes: ['news'],
              searchQueries: ['test'],
            }),
      }),
    },
    contentCandidateSupply: async () => {
      supplyCalls++;
      return [supplied];
    },
    contentSearch: async () => {
      searchCalls++;
      return [
        {
          title: 'Second report',
          url: 'https://second.example/event',
          snippet: 'Another source',
        },
      ];
    },
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', {
    displayName: 'Test',
    targetDir: root,
  });
  const selfPath = path.join(root, 'digital-self', 'self.json');
  const before = await fs.readFile(selfPath, 'utf8').catch(() => null);
  const result = await bus.invoke('content', {
    action: 'seek',
    text: 'Recent news',
  });
  assert.equal(result.view.cards.length, 1);
  assert.equal(result.view.cards[0]?.sources?.length, 2);
  assert.equal(result.view.cards[0]?.publishedAt, supplied.publishedAt);
  assert.equal(
    result.view.cards[0]?.representation?.bodyText,
    supplied.representation.bodyText,
  );
  assert.equal(supplyCalls, 1);
  assert.equal(searchCalls, 1);
  assert.equal(await fs.readFile(selfPath, 'utf8').catch(() => null), before);
});
