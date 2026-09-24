// Formal content command boundary, real models and public network. No fixture/stub.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
const { createCommandBus } = require('../dist/runtime/command-bus');
const { chatComplete } = require('../dist/infrastructure/model-http');
const { acquirePublicFeeds } = require('../dist/subject-comm/news-supply');
const {
  FileNetworkItemStore,
} = require('../dist/relay-service/network-item-store');
const {
  createGeminiSearchConnector,
} = require('../dist/capability/adapters/gemini-search');
(async () => {
  const credential = JSON.parse(
    await fs.readFile(process.env.DIGITALME_MODEL_RUNTIME_FILE, 'utf8'),
  );
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'news-supply-live-'));
  const pkg = path.join(root, 'subject');
  let calls = 0;
  const modelEvidence = [];
  const searchEvidence = [];
  const search = createGeminiSearchConnector({
    apiKey: process.env.GEMINI_API_KEY,
  });
  const runtime = createDigitalMeRuntime({
    registerOpenAiStub: false,
    subjectUnderstanding: {
      enabled: true,
      model: {
        baseUrl: credential.baseUrl,
        model: credential.model,
        providerId: credential.providerId,
      },
      chatComplete: async (options) => {
        calls++;
        const result = await chatComplete({
          ...options,
          apiKey: credential.apiKey,
        });
        modelEvidence.push({
          call: calls,
          finishReason: result.finishReason,
          text: result.text,
        });
        return result;
      },
    },
    geminiSearchApiKey: process.env.GEMINI_API_KEY,
    webDiscoveryPath: 'byok',
    contentSearch: async (query) => {
      try {
        const hits = await search.search(query);
        searchEvidence.push({ query, count: hits.length });
        return hits;
      } catch (e) {
        searchEvidence.push({ query, error: e.kind, status: e.status });
        throw e;
      }
    },
    contentCandidateSupply: () =>
      acquirePublicFeeds(new FileNetworkItemStore(path.join(pkg, 'content'))),
  });
  const bus = createCommandBus(runtime);
  await bus.invoke('subject.createPackage', {
    displayName: '新闻供给验收',
    targetDir: pkg,
  });
  const queries = [
    '今天 AI 有什么重要新闻？',
    '最近有哪些关于具身智能的重要消息？',
    '找一篇少数派最近的普通图文文章，直接阅读正文',
    '找一个机核的音频节目听听',
  ];
  const rows = [];
  for (const query of queries) {
    console.log('START', query);
    const at = Date.now();
    try {
      const result = await bus.invoke('content', {
        action: 'seek',
        text: query,
      });
      const view = result.view;
      rows.push({
        query,
        ms: Date.now() - at,
        modelCalls: calls,
        notice: view.notice,
        trace: view.supplyTrace,
        candidates: view.seekTrace?.rawCandidates,
        cards: view.cards.map((c) => ({
          title: c.title,
          url: c.url,
          type: c.contentType,
          publisher: c.publisherDisplayName,
          publishedAt: c.publishedAt,
          reason: c.reason,
          sources: c.sources,
          mediaUrl: c.mediaUrl,
          consumption: c.consumption,
          representation: c.representation
            ? {
                kind: c.representation.kind,
                provenance: c.representation.provenance,
                characters: c.representation.bodyText?.length || 0,
                sha256: crypto
                  .createHash('sha256')
                  .update(c.representation.bodyText || '')
                  .digest('hex'),
              }
            : null,
        })),
      });
      // Runtime projection retained locally for UI inspection; never commit article bodies.
      await fs.mkdir('build/evidence/news-supply-01', { recursive: true });
      await fs.writeFile(
        `build/evidence/news-supply-01/view-${rows.length}.json`,
        JSON.stringify(view),
      );
      console.log(
        'END',
        query,
        'cards',
        view.cards.length,
        'ms',
        Date.now() - at,
      );
    } catch (e) {
      rows.push({ query, error: e.name, ms: Date.now() - at });
      console.log('FAILED', e.name);
    }
    await fs.writeFile(
      'docs/audits/evidence/news-supply-01/live.json',
      JSON.stringify(
        {
          at: new Date().toISOString(),
          model: credential.model,
          search: 'Gemini BYOK',
          stub: false,
          entry: 'commandBus content.seek',
          uiAcceptance: false,
          searchEvidence,
          modelEvidence,
          rows,
        },
        null,
        2,
      ),
    );
  }
})().catch((e) => {
  console.error(e.name, e.code || '');
  process.exitCode = 1;
});
