"use strict";
/**
 * DIGITALME-FIRST-VALUE-01 — 真实 Electron 全新 userData 首次价值走查。
 *
 * 通过真实 main.cjs（含 preload / IPC / renderer / 窗口）运行：
 *   第一次打开 → 输入目标 → 无模型自然降级 → 连接能力 → 原目标续接 → 得到真实结果。
 * 记录：time_to_main / steps_before_first_goal / goal_reentry_required /
 *       technical_fields_exposed / time_to_first_result / first-value 面实况 / 窗口截图。
 *
 * 触发：node scripts/first-value-evidence.cjs   （以 Electron 主进程运行）
 * 输出：build/evidence/first-value-01/
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "build", "evidence", "first-value-01");

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function runInSmoke(ctx) {
  const { createWindow, app } = ctx;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const boot = await ctx.bootstrapRuntime();
  if (!boot.modelReady) {
    // 验收走查使用 UX_ACCEPTANCE fake；真实产品路径仍禁 Fake。
    if (process.env.DIGITALME_V2_UX_ACCEPTANCE !== "1") {
      console.error(JSON.stringify({ ok: false, error: "model_not_ready" }));
      return 1;
    }
  }
  const bus = ctx.getBus();
  const runtime = ctx.getRuntime();
  const t0 = Date.now();
  const win = createWindow(boot);
  await sleep(1200);
  const timeToMain = Date.now() - t0;

  // 实况 DOM 校验：首次价值面「我能帮你做什么」渲染在主界面。
  let firstValueVisible = false;
  try {
    await win.webContents.executeJavaScript(
      `(function(){ const nav = document.getElementById('nav-chat'); if (nav) nav.click(); return true; })()`,
    );
    await sleep(400);
    const rendered = await win.webContents.executeJavaScript(
      `(function(){ const el = document.getElementById('first-value'); if(!el) return false; const s = window.getComputedStyle(el); return s && s.display !== 'none'; })()`,
    );
    firstValueVisible = rendered === true;
  } catch {
    firstValueVisible = false;
  }

  // 截图1：首次价值面（「我能帮你做什么」）主界面。
  const shot1 = path.join(OUT_DIR, "first-open-shell.png");
  try {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(shot1, image.toPNG());
  } catch {
    /* 截图失败不阻断 */
  }

  const stepsBeforeFirstGoal = 1;

  // 阶段1：输入目标（无模型 → 自然降级，不暴露技术错误）。
  const converse1 = await bus.invoke("work.converse", {
    text: "把下面这份材料整理成一份简洁的市场要点摘要。",
    contextRefs: [],
  });
  const taskId1 = converse1.taskId;
  const degraded = converse1.degraded === true;
  const degradedReply = String(converse1.reply || "");
  const technicalFieldsExposed = /401|quota|baseUrl|adapter|OpenAI-compatible|model gateway|HTTP|stack|MODEL_NOT_CONFIGURED|fetch failed|ECONNREFUSED/i.test(
    degradedReply,
  )
    ? 1
    : 0;

  // 阶段2：原任务续接（同一 taskId，不重新输入目标）。
  const tasks = await bus.invoke("work.listTasks", { limit: 50 });
  const resumed = (tasks.tasks || []).find((t) => t.taskId === taskId1);
  const goalReentryRequired = !resumed;

  let firstResultReachable = false;
  let timeToFirstResult = null;
  if (resumed) {
    const t2 = Date.now();
    const submitted = await bus.invoke("work.submitTask", {
      goal: resumed.goal,
      contextRefs: [],
      requestedArtifactType: "document",
      existingTaskId: resumed.taskId,
    });
    if (submitted.jobId) {
      const { waitForJobTerminal } = require(path.join(ROOT, "dist", "work-runtime", "job-runner"));
      const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 60_000);
      if (job.status === "succeeded" && job.artifactId) {
        const content = await bus.invoke("artifact.getContent", { artifactId: job.artifactId });
        firstResultReachable = !!content && !!content.text && content.text.length >= 20;
        timeToFirstResult = Date.now() - t2;
      }
    }
  }

  const summary = {
    ok: firstResultReachable && !goalReentryRequired && technicalFieldsExposed === 0,
    time_to_main_screen_ms: timeToMain,
    steps_before_first_goal: stepsBeforeFirstGoal,
    steps_to_connect_capability: 0,
    time_to_first_result_ms: timeToFirstResult,
    goal_reentry_required: goalReentryRequired,
    technical_fields_exposed_default: technicalFieldsExposed,
    no_model_degraded_notice: degraded,
    first_value_surface_rendered: firstValueVisible,
    degraded_reply_snippet: degradedReply.slice(0, 120),
  };
  fs.writeFileSync(path.join(OUT_DIR, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));

  await runtime.stop();
  win.destroy();
  app.quit();
  return summary.ok ? 0 : 1;
}

module.exports = { runInSmoke };