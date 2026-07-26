"use strict";

/**
 * DVL2-03 real deliverable generation contracts (mock model / mock image).
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const packageStore = require("../src/act-behalf/deliverable-package-store");
const { prepareDeliverablePackage } = require("../src/act-behalf/deliverable-package-prepare");
const generation = require("../src/act-behalf/deliverable-generation");
const artifactFs = require("../src/act-behalf/deliverable-artifact-fs");
const planConsistency = require("../src/act-behalf/deliverable-plan-consistency");
const planner = require("../src/act-behalf/deliverable-planner");
const actStore = require("../src/act-behalf/task-store");

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed += 1;
      console.log("PASS", name);
    })
    .catch((err) => {
      failed += 1;
      console.error("FAIL", name);
      console.error(err && err.stack ? err.stack : err);
    });
}

function tempUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dm-dvl2-03-"));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function depsPrepare(ud) {
  return {
    getTask: (u, id) => actStore.getTask(u, id, { heal: false }),
    getPlan: (u, planId) => require("../src/act-behalf/deliverable-plan-store").getPlan(u, planId),
    saveTaskExecution: async (u, id, exec) => {
      const got = actStore.getTask(u, id, { heal: false });
      return actStore.saveTask(u, {
        ...got.task,
        deliverableExecution: { activePackageId: exec.activePackageId || null },
      });
    },
  };
}

async function seedConfirmedWithKinds(userData, taskId, kinds) {
  const goal = "请为项目准备介绍文档、演示文稿、介绍网页和封面图片。";
  await actStore.saveTask(userData, {
    taskId,
    title: "t",
    goal,
    request: goal,
    status: "draft",
  });
  const suggestion = planner.ruleBasedPlan({ goal });
  // Force four kinds for coverage
  suggestion.items = kinds.map((kind, i) => ({
    id: "pd_" + kind,
    kind,
    title: kind + " 成果",
    purpose: "测试",
    format: kind === "image" ? "png" : kind === "presentation" ? "pptx" : kind === "webpage" ? "html" : "md",
    priority: "required",
    order: i,
    dependencies: kind === "webpage" ? ["pd_document"] : [],
    planDisposition: "included",
    riskFlags: [],
  }));
  const applied = planner.applySuggestionToRecord({
    taskId,
    existingRecord: null,
    suggestion,
    goal,
  });
  const committed = await planConsistency.commitPlanThenTask({
    userData,
    planRecord: applied.plan,
    saveTaskPointers: async ({ deliverablePlanning }) => {
      const got = actStore.getTask(userData, taskId, { heal: false }).task;
      return actStore.saveTask(userData, { ...got, deliverablePlanning });
    },
    cas: { expectAbsent: true },
  });
  assert.equal(committed.ok, true);
  const confirmed = planner.confirmDraft(committed.plan);
  assert.equal(confirmed.ok, true);
  const after = await planConsistency.commitPlanThenTask({
    userData,
    planRecord: confirmed.plan,
    saveTaskPointers: async ({ deliverablePlanning }) => {
      const got = actStore.getTask(userData, taskId, { heal: false }).task;
      return actStore.saveTask(userData, {
        ...got,
        deliverablePlanning,
        deliverableExecution: { activePackageId: null },
      });
    },
    cas: { expectedRevision: planConsistency.revisionTokensFromPlan(committed.plan) },
  });
  assert.equal(after.ok, true);
  const prep = await prepareDeliverablePackage(userData, { taskId }, depsPrepare(userData));
  assert.equal(prep.ok, true);
  return prep;
}

async function main() {
  await test("path traversal rejected", () => {
    let threw = false;
    try {
      artifactFs.assertSafeRelative("../etc/passwd");
    } catch (err) {
      threw = true;
      assert.equal(err.code, "path_traversal_rejected");
    }
    assert.equal(threw, true);
  });

  await test("multi-kind package generation with mock", async () => {
    const ud = tempUserData();
    try {
      const taskId = actStore.newTaskId();
      const prep = await seedConfirmedWithKinds(ud, taskId, [
        "document",
        "presentation",
        "webpage",
        "image",
      ]);
      const packageId = prep.package.id;
      const res = await generation.generateDeliverablePackage(
        ud,
        { packageId },
        { callModel: null, imageMode: "mock" }
      );
      assert.equal(res.ok, true);
      const byKind = {};
      for (const r of res.results) byKind[r.kind] = r;
      assert.equal(byKind.document.ok, true);
      assert.equal(byKind.presentation.ok, true);
      assert.equal(byKind.webpage.ok, true);
      assert.equal(byKind.image.ok, true);

      const view = packageStore.getPackageView(ud, packageId);
      for (const d of view.deliverables) {
        assert.ok(d.currentVersionId);
        assert.ok(Array.isArray(d.versionIds) && d.versionIds.length >= 1);
        const ver = view.versions[d.currentVersionId];
        assert.ok(ver);
        assert.equal(ver.reviewStatus, "unreviewed");
        assert.ok(ver.artifactRef && ver.artifactRef.relativePath);
        assert.ok(ver.artifactRef.contentHash.startsWith("sha256:"));
        assert.equal(ver.artifactRef.relativePath.includes(".."), false);
        const abs = artifactFs.resolveAbsolute(ud, ver.artifactRef.relativePath);
        assert.equal(fs.existsSync(abs), true);
        assert.equal(artifactFs.contentHashOfFile(abs), ver.artifactRef.contentHash);
      }
    } finally {
      cleanup(ud);
    }
  });

  await test("image unavailable accurate fail without fake file", async () => {
    const ud = tempUserData();
    try {
      const taskId = actStore.newTaskId();
      const prep = await seedConfirmedWithKinds(ud, taskId, ["document", "image"]);
      const packageId = prep.package.id;
      const res = await generation.generateDeliverablePackage(
        ud,
        { packageId },
        { callModel: null, imageMode: "real" }
      );
      assert.equal(res.ok, true); // document succeeded
      const img = res.results.find((r) => r.kind === "image");
      assert.equal(img.ok, false);
      assert.equal(img.code, "image_capability_unavailable");
      const view = packageStore.getPackageView(ud, packageId);
      const imageDel = view.deliverables.find((d) => d.kind === "image");
      assert.equal(imageDel.generationStatus, "failed");
      assert.equal(imageDel.currentVersionId, null);
      const doc = view.deliverables.find((d) => d.kind === "document");
      assert.ok(doc.currentVersionId);
    } finally {
      cleanup(ud);
    }
  });

  await test("retry creates new version; review binds version; no inherit accepted", async () => {
    const ud = tempUserData();
    try {
      const taskId = actStore.newTaskId();
      const prep = await seedConfirmedWithKinds(ud, taskId, ["document"]);
      const packageId = prep.package.id;
      const d0 = prep.deliverables[0];
      const first = await generation.generateOneDeliverable(
        ud,
        { packageId, deliverableId: d0.id },
        { callModel: null, imageMode: "mock" }
      );
      assert.equal(first.ok, true);
      const v1 = first.version.id;
      const reviewed = await generation.reviewDeliverableVersion(ud, {
        versionId: v1,
        decision: "accepted",
      });
      assert.equal(reviewed.ok, true);
      const second = await generation.generateOneDeliverable(
        ud,
        { packageId, deliverableId: d0.id },
        { callModel: null, imageMode: "mock" }
      );
      assert.equal(second.ok, true);
      assert.notEqual(second.version.id, v1);
      assert.equal(second.version.reviewStatus, "unreviewed");
      const listed = packageStore.listVersionsForDeliverable(ud, d0.id);
      assert.equal(listed.versions.length, 2);
      const old = listed.versions.find((v) => v.id === v1);
      assert.ok(old);
      assert.equal(old.reviewStatus, "accepted");
      assert.ok(fs.existsSync(artifactFs.resolveAbsolute(ud, old.artifactRef.relativePath)));
    } finally {
      cleanup(ud);
    }
  });

  await test("model failure does not create version", async () => {
    const ud = tempUserData();
    try {
      const taskId = actStore.newTaskId();
      const prep = await seedConfirmedWithKinds(ud, taskId, ["document"]);
      const packageId = prep.package.id;
      const d0 = prep.deliverables[0];
      const res = await generation.generateOneDeliverable(
        ud,
        { packageId, deliverableId: d0.id },
        {
          callModel: async () => {
            throw Object.assign(new Error("boom"), { code: "PROVIDER_ERROR" });
          },
          imageMode: "mock",
        }
      );
      assert.equal(res.ok, false);
      const view = packageStore.getPackageView(ud, packageId);
      const d = view.deliverables.find((x) => x.id === d0.id);
      assert.equal(d.currentVersionId, null);
      assert.equal(Object.keys(view.versions || {}).length, 0);
    } finally {
      cleanup(ud);
    }
  });

  await test("dependency failure skips dependent", async () => {
    const ud = tempUserData();
    try {
      const taskId = actStore.newTaskId();
      const prep = await seedConfirmedWithKinds(ud, taskId, ["document", "webpage"]);
      const packageId = prep.package.id;
      // Fail document by forcing empty output via callModel returning tiny string for document only — simpler: fail first by patching generate
      const doc = prep.deliverables.find((d) => d.kind === "document");
      const web = prep.deliverables.find((d) => d.kind === "webpage");
      assert.ok(doc && web);
      // Manually mark document failed then run webpage via package with document failing first
      let calls = 0;
      const res = await generation.generateDeliverablePackage(
        ud,
        { packageId },
        {
          callModel: async () => {
            calls += 1;
            if (calls === 1) throw Object.assign(new Error("doc fail"), { code: "PROVIDER_ERROR" });
            return "# ok page\n\ncontent here for webpage body text.";
          },
          imageMode: "mock",
        }
      );
      const docRes = res.results.find((r) => r.deliverableId === doc.id);
      const webRes = res.results.find((r) => r.deliverableId === web.id);
      assert.equal(docRes.ok, false);
      assert.equal(webRes.ok, false);
      assert.equal(webRes.code, "dependency_failed");
    } finally {
      cleanup(ud);
    }
  });

  console.log("\nDVL2-03 generation contracts:", passed, "passed,", failed, "failed");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
