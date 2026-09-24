'use strict';
// Real Electron acceptance for DISCOVER-2.0-DOMESTIC-CONTENT-04.
// Isolated blank userData, real DeepSeek selection, real public domestic Feed/Search.
// The harness fills the real discover form and submits it; no response is injected.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const local = 'build/evidence/domestic-content-04';
const audit = 'docs/audits/evidence/domestic-content-04';
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = async (page, fn, arg, timeoutMs, label) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.evaluate(fn, arg)) return true;
    await sleep(1000);
  }
  throw new Error('waitFor timeout: ' + label);
};
const ALL_QUERIES = [
  { key: 'A', query: '今天有什么重要科技新闻？' },
  { key: 'B', query: '最近有什么值得看的 AI 深度内容？' },
  { key: 'C', query: '给我找一些最近值得看的 AI 视频。' },
  { key: 'D', query: '最近有什么值得听的科技/商业音频？' },
  // Vertical slices: V1 direct domestic video, V2 platform video (official/external).
  { key: 'V1', query: '给我找几个最近值得看的视频，要能直接播放的。' },
  { key: 'V2', query: '给我找一些国外开源社区或 Blender 相关的视频。' },
];
const QUERIES = process.env.DOMESTIC_ONLY_KEY
  ? ALL_QUERIES.filter((row) => row.key === process.env.DOMESTIC_ONLY_KEY)
  : ALL_QUERIES;

(async () => {
  await fs.mkdir(local, { recursive: true });
  await fs.mkdir(audit, { recursive: true });
  for (const file of ['commands.jsonl', 'opens.jsonl']) await fs.writeFile(path.join(local, file), '');
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'domestic-content-ui-'));
  for (const [name, value] of Object.entries({ 'web-discovery': { version: 1, enabled: true, path: 'byok' }, 'ai-capability': { version: 1, path: 'byok' } })) {
    await fs.writeFile(path.join(userData, name + '.json'), JSON.stringify(value));
  }
  const env = { ...process.env, DOMESTIC_CONTENT: '1', DIGITALME_V2_USER_DATA: userData,
    DIGITALME_V2_ELECTRON_TEST: '0', DIGITALME_V2_UX_ACCEPTANCE: '0', DIGITALME_V2_DIGITAL_SELF_STUB: '0', DIGITALME_V2_TALK_STUB: '0' };
  for (const name of ['NODE_TEST_CONTEXT', 'ELECTRON_RUN_AS_NODE', 'DIGITALME_V2_CREDENTIAL_IMPORT', 'DIGITALME_V2_ALLOW_DEV_CREDENTIAL', 'DIGITALME_V2_DIGITAL_SELF_TRACE_DIR', 'DIGITALME_V2_TALK_TRACE_DIR', 'DIGITALME_V2_PACKAGED_SMOKE']) delete env[name];
  const app = await _electron.launch({ executablePath: env.DIGITALME_TEST_ELECTRON,
    args: [path.resolve('scripts/news-supply-electron-entry.cjs')], cwd: process.cwd(), env, timeout: 60000 });
  const rows = [];
  const selfFile = path.join(userData, 'subjects/default/digital-self/self.json');
  const readSelf = () => fs.readFile(selfFile).then(hash).catch(() => 'absent');
  const commandsFile = path.join(local, 'commands.jsonl');
  const readCommands = async () => (await fs.readFile(commandsFile, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  const waitForSeek = async (query, prevCount) => {
    const deadline = Date.now() + 300000;
    while (Date.now() < deadline) {
      const commands = await readCommands();
      if (commands.length > prevCount) {
        const last = commands[commands.length - 1];
        if (last.action === 'seek' && last.query === query) return last;
      }
      await sleep(1000);
    }
    throw new Error('seek timeout: ' + query);
  };
  try {
    const page = await app.firstWindow();
    await page.locator('#view-shell').waitFor({ state: 'visible', timeout: 60000 });
    const before = await readSelf();
    await page.evaluate(() => window.ShellNav.setNav('discover', { skipRefresh: true }));
    // V1 base slice: the default Discover feed (no query) surfaces neutral open media.
    await page.evaluate(() => window.ContentDiscoverPage.refresh());
    await sleep(20000);
    const feedDom = await page.evaluate(() => ([...document.querySelectorAll('.content-discover-card')].map(c => ({
      title: c.querySelector('h3')?.textContent, kind: c.querySelector('.content-discover-kind')?.textContent,
      videoTag: !!c.querySelector('video.content-discover-video'),
      videoSrc: c.querySelector('video.content-discover-video')?.getAttribute('src') || '',
      videoDuration: (() => { const v = c.querySelector('video.content-discover-video'); return v && Number.isFinite(v.duration) ? Math.round(v.duration) : null; })(),
      audioTag: !!c.querySelector('audio.content-discover-audio'),
      embedTag: !!c.querySelector('iframe.content-discover-embed'),
    }))));
    await fs.writeFile(`${audit}/feed.json`, JSON.stringify({ at: new Date().toISOString(), cards: feedDom }, null, 2));
    console.log('FEED CARDS', feedDom.length, 'videos', feedDom.filter(c => c.videoTag).length, 'audio', feedDom.filter(c => c.audioTag).length);
    await page.evaluate(() => window.ShellNav.setNav('discover', { skipRefresh: true }));
    await page.evaluate(() => {
      const original = window.TalkPage.setContentContext;
      window.TalkPage.setContentContext = function (c) {
        window.__newsAsked = { title: c.title, url: c.canonicalUrl, bodyCharacters: (c.bodyText || '').length };
        return original(c);
      };
    });
    const saveRows = () => fs.writeFile(`${audit}/ui.json`, JSON.stringify({ entry: 'real form submit -> renderer seek -> preload IPC -> runtime',
      stub: false, at: new Date().toISOString(), userData, rows }, null, 2));
    const inspectDom = () => page.evaluate(() => ([...document.querySelectorAll('.content-discover-card')].map(c => ({
      title: c.querySelector('h3')?.textContent, source: c.querySelector('.content-discover-source')?.textContent,
      kind: c.querySelector('.content-discover-kind')?.textContent,
      videoTag: !!c.querySelector('video.content-discover-video'),
      videoSrc: c.querySelector('video.content-discover-video')?.getAttribute('src') || '',
      videoDuration: (() => { const v = c.querySelector('video.content-discover-video'); return v && Number.isFinite(v.duration) ? Math.round(v.duration) : null; })(),
      audioTag: !!c.querySelector('audio.content-discover-audio'),
      audioDuration: (() => { const a = c.querySelector('audio.content-discover-audio'); return a && Number.isFinite(a.duration) ? Math.round(a.duration) : null; })(),
      embedTag: !!c.querySelector('iframe.content-discover-embed'),
      embedSrc: c.querySelector('iframe.content-discover-embed')?.getAttribute('src') || '',
      reader: !![...c.querySelectorAll('summary')].find(s => s.textContent === '直接阅读'),
      bodyCharacters: c.querySelector('details > div')?.textContent.length || 0,
    }))));
    for (let i = 0; i < QUERIES.length; i++) {
      const { key, query } = QUERIES[i];
      const started = Date.now();
      console.log('QUERY', key, 'START');
      try {
        const prevCount = (await readCommands()).length;
        await page.fill('#content-discover-query', query);
        await page.click('#btn-content-discover-search');
        const command = await waitForSeek(query, prevCount);
        // Give direct media a moment to load metadata so duration can be read.
        await sleep(3000);
        const dom = await inspectDom();
        await page.screenshot({ path: `${local}/query-${key}.png`, fullPage: true });
        const commandCards = (command.cards || []).map(c => ({ title: c.title, url: c.url, type: c.type,
          publishedAt: c.publishedAt, originalPublishedAt: c.originalPublishedAt, sources: (c.sources || []).length }));
        rows.push({ key, query, ms: Date.now() - started, providers: command.providers || [], trace: command.trace || null,
          supply: command.supply || null, commandCards, dom,
          notice: await page.evaluate(() => document.querySelector('#content-discover-notice')?.textContent || '') });
      } catch (err) {
        rows.push({ key, query, ms: Date.now() - started, error: String(err && err.message || err) });
      }
      await saveRows();
      console.log('QUERY', key, 'END', rows[rows.length - 1].dom ? rows[rows.length - 1].dom.length : 'ERR', Date.now() - started);
    }
    // The read+Ask journey needs an article card. If the last query left only media, re-run the
    // deep-content query so the journey exercises Discover -> resolve -> direct read -> Ask.
    const hasReader = await page.locator('.content-discover-card summary', { hasText: '直接阅读' }).count();
    if (!hasReader) {
      const q = '最近有什么值得看的 AI 深度内容？';
      const prev = (await readCommands()).length;
      await page.fill('#content-discover-query', q);
      await page.click('#btn-content-discover-search');
      await waitForSeek(q, prev);
      await sleep(3000);
      console.log('JOURNEY PREP: re-ran deep-content query for a readable article');
    }
    // Full journey on an article/news card with a reader, else the first readable card, else first card.
    const cards = page.locator('.content-discover-card');
    const count = await cards.count();
    let journeyIndex = 0;
    let best = -1;
    for (let i = 0; i < count; i++) {
      const el = cards.nth(i);
      const hasReader = await el.locator('summary', { hasText: '直接阅读' }).count();
      if (!hasReader) continue;
      if (best < 0) best = i;
      const kind = await el.locator('.content-discover-kind').textContent().catch(() => '');
      if (/文章|新闻/.test(kind || '')) { best = i; break; }
    }
    journeyIndex = best >= 0 ? best : 0;
    const anyCard = cards.nth(journeyIndex);
    if (count) {
      const opensBefore = (await fs.readFile(path.join(local, 'opens.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).length;
      const readerSummary = anyCard.locator('summary').filter({ hasText: '直接阅读' });
      let bodyCharacters = 0;
      if (await readerSummary.count()) {
        await readerSummary.click();
        bodyCharacters = await anyCard.locator('details > div').first().textContent().then(s => s.length);
      }
      const title = await anyCard.locator('h3').textContent();
      const sourceLine = await anyCard.locator('.content-discover-source').textContent();
      // Consume button label depends on the content type; try the real labels in order.
      for (const label of ['阅读原文', '在来源收听', '在来源观看', '去原平台看', '去原平台听', '打开原页']) {
        const b = anyCard.getByRole('button', { name: label, exact: true });
        if (await b.count()) { await b.click().catch(() => {}); break; }
      }
      await page.waitForTimeout(1500);
      const opens = (await fs.readFile(path.join(local, 'opens.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse);
      const opened = opens.slice(opensBefore);
      await anyCard.getByRole('button', { name: '问兔机米', exact: true }).click();
      await page.locator('#talk-content-context').waitFor({ state: 'visible', timeout: 15000 });
      const asked = await page.evaluate(() => window.__newsAsked);
      const talkLabel = await page.locator('#talk-content-context').textContent();
      await page.evaluate(() => window.ShellNav.setNav('discover', { skipRefresh: true }));
      await anyCard.getByRole('button', { name: '加推类似', exact: true }).click();
      await waitFor(page, () => (document.querySelector('#content-discover-pref-list')?.textContent || '').includes('更想看到类似'), null, 180000, 'preference row');
      const preferences = JSON.parse(await fs.readFile(path.join(userData, 'subjects/default/content/content-preferences.json'), 'utf8'));
      await fs.writeFile(`${audit}/journey.json`, JSON.stringify({ title, sourceLine, bodyCharacters, opened, asked, talkLabel,
        returnedCards: await page.locator('.content-discover-card').count(), preferences,
        selfUnchanged: before === await readSelf(),
        credentialFileCreated: await fs.stat(path.join(userData, 'secrets.v2.json')).then(() => true).catch(() => false) }, null, 2));
      console.log('JOURNEY OK', bodyCharacters, asked && asked.title, opened.length);
    }
  } finally { await app.close(); }
})().catch(e => { console.error(e.name, String(e.message).slice(0, 300)); process.exitCode = 1; });
