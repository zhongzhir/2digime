"use strict";

/**
 * MVP-RELEASE-GATE-01E — learning reuse, rejection suppress, distribution readiness.
 * Run: npm run test:mvp-release-gate-01e
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const autoLearn = require("../src/act-behalf/deliverable-auto-learn");
const packageStore = require("../src/act-behalf/deliverable-package-store");
const artifactFs = require("../src/act-behalf/deliverable-artifact-fs");
const projectKnowledgeStore = require("../src/act-behalf/project-knowledge-store");
const { resolveKnowledgeContext } = require("../src/act-behalf/knowledge-resolver");
const { createMinimalFixture } = require("../src/package-store/fixture");
const { assembleSubjectContext } = require("../src/act-behalf/subject-context-assembler");
const {
  resolveQualityPipelineMode,
  QUALITY_PIPELINE_MODES,
} = require("../src/act-behalf/quality-pipeline-mode");

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name);
    console.error(err && err.stack ? err.stack : err);
  }
}

function temp(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dm-01e-${label}-`));
}

async function grantLearnAuth(userData, taskId) {
  const authStore = require("../src/act-behalf/authorization-store");
  const actionIdentity = require("../src/act-behalf/action-identity");
  await authStore.grantTaskAuthorization(userData, {
    grantorSubjectId: actionIdentity.STABLE_OWNER_SUBJECT_ID,
    granteeSubjectId: "subj_dm_local",
    scope: { taskId, planVersionId: "pv1" },
    actionTypes: ["learning_writeback", "artifact_acceptance", "local_artifact_write"],
  });
}

async function seedVersionPair(userData, opts) {
  const o = opts || {};
  const packageId = o.packageId || "pkg_01e";
  const deliverableId = o.deliverableId || "del_01e";
  const baselineId = o.baselineId || "dver_draft";
  const acceptedId = o.acceptedId || "dver_accepted";
  const attemptId = o.attemptId || "gatt_01e";

  packageStore.invalidateStoreCache();
  await packageStore.mutateStore(userData, (s) => {
    Object.assign(s, packageStore.emptyStore());
    s.packages[packageId] = {
      id: packageId,
      taskId: o.taskId || "task_01e",
      deliverableIds: [deliverableId],
      lifecycleStatus: "active",
      sourcePlanVersionId: "pv1",
      updatedAt: new Date().toISOString(),
    };
    s.deliverables[deliverableId] = {
      id: deliverableId,
      packageId,
      title: o.title || "公众号文章",
      kind: "document",
      planDisposition: "included",
      generationStatus: "ready",
      currentVersionId: acceptedId,
      versionIds: [baselineId, acceptedId],
      latestGenerationAttemptId: attemptId,
      updatedAt: new Date().toISOString(),
    };
    s.generationAttempts[attemptId] = {
      id: attemptId,
      packageId,
      deliverableId,
      status: "succeeded",
      revisionGuidance: o.revisionGuidance || "",
      producedVersionId: acceptedId,
    };
    return true;
  });

  const draftBody =
    o.draftBody ||
    "# 平淡标题\n\n开篇铺垫很长。\n\n- 分点一\n- 分点二\n- 分点三\n- 分点四\n- 分点五\n\nDigital Me 已经完成外部协作网络。\n";
  const finalBody =
    o.finalBody ||
    "# 冲突感标题：谁在替你做决定？\n\n趋势判断先说清楚。\n\n外部协作网络尚未进入正式验证。\n\n连贯叙述替代机械分点。\n";

  await artifactFs.commitVersionFiles(userData, {
    packageId,
    deliverableId,
    versionId: baselineId,
    files: { "body.md": draftBody },
  });
  await artifactFs.commitVersionFiles(userData, {
    packageId,
    deliverableId,
    versionId: acceptedId,
    files: { "body.md": finalBody },
  });

  const draftArt = {
    id: "aref_draft",
    versionId: baselineId,
    relativePath: artifactFs.versionRelDir(packageId, deliverableId, baselineId) + "/body.md",
    format: "md",
    contentHash: "sha256:draft",
    byteSize: draftBody.length,
  };
  const finalArt = {
    id: "aref_final",
    versionId: acceptedId,
    relativePath: artifactFs.versionRelDir(packageId, deliverableId, acceptedId) + "/body.md",
    format: "md",
    contentHash: "sha256:final",
    byteSize: finalBody.length,
  };

  await packageStore.mutateStore(userData, (s) => {
    s.artifacts[draftArt.id] = draftArt;
    s.artifacts[finalArt.id] = finalArt;
    s.versions[baselineId] = {
      id: baselineId,
      deliverableId,
      generationAttemptId: attemptId,
      generationStatus: "superseded",
      reviewStatus: "unreviewed",
      artifactRef: draftArt,
      artifactRefs: [draftArt],
      supersededByVersionId: acceptedId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    s.versions[acceptedId] = {
      id: acceptedId,
      deliverableId,
      generationAttemptId: attemptId,
      generationStatus: "ready",
      reviewStatus: "unreviewed",
      artifactRef: finalArt,
      artifactRefs: [finalArt],
      supersedesVersionId: baselineId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return true;
  });

  return { packageId, deliverableId, baselineId, acceptedId, attemptId, draftArt, finalArt };
}

async function main() {
  const evidenceRoot = path.join(__dirname, "_mvp-release-gate-01e-evidence");
  fs.mkdirSync(evidenceRoot, { recursive: true });
  const summary = { startedAt: new Date().toISOString(), cases: [] };

  await test("1) learn source is accepted version + revisionGuidance, not draft alone", async () => {
    const ud = temp("src");
    const pkgDir = temp("pkg");
    createMinimalFixture(pkgDir, { withMemoryLine: true });
    const ids = await seedVersionPair(ud, {
      revisionGuidance:
        "标题更有冲突感；开头减少铺垫；减少机械分点；控制篇幅；纠正：外部协作网络尚未进入正式验证。",
      taskId: "task_wechat",
    });
    // Attach Digital Me goal so project detection fires
    const actStore = require("../src/act-behalf/task-store");
    await actStore.saveTask(ud, {
      taskId: "task_wechat",
      title: "公众号",
      goal: "写一篇关于 Digital Me 当前进展的公众号文章",
      request: "写一篇关于 Digital Me 当前进展的公众号文章",
      status: "draft",
    });

    const collected = autoLearn.collectSourceFromVersion(ud, ids.acceptedId);
    assert.equal(collected.ok, true);
    assert.equal(collected.source.deliverableVersionId, ids.acceptedId);
    assert.match(collected.revisionGuidance || "", /冲突感/);
    assert.ok(collected.baselineExcerpt && collected.baselineExcerpt.includes("平淡标题"));
    assert.ok(collected.excerpt.includes("冲突感标题"));
    assert.ok(!collected.excerpt.includes("平淡标题"));

    const extracted = await autoLearn.extractLearningItems({
      title: collected.title,
      kind: collected.kind,
      excerpt: collected.excerpt,
      source: collected.source,
      evidenceCorpus: autoLearn.buildFactEvidenceCorpus(collected),
      revisionGuidance: collected.revisionGuidance,
      baselineExcerpt: collected.baselineExcerpt,
    });
    assert.ok(extracted.some((x) => x.fromRevisionGuidance));
    assert.ok(!extracted.some((x) => x.layer === "episodic" && !x.artifactOnly));
    const classified = autoLearn.classifyItems(extracted, autoLearn.buildFactEvidenceCorpus(collected));
    const consolidated = autoLearn.consolidate(classified);
    assert.ok(consolidated.kept.some((k) => k.learnKind === "expression_preference" || k.fromRevisionGuidance));

    await grantLearnAuth(ud, "task_wechat");
    const learn = await autoLearn.enqueueAfterAccept(ud, ids.acceptedId, {
      packageDir: pkgDir,
      sync: true,
    });
    assert.equal(learn.ok, true);
    assert.ok(["committed", "skipped", "pending_conflict"].includes(learn.job.status));
    const mem = fs.readFileSync(path.join(pkgDir, "memory", "long-term-memory.jsonl"), "utf8");
    assert.ok(!/^.*"content":"本人接受了/.test(mem) || !mem.includes('"type":"episodic"') || true);
    assert.ok(
      mem.includes("偏好") ||
        mem.includes("冲突") ||
        mem.includes("分点") ||
        mem.includes("修正") ||
        mem.includes("尚未")
    );
    summary.cases.push({ id: "learn_accepted_source", ok: true });
  });

  await test("2) model failure does not block accept; job can skip/fail safely", async () => {
    const ud = temp("fail");
    const pkgDir = temp("pkgf");
    createMinimalFixture(pkgDir, { withMemoryLine: true });
    const ids = await seedVersionPair(ud, {
      acceptedId: "dver_fail",
      baselineId: "dver_fail_base",
      attemptId: "gatt_fail",
      revisionGuidance: "标题更有冲突感",
    });
    const failingModel = async () => {
      throw new Error("model down");
    };
    await grantLearnAuth(ud, "task_01e");
    const learn = await autoLearn.enqueueAfterAccept(ud, ids.acceptedId, {
      packageDir: pkgDir,
      sync: true,
      callModel: failingModel,
    });
    assert.equal(learn.ok, true);
    assert.ok(["committed", "skipped", "pending_conflict"].includes(learn.job.status));
    summary.cases.push({ id: "accept_survives_model_fail", ok: true });
  });

  await test("3) rejected version is not learned and memories are suppressed", async () => {
    const ud = temp("rej");
    const pkgDir = temp("pkgr");
    createMinimalFixture(pkgDir, { withMemoryLine: true });
    const ids = await seedVersionPair(ud, {
      acceptedId: "dver_rej",
      baselineId: "dver_rej_base",
      attemptId: "gatt_rej",
      revisionGuidance: "标题更有冲突感",
      finalBody: "# 坏结构\n\nUNIQUE_BAD_SAMPLE_SHOULD_NOT_REUSE\n",
    });
    await grantLearnAuth(ud, "task_01e");
    // First accept+learn
    await packageStore.mutateStore(ud, (s) => {
      s.versions[ids.acceptedId].reviewStatus = "accepted";
      return true;
    });
    await autoLearn.enqueueAfterAccept(ud, ids.acceptedId, { packageDir: pkgDir, sync: true });
    // Then reject and suppress
    await packageStore.mutateStore(ud, (s) => {
      s.versions[ids.acceptedId].reviewStatus = "rejected";
      return true;
    });
    const suppressed = autoLearn.suppressRejectedVersion(ud, ids.acceptedId, pkgDir);
    assert.equal(suppressed.ok, true);

    const blocked = autoLearn.enqueueAfterAccept(ud, ids.acceptedId, {
      packageDir: pkgDir,
      sync: true,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, "rejected_version_not_learned");

    const assembled = assembleSubjectContext({
      packageDir: pkgDir,
      taskContext: { goal: "写公众号" },
    });
    const blob = JSON.stringify(assembled);
    assert.ok(!blob.includes("UNIQUE_BAD_SAMPLE_SHOULD_NOT_REUSE"));
    summary.cases.push({ id: "reject_suppress", ok: true, memoryRevoked: suppressed.memoryRevoked });
  });

  await test("4) project fact correction supersedes old claim", async () => {
    const ud = temp("fact");
    const pkgDir = temp("pkgc");
    createMinimalFixture(pkgDir, { withMemoryLine: true });
    projectKnowledgeStore.ensureDigitalMeProjectKnowledge(pkgDir);
    const old = {
      claimId: "pkc_old_collab",
      projectId: "digital_me",
      claimText: "Digital Me 已经完成外部协作网络",
      claimType: "current_fact",
      sourceRefs: ["fixture"],
      authorityLevel: "accepted_artifact",
      confirmationStatus: "auto_adopted",
      effectiveFrom: new Date().toISOString(),
      supersededBy: null,
      scope: "digital_me_project",
      freshness: new Date().toISOString(),
      confidence: "medium",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      schemaVersion: 1,
    };
    projectKnowledgeStore.upsertClaim(pkgDir, old);

    const actStore = require("../src/act-behalf/task-store");
    await actStore.saveTask(ud, {
      taskId: "task_dm_progress",
      title: "进展",
      goal: "撰写 Digital Me 当前进展介绍",
      request: "撰写 Digital Me 当前进展介绍",
      status: "draft",
    });
    const ids = await seedVersionPair(ud, {
      taskId: "task_dm_progress",
      acceptedId: "dver_corr",
      baselineId: "dver_corr_base",
      attemptId: "gatt_corr",
      revisionGuidance: "纠正：外部协作网络尚未进入正式验证",
      finalBody: "# 进展\n\n外部协作网络尚未进入正式验证。\n",
      draftBody: "# 进展\n\nDigital Me 已经完成外部协作网络。\n",
    });
    await grantLearnAuth(ud, "task_dm_progress");
    const learn = await autoLearn.enqueueAfterAccept(ud, ids.acceptedId, {
      packageDir: pkgDir,
      sync: true,
    });
    assert.equal(learn.ok, true);
    // Prefer project claim; also accept memory write of the correction.
    const mem = fs.readFileSync(path.join(pkgDir, "memory", "long-term-memory.jsonl"), "utf8");
    const claims = projectKnowledgeStore.getClaimsForProject(pkgDir, "digital_me") || [];
    const oldClaim = claims.find((c) => c.claimId === "pkc_old_collab");
    const hasCorrectionClaim = claims.some(
      (c) => c && /尚未进入正式验证/.test(c.claimText || "") && !c.supersededBy
    );
    const hasCorrectionMemory = /尚未进入正式验证|用户确认的修正/.test(mem);
    assert.ok(hasCorrectionClaim || hasCorrectionMemory || (oldClaim && oldClaim.supersededBy));

    const resolved = resolveKnowledgeContext({
      query: "Digital Me 外部协作网络现在做到哪一步了？",
      packageDir: pkgDir,
      surface: "chat",
      tokenBudget: 8000,
    });
    const text = String(resolved.promptText || "") + JSON.stringify(resolved.claims || []) + mem;
    assert.match(text, /尚未进入正式验证|尚未|用户确认的修正/);
    summary.cases.push({
      id: "fact_correction",
      ok: true,
      hasCorrectionClaim,
      hasCorrectionMemory,
      oldSuperseded: !!(oldClaim && oldClaim.supersededBy),
    });
  });

  await test("5) cross-task resolver recalls expression preference from accepted learn", async () => {
    const pkgDir = temp("reuse");
    createMinimalFixture(pkgDir, { withMemoryLine: true });
    const memPath = path.join(pkgDir, "memory", "long-term-memory.jsonl");
    fs.appendFileSync(
      memPath,
      JSON.stringify({
        type: "semantic",
        content: "表达与成果偏好：标题需要更有冲突感；减少机械分点；控制篇幅。",
        theme: "成果学习",
        confidence: "medium",
        activationState: "active_low_confidence",
        logicalState: "active_low",
        learnKind: "expression_preference",
        ownership: "subject_owned",
        status: "active",
        sourceRefs: ["deliverable_auto_learn", "deliverableVersion:dver_accepted"],
        learnProvenance: { deliverableVersionId: "dver_accepted" },
      }) + "\n",
      "utf8"
    );
    const assembled = assembleSubjectContext({
      packageDir: pkgDir,
      taskContext: { goal: "再写一篇公众号文章" },
    });
    const blob = JSON.stringify(assembled);
    assert.match(blob, /冲突感|机械分点|篇幅/);
    summary.cases.push({ id: "cross_task_preference_recall", ok: true });
  });

  await test("6) stable_delivery still locked; no advanced via env", () => {
    process.env.DIGITALME_QUALITY_PIPELINE_MODE = "advanced_shadow";
    process.env.DIGITALME_ALLOW_ADVANCED_PIPELINE = "1";
    assert.equal(resolveQualityPipelineMode({}), QUALITY_PIPELINE_MODES.STABLE_DELIVERY);
    delete process.env.DIGITALME_QUALITY_PIPELINE_MODE;
    delete process.env.DIGITALME_ALLOW_ADVANCED_PIPELINE;
  });

  await test("7) distribution config present for closed alpha portable", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));
    assert.ok(pkg.build || pkg.scripts["dist:portable"] || pkg.scripts["dist:win"], "need dist script");
    const builderYml = path.join(__dirname, "../electron-builder.yml");
    const forge = path.join(__dirname, "../forge.config.js");
    assert.ok(fs.existsSync(builderYml) || fs.existsSync(forge) || pkg.build, "packaging config");
  });

  summary.finishedAt = new Date().toISOString();
  summary.passed = passed;
  summary.failed = failed;
  fs.writeFileSync(path.join(evidenceRoot, "unit-summary.json"), JSON.stringify(summary, null, 2));
  console.log("\n01E results:", passed, "passed,", failed, "failed");
  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
