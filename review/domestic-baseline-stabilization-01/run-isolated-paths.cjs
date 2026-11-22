/**
 * Isolated ordinary-managed four-path probe.
 * Does not read or write Owner official AppData. Does not print tokens.
 */
'use strict';

const fs = require('node:fs/promises');
const fss = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = __dirname;
const ISOLATED = path.join(OUT, 'isolated');
const USER_DATA = path.join(ISOLATED, 'userData');
const HOME = path.join(ISOLATED, 'home');
const PKG = path.join(USER_DATA, 'subjects', 'default');
const AUTH = path.join(ISOLATED, 'authorized-out');
const GATEWAY = 'https://relay.muhub.cn';
const MARKER = 'STABILIZATION-01-UNIQUE-7f3a';

process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.DIGITALME_V2_USER_DATA = USER_DATA;
delete process.env.DIGITALME_V2_OPEN_AI_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;

const { createDigitalMeRuntime } = require(path.join(ROOT, 'dist', 'runtime', 'digitalme-runtime'));
const { createManagedAiChatComplete } = require(path.join(ROOT, 'dist', 'capability', 'managed-ai-client'));
const { readOrCreateInstallCapabilityToken } = require(path.join(ROOT, 'dist', 'capability', 'install-capability-token'));
const { fetchNewsHeadlines } = require(path.join(ROOT, 'dist', 'subject-comm', 'news-headlines'));
const { OPEN_SOURCE_CATALOG } = require(path.join(ROOT, 'dist', 'subject-comm', 'open-source-catalog'));
const { allowsDefaultSupply } = require(path.join(ROOT, 'dist', 'subject-comm', 'domestic-source-boundary'));
const { ingestSource } = require(path.join(ROOT, 'dist', 'subject-comm', 'content-ingest'));
const { MemoryNetworkItemStore } = require(path.join(ROOT, 'dist', 'relay-service', 'network-item-store'));
const { readThread } = require(path.join(ROOT, 'dist', 'intelligence', 'store'));

function note(report, key, value) {
  report[key] = value;
  console.log(`[${key}] ${typeof value === 'string' ? value : JSON.stringify(value)}`);
}

async function probeUrl(url, timeoutMs = 12000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'digitalme-domestic-probe', accept: '*/*' },
      redirect: 'follow',
      signal: ac.signal,
    });
    const text = await res.text();
    return {
      url,
      status: res.status,
      ok: res.ok,
      ms: Date.now() - started,
      bytes: text.length,
      finalUrl: String(res.url || url),
    };
  } catch (err) {
    return {
      url,
      ok: false,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function contractProbe(installToken, report) {
  const thinking = await fetch(`${GATEWAY}/v1/ai/inference`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-install-capability-token': installToken,
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: '只回一个字：好' }],
      thinking: { type: 'enabled' },
      idempotencyKey: `stab-thinking-${Date.now()}`,
    }),
  });
  const thinkingBody = await thinking.text();
  note(report, 'contract.thinking', {
    status: thinking.status,
    rejected: thinking.status === 400,
    body: thinkingBody.slice(0, 180),
  });

  const complete = createManagedAiChatComplete({ gatewayUrl: GATEWAY, installToken, timeoutMs: 90_000 });
  const tools = await complete({
    messages: [{ role: 'user', content: '不要调用工具，只回复一个字：好' }],
    tools: [
      {
        type: 'function',
        function: {
          name: 'searchWeb',
          description: 'search',
          parameters: { type: 'object', properties: { q: { type: 'string' } } },
        },
      },
    ],
    toolChoice: 'auto',
    maxTokens: 64,
    temperature: 0,
  }).catch((err) => ({ error: err instanceof Error ? err.message : String(err) }));
  note(report, 'contract.toolsPlainReply', {
    ok: !tools.error && !!String(tools.text || '').trim(),
    textChars: String(tools.text || '').length,
    toolCalls: Array.isArray(tools.toolCalls) ? tools.toolCalls.length : 0,
    error: tools.error || null,
  });

  const ac = new AbortController();
  const pending = complete({
    messages: [{ role: 'user', content: '用两三句话介绍木星。' }],
    maxTokens: 128,
    signal: ac.signal,
  });
  setTimeout(() => ac.abort(), 80);
  const cancelled = await pending.then(
    (row) => ({ late: true, chars: String(row.text || '').length }),
    (err) => ({ late: false, error: err instanceof Error ? err.message : String(err) }),
  );
  note(report, 'contract.cancel', cancelled);
}

function makeRuntime(installToken) {
  const complete = createManagedAiChatComplete({ gatewayUrl: GATEWAY, installToken, timeoutMs: 120_000 });
  return createDigitalMeRuntime({
    documentCapability: 'fake',
    registerOpenAiStub: false,
    openaiCompatible: {
      baseUrl: GATEWAY,
      model: 'managed-ai',
      providerId: 'managed-ai',
      displayName: '兔机米提供',
      timeoutMs: 120000,
      complete,
    },
    webDiscoveryPath: 'managed',
    webDiscoveryEnabled: true,
    webDiscoveryGatewayUrl: GATEWAY,
    webDiscoveryInstallToken: installToken,
    requestFolderAccess: async () => true,
  });
}

function cardSummary(card) {
  return {
    title: card.title,
    url: card.url || '',
    publisher: card.publisherDisplayName || '',
    publishedAt: card.publishedAt || '',
    reason: card.reason || '',
    sourceBoundary: card.sourceBoundary || '',
    excluded: card.sourceBoundary === 'excluded_from_default' || !allowsDefaultSupply({ url: card.url, publisher: card.publisherDisplayName }),
  };
}

async function main() {
  await fs.mkdir(HOME, { recursive: true });
  await fs.mkdir(USER_DATA, { recursive: true });
  await fs.mkdir(AUTH, { recursive: true });
  const installToken = await readOrCreateInstallCapabilityToken(USER_DATA);
  const report = {
    round: 'DIGITALME-DOMESTIC-BASELINE-STABILIZATION-01',
    baseline: '55b1d2889cc72e9eb7d18fe379fc88e2fde499ec',
    networkLabel: '本机外网，不是国内普通网络证明',
    startedAt: new Date().toISOString(),
    catalog: OPEN_SOURCE_CATALOG.map((row) => ({ id: row.id, url: row.url, kinds: row.contentTypes })),
  };

  report.network = {};
  for (const row of OPEN_SOURCE_CATALOG.filter((item) => item.kind === 'media_rss' || item.id === 'wikimedia-commons')) {
    report.network[row.id] = await probeUrl(row.url);
  }
  report.network.googleNews = await probeUrl(
    'https://news.google.com/rss/search?q=%E4%BB%8A%E6%97%A5%E6%96%B0%E9%97%BB&hl=zh-CN&gl=CN&ceid=CN:zh-Hans',
  );
  report.network.bbc = await probeUrl('https://feeds.bbci.co.uk/news/world/rss.xml');
  report.network.people = await probeUrl('http://www.people.com.cn/rss/politics.xml');
  console.log('[network]', JSON.stringify(report.network, null, 2));

  const headlines = await fetchNewsHeadlines('今日新闻').catch((err) => ({ error: err.message }));
  if (Array.isArray(headlines)) {
    note(report, 'news.today', {
      count: headlines.length,
      excludedLeak: headlines.filter((row) => !allowsDefaultSupply({ url: row.url, publisher: row.publisherName })).length,
      sample: headlines.slice(0, 6).map((row) => ({
        title: row.title,
        publisher: row.publisherName || '',
        publishedAt: row.publishedAt || '',
        url: row.url,
      })),
    });
  } else {
    note(report, 'news.today', headlines);
  }

  const store = new MemoryNetworkItemStore();
  const articleFeeds = [];
  for (const row of OPEN_SOURCE_CATALOG.filter((item) => item.kind === 'media_rss')) {
    try {
      const ingested = await ingestSource({ sourceUrl: row.url, store, limit: 3 });
      articleFeeds.push({
        id: row.id,
        count: ingested.items.length,
        sample: ingested.items.slice(0, 2).map((item) => ({
          title: item.content.title,
          url: item.content.url,
          publishedAt: item.content.publishedAt || '',
        })),
      });
    } catch (err) {
      articleFeeds.push({ id: row.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  note(report, 'catalog.ingest', articleFeeds);

  await contractProbe(installToken, report);

  const runtime = makeRuntime(installToken);
  await runtime.createPackage({ displayName: '隔离验收主体', targetDir: PKG });
  const materialPath = path.join(ISOLATED, 'stabilization-01-material.txt');
  await fs.writeFile(
    materialPath,
    `${MARKER}\n这是本轮指定导入材料，不是桌面文稿。请只根据这份材料整理。\n主题：隔离验收材料绑定。\n`,
    'utf8',
  );
  const imported = await runtime.importSubjectMaterial({ sourcePath: materialPath, distillCandidates: false });
  const dest = path.join(PKG, ...imported.materialRef.split('/'));
  const thread = await readThread(PKG, new Date().toISOString());
  note(report, 'material.bind', {
    materialRef: imported.materialRef,
    destExists: fss.existsSync(dest),
    bound: (thread.materialPaths || []).includes(dest),
    materialPaths: thread.materialPaths || [],
  });

  const talkVerify = await runtime.talk({
    text: '帮我核实一下，最近两天科技圈有什么靠谱消息？列出能打开的标题、来源和发布时间，不要编。',
  });
  const verifyText = [...talkVerify.view.turns].reverse().find((row) => row.role === 'assistant')?.text || '';
  note(report, 'path.talkVerify', {
    notice: talkVerify.view.notice || '',
    chars: verifyText.length,
    excerpt: verifyText.slice(0, 400),
  });

  const talked = await runtime.talk({
    text: '把刚才导入的那份指定材料整理成一个真实 txt，写到我授权的文件夹里，文件名用 stabilization-01-delivery.txt。必须用导入的那份，不要用桌面上别的文稿。',
    contextPaths: [AUTH],
  });
  const delivery = path.join(AUTH, 'stabilization-01-delivery.txt');
  const assistant = [...talked.view.turns].reverse().find((row) => row.role === 'assistant');
  const deliveredText = fss.existsSync(delivery) ? await fs.readFile(delivery, 'utf8') : '';
  const after = await readThread(PKG, new Date().toISOString());
  note(report, 'path.material', {
    notice: talked.view.notice || '',
    assistant: (assistant?.text || '').slice(0, 300),
    result: assistant?.result || null,
    delivered: fss.existsSync(delivery),
    containsMarker: deliveredText.includes(MARKER),
    stillBound: (after.materialPaths || []).includes(dest),
    desktopLookalike: fss.existsSync(path.join(os.homedir(), 'Desktop', '2digime稿件-叙事认同的让渡.txt'))
      ? 'exists-outside-isolated-home'
      : 'not-in-isolated-home',
  });

  let open = await runtime.content({ action: 'discover' });
  if (!open.view.cards.length) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    open = await runtime.content({ action: 'discover' });
  }
  const laterId = open.view.cards[0]?.itemId;
  if (laterId) {
    await runtime.content({ action: 'later', itemId: laterId });
  }
  const more = await runtime.content({ action: 'more' });
  note(report, 'path.browse.open', {
    cards: open.view.cards.length,
    more: more.view.cards.length,
    excluded: open.view.cards.filter((card) => cardSummary(card).excluded).length,
    sample: open.view.cards.slice(0, 6).map(cardSummary),
    notice: open.view.notice || '',
  });

  const news = await runtime.content({
    action: 'seek',
    text: '把今天能看的新闻拿来，按发布日期列标题和原文入口',
  });
  const energy = await runtime.content({
    action: 'seek',
    text: '9月28号那天跟能源有关的报道，按日期给我，不要把别的日子混进来',
  });
  note(report, 'path.news.today', {
    cards: news.view.cards.length,
    excluded: news.view.cards.filter((card) => cardSummary(card).excluded).length,
    sample: news.view.cards.slice(0, 6).map(cardSummary),
    notice: news.view.notice || '',
  });
  note(report, 'path.news.energy', {
    cards: energy.view.cards.length,
    excluded: energy.view.cards.filter((card) => cardSummary(card).excluded).length,
    sample: energy.view.cards.slice(0, 6).map(cardSummary),
    notice: energy.view.notice || '',
  });

  const started = runtime.content({ action: 'seek', text: '随便再补一些航天视频看看' });
  await new Promise((resolve) => setTimeout(resolve, 400));
  const cancelled = await runtime.content({ action: 'cancel' });
  const leftover = await started.catch((err) => ({ error: err instanceof Error ? err.message : String(err) }));
  note(report, 'path.news.cancel', {
    cancelNotice: cancelled.view.notice || '',
    leftoverCards: leftover.view ? leftover.view.cards.length : 0,
    leftoverError: leftover.error || null,
  });

  await runtime.stop();
  const restarted = makeRuntime(installToken);
  await restarted.openPackage({ dir: PKG });
  const again = await restarted.content({ action: 'discover' });
  note(report, 'path.browse.restart', {
    later: (again.view.laterCards || []).length,
    laterTitles: (again.view.laterCards || []).map((card) => card.title),
    laterMarks: (again.view.laterCards || []).map((card) => card.reason),
  });
  await restarted.stop();

  report.finishedAt = new Date().toISOString();
  report.exitReady = {
    talkVerify: !!verifyText && !/无法|出错|额度/.test(verifyText),
    materialBoundAndDelivered: report['path.material']?.containsMarker === true && report['material.bind']?.bound === true,
    browseHasCards: (report['path.browse.open']?.cards || 0) > 0,
    newsNoExcluded: (report['path.news.today']?.excluded || 0) === 0 && (report['path.news.energy']?.excluded || 0) === 0,
    domesticNetworkUnproven: true,
  };
  await fs.writeFile(path.join(OUT, 'isolated-path-report.json'), `${JSON.stringify(report, null, 2)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
