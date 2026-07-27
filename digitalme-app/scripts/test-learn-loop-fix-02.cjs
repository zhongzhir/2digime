"use strict";

/**
 * LEARN-LOOP-FIX-02 acceptance tests.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const { createMinimalFixture } = require("../src/package-store/fixture");
const projectStore = require("../src/act-behalf/project-knowledge-store");
const { resolveKnowledgeContext } = require("../src/act-behalf/knowledge-resolver");
const { detectProjectScope } = require("../src/act-behalf/project-detection");
const knowledgeLearning = require("../src/act-behalf/knowledge-learning");
const { pickActiveClaims } = require("../src/act-behalf/knowledge-resolver");

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

const SAMPLE_PRINCIPLE =
  "Digital Me 的默认工作界面只显示完成当前任务所必需的信息，其余信息必须按需展开。";
const REVISED_PRINCIPLE =
  "默认页面只显示当前决策和下一动作所必需的信息，其余内容按需展开。";

async function main() {
  await test("audit sample principle not in seed claims", () => {
    const seeds = projectStore.buildDigitalMeSeedClaims();
    const texts = seeds.map((c) => c.claimText).join("\n");
    assert.ok(!texts.includes(SAMPLE_PRINCIPLE));
    assert.ok(!texts.includes(REVISED_PRINCIPLE));
  });

  await test("project detection: Digital Me variants same project", () => {
    const q1 = detectProjectScope({ query: "Digital Me 是什么" });
    const q2 = detectProjectScope({ query: "当前 Digital Me 做到哪一步" });
    const q3 = detectProjectScope({ query: "为 Digital Me 制定开发计划" });
    assert.equal(q1.projectId, "project_digital_me");
    assert.equal(q2.projectId, "project_digital_me");
    assert.equal(q3.projectId, "project_digital_me");
  });

  await test("project detection: unrelated topic does not mount Digital Me", () => {
    const q = detectProjectScope({ query: "为一家餐饮企业写开业宣传" });
    assert.equal(q.projectId, null);
    assert.equal(q.confidence, "high");
    assert.equal(q.reason, "non_digital_me_topic");
  });

  await test("unified resolver: chat and deliverable share project claims", () => {
    const pkgDir = tempDir("llf02-pkg-");
    createMinimalFixture(pkgDir);
    projectStore.ensureDigitalMeProjectKnowledge(pkgDir);
    const query = "Digital Me 当前定位是什么";
    const chat = resolveKnowledgeContext({ query, packageDir: pkgDir, surface: "chat" });
    const deliv = resolveKnowledgeContext({
      query,
      packageDir: pkgDir,
      surface: "deliverable",
      taskContext: { goal: query, deliverableKind: "document" },
    });
    assert.ok(chat.selectedClaims.length >= 1);
    assert.deepEqual(
      chat.provenance.selectedClaimIds.sort(),
      deliv.provenance.selectedClaimIds.sort()
    );
    const joined = chat.selectedClaims.map((c) => c.claimText).join("\n");
    assert.ok(/数字主体/.test(joined));
    cleanup(pkgDir);
  });

  await test("stablecoin exploration excluded from resolver", () => {
    const pkgDir = tempDir("llf02-pkg2-");
    createMinimalFixture(pkgDir);
    projectStore.ensureDigitalMeProjectKnowledge(pkgDir);
    const resolved = resolveKnowledgeContext({
      query: "Digital Me 稳定币 支付",
      packageDir: pkgDir,
      surface: "chat",
    });
    const texts = resolved.selectedClaims.map((c) => c.claimText).join("\n");
    assert.ok(/不是.*产品主线|不是.*主技术底座/.test(texts));
    assert.ok(
      resolved.excludedItems.some((e) => /lexical|historical|superseded/.test(e.reason || "")) ||
        !/UBC|通用基本资本/.test(texts)
    );
    cleanup(pkgDir);
  });

  await test("auto-adopt + cross-surface retrieval", () => {
    const pkgDir = tempDir("llf02-pkg3-");
    createMinimalFixture(pkgDir);
    projectStore.ensureDigitalMeProjectKnowledge(pkgDir);
    const result = knowledgeLearning.processUserInputLearning(pkgDir, SAMPLE_PRINCIPLE, {
      sourceRef: "owner_chat_input:test",
    });
    assert.equal(result.adopted.length, 1);
    assert.equal(result.adopted[0].claim.confirmationStatus, "auto_adopted");

    const chat = resolveKnowledgeContext({
      query: "Digital Me 的界面设计最重要的原则是什么",
      packageDir: pkgDir,
      surface: "chat",
    });
    const texts = chat.selectedClaims.map((c) => c.claimText).join("\n");
    assert.ok(texts.includes(SAMPLE_PRINCIPLE.replace(/。$/, "")));
    const row = chat.evidenceRows.find((r) => r.summary.includes("界面"));
    assert.ok(row);
    assert.ok(/系统已记住|多次使用后已稳定/.test(row.status));

    const task = resolveKnowledgeContext({
      query: "为 Digital Me 设计一个任务详情页",
      packageDir: pkgDir,
      surface: "deliverable",
      taskContext: { goal: "为 Digital Me 设计一个任务详情页", deliverableKind: "document" },
    });
    assert.ok(task.promptText.includes(SAMPLE_PRINCIPLE.slice(0, 20)));
    cleanup(pkgDir);
  });

  await test("supersession: revised principle replaces old", () => {
    const pkgDir = tempDir("llf02-pkg4-");
    createMinimalFixture(pkgDir);
    projectStore.ensureDigitalMeProjectKnowledge(pkgDir);
    const c1 = knowledgeLearning.processUserInputLearning(pkgDir, SAMPLE_PRINCIPLE, {
      sourceRef: "owner_chat_input:test",
    });
    assert.equal(c1.adopted.length, 1);
    const c2 = knowledgeLearning.processUserInputLearning(pkgDir, REVISED_PRINCIPLE, {
      projectId: "project_digital_me",
      sourceRef: "owner_chat_input:test2",
    });
    assert.equal(c2.adopted.length, 1);
    assert.ok(c2.adopted[0].supersededClaimId);

    const resolved = resolveKnowledgeContext({
      query: "界面设计原则",
      packageDir: pkgDir,
      surface: "chat",
    });
    const active = resolved.selectedClaims.map((c) => c.claimText);
    assert.ok(active.some((t) => t.includes(REVISED_PRINCIPLE.slice(0, 12))));
    assert.ok(!active.some((t) => t.includes(SAMPLE_PRINCIPLE.replace(/。$/, ""))));
    cleanup(pkgDir);
  });

  await test("status freshness: accepted beats older pending", () => {
    const claims = [
      {
        claimId: "a",
        claimText: "状态A pending",
        claimType: "current_status",
        authorityLevel: "current_project_record",
        confirmationStatus: "candidate",
        effectiveFrom: "2026-01-01T00:00:00.000Z",
      },
      {
        claimId: "b",
        claimText: "状态B accepted",
        claimType: "current_status",
        authorityLevel: "accepted_runtime_state",
        confirmationStatus: "accepted",
        effectiveFrom: "2026-07-01T00:00:00.000Z",
      },
    ];
    const active = pickActiveClaims(claims);
    assert.equal(active.length, 2);
    const b = active.find((c) => c.claimId === "b");
    assert.ok(b);
  });

  console.log("\n---");
  console.log("passed:", passed, "failed:", failed);
  if (failed) process.exit(1);
}

main();
