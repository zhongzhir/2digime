'use strict';
// Real Electron coverage measurement for DISCOVER-2.0-SOURCE-COVERAGE-07.
// Measures TTFV/TTFC plus coverage: distinct publishers, content types, direct-consumable ratio.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const local = 'build/evidence/source-coverage-07';
const audit = 'docs/audits/evidence/source-coverage-07';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const QUERIES = [
  { key: 'A', query: '今天有什么重要新闻？' },
  { key: 'B', query: '最近有什么值得看的 AI / 科技深度内容？' },
  { key: 'C', query: '最近有什么值得看的 AI / 科技视频？' },
  { key: 'D', query: '最近有什么值得听的商业 / 科技 / 投资播客？' },
  { key: 'E', query: '最近一级市场有什么值得关注的内容？' },
];
const ONLY = process.env.COVERAGE_ONLY_KEY;

(async () => {
  await fs.mkdir(local, { recursive: true });
  await fs.mkdir(audit, { recursive: true });
  for (const f of ['commands.jsonl', 'model.jsonl']) await fs.writeFile(path.join(local, f), '');
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'domestic-content-ui-'));
  for (const [name, value] of Object.entries({ 'web-discovery': { version: 1, enabled: true, path: 'byok' }, 'ai-capability': { version: 1, path: 'byok' } })) {
    await fs.writeFile(path.join(userData, name + '.json'), JSON.stringify(value));
  }
  const env = { ...process.env, DOMESTIC_CONTENT: '1', EVIDENCE_DIR: local, DIGITALME_V2_USER_DATA: userData,
    DIGITALME_V2_ELECTRON_TEST: '0', DIGITALME_V2_UX_ACCEPTANCE: '0', DIGITALME_V2_DIGITAL_SELF_STUB: '0', DIGITALME_V2_TALK_STUB: '0' };
  for (const name of ['NODE_TEST_CONTEXT', 'ELECTRON_RUN_AS_NODE', 'DIGITALME_V2_CREDENTIAL_IMPORT', 'DIGITALME_V2_ALLOW_DEV_CREDENTIAL', 'DIGITALME_V2_DIGITAL_SELF_TRACE_DIR', 'DIGITALME_V2_TALK_TRACE_DIR', 'DIGITALME_V2_PACKAGED_SMOKE']) delete env[name];
  const app = await _electron.launch({ executablePath: env.DIGITALME_TEST_ELECTRON,
    args: [path.resolve('scripts/news-supply-electron-entry.cjs')], cwd: process.cwd(), env, timeout: 60000 });
  const commandsFile = path.join(local, 'commands.jsonl');
  const modelFile = path.join(local, 'model.jsonl');
  const readJsonl = async (file) => (await fs.readFile(file, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const rows = [];
  try {
    const page = await app.firstWindow();
    await page.locator('#view-shell').waitFor({ state: 'visible', timeout: 60000 });
    await page.evaluate(() => window.ShellNav.setNav('discover', { skipRefresh: true }));
    const queries = ONLY ? QUERIES.filter(q => q.key === ONLY) : QUERIES;
    for (const { key, query } of queries) {
      const cmdBefore = (await readJsonl(commandsFile)).length;
      const modelBefore = (await readJsonl(modelFile)).length;
      const submitAt = Date.now();
      console.log('QUERY', key, 'START');
      await page.locator('#btn-content-discover-search').waitFor({ state: 'visible', timeout: 60000 });
      await page.fill('#content-discover-query', query);
      await page.locator('#btn-content-discover-search').click({ force: true, timeout: 60000 });
      let ttfvRecord = null; let seek = null;
      const deadline = Date.now() + 400000;
      while (Date.now() < deadline && ttfvRecord == null) {
        const recs = (await readJsonl(commandsFile)).slice(cmdBefore);
        const s = recs.find(r => r.action === 'seek' && r.query === query);
        if (s) { ttfvRecord = Date.now() - submitAt; seek = s; }
        else await sleep(150);
      }
      let ttfvDom = null;
      const domDeadline = Date.now() + 400000;
      while (Date.now() < domDeadline && ttfvDom == null) {
        const n = await page.evaluate(() => document.querySelectorAll('.content-discover-card').length);
        if (n > 0) ttfvDom = Date.now() - submitAt; else await sleep(120);
      }
      let ttfc = null;
      while (Date.now() < deadline && ttfc == null) {
        const recs = (await readJsonl(commandsFile)).slice(cmdBefore);
        if (recs.some(r => r.action === 'replenish')) ttfc = Date.now() - submitAt; else await sleep(300);
      }
      await sleep(2000);
      const dom = await page.evaluate(() => ([...document.querySelectorAll('.content-discover-card')].map(c => ({
        title: c.querySelector('h3')?.textContent, kind: c.querySelector('.content-discover-kind')?.textContent,
        source: c.querySelector('.content-discover-source')?.textContent,
        videoTag: !!c.querySelector('video.content-discover-video'), audioTag: !!c.querySelector('audio.content-discover-audio'),
        embedTag: !!c.querySelector('iframe.content-discover-embed'), reader: !![...c.querySelectorAll('summary')].find(s => s.textContent === '直接阅读'),
      }))));
      const modelRows = (await readJsonl(modelFile)).slice(modelBefore);
      const tokens = modelRows.reduce((s, r) => s + (r.usage?.totalTokens || 0), 0);
      const reasoning = modelRows.reduce((s, r) => s + (r.usage?.reasoningTokens || 0), 0);
      const trace = seek?.trace || {};
      const items = Array.isArray(trace.items) ? trace.items : [];
      const hosts = new Set();
      for (const it of items) { try { hosts.add(new URL(it.canonicalUrl).hostname.replace(/^www\./, '')); } catch { /* */ } }
      const publishers = new Set();
      for (const c of dom) { const s = String(c.source || '').split(' · ')[0].trim(); if (s) publishers.add(s); }
      const types = {}; for (const c of dom) { const t = c.kind || '其他'; types[t] = (types[t] || 0) + 1; }
      const directConsumable = dom.filter(c => c.videoTag || c.audioTag || c.reader).length;
      const externalOnly = dom.filter(c => !c.videoTag && !c.audioTag && !c.reader).length;
      rows.push({ key, query, ttfvMs: ttfvDom ?? ttfvRecord, ttfvDomMs: ttfvDom, ttfcMs: ttfc,
        rawCandidates: trace.rawCandidates, candidateSourceCount: trace.candidateSourceCount,
        candidateFeedCount: trace.candidateFeedCount, candidateSearchCount: trace.candidateSearchCount,
        distinctHosts: hosts.size, distinctPublishers: publishers.size, publishers: [...publishers],
        cards: dom.length, types, directConsumable, externalOnly, modelCalls: modelRows.length, modelTokens: tokens, reasoningTokens: reasoning,
        representative: dom.slice(0, 3).map(c => `${c.kind}:${String(c.title || '').slice(0, 30)}`) });
      await page.screenshot({ path: `${local}/query-${key}.png`, fullPage: true });
      await fs.writeFile(`${audit}/coverage.json`, JSON.stringify({ at: new Date().toISOString(), rows }, null, 2));
      console.log('QUERY', key, 'TTFV', rows[rows.length - 1].ttfvMs, 'TTFC', ttfc, 'cards', dom.length,
        'publishers', publishers.size, 'direct', directConsumable, 'types', JSON.stringify(types));
    }
    // Real UI chain on an article card (read -> open -> Ask 2digime -> feedback -> return).
    const cards = page.locator('.content-discover-card');
    const count = await cards.count();
    let idx = -1;
    for (let i = 0; i < count; i++) {
      if (await cards.nth(i).locator('summary', { hasText: '直接阅读' }).count()) {
        const kind = await cards.nth(i).locator('.content-discover-kind').textContent().catch(() => '');
        if (/文章|新闻/.test(kind || '')) { idx = i; break; }
        if (idx < 0) idx = i;
      }
    }
    if (idx >= 0) {
      const card = cards.nth(idx);
      await card.locator('summary').filter({ hasText: '直接阅读' }).click();
      const bodyCharacters = await card.locator('details > div').first().textContent().then(s => s.length).catch(() => 0);
      const title = await card.locator('h3').textContent();
      await page.evaluate(() => {
        const original = window.TalkPage.setContentContext;
        window.TalkPage.setContentContext = function (c) { window.__asked = { title: c.title, bodyCharacters: (c.bodyText || '').length }; return original(c); };
      });
      for (const label of ['阅读原文', '在来源收听', '在来源观看', '去原平台看', '去原平台听', '打开原页']) {
        const b = card.getByRole('button', { name: label, exact: true });
        if (await b.count()) { await b.click().catch(() => {}); break; }
      }
      await page.waitForTimeout(800);
      await card.getByRole('button', { name: '问兔机米', exact: true }).click();
      await page.locator('#talk-content-context').waitFor({ state: 'visible', timeout: 15000 });
      const asked = await page.evaluate(() => window.__asked);
      const talkLabel = await page.locator('#talk-content-context').textContent();
      await page.evaluate(() => window.ShellNav.setNav('discover', { skipRefresh: true }));
      await card.getByRole('button', { name: '加推类似', exact: true }).click();
      let prefOk = false;
      for (let i = 0; i < 60 && !prefOk; i++) { prefOk = await page.evaluate(() => (document.querySelector('#content-discover-pref-list')?.textContent || '').includes('更想看到类似')); if (!prefOk) await sleep(1000); }
      await fs.writeFile(`${audit}/journey.json`, JSON.stringify({ title, bodyCharacters, asked, talkLabel, preferenceAdded: prefOk, returnedCards: await page.locator('.content-discover-card').count() }, null, 2));
      console.log('JOURNEY read', bodyCharacters, 'ask', asked && asked.title, 'pref', prefOk);
    }
  } finally { await app.close(); }
})().catch(e => { console.error(e.name, String(e.message).slice(0, 300)); process.exitCode = 1; });
