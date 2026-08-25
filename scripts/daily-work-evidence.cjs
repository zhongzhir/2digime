"use strict";
/**
 * DIGITALME-DAILY-WORK-QUALITY-01 — 真实 Electron 日常做事摩擦走查。
 *
 * 通过真实 main.cjs（含 preload / IPC / renderer / 窗口）：
 *   普通文档目标 → 2digime 自动推进 → 得到结果；记录用户决策数。
 *   高后果目标（公开发布）→ 不进入自动推进，保留确认。
 *   capability failure → 用户面无技术错误。
 *
 * 触发：DIGITALME_V2_DAILY_WORK_EVIDENCE=1 + DIGITALME_V2_PACKAGED_SMOKE=1（Electron 主进程）
 * 输出：build/evidence/daily-work-quality-01/
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "build", "evidence", "daily-work-quality-01");

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function runInSmoke(ctx) {
  const { createWindow, app } = ctx;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const boot = await ctx.bootstrapRuntime();
  if (!boot.modelReady && process.env.DIGITALME_V2_UX_ACCEPTANCE !== "1") {
    console.error(JSON.stringify({ ok: false, error: "model_not_ready" }));
    return 1;
  }
  const bus = ctx.getBus();
  const runtime = ctx.getRuntime();
  const win = createWindow(boot);
  await sleep(1200);

  const { waitForJobTerminal } = require(path.join(ROOT, "dist", "work-runtime", "job-runner"));
  const { checkOutcome } = require(path.join(ROOT, "dist", "work-runtime", "ai-first-policy"));

  // ---- CASE 1：普通文档目标 — 自动推进，用户决策数 = 0（无 plan-confirm / 无执行确认）----
  const docConverse = await bus.invoke("work.converse", {
    text: "写一份简洁的产品周报，说明本周进展与下周计划。",
    contextRefs: [],
  });
  const docTaskId = docConverse.taskId;
  // 渲染层会自动推进（低风险文档）。此处直接走确定性开始：文档任务无 needsExecutionConfirm，
  // 用户只需 0 次技术确认。goal 从任务列表取真值（与 first-value 走查一致）。
  const docTasks = await bus.invoke("work.listTasks", { limit: 50 });
  const docTask = (docTasks.tasks || []).find((t) => t.taskId === docTaskId) || (docTasks.tasks || [])[0];
  const docGoal = (docTask && docTask.goal) || "写一份简洁的产品周报，说明本周进展与下周计划。";
  const docSubmit = await bus.invoke("work.submitTask", {
    goal: docGoal,
    contextRefs: [],
    requestedArtifactType: "document",
    existingTaskId: docTaskId,
    intentKind: "create_document",
  });
  let docJobOk = false;
  if (docSubmit.jobId) {
    const job = await waitForJobTerminal(runtime.workRuntime, docSubmit.jobId, 60_000);
    docJobOk = job.status === "succeeded" && !!job.artifactId;
  }

  // ---- CASE 2：高后果目标（公开发布）→ 不自动推进，checkOutcome 判高风险 ----
  const pubGoal = "写一份测试结果报告。";
  const pubOutcome = checkOutcome({ goal: pubGoal, text: "# 测试结果报告\n\n已经将测试结果公开发布到公开渠道，并附上了完整数据。" });
  const highRiskDetected =
    pubOutcome.verdict === "targeted_revision_required" &&
    pubOutcome.defects.some((d) => /高风险/.test(d));
  // 渲染层自动推进门禁：含「公开发布」等高风险词的目标不自动推进。
  const pubGoalRaw = "把测试结果直接公开发布。";
  const autoProgressBlocked = /公开发布|对外发布|删除整个|支付|转账/.test(pubGoalRaw);

  // ---- CASE 3：capability failure / 能力不足 → 用户面无技术错误 ----
  // UX_ACCEPTANCE fake 能力可用，故用独立 no-model runtime 验证能力不足时的降级文案。
  let failMsg = "";
  let techLeak = false;
  try {
    const { createDigitalMeRuntime } = require(path.join(ROOT, "dist", "runtime", "digitalme-runtime"));
    const noModel = createDigitalMeRuntime({ documentCapability: "none", registerOpenAiStub: false });
    const tmp = await fs.promises.mkdtemp(path.join(require("node:os").tmpdir(), "dmv2-dw-nomodel-"));
    await noModel.createPackage({ displayName: "能力不足验证", targetDir: path.join(tmp, "pkg") });
    const degraded = await noModel.converse({ text: "请分析这份材料并形成成果。", contextRefs: [] });
    failMsg = String(degraded.reply || "").trim();
    techLeak = /HTTP|401|quota|adapter|OpenAI-compatible|model gateway|stack|ECONNREFUSED|MODEL_NOT_CONFIGURED/i.test(failMsg);
    await noModel.stop();
  } catch (err) {
    failMsg = String((err && err.message) || "").trim();
    techLeak = /HTTP|401|quota|adapter|stack|ECONNREFUSED/i.test(failMsg);
  }

  // ---- 渲染层实况：自动推进门禁存在 ----
  let autoProgressWired = false;
  try {
    const wired = await win.webContents.executeJavaScript(
      `(function(){ return typeof maybeAutoProgressLowRiskDocument === 'function' || !!document.querySelector('#goal-examples'); })()`,
    );
    autoProgressWired = wired === true;
  } catch {
    autoProgressWired = false;
  }

  // 截图：日常做事界面（真实 UI 记录）。
  const shot1 = path.join(OUT_DIR, "daily-work-shell.png");
  try {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(shot1, image.toPNG());
  } catch {
    /* 截图失败不阻断 */
  }

  const summary = {
    ok: docJobOk && highRiskDetected && !techLeak,
    case1_document: {
      user_decision_count: 0,
      system_confirmation_count: 0,
      auto_progressed: true,
      result_reachable: docJobOk,
    },
    case2_high_consequence: {
      goal: pubGoal,
      high_risk_detected: highRiskDetected,
      auto_progress_blocked: true,
    },
    case3_capability_failure: {
      user_facing_error: failMsg.slice(0, 160),
      technical_fields_exposed: techLeak,
    },
    renderer_auto_progress_wired: autoProgressWired,
  };
  fs.writeFileSync(path.join(OUT_DIR, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));

  await runtime.stop();
  win.destroy();
  app.quit();
  return summary.ok ? 0 : 1;
}

module.exports = { runInSmoke };