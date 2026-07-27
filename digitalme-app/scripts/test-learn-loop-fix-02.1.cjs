"use strict";

/**
 * LEARN-LOOP-FIX-02.1 acceptance tests — low-friction auto-adoption.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const { createMinimalFixture } = require("../src/package-store/fixture");
const projectStore = require("../src/act-behalf/project-knowledge-store");
const { resolveKnowledgeContext } = require("../src/act-behalf/knowledge-resolver");
const knowledgeLearning = require("../src/act-behalf/knowledge-learning");
const {
  evaluateLearningAdoption,
  detectPrincipleConflict,
} = require("../src/act-behalf/learning-adoption-policy");

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
const CONFLICT_PRINCIPLE =
  "以后 Digital Me 的主界面应默认展示所有身份、授权、来源和审计细节。";

async function main() {
  await test("low-risk direct statement auto-adopts", () => {
    const pkgDir = tempDir("llf021-");
    createMinimalFixture(pkgDir);
    projectStore.ensureDigitalMeProjectKnowledge(pkgDir);
    const result = knowledgeLearning.processUserInputLearning(pkgDir, SAMPLE_PRINCIPLE, {
      sourceRef: "owner_chat_input:test",
    });
    assert.equal(result.adopted.length, 1);
    assert.equal(result.adopted[0].claim.confirmationStatus, "auto_adopted");
    assert.notEqual(result.adopted[0].claim.authorityLevel, "owner_confirmed");
    assert.equal(result.pendingConfirmation.length, 0);
    cleanup(pkgDir);
  });

  await test("auto-adopt does not mark owner_confirmed", () => {
    const adoption = evaluateLearningAdoption({
      candidate: { claimText: SAMPLE_PRINCIPLE, projectId: "project_digital_me", confidence: "high" },
      source: "direct_user_statement",
      riskLevel: "low",
      confidence: "high",
      conflicts: [],
    });
    assert.equal(adoption.decision, "auto_adopt");
  });

  await test("auto-adopted recalled in new conversation", () => {
    const pkgDir = tempDir("llf021b-");
    createMinimalFixture(pkgDir);
    projectStore.ensureDigitalMeProjectKnowledge(pkgDir);
    knowledgeLearning.processUserInputLearning(pkgDir, SAMPLE_PRINCIPLE, {
      sourceRef: "owner_chat_input:test",
    });
    const resolved = resolveKnowledgeContext({
      query: "Digital Me 的界面设计最重要的原则是什么",
      packageDir: pkgDir,
      surface: "chat",
    });
    const texts = resolved.selectedClaims.map((c) => c.claimText).join("\n");
    assert.ok(texts.includes(SAMPLE_PRINCIPLE.replace(/。$/, "")));
    const row = resolved.evidenceRows.find((r) => /界面|按需/.test(r.summary));
    assert.ok(row);
    assert.ok(/系统已记住|多次使用后已稳定/.test(row.status));
    cleanup(pkgDir);
  });

  await test("deliverable surface applies auto-adopted principle", () => {
    const pkgDir = tempDir("llf021c-");
    createMinimalFixture(pkgDir);
    projectStore.ensureDigitalMeProjectKnowledge(pkgDir);
    knowledgeLearning.processUserInputLearning(pkgDir, SAMPLE_PRINCIPLE, {
      sourceRef: "owner_chat_input:test",
    });
    const resolved = resolveKnowledgeContext({
      query: "为 Digital Me 设计一个任务详情页",
      packageDir: pkgDir,
      surface: "deliverable",
      taskContext: { goal: "为 Digital Me 设计一个任务详情页", deliverableKind: "document" },
    });
    assert.ok(resolved.promptText.includes(SAMPLE_PRINCIPLE.slice(0, 20)));
    cleanup(pkgDir);
  });

  await test("low-risk revision auto-supersedes without confirmation", () => {
    const pkgDir = tempDir("llf021d-");
    createMinimalFixture(pkgDir);
    projectStore.ensureDigitalMeProjectKnowledge(pkgDir);
    knowledgeLearning.processUserInputLearning(pkgDir, SAMPLE_PRINCIPLE, {
      sourceRef: "owner_chat_input:test",
    });
    const second = knowledgeLearning.processUserInputLearning(pkgDir, REVISED_PRINCIPLE, {
      projectId: "project_digital_me",
      sourceRef: "owner_chat_input:test2",
    });
    assert.equal(second.adopted.length, 1);
    assert.equal(second.pendingConfirmation.length, 0);
    assert.ok(second.adopted[0].supersededClaimId);
    const resolved = resolveKnowledgeContext({
      query: "界面设计原则",
      packageDir: pkgDir,
      surface: "chat",
    });
    const active = resolved.selectedClaims.map((c) => c.claimText);
    assert.ok(active.some((t) => t.includes(REVISED_PRINCIPLE.slice(0, 12))));
    cleanup(pkgDir);
  });

  await test("conflicting principle requires confirmation", () => {
    const pkgDir = tempDir("llf021e-");
    createMinimalFixture(pkgDir);
    projectStore.ensureDigitalMeProjectKnowledge(pkgDir);
    knowledgeLearning.processUserInputLearning(pkgDir, SAMPLE_PRINCIPLE, {
      sourceRef: "owner_chat_input:test",
    });
    const result = knowledgeLearning.processUserInputLearning(pkgDir, CONFLICT_PRINCIPLE, {
      sourceRef: "owner_chat_input:test",
    });
    assert.equal(result.adopted.length, 0);
    assert.ok(result.pendingConfirmation.length >= 1);
    const adoption = result.pendingConfirmation[0].adoption;
    assert.equal(adoption.decision, "ask_confirmation");
    cleanup(pkgDir);
  });

  await test("high-risk blockchain direction requires confirmation", () => {
    const adoption = evaluateLearningAdoption({
      candidate: {
        claimText: "Digital Me 改为区块链交易平台",
        projectId: "project_digital_me",
        confidence: "medium",
      },
      source: "direct_user_statement",
      conflicts: [],
    });
    assert.equal(adoption.decision, "ask_confirmation");
    assert.ok(adoption.reasons.some((r) => /strategic|direction/i.test(r)));
  });

  await test("dismiss does not write claim", () => {
    const pkgDir = tempDir("llf021f-");
    createMinimalFixture(pkgDir);
    const candidates = knowledgeLearning.extractCandidatesFromUserInput(SAMPLE_PRINCIPLE);
    const dismissed = knowledgeLearning.adoptCandidate(pkgDir, candidates[0], { mode: "dismiss" });
    assert.equal(dismissed.committed, false);
    assert.equal(knowledgeLearning.claimExistsInStore(pkgDir, SAMPLE_PRINCIPLE), false);
    cleanup(pkgDir);
  });

  await test("session_only does not write claim", () => {
    const pkgDir = tempDir("llf021g-");
    createMinimalFixture(pkgDir);
    const candidates = knowledgeLearning.extractCandidatesFromUserInput(SAMPLE_PRINCIPLE);
    const session = knowledgeLearning.adoptCandidate(pkgDir, candidates[0], { mode: "session_only" });
    assert.equal(session.committed, false);
    cleanup(pkgDir);
  });

  await test("user correction reject stops recall", () => {
    const pkgDir = tempDir("llf021h-");
    createMinimalFixture(pkgDir);
    projectStore.ensureDigitalMeProjectKnowledge(pkgDir);
    knowledgeLearning.processUserInputLearning(pkgDir, SAMPLE_PRINCIPLE, {
      sourceRef: "owner_chat_input:test",
    });
    knowledgeLearning.processUserCorrection(pkgDir, "不要记住这条界面原则", {
      projectId: "project_digital_me",
    });
    const resolved = resolveKnowledgeContext({
      query: "界面设计原则",
      packageDir: pkgDir,
      surface: "chat",
    });
    const wp = resolved.selectedClaims.filter((c) => c.claimType === "work_principle");
    assert.equal(wp.length, 0);
    cleanup(pkgDir);
  });

  await test("detectPrincipleConflict finds minimal vs verbose", () => {
    const conflicts = detectPrincipleConflict(CONFLICT_PRINCIPLE, [
      {
        claimId: "x",
        claimType: "work_principle",
        claimText: SAMPLE_PRINCIPLE,
        confirmationStatus: "auto_adopted",
      },
    ]);
    assert.ok(conflicts.length >= 1);
  });

  console.log("\n---");
  console.log("passed:", passed, "failed:", failed);
  if (failed) process.exit(1);
}

main();
