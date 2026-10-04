/** 打包界面：屏蔽来源、条件标注、连续加载。不重复主题搜索。 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const DATA = process.env.AUDIT_DATA_ROOT
  || path.join(ROOT, '..', '_dm-audit-data', 'discover-actual-failure-audit-01');
const SRC = path.join(DATA, 'owner-copy', 'userData');
const RUN = path.join(DATA, 'runs', 'quality-09-ui');
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
      itemId: n.getAttribute('data-item-id') || '',
      publisherId: n.getAttribute('data-publisher-id') || '',
      url: n.getAttribute('data-url') || '',
      cond: n.getAttribute('data-condition-status') || '',
      excerpt: n.getAttribute('data-excerpt') || '',
      entrance: n.getAttribute('data-entrance-purpose') || '',
      note: String(n.querySelector('.content-discover-condition')?.textContent || '').trim(),
      kind: String(n.querySelector('.content-discover-kind')?.textContent || '').trim(),
    }));
    return {
      titles: rows.map((row) => row.title).filter(Boolean),
      cards: rows,
      notice: String(document.getElementById('content-discover-notice')?.textContent || '').trim(),
      replenishing: document.getElementById('content-discover')?.dataset.replenishing === '1',
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

    const opened = await waitSettled(page, 50_000, (snap) => snap.titles.length > 0);
    const labeled = opened.snap.cards.filter((card) => card.note || card.cond === 'unconfirmed' || /部分匹配/.test(card.kind || card.entrance || ''));
    report.steps.push({
      at: Date.now() - started,
      step: 'open-discover',
      finalMs: opened.ms,
      conditionLabeled: labeled.length,
      sampleNotes: labeled.slice(0, 4).map((card) => ({ title: card.title, cond: card.cond, note: card.note, kind: card.kind })),
      ...opened.snap,
    });
    await page.screenshot({ path: path.join(RUN, '01-open.png') });

    const target = opened.snap.cards.find((card) => card.publisherId) || opened.snap.cards[0] || {};
    if (target.publisherId || target.itemId) {
      const clicked = await page.evaluate(() => {
        const li = document.querySelector('#content-discover-list > li');
        const details = li && li.querySelector('details.content-discover-more');
        if (details) details.open = true;
        const btn = Array.from(li ? li.querySelectorAll('button') : []).find((n) =>
          /不再看这个来源/.test(n.textContent || ''),
        );
        if (btn) btn.click();
        return !!btn;
      });
      const afterBlock = await waitSettled(page, 40_000, (snap) => {
        if (!clicked) return snap.titles.length > 0;
        return (
          snap.titles.length > 0 &&
          !snap.cards.some((card) => target.itemId && card.itemId === target.itemId)
        );
      });
      await page.evaluate(() => document.getElementById('btn-discover-refresh')?.click());
      const afterRefresh = await waitSettled(page, 40_000, (snap) => snap.titles.length > 0);
      const stillSameItem = afterRefresh.snap.cards.some((card) => target.itemId && card.itemId === target.itemId);
      const stillSameSource = afterRefresh.snap.cards.some((card) => target.publisherId && card.publisherId === target.publisherId);
      report.steps.push({
        at: Date.now() - started,
        step: 'block-source-then-refresh',
        clicked,
        blockedTitle: target.title,
        blockedPublisher: target.publisherId,
        afterBlockGone: !afterBlock.snap.cards.some((card) => target.itemId && card.itemId === target.itemId),
        stillSameItem,
        stillSameSource,
        ok: clicked && !stillSameItem && !stillSameSource,
        ...afterRefresh.snap,
      });
    } else {
      report.steps.push({ at: Date.now() - started, step: 'block-source-then-refresh', skipped: true });
    }
    await page.screenshot({ path: path.join(RUN, '02-block.png') });

    const beforeMore = await cardsOf(page);
    await page.evaluate(() => {
      const panel = document.getElementById('panel-discover');
      if (panel) {
        panel.scrollTop = panel.scrollHeight;
        panel.dispatchEvent(new Event('scroll'));
      }
      window.scrollTo(0, document.body.scrollHeight);
      window.dispatchEvent(new Event('scroll'));
    });
    const afterMore = await waitFirst(page, 20_000, (snap) => {
      return snap.titles.length > beforeMore.titles.length || /暂时没有更多新内容/.test(snap.notice || '');
    });
    const appended = afterMore.snap.titles.length > beforeMore.titles.length;
    const exhausted = /暂时没有更多新内容/.test(afterMore.snap.notice || '');
    report.steps.push({
      at: Date.now() - started,
      step: 'continuous-more',
      beforeCount: beforeMore.titles.length,
      afterCount: afterMore.snap.titles.length,
      appended,
      exhausted,
      ok: appended || exhausted,
      notice: afterMore.snap.notice,
    });
    await page.screenshot({ path: path.join(RUN, '03-more.png') });

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
