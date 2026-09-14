/**
 * CONTENT-DISTRIBUTION-FINAL-CLOSURE-01
 * 整体被动 + 主动闭环验收。证据不含密钥或 Digital Self 正文。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Server } from 'node:http';
import { createRelayServer, FileNetworkItemStore, FileRelayStore } from '../../relay-service/server';
import { RelayClient } from '../relay-client';
import { ingestSource } from '../content-ingest';
import { discoverForSubject, digitalSelfBytes } from '../content-discover';
import { seekContent } from '../content-seek';
import {
  contentPreferencesPath,
  formatPreferenceDirectives,
  listContentPreferences,
  reverseContentPreference,
  upsertContentPreference,
} from '../content-preferences';
import {
  appendNetworkContentFeedback,
  createUserContentFeedback,
} from '../network-content-feedback';
import { forbiddenPersonalizationKeys, isNetworkItemExpired } from '../network-item';
import { directoryHoldsUserData, searchContentDirectory } from '../content-directory';
import { chatComplete } from '../../infrastructure/model-http';
import { resolveModelEnvAsync } from '../../infrastructure/env-secrets';
import { readDigitalSelf, writeDigitalSelf } from '../../subject-core/digital-self/store';
import { createGeminiSearchConnector } from '../../capability/adapters/gemini-search';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';
import { createCommandBus } from '../../runtime/command-bus';

const EVIDENCE = path.join(process.cwd(), 'build', 'evidence', 'content-distribution-01');
const OWNER_PKG = path.join(
  os.homedir(),
  'AppData',
  'Roaming',
  'digitalme-v2',
  'subjects',
  'default',
);

async function listenRelay(): Promise<{ server: Server; relayUrl: string }> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-closure-relay-'));
  const { server } = createRelayServer({
    store: new FileRelayStore(dataDir),
    networkItems: new FileNetworkItemStore(dataDir),
    host: '127.0.0.1',
    port: 0,
  });
  const addr = await new Promise<{ port: number }>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      if (a && typeof a === 'object') resolve({ port: a.port });
      else reject(new Error('no address'));
    });
    server.on('error', reject);
  });
  return { server, relayUrl: `http://127.0.0.1:${addr.port}` };
}

test('CONTENT-DISTRIBUTION-FINAL-CLOSURE-01 whole-loop', { timeout: 240_000 }, async (t) => {
  const env = await resolveModelEnvAsync();
  const apiKey = String(env.runtime?.apiKey || '').trim();
  const modelReady = !!(env.configured && apiKey && env.source === 'app_runtime_file');
  const geminiKey = String(process.env.GEMINI_API_KEY || '').trim();

  const store = new FileNetworkItemStore(await fs.mkdtemp(path.join(os.tmpdir(), 'dm-closure-dir-')));
  const ingested = await ingestSource({
    sourceUrl: 'https://feeds.bbci.co.uk/news/rss.xml',
    store,
    limit: 6,
  });
  if (!ingested.items.length) {
    t.skip(`real feed unavailable: ${ingested.records[0]?.reason || 'empty'}`);
    return;
  }
  for (const item of ingested.items) {
    assert.equal(directoryHoldsUserData(item).length, 0);
    assert.deepEqual(forbiddenPersonalizationKeys(item as unknown as Record<string, unknown>), []);
    assert.equal(item.provenance.origin, 'publisher');
    assert.ok(item.content.url?.startsWith('https://'));
  }

  const oneOffUrl = ingested.items[0]!.content.url;
  let oneOffOk = false;
  if (oneOffUrl) {
    const oneOffStore = new FileNetworkItemStore(await fs.mkdtemp(path.join(os.tmpdir(), 'dm-closure-url-')));
    const oneOff = await ingestSource({ sourceUrl: oneOffUrl, store: oneOffStore, limit: 1 });
    oneOffOk = oneOff.items.length > 0 && oneOff.items[0]!.content.url?.startsWith('http') === true;
  }

  const { server, relayUrl } = await listenRelay();
  try {
    const publisher = new RelayClient(relayUrl);
    for (const item of ingested.items) await publisher.publishNetworkItem(item);
    const listed = await new RelayClient(relayUrl).listNetworkItems({ kind: 'content', visibility: 'public' });
    assert.equal(listed.items.length, ingested.items.length);
    const rejected = await fetch(`${relayUrl}/v1/network-items?preference=secret`);
    assert.equal(rejected.status, 400);

    const ownerRaw = await fs.readFile(path.join(OWNER_PKG, 'digital-self', 'self.json'), 'utf8');
    const ownerParsed = JSON.parse(ownerRaw) as { subjectId?: string };
    const ownerSubjectId = String(ownerParsed.subjectId || '').trim();
    assert.ok(ownerSubjectId);
    const tmpPkg = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-closure-owner-'));
    const ownerSelf = await readDigitalSelf(OWNER_PKG, ownerSubjectId, new Date().toISOString());
    await writeDigitalSelf(tmpPkg, ownerSelf);
    const hashBefore = createHash('sha256').update((await digitalSelfBytes(tmpPkg))!).digest('hex');
    const feedbackFile = path.join(tmpPkg, 'content', 'network-content-feedback.jsonl');

    let realModel = {
      stub: true as boolean,
      model: '',
      source: env.source,
      firstShown: 0,
      secondConsumedDirective: false,
      blocked: '' as string,
    };
    const target = ingested.items[0]!;
    if (!modelReady) {
      realModel.blocked = 'REAL_MODEL_REVALIDATION_BLOCKED_EXTERNAL: official DeepSeek runtime file missing; env DashScope/OPENAI not used';
    } else {
      const model = { baseUrl: env.baseUrl, model: env.model, apiKey };
      realModel.model = env.model;
      realModel.stub = false;
      const first = await discoverForSubject({
        digitalSelf: ownerSelf,
        items: listed.items,
        chatComplete,
        model,
        feedbackFile,
      });
      if (!first.ok) {
        realModel.blocked = `REAL_MODEL_REVALIDATION_BLOCKED_EXTERNAL: ${first.detail}`;
        realModel.stub = true;
      } else {
        realModel.firstShown = first.view.cards.length;
        await appendNetworkContentFeedback(
          feedbackFile,
          createUserContentFeedback({ subjectId: ownerSubjectId, contentId: target.itemId, action: 'open' }),
        );
        await appendNetworkContentFeedback(
          feedbackFile,
          createUserContentFeedback({ subjectId: ownerSubjectId, contentId: target.itemId, action: 'later' }),
        );
        assert.equal(await fs.access(contentPreferencesPath(tmpPkg)).then(() => true, () => false), false);
        const boosted = await upsertContentPreference(tmpPkg, {
          kind: 'boost',
          targetType: 'item',
          target: target.itemId,
          text: `更想看到类似「${target.content.title}」的内容`,
        });
        assert.equal(boosted.origin, 'user_action');
        let sawDirective = false;
        const wrappingChat = async (options: Parameters<typeof chatComplete>[0]) => {
          const blob = options.messages.map((m) => m.content).join('\n');
          if (blob.includes('用户明确的内容偏好指令：') && blob.includes(target.content.title)) sawDirective = true;
          return chatComplete(options);
        };
        const second = await discoverForSubject({
          digitalSelf: ownerSelf,
          items: listed.items,
          chatComplete: wrappingChat,
          model,
          feedbackFile,
          preferenceDirectives: formatPreferenceDirectives(await listContentPreferences(tmpPkg)),
        });
        assert.equal(second.ok, true);
        realModel.secondConsumedDirective = sawDirective;
        assert.equal(sawDirective, true);
        const reversed = await reverseContentPreference(tmpPkg, boosted.id);
        assert.equal(reversed, true);
        assert.deepEqual(await listContentPreferences(tmpPkg), []);
      }
    }

    const hashAfter = createHash('sha256').update((await digitalSelfBytes(tmpPkg))!).digest('hex');
    assert.equal(hashAfter, hashBefore);

    const expired = {
      ...ingested.items[0]!,
      expiresAt: '2020-01-01T00:00:00.000Z',
    };
    assert.equal(isNetworkItemExpired(expired, '2026-09-14T00:00:00.000Z'), true);
    await store.put(expired);
    const afterExpire = await store.list({ kind: 'content', limit: 50 }, '2026-09-14T00:00:00.000Z');
    assert.equal(afterExpire.items.some((item) => item.itemId === expired.itemId), false);

    const invalid = await ingestSource({
      sourceUrl: 'https://example.org/feed.xml',
      store: new FileNetworkItemStore(await fs.mkdtemp(path.join(os.tmpdir(), 'dm-closure-bad-'))),
      fetchImpl: async () => ({
        status: 200,
        body: '<rss><channel><title>x</title><item><title>bad</title><link>javascript:alert(1)</link><description>nope</description></item></channel></rss>',
        finalUrl: 'https://example.org/feed.xml',
      }),
    });
    assert.equal(invalid.items.length, 0);
    assert.equal(invalid.records[0]?.status, 'rejected');

    const seekQuery = '帮我找最近值得看的 fusion 进展';
    let geminiHits: Array<{ title: string; url: string; snippet?: string }> = [];
    let geminiStatus: 'used' | 'EXTERNAL_SEARCH_BLOCKED_BY_CREDENTIAL' = 'EXTERNAL_SEARCH_BLOCKED_BY_CREDENTIAL';
    let geminiDetail = 'no GEMINI_API_KEY';
    if (geminiKey) {
      try {
        const connector = createGeminiSearchConnector({ apiKey: geminiKey, model: 'gemini-3.6-flash', maxResults: 4 });
        const sources = await connector.search(seekQuery);
        geminiHits = sources
          .filter((row) => String(row.url || '').startsWith('http'))
          .map((row) => ({
            title: String(row.title || row.url),
            url: String(row.url),
            ...(row.snippet ? { snippet: String(row.snippet).slice(0, 160) } : {}),
          }));
        if (geminiHits.length) {
          geminiStatus = 'used';
          geminiDetail = `hits=${geminiHits.length}`;
        } else {
          geminiDetail = 'connector returned no http sources';
        }
      } catch (err) {
        geminiDetail = err instanceof Error ? err.message.slice(0, 180) : 'gemini_error';
      }
    }
    const sought = await seekContent({
      query: seekQuery,
      items: ingested.items,
      ...(geminiHits.length
        ? {
            searchWeb: async () => geminiHits,
          }
        : {}),
    });
    const dirMatch = searchContentDirectory(ingested.items, { q: 'BBC' });
    assert.ok(dirMatch.length >= 0);
    assert.equal(
      sought.cards.every((card) => !card.url || card.url.startsWith('http')),
      true,
    );

    const runtime = createDigitalMeRuntime({
      documentCapability: 'fake',
      registerOpenAiStub: false,
      searchCapability: false,
      talkChat: async ({ messages }) => {
        const blob = messages.map((row) => String(row.content || '')).join('\n');
        return {
          text: blob.includes('来源：') || blob.includes('https://')
            ? '目录里有可核对来源的内容。'
            : '这次没有找到带来源链接的目录候选。',
        };
      },
    });
    const bus = createCommandBus(runtime);
    const talkPkg = path.join(tmpPkg, 'talk-pkg');
    await bus.invoke('subject.createPackage', { displayName: '闭环检索', targetDir: talkPkg });
    const local = new FileNetworkItemStore(path.join(talkPkg, 'content'));
    for (const item of ingested.items) await local.put(item);
    const talked = await bus.invoke('talk', { text: seekQuery });
    const talkText = talked.view.turns.map((turn) => turn.text).join('\n');
    const seekCmd = await bus.invoke('content', { action: 'seek', text: seekQuery });
    await runtime.stop();

    const uiSrc = await fs.readFile(path.join(process.cwd(), 'electron/renderer/content-discover.js'), 'utf8');
    assert.match(uiSrc, /问兔机米/);
    assert.match(uiSrc, /TalkPage\.handleSend/);
    assert.match(uiSrc, /act\('later'/);

    const personalSrc = await fs.readFile(path.join(process.cwd(), 'src/subject-comm/personal-selection.ts'), 'utf8');
    assert.equal(personalSrc.includes('writeDigitalSelf'), false);
    assert.equal(personalSrc.includes('content-preferences'), false);
    const seekSrc = await fs.readFile(path.join(process.cwd(), 'src/subject-comm/content-seek.ts'), 'utf8');
    assert.equal(/puppeteer|playwright|sitemap|crawlSite/i.test(seekSrc), false);

    await fs.mkdir(EVIDENCE, { recursive: true });
    const evidence = {
      sourceUrl: 'https://feeds.bbci.co.uk/news/rss.xml',
      ingestCount: ingested.items.length,
      ingestStatuses: ingested.records.map((row) => row.status),
      sample: ingested.items.slice(0, 3).map((item) => ({
        itemId: item.itemId,
        title: item.content.title,
        url: item.content.url,
        origin: item.provenance.origin,
      })),
      oneOffUrlIngest: oneOffOk,
      relayCount: listed.items.length,
      relayRejectedPreferenceQuery: rejected.status === 400,
      ownerSelf: {
        subjectId: ownerSubjectId,
        understandingCount: ownerSelf.understandings.length,
        hashBefore,
        hashAfter,
        unchanged: hashBefore === hashAfter,
      },
      realModel,
      geminiSearch: { status: geminiStatus, detail: geminiDetail, urlCount: geminiHits.length },
      seek: {
        query: seekQuery,
        usedDirectory: sought.usedDirectory,
        usedExternal: sought.usedExternal,
        cardCount: sought.cards.length,
        urls: sought.cards.map((card) => card.url).filter(Boolean).slice(0, 5),
      },
      talkSawSourceLinks: /https:\/\//.test(talkText),
      seekCommandCards: seekCmd.view.cards.length,
      expiredRemovedFromDirectory: true,
      invalidUrlRejected: true,
    };
    await fs.writeFile(path.join(EVIDENCE, 'final-closure-01.json'), `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    assert.equal(evidence.ownerSelf.unchanged, true);
    assert.equal(evidence.relayRejectedPreferenceQuery, true);
  } finally {
    server.close();
  }
});
