/**
 * EXPERIENCE-REDESIGN-01B-B6 — Playwright × Electron 跨页面主路径。
 * 用法（通常经 npm run accept:experience-redesign-ui）：
 *   node scripts/playwright-experience-redesign-ui.cjs
 */
'use strict';

const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const HARNESS = path.join(__dirname, 'electron-experience-b6-harness.cjs');
const electronBin = require('electron');

const runId = `${Date.now()}-${process.pid}`;
const runRoot =
  process.env.DIGITALME_B6_RUN_DIR ||
  path.join(os.tmpdir(), `dmv2-b6-run-${runId}`);
const userData = path.join(runRoot, 'userData');
const shotsDir = path.join(runRoot, 'shots');
const failDir = path.join(runRoot, 'failures');
fs.mkdirSync(shotsDir, { recursive: true });
fs.mkdirSync(failDir, { recursive: true });
fs.mkdirSync(userData, { recursive: true });

const report = {
  startedAt: new Date().toISOString(),
  runRoot,
  userData,
  checks: [],
  shots: [],
  verdict: null,
};

function check(name, ok, detail) {
  report.checks.push({ name, ok: !!ok, ...(detail ? { detail } : {}) });
  if (!ok) {
    const msg = `CHECK_FAILED: ${name}${detail ? ` — ${JSON.stringify(detail)}` : ''}`;
    throw new Error(msg);
  }
}

async function shot(page, name) {
  const file = path.join(shotsDir, `${String(report.shots.length + 1).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  const st = fs.statSync(file);
  check(`shot_${name}_written`, st.size > 2000, { file, size: st.size });
  report.shots.push({ name, file, size: st.size });
}

async function waitHidden(page, sel, timeout = 15000) {
  await page.waitForFunction(
    (s) => {
      const el = document.querySelector(s);
      return el && el.hidden === true;
    },
    sel,
    { timeout },
  );
}

async function waitVisible(page, sel, timeout = 15000) {
  await page.waitForFunction(
    (s) => {
      const el = document.querySelector(s);
      return el && el.hidden === false;
    },
    sel,
    { timeout },
  );
}

async function launchApp(envExtra = {}) {
  const app = await electron.launch({
    executablePath: electronBin,
    args: [HARNESS],
    env: {
      ...process.env,
      DIGITALME_B6_USER_DATA: userData,
      DIGITALME_B6_MODEL_READY: '1',
      DIGITALME_B6_FAKE_DELAY_MS: '900',
      DIGITALME_B6_WIDTH: '1440',
      DIGITALME_B6_HEIGHT: '900',
      ...envExtra,
    },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(400);
  return { app, page };
}

async function enterShell(page) {
  const welcome = page.locator('#view-welcome');
  if (await welcome.isVisible().catch(() => false)) {
    const hidden = await page.locator('#view-welcome').evaluate((el) => el.hidden);
    if (!hidden) {
      await page.fill('#self-intro', '我在做 Digital Me 体验升级验收。');
      await page.click('#btn-create-pkg');
    }
  }
  await waitHidden(page, '#view-welcome', 20000);
  await waitVisible(page, '#view-shell', 20000);
  await waitVisible(page, '#panel-work', 20000);
}

async function runCrossPage(page, app) {
  // 1) 着陆与主导航
  await enterShell(page);
  const nav = await page.locator('.main-nav .nav-item').allTextContents();
  check('nav_four_primary', nav.map((t) => t.trim()).join('|') === '做事|对话|数字之我|协作', { nav });
  check(
    'settings_help_secondary',
    (await page.locator('#btn-open-settings').count()) === 1 &&
      (await page.locator('#btn-open-help').count()) === 1 &&
      !(await page.locator('.main-nav #btn-open-settings').count()),
  );
  check('no_keep_artifact_shell', (await page.locator('#btn-chat-keep-artifact').count()) === 0);
  check('land_on_work', await page.locator('#nav-work').evaluate((el) => el.classList.contains('active')));
  await shot(page, 'work-empty');

  // 2) 做事：长目标 + 材料
  const longGoal = `${'请根据材料撰写完整项目进展简报，覆盖背景、进展、风险与下一步。'.repeat(40)}\n补充：B6 长目标验收。`;
  check('long_goal_len', longGoal.length > 1000, { len: longGoal.length });
  await page.fill('#goal', longGoal);
  await page.click('#btn-add-files');
  await page.waitForTimeout(200);
  await page.click('#btn-add-folder');
  await page.waitForTimeout(250);
  const matCount = await page.locator('#material-list li').count();
  check('materials_added', matCount >= 2, { matCount });
  await shot(page, 'work-long-goal-materials');

  // 3) 开始处理 → 状态稳定
  await page.click('#btn-submit');
  await page.waitForFunction(() => {
    const t = document.getElementById('job-status')?.textContent || '';
    return /处理|排队|进行|等待/.test(t);
  }, null, { timeout: 10000 });
  const processing = await page.locator('#job-status').innerText();
  check('processing_no_jobid', !/jobId|Job ID|状态机/i.test(processing), { processing });
  await shot(page, 'work-processing');

  await page.waitForFunction(() => {
    const panel = document.getElementById('artifact-panel');
    const ed = document.getElementById('artifact-editor');
    return panel && !panel.hidden && (ed?.value || '').length > 40;
  }, null, { timeout: 45000 });
  await shot(page, 'work-artifact');

  // 4) 对话路径
  await page.click('#nav-chat');
  await waitVisible(page, '#panel-chat');
  check('chat_composer_present', (await page.locator('.chat-composer #chat-input').count()) === 1);
  for (let i = 0; i < 4; i += 1) {
    await page.fill('#chat-input', `B6 对话轮次 ${i + 1}：请记住验收要点。`);
    await page.click('#btn-chat-send');
    await page.waitForTimeout(350);
  }
  const turns = await page.locator('#chat-turns .chat-turn').count();
  check('chat_multi_turn', turns >= 6, { turns });
  await shot(page, 'chat-long');
  await page.click('#btn-chat-to-task');
  await waitVisible(page, '#panel-work');
  const carried = await page.locator('#goal').inputValue();
  check('chat_to_task_goal', /B6 对话轮次/.test(carried), { carried: carried.slice(0, 80) });

  // 5) 数字之我
  await page.click('#nav-subject');
  await waitVisible(page, '#panel-subject');
  const subjectBody = await page.locator('#panel-subject').innerText();
  check(
    'subject_no_internal_fields',
    !/GrowthEvent|ContextSnapshot|readiness|candidate|score=|学习流水账/i.test(subjectBody),
  );
  check('subject_sections', /已确认的重要内容/.test(subjectBody) && /待你确认的内容/.test(subjectBody));
  await shot(page, 'subject-home');

  // 6) 协作：做事轻入口 → 向导
  await page.click('#nav-work');
  await waitVisible(page, '#panel-work');
  // 确保有任务后协助入口可见：提交一个短任务
  await page.click('#btn-new-task');
  await page.waitForTimeout(200);
  await page.fill('#goal', 'B6 协作入口绑定任务：整理授权材料摘要。');
  await page.click('#btn-submit');
  await page.waitForFunction(() => {
    const box = document.getElementById('collab-box');
    return box && box.hidden === false;
  }, null, { timeout: 20000 });
  await page.click('#btn-collab-open');
  await waitVisible(page, '#panel-collab');
  await waitVisible(page, '#collab-page-new');
  const subtask = await page.locator('#collab-page-subtask').inputValue();
  check('collab_goal_prefilled', /B6 协作入口绑定任务/.test(subtask), { subtask: subtask.slice(0, 60) });
  const checked = await page.locator('#collab-page-material-checks input[type=checkbox]').evaluateAll((els) =>
    els.map((el) => el.checked),
  );
  check('collab_materials_unchecked', checked.every((c) => c === false), { checked });
  check('work_no_full_collab_form', (await page.locator('#collab-form').count()) === 0);
  await shot(page, 'collab-wizard-auth');

  await page.click('#btn-collab-page-cancel');
  await page.waitForTimeout(200);
  // 协作首页四分区
  if (await page.locator('#collab-page-home').isHidden()) {
    await page.click('#btn-collab-new-back').catch(() => {});
  }
  // 若仍在 detail/new，点主导航刷新
  await page.click('#nav-collab');
  await waitVisible(page, '#collab-page-home');
  const collabHome = await page.locator('#collab-page-home').innerText();
  check(
    'collab_home_four_sections',
    /可找谁帮忙/.test(collabHome) &&
      /进行中/.test(collabHome) &&
      /待你处理/.test(collabHome) &&
      /已撤销/.test(collabHome),
  );
  await shot(page, 'collab-home');

  // 用专业能力入口
  await page.click('#nav-work');
  await waitVisible(page, '#panel-work');
  await page.waitForFunction(() => document.getElementById('collab-box')?.hidden === false, null, {
    timeout: 10000,
  });
  await page.click('#btn-external-cap-open');
  await waitVisible(page, '#panel-collab');
  await waitVisible(page, '#collab-page-new');
  const mode = await page.locator('#collab-page-target-mode').inputValue();
  check('external_mode_from_work', mode === 'external-research', { mode });

  // 7) 设置
  await page.click('#btn-open-settings');
  await waitVisible(page, '#view-settings');
  const advOpen = await page.locator('#advanced-connection').evaluate((el) => el.open);
  check('settings_advanced_default_closed', advOpen === false);
  await shot(page, 'settings-default');
  await page.locator('#advanced-connection summary').click();
  check(
    'settings_advanced_open',
    await page.locator('#advanced-connection').evaluate((el) => el.open === true),
  );
  await shot(page, 'settings-advanced');
  await page.selectOption('#model-provider', 'openai-compatible');
  check(
    'custom_provider_opens_advanced',
    await page.locator('#advanced-connection').evaluate((el) => el.open === true),
  );
  await page.fill('#model-api-key', 'sk-b6-test-key-not-real');
  await page.click('#btn-toggle-api-key');
  check('api_key_shown', await page.locator('#model-api-key').getAttribute('type') === 'text');
  await page.click('#btn-toggle-api-key');
  check('api_key_hidden', await page.locator('#model-api-key').getAttribute('type') === 'password');
  await page.click('#btn-settings-back');
  await waitVisible(page, '#view-shell');

  // 8) 较小窗口
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setSize(900, 720);
  });
  await page.waitForTimeout(400);
  await page.click('#nav-work');
  await waitVisible(page, '#panel-work');
  const small = await page.evaluate(() => {
    const tabs = document.getElementById('work-stage-tabs');
    return {
      tabsVisible: tabs && tabs.hidden === false,
      hasArtifact: document.querySelector('#panel-work .work-layout')?.classList.contains('has-artifact'),
    };
  });
  check('small_window_stage_tabs', small.hasArtifact ? small.tabsVisible === true : true, small);
  await shot(page, 'work-small-window');

  // 9) 重载恢复（已有数字之我）
  await page.reload();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(800);
  await enterShell(page);
  check('reload_lands_work', await page.locator('#panel-work').evaluate((el) => el.hidden === false));
  const tasks = await page.locator('#task-list li').count();
  check('reload_tasks_restored', tasks >= 1, { tasks });
}

async function main() {
  // 确保 dist 可用（外层 runner 通常已 build）
  if (!fs.existsSync(path.join(ROOT, 'dist', 'runtime', 'digitalme-runtime.js'))) {
    const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: true });
    if (build.status !== 0) process.exit(build.status || 1);
  }

  let app;
  let page;
  try {
    ({ app, page } = await launchApp());
    await runCrossPage(page, app);
    report.verdict = 'passed';
    console.log(`OK: playwright experience-redesign-ui passed (${report.checks.length} checks)`);
    console.log(`OK: shots=${report.shots.length} dir=${shotsDir}`);
  } catch (err) {
    report.verdict = 'failed';
    report.error = String((err && err.message) || err);
    if (page) {
      try {
        await page.screenshot({ path: path.join(failDir, 'failure.png'), fullPage: true });
      } catch {
        /* ignore */
      }
    }
    console.error(report.error);
    process.exitCode = 1;
  } finally {
    fs.mkdirSync(runRoot, { recursive: true });
    fs.writeFileSync(path.join(runRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    if (app) {
      try {
        await app.close();
      } catch {
        /* ignore */
      }
      try {
        const proc = app.process();
        if (proc && !proc.killed) proc.kill();
      } catch {
        /* ignore */
      }
    }
  }
}

main();
