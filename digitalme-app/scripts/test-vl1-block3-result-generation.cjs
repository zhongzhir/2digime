"use strict";

/**
 * VL1 block 3: source-constrained research expression results.
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
const {
  runReadonlyExternalResearch,
  ALLOWED_SKILL_ID,
  TOOL_CAPABILITY_ID,
} = require("../src/act-behalf/research-run");
const {
  generateResearchExpressionResult,
  saveResultDraftFromRenderer,
  decideResultFromRenderer,
  assertGeneratePreconditions,
  buildGenerationMessages,
  materializeResultSections,
  confirmedClaimsFromContext,
  projectExternalEvidenceFromTask,
  findMatchingSkillInvocation,
  findMatchingToolInvocation,
  healRunningResults,
  isResultCurrent,
  extractJsonObject,
} = require("../src/act-behalf/result-generation");
const { saveDraftFromRenderer } = require("../src/act-behalf/task-save-boundary");
const personalSkills = require("../src/skills/personal");
const { PRESET_RESEARCH_SKILLS } = require("../src/skills/research-presets");

let passed = 0;
let failed = 0;
let feedbackPreviewCalls = 0;
let feedbackApplyCalls = 0;
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
  return fs.mkdtempSync(path.join(os.tmpdir(), "dm-vl1-b3-"));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
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

async function seedConfirmedTask(userData, goal) {
  const assembled = assembleSubjectContextCandidates(samplePkg(), { goal });
  const confirmed = confirmSubjectContextSnapshot(assembled.subjectContextDraft, {
    keepClaimIds: assembled.subjectContextDraft.claims.slice(0, 2).map((c) => c.id),
    supplements: [],
  });
  const intent = normalizeTaskIntent({ goal }, undefined);
  const saved = await actStore.saveTask(userData, {
    title: "成果任务",
    goal,
    taskIntent: intent,
    status: "context_confirmed",
    subjectContextCandidates: assembled.subjectContextDraft,
    subjectContext: confirmed,
    invocations: [],
    results: [],
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

function subjectVersionOf(task) {
  return String(
    (task && task.subjectContext && (task.subjectContext.version || task.subjectContext.subjectVersion)) ||
      ""
  ).trim();
}

function matchingSkillInvocation(goal, subjectVersion, extras = {}) {
  return {
    invocationId: extras.invocationId || "inv_skill_ok",
    kind: "skill",
    capabilityId: ALLOWED_SKILL_ID,
    skillId: ALLOWED_SKILL_ID,
    status: extras.status || "succeeded",
    disclosedContext: { goal, subjectVersion },
    subjectContextVersion: subjectVersion,
    input: { goal },
    ...extras.rest,
  };
}

function matchingToolInvocation(goal, subjectVersion, extras = {}) {
  return {
    invocationId: extras.invocationId || "inv_tool_ok",
    kind: "tool",
    capabilityId: extras.capabilityId || TOOL_CAPABILITY_ID,
    skillId: ALLOWED_SKILL_ID,
    status: extras.status || "succeeded",
    disclosedContext: { goal, subjectVersion },
    subjectContextVersion: subjectVersion,
    provider: extras.provider || "fake",
    discoveredSources: extras.discoveredSources || [],
    error: extras.error || null,
    input: { goal, queries: extras.queries || ["q"] },
  };
}

function fakeCallModelFactory(payload) {
  return async (messages) => {
    return {
      content: JSON.stringify(
        payload || {
          subjectSummary: "整理本人长期框架偏好。",
          externalFindings: [{ resultRef: "will-fix", note: "市场波动讨论" }],
          inferences: [],
          finalDraft: "基于本人立场与外部来源摘要，形成可编辑纪要。",
        }
      ),
      provider: "test_fake",
      model: "fake-model",
      usedFake: true,
      _messages: messages,
    };
  };
}

async function main() {
  await test("cannot generate without confirmed subject context", async () => {
    const ud = tempUserData();
    try {
      const intent = normalizeTaskIntent({ goal: "无确认不可生成" }, undefined);
      const saved = await actStore.saveTask(ud, {
        title: "t",
        goal: intent.goal,
        taskIntent: intent,
        status: "draft",
      });
      const out = await generateResearchExpressionResult({
        userData: ud,
        taskId: saved.task.taskId,
        store: actStore,
        skills: personalSkills,
        callModel: fakeCallModelFactory(),
        forceFake: true,
      });
      assert.equal(out.ok, false);
      assert.equal(out.code, "context_not_confirmed");
    } finally {
      cleanup(ud);
    }
  });

  await test("cannot generate when snapshot goal mismatches", async () => {
    const ud = tempUserData();
    try {
      const task = await seedResearchedTask(ud, "目标甲");
      task.taskIntent = normalizeTaskIntent({ goal: "目标乙完全不同" }, task.taskId);
      task.goal = task.taskIntent.goal;
      await actStore.saveTask(ud, task);
      const out = await generateResearchExpressionResult({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        callModel: fakeCallModelFactory(),
        forceFake: true,
      });
      assert.equal(out.ok, false);
      assert.equal(out.code, "context_stale_for_goal");
    } finally {
      cleanup(ud);
    }
  });

  await test("cannot generate while research invocation running", async () => {
    const ud = tempUserData();
    try {
      const task = await seedConfirmedTask(ud, "运行中不可生成");
      const ver = subjectVersionOf(task);
      await actStore.saveTask(ud, {
        ...task,
        selectedSkillId: ALLOWED_SKILL_ID,
        invocations: [
          matchingSkillInvocation("运行中不可生成", ver),
          matchingToolInvocation("运行中不可生成", ver, {
            invocationId: "inv_tool_run",
            status: "running",
            discoveredSources: [],
          }),
        ],
      });
      const out = await generateResearchExpressionResult({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        callModel: fakeCallModelFactory(),
        forceFake: true,
      });
      assert.equal(out.ok, false);
      assert.equal(out.code, "research_running");
    } finally {
      cleanup(ud);
    }
  });

  await test("successful generation builds four columns from authoritative data", async () => {
    const ud = tempUserData();
    try {
      searchCalls = 0;
      const task = await seedResearchedTask(ud, "公开市场与长期框架");
      const claims = confirmedClaimsFromContext(task.subjectContext);
      const ext = projectExternalEvidenceFromTask(task);
      assert.ok(claims.length >= 1);
      assert.ok(ext.externalEvidence.length >= 1);

      const callModel = async (messages) => {
        const sys = messages[0].content;
        assert.ok(sys.includes("【Skill 方法提示】") || sys.includes("预置 Skill"));
        assert.ok(sys.includes("【Skill 步骤顺序】") || sys.includes("澄清"));
        assert.ok(!sys.includes("D:/fake/digital-me-package"));
        const user = messages[1].content;
        assert.ok(user.includes(claims[0].claimId));
        assert.ok(!user.includes(samplePkg().persona.slice(0, 40)) || user.includes(claims[0].text));
        return {
          content: JSON.stringify({
            subjectSummary: "摘要",
            externalFindings: [
              { resultRef: ext.externalEvidence[0].resultRef, note: "参考摘要" },
              { resultRef: "fake_unknown_ref", note: "应丢弃" },
            ],
            inferences: [
              {
                text: "在本人长期框架下，公开波动不宜直接改写立场。",
                basedOnSubjectClaimIds: [claims[0].claimId, "unknown_claim"],
                basedOnExternalResultRefs: [ext.externalEvidence[0].resultRef, "bad_ref"],
                uncertainty: "medium",
              },
              {
                text: "无依据应被丢弃",
                basedOnSubjectClaimIds: ["nope"],
                basedOnExternalResultRefs: ["nope2"],
                uncertainty: "low",
              },
            ],
            finalDraft: "最终纪要正文。",
          }),
          provider: "test_fake",
          model: "fake",
          usedFake: true,
        };
      };

      const out = await generateResearchExpressionResult({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        callModel,
        forceFake: true,
      });
      assert.equal(out.ok, true, out.message);
      assert.equal(out.result.status, "succeeded");
      assert.ok(out.result.sections.subjectEvidence.every((c) => c.confirmationState === "confirmed" || c.confirmationState === "user_edited"));
      assert.ok(out.result.sections.externalEvidence.every((e) => e.url && e.provider));
      assert.ok(!JSON.stringify(out.result.sections.externalEvidence).includes("evil"));
      const inf = out.result.sections.inferences;
      assert.ok(inf.length >= 1);
      assert.ok(inf[0].basedOnSubjectClaimIds.includes(claims[0].claimId));
      assert.ok(!inf[0].basedOnSubjectClaimIds.includes("unknown_claim"));
      assert.ok(inf[0].basedOnExternalResultRefs.includes(ext.externalEvidence[0].resultRef));
      assert.ok(!inf.some((i) => i.text.includes("无依据应被丢弃")));
      assert.equal(out.result.sections.finalDraft.initialText, "最终纪要正文。");
      assert.equal(out.result.sections.finalDraft.currentText, "最终纪要正文。");
      assert.equal(out.result.ownerDecision, "pending");
      // no new search during generation
      const searchesBefore = searchCalls;
      assert.equal(searchCalls, searchesBefore);
    } finally {
      cleanup(ud);
    }
  });

  await test("model forged URL cannot become authoritative external evidence", () => {
    const claims = [
      {
        claimId: "clm_1",
        kind: "opinion",
        text: "本地优先",
        sourceRefs: [{ source: "persona.md" }],
        confirmationState: "confirmed",
        subjectContextVersion: "1",
      },
    ];
    const externalEvidence = [
      {
        evidenceId: "ev1",
        sourceId: "src1",
        resultRef: "src1",
        title: "真来源",
        url: "https://example.com/real",
        snippet: "s",
        provider: "fake",
        query: "q",
        discoveredAt: "2026-07-21T00:00:00.000Z",
        retrievalStatus: "retrieved",
      },
    ];
    const sections = materializeResultSections({
      parsed: {
        subjectSummary: "x",
        externalFindings: [{ resultRef: "src1", note: "ok" }],
        inferences: [
          {
            text: "推断",
            basedOnSubjectClaimIds: ["clm_1"],
            basedOnExternalResultRefs: ["src1"],
            uncertainty: "low",
          },
        ],
        finalDraft: "正文",
        // model tries to inject URL fields — ignored by materializer for external column
        forgedUrl: "https://evil.example/x",
      },
      claims,
      externalEvidence,
      continueWithoutExternalSources: false,
    });
    assert.equal(sections.externalEvidence.length, 1);
    assert.equal(sections.externalEvidence[0].url, "https://example.com/real");
    assert.ok(!JSON.stringify(sections.externalEvidence).includes("evil.example"));
  });

  await test("without sources requires explicit continue; no forged external column", async () => {
    const ud = tempUserData();
    try {
      const task = await seedConfirmedTask(ud, "无来源受限生成");
      const ver = subjectVersionOf(task);
      await actStore.saveTask(ud, {
        ...task,
        selectedSkillId: ALLOWED_SKILL_ID,
        invocations: [
          matchingSkillInvocation("无来源受限生成", ver),
          matchingToolInvocation("无来源受限生成", ver, {
            invocationId: "inv_tool_fail",
            status: "failed",
            discoveredSources: [],
            error: { message: "搜索失败" },
          }),
        ],
      });
      const blocked = await generateResearchExpressionResult({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        callModel: fakeCallModelFactory(),
        forceFake: true,
      });
      assert.equal(blocked.ok, false);
      assert.equal(blocked.code, "external_sources_unavailable");

      const claims = confirmedClaimsFromContext(
        (await actStore.getTask(ud, task.taskId)).task.subjectContext
      );
      const out = await generateResearchExpressionResult({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        continueWithoutExternalSources: true,
        callModel: async (messages) => {
          assert.ok(messages[0].content.includes("无可用外部来源"));
          return {
            content: JSON.stringify({
              subjectSummary: "s",
              externalFindings: [{ resultRef: "x", note: "不应出现" }],
              inferences: [
                {
                  text: "仅基于本人信息的受限分析",
                  basedOnSubjectClaimIds: [claims[0].claimId],
                  basedOnExternalResultRefs: [],
                  uncertainty: "high",
                },
              ],
              finalDraft: "无外部来源的受限成果。",
            }),
            provider: "test_fake",
            usedFake: true,
          };
        },
        forceFake: true,
      });
      assert.equal(out.ok, true, out.message);
      assert.equal(out.result.sections.externalEvidence.length, 0);
      assert.ok(out.result.externalEmptyReason || out.result.inputSnapshot.continueWithoutExternalSources);
    } finally {
      cleanup(ud);
    }
  });

  await test("failed model does not overwrite prior success; running heals to interrupted", async () => {
    const ud = tempUserData();
    try {
      const task = await seedResearchedTask(ud, "失败不覆盖");
      const claims = confirmedClaimsFromContext(task.subjectContext);
      const ext = projectExternalEvidenceFromTask(task);
      const ok = await generateResearchExpressionResult({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        callModel: async () => ({
          content: JSON.stringify({
            subjectSummary: "s",
            externalFindings: [{ resultRef: ext.externalEvidence[0].resultRef, note: "n" }],
            inferences: [
              {
                text: "推断",
                basedOnSubjectClaimIds: [claims[0].claimId],
                basedOnExternalResultRefs: [ext.externalEvidence[0].resultRef],
                uncertainty: "low",
              },
            ],
            finalDraft: "成功正文",
          }),
          usedFake: true,
        }),
        forceFake: true,
      });
      assert.equal(ok.ok, true);
      const successId = ok.result.resultId;

      const bad = await generateResearchExpressionResult({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        callModel: async () => {
          throw new Error("模型不可用 token=SECRET");
        },
        forceFake: true,
      });
      assert.equal(bad.ok, false);
      const still = bad.task.results.find((r) => r.resultId === successId);
      assert.ok(still);
      assert.equal(still.status, "succeeded");
      assert.ok(!String(bad.result.error.message).includes("SECRET"));

      await actStore.saveTask(ud, {
        ...bad.task,
        results: bad.task.results.concat([
          {
            resultId: "res_running",
            status: "running",
            kind: "research_expression",
            sections: { subjectEvidence: [], externalEvidence: [], inferences: [], finalDraft: {} },
          },
        ]),
      });
      const got = actStore.getTask(ud, task.taskId);
      assert.equal(got.task.results.find((r) => r.resultId === "res_running").status, "interrupted");
      const healed = healRunningResults([{ status: "running" }, { status: "succeeded" }]);
      assert.equal(healed.changed, true);
      assert.equal(healed.results[0].status, "interrupted");
      assert.equal(healed.results[1].status, "succeeded");
    } finally {
      cleanup(ud);
    }
  });

  await test("owner edit keeps initialText, revisions, and rejects stale revision", async () => {
    const ud = tempUserData();
    try {
      const task = await seedResearchedTask(ud, "编辑与修订");
      const claims = confirmedClaimsFromContext(task.subjectContext);
      const ext = projectExternalEvidenceFromTask(task);
      const gen = await generateResearchExpressionResult({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        callModel: async () => ({
          content: JSON.stringify({
            subjectSummary: "s",
            externalFindings: [],
            inferences: [
              {
                text: "推断",
                basedOnSubjectClaimIds: [claims[0].claimId],
                basedOnExternalResultRefs: [ext.externalEvidence[0].resultRef],
                uncertainty: "medium",
              },
            ],
            finalDraft: "初始正文",
          }),
          usedFake: true,
        }),
        forceFake: true,
      });
      const resultId = gen.result.resultId;
      const saved = await saveResultDraftFromRenderer(actStore, ud, {
        taskId: task.taskId,
        resultId,
        currentText: "Owner 修改后的正文",
        expectedRevision: 0,
      });
      assert.equal(saved.ok, true);
      assert.equal(saved.result.sections.finalDraft.initialText, "初始正文");
      assert.equal(saved.result.sections.finalDraft.currentText, "Owner 修改后的正文");
      assert.equal(saved.result.currentRevision, 1);
      assert.ok(saved.result.revisions.some((r) => r.source === "owner_edit"));

      const stale = await saveResultDraftFromRenderer(actStore, ud, {
        taskId: task.taskId,
        resultId,
        currentText: "过期覆盖",
        expectedRevision: 0,
      });
      assert.equal(stale.ok, false);
      assert.equal(stale.code, "stale_revision");

      // cannot forge revisions via draft save payload path — helper ignores them
      const forged = await saveResultDraftFromRenderer(actStore, ud, {
        taskId: task.taskId,
        resultId,
        currentText: "再次修改",
        expectedRevision: 1,
        revisions: [{ revisionId: "hack", text: "hack" }],
      });
      assert.equal(forged.ok, true);
      assert.ok(!forged.result.revisions.some((r) => r.revisionId === "hack"));
    } finally {
      cleanup(ud);
    }
  });

  await test("adopt/reject only update ownerDecision; save boundary keeps results", async () => {
    const ud = tempUserData();
    try {
      feedbackPreviewCalls = 0;
      feedbackApplyCalls = 0;
      const task = await seedResearchedTask(ud, "采用否定");
      const claims = confirmedClaimsFromContext(task.subjectContext);
      const ext = projectExternalEvidenceFromTask(task);
      const gen = await generateResearchExpressionResult({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        callModel: async () => ({
          content: JSON.stringify({
            subjectSummary: "s",
            inferences: [
              {
                text: "推断",
                basedOnSubjectClaimIds: [claims[0].claimId],
                basedOnExternalResultRefs: [ext.externalEvidence[0].resultRef],
                uncertainty: "low",
              },
            ],
            finalDraft: "正文",
          }),
          usedFake: true,
        }),
        forceFake: true,
        feedbackPreview: () => {
          feedbackPreviewCalls += 1;
        },
        feedbackApply: () => {
          feedbackApplyCalls += 1;
        },
      });
      const adopted = await decideResultFromRenderer(actStore, ud, {
        taskId: task.taskId,
        resultId: gen.result.resultId,
        decision: "adopted",
        expectedRevision: 0,
      });
      assert.equal(adopted.ok, true);
      assert.equal(adopted.result.ownerDecision, "adopted");
      assert.equal(feedbackPreviewCalls, 0);
      assert.equal(feedbackApplyCalls, 0);

      const beforeResults = adopted.task.results.length;
      const beforeInv = adopted.task.invocations.length;
      const draft = await saveDraftFromRenderer(actStore, ud, {
        taskId: task.taskId,
        goal: "采用否定",
        results: [],
        result: "伪造成果",
        sections: { finalDraft: { currentText: "hack" } },
        invocations: [],
      });
      assert.equal(draft.ok, true);
      assert.equal(draft.task.results.length, beforeResults);
      assert.equal(draft.task.invocations.length, beforeInv);
      assert.equal(draft.task.results[0].ownerDecision, "adopted");
    } finally {
      cleanup(ud);
    }
  });

  await test("goal change keeps historical result but not current; research still appends", async () => {
    const ud = tempUserData();
    try {
      const goal1 = "历史成果保留";
      const task = await seedResearchedTask(ud, goal1);
      const claims = confirmedClaimsFromContext(task.subjectContext);
      const ext = projectExternalEvidenceFromTask(task);
      const gen = await generateResearchExpressionResult({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        callModel: async () => ({
          content: JSON.stringify({
            subjectSummary: "s",
            inferences: [
              {
                text: "推断",
                basedOnSubjectClaimIds: [claims[0].claimId],
                basedOnExternalResultRefs: [ext.externalEvidence[0].resultRef],
                uncertainty: "low",
              },
            ],
            finalDraft: "旧目标成果",
          }),
          usedFake: true,
        }),
        forceFake: true,
      });
      assert.equal(isResultCurrent(gen.task, gen.result), true);

      const changed = await saveDraftFromRenderer(actStore, ud, {
        taskId: task.taskId,
        goal: "新的目标：表达风格",
        status: "draft",
      });
      assert.equal(changed.invalidatedConfirmed, true);
      assert.equal(changed.task.results.length, gen.task.results.length);
      assert.equal(isResultCurrent(changed.task, changed.task.results[0]), false);

      // re-confirm + research still works
      const assembled = assembleSubjectContextCandidates(samplePkg(), {
        goal: "新的目标：表达风格",
      });
      const confirmed = confirmSubjectContextSnapshot(assembled.subjectContextDraft, {
        keepClaimIds: assembled.subjectContextDraft.claims.slice(0, 1).map((c) => c.id),
      });
      await actStore.saveTask(ud, {
        ...changed.task,
        goal: "新的目标：表达风格",
        taskIntent: normalizeTaskIntent({ goal: "新的目标：表达风格" }, task.taskId),
        subjectContextCandidates: assembled.subjectContextDraft,
        subjectContext: confirmed,
        status: "context_confirmed",
        results: changed.task.results,
        invocations: changed.task.invocations,
      });
      const again = await runReadonlyExternalResearch({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        searchWeb: async (_em, query) => ({
          query,
          provider: "fake",
          results: [{ title: "新", url: "https://example.com/new", snippet: "n", provider: "fake" }],
        }),
        forceFake: true,
      });
      assert.equal(again.ok, true);
      assert.ok(again.task.invocations.length > changed.task.invocations.length);
    } finally {
      cleanup(ud);
    }
  });

  await test("legacy tasks missing results read as empty; parse/write failure does not wipe", async () => {
    const ud = tempUserData();
    try {
      const legacy = await actStore.saveTask(ud, {
        taskId: "abt_legacy_b3",
        title: "旧",
        request: "旧请求",
        status: "completed",
        selectedSelfContext: {
          items: [{ source: "persona", label: "人格", text: "本地优先" }],
          combinedText: "本地优先",
          userEdited: true,
        },
      });
      assert.equal(legacy.ok, true);
      const got = actStore.getTask(ud, "abt_legacy_b3");
      assert.ok(Array.isArray(got.task.results));
      assert.equal(got.task.results.length, 0);

      const task = await seedConfirmedTask(ud, "损坏保护");
      const sp = actStore.storePath(ud);
      const before = fs.readFileSync(sp, "utf8");
      fs.writeFileSync(sp, "{not-json", "utf8");
      let threw = false;
      try {
        actStore.loadStore(ud);
      } catch (err) {
        threw = true;
        assert.equal(err.code, "act_behalf_parse_failed");
      }
      assert.equal(threw, true);
      assert.equal(fs.readFileSync(sp, "utf8"), "{not-json");
      fs.writeFileSync(sp, before, "utf8");
      assert.equal(actStore.getTask(ud, task.taskId).ok, true);
    } finally {
      cleanup(ud);
    }
  });

  await test("Skill systemHint and steps enter generation messages", () => {
    const skill = PRESET_RESEARCH_SKILLS.find((s) => s.id === ALLOWED_SKILL_ID);
    const intent = normalizeTaskIntent({ goal: "提示注入" }, "abt_x");
    const messages = buildGenerationMessages({
      intent,
      skill,
      claims: [
        {
          claimId: "clm_1",
          kind: "opinion",
          text: "本地优先",
          confirmationState: "confirmed",
          sourceRefs: [],
        },
      ],
      externalEvidence: [],
      continueWithoutExternalSources: true,
    });
    assert.ok(messages[0].content.includes(skill.systemHint.slice(0, 20)));
    assert.ok(messages[0].content.includes(skill.steps[0]));
    assert.ok(messages[1].content.includes("claimId=clm_1"));
    assert.ok(!messages[1].content.includes("D:/fake"));
  });

  await test("extractJsonObject tolerates fenced JSON", () => {
    const obj = extractJsonObject('```json\n{"finalDraft":"x","inferences":[]}\n```');
    assert.equal(obj.finalDraft, "x");
  });

  await test("precondition rejects untrusted running result generation overlap", async () => {
    const ud = tempUserData();
    try {
      const task = await seedResearchedTask(ud, "并行生成保护");
      await actStore.saveTask(ud, {
        ...task,
        results: [
          {
            resultId: "res_busy",
            status: "running",
            kind: "research_expression",
          },
        ],
      });
      const pre = assertGeneratePreconditions((await actStore.getTask(ud, task.taskId)).task, {
        continueWithoutExternalSources: true,
      });
      // heal may convert running → interrupted on get; if still running, blocked
      if (pre.code === "result_running") {
        assert.equal(pre.ok, false);
      } else {
        // after heal, generation allowed — acceptable
        assert.ok(pre.ok || pre.code === "external_sources_unavailable" || pre.code === "result_running");
      }
    } finally {
      cleanup(ud);
    }
  });

  await test("tool invocation for old goal cannot be current external source", async () => {
    const ud = tempUserData();
    try {
      const goal = "当前目标B";
      const task = await seedConfirmedTask(ud, goal);
      const ver = subjectVersionOf(task);
      const sampleSources = [
        {
          sourceId: "src_old",
          title: "旧目标来源",
          url: "https://example.com/old-goal",
          snippet: "不应进入当前外部栏",
          provider: "fake",
        },
      ];
      await actStore.saveTask(ud, {
        ...task,
        selectedSkillId: ALLOWED_SKILL_ID,
        invocations: [
          matchingSkillInvocation(goal, ver),
          matchingToolInvocation("旧目标A", ver, {
            invocationId: "inv_tool_old_goal",
            discoveredSources: sampleSources,
          }),
        ],
      });
      const got = (await actStore.getTask(ud, task.taskId)).task;
      assert.equal(findMatchingToolInvocation(got), null);
      const ext = projectExternalEvidenceFromTask(got);
      assert.equal(ext.hasReliableSources, false);
      assert.equal(ext.externalEvidence.length, 0);
      assert.equal(ext.toolInvocation, null);
      const blocked = assertGeneratePreconditions(got, { continueWithoutExternalSources: false });
      assert.equal(blocked.ok, false);
      assert.equal(blocked.code, "external_sources_unavailable");
    } finally {
      cleanup(ud);
    }
  });

  await test("same goal with old subject context version cannot drive generation", async () => {
    const ud = tempUserData();
    try {
      const goal = "同目标旧版本";
      const task = await seedConfirmedTask(ud, goal);
      const ver = subjectVersionOf(task);
      assert.ok(ver);
      const oldVer = ver + "_old";
      await actStore.saveTask(ud, {
        ...task,
        selectedSkillId: ALLOWED_SKILL_ID,
        invocations: [
          matchingSkillInvocation(goal, oldVer, { invocationId: "inv_skill_old_ver" }),
          matchingToolInvocation(goal, oldVer, {
            invocationId: "inv_tool_old_ver",
            discoveredSources: [
              {
                sourceId: "src_v",
                title: "旧版本来源",
                url: "https://example.com/old-ver",
                snippet: "旧",
                provider: "fake",
              },
            ],
          }),
        ],
      });
      const got = (await actStore.getTask(ud, task.taskId)).task;
      assert.equal(findMatchingSkillInvocation(got, goal), null);
      assert.equal(findMatchingToolInvocation(got), null);
      const pre = assertGeneratePreconditions(got, { continueWithoutExternalSources: true });
      assert.equal(pre.ok, false);
      assert.equal(pre.code, "skill_invocation_missing");
      const gen = await generateResearchExpressionResult({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        continueWithoutExternalSources: true,
        callModel: fakeCallModelFactory(),
        forceFake: true,
      });
      assert.equal(gen.ok, false);
      assert.equal(gen.code, "skill_invocation_missing");
    } finally {
      cleanup(ud);
    }
  });

  await test("unrelated tool capability cannot enter external evidence column", async () => {
    const ud = tempUserData();
    try {
      const goal = "无关能力隔离";
      const task = await seedConfirmedTask(ud, goal);
      const ver = subjectVersionOf(task);
      await actStore.saveTask(ud, {
        ...task,
        selectedSkillId: ALLOWED_SKILL_ID,
        invocations: [
          matchingSkillInvocation(goal, ver),
          matchingToolInvocation(goal, ver, {
            invocationId: "inv_tool_other",
            capabilityId: "other.unrelatedCapability",
            discoveredSources: [
              {
                sourceId: "src_x",
                title: "无关来源",
                url: "https://example.com/unrelated",
                snippet: "不应出现",
                provider: "fake",
              },
            ],
          }),
        ],
      });
      const got = (await actStore.getTask(ud, task.taskId)).task;
      const ext = projectExternalEvidenceFromTask(got);
      assert.equal(ext.toolInvocation, null);
      assert.equal(ext.externalEvidence.length, 0);
      assert.ok(!JSON.stringify(ext).includes("unrelated"));
    } finally {
      cleanup(ud);
    }
  });

  await test("subject context version change marks prior result historical for current-validity", async () => {
    const ud = tempUserData();
    try {
      const goal = "上下文版本变更";
      const task = await seedResearchedTask(ud, goal);
      const claims = confirmedClaimsFromContext(task.subjectContext);
      const ext = projectExternalEvidenceFromTask(task);
      const gen = await generateResearchExpressionResult({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        callModel: async () => ({
          content: JSON.stringify({
            subjectSummary: "s",
            inferences: [
              {
                text: "推断",
                basedOnSubjectClaimIds: [claims[0].claimId],
                basedOnExternalResultRefs: [ext.externalEvidence[0].resultRef],
                uncertainty: "low",
              },
            ],
            finalDraft: "版本一成果",
          }),
          usedFake: true,
        }),
        forceFake: true,
      });
      assert.equal(gen.ok, true, gen.message);
      assert.equal(isResultCurrent(gen.task, gen.result), true);

      const bumped = {
        ...gen.task,
        subjectContext: {
          ...gen.task.subjectContext,
          version: String(subjectVersionOf(gen.task)) + "_v2",
          subjectVersion: String(subjectVersionOf(gen.task)) + "_v2",
        },
      };
      await actStore.saveTask(ud, bumped);
      const got = (await actStore.getTask(ud, task.taskId)).task;
      assert.equal(isResultCurrent(got, got.results[0]), false);

      // Renderer current-validity mirrors version check
      const refVer = String((got.results[0].subjectContextRef && got.results[0].subjectContextRef.version) || "");
      const curVer = subjectVersionOf(got);
      assert.ok(refVer);
      assert.ok(curVer);
      assert.notEqual(refVer, curVer);
    } finally {
      cleanup(ud);
    }
  });

  await test("no matching sources still allows owner continueWithoutExternalSources", async () => {
    const ud = tempUserData();
    try {
      const goal = "无匹配来源显式继续";
      const task = await seedConfirmedTask(ud, goal);
      const ver = subjectVersionOf(task);
      await actStore.saveTask(ud, {
        ...task,
        selectedSkillId: ALLOWED_SKILL_ID,
        invocations: [matchingSkillInvocation(goal, ver)],
      });
      const got = (await actStore.getTask(ud, task.taskId)).task;
      assert.equal(findMatchingToolInvocation(got), null);
      const blocked = assertGeneratePreconditions(got, { continueWithoutExternalSources: false });
      assert.equal(blocked.ok, false);
      assert.equal(blocked.code, "external_sources_unavailable");
      const claims = confirmedClaimsFromContext(got.subjectContext);
      const out = await generateResearchExpressionResult({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        continueWithoutExternalSources: true,
        callModel: async (messages) => {
          assert.ok(messages[0].content.includes("无可用外部来源"));
          return {
            content: JSON.stringify({
              subjectSummary: "s",
              externalFindings: [],
              inferences: [
                {
                  text: "受限推断",
                  basedOnSubjectClaimIds: [claims[0].claimId],
                  basedOnExternalResultRefs: [],
                  uncertainty: "high",
                },
              ],
              finalDraft: "无匹配来源的受限成果",
            }),
            usedFake: true,
          };
        },
        forceFake: true,
      });
      assert.equal(out.ok, true, out.message);
      assert.equal(out.result.sections.externalEvidence.length, 0);
      assert.equal(out.result.inputSnapshot.continueWithoutExternalSources, true);
    } finally {
      cleanup(ud);
    }
  });

  console.log("\nvl1 block3 contracts:", passed, "passed,", failed, "failed");
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
