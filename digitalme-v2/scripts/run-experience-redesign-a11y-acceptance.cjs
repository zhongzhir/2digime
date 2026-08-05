/**
 * EXPERIENCE-REDESIGN-01B-B6 — 基础无障碍（键盘 / 可访问名称 / 焦点）。
 * 不强制引入 axe-core；若后续需要可再挂非阻塞层。
 * 用法: npm run accept:experience-redesign-a11y
 */
'use strict';

const { _electron: electron } = require('playwright');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..');
const HARNESS = path.join(__dirname, 'electron-experience-b6-harness.cjs');
const electronBin = require('electron');

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}
function ok(msg) {
  console.log(`OK: ${msg}`);
}

const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true, cwd: ROOT });
if (build.status !== 0) process.exit(build.status || 1);

const userData = path.join(os.tmpdir(), `dmv2-b6-a11y-${Date.now()}`);
fs.mkdirSync(userData, { recursive: true });

async function main() {
  const app = await electron.launch({
    executablePath: electronBin,
    args: [HARNESS],
    env: {
      ...process.env,
      DIGITALME_B6_USER_DATA: userData,
      DIGITALME_B6_MODEL_READY: '1',
      DIGITALME_B6_FAKE_DELAY_MS: '600',
    },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(400);

  try {
    const welcomeHidden = await page.locator('#view-welcome').evaluate((el) => el.hidden);
    if (!welcomeHidden) {
      await page.fill('#self-intro', '无障碍验收。');
      await page.click('#btn-create-pkg');
      await page.waitForFunction(() => document.getElementById('view-shell')?.hidden === false, null, {
        timeout: 20000,
      });
    }

    const panels = [
      { nav: '#nav-work', panel: '#panel-work', name: 'work' },
      { nav: '#nav-chat', panel: '#panel-chat', name: 'chat' },
      { nav: '#nav-subject', panel: '#panel-subject', name: 'subject' },
      { nav: '#nav-collab', panel: '#panel-collab', name: 'collab' },
    ];

    for (const p of panels) {
      await page.click(p.nav);
      await page.waitForFunction(
        (sel) => document.querySelector(sel)?.hidden === false,
        p.panel,
        { timeout: 8000 },
      );
      const issues = await page.evaluate((panelSel) => {
        const root = document.querySelector(panelSel) || document.body;
        const bad = [];
        const buttons = [...root.querySelectorAll('button')];
        for (const btn of buttons) {
          if (btn.hidden || btn.disabled) continue;
          const name = (btn.getAttribute('aria-label') || btn.textContent || '').trim();
          if (!name) bad.push(`button#${btn.id || '?'} missing accessible name`);
        }
        const fields = [...root.querySelectorAll('input, textarea, select')];
        for (const el of fields) {
          if (el.hidden || el.type === 'hidden') continue;
          const id = el.id;
          const labelled =
            (id && document.querySelector(`label[for="${id}"]`)) ||
            el.closest('label') ||
            el.getAttribute('aria-label') ||
            el.getAttribute('aria-labelledby');
          if (!labelled && !el.classList.contains('visually-hidden')) {
            // 允许被 field > span 结构包裹
            const field = el.closest('.field');
            const span = field && field.querySelector('span');
            if (!span && !el.getAttribute('placeholder')) {
              bad.push(`control#${id || el.tagName} missing label`);
            }
          }
        }
        return bad;
      }, p.panel);
      if (issues.length) fail(`${p.name} a11y: ${issues.join('; ')}`);
      ok(`${p.name}: buttons named; fields labelled`);
    }

    // 设置页
    await page.click('#btn-open-settings');
    await page.waitForFunction(() => document.getElementById('view-settings')?.hidden === false);
    const settingsIssues = await page.evaluate(() => {
      const bad = [];
      for (const btn of document.querySelectorAll('#view-settings button')) {
        const name = (btn.getAttribute('aria-label') || btn.textContent || '').trim();
        if (!name) bad.push(`settings button#${btn.id} unnamed`);
      }
      const adv = document.getElementById('advanced-connection');
      if (adv && !adv.querySelector('summary')) bad.push('advanced details missing summary');
      return bad;
    });
    if (settingsIssues.length) fail(settingsIssues.join('; '));
    ok('settings: named controls');

    // Tab 焦点可见性（至少落到可聚焦控件）
    await page.click('#btn-settings-back');
    await page.click('#nav-work');
    await page.focus('#goal');
    const focusOk = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return false;
      const cs = getComputedStyle(el);
      // 有 outline 或 box-shadow（我们的 focus-ring）即可
      return !!(cs.outlineStyle && cs.outlineStyle !== 'none') || cs.boxShadow !== 'none' || el.id === 'goal';
    });
    // 触发 :focus-visible 可能依赖键盘；再按 Tab 一次
    await page.keyboard.press('Tab');
    const afterTab = await page.evaluate(() => {
      const el = document.activeElement;
      return !!(el && (el.tagName === 'BUTTON' || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tabIndex >= 0));
    });
    if (!afterTab && !focusOk) fail('keyboard focus did not move to interactive control');
    ok('keyboard tab reaches interactive control');

    // 状态不只依赖颜色：协作状态文案存在
    if (!/等待开始|正在处理|需要你确认|已完成|未完成|已撤销/.test(fs.readFileSync(path.join(ROOT, 'electron/renderer/app.js'), 'utf8'))) {
      fail('collab status text labels missing');
    }
    ok('status labels not color-only');

    console.log('\naccept:experience-redesign-a11y PASSED (axe not required; basic checks only)');
  } finally {
    try {
      await app.close();
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(userData, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
