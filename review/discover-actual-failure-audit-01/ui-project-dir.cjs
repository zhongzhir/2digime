/**
 * 隔离检查：只设 DIGITALME_V2_USER_DATA / DIGITALME_V2_HOME 启动打包程序，在真实页面里新建项目目录，
 * 记录目录落在哪里。不覆盖 HOME / USERPROFILE。
 * 用法: node ui-project-dir.cjs <runName>   （AUDIT_EXE 指定程序）
 */
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const DATA = require('./data-root.cjs');
const ROOT = path.resolve(__dirname, '..', '..');
const { chromium } = require(path.join(ROOT, 'node_modules', 'playwright'));

const NAME = process.argv[2] || 'iso-project';
const RUN = path.join(DATA, 'runs', NAME);
const EXE = process.env.AUDIT_EXE;
const PORT = 9800 + Math.floor(Math.random() * 100);

(async () => {
  if (!EXE) throw new Error('AUDIT_EXE required');
  fs.rmSync(RUN, { recursive: true, force: true });
  fs.mkdirSync(path.join(RUN, 'home'), { recursive: true });
  fs.mkdirSync(path.join(RUN, 'userData'), { recursive: true });
  const env = Object.assign({}, process.env, {
    DIGITALME_V2_HOME: path.join(RUN, 'home'),
    DIGITALME_V2_USER_DATA: path.join(RUN, 'userData'),
  });
  const child = spawn(EXE, [`--remote-debugging-port=${PORT}`], { env, stdio: 'ignore' });
  let browser;
  for (let i = 0; i < 60 && !browser; i += 1) {
    try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`); } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  if (!browser) { child.kill(); throw new Error('cdp connect failed'); }
  const ctx = browser.contexts()[0];
  let page = ctx.pages()[0];
  for (let i = 0; i < 30 && !page; i += 1) { await new Promise((r) => setTimeout(r, 500)); page = ctx.pages()[0]; }
  await page.waitForFunction(() => !!(window.digitalMe && window.digitalMe.prepareSoftwareProject), null, { timeout: 60000 });
  const prepared = await page.evaluate(() => window.digitalMe.prepareSoftwareProject({ goal: '隔离检查项目' }));
  const out = { prepared, home: path.join(RUN, 'home') };
  const abs = prepared && (prepared.absolutePath || prepared.path || prepared.dir);
  out.absolutePath = abs || null;
  out.insideIsolatedHome = !!abs && path.resolve(abs).toLowerCase().startsWith(path.resolve(RUN).toLowerCase());
  out.exists = !!abs && fs.existsSync(abs);
  fs.writeFileSync(path.join(RUN, 'project-dir.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out));
  await browser.close().catch(() => {});
  child.kill();
  setTimeout(() => process.exit(0), 1500);
})().catch((err) => { console.error(String(err && err.stack || err)); process.exit(1); });
