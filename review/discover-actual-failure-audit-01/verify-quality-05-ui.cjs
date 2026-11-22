/** 合并候选真实界面：排版、来源、调整、交付、核实与撤销。隔离 owner-copy。 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA = process.env.AUDIT_DATA_ROOT
  || path.join(ROOT, '..', '_dm-audit-data', 'discover-actual-failure-audit-01');
const SRC = path.join(DATA, 'owner-copy', 'userData');
const RUN = path.join(DATA, 'runs', 'quality-05-ui');
const OUT = path.join(RUN, 'ui-report.json');

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  spawnSync('robocopy', [from, to, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/nc', '/ns', '/np'], {
    windowsHide: true,
  });
}

function cardsOf(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#content-discover-list > li')).map((n) => ({
      title: String(n.querySelector('h3')?.textContent || n.textContent || '').replace(/\s+/g, ' ').trim(),
      url: n.getAttribute('data-url') || '',
      access: n.getAttribute('data-access-state') || '',
      cond: n.getAttribute('data-condition-status') || '',
      kind: n.getAttribute('data-object-kind') || '',
      entrance: n.getAttribute('data-entrance-purpose') || '',
      note: String(n.querySelector('.content-discover-condition')?.textContent || '').trim(),
    }));
    const accessTitles = Array.from(document.querySelectorAll('#content-discover-access-list h3'))
      .map((n) => String(n.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    return {
      titles: rows.map((row) => row.title).filter(Boolean).slice(0, 12),
      cards: rows.slice(0, 12),
      accessTitles: accessTitles.slice(0, 8),
      notice: String(document.getElementById('content-discover-notice')?.textContent || '').trim(),
      summary: String(document.getElementById('content-discover-adjust-summary')?.textContent || '').trim(),
      question: String(document.getElementById('content-discover-adjust-question')?.textContent || '').trim(),
      bannerHidden: !!document.getElementById('content-discover-adjust-banner')?.hidden,
      columns: Number(getComputedStyle(document.getElementById('content-discover-list') || document.body).gridTemplateColumns.split(' ').filter(Boolean).length || 0),
    };
  });
}

async function waitSettled(page, ms, ready) {
  const start = Date.now();
  let last = await cardsOf(page);
  while (Date.now() - start < ms) {
    last = await cardsOf(page);
    const notice = last.notice || '';
    const pending = /正在|准备一些|调整推荐/.test(notice);
    if (!pending && ready(last)) return last;
    await page.waitForTimeout(1500);
  }
  return last;
}

(async () => {
  if (!fs.existsSync(SRC)) throw new Error('owner-copy missing');
  fs.rmSync(RUN, { recursive: true, force: true });
  const userData = path.join(RUN, 'userData');
  const home = path.join(RUN, 'home');
  copyTree(SRC, userData);
  fs.mkdirSync(home, { recursive: true });

  const electronPath = require('electron');
  const playwright = await import('playwright');
  const app = await playwright._electron.launch({
    executablePath: electronPath,
    args: [path.join(ROOT, 'electron', 'main.cjs')],
    cwd: ROOT,
    timeout: 60_000,
    env: {
      ...process.env,
      DIGITALME_V2_ROOT: ROOT,
      DIGITALME_V2_USER_DATA: userData,
      DIGITALME_V2_HOME: home,
      DIGITALME_V2_ELECTRON_TEST: '0',
      DIGITALME_V2_UX_ACCEPTANCE: '0',
      DIGITALME_V2_DIGITAL_SELF_STUB: '0',
      DIGITALME_V2_TALK_STUB: '0',
    },
  });
  const started = Date.now();
  const report = { productShaTrial: '230cfc6', steps: [] };
  try {
    const page = await app.firstWindow({ timeout: 90_000 });
    await page.waitForLoadState('domcontentloaded');
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (await page.locator('#nav-discover').isVisible().catch(() => false)) break;
      await page.evaluate(() => {
        document.getElementById('btn-welcome-skip-model')?.click();
        document.getElementById('btn-create-skip')?.click();
        document.getElementById('btn-intro-continue')?.click();
      });
      await page.waitForTimeout(400);
    }
    await page.locator('#view-shell').waitFor({ state: 'visible', timeout: 20_000 });
    await page.locator('#nav-discover').waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('#nav-discover').dispatchEvent('click');
    await page.locator('#panel-discover').waitFor({ state: 'visible', timeout: 20_000 });
    const opened = await waitSettled(page, 40_000, (snap) => snap.titles.length > 0);
    report.steps.push({ at: Date.now() - started, step: 'open-discover', ...opened });
    await page.screenshot({ path: path.join(RUN, '01-discover.png') });

    await page.locator('#panel-discover').evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.evaluate(() => {
      const forYou = document.getElementById('content-discover-for-you');
      if (forYou) forYou.hidden = false;
      document.getElementById('btn-discover-adjust')?.click();
    });
    await page.waitForFunction(() => !document.getElementById('content-discover-adjust-form')?.hidden, null, {
      timeout: 10_000,
    });
    await page.evaluate(() => {
      const box = document.getElementById('content-discover-adjust-text');
      if (box) {
        box.value = '最近看剧有点多了，帮我找几门适合我的AI投资与产品落地课程，每天大约一小时。';
        box.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await page.evaluate(() => document.getElementById('btn-adjust-apply')?.click());
    const firstCourse = await waitSettled(
      page,
      45_000,
      (snap) => snap.bannerHidden === false && snap.titles.length > 0,
    );
    report.steps.push({ at: Date.now() - started, step: 'adjust-course-first', ...firstCourse });
    const adjusted = await waitSettled(
      page,
      90_000,
      (snap) => snap.bannerHidden === false && /课程|公开课|实战/.test(snap.titles.join('\n') + snap.summary),
    );
    report.steps.push({ at: Date.now() - started, step: 'adjust-course', ...adjusted });
    await page.screenshot({ path: path.join(RUN, '02-adjust-course.png') });

    const unused = [
      ['gannan', '带孩子去甘南若尔盖住哪里'],
      ['manju', '周末想看点轻松的国创奇幻漫剧'],
    ];
    for (const [name, text] of unused) {
      await page.evaluate((value) => {
        const input = document.getElementById('content-discover-query');
        if (input) {
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, text);
      await page.evaluate(() => document.getElementById('btn-content-discover-search')?.click());
      const sought = await waitSettled(page, 90_000, (snap) => snap.titles.length > 0);
      report.steps.push({ at: Date.now() - started, step: 'seek-' + name, query: text, ...sought });
      await page.screenshot({ path: path.join(RUN, `03-seek-${name}.png`) });
    }

    const revokeStarted = Date.now();
    await page.evaluate(() => document.getElementById('btn-adjust-revoke')?.click());
    const revokeImmediate = await page.evaluate(() => ({
      bannerHidden: !!document.getElementById('content-discover-adjust-banner')?.hidden,
    }));
    report.steps.push({
      at: Date.now() - started,
      step: 'revoke-click',
      clickMs: Date.now() - revokeStarted,
      ...revokeImmediate,
    });
    const revoked = await waitSettled(page, 60_000, (snap) => snap.bannerHidden === true);
    report.steps.push({ at: Date.now() - started, step: 'revoke', ...revoked });
    await page.screenshot({ path: path.join(RUN, '04-revoke.png') });
    report.totalMs = Date.now() - started;
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  } catch (err) {
    report.error = String(err && err.stack || err);
    report.totalMs = Date.now() - started;
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
    throw err;
  } finally {
    try { await app.close(); } catch { /* ignore */ }
  }
})();
