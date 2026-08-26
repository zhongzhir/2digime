"use strict";
/**
 * DIGITALME-SEARCH-FAILURE-CLOSURE-01 — 定向复测 T2/T6/T7（普通用户真实入口）。
 *
 * 从普通用户入口（work.converse）进入：
 *   T2 当前研究：professional search 首次 transient 失败 → baseline search fallback → 完成。
 *   T6 深度研究：同能力链，closure 如实 BASELINE，仍完成基本闭环。
 *   T7 连续失败：第一个任务 professional 失败→fallback；cooldown 生效，第二个任务直接用 baseline。
 * 使用 capabilityRegistryOverride 可控注入（professional 首败 / baseline 可用 / model 可用）。
 * 触发：DIGITALME_V2_SFC_EVIDENCE=1 + DIGITALME_V2_PACKAGED_SMOKE=1
 * 输出：build/evidence/search-failure-closure-01/
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "build", "evidence", "search-failure-closure-01");

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function runInSmoke(ctx) {
  const { createWindow, app } = ctx;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const boot = await ctx.bootstrapRuntime();
  const bus = ctx.getBus();
  const runtime = ctx.getRuntime();
  const win = createWindow(boot);
  await sleep(1500);
  const { waitForJobTerminal } = require(path.join(ROOT, "dist", "work-runtime", "job-runner"));
  const { CapabilityRegistry } = require(path.join(ROOT, "dist", "capability", "registry"));
  const { asLocalCapabilityAdapter } = require(path.join(ROOT, "dist", "capability", "local-adapter-lifecycle"));
  const { createOpenAiCompatibleAdapter } = require(path.join(ROOT, "dist", "capability", "adapters", "openai-compatible"));
  const { createFakeDocumentAdapter } = require(path.join(ROOT, "dist", "capability", "adapters", "fake-document"));

  const results = [];
  const rec = (id, label) => ({
    id, label, initial_user_input: "",
    user_confirmation_count: 0, technical_decisions_requested: [],
    recovery_user_intervention: [], time_to_result_ms: null,
    actual_capability_path: [], final_result: null, major_manual_rework: null,
  });

  // 可控 registry：model 可用；professional search 首败；baseline search 可用。
  function searchReg(id, adapterId) {
    return { id, kind: "tool", displayName: id, description: id,
      inputContract: { acceptsGoal: true, acceptsSnapshot: true, acceptsSubjectContext: true },
      outputArtifactTypes: ["document"], permissions: ["network"], cost: { estimate: "" },
      latencyEstimate: "", location: "remote", availability: "available",
      adapter: { type: "local-tool", adapterId } };
  }
  function searchAdapter(id, adapterId, failTimes) {
    return asLocalCapabilityAdapter({
      registration: searchReg(id, adapterId),
      async execute(_input, ctx2) {
        if (failTimes > 0) {
          const e = new Error("server error 503");
          e.transient = true; e.status = 503;
          throw e;
        }
        ctx2.reportProgress("正在检索");
        return { artifact: { type: "document", title: "搜索", payload: { kind: "text", format: "markdown", text: "# 研究要点\n\n- AI Agent 在企业辅助开发的主要模式\n- 企业引入 AI Agent 的常见风险与收益\n- 来源A：真实来源 / 来源B：真实来源\n覆盖有限但可用，供进一步阅读。" } },
          materialUse: { usedPaths: [], includedCount: 0, fullReadCount: 0, truncatedCount: 0 } };
      },
    });
  }
  const registry = new CapabilityRegistry();
  registry.register(createOpenAiCompatibleAdapter({ baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.6-flash", providerId: "openai-compatible", availability: "available" }));
  registry.register(searchAdapter("cap_gemini_web_search", "gemini-search", 1)); // 首次失败
  registry.register(searchAdapter("cap_baseline_web_search", "baseline-bing-search", 0)); // 可用

  // 注入 registry：converse 走真实模型（openai-compatible），execute 用 override 的 search adapters。
  const { createDigitalMeRuntime } = require(path.join(ROOT, "dist", "runtime", "digitalme-runtime"));
  const runtime2 = createDigitalMeRuntime({
    documentCapability: "openai-compatible",
    openaiCompatible: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-3.6-flash", providerId: "openai-compatible", timeoutMs: 90000 },
    secrets: { get: async () => process.env.GEMINI_API_KEY },
    registerOpenAiStub: false,
    codeAnalysisCapability: "needs_setup",
    capabilityRegistryOverride: registry,
  });
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dmv2-sfc-"));
  await runtime2.createPackage({ displayName: "sfc", targetDir: path.join(tmp, "pkg") });
  const bus2 = ctx.getBus ? undefined : undefined;
  void bus2;

  async function runUserTask(record, goal) {
    const start = Date.now();
    try {
      const conv = await runtime2.converse({ text: goal, contextRefs: [] });
      if (conv.degraded) { record.final_result = { error: "converse_degraded" }; record.major_manual_rework = true; return; }
      const sub = await runtime2.submitTask({
        goal, contextRefs: [], requestedArtifactType: "document", intentKind: "external_research",
        existingTaskId: conv.taskId, ...(conv.plan && conv.plan.version != null ? { confirmedPlanVersion: conv.plan.version } : {}),
      });
      record.time_to_result_ms = Date.now() - start;
      record.actual_capability_path.push(sub.capabilityClosure ? `closure:${sub.capabilityClosure.level}` : "");
      if (sub.jobId) {
        const job = await waitForJobTerminal(runtime2.workRuntime, sub.jobId, 60_000);
        record.actual_capability_path.push(job.capabilityId);
        if (job.status === "succeeded" && job.artifactId) {
          const content = await runtime2.getContent({ artifactId: job.artifactId });
          const text = String(content.text || "");
          record.final_result = { status: "succeeded", textLength: text.length, excerpt: text.slice(0, 120) };
          record.major_manual_rework = false;
        } else {
          record.final_result = { status: job.status, note: String(job.progress?.note || "") };
          record.major_manual_rework = true;
        }
      }
    } catch (err) {
      record.time_to_result_ms = Date.now() - start;
      record.final_result = { error: String((err && err.message) || "").slice(0, 160) };
      record.major_manual_rework = true;
    }
  }

  // T2 当前研究（professional 首败 → baseline fallback）
  const t2 = rec("T2", "当前研究");
  t2.initial_user_input = "调研企业引入 AI Agent 辅助开发时最常踩的三个坑，形成调研摘要。";
  await runUserTask(t2, t2.initial_user_input);
  results.push(t2);

  // T6 深度研究（无 professional deep research；professional search 首败 → baseline research 闭环）
  const t6 = rec("T6", "深度研究");
  t6.initial_user_input = "做一份关于 AI Agent 辅助开发对企业软件工程影响的深入行业研究报告。";
  await runUserTask(t6, t6.initial_user_input);
  results.push(t6);

  // T7 连续失败：第二次相似任务，cooldown 生效，直接用 baseline（不再撞 professional）
  const t7 = rec("T7", "连续失败");
  t7.initial_user_input = "再调研一次 AI Agent 在企业落地的收益与风险。";
  await runUserTask(t7, t7.initial_user_input);
  results.push(t7);

  // 截图
  try {
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT_DIR, "sfc-shell.png"), image.toPNG());
  } catch { /* ignore */ }

  const summary = {
    note: "capabilityRegistryOverride 可控注入：professional search 首次 transient 失败、baseline search 可用、model 可用。普通用户入口 converse。",
    tasks: results,
  };
  fs.writeFileSync(path.join(OUT_DIR, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));

  await runtime2.stop();
  await runtime.stop();
  win.destroy();
  app.quit();
  return 0;
}

module.exports = { runInSmoke };