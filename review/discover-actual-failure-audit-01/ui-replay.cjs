/**
 * 真实界面重放：Owner 同一个 5b75e45 打包程序 + Owner 数据副本，通过 CDP 驱动「发现」页，
 * 按秒记录页面状态。不改产品代码，不碰 Owner 正式目录。
 * 用法: node ui-replay.cjs <runName> "<query>" [maxSeekMs=450000] [waitBeforeSeekMs=15000] [source=owner-copy]
 */
'use strict';
const path = require('node:path');
const DATA = require('./data-root.cjs');
const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

const NAME = process.argv[2];
const QUERY = process.argv[3];
const MAX_SEEK = Number(process.argv[4] || 450000);
const WAIT_BEFORE = Number(process.argv[5] || 15000);
const SOURCE = process.argv[6] || 'owner-copy';
const EXE = process.env.AUDIT_EXE || path.join(ROOT, 'release-staging', 'v2-tujimi-20261003T034641Z-5b75e45e', 'win-unpacked', '兔机米.exe');
const RUN = path.join(DATA, 'runs', NAME);
const PORT = 9400 + Math.floor(Math.random() * 400);

(async () => {
  fs.rmSync(RUN, { recursive: true, force: true });
  fs.mkdirSync(path.join(RUN, 'home'), { recursive: true });
  if (SOURCE !== 'clean') {
    spawnSync('robocopy', [path.join(DATA, SOURCE, 'userData'), path.join(RUN, 'userData'), '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP']);
  }
  fs.mkdirSync(path.join(RUN, 'userData'), { recursive: true });
  // FRESH_INSTALL=1：只在本次运行的副本里换一个新的安装身份（网关按安装每小时 30 次搜索）。
  if (process.env.FRESH_INSTALL === '1') fs.rmSync(path.join(RUN, 'userData', 'install-capability-token.json'), { force: true });
  const env = Object.assign({}, process.env, {
    HOME: path.join(RUN, 'home'), USERPROFILE: path.join(RUN, 'home'), DIGITALME_V2_HOME: path.join(RUN, 'home'),
    DIGITALME_V2_USER_DATA: path.join(RUN, 'userData'),
  });
  let child;
  if (process.env.UI_MODE === 'source') {
    // 源码版 Electron（同一份 5b75e45 代码）+ 主进程埋点
    env.NODE_OPTIONS = `--require ${path.join(__dirname, 'instrument.cjs').replace(/\\/g, '/')}`;
    env.AUDIT_IPC_LOG = path.join(RUN, 'ipc.ndjson');
    child = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', `--remote-debugging-port=${PORT}`], { env, cwd: ROOT, stdio: 'ignore' });
  } else {
    child = spawn(EXE, [`--remote-debugging-port=${PORT}`], { env, stdio: 'ignore' });
  }
  const T0 = Date.now(); const rows = [];
  const at = () => Date.now() - T0;
  const log = (kind, d) => { rows.push(Object.assign({ t: at(), kind }, d)); };
  const save = () => fs.writeFileSync(path.join(RUN, 'ui-trace.json'), JSON.stringify(rows, null, 1));

  let browser;
  for (let i = 0; i < 60 && !browser; i += 1) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  if (!browser) { log('fatal', { msg: 'cdp connect failed' }); save(); child.kill(); process.exit(2); }
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => /index/.test(p.url())) || ctx.pages()[0];
  for (let i = 0; i < 30 && !page; i += 1) { await new Promise((r) => setTimeout(r, 500)); page = ctx.pages()[0]; }
  await page.waitForSelector('#nav-discover', { timeout: 60000 });
  log('ready', { url: page.url() });

  const snap = () => page.evaluate(() => {
    const $ = (id) => document.getElementById(id);
    const list = $('content-discover-list');
    const status = $('content-discover-status');
    const root = $('content-discover');
    const cancel = $('btn-discover-cancel');
    const cards = list ? Array.from(list.children).map((n) => (n.querySelector('h3,h4,.card-title,strong') || n).textContent.trim().replace(/\s+/g, ' ').slice(0, 36)) : [];
    return {
      statusShown: !!status && !status.hidden, status: status && !status.hidden ? status.textContent.trim().slice(0, 60) : '',
      replenishing: root ? root.dataset.replenishing : null,
      cancelShown: !!cancel && !cancel.hidden,
      notice: ($('content-discover-notice') || {}).textContent ? $('content-discover-notice').textContent.trim().slice(0, 90) : '',
      emptyShown: !!$('content-discover-empty') && !$('content-discover-empty').hidden,
      feedTitle: ($('content-discover-feed-title') || {}).textContent || '',
      cards: cards.length, first: cards.slice(0, 3),
      related: ($('content-discover-related-list') || { children: [] }).children.length,
      unjudged: ($('content-discover-unjudged-list') || { children: [] }).children.length,
    };
  });

  let last = '';
  const poll = async (tag) => {
    const s = await snap().catch((e) => ({ err: String(e && e.message).slice(0, 80) }));
    const key = JSON.stringify(s);
    if (key !== last) { last = key; log(tag, s); }
    return s;
  };

  await page.click('#nav-discover');
  log('click', { what: 'nav-discover' });
  const phase1End = at() + WAIT_BEFORE;
  while (at() < phase1End) { await poll('open'); await new Promise((r) => setTimeout(r, 1000)); }
  const before = await snap();
  log('open.settled?', before);
  log('open.sources', { hosts: await page.evaluate(() => Array.from(document.querySelectorAll('#content-discover-list > li')).map((n) => { const m = n.innerText.match(/[a-z0-9-]+(\.[a-z0-9-]+)+(?=\s|·|$)/i); return m ? m[0] : n.innerText.split('\n').slice(0, 3).join('|').slice(0, 50); })) });

  // 版式证据：列数、卡片是否重叠、截图（宽屏 + 窄屏）
  const layout = () => page.evaluate(() => {
    const list = document.getElementById('content-discover-list');
    const items = list ? Array.from(list.children) : [];
    const rects = items.map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0);
    const lefts = Array.from(new Set(rects.map((r) => Math.round(r.left / 8)))).length;
    let overlaps = 0;
    for (let i = 0; i < rects.length; i += 1) for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i]; const b = rects[j];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps += 1;
    }
    return { width: window.innerWidth, cards: rects.length, columns: lefts, overlaps,
      covers: items.filter((n) => n.querySelector('img, video.content-discover-cover')).length,
      playBtns: items.filter((n) => Array.from(n.querySelectorAll('button')).some((b) => /在这里(播放|收听)/.test(b.textContent))).length };
  });
  const shot = async (name) => {
    try {
      const cdp = await ctx.newCDPSession(page);
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(RUN, name + '.png'), Buffer.from(r.data, 'base64'));
      await cdp.detach();
    } catch (e) { log('shot.fail', { name, err: String(e && e.message).slice(0, 100) }); }
  };
  const shots = async (tag) => {
    log('layout.wide.' + tag, await layout());
    await shot('wide-' + tag);
    await page.setViewportSize({ width: 560, height: 900 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));
    log('layout.narrow.' + tag, await layout());
    await shot('narrow-' + tag);
    await page.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1000));
  };
  await page.setViewportSize({ width: 1280, height: 900 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
  await shots('open');

  if (process.env.PROBE_REPLENISH === '1') {
    const r = await page.evaluate(async () => {
      const t0 = performance.now();
      const out = { sent: true };
      try {
        const res = await Promise.race([
          window.digitalMe.invoke('content', { action: 'replenish', searchGenerationId: 'probe_manual' }),
          new Promise((_, rej) => setTimeout(() => rej(new Error('probe-timeout-20s')), 20000)),
        ]);
        out.ok = true; out.ms = Math.round(performance.now() - t0);
        out.view = res && res.view ? { replenishing: res.view.replenishing, cards: (res.view.cards || []).length, gen: res.view.searchGenerationId, mode: res.view.feedMode } : null;
      } catch (e) { out.ok = false; out.ms = Math.round(performance.now() - t0); out.err = String(e && e.message).slice(0, 120); }
      return out;
    });
    log('probe.manual-replenish', r);
    await poll('after-probe');
  }

  if (QUERY) {
    await page.fill('#content-discover-query', QUERY);
    const submitAt = at();
    await page.press('#content-discover-query', 'Enter');
    log('submit', { query: QUERY });
    let terminalSince = 0;
    if (process.env.CANCEL_AFTER_MS) {
      // 取消场景：提交后 N 毫秒点击取消，记录终态，再提交第二个查询，确认旧请求不会覆盖新请求
      await new Promise((r) => setTimeout(r, Number(process.env.CANCEL_AFTER_MS)));
      log('pre-cancel', await snap());
      await page.click('#btn-discover-cancel').catch((e) => log('cancel.click.fail', { err: String(e.message).slice(0, 80) }));
      const c0 = at();
      for (let i = 0; i < 20; i += 1) { await new Promise((r) => setTimeout(r, 500)); await poll('cancel'); }
      log('post-cancel', Object.assign({ afterMs: at() - c0 }, await snap()));
      if (process.env.SECOND_QUERY) {
        await page.fill('#content-discover-query', process.env.SECOND_QUERY);
        await page.press('#content-discover-query', 'Enter');
        log('submit2', { query: process.env.SECOND_QUERY });
      }
    }
    while (at() - submitAt < MAX_SEEK) {
      const s = await poll('seek');
      const terminal = s.replenishing === '0' && !s.statusShown && !s.cancelShown;
      if (terminal) { terminalSince = terminalSince || at(); if (at() - terminalSince > 8000) break; } else terminalSince = 0;
      await new Promise((r) => setTimeout(r, 1000));
    }
    log('seek.end', { elapsedMs: at() - submitAt, capHit: at() - submitAt >= MAX_SEEK, final: await snap() });
    await shots('seek');
    if (process.env.PLAY === '1') {
      // 应用内播放：逐张点击“在这里播放/收听”，记录播放器是否在本卡片内展开、是否读到时长、是否真的在走
      const results = [];
      const count = await page.evaluate(() => Array.from(document.querySelectorAll('#content-discover-list li')).filter((n) => Array.from(n.querySelectorAll('button')).some((b) => /在这里(播放|收听)/.test(b.textContent))).length);
      for (let i = 0; i < Math.min(count, 3); i += 1) {
        const out = await page.evaluate(async (idx) => {
          const li = Array.from(document.querySelectorAll('#content-discover-list li')).filter((n) => Array.from(n.querySelectorAll('button')).some((b) => /在这里(播放|收听)/.test(b.textContent)))[idx];
          const b = Array.from(li.querySelectorAll('button')).find((x) => /在这里(播放|收听)/.test(x.textContent));
          const title = (li.querySelector('h3') || {}).textContent;
          b.click();
          await new Promise((r) => setTimeout(r, 9000));
          const m = li.querySelector('.content-discover-player audio, .content-discover-player video');
          const host = li.querySelector('.content-discover-player');
          const res = { title: String(title).slice(0, 30), hostShown: host && !host.hidden, mediaInCard: !!m, mediaHidden: m ? m.hidden : null,
            duration: m ? m.duration : null, readyState: m ? m.readyState : null, currentTime: m ? m.currentTime : null, paused: m ? m.paused : null,
            err: m && m.error ? m.error.code : null, hostText: host ? host.textContent.slice(0, 40) : '' };
          const sw = Array.from(li.querySelectorAll('button')).find((x) => /收起/.test(x.textContent)); if (sw) sw.click();
          return res;
        }, i);
        results.push(out);
      }
      log('play.probe', { count, results });
    }
  }
  save();
  try { await browser.close(); } catch { /* ignore */ }
  child.kill();
  spawnSync('taskkill', ['/F', '/T', '/PID', String(child.pid)]);
  console.log('done', path.join(RUN, 'ui-trace.json'));
})().catch((e) => { console.error(e); process.exit(1); });
