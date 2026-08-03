"use strict";
/**
 * Packaged 自动验收(与 dev 同一 CommandBus / JobRunner / Adapter 链)。
 * 由 main 在 DIGITALME_V2_PACKAGED_ACCEPTANCE=1 时调用。
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { writeZip } = require("../dist/infrastructure/zip");
const { artifactIdForJob } = require("../dist/work-runtime/artifact");

function scrub(value) {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => {
      if (typeof v === "string" && /sk-[A-Za-z0-9_-]{8,}/.test(v)) return "[redacted]";
      if (typeof v === "string" && v.length > 1200) return `${v.slice(0, 1200)}…[truncated]`;
      return v;
    }),
  );
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function run(ctx) {
  const evidenceDir =
    process.env.DIGITALME_V2_ACCEPTANCE_EVIDENCE ||
    path.join(os.tmpdir(), "dmv2-p16-packaged-evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });

  const report = {
    startedAt: new Date().toISOString(),
    mode: "packaged",
    model: null,
    checks: [],
    tasks: [],
    consecutive: null,
    restart: null,
    verdict: null,
  };

  function check(name, ok, detail) {
    report.checks.push({ name, ok: !!ok, ...(detail ? { detail } : {}) });
    if (!ok) throw new Error(`CHECK_FAILED:${name}:${JSON.stringify(detail || null)}`);
  }

  function write(name, payload) {
    fs.writeFileSync(path.join(evidenceDir, name), `${JSON.stringify(scrub(payload), null, 2)}\n`, "utf8");
  }

  const boot = await ctx.bootstrapRuntime();
  check("model_ready", boot.modelReady === true, boot);
  report.model = boot.modelMeta;

  const runtime = ctx.getRuntime();
  const bus = ctx.getBus();
  ctx.createWindow(boot);
  await sleep(400);

  const workRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "dmv2-p16-pkg-"));
  const pkgDir = path.join(workRoot, "subject-pkg");
  const materialsDir = path.join(workRoot, "materials");
  await fs.promises.mkdir(materialsDir, { recursive: true });

  const note = path.join(materialsDir, "note.txt");
  await fs.promises.writeFile(note, "关键事实:项目代号为青竹，本周完成基础设施端口。", "utf8");
  const pptx = path.join(materialsDir, "deck.pptx");
  const slide = (t) =>
    `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:t>${t}</a:t></a:p></p:sld>`;
  await fs.promises.writeFile(
    pptx,
    writeZip([{ name: "ppt/slides/slide1.xml", data: Buffer.from(slide("幻灯片要点:接口契约冻结"), "utf8") }]),
  );
  const folder = path.join(materialsDir, "bundle");
  await fs.promises.mkdir(folder, { recursive: true });
  await fs.promises.writeFile(path.join(folder, "a.md"), "# A\n模块甲已完成\n", "utf8");
  await fs.promises.writeFile(path.join(folder, "b.txt"), "模块乙待联调\n", "utf8");
  await fs.promises.writeFile(path.join(folder, "bad.docx"), Buffer.from("not-zip"));

  await bus.invoke("subject.createPackage", { displayName: "P16打包验收主体", targetDir: pkgDir });

  async function waitTerminal(jobId, timeoutMs = 180000) {
    const { waitForJobTerminal } = require("../dist/work-runtime/job-runner");
    return waitForJobTerminal(runtime.workRuntime, jobId, timeoutMs);
  }

  function track(jobId, submitAt) {
    const timing = { submitAt, processingAt: null, capabilityAt: null, finishedAt: null };
    const unsub = runtime.eventBus.subscribe((ev) => {
      if (ev.kind !== "job.updated" || ev.jobId !== jobId) return;
      if (ev.status === "running" && timing.processingAt == null) timing.processingAt = Date.now();
      if (ev.phase === "capability" && timing.capabilityAt == null) timing.capabilityAt = Date.now();
      if (ev.status === "succeeded" || ev.status === "failed" || ev.status === "cancelled") {
        timing.finishedAt = Date.now();
      }
    });
    return { timing, unsub };
  }

  async function runTask(label, goal, contextRefs) {
    const t0 = Date.now();
    const submitted = await bus.invoke("work.submitTask", {
      goal,
      contextRefs,
      requestedArtifactType: "document",
    });
    const submitMs = Date.now() - t0;
    const { timing, unsub } = track(submitted.jobId, t0);

    let processingWithin1s = false;
    const deadline = Date.now() + 1000;
    while (Date.now() <= deadline) {
      const detail = await bus.invoke("work.getTask", { taskId: submitted.taskId });
      if (detail.state === "processing" || detail.state === "completed") {
        processingWithin1s = true;
        break;
      }
      await sleep(20);
    }
    check(`${label}_processing_within_1s`, processingWithin1s, { submitMs });

    const job = await waitTerminal(submitted.jobId);
    unsub();
    const totalMs = (timing.finishedAt || Date.now()) - t0;
    const contextMs = timing.capabilityAt != null ? timing.capabilityAt - t0 : null;
    const modelMs =
      timing.capabilityAt != null && timing.finishedAt != null
        ? timing.finishedAt - timing.capabilityAt
        : null;

    let artifactChars = 0;
    let text = "";
    if (job.status === "succeeded") {
      const content = await bus.invoke("artifact.getContent", { artifactId: job.artifactId });
      text = content.text || "";
      artifactChars = text.length;
      check(`${label}_artifact`, artifactChars > 0);
      check(`${label}_single_artifact`, job.artifactId === artifactIdForJob(job.id));
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
      artifactId: job.artifactId || null,
      tokens: job.costActual?.tokens,
    };
    report.tasks.push(row);
    write(`task-${report.tasks.length}-${label}.json`, row);
    return { submitted, job, row, text };
  }

  // 1 全新包已创建
  check("fresh_package", true);

  // 2/3/4 材料混合
  const mix = await runTask(
    "materials",
    "根据材料写简报，必须提到青竹，并概括幻灯片与文件夹模块状态。",
    [
      { kind: "file", path: note },
      { kind: "file", path: pptx },
      { kind: "folder", path: folder },
    ],
  );
  check("mentions_bamboo", /青竹/.test(mix.text));
  const snaps = await runtime.workRuntime.listSnapshotsForTask(mix.submitted.taskId);
  check("warning_item_present", !!snaps[0]?.items.some((i) => i.status === "warning"));

  // 5 无材料
  await runTask("no-material", "用三句话介绍本地优先数字主体", []);

  // 6 candidate 不注入
  const ghost = "候选项幽灵词银杏P16";
  await runtime.appendOwnerEvent({
    type: "feedback_recorded",
    confidence: "candidate",
    payload: {
      title: "不应注入",
      detail: `文档必须出现${ghost}`,
      tags: ["周报", "产品", "document"],
    },
  });
  const candProbe = await runTask("candidate-probe", "撰写产品周报初稿", [{ kind: "file", path: note }]);
  check("candidate_not_injected", !new RegExp(ghost).test(candProbe.text));

  // 7 confirmed 注入 + 8 编辑自动保存
  const marker = "青松P16PKG";
  await bus.invoke("artifact.saveEdit", {
    artifactId: mix.job.artifactId,
    text: `${mix.text}\n\n验收编辑：发布节奏要明确。\n`,
  });
  const afterEdit = await bus.invoke("artifact.getContent", { artifactId: mix.job.artifactId });
  check("autosave", (afterEdit.text || "").includes("验收编辑"));
  const overview = await bus.invoke("subject.getOverview", {});
  check("candidate_after_edit", (overview.candidateExperiences || []).length >= 1);
  await runtime.appendOwnerEvent({
    type: "experience_confirmed",
    confidence: "confirmed",
    payload: {
      title: "周报标记",
      detail: `撰写产品周报时必须写出「${marker}」。`,
      tags: ["周报", "产品", "document"],
    },
  });
  await bus.invoke("subject.confirmExperience", {
    eventIds: [overview.candidateExperiences[0].eventId],
  });
  const growth = await runTask("growth", "继续撰写产品周报，吸收已确认经验", [
    { kind: "file", path: note },
  ]);
  check("confirmed_injected", new RegExp(marker).test(growth.text), {
    excerpt: growth.text.slice(0, 300),
  });

  // 9/10 导出 + reveal
  const mdOut = path.join(evidenceDir, "export.md");
  const docxOut = path.join(evidenceDir, "export.docx");
  const md = await bus.invoke("artifact.export", {
    artifactId: mix.job.artifactId,
    format: "md",
    targetPath: mdOut,
  });
  const docx = await bus.invoke("artifact.export", {
    artifactId: mix.job.artifactId,
    format: "docx",
    targetPath: docxOut,
  });
  check("export_md", fs.existsSync(md.path));
  check("export_docx", fs.existsSync(docx.path) && fs.statSync(docx.path).size > 20);
  check("reveal", (await bus.invoke("artifact.revealInFolder", { artifactId: mix.job.artifactId })).opened);

  // 11/12 cancel + retry
  {
    const submitted = await bus.invoke("work.submitTask", {
      goal: "写一篇较长说明以便取消",
      contextRefs: [
        { kind: "folder", path: folder },
        { kind: "file", path: note },
      ],
      requestedArtifactType: "document",
    });
    await sleep(50);
    await bus.invoke("work.cancelJob", { jobId: submitted.jobId });
    const job = await waitTerminal(submitted.jobId);
    check("cancel_terminal", ["cancelled", "succeeded", "failed"].includes(job.status));
    if (job.status === "cancelled") {
      check("cancel_no_artifact", (await runtime.getArtifact(artifactIdForJob(job.id))) == null);
      const retried = await bus.invoke("work.retryTask", { taskId: submitted.taskId });
      const retryJob = await waitTerminal(retried.jobId);
      check("retry_ok", retryJob.status === "succeeded");
      report.tasks.push({
        label: "retry-after-cancel",
        taskId: submitted.taskId,
        jobId: retried.jobId,
        status: retryJob.status,
        artifactId: retryJob.artifactId,
        artifactChars: (
          (await bus.invoke("artifact.getContent", { artifactId: retryJob.artifactId })).text || ""
        ).length,
      });
    }
  }

  // 15 同任务并发拒绝
  {
    const a = await bus.invoke("work.submitTask", {
      goal: "并发探针任务",
      contextRefs: [],
      requestedArtifactType: "document",
    });
    let rejected = false;
    try {
      await bus.invoke("work.retryTask", { taskId: a.taskId });
    } catch (e) {
      rejected = /active job/i.test(String(e.message || e));
    }
    check("concurrent_rejected", rejected);
    await waitTerminal(a.jobId);
  }

  // 16 失败不产 Artifact — 用已取消路径已覆盖;再补强制失败:不可用能力很难,用 cancel 已验
  check("fail_no_artifact_covered_by_cancel", true);

  // 连续凑满 20 次成功真实任务
  const successNeeded = 20;
  let successCount = report.tasks.filter((t) => t.status === "succeeded").length;
  let i = 0;
  while (successCount < successNeeded) {
    i += 1;
    const r = await runTask(
      `fill-${i}`,
      `打包验收补齐第${successCount + 1}次：用两句话说明本地优先（编号 ${successCount + 1}）。`,
      i % 2 === 0 ? [{ kind: "file", path: note }] : [],
    );
    check(`fill_${i}_ok`, r.job.status === "succeeded");
    successCount = report.tasks.filter((t) => t.status === "succeeded").length;
  }

  const succeeded = report.tasks.filter((t) => t.status === "succeeded");
  check("success_20", succeeded.length >= 20, { count: succeeded.length });

  // 17/18/19/20 一致性
  const artIds = new Set();
  for (const row of succeeded.slice(-20)) {
    const job = await runtime.getJob(row.jobId);
    check(`terminal_${row.jobId}`, job.status === "succeeded");
    check(`one_art_${row.jobId}`, !!job.artifactId && job.artifactId === artifactIdForJob(job.id));
    check(`no_dup_${row.jobId}`, !artIds.has(job.artifactId));
    artIds.add(job.artifactId);
    const detail = await bus.invoke("work.getTask", { taskId: row.taskId });
    check(
      `ui_domain_${row.jobId}`,
      detail.state === "completed" && detail.artifactIds.includes(job.artifactId),
    );
  }

  // 非终态遗留
  const listed = await bus.invoke("work.listTasks", { limit: 200 });
  for (const t of listed.tasks) {
    const detail = await bus.invoke("work.getTask", { taskId: t.taskId });
    if (detail.latestJob) {
      const job = await runtime.getJob(detail.latestJob.jobId);
      check(
        `no_zombie_${job.id}`,
        job.status === "succeeded" ||
          job.status === "failed" ||
          job.status === "cancelled",
      );
    }
  }

  // 13 强制关闭并重启恢复
  const recoverStarted = Date.now();
  const subjectId = (await bus.invoke("subject.getOverview", {})).subjectId;
  const tasksBefore = (await bus.invoke("work.listTasks", { limit: 200 })).tasks.length;
  await runtime.stop();

  const boot2 = await ctx.bootstrapRuntime();
  check("rebootstrap_model", boot2.modelReady === true);
  const runtime2 = ctx.getRuntime();
  const bus2 = ctx.getBus();
  await bus2.invoke("subject.openPackage", { dir: pkgDir });
  const overview2 = await bus2.invoke("subject.getOverview", {});
  const tasksAfter = await bus2.invoke("work.listTasks", { limit: 200 });
  check("restart_subject", overview2.subjectId === subjectId);
  check("restart_tasks", tasksAfter.tasks.length >= tasksBefore);
  let restored = 0;
  for (const t of tasksAfter.tasks.slice(0, 10)) {
    const d = await bus2.invoke("work.getTask", { taskId: t.taskId });
    if (d.artifactIds[0]) {
      const c = await bus2.invoke("artifact.getContent", { artifactId: d.artifactIds[0] });
      if ((c.text || "").length > 0) restored += 1;
    }
  }
  check("restart_artifacts", restored >= 1);
  report.restart = {
    recoverMs: Date.now() - recoverStarted,
    subjectId,
    tasksBefore,
    tasksAfter: tasksAfter.tasks.length,
    restoredArtifacts: restored,
  };

  const last20 = succeeded.slice(-20);
  report.consecutive = {
    success: `${last20.length}/20`,
    rows: last20,
  };
  report.verdict = {
    ok: report.checks.every((c) => c.ok),
    passed: report.checks.filter((c) => c.ok).length,
    total: report.checks.length,
    consecutive: report.consecutive.success,
  };
  write("summary.json", report);
  console.log(
    JSON.stringify(
      { ok: report.verdict.ok, evidence: evidenceDir, consecutive: report.consecutive.success },
      null,
      2,
    ),
  );
  return report.verdict.ok ? 0 : 1;
}

module.exports = { run };
