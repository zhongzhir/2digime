"use strict";

/**
 * CRT-MVP continuity: subject assets → assembly → generate → learn → next assembly.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const actStore = require("../src/act-behalf/task-store");
const planConsistency = require("../src/act-behalf/deliverable-plan-consistency");
const planner = require("../src/act-behalf/deliverable-planner");
const packageStore = require("../src/act-behalf/deliverable-package-store");
const { prepareDeliverablePackage } = require("../src/act-behalf/deliverable-package-prepare");
const generation = require("../src/act-behalf/deliverable-generation");
const autoLearn = require("../src/act-behalf/deliverable-auto-learn");
const {
  assembleSubjectContext,
  LAYER_KEYS,
} = require("../src/act-behalf/subject-context-assembler");
const { buildDocumentMessages } = require("../src/act-behalf/deliverable-generators");
const { buildGenerationContext } = require("../src/act-behalf/deliverable-context");
const { createMinimalFixture } = require("../src/package-store/fixture");
const distillMe = require("../src/distill-me");

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

function tempDir(p) {
  return fs.mkdtempSync(path.join(os.tmpdir(), p));
}

function cleanup(d) {
  try {
    fs.rmSync(d, { recursive: true, force: true });
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

function seedDistillWithToken(packageDir, token) {
  const data = distillMe.read(packageDir);
  data.items = data.items || [];
  data.items.push({
    id: "distill_subj_" + token.slice(0, 12),
    category: "identity",
    statement: `本人项目标识：${token}。Digital Me 是个人数字主体系统。`,
    status: "confirmed",
    confidence: "high",
    sourceRefs: ["crt_mvp_fixture"],
    evidenceRefs: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    confirmedAt: new Date().toISOString(),
    version: 1,
  });
  fs.mkdirSync(path.join(packageDir, "life"), { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, "life", "distill-me-identity-facts.json"),
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

async function seedPlanAndPackage(userData, { goal, kinds }) {
  const taskId = "t_crt_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
  await actStore.saveTask(userData, {
    taskId,
    title: "CRT continuity",
    goal,
    request: goal,
    status: "draft",
  });
  const suggestion = planner.ruleBasedPlan({ goal });
  suggestion.items = kinds.map((kind, i) => ({
    id: "pd_" + kind,
    kind,
    title: kind === "document" ? "介绍文档" : kind + " 成果",
    purpose: "持续性验证",
    format: kind === "document" ? "md" : "html",
    priority: "required",
    order: i,
    dependencies: [],
    planDisposition: "included",
    riskFlags: [],
  }));
  suggestion.understanding = {
    goal: { value: goal, provenance: "user_provided" },
    audience: { value: "投资人", provenance: "user_provided" },
    usage: { value: "介绍", provenance: "user_provided" },
    constraints: { value: [], provenance: "user_provided" },
    assumptions: [],
    unresolvedQuestions: [],
  };
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
  return { taskId, packageId: prep.package.id, package: prep.package };
}

async function main() {
  const SUBJECT = "UNIQUE_SUBJECT_TOKEN_A";
  const LEARN = "UNIQUE_LEARN_TOKEN_B";

  await test("schema: SubjectAssembly layers are forward-compatible", () => {
    const asm = assembleSubjectContext({ packageDir: null, query: { goal: "x" } });
    for (const k of LAYER_KEYS) {
      assert.ok(Array.isArray(asm.layers[k]), "missing layer " + k);
    }
    assert.equal(asm.emptyReason, "no_package");
    assert.equal(asm.renderedText, "");
  });

  await test("T1+T3: subject asset enters context, prompt, provenance", async () => {
    const ud = tempDir("crt-t1-");
    const pkgDir = tempDir("crt-pkg-t1-");
    try {
      createMinimalFixture(pkgDir);
      seedDistillWithToken(pkgDir, SUBJECT);
      const goal = "为 Digital Me 准备面向投资人的介绍材料 " + SUBJECT;
      const seeded = await seedPlanAndPackage(ud, { goal, kinds: ["document"] });
      const gen = await generation.generateDeliverablePackage(
        ud,
        { packageId: seeded.packageId },
        { callModel: null, imageMode: "mock", packageDir: pkgDir }
      );
      assert.equal(gen.ok, true);
      const view = packageStore.getPackageView(ud, seeded.packageId);
      const del = view.deliverables.find((d) => d.kind === "document");
      const ver = view.versions[del.currentVersionId];
      assert.ok(ver.provenance.subjectContextSnapshotId);
      assert.ok(Array.isArray(ver.provenance.subjectRefs));
      assert.ok(ver.provenance.subjectRefs.some((r) => r.included));
      assert.ok(ver.provenance.assembly && ver.provenance.assembly.assemblyId);
      assert.equal(ver.provenance.assembly.emptyReason, null);

      const task = actStore.getTask(ud, seeded.taskId, { heal: false }).task;
      const asm = assembleSubjectContext({
        packageDir: pkgDir,
        query: { goal, audience: "投资人", deliverableKind: "document", deliverableTitle: "介绍文档" },
      });
      assert.match(asm.renderedText, new RegExp(SUBJECT));
      const ctx = buildGenerationContext({
        pkg: view.package,
        deliverable: del,
        task,
        referenceMaterials: [],
        subjectAssembly: asm,
      });
      const blob = buildDocumentMessages(ctx)
        .map((m) => m.content)
        .join("\n");
      assert.match(blob, new RegExp(SUBJECT));
    } finally {
      cleanup(ud);
      cleanup(pkgDir);
    }
  });

  await test("T2: no subject assets → emptyReason, no fabricated subject claims", async () => {
    const asm = assembleSubjectContext({
      packageDir: null,
      query: { goal: "随便写点" },
    });
    assert.equal(asm.emptyReason, "no_package");
    assert.equal(asm.refs.length, 0);
    assert.equal(asm.renderedText.includes("已了解你"), false);

    const emptyPkg = tempDir("crt-empty-pkg-");
    try {
      createMinimalFixture(emptyPkg);
      const asm2 = assembleSubjectContext({
        packageDir: emptyPkg,
        query: { goal: "随便写点" },
      });
      assert.ok(
        asm2.emptyReason === "no_active_assets" || asm2.refs.length === 0 || asm2.renderedText === ""
      );
      if (asm2.renderedText) {
        assert.equal(/我是你的数字分身|已深度了解你/.test(asm2.renderedText), false);
      }
    } finally {
      cleanup(emptyPkg);
    }
  });

  await test("T4+T5: accept learn writes UNIQUE_LEARN_TOKEN; next assembly reads it", async () => {
    const ud = tempDir("crt-t45-");
    const pkgDir = tempDir("crt-pkg-t45-");
    try {
      createMinimalFixture(pkgDir);
      seedDistillWithToken(pkgDir, SUBJECT);
      const goal = "为 Digital Me 写介绍文档";
      const seeded = await seedPlanAndPackage(ud, { goal, kinds: ["document"] });
      const gen = await generation.generateDeliverablePackage(
        ud,
        { packageId: seeded.packageId },
        {
          callModel: async () =>
            `# 介绍\n\nDigital Me 说明。学习标记 ${LEARN} 应被记住。\n\n更多要点。`,
          imageMode: "mock",
          packageDir: pkgDir,
        }
      );
      assert.equal(gen.ok, true);
      const view = packageStore.getPackageView(ud, seeded.packageId);
      const del = view.deliverables.find((d) => d.kind === "document");
      const versionId = del.currentVersionId;

      const reviewed = await generation.reviewDeliverableVersion(ud, {
        versionId,
        decision: "accepted",
      });
      assert.equal(reviewed.ok, true);

      const enq = autoLearn.enqueueAfterAccept(ud, versionId, { packageDir: pkgDir });
      assert.equal(enq.ok, true);
      const ran = await autoLearn.runLearnJob(ud, enq.job.id, {
        packageDir: pkgDir,
        callModel: null,
      });
      assert.equal(ran.ok, true);
      assert.notEqual(ran.job.status, "pending_conflict");

      const memPath = path.join(pkgDir, "memory", "long-term-memory.jsonl");
      const memRaw = fs.existsSync(memPath) ? fs.readFileSync(memPath, "utf8") : "";
      assert.match(memRaw, new RegExp(LEARN));

      const asm2 = assembleSubjectContext({
        packageDir: pkgDir,
        query: {
          goal: "再为 Digital Me 准备介绍材料",
          audience: "投资人",
          deliverableKind: "document",
          deliverableTitle: "介绍文档",
        },
      });
      assert.match(asm2.renderedText, new RegExp(LEARN));
      assert.ok(asm2.refs.some((r) => r.layer === "memory"));
    } finally {
      cleanup(ud);
      cleanup(pkgDir);
    }
  });

  await test("T6: budget truncation records excluded assets", () => {
    const pkgDir = tempDir("crt-budget-");
    try {
      createMinimalFixture(pkgDir);
      const data = distillMe.read(pkgDir);
      data.items = [];
      for (let i = 0; i < 20; i += 1) {
        data.items.push({
          id: "id_" + i,
          category: "identity",
          statement: "身份陈述编号" + i + "：" + "内容".repeat(40),
          status: "confirmed",
          confidence: "medium",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          confirmedAt: new Date().toISOString(),
          version: 1,
        });
      }
      fs.mkdirSync(path.join(pkgDir, "life"), { recursive: true });
      fs.writeFileSync(
        path.join(pkgDir, "life", "distill-me-identity-facts.json"),
        JSON.stringify(data, null, 2),
        "utf8"
      );
      const asm = assembleSubjectContext({
        packageDir: pkgDir,
        query: { goal: "介绍本人" },
        limits: { subjectCharsLimit: 200, maxIdentity: 20 },
      });
      assert.equal(asm.budget.truncated, true);
      assert.ok(asm.policy.excludedSample.length >= 1);
      assert.ok(asm.budget.subjectCharsUsed <= 200);
    } finally {
      cleanup(pkgDir);
    }
  });

  console.log(`\nCRT-MVP continuity unit: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);

  // T7 regression suites
  const { spawnSync } = require("node:child_process");
  const scripts = [
    ["test:dvl2-01-planner", "dvl2-01"],
    ["test:dvl2-02-package", "dvl2-02"],
    ["test:dvl2-03-generation", "dvl2-03"],
    ["test:dvl2-03-one-click", "dvl2-03-one-click"],
    ["test:dvl2-04-auto-learn", "dvl2-04"],
    ["test:dvl2-05-context", "dvl2-05"],
  ];
  for (const [script, label] of scripts) {
    const r = spawnSync("npm", ["run", script], {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      shell: true,
    });
    if (r.status !== 0) {
      console.error("FAIL T7 regression", label);
      console.error(r.stdout || "");
      console.error(r.stderr || "");
      process.exit(1);
    }
    console.log("PASS T7 regression", label);
  }

  console.log("\nAll CRT-MVP continuity + regressions passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
