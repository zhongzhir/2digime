/** 同一 owner-copy：撤销 / 后台成功 / 后台失败 / 换主题 / 屏蔽 / 连续加载。 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA = process.env.AUDIT_DATA_ROOT
  || path.join(ROOT, '..', '_dm-audit-data', 'discover-actual-failure-audit-01');
const SRC = path.join(DATA, 'owner-copy', 'userData');
const RUN = path.join(DATA, 'runs', 'quality-08-ui');
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
      titles: rows.map((row) => row.title).filter(Boolean).slice(0, 16),
      cards: rows.slice(0, 16),
      related: related.slice(0, 8),
      relatedTitle: String(document.getElementById('content-discover-related-title')?.textContent || '').trim(),
      notice: String(document.getElementById('content-discover-notice')?.textContent || '').trim(),
      summary: String(document.getElementById('content-discover-adjust-summary')?.textContent || '').trim(),
      bannerHidden: !!document.getElementById('content-discover-adjust-banner')?.hidden,
      replenishing: document.getElementById('content-discover')?.dataset.replenishing === '1',
      cancelHidden: !!document.getElementById('btn-discover-cancel')?.hidden,
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
    const pending = last.replenishing || /正在|准备一些|调整推荐|恢复默认/.test(last.notice || '');
    if (!pending && ready(last)) return { snap: last, ms: Date.now() - start };
    await page.waitForTimeout(1200);
  }
  return { snap: last, ms: Date.now() - start };
}

async function skipWelcome(page) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await page.locator('#nav-discover').isVisible().catch(() => false)) return;
    await page.evaluate(() => {
      document.getElementById('btn-welcome-skip-model')?.click();
      document.getElementById('btn-create-skip')?.click();
      document.getElementById('btn-intro-continue')?.click();
    });
    await page.waitForTimeout(400);
  }
}

async function applyAdjust(page, text) {
  await page.evaluate(() => {
    const forYou = document.getElementById('content-discover-for-you');
    if (forYou) forYou.hidden = false;
    document.getElementById('btn-discover-adjust')?.click();
  });
  await page.waitForFunction(() => !document.getElementById('content-discover-adjust-form')?.hidden, null, {
    timeout: 10_000,
  });
  await page.evaluate((value) => {
    const box = document.getElementById('content-discover-adjust-text');
    if (box) {
      box.value = value;
      box.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, text);
  const started = Date.now();
  await page.evaluate(() => document.getElementById('btn-adjust-apply')?.click());
  return started;
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
  const report = { productShaTrial: '230cfc6', packaged: !!PACKAGED, packagedExe: PACKAGED || '', steps: [] };
  try {
    const page = await app.firstWindow({ timeout: 90_000 });
    await page.waitForLoadState('domcontentloaded');
    await skipWelcome(page);
    await page.locator('#view-shell').waitFor({ state: 'visible', timeout: 20_000 });
    await page.locator('#nav-discover').waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('#nav-discover').dispatchEvent('click');
    await page.locator('#panel-discover').waitFor({ state: 'visible', timeout: 20_000 });

    const openedFirst = await waitFirst(page, 20_000, (snap) => snap.titles.length > 0);
    const opened = await waitSettled(page, 50_000, (snap) => snap.titles.length > 0);
    const baselineTitles = opened.snap.titles.slice();
    report.steps.push({
      at: Date.now() - started,
      step: 'open-discover',
      firstMs: openedFirst.ms,
      finalMs: opened.ms,
      ...opened.snap,
    });
    await page.screenshot({ path: path.join(RUN, '01-open.png') });

    const topicStarted = await applyAdjust(page, '最近想多听几集公开科学播客');
    const topicReady = (snap) => snap.bannerHidden === false && (snap.titles.length > 0 || snap.related.length > 0);
    const topicFirst = await waitFirst(page, 45_000, topicReady);
    const topicFinal = await waitSettled(page, 90_000, topicReady);
    report.steps.push({
      at: Date.now() - started,
      step: 'topic-change',
      query: '最近想多听几集公开科学播客',
      firstMs: topicFirst.ms,
      finalMs: Date.now() - topicStarted,
      firstTitles: topicFirst.snap.titles,
      ...topicFinal.snap,
    });
    await page.screenshot({ path: path.join(RUN, '02-topic.png') });

    const revokeStarted = Date.now();
    await page.evaluate(() => document.getElementById('btn-adjust-revoke')?.click());
    const revokeImmediate = await waitFirst(page, 8_000, (snap) => snap.titles.length >= Math.min(6, baselineTitles.length));
    const revokeDone = await waitSettled(page, 70_000, (snap) => snap.bannerHidden === true && snap.titles.length >= Math.min(6, baselineTitles.length));
    const overlap = (revokeDone.snap.titles || []).filter((title) => baselineTitles.includes(title)).length;
    report.steps.push({
      at: Date.now() - started,
      step: 'revoke-background-success',
      firstMs: revokeImmediate.ms,
      finalMs: Date.now() - revokeStarted,
      firstTitles: revokeImmediate.snap.titles,
      baselineOverlap: overlap,
      restoringGone: !/正在恢复/.test(revokeDone.snap.notice || ''),
      ...revokeDone.snap,
    });
    await page.screenshot({ path: path.join(RUN, '03-revoke-success.png') });

    await applyAdjust(page, '换一批更轻松的公开影像');
    await waitFirst(page, 12_000, (snap) => snap.replenishing === true || snap.bannerHidden === false);
    const failStarted = Date.now();
    await page.evaluate(() => document.getElementById('btn-discover-cancel')?.click());
    const failDone = await waitSettled(page, 20_000, (snap) => snap.replenishing === false);
    report.steps.push({
      at: Date.now() - started,
      step: 'background-fail-cancel',
      firstMs: Date.now() - failStarted,
      finalMs: Date.now() - failStarted,
      terminal: failDone.snap.replenishing === false && failDone.snap.cancelHidden === true,
      ...failDone.snap,
    });
    await page.screenshot({ path: path.join(RUN, '04-cancel.png') });

    if (failDone.snap.bannerHidden === false) {
      await page.evaluate(() => document.getElementById('btn-adjust-revoke')?.click());
      await waitSettled(page, 40_000, (snap) => snap.bannerHidden === true);
    }

    const beforeBlock = await cardsOf(page);
    const blockedTitle = beforeBlock.titles[0] || '';
    if (blockedTitle) {
      await page.evaluate(() => {
        const more = document.querySelector('#content-discover-list > li details.content-discover-more');
        if (more) more.open = true;
      });
      await page.locator('#content-discover-list > li >> text=不再看这个来源').first().click({ timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(800);
      await page.evaluate(() => document.getElementById('btn-discover-refresh')?.click());
      const afterBlock = await waitSettled(page, 40_000, (snap) => snap.titles.length > 0);
      report.steps.push({
        at: Date.now() - started,
        step: 'block-still-applies',
        blockedTitle,
        stillPresent: afterBlock.snap.titles.includes(blockedTitle),
        ...afterBlock.snap,
      });
    } else {
      report.steps.push({ at: Date.now() - started, step: 'block-still-applies', skipped: true });
    }
    await page.screenshot({ path: path.join(RUN, '05-block.png') });

    const beforeMore = await cardsOf(page);
    await page.evaluate(() => {
      const panel = document.getElementById('panel-discover');
      if (panel) panel.scrollTop = panel.scrollHeight;
      window.scrollTo(0, document.body.scrollHeight);
    });
    const afterMore = await waitFirst(page, 15_000, (snap) => snap.titles.length > beforeMore.titles.length);
    const frontUnchanged = beforeMore.titles.slice(0, 3).every((title, i) => afterMore.snap.titles[i] === title);
    report.steps.push({
      at: Date.now() - started,
      step: 'continuous-more',
      beforeCount: beforeMore.titles.length,
      afterCount: afterMore.snap.titles.length,
      frontUnchanged,
      firstTitles: afterMore.snap.titles.slice(0, 6),
    });
    await page.screenshot({ path: path.join(RUN, '06-more.png') });

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
