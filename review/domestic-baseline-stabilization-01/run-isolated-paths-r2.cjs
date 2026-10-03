/**
 * Isolated ordinary-managed four-path probe, round 2.
 * Does not read or write Owner official AppData. Does not print tokens.
 */
'use strict';

const fs = require('node:fs/promises');
const fss = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT = __dirname;
const ISOLATED = path.join(OUT, 'isolated-r2');
const USER_DATA = path.join(ISOLATED, 'userData');
const HOME = path.join(ISOLATED, 'home');
const PKG = path.join(USER_DATA, 'subjects', 'default');
const AUTH = path.join(ISOLATED, 'authorized-out');
const GATEWAY = 'https://relay.muhub.cn';
const MARKER_A = 'STABILIZATION-01-TIDAL-8c2e';
const MARKER_B = 'STABILIZATION-01-SPECTRA-9d4f';

process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.DIGITALME_V2_HOME = HOME;
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
const { saveFilesystemGrant } = require(path.join(ROOT, 'dist', 'authorization', 'filesystem-grant'));

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
    const ctype = res.headers.get('content-type') || '';
    const text = await res.text();
    return {
      url,
      status: res.status,
      ok: res.ok,
      ms: Date.now() - started,
      bytes: text.length,
      contentType: ctype,
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

function wrapLoggedComplete(complete, traces, label) {
  return async (input) => {
    const started = Date.now();
    try {
      const out = await complete(input);
      traces.push({
        label,
        ok: true,
        ms: Date.now() - started,
        toolsOffered: (input.tools || []).map((row) => row.function?.name || row.name).filter(Boolean),
        toolCalls: (out.toolCalls || []).map((row) => row.name),
        textChars: String(out.text || '').length,
        truncated: !!out.truncated,
        finishReason: out.finishReason || '',
        excerpt: String(out.text || '').slice(0, 180),
      });
      return out;
    } catch (err) {
      traces.push({
        label,
        ok: false,
        ms: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
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

  const traces = [];
  const complete = wrapLoggedComplete(
    createManagedAiChatComplete({ gatewayUrl: GATEWAY, installToken, timeoutMs: 90_000 }),
    traces,
    'contract.plain',
  );
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
  const pending = createManagedAiChatComplete({ gatewayUrl: GATEWAY, installToken, timeoutMs: 90_000 })({
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
  note(report, 'contract.plainTrace', traces);
}

function makeRuntime(installToken, traces) {
  const complete = wrapLoggedComplete(
    createManagedAiChatComplete({ gatewayUrl: GATEWAY, installToken, timeoutMs: 120_000 }),
    traces,
    'managed.turn',
  );
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
    mediaUrl: card.mediaUrl || '',
    contentType: card.contentType || '',
    publisher: card.publisherDisplayName || '',
    publishedAt: card.publishedAt || '',
    reason: card.reason || '',
    sourceBoundary: card.sourceBoundary || '',
    excluded:
      card.sourceBoundary === 'excluded_from_default' ||
      !allowsDefaultSupply({ url: card.url, publisher: card.publisherDisplayName }),
  };
}

async function main() {
  await fs.mkdir(path.join(HOME, 'Desktop'), { recursive: true });
  await fs.mkdir(USER_DATA, { recursive: true });
  await fs.mkdir(AUTH, { recursive: true });
  const installToken = await readOrCreateInstallCapabilityToken(USER_DATA);
  const traces = [];
  const report = {
    round: 'DIGITALME-DOMESTIC-BASELINE-STABILIZATION-01-r2',
    baseline: '55b1d2889cc72e9eb7d18fe379fc88e2fde499ec',
    networkLabel: '本机外网，不是国内普通网络证明',
    startedAt: new Date().toISOString(),
    catalog: OPEN_SOURCE_CATALOG.map((row) => ({ id: row.id, url: row.url, kinds: row.contentTypes })),
  };

  report.network = {};
  for (const row of OPEN_SOURCE_CATALOG) {
    report.network[row.id] = await probeUrl(row.url);
  }
  report.network.googleNews = await probeUrl(
    'https://news.google.com/rss/search?q=%E4%BB%8A%E6%97%A5%E6%96%B0%E9%97%BB&hl=zh-CN&gl=CN&ceid=CN:zh-Hans',
  );
  report.network.bbc = await probeUrl('https://feeds.bbci.co.uk/news/world/rss.xml');
  console.log('[network]', JSON.stringify(report.network, null, 2));

  const newsUrls = [];
  const headlines = await fetchNewsHeadlines(
    '今日新闻',
    async (url, init) => {
      newsUrls.push(String(url));
      return fetch(url, init);
    },
  ).catch((err) => ({ error: err.message }));
  if (Array.isArray(headlines)) {
    note(report, 'news.today', {
      count: headlines.length,
      requestedGoogleNews: newsUrls.some((url) => /news\.google\.com/i.test(url)),
      requested: newsUrls,
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
        newest: ingested.items[0]?.content.publishedAt || '',
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

  const runtime = makeRuntime(installToken, traces);
  await runtime.createPackage({ displayName: '隔离验收主体', targetDir: PKG });
  const materialA = path.join(ISOLATED, 'note-tidal.txt');
  const materialB = path.join(ISOLATED, 'note-spectra.txt');
  const decoy = path.join(HOME, 'Desktop', 'other-authorized-draft.txt');
  await fs.writeFile(materialA, `${MARKER_A}\n这份文稿只讨论潮汐锁定，卫星总是同一面朝向主星。\n`, 'utf8');
  await fs.writeFile(materialB, `${MARKER_B}\n这份文稿只讨论光谱分类，按吸收线划分恒星类型。\n`, 'utf8');
  await fs.writeFile(decoy, 'DECOY-DRAFT-SHOULD-NOT-BE-READ\n这是授权夹里的另一份文稿。\n', 'utf8');
  const importedA = await runtime.importSubjectMaterial({ sourcePath: materialA, distillCandidates: false });
  const importedB = await runtime.importSubjectMaterial({ sourcePath: materialB, distillCandidates: false });
  const destA = path.join(PKG, ...importedA.materialRef.split('/'));
  const destB = path.join(PKG, ...importedB.materialRef.split('/'));
  const firstSession = runtime.listConversationSessions().currentId;
  const threadA = await readThread(PKG, new Date().toISOString());
  const second = runtime.createConversationSession();
  const threadB = await readThread(PKG, new Date().toISOString(), second.session.id);
  runtime.openConversationSession(firstSession);
  note(report, 'material.bind', {
    firstSession,
    secondSession: second.session.id,
    destA: fss.existsSync(destA),
    destB: fss.existsSync(destB),
    threadA: threadA.materialPaths || [],
    threadB: threadB.materialPaths || [],
    isolated: (threadB.materialPaths || []).length === 0,
  });

  const manifest = JSON.parse(await fs.readFile(path.join(PKG, 'manifest.json'), 'utf8'));
  await saveFilesystemGrant({
    packageRoot: PKG,
    subjectId: manifest.id,
    folder: path.join(HOME, 'Desktop'),
    now: new Date().toISOString(),
  });
  const unspecified = await runtime.talk({ text: '先别读材料，只告诉我你现在能写到哪里。' });
  const unspecifiedText = [...unspecified.view.turns].reverse().find((row) => row.role === 'assistant')?.text || '';
  const afterUnspecified = await readThread(PKG, new Date().toISOString());
  note(report, 'material.unspecified', {
    readDecoy:
      /DECOY-DRAFT-SHOULD-NOT-BE-READ/.test(unspecifiedText) ||
      (afterUnspecified.executions || []).some((row) => /DECOY-DRAFT|other-authorized-draft/.test(JSON.stringify(row))),
    listedDesktop: (afterUnspecified.executions || []).some(
      (row) => row.capabilityId === 'list_directory' && row.ok && /Desktop/i.test(JSON.stringify(row)),
    ),
    excerpt: unspecifiedText.slice(0, 240),
  });

  const talkVerify = await runtime.talk({
    text: '帮我核实一下，最近两天科技圈有什么靠谱消息？列出能打开的标题、来源和发布时间，不要编。',
  });
  const verifyText = [...talkVerify.view.turns].reverse().find((row) => row.role === 'assistant')?.text || '';
  const verifyThread = await readThread(PKG, new Date().toISOString());
  note(report, 'path.talkVerify', {
    notice: talkVerify.view.notice || '',
    chars: verifyText.length,
    excerpt: verifyText.slice(0, 400),
    tools: (verifyThread.executions || []).map((row) => `${row.capabilityId}:${row.ok}`),
  });

  const talked = await runtime.talk({
    text: '按讲潮汐锁定的那份整理成一个真实 txt，写到我授权的文件夹里，文件名用 stabilization-01-delivery.txt。不要用另一份，也不要用桌面上别的文稿。',
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
    containsSpecified: deliveredText.includes(MARKER_A) || /潮汐锁定/.test(deliveredText),
    containsOther: deliveredText.includes(MARKER_B) || /光谱分类/.test(deliveredText) || /DECOY-DRAFT/.test(deliveredText),
    stillBound: (after.materialPaths || []).includes(destA) && (after.materialPaths || []).includes(destB),
  });

  const open = await runtime.content({ action: 'discover' });
  const laterId = open.view.cards[0]?.itemId;
  if (laterId) await runtime.content({ action: 'later', itemId: laterId });
  const more = await runtime.content({ action: 'more' });
  note(report, 'path.browse.open', {
    cards: open.view.cards.length,
    neededMore: open.view.cards.length === 0 && more.view.cards.length > 0,
    more: more.view.cards.length,
    excluded: open.view.cards.filter((card) => cardSummary(card).excluded).length,
    sample: open.view.cards.slice(0, 6).map(cardSummary),
    notice: open.view.notice || '',
    supplyTrace: open.view.supplyTrace || [],
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
    googleNews: news.view.cards.filter((card) => /news\.google\.com/i.test(card.url || '')).length,
    sample: news.view.cards.slice(0, 6).map(cardSummary),
    notice: news.view.notice || '',
  });
  note(report, 'path.news.energy', {
    cards: energy.view.cards.length,
    excluded: energy.view.cards.filter((card) => cardSummary(card).excluded).length,
    googleNews: energy.view.cards.filter((card) => /news\.google\.com/i.test(card.url || '')).length,
    sample: energy.view.cards.slice(0, 6).map(cardSummary),
    notice: energy.view.notice || '',
  });

  const media = await runtime.content({
    action: 'seek',
    text: '给我一段能打开或播放的木星视频或音频，不要用介绍文章冒充媒体',
  });
  const mediaCards = (media.view.cards || []).map(cardSummary);
  const playable = mediaCards.find((card) => card.mediaUrl || /archive\.org|commons\.wikimedia|podcasts\.apple|itunes\.apple/i.test(card.url));
  const openedMedia = playable
    ? await probeUrl(playable.mediaUrl || playable.url, 15000)
    : { ok: false, error: 'no playable card' };
  note(report, 'path.media', {
    cards: media.view.cards.length,
    sample: mediaCards.slice(0, 6),
    notice: media.view.notice || '',
    playable: playable || null,
    opened: openedMedia,
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
  const restarted = makeRuntime(installToken, traces);
  await restarted.openPackage({ dir: PKG });
  const again = await restarted.content({ action: 'discover' });
  const againThread = await readThread(PKG, new Date().toISOString());
  note(report, 'path.browse.restart', {
    later: (again.view.laterCards || []).length,
    laterTitles: (again.view.laterCards || []).map((card) => card.title),
    laterMarks: (again.view.laterCards || []).map((card) => card.reason),
    materialsStillBound: (againThread.materialPaths || []).includes(destA),
  });
  await restarted.stop();

  note(report, 'contract.managedTraces', {
    count: traces.length,
    truncated: traces.filter((row) => row.truncated).length,
    failed: traces.filter((row) => row.ok === false).length,
    withTools: traces.filter((row) => (row.toolCalls || []).length).length,
    samples: traces.slice(0, 8),
  });

  report.finishedAt = new Date().toISOString();
  report.exitReady = {
    talkVerify: !!verifyText && !/无法|出错|额度/.test(verifyText),
    materialIsolated: report['material.bind']?.isolated === true,
    materialSpecified: report['path.material']?.containsSpecified === true && report['path.material']?.containsOther !== true,
    unspecifiedDidNotReadDecoy: report['material.unspecified']?.readDecoy === false,
    firstScreenHasCards: (report['path.browse.open']?.cards || 0) > 0 && report['path.browse.open']?.neededMore !== true,
    newsNoGoogleNews:
      (report['path.news.today']?.googleNews || 0) === 0 &&
      (report['news.today']?.requestedGoogleNews || false) === false,
    newsNoExcluded: (report['path.news.today']?.excluded || 0) === 0 && (report['path.news.energy']?.excluded || 0) === 0,
    mediaOpened: !!(report['path.media']?.opened?.ok),
    domesticNetworkUnproven: true,
  };
  await fs.writeFile(path.join(OUT, 'isolated-path-report-r2.json'), `${JSON.stringify(report, null, 2)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
