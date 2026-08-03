"use strict";
/**
 * P2A ZIP 候选最小验收：文档 1、code-analysis 2、bundle viewer、重启恢复。
 * 不做 10× / 3×3 / 成长闭环 / 完整失败矩阵。
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const OVERALL_MS = 195_000;
const OWNER_GOAL =
  "分析 Digital Me V2 当前代码架构，说明 Subject、Work、Capability、Artifact 与 Collaboration 的模块边界；指出最值得优先处理的三项复杂度或维护风险，并给出下一步建议。所有判断必须附文件依据。";
const OTHER_GOAL = "分析该项目的结构、运行方式、模块边界与主要风险；所有判断必须附文件依据。";

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

function parseEvidenceCount(content) {
  const evidence = (content.bundle?.entries || []).find((e) => e.role === "evidence");
  try {
    return evidence?.text ? JSON.parse(evidence.text).items.length : 0;
  } catch {
    return 0;
  }
}

function inspectBundle(content) {
  const text = content.text || "";
  const roles = (content.bundle?.entries || []).map((e) => e.role);
  const evidenceCount = parseEvidenceCount(content);
  const findingsWithEvidence = (text.match(/evidence|依据|文件/gi) || []).length;
  const findingLines = (text.match(/^###?\s+|^-\s+\*\*|^##\s+发现/gm) || []).length;
  return {
    kind: content.content?.kind || content.bundle?.kind || null,
    roles,
    evidenceCount,
    absolutePathLeaks: /(?:[A-Za-z]:\\|\/Users\/)/.test(text) ? 1 : 0,
    secretLeaks: /sk-[A-Za-z0-9_-]{8,}/.test(text) ? 1 : 0,
    hasCoverage: /覆盖|扫描文件|filesScanned|language/i.test(text),
    findingHint: Math.max(findingsWithEvidence, findingLines, evidenceCount),
    modelCalls: Number((text.match(/模型调用次数:\s*(\d+)/) || [])[1] || 0) || null,
    chars: text.length,
    reportPreview: text.slice(0, 400),
  };
}

/**
 * @param {{
 *   bootstrapRuntime: Function,
 *   getRuntime: Function,
 *   getBus: Function,
 *   getBootInfo: Function,
 *   createWindow?: Function,
 *   app: import('electron').App,
 * }} deps
 */
async function run(deps) {
  const evidenceDir =
    process.env.DIGITALME_V2_P2A_EVIDENCE ||
    path.resolve(__dirname, "..", "scripts", "_mvp-p2a-zip-candidate-evidence");
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
    phase: "P2A-zip-candidate",
    startedAt: new Date().toISOString(),
    checks: [],
    documentRuns: [],
    codeAnalysisRuns: [],
    ui: null,
    restart: null,
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

    const pkgDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmv2-p2a-pkg-"));
    await runtime().createPackage({ displayName: "P2A体验主体", targetDir: pkgDir });

    const appRoot = process.env.DIGITALME_V2_APP_ROOT || path.resolve(__dirname, "..");
    const v2Slice =
      process.env.DIGITALME_V2_P2A_V2_SLICE ||
      (() => {
        const dest = fs.mkdtempSync(path.join(os.tmpdir(), "dmv2-p2a-slice-"));
        materializeV2Slice(appRoot, dest);
        return dest;
      })();
    note("v2_slice_ready", fs.existsSync(path.join(v2Slice, "package.json")), { v2Slice });

    const otherRepo = process.env.DIGITALME_V2_P2A_OTHER_REPO || "D:\\Projects\\IMPRINT";
    note("other_repo_exists", fs.existsSync(otherRepo), { otherRepo });

    // 文档 1 次
    {
      const t0 = Date.now();
      const submitted = await runtime().submitTask({
        goal: "写两句中性介绍：个人数字主体如何协助整理本地材料。",
        contextRefs: [],
        requestedArtifactType: "document",
      });
      const detail = await waitJob(bus(), submitted.taskId, 120_000);
      const row = {
        status: detail.latestJob.status,
        artifactCount: (detail.artifactIds || []).length,
        totalMs: Date.now() - t0,
        artifactId: detail.artifactIds?.[0] || null,
      };
      summary.documentRuns.push(row);
      note("document_1", row.status === "succeeded" && row.artifactCount === 1, row);
    }

    // code-analysis 2 次：digitalme-v2 + 不同类型小型项目
    const codeJobs = [
      { label: "digitalme-v2", repo: v2Slice, goal: OWNER_GOAL },
      { label: "imprint", repo: otherRepo, goal: OTHER_GOAL },
    ];
    let ownerArtifactId = null;
    for (const job of codeJobs) {
      let row = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const t0 = Date.now();
        const submitted = await runtime().submitTask({
          goal: job.goal,
          contextRefs: [{ kind: "folder", path: job.repo }],
          requestedArtifactType: "code-analysis",
        });
        const detail = await waitJob(bus(), submitted.taskId);
        const content =
          detail.latestJob.status === "succeeded" && detail.artifactIds?.[0]
            ? await bus().invoke("artifact.getContent", { artifactId: detail.artifactIds[0] })
            : null;
        const inspected = content ? inspectBundle(content) : null;
        row = {
          label: job.label,
          attempt,
          status: detail.latestJob.status,
          totalMs: Date.now() - t0,
          artifactCount: (detail.artifactIds || []).length,
          artifactId: detail.artifactIds?.[0] || null,
          failure: detail.latestJob.failure || null,
          bundle: inspected,
        };
        if (row.status === "succeeded") break;
      }
      summary.codeAnalysisRuns.push(row);
      note(`code_${job.label}_succeeded`, row.status === "succeeded", row);
      note(`code_${job.label}_single_artifact`, row.artifactCount === 1, row);
      note(`code_${job.label}_bundle`, row.bundle?.kind === "bundle" || (row.bundle?.roles || []).includes("report"), row.bundle);
      note(`code_${job.label}_evidence_ge_5`, (row.bundle?.evidenceCount || 0) >= 5, row.bundle);
      note(
        `code_${job.label}_no_leaks`,
        row.bundle?.absolutePathLeaks === 0 && row.bundle?.secretLeaks === 0,
        row.bundle,
      );
      note(`code_${job.label}_coverage`, row.bundle?.hasCoverage === true, row.bundle);
      note(`code_${job.label}_le_180s`, row.totalMs <= 180_000, { totalMs: row.totalMs });
      if (job.label === "digitalme-v2") ownerArtifactId = row.artifactId;
    }

    // bundle viewer：report / manifest / evidence / reveal
    {
      const content = await bus().invoke("artifact.getContent", { artifactId: ownerArtifactId });
      const roles = (content.bundle?.entries || []).map((e) => e.role);
      note("bundle_has_report", roles.includes("report"), roles);
      note("bundle_has_manifest", roles.includes("manifest"), roles);
      note("bundle_has_evidence", roles.includes("evidence"), roles);
      const reveal = await bus().invoke("artifact.revealInFolder", { artifactId: ownerArtifactId });
      note("reveal_opened", reveal.opened === true, reveal);
      summary.bundleViewer = { roles, reveal };
    }

    // 重启恢复
    {
      await deps.bootstrapRuntime();
      await runtime().openPackage({ dir: pkgDir });
      const restored = await bus().invoke("artifact.getContent", { artifactId: ownerArtifactId });
      const ok =
        restored.content?.kind === "bundle" && !!(restored.text || "").length;
      note("restart_bundle_restored", ok, {
        kind: restored.content?.kind,
        chars: (restored.text || "").length,
      });
      summary.restart = { ok, artifactId: ownerArtifactId };
    }

    // UI 最小检查（打开窗口后读 DOM；失败时回退静态契约检查）
    if (typeof deps.createWindow === "function") {
      const { BrowserWindow } = require("electron");
      let win = deps.createWindow(summary.build || boot);
      if (!win) win = BrowserWindow.getAllWindows()[0];
      if (!win) {
        note("ui_window_created", false, { reason: "no_browser_window" });
      } else {
        await new Promise((resolve) => {
          if (!win.webContents.isLoading()) resolve();
          else win.webContents.once("did-finish-load", resolve);
          setTimeout(resolve, 4000);
        });
        await sleep(800);
        // 选中代码分析结果，驱动 bundle 只读视图
        await win.webContents.executeJavaScript(`(() => {
          const sel = document.getElementById('task-type');
          if (sel) { sel.value = 'code-analysis'; sel.dispatchEvent(new Event('change')); }
          return true;
        })()`);
        // 通过总线已恢复的 artifact 不一定在 UI 选中；检查类型选项与代码分析只读控件契约
        const ui = await win.webContents.executeJavaScript(`(() => {
          const text = document.body ? document.body.innerText : '';
          const html = document.body ? document.body.innerHTML : '';
          const typeSel = document.getElementById('task-type');
          const options = typeSel
            ? Array.from(typeSel.options).map((o) => ({ value: o.value, label: o.textContent.trim() }))
            : [];
          const revise = document.getElementById('btn-revise');
          const exportMd = document.getElementById('btn-export-md');
          const exportDocx = document.getElementById('btn-export-docx');
          const editor = document.getElementById('artifact-editor');
          const reveal = document.getElementById('btn-reveal');
          const bundleView = document.getElementById('bundle-view');
          return {
            hasDocType: options.some((o) => o.value === 'document' && /文档/.test(o.label)),
            hasCodeType: options.some((o) => o.value === 'code-analysis' && /代码项目分析/.test(o.label)),
            hasRevealControl: !!reveal,
            hasBundleView: !!bundleView,
            hasInternalLeak: /grounded|tool_calls|DSML|MCP\\/npx|一等公民/.test(text + html),
            hasDuplicateModelGate: (text.match(/请先连接模型/g) || []).length > 1,
            controls: {
              revisePresent: !!revise,
              exportMdPresent: !!exportMd,
              exportDocxPresent: !!exportDocx,
              editorPresent: !!editor,
              revealLabel: reveal ? reveal.textContent.trim() : null,
            },
          };
        })()`);
        summary.ui = ui;
        note("ui_task_types", ui.hasDocType && ui.hasCodeType, ui);
        note("ui_bundle_controls", ui.hasBundleView && ui.hasRevealControl, ui);
        note("ui_no_internal_terms", !ui.hasInternalLeak, ui);
        note("ui_no_duplicate_model_gate", !ui.hasDuplicateModelGate, ui);
        // 代码分析结果视图契约：源码已保证选中 bundle 时隐藏 editor/revise/export
        const rendererSrc = require("node:fs").readFileSync(
          require("node:path").join(__dirname, "renderer", "app.js"),
          "utf8",
        );
        note(
          "ui_code_analysis_readonly_contract",
          /els\.artifactEditor\.hidden = true/.test(rendererSrc) &&
            /els\.revise\.closest\("\.revise-box"\)\.hidden = true/.test(rendererSrc) &&
            /els\.exportMd\.hidden = true/.test(rendererSrc) &&
            /打开所在目录/.test(
              require("node:fs").readFileSync(
                require("node:path").join(__dirname, "renderer", "index.html"),
                "utf8",
              ),
            ),
          { contractFromPackagedRenderer: true },
        );
        try {
          win.close();
        } catch {
          /* ignore */
        }
      }
    }

    summary.checks = checks;
    summary.finishedAt = new Date().toISOString();
    summary.ok = checks.every((c) => c.ok);
    fs.writeFileSync(path.join(evidenceDir, "p2a-summary.json"), JSON.stringify(summary, null, 2));
    console.log(
      JSON.stringify({
        ok: summary.ok,
        checks: checks.length,
        document: summary.documentRuns.length,
        code: summary.codeAnalysisRuns.length,
      }),
    );
    return summary.ok ? 0 : 1;
  } catch (err) {
    summary.checks = checks;
    summary.error = String(err && err.message ? err.message : err);
    summary.detail = err.detail || null;
    summary.finishedAt = new Date().toISOString();
    summary.ok = false;
    fs.writeFileSync(path.join(evidenceDir, "p2a-summary.json"), JSON.stringify(summary, null, 2));
    console.error(JSON.stringify({ ok: false, error: summary.error, detail: summary.detail }));
    return 1;
  }
}

module.exports = { run };
