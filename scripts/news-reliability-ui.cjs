'use strict';
// Real Electron acceptance for DISCOVER-2.0-NEWS-RELIABILITY-03.
// Isolated blank userData, real DeepSeek selection, real public Feed/Search, no response injection.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const local = 'build/evidence/news-reliability-03';
const audit = 'docs/audits/evidence/news-reliability-03';
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

(async () => {
  await fs.mkdir(local, { recursive: true });
  await fs.mkdir(audit, { recursive: true });
  for (const file of ['commands.jsonl', 'opens.jsonl']) {
    await fs.writeFile(path.join(local, file), '');
  }
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'news-supply-ui-'));
  for (const [name, value] of Object.entries({ 'web-discovery': { version: 1, enabled: true, path: 'byok' }, 'ai-capability': { version: 1, path: 'byok' } })) {
    await fs.writeFile(path.join(userData, name + '.json'), JSON.stringify(value));
  }
  const env = { ...process.env, NEWS_RELIABILITY: '1', DIGITALME_V2_USER_DATA: userData,
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
  const eventQuery = process.env.NEWS_EVENT_QUERY || '今天特斯拉 App 泄露第三代 Optimus 人形机器人的具体消息，合并同一事件的独立媒体报道并保留各来源。';
  const onlyEvent = process.env.NEWS_ONLY_EVENT === '1';
  try {
    const page = await app.firstWindow();
    await page.locator('#view-shell').waitFor({ state: 'visible', timeout: 60000 });
    const before = await readSelf();
    await page.evaluate(() => window.ShellNav.setNav('discover', { skipRefresh: true }));
    await page.evaluate(() => {
      const original = window.TalkPage.setContentContext;
      window.TalkPage.setContentContext = function (c) {
        window.__newsAsked = { title: c.title, url: c.canonicalUrl, bodyCharacters: (c.bodyText || '').length };
        return original(c);
      };
    });
    let shot = 0;
    const saveRows = () => fs.writeFile(`${audit}/ui.json`, JSON.stringify({ entry: 'real form submit -> renderer seek -> preload IPC -> runtime',
      stub: false, at: new Date().toISOString(), userData, rows }, null, 2));
    const runQuery = async (query, label) => {
      const started = Date.now();
      console.log(label, 'START');
      // Real user entry: fill the discover form and submit it. The bound handler calls
      // the same renderer seek -> preload IPC -> runtime path; no response is injected.
      const prevCount = (await readCommands()).length;
      await page.fill('#content-discover-query', query);
      await page.click('#btn-content-discover-search');
      const command = await waitForSeek(query, prevCount);
      await sleep(1000);
      const state = await page.evaluate(() => ({
        cards: [...document.querySelectorAll('.content-discover-card')].map(c => ({
          title: c.querySelector('h3')?.textContent, source: c.querySelector('.content-discover-source')?.textContent,
          kind: c.querySelector('.content-discover-kind')?.textContent,
          sources: [...c.querySelectorAll('a')].map(a => a.href), bodyCharacters: c.querySelector('details > div')?.textContent.length || 0,
        })),
        notice: document.querySelector('#content-discover-notice')?.textContent,
        feedTitle: document.querySelector('#content-discover-feed-title')?.textContent,
      }));
      const commandCards = (command.cards || []).map(c => ({ title: c.title, url: c.url, type: c.type,
        publishedAt: c.publishedAt, originalPublishedAt: c.originalPublishedAt, sourceFeedTimestamp: c.sourceFeedTimestamp,
        discoveredAt: c.discoveredAt, dateProvenance: c.dateProvenance, sources: (c.sources || []).length }));
      const row = { query, ms: Date.now() - started, providers: command.providers || [], trace: command.trace || null,
        supply: command.supply || null, commandCards, ...state };
      await page.screenshot({ path: `${local}/query-${++shot}.png` });
      console.log(label, 'END', state.cards.length, Date.now() - started);
      return row;
    };
    if (onlyEvent) {
      rows.push(await runQuery(eventQuery, 'QUERY 1'));
      await saveRows();
    } else {
      rows.push(await runQuery('今天 AI 有什么重要新闻？', 'QUERY 1'));
      await saveRows();
      rows.push(await runQuery('最近具身智能有什么重要消息？', 'QUERY 2'));
      await saveRows();
      let row;
      for (let attempt = 1; attempt <= 3; attempt++) {
        row = await runQuery(eventQuery, `QUERY 3 attempt ${attempt}`);
        const sourceCount = Math.max(row.commandCards[0]?.sources || 0, row.cards[0]?.sources?.length || 0);
        if (sourceCount >= 2) break;
      }
      rows.push(row);
      await saveRows();
    }
    const card = page.locator('.content-discover-card').filter({ has: page.locator('summary', { hasText: '直接阅读' }) }).first();
    if (!(await card.count())) throw new Error('No readable final card for journey');
    const opensBefore = (await fs.readFile(path.join(local, 'opens.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).length;
    await card.locator('summary').filter({ hasText: '直接阅读' }).click();
    const bodyCharacters = await card.locator('details > div').first().textContent().then(s => s.length);
    const title = await card.locator('h3').textContent();
    const sourceLine = await card.locator('.content-discover-source').textContent();
    const groupedSources = await card.locator('a').count();
    await card.getByRole('button', { name: '阅读原文', exact: true }).click();
    await page.waitForTimeout(1500);
    const opens = (await fs.readFile(path.join(local, 'opens.jsonl'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(JSON.parse);
    const opened = opens.slice(opensBefore);
    await card.getByRole('button', { name: '问兔机米', exact: true }).click();
    await page.locator('#talk-content-context').waitFor({ state: 'visible', timeout: 15000 });
    const asked = await page.evaluate(() => window.__newsAsked);
    const talkLabel = await page.locator('#talk-content-context').textContent();
    await page.evaluate(() => window.ShellNav.setNav('discover', { skipRefresh: true }));
    await card.getByRole('button', { name: '加推类似', exact: true }).click();
    await waitFor(page, () => (document.querySelector('#content-discover-pref-list')?.textContent || '').includes('更想看到类似'), null, 180000, 'preference row');
    const preferences = JSON.parse(await fs.readFile(path.join(userData, 'subjects/default/content/content-preferences.json'), 'utf8'));
    await fs.writeFile(`${audit}/journey.json`, JSON.stringify({ title, sourceLine, groupedSources, bodyCharacters, opened, asked, talkLabel,
      returnedCards: await page.locator('.content-discover-card').count(),
      preferences, selfUnchanged: before === await readSelf(),
      credentialFileCreated: await fs.stat(path.join(userData, 'secrets.v2.json')).then(() => true).catch(() => false) }, null, 2));
    await page.screenshot({ path: `${local}/journey.png` });
    console.log('JOURNEY OK', bodyCharacters, asked && asked.title, opened.length, 'sources', groupedSources);
  } finally { await app.close(); }
})().catch(e => { console.error(e.name, String(e.message).slice(0, 300)); process.exitCode = 1; });
