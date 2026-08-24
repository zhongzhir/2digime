"use strict";
/**
 * Packaged 可见冒烟:启动窗口、创建包、真实任务、编辑导出、重启恢复。
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function run(ctx) {
  // DIGITALME-FIRST-VALUE-01：委托给首次价值走查模块（真实 main + preload + renderer + IPC + 窗口）。
  if (process.env.DIGITALME_V2_FIRST_VALUE_EVIDENCE === "1") {
    const firstValue = require(path.join(__dirname, "..", "scripts", "first-value-evidence.cjs"));
    return firstValue.runInSmoke(ctx);
  }
  const evidenceDir =
    process.env.DIGITALME_V2_SMOKE_EVIDENCE || path.join(os.tmpdir(), "dmv2-p16-smoke-evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });
  const boot = await ctx.bootstrapRuntime();
  if (!boot.modelReady) {
    console.error(JSON.stringify({ ok: false, error: "model_not_ready" }));
    return 1;
  }
  ctx.createWindow(boot);
  await sleep(600);

  const bus = ctx.getBus();
  const runtime = ctx.getRuntime();
  const workRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dmv2-p16-smoke-"));
  const pkgDir = path.join(workRoot, "pkg");
  const note = path.join(workRoot, "note.txt");
  await fs.promises.writeFile(note, "冒烟材料:青竹项目进展正常。", "utf8");

  await bus.invoke("subject.createPackage", { displayName: "P16冒烟主体", targetDir: pkgDir });
  const submitted = await bus.invoke("work.submitTask", {
    goal: "根据材料写三句话进展摘要，提到青竹",
    contextRefs: [{ kind: "file", path: note }],
    requestedArtifactType: "document",
  });
  const { waitForJobTerminal } = require("../dist/work-runtime/job-runner");
  const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId, 180000);
  if (job.status !== "succeeded") {
    console.error(JSON.stringify({ ok: false, error: "task_failed", status: job.status }));
    return 1;
  }
  const content = await bus.invoke("artifact.getContent", { artifactId: job.artifactId });
  await bus.invoke("artifact.saveEdit", {
    artifactId: job.artifactId,
    text: `${content.text}\n\n冒烟编辑句。\n`,
  });
  const md = await bus.invoke("artifact.export", {
    artifactId: job.artifactId,
    format: "md",
    targetPath: path.join(evidenceDir, "smoke.md"),
  });
  const docx = await bus.invoke("artifact.export", {
    artifactId: job.artifactId,
    format: "docx",
    targetPath: path.join(evidenceDir, "smoke.docx"),
  });
  await bus.invoke("artifact.revealInFolder", { artifactId: job.artifactId });

  const subjectId = (await bus.invoke("subject.getOverview", {})).subjectId;
  await runtime.stop();
  await ctx.bootstrapRuntime();
  const bus2 = ctx.getBus();
  await bus2.invoke("subject.openPackage", { dir: pkgDir });
  const opened = await bus2.invoke("subject.getOverview", {});
  const tasks = await bus2.invoke("work.listTasks", {});
  const ok =
    opened.subjectId === subjectId &&
    tasks.tasks.length >= 1 &&
    fs.existsSync(md.path) &&
    fs.existsSync(docx.path) &&
    /青竹/.test(content.text || "");

  const summary = {
    ok,
    subjectId,
    artifactChars: (content.text || "").length,
    tasks: tasks.tasks.length,
    md: md.path,
    docx: docx.path,
  };
  fs.writeFileSync(path.join(evidenceDir, "smoke-summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
  return ok ? 0 : 1;
}

module.exports = { run };
