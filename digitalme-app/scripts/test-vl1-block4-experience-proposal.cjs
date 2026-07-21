"use strict";

/**
 * VL1 block 4: Experience Proposal + subject reflow (preview → confirm apply).
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const actStore = require("../src/act-behalf/task-store");
const { normalizeTaskIntent } = require("../src/act-behalf/task-intent");
const {
  assembleSubjectContextCandidates,
  confirmSubjectContextSnapshot,
} = require("../src/act-behalf/subject-context-assembly");
const { runReadonlyExternalResearch } = require("../src/act-behalf/research-run");
const {
  generateResearchExpressionResult,
  decideResultFromRenderer,
  saveResultDraftFromRenderer,
  confirmedClaimsFromContext,
  projectExternalEvidenceFromTask,
} = require("../src/act-behalf/result-generation");
const {
  PROPOSAL_STATUS,
  OWNER_CANDIDATE_STATE,
  createExperienceProposal,
  saveExperienceProposalReview,
  previewExperienceProposal,
  applyExperienceProposal,
  rejectExperienceProposal,
  materializeCandidates,
  buildProposalMessages,
  healRunningProposals,
  assertCreatePreconditions,
  projectFeedbackItems,
} = require("../src/act-behalf/experience-proposal");
const { saveDraftFromRenderer } = require("../src/act-behalf/task-save-boundary");
const feedback = require("../src/feedback");
const personalSkills = require("../src/skills/personal");
const { createMinimalFixture } = require("../src/package-store/fixture");
const {
  PackageStore,
  readManifest,
  storeRootFor,
  dirByteFingerprint,
} = require("../src/package-store");

let passed = 0;
let failed = 0;
let searchCalls = 0;

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
  return fs.mkdtempSync(path.join(os.tmpdir(), "dm-vl1-b4-"));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function fingerprintPackage(dir) {
  if (typeof dirByteFingerprint === "function") return dirByteFingerprint(dir);
  // Fallback: hash manifest + persona if fingerprint helper missing
  const parts = ["manifest.json", "persona.md", "style-guide.md"].map((rel) => {
    const p = path.join(dir, rel);
    return fs.existsSync(p) ? fs.readFileSync(p) : Buffer.alloc(0);
  });
  return Buffer.concat(parts).toString("hex").slice(0, 64);
}

function samplePkg() {
  return {
    exists: true,
    dir: "D:/fake/digital-me-package",
    manifest: { packageId: "pkg_test", revision: 3 },
    persona: "我坚持本地优先与本人控制。投资上重视长期判断框架。",
    styleGuide: "表达克制、清楚、少口号。",
    lifeSummary: "长期关注数字化主体。",
    boundariesSummary: "不得擅自对外发送；不得把推测写成本人事实。",
    longTermMemory:
      JSON.stringify({
        type: "long_term",
        content: "我认为公开市场短期波动不应直接改写长期投资框架。",
        theme: "投资判断",
        confidence: "high",
      }) + "\n",
    decisionFrameworks: JSON.stringify({
      frameworks: [{ name: "长期框架优先", principles: ["证据不足时明确不确定"] }],
    }),
    preferences: "偏好结构化短文。",
    identitySummary: "个人数字主体建设者。",
  };
}

function makePackageDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-vl1-b4-pkg-"));
  createMinimalFixture(dir);
  const store = new PackageStore({ packageDir: dir, actor: "test:vl1-b4" });
  store.migrateToV02({ actor: "test:vl1-b4", toolVersion: "test-vl1-block4" });
  return dir;
}

function loadPackageBounded(packageDir) {
  const deepSecret = "PREFERENCES_TAIL_SECRET_MARKER_SHOULD_NOT_APPEAR";
  return {
    exists: true,
    dir: packageDir,
    persona: samplePkg().persona,
    styleGuide: samplePkg().styleGuide,
    boundariesSummary: samplePkg().boundariesSummary,
    lifeSummary: samplePkg().lifeSummary,
    identitySummary: samplePkg().identitySummary,
    preferences: "x".repeat(220) + deepSecret,
    // Must never enter proposal prompt (not in boundedPackageSummary fields)
    longTermMemory: "LONGTERM_SECRET_MARKER_NEVER_IN_PROMPT",
    apiKey: "SECRET_API_KEY_NEVER",
  };
}

async function seedConfirmedTask(userData, goal) {
  const assembled = assembleSubjectContextCandidates(samplePkg(), { goal });
  const confirmed = confirmSubjectContextSnapshot(assembled.subjectContextDraft, {
    keepClaimIds: assembled.subjectContextDraft.claims.slice(0, 2).map((c) => c.id),
    supplements: [],
  });
  const intent = normalizeTaskIntent({ goal }, undefined);
  const saved = await actStore.saveTask(userData, {
    title: "学习建议任务",
    goal,
    taskIntent: intent,
    status: "context_confirmed",
    subjectContextCandidates: assembled.subjectContextDraft,
    subjectContext: confirmed,
    invocations: [],
    results: [],
    proposals: [],
  });
  return saved.task;
}

async function seedResearchedTask(userData, goal) {
  const task = await seedConfirmedTask(userData, goal);
  const out = await runReadonlyExternalResearch({
    userData,
    taskId: task.taskId,
    store: actStore,
    skills: personalSkills,
    searchWeb: async (_em, query) => {
      searchCalls += 1;
      return {
        query,
        provider: "fake",
        results: [
          {
            title: "外部来源一",
            url: "https://example.com/a",
            snippet: "摘要一",
            provider: "fake",
          },
          {
            title: "外部来源二",
            url: "https://example.com/b",
            snippet: "摘要二",
            provider: "fake",
          },
        ],
      };
    },
    forceFake: true,
  });
  assert.equal(out.ok, true, out.message);
  return out.task;
}

function fakeResultCallModel(claims, ext) {
  const claimId = claims[0].claimId;
  const resultRef = ext.externalEvidence[0].resultRef;
  return async () => ({
    content: JSON.stringify({
      subjectSummary: "本人立场摘要",
      externalFindings: [{ resultRef, note: "外部摘要" }],
      inferences: [
        {
          text: "在本人长期框架下，公开波动不宜直接改写立场。",
          basedOnSubjectClaimIds: [claimId],
          basedOnExternalResultRefs: [resultRef],
          uncertainty: "medium",
        },
      ],
      finalDraft: "基于本人立场与外部来源摘要，形成可编辑纪要。",
    }),
    provider: "test_fake",
    model: "fake-model",
    usedFake: true,
  });
}

function fakeProposalCallModel(claims, extras = {}) {
  const claimId = claims[0].claimId;
  const candidates =
    extras.candidates ||
    [
      {
        targetKind: "memory",
        proposedText: "公开市场短期波动不应直接改写长期投资框架。",
        rationale: "来自已采用成果正文中的本人立场。",
        basedOnSubjectClaimIds: [claimId, "unknown_claim_drop_me"],
        basedOnExternalResultRefs: extras.extRefs || ["fake_unknown_ref"],
        basedOnResultSections: ["finalDraft"],
        confidence: "medium",
        caveat: "",
        packagePath: "/evil/path",
        url: "https://evil.example/forge",
        version: 999,
      },
    ];
  return async (messages) => ({
    content: JSON.stringify({ candidates }),
    provider: "test_fake",
    model: "fake-proposal",
    usedFake: true,
    _messages: messages,
  });
}

async function seedAdoptedResult(userData, goal, packageDir) {
  const researched = await seedResearchedTask(userData, goal);
  const claims = confirmedClaimsFromContext(researched.subjectContext);
  const ext = projectExternalEvidenceFromTask(researched);
  assert.ok(claims.length >= 1);
  assert.ok(ext.externalEvidence.length >= 1);

  const gen = await generateResearchExpressionResult({
    userData,
    taskId: researched.taskId,
    store: actStore,
    skills: personalSkills,
    callModel: fakeResultCallModel(claims, ext),
    forceFake: true,
  });
  assert.equal(gen.ok, true, gen.message);

  const decided = await decideResultFromRenderer(actStore, userData, {
    taskId: researched.taskId,
    resultId: gen.result.resultId,
    decision: "adopted",
    expectedRevision: Number(gen.result.currentRevision) || 0,
  });
  assert.equal(decided.ok, true, decided.message);
  assert.equal(decided.result.ownerDecision, "adopted");

  return {
    task: decided.task,
    result: decided.result,
    claims: confirmedClaimsFromContext(decided.task.subjectContext),
    packageDir,
  };
}

async function createProposalForAdopted(userData, seeded, callModel) {
  const claims = seeded.claims || confirmedClaimsFromContext(seeded.task.subjectContext);
  return createExperienceProposal({
    userData,
    taskId: seeded.task.taskId,
    resultId: seeded.result.resultId,
    store: actStore,
    packageDir: seeded.packageDir,
    loadPackage: () => loadPackageBounded(seeded.packageDir),
    callModel: callModel || fakeProposalCallModel(claims),
    forceFake: true,
  });
}

async function acceptAllCandidates(userData, proposal) {
  const edits = (proposal.candidates || []).map((c) => ({
    candidateId: c.candidateId,
    ownerState: OWNER_CANDIDATE_STATE.accepted,
    ownerText: c.proposedText,
  }));
  return saveExperienceProposalReview(actStore, userData, {
    taskId: proposal.taskId,
    proposalId: proposal.proposalId,
    expectedRevision: Number(proposal.currentRevision) || 0,
    candidates: edits,
  });
}

async function main() {
  await test("cannot create unless adopted succeeded current result (1-5)", async () => {
    const ud = tempUserData();
    const pkgDir = makePackageDir();
    try {
      const goal = "创建前置条件";
      const researched = await seedResearchedTask(ud, goal);
      const claims = confirmedClaimsFromContext(researched.subjectContext);
      const ext = projectExternalEvidenceFromTask(researched);
      const gen = await generateResearchExpressionResult({
        userData: ud,
        taskId: researched.taskId,
        store: actStore,
        skills: personalSkills,
        callModel: fakeResultCallModel(claims, ext),
        forceFake: true,
      });
      assert.equal(gen.ok, true, gen.message);

      // 1. not adopted
      const pending = await createExperienceProposal({
        userData: ud,
        taskId: researched.taskId,
        resultId: gen.result.resultId,
        store: actStore,
        packageDir: pkgDir,
        loadPackage: () => loadPackageBounded(pkgDir),
        callModel: fakeProposalCallModel(claims),
        forceFake: true,
      });
      assert.equal(pending.ok, false);
      assert.equal(pending.code, "result_not_adopted");

      // 2. rejected
      const rejected = await decideResultFromRenderer(actStore, ud, {
        taskId: researched.taskId,
        resultId: gen.result.resultId,
        decision: "rejected",
        expectedRevision: 0,
      });
      assert.equal(rejected.ok, true);
      const afterReject = await createExperienceProposal({
        userData: ud,
        taskId: researched.taskId,
        resultId: gen.result.resultId,
        store: actStore,
        packageDir: pkgDir,
        loadPackage: () => loadPackageBounded(pkgDir),
        callModel: fakeProposalCallModel(claims),
        forceFake: true,
      });
      assert.equal(afterReject.ok, false);
      assert.equal(afterReject.code, "result_not_adopted");

      // 3. failed result
      const failedTask = await seedAdoptedResult(ud, "失败成果不可提案", pkgDir);
      await actStore.saveTask(ud, {
        ...failedTask.task,
        results: failedTask.task.results.map((r) =>
          r.resultId === failedTask.result.resultId ? { ...r, status: "failed" } : r
        ),
      });
      const failedOut = await createExperienceProposal({
        userData: ud,
        taskId: failedTask.task.taskId,
        resultId: failedTask.result.resultId,
        store: actStore,
        packageDir: pkgDir,
        loadPackage: () => loadPackageBounded(pkgDir),
        callModel: fakeProposalCallModel(failedTask.claims),
        forceFake: true,
      });
      assert.equal(failedOut.ok, false);
      assert.equal(failedOut.code, "result_not_succeeded");

      // 4. interrupted result
      const intTask = await seedAdoptedResult(ud, "中断成果不可提案", pkgDir);
      await actStore.saveTask(ud, {
        ...intTask.task,
        results: intTask.task.results.map((r) =>
          r.resultId === intTask.result.resultId ? { ...r, status: "interrupted" } : r
        ),
      });
      const intOut = await createExperienceProposal({
        userData: ud,
        taskId: intTask.task.taskId,
        resultId: intTask.result.resultId,
        store: actStore,
        packageDir: pkgDir,
        loadPackage: () => loadPackageBounded(pkgDir),
        callModel: fakeProposalCallModel(intTask.claims),
        forceFake: true,
      });
      assert.equal(intOut.ok, false);
      assert.equal(intOut.code, "result_not_succeeded");

      // 5. stale result (goal change)
      const staleSeed = await seedAdoptedResult(ud, "过期成果不可提案", pkgDir);
      const changed = await saveDraftFromRenderer(actStore, ud, {
        taskId: staleSeed.task.taskId,
        goal: "完全不同的新目标",
        status: "draft",
      });
      assert.equal(changed.ok, true);
      assert.equal(changed.invalidatedConfirmed, true);
      const staleOut = await createExperienceProposal({
        userData: ud,
        taskId: staleSeed.task.taskId,
        resultId: staleSeed.result.resultId,
        store: actStore,
        packageDir: pkgDir,
        loadPackage: () => loadPackageBounded(pkgDir),
        callModel: fakeProposalCallModel(staleSeed.claims),
        forceFake: true,
      });
      assert.equal(staleOut.ok, false);
      assert.equal(staleOut.code, "result_stale");
    } finally {
      cleanup(ud);
      cleanup(pkgDir);
    }
  });

  await test("create re-reads store authority; renderer forge rejected (6-10)", async () => {
    const ud = tempUserData();
    const pkgDir = makePackageDir();
    try {
      const seeded = await seedAdoptedResult(ud, "权威重读与伪造拒绝", pkgDir);

      // Mutate store after seeding: create must re-read and see pending, not trust caller
      await actStore.saveTask(ud, {
        ...seeded.task,
        results: seeded.task.results.map((r) =>
          r.resultId === seeded.result.resultId
            ? { ...r, ownerDecision: "pending" }
            : r
        ),
      });
      const blocked = await createProposalForAdopted(ud, seeded);
      assert.equal(blocked.ok, false);
      assert.equal(blocked.code, "result_not_adopted");

      // Restore adopted and create
      await actStore.saveTask(ud, {
        ...(await actStore.getTask(ud, seeded.task.taskId)).task,
        results: seeded.task.results.map((r) =>
          r.resultId === seeded.result.resultId
            ? { ...r, ownerDecision: "adopted" }
            : r
        ),
      });
      const created = await createProposalForAdopted(ud, seeded);
      assert.equal(created.ok, true, created.message);
      assert.equal(created.proposal.status, PROPOSAL_STATUS.draft);

      const reviewed = await acceptAllCandidates(ud, created.proposal);
      assert.equal(reviewed.ok, true);

      // preview rejects renderer-forged feedback ops / changeSetId
      const forgePreview = await previewExperienceProposal({
        userData: ud,
        store: actStore,
        packageDir: pkgDir,
        payload: {
          taskId: seeded.task.taskId,
          proposalId: created.proposal.proposalId,
          expectedRevision: reviewed.proposal.currentRevision,
          ops: [{ type: "append_jsonl", path: "memory/long-term-memory.jsonl" }],
          changeSetId: "cs_forged",
        },
      });
      assert.equal(forgePreview.ok, false);
      assert.equal(forgePreview.code, "untrusted_renderer_feedback");

      const preview = await previewExperienceProposal({
        userData: ud,
        store: actStore,
        packageDir: pkgDir,
        payload: {
          taskId: seeded.task.taskId,
          proposalId: created.proposal.proposalId,
          expectedRevision: reviewed.proposal.currentRevision,
        },
      });
      assert.equal(preview.ok, true, preview.message);

      // apply rejects renderer-forged package content
      const forgeApply = await applyExperienceProposal({
        userData: ud,
        store: actStore,
        packageDir: pkgDir,
        payload: {
          taskId: seeded.task.taskId,
          proposalId: created.proposal.proposalId,
          previewId: preview.preview.previewId,
          expectedRevision: preview.proposal.currentRevision,
          confirm: true,
          packageContent: { persona: "hacked" },
          items: [{ category: "memory", correction: "sneak" }],
        },
      });
      assert.equal(forgeApply.ok, false);
      assert.equal(forgeApply.code, "untrusted_renderer_package");

      // assertCreatePreconditions uses live task, not a forged in-memory copy
      const live = (await actStore.getTask(ud, seeded.task.taskId)).task;
      const forgedCopy = {
        ...live,
        results: live.results.map((r) =>
          r.resultId === seeded.result.resultId
            ? { ...r, ownerDecision: "adopted", status: "succeeded" }
            : r
        ),
      };
      // Live still previewed/applied path — preconditions for a second create on same revision
      const pre = assertCreatePreconditions(forgedCopy, seeded.result.resultId, pkgDir);
      assert.equal(pre.ok, false);
      assert.ok(
        pre.code === "proposal_in_progress" || pre.code === "result_not_adopted",
        pre.code
      );
    } finally {
      cleanup(ud);
      cleanup(pkgDir);
    }
  });

  await test("model input bounds; unknown refs dropped; unsupported kind/URL rejected (11-18)", async () => {
    const ud = tempUserData();
    const pkgDir = makePackageDir();
    try {
      const seeded = await seedAdoptedResult(ud, "模型边界与证据过滤", pkgDir);
      const claims = seeded.claims;
      const claimId = claims[0].claimId;
      const resultExt = (seeded.result.sections && seeded.result.sections.externalEvidence) || [];
      const realRef =
        (resultExt[0] && (resultExt[0].resultRef || resultExt[0].sourceId)) ||
        projectExternalEvidenceFromTask(seeded.task).externalEvidence[0].resultRef;
      assert.ok(realRef);

      let capturedMessages = null;
      const out = await createExperienceProposal({
        userData: ud,
        taskId: seeded.task.taskId,
        resultId: seeded.result.resultId,
        store: actStore,
        packageDir: pkgDir,
        loadPackage: () => loadPackageBounded(pkgDir),
        callModel: async (messages) => {
          capturedMessages = messages;
          return {
            content: JSON.stringify({
              candidates: [
                {
                  targetKind: "memory",
                  proposedText: "合法候选：长期框架优先。",
                  rationale: "基于成果正文",
                  basedOnSubjectClaimIds: [claimId, "unknown_claim"],
                  basedOnExternalResultRefs: [realRef, "bad_ref"],
                  basedOnResultSections: ["finalDraft", "bogusSection"],
                  confidence: "high",
                  url: "https://evil.example/x",
                  packagePath: "D:/secrets",
                },
                {
                  targetKind: "tool_call",
                  proposedText: "不受支持的类型",
                  basedOnResultSections: ["finalDraft"],
                },
                {
                  targetKind: "persona",
                  proposedText: "仅外部来源伪装本人事实",
                  basedOnSubjectClaimIds: [],
                  basedOnExternalResultRefs: [realRef],
                  basedOnResultSections: ["externalEvidence"],
                  confidence: "high",
                },
                {
                  targetKind: "style",
                  proposedText: "",
                  basedOnResultSections: ["finalDraft"],
                },
              ],
            }),
            provider: "test_fake",
            usedFake: true,
          };
        },
        forceFake: true,
      });
      assert.equal(out.ok, true, out.message);
      assert.ok(capturedMessages);

      const blob = JSON.stringify(capturedMessages);
      assert.ok(!blob.includes("LONGTERM_SECRET_MARKER_NEVER_IN_PROMPT"));
      assert.ok(!blob.includes("SECRET_API_KEY_NEVER"));
      assert.ok(!blob.includes("PREFERENCES_TAIL_SECRET_MARKER_SHOULD_NOT_APPEAR"));
      assert.ok(!blob.includes("D:/fake/digital-me-package") || !blob.includes("apiKey"));
      assert.ok(blob.includes(claimId) || blob.includes("claimId="));
      assert.ok(
        out.proposal.modelInvocation.disclosedInputSummary.packageSummaryChars <= 1200
      );

      const cands = out.proposal.candidates;
      assert.ok(cands.length >= 1);
      const mem = cands.find((c) => c.targetKind === "memory");
      assert.ok(mem);
      assert.ok(mem.basedOnSubjectClaimIds.includes(claimId));
      assert.ok(!mem.basedOnSubjectClaimIds.includes("unknown_claim"));
      assert.ok(mem.basedOnExternalResultRefs.includes(realRef));
      assert.ok(!mem.basedOnExternalResultRefs.includes("bad_ref"));
      assert.ok(mem.basedOnResultSections.includes("finalDraft"));
      assert.ok(!mem.basedOnResultSections.includes("bogusSection"));
      assert.ok(!JSON.stringify(mem).includes("evil.example"));
      assert.ok(!JSON.stringify(mem).includes("D:/secrets"));
      assert.ok(!cands.some((c) => c.targetKind === "tool_call"));
      assert.ok(!cands.some((c) => (c.proposedText || "").includes("仅外部来源")));
      assert.ok(
        (out.proposal.rejectedMeta || []).some((r) => r.reason === "unsupported_targetKind")
      );
      assert.ok(
        (out.proposal.rejectedMeta || []).some((r) => r.reason === "external_only_forbidden")
      );

      // Pure materializer: URL/package never become authoritative; external-only forbidden
      const resultWithExt = {
        ...seeded.result,
        sections: {
          ...(seeded.result.sections || {}),
          externalEvidence: [
            {
              resultRef: "src_auth",
              url: "https://example.com/real",
              title: "真来源",
              provider: "fake",
            },
          ],
        },
      };
      const mat = materializeCandidates(
        {
          candidates: [
            {
              targetKind: "boundary",
              proposedText: "不得擅自对外发送。",
              basedOnSubjectClaimIds: [claimId],
              basedOnResultSections: ["finalDraft"],
              url: "https://evil.example/y",
              feedbackOp: { type: "hack" },
            },
            {
              targetKind: "persona",
              proposedText: "仅外部伪装本人",
              basedOnSubjectClaimIds: [],
              basedOnExternalResultRefs: ["src_auth"],
              // only externalEvidence → external_only_forbidden (no subject/final/inferences)
              basedOnResultSections: ["externalEvidence"],
              confidence: "high",
            },
          ],
        },
        { claims, result: resultWithExt }
      );
      assert.equal(mat.candidates.length, 1);
      assert.equal(mat.candidates[0].targetKind, "boundary");
      assert.equal(mat.candidates[0].url, undefined);
      assert.equal(mat.candidates[0].feedbackOp, undefined);
      assert.ok(mat.candidates[0].warnings.some((w) => w.includes("高风险")));
      assert.ok(mat.rejectedMeta.some((r) => r.reason === "external_only_forbidden"));

      const msgs = buildProposalMessages({
        intent: { goal: "提示边界" },
        claims: claims.slice(0, 1),
        result: seeded.result,
        packageSummary: "有界摘要",
        allowedKinds: ["memory", "style", "boundary", "persona"],
      });
      assert.equal(msgs.length, 2);
      assert.ok(msgs[1].content.includes("【成果正文"));
      assert.ok(!msgs[1].content.includes("SECRET_API_KEY"));
    } finally {
      cleanup(ud);
      cleanup(pkgDir);
    }
  });

  await test("review save/reload; originalProposedText; excluded; stale rev; boundary (19-23)", async () => {
    const ud = tempUserData();
    const pkgDir = makePackageDir();
    try {
      const seeded = await seedAdoptedResult(ud, "审阅保存与边界", pkgDir);
      const created = await createProposalForAdopted(ud, seeded);
      assert.equal(created.ok, true, created.message);
      const prop = created.proposal;
      assert.ok(prop.candidates.length >= 1);
      const cand = prop.candidates[0];
      const original = cand.originalProposedText;

      const edited = await saveExperienceProposalReview(actStore, ud, {
        taskId: seeded.task.taskId,
        proposalId: prop.proposalId,
        expectedRevision: 0,
        candidates: [
          {
            candidateId: cand.candidateId,
            ownerState: OWNER_CANDIDATE_STATE.edited,
            ownerText: "Owner 改写后的候选经验文本。",
          },
          ...prop.candidates.slice(1).map((c) => ({
            candidateId: c.candidateId,
            ownerState: OWNER_CANDIDATE_STATE.excluded,
            ownerText: c.proposedText,
          })),
        ],
      });
      assert.equal(edited.ok, true);
      assert.equal(edited.proposal.status, PROPOSAL_STATUS.reviewed);
      assert.equal(edited.proposal.currentRevision, 1);
      const kept = edited.proposal.candidates.find((c) => c.candidateId === cand.candidateId);
      assert.equal(kept.originalProposedText, original);
      assert.equal(kept.ownerText, "Owner 改写后的候选经验文本。");
      assert.equal(kept.ownerState, OWNER_CANDIDATE_STATE.edited);

      // reload from store
      const reloaded = (await actStore.getTask(ud, seeded.task.taskId)).task;
      const fromStore = reloaded.proposals.find((p) => p.proposalId === prop.proposalId);
      assert.ok(fromStore);
      assert.equal(fromStore.currentRevision, 1);
      assert.equal(
        fromStore.candidates.find((c) => c.candidateId === cand.candidateId).originalProposedText,
        original
      );

      // excluded not in preview feedback items
      const items = projectFeedbackItems(fromStore);
      assert.ok(items.every((it) => it.candidateId === cand.candidateId));
      assert.ok(!items.some((it) => {
        const c = fromStore.candidates.find((x) => x.candidateId === it.candidateId);
        return c && c.ownerState === OWNER_CANDIDATE_STATE.excluded;
      }));

      // stale revision
      const stale = await saveExperienceProposalReview(actStore, ud, {
        taskId: seeded.task.taskId,
        proposalId: prop.proposalId,
        expectedRevision: 0,
        candidates: [
          {
            candidateId: cand.candidateId,
            ownerState: OWNER_CANDIDATE_STATE.accepted,
            ownerText: "过期覆盖",
          },
        ],
      });
      assert.equal(stale.ok, false);
      assert.equal(stale.code, "stale_revision");

      // save boundary keeps proposals (renderer cannot wipe)
      const beforeCount = fromStore ? reloaded.proposals.length : 0;
      const draft = await saveDraftFromRenderer(actStore, ud, {
        taskId: seeded.task.taskId,
        goal: "审阅保存与边界",
        proposals: [],
        proposal: { proposalId: "hack" },
        candidates: [{ proposedText: "forge" }],
      });
      assert.equal(draft.ok, true);
      assert.equal(draft.task.proposals.length, beforeCount);
      assert.ok(draft.task.proposals.some((p) => p.proposalId === prop.proposalId));
      assert.ok(!draft.task.proposals.some((p) => p.proposalId === "hack"));
    } finally {
      cleanup(ud);
      cleanup(pkgDir);
    }
  });

  await test("real previewFeedback; fingerprint unchanged; no accepted blocks; stores preview (24-29)", async () => {
    const ud = tempUserData();
    const pkgDir = makePackageDir();
    try {
      assert.equal(typeof feedback.previewFeedback, "function");
      const seeded = await seedAdoptedResult(ud, "预览不写包", pkgDir);
      const created = await createProposalForAdopted(ud, seeded);
      assert.equal(created.ok, true, created.message);

      // no accepted → block
      const blocked = await previewExperienceProposal({
        userData: ud,
        store: actStore,
        packageDir: pkgDir,
        payload: {
          taskId: seeded.task.taskId,
          proposalId: created.proposal.proposalId,
          expectedRevision: 0,
        },
      });
      assert.equal(blocked.ok, false);
      assert.equal(blocked.code, "no_accepted_candidates");

      const reviewed = await acceptAllCandidates(ud, created.proposal);
      assert.equal(reviewed.ok, true);

      const beforeFp = fingerprintPackage(pkgDir);
      const beforeMan = readManifest(pkgDir);
      const beforeRev = beforeMan && beforeMan.revision;

      const preview = await previewExperienceProposal({
        userData: ud,
        store: actStore,
        packageDir: pkgDir,
        payload: {
          taskId: seeded.task.taskId,
          proposalId: created.proposal.proposalId,
          expectedRevision: reviewed.proposal.currentRevision,
        },
      });
      assert.equal(preview.ok, true, preview.message);
      assert.equal(preview.proposal.status, PROPOSAL_STATUS.previewed);
      assert.ok(preview.preview.previewId);
      assert.ok(preview.preview.changeSetId);
      assert.ok(preview.preview.changes);
      assert.ok(Array.isArray(preview.preview.acceptedCandidateIds));
      assert.ok(preview.preview.acceptedCandidateIds.length >= 1);

      const afterFp = fingerprintPackage(pkgDir);
      assert.equal(afterFp, beforeFp, "preview must not modify package content fingerprint");
      const afterMan = readManifest(pkgDir);
      assert.equal(afterMan.revision, beforeRev);

      // changeset exists under store root (side channel), not package content
      const csPath = path.join(
        storeRootFor(pkgDir),
        "changesets",
        `${preview.preview.changeSetId}.json`
      );
      assert.equal(fs.existsSync(csPath), true);

      // reloaded proposal stores preview
      const got = (await actStore.getTask(ud, seeded.task.taskId)).task;
      const p = got.proposals.find((x) => x.proposalId === created.proposal.proposalId);
      assert.equal(p.status, PROPOSAL_STATUS.previewed);
      assert.equal(p.preview.previewId, preview.preview.previewId);
    } finally {
      cleanup(ud);
      cleanup(pkgDir);
    }
  });

  await test("apply needs confirm; real applyFeedback; revision/rollback; no side writes (30-39)", async () => {
    const ud = tempUserData();
    const pkgDir = makePackageDir();
    try {
      assert.equal(typeof feedback.applyFeedback, "function");
      const seeded = await seedAdoptedResult(ud, "确认写入主体资料包", pkgDir);
      const created = await createProposalForAdopted(ud, seeded);
      const reviewed = await acceptAllCandidates(ud, created.proposal);
      const preview = await previewExperienceProposal({
        userData: ud,
        store: actStore,
        packageDir: pkgDir,
        payload: {
          taskId: seeded.task.taskId,
          proposalId: created.proposal.proposalId,
          expectedRevision: reviewed.proposal.currentRevision,
        },
      });
      assert.equal(preview.ok, true, preview.message);

      const baseRev = Number(readManifest(pkgDir).revision);
      const beforeInv = seeded.task.invocations.length;
      const beforeResults = seeded.task.results.length;
      const beforeDecision = seeded.result.ownerDecision;

      // 30. confirm required
      const noConfirm = await applyExperienceProposal({
        userData: ud,
        store: actStore,
        packageDir: pkgDir,
        payload: {
          taskId: seeded.task.taskId,
          proposalId: created.proposal.proposalId,
          previewId: preview.preview.previewId,
          expectedRevision: preview.proposal.currentRevision,
          confirm: false,
        },
      });
      assert.equal(noConfirm.ok, false);
      assert.equal(noConfirm.code, "confirmation_required");
      assert.equal(Number(readManifest(pkgDir).revision), baseRev);

      // 31-34. real apply
      const applied = await applyExperienceProposal({
        userData: ud,
        store: actStore,
        packageDir: pkgDir,
        payload: {
          taskId: seeded.task.taskId,
          proposalId: created.proposal.proposalId,
          previewId: preview.preview.previewId,
          expectedRevision: preview.proposal.currentRevision,
          confirm: true,
        },
      });
      assert.equal(applied.ok, true, applied.message);
      assert.equal(applied.proposal.status, PROPOSAL_STATUS.applied);
      assert.equal(applied.apply.status, "succeeded");
      const afterRev = Number(readManifest(pkgDir).revision);
      assert.ok(afterRev > baseRev, "package revision must bump");
      assert.equal(String(applied.apply.packageResultVersion), String(afterRev));
      assert.ok(applied.apply.rollbackVersion != null);

      // snapshots retained
      const snaps = fs.readdirSync(path.join(storeRootFor(pkgDir), "snapshots"));
      assert.ok(snaps.length >= 1);

      // 35-36. does not change ownerDecision / results / invocations
      const afterTask = (await actStore.getTask(ud, seeded.task.taskId)).task;
      assert.equal(afterTask.invocations.length, beforeInv);
      assert.equal(afterTask.results.length, beforeResults);
      const res = afterTask.results.find((r) => r.resultId === seeded.result.resultId);
      assert.equal(res.ownerDecision, beforeDecision);
      assert.equal(res.ownerDecision, "adopted");

      // memory or style/persona should contain applied text
      const mem = fs.readFileSync(
        path.join(pkgDir, "memory", "long-term-memory.jsonl"),
        "utf8"
      );
      const persona = fs.readFileSync(path.join(pkgDir, "persona.md"), "utf8");
      const style = fs.readFileSync(path.join(pkgDir, "style-guide.md"), "utf8");
      const joined = mem + persona + style;
      assert.ok(
        joined.includes("公开市场") || joined.includes("用户纠正") || joined.includes("长期"),
        "applied content should appear in package"
      );

      // 37. duplicate apply rejected
      const dup = await applyExperienceProposal({
        userData: ud,
        store: actStore,
        packageDir: pkgDir,
        payload: {
          taskId: seeded.task.taskId,
          proposalId: created.proposal.proposalId,
          previewId: preview.preview.previewId,
          expectedRevision: applied.proposal.currentRevision,
          confirm: true,
        },
      });
      assert.equal(dup.ok, false);
      assert.ok(
        dup.code === "proposal_already_applied" ||
          dup.code === "proposal_not_previewed" ||
          dup.code === "proposal_not_editable",
        dup.code
      );

      // 38-39. apply fail → not applied (fresh proposal, delete changeset after preview)
      const seeded2 = await seedAdoptedResult(ud, "应用失败不落库", pkgDir);
      const created2 = await createProposalForAdopted(ud, seeded2);
      const reviewed2 = await acceptAllCandidates(ud, created2.proposal);
      const preview2 = await previewExperienceProposal({
        userData: ud,
        store: actStore,
        packageDir: pkgDir,
        payload: {
          taskId: seeded2.task.taskId,
          proposalId: created2.proposal.proposalId,
          expectedRevision: reviewed2.proposal.currentRevision,
        },
      });
      assert.equal(preview2.ok, true, preview2.message);
      const revBeforeFail = Number(readManifest(pkgDir).revision);
      const fpBeforeFail = fingerprintPackage(pkgDir);
      fs.rmSync(
        path.join(storeRootFor(pkgDir), "changesets", `${preview2.preview.changeSetId}.json`),
        { force: true }
      );
      const failedApply = await applyExperienceProposal({
        userData: ud,
        store: actStore,
        packageDir: pkgDir,
        payload: {
          taskId: seeded2.task.taskId,
          proposalId: created2.proposal.proposalId,
          previewId: preview2.preview.previewId,
          expectedRevision: preview2.proposal.currentRevision,
          confirm: true,
        },
      });
      assert.equal(failedApply.ok, false);
      assert.notEqual(failedApply.proposal.status, PROPOSAL_STATUS.applied);
      assert.equal(failedApply.proposal.status, PROPOSAL_STATUS.previewed);
      assert.equal(Number(readManifest(pkgDir).revision), revBeforeFail);
      assert.equal(fingerprintPackage(pkgDir), fpBeforeFail);
    } finally {
      cleanup(ud);
      cleanup(pkgDir);
    }
  });

  await test("goal/context/result revision invalidate; heal; legacy; reject no write (40-45)", async () => {
    const ud = tempUserData();
    const pkgDir = makePackageDir();
    try {
      const seeded = await seedAdoptedResult(ud, "失效与恢复", pkgDir);
      const created = await createProposalForAdopted(ud, seeded);
      assert.equal(created.ok, true, created.message);
      const proposalId = created.proposal.proposalId;

      // 40. goal change marks proposals stale
      const goalChanged = await saveDraftFromRenderer(actStore, ud, {
        taskId: seeded.task.taskId,
        goal: "目标已变更导致提案失效",
        status: "draft",
      });
      assert.equal(goalChanged.ok, true);
      const staleByGoal = goalChanged.task.proposals.find((p) => p.proposalId === proposalId);
      assert.equal(staleByGoal.stale, true);

      // fresh seed for context / result revision
      const seeded2 = await seedAdoptedResult(ud, "上下文与修订失效", pkgDir);
      const created2 = await createProposalForAdopted(ud, seeded2);
      assert.equal(created2.ok, true);

      // 41. subject context version bump → result not current → proposal not applicable for preview
      const bumped = {
        ...created2.task,
        subjectContext: {
          ...created2.task.subjectContext,
          version: String(created2.task.subjectContext.version || "1") + "_v2",
          subjectVersion: String(created2.task.subjectContext.subjectVersion || "1") + "_v2",
        },
      };
      await actStore.saveTask(ud, bumped);
      const reviewed2 = await acceptAllCandidates(ud, created2.proposal);
      // review may fail if we somehow marked stale — if review ok, preview should fail result_stale
      if (reviewed2.ok) {
        const prev = await previewExperienceProposal({
          userData: ud,
          store: actStore,
          packageDir: pkgDir,
          payload: {
            taskId: seeded2.task.taskId,
            proposalId: created2.proposal.proposalId,
            expectedRevision: reviewed2.proposal.currentRevision,
          },
        });
        assert.equal(prev.ok, false);
        assert.ok(prev.code === "result_stale" || prev.code === "proposal_stale", prev.code);
      }

      // 42. result revision invalidate
      const seeded3 = await seedAdoptedResult(ud, "成果修订使提案失效", pkgDir);
      const created3 = await createProposalForAdopted(ud, seeded3);
      assert.equal(created3.ok, true);
      const editedResult = await saveResultDraftFromRenderer(actStore, ud, {
        taskId: seeded3.task.taskId,
        resultId: seeded3.result.resultId,
        currentText: "Owner 修改了成果正文，提案应失效。",
        expectedRevision: Number(seeded3.result.currentRevision) || 0,
      });
      assert.equal(editedResult.ok, true);
      const staleByResult = editedResult.task.proposals.find(
        (p) => p.proposalId === created3.proposal.proposalId
      );
      assert.equal(staleByResult.stale, true);

      // 43. heal generating → interrupted
      const healed = healRunningProposals([
        { proposalId: "p1", status: PROPOSAL_STATUS.generating },
        { proposalId: "p2", status: PROPOSAL_STATUS.previewing },
        { proposalId: "p3", status: PROPOSAL_STATUS.draft },
      ]);
      assert.equal(healed.changed, true);
      assert.equal(healed.proposals[0].status, PROPOSAL_STATUS.interrupted);
      assert.equal(healed.proposals[1].status, PROPOSAL_STATUS.interrupted);
      assert.equal(healed.proposals[2].status, PROPOSAL_STATUS.draft);

      await actStore.saveTask(ud, {
        ...(await actStore.getTask(ud, seeded3.task.taskId)).task,
        proposals: [
          {
            proposalId: "prop_running_heal",
            status: PROPOSAL_STATUS.generating,
            resultId: seeded3.result.resultId,
            candidates: [],
          },
        ],
      });
      const gotHeal = actStore.getTask(ud, seeded3.task.taskId);
      assert.equal(
        gotHeal.task.proposals.find((p) => p.proposalId === "prop_running_heal").status,
        PROPOSAL_STATUS.interrupted
      );

      // 44. legacy missing proposals → []
      const legacy = await actStore.saveTask(ud, {
        taskId: "abt_legacy_b4",
        title: "旧任务",
        request: "旧请求",
        status: "completed",
        selectedSelfContext: {
          items: [{ source: "persona", label: "人格", text: "本地优先" }],
          combinedText: "本地优先",
          userEdited: true,
        },
      });
      assert.equal(legacy.ok, true);
      const legacyGot = actStore.getTask(ud, "abt_legacy_b4");
      assert.ok(Array.isArray(legacyGot.task.proposals));
      assert.equal(legacyGot.task.proposals.length, 0);

      // 45. reject does not write package
      const seeded4 = await seedAdoptedResult(ud, "拒绝不写包", pkgDir);
      const created4 = await createProposalForAdopted(ud, seeded4);
      const fpBefore = fingerprintPackage(pkgDir);
      const revBefore = readManifest(pkgDir).revision;
      const rejected = await rejectExperienceProposal(actStore, ud, {
        taskId: seeded4.task.taskId,
        proposalId: created4.proposal.proposalId,
        expectedRevision: 0,
      });
      assert.equal(rejected.ok, true);
      assert.equal(rejected.proposal.status, PROPOSAL_STATUS.rejected);
      assert.equal(fingerprintPackage(pkgDir), fpBefore);
      assert.equal(readManifest(pkgDir).revision, revBefore);
    } finally {
      cleanup(ud);
      cleanup(pkgDir);
    }
  });

  await test("no search during proposal; no auto next proposal (46-49)", async () => {
    const ud = tempUserData();
    const pkgDir = makePackageDir();
    try {
      searchCalls = 0;
      const seeded = await seedAdoptedResult(ud, "无搜索无自动下一提案", pkgDir);
      const searchesAfterSeed = searchCalls;
      assert.ok(searchesAfterSeed >= 1);

      const created = await createProposalForAdopted(ud, seeded);
      assert.equal(created.ok, true, created.message);
      assert.equal(searchCalls, searchesAfterSeed, "proposal must not call searchWeb");

      const afterCreate = (await actStore.getTask(ud, seeded.task.taskId)).task;
      const openDrafts = afterCreate.proposals.filter(
        (p) => p && p.status === PROPOSAL_STATUS.draft && !p.stale
      );
      assert.equal(openDrafts.length, 1, "exactly one draft proposal; no auto second");

      const reviewed = await acceptAllCandidates(ud, created.proposal);
      const preview = await previewExperienceProposal({
        userData: ud,
        store: actStore,
        packageDir: pkgDir,
        payload: {
          taskId: seeded.task.taskId,
          proposalId: created.proposal.proposalId,
          expectedRevision: reviewed.proposal.currentRevision,
        },
      });
      assert.equal(preview.ok, true, preview.message);
      const applied = await applyExperienceProposal({
        userData: ud,
        store: actStore,
        packageDir: pkgDir,
        payload: {
          taskId: seeded.task.taskId,
          proposalId: created.proposal.proposalId,
          previewId: preview.preview.previewId,
          expectedRevision: preview.proposal.currentRevision,
          confirm: true,
        },
      });
      assert.equal(applied.ok, true, applied.message);
      assert.equal(searchCalls, searchesAfterSeed);

      const afterApply = (await actStore.getTask(ud, seeded.task.taskId)).task;
      const autoNext = afterApply.proposals.filter(
        (p) =>
          p &&
          p.proposalId !== created.proposal.proposalId &&
          (p.status === PROPOSAL_STATUS.draft ||
            p.status === PROPOSAL_STATUS.generating ||
            p.status === PROPOSAL_STATUS.reviewed)
      );
      assert.equal(autoNext.length, 0, "apply must not auto-create next proposal");
      assert.equal(
        afterApply.proposals.filter((p) => p.status === PROPOSAL_STATUS.applied).length,
        1
      );
    } finally {
      cleanup(ud);
      cleanup(pkgDir);
    }
  });

  console.log("\nvl1 block4 contracts:", passed, "passed,", failed, "failed");
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
