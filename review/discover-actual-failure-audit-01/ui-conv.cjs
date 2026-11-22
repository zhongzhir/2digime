/**
 * 真实界面：对话改名 / 归档 / 项目 / 删除，重启后持久化，且不误删成果与数字之我。
 * 用法: node ui-conv.cjs <runName> [owner-copy|clean]
 * 使用源码版 Electron（当前工作区代码）。
 */
'use strict';
const path = require('node:path');
const DATA = require('./data-root.cjs');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..', '..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

const NAME = process.argv[2] || 'conv1';
const SOURCE = process.argv[3] || 'owner-copy';
const RUN = path.join(DATA, 'runs', NAME);
const out = [];
const rec = (k, v) => { out.push({ k, v }); console.log(k, JSON.stringify(v)); };

function walk(dir, base = dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, acc);
    else acc.push(path.relative(base, p).replace(/\\/g, '/'));
  }
  return acc;
}
const protectedFiles = (userData) => {
  // 成果与数字之我：除会话记录/线程外的全部文件（缓存类除外）
  return walk(userData).filter((f) => !/\/(ui\/conversations|intelligence\/threads)\//.test('/' + f) && !/^(Cache|Code Cache|GPUCache|DawnCache|Local Storage|Session Storage|Network|blob_storage|Shared|Partitions|Crashpad|logs|Service Worker|WebStorage|Dictionaries|IndexedDB|Preferences|Local State|sentinel|lockfile|SharedStorage|Trust Tokens|DIPS|TransportSecurity|Cookies|Cookies-journal)/.test(f));
};
const hashOf = (userData, rel) => crypto.createHash('sha1').update(fs.readFileSync(path.join(userData, rel))).digest('hex');

async function launch(userData, home) {
  const port = 9400 + Math.floor(Math.random() * 400);
  const env = Object.assign({}, process.env, { DIGITALME_V2_HOME: home, DIGITALME_V2_USER_DATA: userData });
  // AUDIT_EXE 指向打包程序时检查打包版；否则用源码版 Electron。
  const child = process.env.AUDIT_EXE
    ? spawn(process.env.AUDIT_EXE, [`--remote-debugging-port=${port}`], { env, stdio: 'ignore' })
    : spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), ['.', `--remote-debugging-port=${port}`], { env, cwd: ROOT, stdio: 'ignore' });
  let browser;
  for (let i = 0; i < 60 && !browser; i += 1) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  if (!browser) throw new Error('cdp connect failed');
  const ctx = browser.contexts()[0];
  let page = ctx.pages().find((p) => /index/.test(p.url())) || ctx.pages()[0];
  for (let i = 0; i < 60 && !page; i += 1) { await new Promise((r) => setTimeout(r, 500)); page = ctx.pages().find((p) => /index/.test(p.url())) || ctx.pages()[0]; }
  await page.waitForSelector('#nav-chat', { timeout: 60000 });
  await page.setViewportSize({ width: 1280, height: 900 });
  return { child, browser, ctx, page };
}
async function shot(ctx, page, name) {
  const cdp = await ctx.newCDPSession(page);
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(RUN, name + '.png'), Buffer.from(r.data, 'base64'));
  await cdp.detach();
}
async function close(app) {
  try { await app.browser.close(); } catch { /* ignore */ }
  app.child.kill();
  spawnSync('taskkill', ['/F', '/T', '/PID', String(app.child.pid)]);
  await new Promise((r) => setTimeout(r, 2500));
}
const sessionRows = (page) => page.evaluate(() => {
  const root = document.getElementById('chat-session-list');
  const rows = [];
  root.querySelectorAll('.chat-session-item').forEach((li) => {
    const t = li.querySelector('.chat-session-title');
    const project = li.closest('.chat-session-project');
    const archived = !!li.closest('.chat-session-archived');
    rows.push({ id: li.dataset.sessionId, title: t.textContent, active: t.classList.contains('active'),
      project: project ? project.querySelector('.chat-session-project-name').textContent : '', archived });
  });
  return rows;
});
const clickMenu = async (page, id, label) => {
  const more = page.locator(`#chat-session-list li[data-session-id="${id}"] .chat-session-more`);
  if (!(await page.locator(`#chat-session-list li[data-session-id="${id}"] .chat-session-menu`).count())) await more.click();
  await page.locator(`#chat-session-list li[data-session-id="${id}"] .chat-session-menu button`, { hasText: label }).first().click();
  await new Promise((r) => setTimeout(r, 400));
};

(async () => {
  fs.rmSync(RUN, { recursive: true, force: true });
  const userData = path.join(RUN, 'userData'); const home = path.join(RUN, 'home');
  fs.mkdirSync(home, { recursive: true });
  if (SOURCE !== 'clean') spawnSync('robocopy', [path.join(DATA, SOURCE, 'userData'), userData, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP']);
  fs.mkdirSync(userData, { recursive: true });

  let app = await launch(userData, home);
  await app.page.click('#nav-chat');
  await new Promise((r) => setTimeout(r, 2500));
  const pkgConvDir = () => walk(userData).filter((f) => /ui\/conversations\/conv_.*\.ndjson$/.test(f));
  rec('sessions.initial', await sessionRows(app.page));

  // 造 3 场对话：新建两场（空的也是对话），保证有素材可管理
  for (let i = 0; i < 3; i += 1) { await app.page.click('#btn-chat-new'); await new Promise((r) => setTimeout(r, 700)); }
  let rows = await sessionRows(app.page);
  rec('sessions.after-new', rows.length);
  const before = protectedFiles(userData); const beforeHash = {};
  for (const f of before) { try { beforeHash[f] = hashOf(userData, f); } catch { /* locked */ } }
  rec('protected.count.before', before.length);

  const [a, b, c, d] = rows.slice(0, 4).map((r) => r.id);
  // 改名：a 改名后会被删除；d 改名后保留，用来验证重启后名字还在
  for (const [id, name] of [[a, '旅行计划'], [d, '周末观影']]) {
    await clickMenu(app.page, id, '改名');
    const input = app.page.locator('#chat-session-list .chat-session-form input'); await input.fill(name); await input.press('Enter');
    await new Promise((r) => setTimeout(r, 800));
  }
  // 新建项目并移入
  await clickMenu(app.page, b, '归入项目');
  await app.page.locator(`#chat-session-list li[data-session-id="${b}"] .chat-session-menu button`, { hasText: '新建项目并移入' }).click();
  const pin = app.page.locator('#chat-session-list .chat-session-form input'); await pin.fill('家庭事务'); await pin.press('Enter');
  await new Promise((r) => setTimeout(r, 800));
  // 归档
  await clickMenu(app.page, c, '归档');
  await new Promise((r) => setTimeout(r, 800));
  rows = await sessionRows(app.page);
  rec('sessions.after-manage', rows.map((r) => ({ t: r.title, p: r.project, a: r.archived })).slice(0, 6));
  await shot(app.ctx, app.page, 'conv-managed');

  // 删除：先看确认文案，再取消，再确认
  await clickMenu(app.page, a, '删除');
  const confirmText = await app.page.locator(`#chat-session-list li[data-session-id="${a}"] .chat-session-menu p`).textContent();
  rec('delete.confirm-text', confirmText);
  await shot(app.ctx, app.page, 'conv-delete-confirm');
  await app.page.locator(`#chat-session-list li[data-session-id="${a}"] .chat-session-menu button`, { hasText: '取消' }).click();
  rec('delete.cancel.still-there', (await sessionRows(app.page)).some((r) => r.id === a));
  await clickMenu(app.page, a, '删除');
  await app.page.locator(`#chat-session-list li[data-session-id="${a}"] .chat-session-menu button`, { hasText: '确认删除' }).click();
  await new Promise((r) => setTimeout(r, 1200));
  rows = await sessionRows(app.page);
  rec('delete.confirmed.gone', !rows.some((r) => r.id === a));
  rec('delete.status', await app.page.evaluate(() => (document.getElementById('chat-status') || {}).textContent));
  await close(app);

  // 重启，同一数据目录
  app = await launch(userData, home);
  await app.page.click('#nav-chat');
  await new Promise((r) => setTimeout(r, 2500));
  rows = await sessionRows(app.page);
  rec('restart.sessions', rows.map((r) => ({ t: r.title, p: r.project, a: r.archived })).slice(0, 6));
  rec('restart.deleted-stays-gone', !rows.some((r) => r.id === a));
  rec('restart.project-kept', rows.some((r) => r.id === b && r.project === '家庭事务'));
  rec('restart.archived-kept', rows.some((r) => r.id === c && r.archived));
  rec('restart.rename-kept', rows.some((r) => r.id === d && r.title === '周末观影'));
  await shot(app.ctx, app.page, 'conv-restart');
  const after = protectedFiles(userData);
  const missing = before.filter((f) => !after.includes(f));
  const changed = before.filter((f) => beforeHash[f] && after.includes(f) && (() => { try { return hashOf(userData, f) !== beforeHash[f]; } catch { return false; } })());
  rec('protected.missing', missing);
  rec('protected.changed', changed.slice(0, 10));
  await close(app);
  fs.writeFileSync(path.join(RUN, 'conv-result.json'), JSON.stringify(out, null, 1));
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
