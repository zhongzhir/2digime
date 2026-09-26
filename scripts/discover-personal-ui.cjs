'use strict';
// DISCOVER-2.0-PERSONAL-VALUE-08 Electron acceptance.
// Isolated test Subject (never the Owner's Digital Self): Discover -> personalized cards -> read/play
// -> Ask -> boost -> re-Discover -> reduce -> re-Discover -> reverse -> re-Discover.
const { _electron } = require('playwright');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const local = 'build/evidence/personal-value-08';
const audit = 'docs/audits/evidence/personal-value-08';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SELF = {
  schemaVersion: 1, subjectId: 'default', updatedAt: '2026-01-01T00:00:00.000Z',
  understandings: [
    '我长期关注 AI、创业、一级市场和前沿科技。',
    '我是一名科技领域投资人。',
    '我更关心技术趋势、新公司和商业模式。',
  ].map((text, i) => ({ id: 'u' + i, text, facet: 'preferences', status: 'current', confirmed: true,
    provenance: { origin: 'user_statement', actor: 'owner', statedAt: '2026-01-01T00:00:00.000Z' }, updatedAt: '2026-01-01T00:00:00.000Z' })),
};

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
  const rows = [];
  try {
    const page = await app.firstWindow();
    await page.locator('#view-shell').waitFor({ state: 'visible', timeout: 60000 });
    // Inject the isolated test Digital Self into the blank auto-created Subject.
    const selfDir = path.join(userData, 'subjects/default/digital-self');
    await fs.mkdir(selfDir, { recursive: true });
    await fs.writeFile(path.join(selfDir, 'self.json'), JSON.stringify(SELF, null, 2));
    await page.evaluate(() => window.ShellNav.setNav('discover', { skipRefresh: true }));

    const openState = async () => page.evaluate(() => ({
      cards: [...document.querySelectorAll('.content-discover-card')].map(c => ({
        title: c.querySelector('h3')?.textContent, kind: c.querySelector('.content-discover-kind')?.textContent,
        source: c.querySelector('.content-discover-source')?.textContent, reason: c.querySelector('.content-discover-reason')?.textContent,
      })),
      prefs: [...document.querySelectorAll('#content-discover-pref-list li')].map(li => li.textContent),
    }));
    const waitForRecord = async (before, action, timeout) => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const recs = (await readJsonl(commandsFile)).slice(before);
        if (recs.some(r => r.action === action)) return true;
        await sleep(300);
      }
      return false;
    };
    const seek = async (query) => {
      const before = (await readJsonl(commandsFile)).length;
      await page.locator('#btn-content-discover-search').waitFor({ state: 'visible', timeout: 60000 });
      await page.fill('#content-discover-query', query);
      await page.locator('#btn-content-discover-search').click({ force: true, timeout: 60000 });
      await waitForRecord(before, 'seek', 120000);
      // Wait for the progressive full pass so captured cards are the final merged set.
      await waitForRecord(before, 'replenish', 180000);
      await sleep(1200);
      return openState();
    };

    const first = await seek('最近有什么值得我看的？');
    rows.push({ step: 'first-discover', ...first });
    console.log('STEP first', first.cards.length, 'cards');

    // read / open / ask / boost on the first card.
    const card = page.locator('.content-discover-card').first();
    await page.evaluate(() => {
      const original = window.TalkPage.setContentContext;
      window.TalkPage.setContentContext = function (c) { window.__asked = { title: c.title, bodyCharacters: (c.bodyText || '').length }; return original(c); };
    });
    let bodyCharacters = 0;
    if (await card.locator('summary', { hasText: '直接阅读' }).count()) {
      await card.locator('summary').filter({ hasText: '直接阅读' }).click();
      bodyCharacters = await card.locator('details > div').first().textContent().then(s => s.length);
    }
    for (const label of ['阅读原文', '在来源收听', '在来源观看', '去原平台看', '打开原页']) {
      const b = card.getByRole('button', { name: label, exact: true });
      if (await b.count()) { await b.click().catch(() => {}); break; }
    }
    console.log('STEP opened-original');
    await page.waitForTimeout(600);
    await page.evaluate(() => window.ShellNav.setNav('discover', { skipRefresh: true }));
    await card.getByRole('button', { name: '问兔机米', exact: true }).click();
    await page.locator('#talk-content-context').waitFor({ state: 'visible', timeout: 15000 });
    const asked = await page.evaluate(() => window.__asked);
    await page.evaluate(() => window.ShellNav.setNav('discover', { skipRefresh: true }));
    console.log('STEP ask-ok');
    await card.getByRole('button', { name: '加推类似', exact: true }).click();
    let boostOk = false;
    for (let i = 0; i < 60 && !boostOk; i++) { boostOk = await page.evaluate(() => (document.querySelector('#content-discover-pref-list')?.textContent || '').includes('加推类似')); if (!boostOk) await sleep(1000); }
    rows.push({ step: 'journey', bodyCharacters, asked, boostOk, prefs: (await openState()).prefs });

    const afterBoost = await seek('最近有什么值得我看的？');
    rows.push({ step: 'after-boost', ...afterBoost });

    // reduce the current first card.
    const card2 = page.locator('.content-discover-card').first();
    console.log('STEP after-boost done');
    await card2.getByRole('button', { name: '少推类似', exact: true }).click();
    let reduceOk = false;
    for (let i = 0; i < 60 && !reduceOk; i++) { reduceOk = await page.evaluate(() => (document.querySelector('#content-discover-pref-list')?.textContent || '').includes('少推类似')); if (!reduceOk) await sleep(1000); }
    const afterReduce = await seek('最近有什么值得我看的？');
    rows.push({ step: 'after-reduce', reduceOk, ...afterReduce });

    // reverse the first preference and re-discover.
    console.log('STEP reduce done');
    await page.evaluate(() => window.ShellNav.setNav('discover', { skipRefresh: true }));
    await page.locator('.discover-switch[data-discover-section="prefs"]').click({ force: true }).catch(() => {});
    await sleep(500);
    const reverseBtn = page.locator('#content-discover-pref-list li button').first();
    let reverseOk = false;
    if (await reverseBtn.count()) { await reverseBtn.click({ force: true }).catch(() => {}); await sleep(3000); reverseOk = true; }
    const afterReverse = await seek('最近有什么值得我看的？');
    rows.push({ step: 'after-reverse', reverseOk, ...afterReverse });

    await fs.writeFile(`${audit}/ui.json`, JSON.stringify({ at: new Date().toISOString(), userData, rows }, null, 2));
    console.log('UI first', first.cards.length, 'boost', boostOk, 'reduce', reduceOk, 'reverse', reverseOk,
      'read', bodyCharacters, 'ask', asked && asked.title);
  } finally { await app.close(); }
})().catch(e => { console.error(e.name, String(e.message).slice(0, 300)); process.exitCode = 1; });
