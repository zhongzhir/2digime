'use strict';
// DISCOVER-2.0-REAL-USER-CANDIDATE-09 smoke: isolated test Subject, real internet + model.
// A news, B "worth watching", C video, D audio, E read+Ask, F play video, G play audio,
// H reduce -> re-discover -> reverse, I current intent overrides long-term preference.
// Also scans the user-visible text for technical jargon.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const local = 'build/evidence/real-user-candidate-09';
const audit = 'docs/audits/evidence/real-user-candidate-09';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SELF = {
  schemaVersion: 1, subjectId: 'default', updatedAt: '2026-01-01T00:00:00.000Z',
  understandings: ['我长期关注 AI、创业、一级市场和前沿科技。', '我是一名科技领域投资人。'].map((text, i) => ({
    id: 'u' + i, text, facet: 'preferences', status: 'current', confirmed: true,
    provenance: { origin: 'user_statement', actor: 'owner', statedAt: '2026-01-01T00:00:00.000Z' }, updatedAt: '2026-01-01T00:00:00.000Z' })),
};
const JARGON = /\b(RSS|HLS|DASH|JSON-?LD|resolver|NetworkItem|Relay|provider|schema\.org|oEmbed|embed|fetch|IPC)\b|播放器内核|广告位/i;

(async () => {
  await fs.mkdir(local, { recursive: true });
  await fs.mkdir(audit, { recursive: true });
  await fs.writeFile(path.join(local, 'commands.jsonl'), '');
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
  const readJsonl = async (file) => (await fs.readFile(file, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const steps = [];
  try {
    const page = await app.firstWindow();
    await page.locator('#view-shell').waitFor({ state: 'visible', timeout: 60000 });
    const selfDir = path.join(userData, 'subjects/default/digital-self');
    await fs.mkdir(selfDir, { recursive: true });
    await fs.writeFile(path.join(selfDir, 'self.json'), JSON.stringify(SELF, null, 2));
    await page.evaluate(() => window.ShellNav.setNav('discover', { skipRefresh: true }));
    await page.evaluate(() => {
      const original = window.TalkPage.setContentContext;
      window.TalkPage.setContentContext = function (c) { window.__asked = { title: c.title, bodyCharacters: (c.bodyText || '').length }; return original(c); };
    });

    const waitForRecord = async (before, action, timeout) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        if ((await readJsonl(commandsFile)).slice(before).some(r => r.action === action)) return true;
        await sleep(300);
      }
      return false;
    };
    const state = () => page.evaluate(() => ({
      cards: [...document.querySelectorAll('.content-discover-card')].map(c => ({
        title: c.querySelector('h3')?.textContent, kind: c.querySelector('.content-discover-kind')?.textContent,
        source: c.querySelector('.content-discover-source')?.textContent, reason: c.querySelector('.content-discover-reason')?.textContent,
        reader: !![...c.querySelectorAll('summary')].find(s => s.textContent === '直接阅读'),
        video: !!c.querySelector('video.content-discover-video'), audio: !!c.querySelector('audio.content-discover-audio'),
      })),
      notice: document.querySelector('#content-discover-notice')?.textContent || '',
      visibleText: (document.querySelector('#content-discover')?.innerText || ''),
    }));
    const seek = async (query) => {
      const before = (await readJsonl(commandsFile)).length;
      const started = Date.now();
      await page.fill('#content-discover-query', query);
      await page.locator('#btn-content-discover-search').click({ force: true, timeout: 60000 });
      await waitForRecord(before, 'seek', 120000);
      const ttfv = Date.now() - started;
      await waitForRecord(before, 'replenish', 180000);
      await sleep(1200);
      const s = await state();
      return { query, ttfv, ttfc: Date.now() - started, cards: s.cards, notice: s.notice, jargon: [...new Set((s.visibleText.match(JARGON) || []).map(x => x.toLowerCase()))] };
    };

    for (const q of ['今天有什么值得关注的新闻？', '最近有什么值得我看的？', '最近有什么值得看的 AI / 科技视频？', '最近有什么值得听的内容？']) {
      const r = await seek(q);
      steps.push({ step: q, ...r });
      console.log('SMOKE', r.cards.length, 'cards ttfv', r.ttfv, 'ttfc', r.ttfc, 'jargon', JSON.stringify(r.jargon));
    }

    // E: read an article + Ask.
    const article = page.locator('.content-discover-card').filter({ has: page.locator('summary', { hasText: '直接阅读' }) }).first();
    if (await article.count()) {
      await article.locator('summary').filter({ hasText: '直接阅读' }).click();
      const bodyCharacters = await article.locator('details > div').first().textContent().then(s => s.length);
      await article.getByRole('button', { name: '问兔机米', exact: true }).click();
      await page.locator('#talk-content-context').waitFor({ state: 'visible', timeout: 15000 });
      const asked = await page.evaluate(() => window.__asked);
      const talkLabel = await page.locator('#talk-content-context').textContent();
      await page.evaluate(() => window.ShellNav.setNav('discover', { skipRefresh: true }));
      steps.push({ step: 'E read+ask', bodyCharacters, asked, talkLabel });
      console.log('SMOKE E read', bodyCharacters, 'ask', asked && asked.title);
    }

    // F: play a video, G: play an audio (already on the video/audio query results? re-seek to get them).
    for (const [label, q] of [['F video', '最近有什么值得看的 AI / 科技视频？'], ['G audio', '最近有什么值得听的内容？']]) {
      await seek(q);
      const selector = label.startsWith('F') ? 'video.content-discover-video' : 'audio.content-discover-audio';
      const has = await page.locator(selector).count();
      let duration = 0; let currentTime = 0;
      if (has) {
        await page.locator(selector).first().evaluate(async (el) => { try { el.muted = true; await el.play(); } catch { /* autoplay */ } });
        await sleep(2500);
        const info = await page.locator(selector).first().evaluate((el) => ({ duration: Number.isFinite(el.duration) ? Math.round(el.duration) : 0, currentTime: Number.isFinite(el.currentTime) ? Number(el.currentTime.toFixed(1)) : 0 }));
        duration = info.duration; currentTime = info.currentTime;
      }
      const embedCount = label.startsWith('F') ? await page.locator('iframe.content-discover-embed').count() : 0;
      const embedSrc = embedCount ? await page.locator('iframe.content-discover-embed').first().getAttribute('src') : '';
      steps.push({ step: label, query: q, directPlayer: has > 0, duration, currentTime, officialEmbed: embedCount > 0, embedSrc: (embedSrc || '').slice(0, 80) });
      console.log('SMOKE', label, 'directPlayer', has, 'duration', duration, 'currentTime', currentTime, 'officialEmbed', embedCount);
    }

    // H: reduce -> re-discover -> reverse.
    const base = await seek('最近有什么值得我看的？');
    const firstTitle = base.cards[0]?.title || '';
    const card = page.locator('.content-discover-card').first();
    await card.getByRole('button', { name: '少推类似', exact: true }).click();
    let reduceOk = false;
    for (let i = 0; i < 60 && !reduceOk; i++) { reduceOk = await page.evaluate(() => (document.querySelector('#content-discover-pref-list')?.textContent || '').includes('少推类似')); if (!reduceOk) await sleep(1000); }
    const afterReduce = await seek('最近有什么值得我看的？');
    await page.evaluate(() => window.ShellNav.setNav('discover', { skipRefresh: true }));
    await page.locator('.discover-switch[data-discover-section="prefs"]').click({ force: true }).catch(() => {});
    await sleep(500);
    let reverseOk = false;
    const rev = page.locator('#content-discover-pref-list li button').first();
    if (await rev.count()) { await rev.click({ force: true }).catch(() => {}); await sleep(3000); reverseOk = true; }
    const afterReverse = await seek('最近有什么值得我看的？');
    steps.push({ step: 'H feedback', firstTitle, reduceOk, reducedOut: !afterReduce.cards.some(c => c.title === firstTitle), reverseOk, restored: afterReverse.cards.some(c => c.title === firstTitle) });
    console.log('SMOKE H reduceOk', reduceOk, 'removed', !afterReduce.cards.some(c => c.title === firstTitle), 'reverseOk', reverseOk, 'restored', afterReverse.cards.some(c => c.title === firstTitle));

    // I: current intent overrides long-term preference.
    const light = await seek('今天不要给我科技内容，想看点轻松的。');
    const tech = light.cards.filter(c => /AI|芯片|模型|算力|机器人|融资|Agent|半导体|大模型/i.test(c.title || '')).length;
    steps.push({ step: 'I intent override', query: '今天不要给我科技内容，想看点轻松的。', cards: light.cards.length, techTitles: tech, sample: light.cards.slice(0, 4).map(c => c.title) });
    console.log('SMOKE I cards', light.cards.length, 'techTitles', tech);

    await fs.writeFile(`${audit}/smoke.json`, JSON.stringify({ at: new Date().toISOString(), userData, steps }, null, 2));
    console.log('SMOKE DONE');
  } finally { await app.close(); }
})().catch(e => { console.error(e.name, String(e.message).slice(0, 300)); process.exitCode = 1; });
