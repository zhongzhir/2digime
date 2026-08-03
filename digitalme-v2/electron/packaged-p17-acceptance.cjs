"use strict";
/**
 * P1.7 packaged 验收:模型状态单源、修改成果版本链、Owner 原任务方向、连续 10 次真实任务。
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitJob(bus, taskId, timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const detail = await bus.invoke("work.getTask", { taskId });
    const job = detail.latestJob;
    if (job && (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled")) {
      return detail;
    }
    await sleep(400);
  }
  throw new Error(`job timeout for ${taskId}`);
}

function connectedFromCaps(caps) {
  return (caps.capabilities || []).some(
    (c) =>
      c.availability === "available" &&
      Array.isArray(c.outputArtifactTypes) &&
      c.outputArtifactTypes.includes("document"),
  );
}

/**
 * @param {{
 *   bootstrapRuntime: Function,
 *   getRuntime: Function,
 *   getBus: Function,
 *   getBootInfo: Function,
 *   getDeleteCredential: Function,
 *   app: import('electron').App,
 * }} deps
 */
async function run(deps) {
  const evidenceDir =
    process.env.DIGITALME_V2_P17_EVIDENCE ||
    path.resolve(__dirname, "..", "scripts", "_mvp-p17-owner-feedback-evidence");
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

  try {
    const boot = await deps.bootstrapRuntime();
    note("model_ready", boot.modelReady === true, { model: boot.modelMeta });

    const runtime = () => deps.getRuntime();
    const bus = () => deps.getBus();
    const pkgDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmv2-p17-pkg-"));
    await runtime().createPackage({ displayName: "P17验收主体", targetDir: pkgDir });

    let caps = await bus().invoke("capability.list", {});
    note("connected_from_capability_list", connectedFromCaps(caps), { capabilities: caps.capabilities });
    note(
      "fake_absent",
      !(caps.capabilities || []).some((c) => c.id === "cap_fake_document"),
      { capabilities: caps.capabilities },
    );

    // Owner 原任务初稿
    const ownerGoal =
      "撰写一篇 Digital Me 项目参加 AIGO 比赛的获奖报道，发布到公众号，约 500 字，需要介绍 Digital Me 的优势。";
    const ownerSubmit = await bus().invoke("work.submitTask", {
      goal: ownerGoal,
      contextRefs: [],
      requestedArtifactType: "document",
    });
    const ownerDetail = await waitJob(bus(), ownerSubmit.taskId);
    note("owner_draft_succeeded", ownerDetail.state === "completed", {
      state: ownerDetail.state,
      label: ownerDetail.userFacingLabel,
    });
    note(
      "owner_label_clean",
      ownerDetail.userFacingLabel === "已完成" && !ownerDetail.latestJob?.progressNote,
      { label: ownerDetail.userFacingLabel, note: ownerDetail.latestJob?.progressNote },
    );
    const ownerArtId = ownerDetail.artifactIds[0];
    note("owner_single_artifact", ownerDetail.artifactIds.length === 1 && !!ownerArtId);
    const ownerContent = await bus().invoke("artifact.getContent", { artifactId: ownerArtId });
    const ownerText = String(ownerContent.text || "");
    fs.writeFileSync(path.join(evidenceDir, "owner-draft.md"), ownerText, "utf8");
    note("owner_no_fake_marker", !/\(fake document\)/i.test(ownerText));
    note("owner_not_spec_sheet", !/API|接口契约|CapabilityRegistration|JobRunner/i.test(ownerText), {
      sample: ownerText.slice(0, 280),
    });
    note(
      "owner_news_direction",
      /AIGO|获奖|报道|公众号|Digital\s*Me|数字主体/i.test(ownerText) && ownerText.length > 120,
      { chars: ownerText.length, sample: ownerText.slice(0, 280) },
    );

    // 修改成果版本链
    const versionsBefore = ownerContent.versionCount;
    const revise = await bus().invoke("work.reviseArtifact", {
      taskId: ownerSubmit.taskId,
      artifactId: ownerArtId,
      revisionRequest:
        "请以获奖事实开篇，保持新闻报道结构，简要介绍 Digital Me 价值，不要写成技术规格说明书。",
    });
    const reviseDetail = await waitJob(bus(), ownerSubmit.taskId);
    note("revise_succeeded", reviseDetail.state === "completed" && revise.jobId, {
      state: reviseDetail.state,
      jobId: revise.jobId,
    });
    note("revise_same_artifact_count", reviseDetail.artifactIds.length === 1, {
      artifactIds: reviseDetail.artifactIds,
    });
    note("revise_same_artifact_id", reviseDetail.artifactIds[0] === ownerArtId);
    const afterRevise = await bus().invoke("artifact.getContent", { artifactId: ownerArtId });
    note("revise_version_increased", afterRevise.versionCount === versionsBefore + 1, {
      before: versionsBefore,
      after: afterRevise.versionCount,
    });
    const revisedText = String(afterRevise.text || "");
    fs.writeFileSync(path.join(evidenceDir, "owner-revised.md"), revisedText, "utf8");
    const oldVersion = await bus().invoke("artifact.getContent", {
      artifactId: ownerArtId,
      versionId: ownerContent.headVersionId,
    });
    note("old_version_readable", String(oldVersion.text || "").length > 0, {
      oldHead: ownerContent.headVersionId,
    });
    note("head_is_revised", afterRevise.headVersionId !== ownerContent.headVersionId);

    // 导出 head
    const mdPath = path.join(evidenceDir, "export-head.md");
    const exported = await bus().invoke("artifact.export", {
      artifactId: ownerArtId,
      format: "md",
      targetPath: mdPath,
    });
    note("export_head_ok", fs.existsSync(exported.path));
    const exportedText = fs.readFileSync(exported.path, "utf8");
    note("export_matches_head", exportedText.trim() === revisedText.trim());

    // 连续 10 次
    const rows = [];
    for (let i = 0; i < 10; i += 1) {
      const t0 = Date.now();
      const submitted = await bus().invoke("work.submitTask", {
        goal: `用两句话说明数字主体本地优先的好处。编号 ${i + 1}。文末写 REAL_OK_${i + 1}。`,
        contextRefs: [],
        requestedArtifactType: "document",
      });
      const detail = await waitJob(bus(), submitted.taskId);
      const artId = detail.artifactIds[0];
      const content = artId
        ? await bus().invoke("artifact.getContent", { artifactId: artId })
        : { text: "" };
      const text = String(content.text || "");
      const ok =
        detail.state === "completed" &&
        detail.artifactIds.length === 1 &&
        !/\(fake document\)/i.test(text) &&
        text.includes(`REAL_OK_${i + 1}`);
      rows.push({
        i: i + 1,
        ok,
        totalMs: Date.now() - t0,
        chars: text.length,
        label: detail.userFacingLabel,
        artifactId: artId,
      });
      note(`consecutive_${i + 1}`, ok, rows[rows.length - 1]);
    }

    // 重启恢复版本
    if (runtime()) await runtime().stop();
    const boot2 = await deps.bootstrapRuntime();
    note("restart_model_ready", boot2.modelReady === true);
    await runtime().openPackage({ dir: pkgDir });
    const restored = await bus().invoke("artifact.getContent", { artifactId: ownerArtId });
    note("restart_versions_restored", restored.versionCount >= 2, {
      versionCount: restored.versionCount,
    });

    // 删除凭证后能力同步不可用
    const del = deps.getDeleteCredential && deps.getDeleteCredential();
    if (typeof del === "function") {
      await del({});
      const boot3 = await deps.bootstrapRuntime();
      note("delete_boot_unready", boot3.modelReady === false);
      // 新 runtime 无 openai adapter
      caps = await bus().invoke("capability.list", {});
      note("delete_capability_disconnected", connectedFromCaps(caps) === false, {
        capabilities: caps.capabilities,
      });
    } else {
      note("delete_credential_ops", false, { reason: "missing_delete" });
    }

    const summary = {
      ok: checks.every((c) => c.ok),
      passed: checks.filter((c) => c.ok).length,
      total: checks.length,
      consecutive: `${rows.filter((r) => r.ok).length}/10`,
      ownerDraftChars: ownerText.length,
      ownerRevisedChars: revisedText.length,
      ownerDraftSample: ownerText.slice(0, 400),
      ownerRevisedSample: revisedText.slice(0, 400),
      rows,
      checks,
    };
    fs.writeFileSync(path.join(evidenceDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    return summary.ok ? 0 : 1;
  } catch (err) {
    const summary = {
      ok: false,
      passed: checks.filter((c) => c.ok).length,
      total: Math.max(checks.length, 1),
      error: String(err && err.message ? err.message : err),
      detail: err && err.detail ? err.detail : null,
      checks,
    };
    fs.writeFileSync(path.join(evidenceDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.error(JSON.stringify({ ok: false, error: summary.error }));
    return 1;
  }
}

module.exports = { run };
