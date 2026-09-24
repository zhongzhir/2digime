'use strict';
// Real Electron latency measurement for DISCOVER-2.0-LATENCY-05.
// Measures TTFV (first cards) and TTFC (full completion) per query, plus model calls/tokens.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const local = 'build/evidence/discover-latency-05';
const audit = 'docs/audits/evidence/discover-latency-05';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const QUERIES = [
  { key: 'A', query: '今天有什么重要科技新闻？' },
  { key: 'B', query: '最近有什么值得看的 AI 深度内容？' },
  { key: 'C', query: '给我找一些最近值得看的 AI 视频。' },
  { key: 'D', query: '最近有什么值得听的科技/商业音频？' },
];
const ONLY = process.env.LATENCY_ONLY_KEY;

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
      const prevSig = await page.evaluate(() => [...document.querySelectorAll('.content-discover-card h3')].map(h => h.textContent).join('|'));
      const submitAt = Date.now();
      console.log('QUERY', key, 'START');
      await page.locator('#btn-content-discover-search').waitFor({ state: 'visible', timeout: 60000 });
      await page.fill('#content-discover-query', query);
      await page.locator('#btn-content-discover-search').click({ force: true, timeout: 60000 });
      // TTFV: first new card rendered, or the seek command record, whichever is measurable.
      let ttfvDom = null; let ttfvRecord = null; let seekTrace = null; let command = null;
      const deadline = Date.now() + 400000;
      while (Date.now() < deadline && (ttfvDom == null || ttfvRecord == null)) {
        if (ttfvDom == null) {
          const sig = await page.evaluate(() => [...document.querySelectorAll('.content-discover-card h3')].map(h => h.textContent).join('|'));
          if (sig && sig !== prevSig) ttfvDom = Date.now() - submitAt;
        }
        if (ttfvRecord == null) {
          const recs = await readJsonl(commandsFile);
          const newRecs = recs.slice(cmdBefore);
          const seek = newRecs.find(r => r.action === 'seek' && r.query === query);
          if (seek) { ttfvRecord = Date.now() - submitAt; seekTrace = seek.supply || null; command = seek; }
        }
        await sleep(200);
      }
      // TTFC: the replenish command record.
      let ttfcRecord = null; let replenish = null;
      while (Date.now() < deadline && ttfcRecord == null) {
        const recs = await readJsonl(commandsFile);
        const rep = recs.slice(cmdBefore).find(r => r.action === 'replenish');
        if (rep) { ttfcRecord = Date.now() - submitAt; replenish = rep; }
        else await sleep(400);
      }
      const modelRows = (await readJsonl(modelFile)).slice(modelBefore);
      const tokens = modelRows.reduce((sum, r) => sum + (r.usage && r.usage.totalTokens ? r.usage.totalTokens : 0), 0);
      const dom = await page.evaluate(() => ([...document.querySelectorAll('.content-discover-card')].map(c => ({
        title: c.querySelector('h3')?.textContent, kind: c.querySelector('.content-discover-kind')?.textContent,
        videoTag: !!c.querySelector('video.content-discover-video'), audioTag: !!c.querySelector('audio.content-discover-audio'),
        embedTag: !!c.querySelector('iframe.content-discover-embed'), reader: !![...c.querySelectorAll('summary')].find(s => s.textContent === '直接阅读'),
      }))));
      rows.push({ key, query, ttfvMs: ttfvDom ?? ttfvRecord, ttfvDomMs: ttfvDom, ttfvRecordMs: ttfvRecord,
        ttfcMs: ttfcRecord, modelCalls: modelRows.length, modelTokens: tokens,
        fastTrace: seekTrace, fullTrace: replenish && replenish.supply ? replenish.supply : null,
        fastCards: command ? (command.cards || []).length : null, finalCards: dom.length, dom });
      await page.screenshot({ path: `${local}/query-${key}.png`, fullPage: true });
      await fs.writeFile(`${audit}/latency.json`, JSON.stringify({ at: new Date().toISOString(), userData, rows }, null, 2));
      console.log('QUERY', key, 'TTFV', rows[rows.length - 1].ttfvMs, 'TTFC', ttfcRecord, 'calls', modelRows.length, 'tokens', tokens, 'cards', dom.length);
    }
  } finally { await app.close(); }
})().catch(e => { console.error(e.name, String(e.message).slice(0, 300)); process.exitCode = 1; });
