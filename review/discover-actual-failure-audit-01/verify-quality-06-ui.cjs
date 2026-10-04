/** 合并试用复验：新表达课程/漫剧 + 调整撤销瀑布流对话。隔离 owner-copy。 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA = process.env.AUDIT_DATA_ROOT
  || path.join(ROOT, '..', '_dm-audit-data', 'discover-actual-failure-audit-01');
const SRC = path.join(DATA, 'owner-copy', 'userData');
const RUN = path.join(DATA, 'runs', 'quality-06-ui');
const OUT = path.join(RUN, 'ui-report.json');
const PACKAGED = process.env.PACKAGED_EXE || '';

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  spawnSync('robocopy', [from, to, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/nc', '/ns', '/np'], {
    windowsHide: true,
  });
}

function cardsOf(page) {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#content-discover-list > li')).map((n) => ({
      title: String(n.querySelector('h3')?.textContent || '').replace(/\s+/g, ' ').trim(),
      url: n.getAttribute('data-url') || '',
      access: n.getAttribute('data-access-state') || '',
      cond: n.getAttribute('data-condition-status') || '',
      kind: n.getAttribute('data-object-kind') || '',
      entrance: n.getAttribute('data-entrance-purpose') || '',
      note: String(n.querySelector('.content-discover-condition')?.textContent || '').trim(),
    }));
    const related = Array.from(document.querySelectorAll('#content-discover-related-list > li h3'))
      .map((n) => String(n.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    return {
      titles: rows.map((row) => row.title).filter(Boolean).slice(0, 12),
      cards: rows.slice(0, 12),
      related: related.slice(0, 8),
      notice: String(document.getElementById('content-discover-notice')?.textContent || '').trim(),
      summary: String(document.getElementById('content-discover-adjust-summary')?.textContent || '').trim(),
      bannerHidden: !!document.getElementById('content-discover-adjust-banner')?.hidden,
      columns: Number(getComputedStyle(document.getElementById('content-discover-list') || document.body).gridTemplateColumns.split(' ').filter(Boolean).length || 0),
    };
  });
}

async function waitFirst(page, ms, ready) {
  const start = Date.now();
  let last = await cardsOf(page);
  while (Date.now() - start < ms) {
    last = await cardsOf(page);
    if (ready(last)) return { snap: last, ms: Date.now() - start };
    await page.waitForTimeout(400);
  }
  return { snap: last, ms: Date.now() - start };
}

async function waitSettled(page, ms, ready) {
  const start = Date.now();
  let last = await cardsOf(page);
  while (Date.now() - start < ms) {
    last = await cardsOf(page);
    const pending = /正在|准备一些|调整推荐|恢复默认/.test(last.notice || '');
    if (!pending && ready(last)) return { snap: last, ms: Date.now() - start };
    await page.waitForTimeout(1200);
  }
  return { snap: last, ms: Date.now() - start };
}

(async () => {
  if (!fs.existsSync(SRC)) throw new Error('owner-copy missing');
  fs.rmSync(RUN, { recursive: true, force: true });
  const userData = path.join(RUN, 'userData');
  const home = path.join(RUN, 'home');
  copyTree(SRC, userData);
  fs.mkdirSync(home, { recursive: true });

  const electronPath = PACKAGED || require('electron');
  const args = PACKAGED ? [] : [path.join(ROOT, 'electron', 'main.cjs')];
  const playwright = await import('playwright');
  const app = await playwright._electron.launch({
    executablePath: electronPath,
    args,
    cwd: PACKAGED ? path.dirname(electronPath) : ROOT,
    timeout: 60_000,
    env: {
      ...process.env,
      DIGITALME_V2_ROOT: PACKAGED ? path.dirname(electronPath) : ROOT,
      DIGITALME_V2_USER_DATA: userData,
      DIGITALME_V2_HOME: home,
      DIGITALME_V2_ELECTRON_TEST: '0',
      DIGITALME_V2_UX_ACCEPTANCE: '0',
      DIGITALME_V2_DIGITAL_SELF_STUB: '0',
      DIGITALME_V2_TALK_STUB: '0',
    },
  });
  const started = Date.now();
  const report = {
    productShaTrial: '230cfc6',
    packaged: !!PACKAGED,
    packagedExe: PACKAGED || '',
    steps: [],
  };
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

    await page.locator('#nav-chat').dispatchEvent('click');
    let talkOk = false;
    let talkReply = '';
    try {
      await page.locator('#chat-input').waitFor({ state: 'visible', timeout: 8_000 });
      await page.fill('#chat-input', '请用一句话打个招呼，不要改发现里的列表。');
      await page.locator('#btn-chat-send').click();
      const talkDeadline = Date.now() + 40_000;
      while (Date.now() < talkDeadline) {
        talkReply = await page.evaluate(() => {
          const turns = Array.from(document.querySelectorAll('#chat-turns .turn-assistant, #chat-turns li, #chat-turns p'));
          return turns.map((n) => String(n.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(-1)[0] || '';
        });
        if (talkReply && !/正在|思考/.test(talkReply)) break;
        await page.waitForTimeout(1000);
      }
      talkOk = !!talkReply;
    } catch {
      talkOk = false;
    }
    report.steps.push({ at: Date.now() - started, step: 'talk-smoke', talkOk, talkReply: String(talkReply || '').slice(0, 160) });

    await page.locator('#nav-discover').waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('#nav-discover').dispatchEvent('click');
    await page.locator('#panel-discover').waitFor({ state: 'visible', timeout: 20_000 });
    const openedFirst = await waitFirst(page, 20_000, (snap) => snap.titles.length > 0);
    const opened = await waitSettled(page, 40_000, (snap) => snap.titles.length > 0);
    report.steps.push({
      at: Date.now() - started,
      step: 'open-discover',
      firstMs: openedFirst.ms,
      finalMs: opened.ms,
      ...opened.snap,
    });
    await page.screenshot({ path: path.join(RUN, '01-discover.png') });

    await page.evaluate(() => {
      const forYou = document.getElementById('content-discover-for-you');
      if (forYou) forYou.hidden = false;
      document.getElementById('btn-discover-adjust')?.click();
    });
    await page.waitForFunction(() => !document.getElementById('content-discover-adjust-form')?.hidden, null, {
      timeout: 10_000,
    });
    const courseText = '工作日晚上想上几门能上手的量化投研课';
    await page.evaluate((value) => {
      const box = document.getElementById('content-discover-adjust-text');
      if (box) {
        box.value = value;
        box.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, courseText);
    const courseStarted = Date.now();
    await page.evaluate(() => document.getElementById('btn-adjust-apply')?.click());
    const courseFirst = await waitFirst(
      page,
      45_000,
      (snap) => snap.bannerHidden === false && snap.titles.length > 0,
    );
    const courseFinal = await waitSettled(
      page,
      90_000,
      (snap) => snap.bannerHidden === false && snap.titles.length > 0,
    );
    report.steps.push({
      at: Date.now() - started,
      step: 'adjust-course',
      query: courseText,
      firstMs: courseFirst.ms,
      finalMs: Date.now() - courseStarted,
      firstTitles: courseFirst.snap.titles,
      ...courseFinal.snap,
    });
    await page.screenshot({ path: path.join(RUN, '02-adjust-course.png') });

    const manjuText = '有没有气氛轻松的古风国创漫剧可以追';
    await page.evaluate((value) => {
      const input = document.getElementById('content-discover-query');
      if (input) {
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, manjuText);
    const manjuStarted = Date.now();
    await page.evaluate(() => document.getElementById('btn-content-discover-search')?.click());
    const manjuFirst = await waitFirst(page, 40_000, (snap) => snap.titles.length > 0 || snap.related.length > 0);
    const manjuFinal = await waitSettled(page, 90_000, (snap) => snap.titles.length > 0 || snap.related.length > 0);
    report.steps.push({
      at: Date.now() - started,
      step: 'seek-manju',
      query: manjuText,
      firstMs: manjuFirst.ms,
      finalMs: Date.now() - manjuStarted,
      firstTitles: manjuFirst.snap.titles,
      ...manjuFinal.snap,
    });
    await page.screenshot({ path: path.join(RUN, '03-seek-manju.png') });

    const revokeStarted = Date.now();
    await page.evaluate(() => document.getElementById('btn-adjust-revoke')?.click());
    const revokeFirst = await waitFirst(page, 8_000, (snap) => snap.bannerHidden === true);
    const revokeFinal = await waitSettled(page, 60_000, (snap) => snap.bannerHidden === true);
    report.steps.push({
      at: Date.now() - started,
      step: 'revoke',
      firstMs: revokeFirst.ms,
      finalMs: Date.now() - revokeStarted,
      firstTitles: revokeFirst.snap.titles,
      ...revokeFinal.snap,
    });
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
