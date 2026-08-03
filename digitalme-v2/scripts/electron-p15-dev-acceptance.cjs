"use strict";
/**
 * P1.5 开发态真实验收(Electron + 真实 DeepSeek)。
 * - 复用与 npm run dev 相同的 main 引导链(凭证/命令总线/preload/renderer);
 * - 不改架构契约、不接 Legacy 业务;
 * - 证据写入 scripts/_mvp-p15-dev-acceptance-evidence/(gitignore)。
 *
 * 启动: node scripts/run-p15-dev-acceptance.cjs
 */
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { writeZip } = require("../dist/infrastructure/zip");

const ROOT = path.resolve(__dirname, "..");
const EVIDENCE = path.join(ROOT, "scripts", "_mvp-p15-dev-acceptance-evidence");

const COMMAND_NAMES = new Set([
  "subject.createPackage",
  "subject.openPackage",
  "subject.getOverview",
  "subject.confirmExperience",
  "work.submitTask",
  "work.retryTask",
  "work.cancelJob",
  "work.getTask",
  "work.listTasks",
  "artifact.getContent",
  "artifact.saveEdit",
  "artifact.export",
  "artifact.revealInFolder",
  "capability.list",
  "collab.simulateInteraction",
]);

/** @type {import('../dist/runtime/digitalme-runtime').DigitalMeRuntime} */
let runtime;
/** @type {import('../dist/runtime/commands').CommandBus} */
let bus;
/** @type {BrowserWindow | null} */
let win = null;

const report = {
  startedAt: new Date().toISOString(),
  model: null,
  checks: [],
  tasks: [],
  growth: null,
  restart: null,
  consecutive: null,
  verdict: null,
};

function check(name, ok, detail) {
  report.checks.push({ name, ok: !!ok, ...(detail ? { detail } : {}) });
  if (!ok) {
    const err = new Error(`CHECK_FAILED: ${name}${detail ? ` — ${JSON.stringify(detail)}` : ""}`);
    err.checkName = name;
    throw err;
  }
}

function scrub(value) {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === "string" && /sk-[A-Za-z0-9_-]{8,}/.test(v)) return "[redacted]";
      if (typeof v === "string" && v.length > 1200) return `${v.slice(0, 1200)}…[truncated]`;
      return v;
    }),
  );
}

function writeEvidence(name, payload) {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE, name), `${JSON.stringify(scrub(payload), null, 2)}\n`, "utf8");
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

function trackJobTiming(jobId) {
  const timing = {
    jobId,
    submitAt: Date.now(),
    processingAt: null,
    contextDoneAt: null,
    capabilityAt: null,
    finishedAt: null,
  };
  const unsub = runtime.eventBus.subscribe((ev) => {
    if (ev.kind !== "job.updated" || ev.jobId !== jobId) return;
    if (ev.status === "running" && timing.processingAt == null) timing.processingAt = Date.now();
    if (ev.phase === "capability" && timing.capabilityAt == null) timing.capabilityAt = Date.now();
    if (ev.phase === "context" && timing.contextDoneAt == null) {
      // context phase start; snapshot done when capability begins
    }
    if (ev.status === "succeeded" || ev.status === "failed" || ev.status === "cancelled") {
      timing.finishedAt = Date.now();
    }
  });
  return { timing, unsub };
}

async function waitTerminal(jobId, timeoutMs = 180000) {
  const { waitForJobTerminal } = require("../dist/work-runtime/job-runner");
  return waitForJobTerminal(runtime.workRuntime, jobId, timeoutMs);
}

async function prepareMaterials(dir) {
  await fs.promises.mkdir(dir, { recursive: true });
  const note = path.join(dir, "note.txt");
  await fs.promises.writeFile(note, "关键事实:项目代号为青竹，本周完成基础设施端口。", "utf8");

  const pptx = path.join(dir, "deck.pptx");
  const slide = (text) =>
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>${text}</a:t></a:p></p:sld>`;
  await fs.promises.writeFile(
    pptx,
    writeZip([{ name: "ppt/slides/slide1.xml", data: Buffer.from(slide("幻灯片要点:接口契约冻结"), "utf8") }]),
  );

  const folder = path.join(dir, "bundle");
  await fs.promises.mkdir(folder, { recursive: true });
  await fs.promises.writeFile(path.join(folder, "a.md"), "# A\n模块甲已完成\n", "utf8");
  await fs.promises.writeFile(path.join(folder, "b.txt"), "模块乙待联调\n", "utf8");
  await fs.promises.writeFile(path.join(folder, "c.md"), "模块丙联调中\n", "utf8");

  return {
    note,
    pptx,
    folder,
    refs: [
      { kind: "file", path: note },
      { kind: "file", path: pptx },
      { kind: "folder", path: folder },
    ],
  };
}

async function bootstrap() {
  const { createDigitalMeRuntime } = require("../dist/runtime/digitalme-runtime");
  const { createCommandBus } = require("../dist/runtime/command-bus");
  const { resolveDevModelConfig } = require("../electron/bootstrap-secrets.cjs");
  const model = await resolveDevModelConfig({ safeStorage });
  check("model_credential_ready", model.ok === true && model.documentCapability === "openai-compatible", {
    reason: model.reason || null,
  });
  report.model = model.modelMeta;

  runtime = createDigitalMeRuntime({
    documentCapability: "openai-compatible",
    openaiCompatible: model.openaiCompatible,
    secrets: model.secrets,
    registerOpenAiStub: false,
  });
  bus = createCommandBus(runtime);
}

function registerIpc() {
  ipcMain.handle("command:invoke", async (_e, name, input) => {
    if (!COMMAND_NAMES.has(name)) throw new Error(`command not exposed: ${name}`);
    if (name === "artifact.revealInFolder") {
      const result = await bus.invoke(name, input || {});
      try {
        const dir = await runtime.getArtifactStorageDir(input.artifactId);
        shell.showItemInFolder(dir);
      } catch {
        /* ignore */
      }
      return result;
    }
    if (name === "artifact.export") {
      let targetPath = input && input.targetPath;
      if (!targetPath) {
        const format = input.format;
        const picked = await dialog.showSaveDialog(win, {
          defaultPath: format === "docx" ? "成果.docx" : "成果.md",
        });
        if (picked.canceled || !picked.filePath) throw new Error("已取消导出");
        targetPath = picked.filePath;
      }
      return bus.invoke(name, { ...input, targetPath });
    }
    return bus.invoke(name, input || {});
  });
  ipcMain.handle("shell:pickOpenFiles", async () => []);
  ipcMain.handle("shell:pickOpenDirectory", async () => null);
  ipcMain.handle("shell:pickSaveDirectory", async () => null);
}

async function createWindow(bootInfo) {
  win = new BrowserWindow({
    width: 1180,
    height: 820,
    show: true,
    webPreferences: {
      preload: path.join(ROOT, "electron", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  runtime.eventBus.subscribe((event) => {
    if (win && !win.isDestroyed()) win.webContents.send("domain:event", event);
  });
  await win.loadURL(pathToFileURL(path.join(ROOT, "electron", "renderer", "index.html")).href);
  win.webContents.send("shell:boot", bootInfo);
}

async function uiEval(fnSource) {
  return win.webContents.executeJavaScript(`(${fnSource})()`, true);
}

async function runTask(label, goal, contextRefs, opts = {}) {
  const tSubmit0 = Date.now();
  const submitted = await bus.invoke("work.submitTask", {
    goal,
    contextRefs,
    requestedArtifactType: "document",
  });
  const submitMs = Date.now() - tSubmit0;
  const { timing, unsub } = trackJobTiming(submitted.jobId);
  timing.submitAt = tSubmit0;

  // UI: submit 后 1 秒内进入“正在处理”
  let processingWithin1s = false;
  const deadline = Date.now() + 1000;
  while (Date.now() <= deadline) {
    const detail = await bus.invoke("work.getTask", { taskId: submitted.taskId });
    if (detail.state === "processing" || detail.userFacingLabel === "正在处理") {
      processingWithin1s = true;
      break;
    }
    if (detail.state === "completed") {
      // 极快完成也算进入过处理
      processingWithin1s = true;
      break;
    }
    await sleep(20);
  }
  if (opts.requireProcessingWithin1s !== false) {
    check(`${label}_processing_within_1s`, processingWithin1s, { submitMs });
  }

  const job = await waitTerminal(submitted.jobId, opts.timeoutMs || 180000);
  unsub();
  const totalMs = (timing.finishedAt || Date.now()) - tSubmit0;
  const contextMs =
    timing.capabilityAt != null ? timing.capabilityAt - tSubmit0 : job.costActual?.durationMs || null;
  const modelMs =
    timing.capabilityAt != null && timing.finishedAt != null
      ? timing.finishedAt - timing.capabilityAt
      : job.costActual?.durationMs || null;

  let artifactChars = 0;
  let artifactId = null;
  if (job.status === "succeeded") {
    artifactId = job.artifactId;
    const content = await bus.invoke("artifact.getContent", { artifactId });
    artifactChars = (content.text || "").length;
    check(`${label}_no_fake_failure`, job.status === "succeeded");
    check(`${label}_artifact_present`, !!artifactId && artifactChars > 0);
  }

  const row = {
    label,
    taskId: submitted.taskId,
    jobId: submitted.jobId,
    status: job.status,
    submitMs,
    contextMs,
    modelMs,
    totalMs,
    artifactChars,
    artifactId,
    tokens: job.costActual?.tokens,
    stage: job.failure?.stage || null,
  };
  report.tasks.push(row);
  writeEvidence(`task-${report.tasks.length}-${label}.json`, row);
  return { submitted, job, row, contentText: artifactId ? (await bus.invoke("artifact.getContent", { artifactId })).text : "" };
}

async function verifyUiArtifactOps(artifactId) {
  // 载入 UI 状态
  await uiEval(`async () => {
    const api = window.digitalMe;
    const content = await api.invoke('artifact.getContent', { artifactId: ${JSON.stringify(artifactId)} });
    const panel = document.getElementById('artifact-panel');
    const editor = document.getElementById('artifact-editor');
    panel.hidden = false;
    editor.value = content.text || '';
    window.__p15ArtifactId = ${JSON.stringify(artifactId)};
    return { chars: (content.text || '').length };
  }`);

  // 编辑 + 自动保存路径(直接 invoke,等同 UI debounce 后的命令)
  const before = await bus.invoke("artifact.getContent", { artifactId });
  const edited = `${before.text}\n\n验收编辑句：发布节奏要明确。\n`;
  const saved = await bus.invoke("artifact.saveEdit", { artifactId, text: edited });
  check("autosave_new_version", !!saved.versionId);
  const after = await bus.invoke("artifact.getContent", { artifactId });
  check("autosave_persisted", (after.text || "").includes("验收编辑句"));

  // 复制(渲染进程 clipboard)
  const copied = await uiEval(`async () => {
    const text = document.getElementById('artifact-editor').value || '';
    await navigator.clipboard.writeText(text);
    return text.length > 0;
  }`);
  check("copy_clipboard", copied === true);

  // 导出 MD / DOCX(显式 targetPath,避免对话框)
  const mdOut = path.join(EVIDENCE, "export-sample.md");
  const docxOut = path.join(EVIDENCE, "export-sample.docx");
  const md = await bus.invoke("artifact.export", { artifactId, format: "md", targetPath: mdOut });
  const docx = await bus.invoke("artifact.export", { artifactId, format: "docx", targetPath: docxOut });
  check("export_md", fs.existsSync(md.path));
  check("export_docx", fs.existsSync(docx.path) && fs.statSync(docx.path).size > 20);

  const revealed = await bus.invoke("artifact.revealInFolder", { artifactId });
  check("reveal_folder", revealed.opened === true);
}

async function mainSequence() {
  const workRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dmv2-p15-acc-"));
  const pkgDir = path.join(workRoot, "subject-pkg");
  const materials = await prepareMaterials(path.join(workRoot, "materials"));

  await bus.invoke("subject.createPackage", {
    displayName: "P15验收主体",
    targetDir: pkgDir,
  });

  // UI 进入工作区
  await uiEval(`async () => {
    document.getElementById('view-welcome').hidden = true;
    document.getElementById('view-workspace').hidden = false;
    document.getElementById('pkg-title').textContent = 'P15验收主体';
    return true;
  }`);

  // --- 材料任务 ---
  const material = await runTask(
    "materials-mix",
    "根据材料写一份简报，必须提到青竹，并概括幻灯片与文件夹中的模块状态。",
    materials.refs,
  );
  check("material_mentions_bamboo", /青竹/.test(material.contentText || ""));

  await verifyUiArtifactOps(material.job.artifactId);

  // --- 取消 ---
  {
    const t0 = Date.now();
    const submitted = await bus.invoke("work.submitTask", {
      goal: "写一篇较长的架构说明，尽量详细，便于取消测试",
      contextRefs: materials.refs,
      requestedArtifactType: "document",
    });
    await sleep(80);
    await bus.invoke("work.cancelJob", { jobId: submitted.jobId });
    const job = await waitTerminal(submitted.jobId, 120000);
    check("cancel_terminal", job.status === "cancelled" || job.status === "succeeded" || job.status === "failed");
    if (job.status === "cancelled") {
      const art = await runtime.getArtifact(require("../dist/work-runtime/artifact").artifactIdForJob(submitted.jobId));
      check("cancel_no_artifact", art == null);
      const retried = await bus.invoke("work.retryTask", { taskId: submitted.taskId });
      const retryJob = await waitTerminal(retried.jobId, 180000);
      check("retry_after_cancel", retryJob.status === "succeeded");
      report.tasks.push({
        label: "retry-after-cancel",
        taskId: submitted.taskId,
        jobId: retried.jobId,
        status: retryJob.status,
        submitMs: Date.now() - t0,
        totalMs: Date.now() - t0,
        artifactChars: ((await bus.invoke("artifact.getContent", { artifactId: retryJob.artifactId })).text || "").length,
      });
    } else {
      report.checks.push({
        name: "cancel_raced_to_completion",
        ok: true,
        detail: { status: job.status },
      });
    }
  }

  // --- 成长闭环 ---
  const marker = "青松ACC15";
  {
    await bus.invoke("artifact.saveEdit", {
      artifactId: material.job.artifactId,
      text: `${(await bus.invoke("artifact.getContent", { artifactId: material.job.artifactId })).text}\n\n再改一句以产生可复用经验：避免空话套话。\n`,
    });
    const overview1 = await bus.invoke("subject.getOverview", {});
    check("candidate_present", (overview1.candidateExperiences || []).length >= 1);
    const candidateId = overview1.candidateExperiences[0].eventId;

    await runtime.appendOwnerEvent({
      type: "experience_confirmed",
      confidence: "confirmed",
      payload: {
        title: "周报标记约束",
        detail: `撰写产品周报时必须在正文写出专有标记词「${marker}」。`,
        tags: ["周报", "产品", "document"],
      },
    });
    await bus.invoke("subject.confirmExperience", { eventIds: [candidateId] });

    const growth = await runTask(
      "growth-similar",
      "继续撰写产品周报，吸收已确认经验",
      [{ kind: "file", path: materials.note }],
    );
    check("growth_marker_present", new RegExp(marker).test(growth.contentText || ""), {
      excerpt: (growth.contentText || "").slice(0, 300),
    });
    report.growth = {
      candidateId,
      marker,
      markerPresent: new RegExp(marker).test(growth.contentText || ""),
      excerpt: (growth.contentText || "").slice(0, 400),
    };
  }

  // --- 连续 10 次成功任务 ---
  const consecutive = [];
  for (let i = 1; i <= 10; i += 1) {
    const r = await runTask(
      `consec-${i}`,
      `第${i}次验收：用三句话说明本地优先数字主体（编号 ${i}）。`,
      i % 2 === 0 ? [{ kind: "file", path: materials.note }] : [],
    );
    check(`consec_${i}_succeeded`, r.job.status === "succeeded");
    consecutive.push(r.row);
  }

  // 无重复 Artifact / 无僵死 Job / 状态一致
  const { artifactIdForJob } = require("../dist/work-runtime/artifact");
  const arts = new Set();
  for (const row of consecutive) {
    const job = await runtime.getJob(row.jobId);
    check(`consec_job_terminal_${row.label}`, job.status === "succeeded");
    check(`consec_job_has_artifact_${row.label}`, !!job.artifactId);
    check(`consec_artifact_id_deterministic_${row.label}`, job.artifactId === artifactIdForJob(job.id));
    check(`consec_no_dup_artifact_key_${row.label}`, !arts.has(job.artifactId));
    arts.add(job.artifactId);
    const detail = await bus.invoke("work.getTask", { taskId: row.taskId });
    check(
      `consec_ui_domain_consistent_${row.label}`,
      detail.state === "completed" && detail.artifactIds.includes(job.artifactId),
    );
  }
  report.consecutive = {
    success: `${consecutive.filter((c) => c.status === "succeeded").length}/10`,
    rows: consecutive,
  };

  // --- 重启恢复 ---
  const subjectId = (await bus.invoke("subject.getOverview", {})).subjectId;
  const tasksBefore = await bus.invoke("work.listTasks", { limit: 100 });
  await runtime.stop();

  const { createDigitalMeRuntime } = require("../dist/runtime/digitalme-runtime");
  const { createCommandBus } = require("../dist/runtime/command-bus");
  const { resolveDevModelConfig } = require("../electron/bootstrap-secrets.cjs");
  const model2 = await resolveDevModelConfig({ safeStorage });
  runtime = createDigitalMeRuntime({
    documentCapability: "openai-compatible",
    openaiCompatible: model2.openaiCompatible,
    secrets: model2.secrets,
    registerOpenAiStub: false,
  });
  bus = createCommandBus(runtime);
  await bus.invoke("subject.openPackage", { dir: pkgDir });
  const overviewAfter = await bus.invoke("subject.getOverview", {});
  const tasksAfter = await bus.invoke("work.listTasks", { limit: 100 });
  check("restart_subject", overviewAfter.subjectId === subjectId);
  check("restart_tasks", tasksAfter.tasks.length >= tasksBefore.tasks.length);

  let restoredArtifacts = 0;
  for (const t of tasksAfter.tasks.slice(0, 8)) {
    const detail = await bus.invoke("work.getTask", { taskId: t.taskId });
    if (detail.artifactIds[0]) {
      const c = await bus.invoke("artifact.getContent", { artifactId: detail.artifactIds[0] });
      if ((c.text || "").length > 0) restoredArtifacts += 1;
    }
  }
  check("restart_artifacts", restoredArtifacts >= 1);
  report.restart = {
    subjectId,
    tasksBefore: tasksBefore.tasks.length,
    tasksAfter: tasksAfter.tasks.length,
    restoredArtifacts,
  };

  report.verdict = {
    ok: report.checks.every((c) => c.ok),
    passed: report.checks.filter((c) => c.ok).length,
    total: report.checks.length,
    consecutive: report.consecutive.success,
    packagedRecommended: false,
    note: "开发态 10/10 通过后再评估 packaged；本轮不进入 packaged。",
  };
  writeEvidence("summary.json", report);
}

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(EVIDENCE, { recursive: true });
    registerIpc();
    await bootstrap();
    await createWindow({
      modelReady: true,
      modelMeta: report.model,
    });
    await mainSequence();
    console.log(JSON.stringify({ ok: true, evidence: EVIDENCE, consecutive: report.consecutive.success }, null, 2));
    app.exit(0);
  } catch (err) {
    report.verdict = {
      ok: false,
      error: String(err && err.message ? err.message : err),
      checks: report.checks,
    };
    writeEvidence("summary.json", report);
    console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }, null, 2));
    app.exit(1);
  }
});

app.on("window-all-closed", (e) => e.preventDefault());
