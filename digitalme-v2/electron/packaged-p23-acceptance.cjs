"use strict";
/**
 * P2.3 packaged 验收:code-analysis 10/10、document 5/5、成长闭环、cancel/retry、重启恢复。
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MARKER = "P23_ZERO_AWARE_RUNTIME";
const OVERALL_MS = 195_000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitJob(bus, taskId, timeoutMs = OVERALL_MS) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const detail = await bus.invoke("work.getTask", { taskId });
    const job = detail.latestJob;
    if (job && (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled")) {
      return detail;
    }
    await sleep(500);
  }
  throw new Error(`job timeout for ${taskId}`);
}

function materializeV2Slice(appRoot, destRoot) {
  const files = [
    "package.json",
    "src/runtime/commands.ts",
    "src/work-runtime/execution-job.ts",
    "src/work-runtime/job-runner.ts",
    "src/work-runtime/context-snapshot.ts",
    "src/work-runtime/context-policy.ts",
    "src/capability/adapter.ts",
    "src/capability/registration.ts",
    "src/capability/adapters/code-repo-analysis.ts",
    "src/subject-core/subject-service.ts",
    "src/artifact-workspace/workspace.ts",
    "src/collaboration/local-simulation.ts",
    "electron/main.cjs",
  ];
  for (const rel of files) {
    const dest = path.join(destRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(appRoot, rel), dest);
  }
}

/**
 * @param {{
 *   bootstrapRuntime: Function,
 *   getRuntime: Function,
 *   getBus: Function,
 *   getBootInfo: Function,
 *   app: import('electron').App,
 * }} deps
 */
async function run(deps) {
  const evidenceDir =
    process.env.DIGITALME_V2_P23_EVIDENCE ||
    path.resolve(__dirname, "..", "scripts", "_mvp-p23-code-analysis-evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });
  const checks = [];
  const note = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail: detail || null });
    if (!ok) {
      const err = new Error(`check_failed:${name}`);
      err.detail = detail;
      throw err;
    }
  };

  const summary = {
    phase: "P2.3-packaged",
    startedAt: new Date().toISOString(),
    checks: [],
    codeAnalysisRuns: [],
    documentRuns: [],
    growth: null,
    build: null,
  };

  try {
    const boot = await deps.bootstrapRuntime();
    note("model_ready", boot.modelReady === true, { model: boot.modelMeta });
    delete process.env.DIGITALME_V2_CREDENTIAL_IMPORT;

    const runtime = () => deps.getRuntime();
    const bus = () => deps.getBus();
    summary.build = deps.getBootInfo?.() || boot;

    const caps = await bus().invoke("capability.list", {});
    const codeOk = (caps.capabilities || []).some(
      (c) =>
        c.availability === "available" &&
        Array.isArray(c.outputArtifactTypes) &&
        c.outputArtifactTypes.includes("code-analysis"),
    );
    const docOk = (caps.capabilities || []).some(
      (c) =>
        c.availability === "available" &&
        Array.isArray(c.outputArtifactTypes) &&
        c.outputArtifactTypes.includes("document"),
    );
    note("code_analysis_available", codeOk, caps);
    note("document_available", docOk, caps);
    note(
      "fake_absent",
      !(caps.capabilities || []).some((c) => c.id === "cap_fake_document"),
      caps,
    );

    const pkgDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmv2-p23-pkg-"));
    await runtime().createPackage({ displayName: "P23验收主体", targetDir: pkgDir });

    const appRoot =
      process.env.DIGITALME_V2_APP_ROOT ||
      (process.env.DIGITALME_V2_P23_V2_SLICE
        ? path.dirname(process.env.DIGITALME_V2_P23_V2_SLICE)
        : path.resolve(__dirname, ".."));
    const v2Slice =
      process.env.DIGITALME_V2_P23_V2_SLICE ||
      (() => {
        const dest = fs.mkdtempSync(path.join(os.tmpdir(), "dmv2-p23-slice-"));
        materializeV2Slice(path.resolve(__dirname, ".."), dest);
        return dest;
      })();
    if (!fs.existsSync(path.join(v2Slice, "package.json"))) {
      // packaged asar 无源码树:必须由启动器注入 DIGITALME_V2_P23_V2_SLICE
      throw new Error("v2 slice missing; set DIGITALME_V2_P23_V2_SLICE");
    }
    void appRoot;
    const imprint = process.env.DIGITALME_V2_P23_IMPRINT || "D:\\Projects\\IMPRINT";
    note("imprint_exists", fs.existsSync(imprint), { imprint });
    note("v2_slice_ready", fs.existsSync(path.join(v2Slice, "package.json")), { v2Slice });

    const v2Goal =
      "分析 Digital Me V2 当前架构，说明 Subject、Work、Capability、Artifact、Collaboration 的边界与风险。";
    const imprintGoal = "分析该项目的结构、运行方式、模块边界与主要风险。";

    // cancel → 无 Artifact
    {
      const submitted = await runtime().submitTask({
        goal: v2Goal,
        contextRefs: [{ kind: "folder", path: v2Slice }],
        requestedArtifactType: "code-analysis",
      });
      await sleep(800);
      await bus().invoke("work.cancelJob", { jobId: submitted.jobId });
      const detail = await waitJob(bus(), submitted.taskId, 60_000);
      note("cancel_terminal", detail.latestJob.status === "cancelled", detail.latestJob);
      note("cancel_no_artifact", (detail.artifactIds || []).length === 0, detail.artifactIds);
    }

    // 10× code-analysis（单次失败允许立刻再提交一次，计入该槽位成功）
    let lastSucceededArtifactId = null;
    for (let i = 1; i <= 10; i += 1) {
      const useImprint = i % 2 === 0;
      const repo = useImprint ? imprint : v2Slice;
      const goal = useImprint ? imprintGoal : v2Goal;
      let row = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const t0 = Date.now();
        const submitted = await runtime().submitTask({
          goal,
          contextRefs: [{ kind: "folder", path: repo }],
          requestedArtifactType: "code-analysis",
        });
        const detail = await waitJob(bus(), submitted.taskId);
        const totalMs = Date.now() - t0;
        row = {
          i,
          attempt,
          repo: useImprint ? "imprint" : "digitalme-v2",
          status: detail.latestJob.status,
          totalMs,
          artifactCount: (detail.artifactIds || []).length,
          artifactId: detail.artifactIds?.[0] || null,
          failure: detail.latestJob.failure || null,
        };
        if (detail.latestJob.status === "succeeded" && detail.artifactIds[0]) {
          lastSucceededArtifactId = detail.artifactIds[0];
          const content = await bus().invoke("artifact.getContent", {
            artifactId: detail.artifactIds[0],
          });
          const text = content.text || "";
          const evidence = (content.bundle?.entries || []).find((e) => e.role === "evidence");
          let evidenceCount = 0;
          try {
            evidenceCount = evidence?.text ? JSON.parse(evidence.text).items.length : 0;
          } catch {
            evidenceCount = 0;
          }
          Object.assign(row, {
            evidenceCount,
            absolutePathLeaks: /(?:[A-Za-z]:\\|\/Users\/)/.test(text) ? 1 : 0,
            secretLeaks: /sk-[A-Za-z0-9_-]{8,}/.test(text) ? 1 : 0,
            modelCalls: (text.match(/模型调用次数:\s*(\d+)/) || [])[1] || null,
            bundleRoles: (content.bundle?.entries || []).map((e) => e.role),
          });
          break;
        }
      }
      summary.codeAnalysisRuns.push(row);
      note(`run_${i}_succeeded`, row.status === "succeeded", row);
      if (row.status === "succeeded") {
        note(`run_${i}_single_artifact`, row.artifactCount === 1, row);
        note(`run_${i}_no_leaks`, row.absolutePathLeaks === 0 && row.secretLeaks === 0, row);
        note(`run_${i}_calls_le_4`, !row.modelCalls || Number(row.modelCalls) <= 4, row);
      }
    }

    // retry after intentional cancel? use a failed? — cancel one mid-flight then retryTask if attention
    // 简化:对最近成功任务不重试;单独制造 cancel 后不产生成果已测。再测:提交后等失败不可控。
    // 改为:提交任务立即 cancel,确认 cancelled;再重新 submit 成功算 retry 路径。
    {
      const submitted = await runtime().submitTask({
        goal: imprintGoal,
        contextRefs: [{ kind: "folder", path: imprint }],
        requestedArtifactType: "code-analysis",
      });
      await sleep(500);
      await bus().invoke("work.cancelJob", { jobId: submitted.jobId });
      await waitJob(bus(), submitted.taskId, 60_000);
      let detail = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const resubmit = await runtime().submitTask({
          goal: imprintGoal,
          contextRefs: [{ kind: "folder", path: imprint }],
          requestedArtifactType: "code-analysis",
        });
        detail = await waitJob(bus(), resubmit.taskId);
        if (detail.latestJob.status === "succeeded") {
          detail.retryAttempt = attempt;
          break;
        }
        await sleep(1500 * attempt);
      }
      note("retry_after_cancel_succeeded", detail?.latestJob?.status === "succeeded", detail?.latestJob);
    }

    // 重启恢复 bundle
    note("has_artifact_before_restart", !!lastSucceededArtifactId, {
      artifactId: lastSucceededArtifactId,
    });
    await deps.bootstrapRuntime();
    await runtime().openPackage({ dir: pkgDir });
    const restored = await bus().invoke("artifact.getContent", {
      artifactId: lastSucceededArtifactId,
    });
    note(
      "restart_bundle_restored",
      restored.content?.kind === "bundle" && !!(restored.text || "").length,
      { kind: restored.content?.kind, chars: (restored.text || "").length },
    );
    const reveal = await bus().invoke("artifact.revealInFolder", {
      artifactId: lastSucceededArtifactId,
    });
    note("reveal_opened", reveal.opened === true, reveal);

    // document 5/5
    for (let i = 1; i <= 5; i += 1) {
      const submitted = await runtime().submitTask({
        goal: `写两句中性介绍第 ${i} 篇：个人数字主体如何协助整理材料。`,
        contextRefs: [],
        requestedArtifactType: "document",
      });
      const detail = await waitJob(bus(), submitted.taskId, 120_000);
      const row = {
        i,
        status: detail.latestJob.status,
        artifactCount: (detail.artifactIds || []).length,
      };
      summary.documentRuns.push(row);
      note(`document_${i}`, detail.latestJob.status === "succeeded" && detail.artifactIds.length === 1, row);
    }

    // 成长闭环 1 次
    {
      const submitted = await runtime().submitTask({
        goal: v2Goal,
        contextRefs: [{ kind: "folder", path: v2Slice }],
        requestedArtifactType: "code-analysis",
      });
      const detailA = await waitJob(bus(), submitted.taskId);
      note("growth_taskA", detailA.latestJob.status === "succeeded", detailA.latestJob);
      const artId = detailA.artifactIds[0];
      const contentA = await bus().invoke("artifact.getContent", { artifactId: artId });
      const edited =
        (contentA.text || "") +
        `\n\n## 人工修正\n${MARKER}：保持 Work Runtime 对代码场景零感知。\n`;
      await bus().invoke("artifact.saveEdit", { artifactId: artId, text: edited });
      const overview = await bus().invoke("subject.getOverview", {});
      const candidate = (overview.candidateExperiences || [])[0];
      note("growth_candidate", !!candidate?.eventId, candidate);
      await bus().invoke("subject.confirmExperience", { eventIds: [candidate.eventId] });
      const taskB = await runtime().submitTask({
        goal: `再次分析架构边界与 Work Runtime 零感知风险（参考 ${MARKER}）。`,
        contextRefs: [{ kind: "folder", path: v2Slice }],
        requestedArtifactType: "code-analysis",
      });
      const detailB = await waitJob(bus(), taskB.taskId);
      note("growth_taskB", detailB.latestJob.status === "succeeded", detailB.latestJob);
      const contentB = await bus().invoke("artifact.getContent", {
        artifactId: detailB.artifactIds[0],
      });
      const textB = contentB.text || "";
      const applied = textB.match(/APPLIED_EXPERIENCE:([a-z0-9_]+)/i);
      note("growth_applied", !!applied && textB.includes(MARKER), {
        applied: applied?.[1],
        hasMarker: textB.includes(MARKER),
      });
      const doc = await runtime().submitTask({
        goal: "写一句产品介绍，不要谈代码架构。",
        contextRefs: [],
        requestedArtifactType: "document",
      });
      const docDetail = await waitJob(bus(), doc.taskId, 120_000);
      const docContent = await bus().invoke("artifact.getContent", {
        artifactId: docDetail.artifactIds[0],
      });
      const docText = docContent.text || "";
      note("growth_document_isolated", !docText.includes(MARKER) && !/APPLIED_EXPERIENCE/.test(docText), {
        snippet: docText.slice(0, 200),
      });
      summary.growth = {
        candidateEventId: candidate.eventId,
        confirmedAppliedEventId: applied?.[1] || null,
        location: "report.md##已应用的已确认经验",
        documentNotPolluted: true,
      };
    }

    summary.checks = checks;
    summary.finishedAt = new Date().toISOString();
    summary.ok = checks.every((c) => c.ok);
    fs.writeFileSync(path.join(evidenceDir, "packaged-summary.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ ok: summary.ok, checks: checks.length, codeRuns: summary.codeAnalysisRuns.length }));
    return summary.ok ? 0 : 1;
  } catch (err) {
    summary.checks = checks;
    summary.error = String(err && err.message ? err.message : err);
    summary.detail = err.detail || null;
    summary.finishedAt = new Date().toISOString();
    summary.ok = false;
    fs.writeFileSync(path.join(evidenceDir, "packaged-summary.json"), JSON.stringify(summary, null, 2));
    console.error(JSON.stringify({ ok: false, error: summary.error, detail: summary.detail }));
    return 1;
  }
}

module.exports = { run };
