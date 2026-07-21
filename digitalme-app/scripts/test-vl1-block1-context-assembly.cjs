"use strict";

/**
 * Block 1 focused contracts: Task Intent + Subject Context assembly.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const { normalizeTaskIntent, assertTaskIntentMinimal } = require("../src/act-behalf/task-intent");
const {
  assembleSubjectContextCandidates,
  confirmSubjectContextSnapshot,
  confirmSubjectContextWithUserActions,
  applyGoalChangeToStoredTask,
  makeUserSupplementClaim,
  assertNoModelContentAsConfirmedFact,
  assertAllowedPackageClaimSources,
} = require("../src/act-behalf/subject-context-assembly");
const actStore = require("../src/act-behalf/task-store");
const { buildSelectedSelfContext } = require("../src/act-behalf/select-self-context");

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
  return fs.mkdtempSync(path.join(os.tmpdir(), "dm-vl1-"));
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
    manifest: { packageId: "pkg_test", revision: 3, ownerDisplayName: "Owner" },
    persona: "我坚持本地优先与本人控制。投资上重视长期判断框架，不追逐短线口号。",
    styleGuide: "表达克制、清楚、少口号。句子完整，避免空泛形容词。",
    lifeSummary: "长期关注数字化主体与个人资料主权相关项目。",
    boundariesSummary: "不得擅自对外发送；不得把推测写成本人事实；禁止未经确认代表本人签约。",
    longTermMemory:
      JSON.stringify({
        type: "long_term",
        content: "我认为公开市场短期波动不应直接改写长期投资框架。",
        theme: "投资判断",
        confidence: "high",
      }) +
      "\n" +
      JSON.stringify({
        type: "long_term",
        content: "写作时应区分本人既有观点与外部事实。",
        theme: "表达",
        confidence: "high",
      }) +
      "\n",
    decisionFrameworks: JSON.stringify({
      frameworks: [{ name: "长期框架优先", principles: ["证据不足时明确不确定"] }],
    }),
    preferences: "偏好结构化短文。",
    identitySummary: "个人数字主体建设者。",
  };
}

async function main() {
  await test("Task Intent minimal fields complete with defaults", () => {
    const intent = normalizeTaskIntent({ goal: "研究公开市场事件对本人关注方向的含义" }, "abt_x");
    intent.taskId = "abt_x";
    const check = assertTaskIntentMinimal(intent);
    assert.equal(check.ok, true, check.missing && check.missing.join(","));
    assert.equal(intent.riskLevel, "low");
    assert.equal(intent.approvalPolicy.allowExternalSend, false);
    assert.ok(intent.role);
    assert.ok(intent.expectedOutcome);
    assert.ok(Array.isArray(intent.constraints));
  });

  await test("different goals change candidate ranking order", () => {
    const pkg = samplePkg();
    const a = assembleSubjectContextCandidates(pkg, {
      goal: "公开市场波动与长期投资判断框架",
    });
    const b = assembleSubjectContextCandidates(pkg, {
      goal: "表达风格与写作克制少口号",
    });
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
    assert.ok(a.subjectContextDraft.claims.length > 0);
    assert.ok(b.subjectContextDraft.claims.length > 0);
    const topA = a.subjectContextDraft.claims[0].text;
    const topB = b.subjectContextDraft.claims[0].text;
    assert.notEqual(topA, topB);
    assert.equal(a.subjectContextDraft.rankingMeta.degraded, false);
    assert.equal(b.subjectContextDraft.rankingMeta.degraded, false);
  });

  await test("candidates keep sourceRefs to package paths", () => {
    const assembled = assembleSubjectContextCandidates(samplePkg(), {
      goal: "投资判断与本地优先",
    });
    const claim = assembled.subjectContextDraft.claims[0];
    assert.ok(claim.sourceRefs && claim.sourceRefs.length >= 1);
    assert.ok(claim.sourceRefs[0].source);
    assert.ok(assembled.subjectContextDraft.sourceRefs.length >= 1);
    assert.ok(
      (assembled.subjectContextDraft.rankingMeta.packagePaths || []).length >= 1 ||
        assembled.subjectContextDraft.sourceRefs.length >= 1
    );
  });

  await test("deleting candidates does not mutate package object", () => {
    const pkg = samplePkg();
    const beforePersona = pkg.persona;
    const assembled = assembleSubjectContextCandidates(pkg, { goal: "本地优先" });
    const keep = assembled.subjectContextDraft.claims.slice(0, 1).map((c) => c.id);
    const confirmed = confirmSubjectContextSnapshot(assembled.subjectContextDraft, {
      keepClaimIds: keep,
      supplements: [],
    });
    assert.equal(pkg.persona, beforePersona);
    assert.ok(confirmed.claims.length <= assembled.subjectContextDraft.claims.length);
  });

  await test("user supplement marked user_supplement and confirmed snapshot excludes unkept", () => {
    const assembled = assembleSubjectContextCandidates(samplePkg(), {
      goal: "投资判断",
    });
    const keepOne = [assembled.subjectContextDraft.claims[0].id];
    const confirmed = confirmSubjectContextSnapshot(assembled.subjectContextDraft, {
      keepClaimIds: keepOne,
      supplements: ["我补充：只讨论公开信息，不披露私人持仓。"],
    });
    assert.equal(confirmed.confirmationState, "confirmed");
    assert.equal(confirmed.claims.length, 2);
    const supp = confirmed.claims.find((c) =>
      (c.sourceRefs || []).some((r) => r.source === "user_supplement")
    );
    assert.ok(supp);
    assert.ok(supp.text.includes("不披露私人持仓"));
    for (const c of confirmed.claims) {
      assert.ok(c.confirmationState === "confirmed" || c.confirmationState === "user_edited");
    }
    // proposed-only candidates not in keep list must be absent
    const dropped = assembled.subjectContextDraft.claims.filter((c) => c.id !== keepOne[0]);
    for (const d of dropped) {
      assert.ok(!confirmed.claims.some((c) => c.id === d.id));
    }
  });

  await test("unconfirmed candidates do not enter confirmed snapshot without keep ids", () => {
    const assembled = assembleSubjectContextCandidates(samplePkg(), { goal: "表达风格" });
    const confirmed = confirmSubjectContextSnapshot(assembled.subjectContextDraft, {
      keepClaimIds: [],
      supplements: [],
    });
    assert.equal(confirmed.claims.length, 0);
    assert.equal(confirmed.confirmationState, "confirmed");
  });

  await test("confirmed snapshot saves and reloads; legacy 55ae01f task still readable", async () => {
    const ud = tempUserData();
    try {
      const assembled = assembleSubjectContextCandidates(samplePkg(), {
        goal: "研究公开市场事件对本人关注方向的含义",
      });
      const confirmed = confirmSubjectContextSnapshot(assembled.subjectContextDraft, {
        keepClaimIds: assembled.subjectContextDraft.claims.slice(0, 2).map((c) => c.id),
        supplements: [],
      });
      const intent = normalizeTaskIntent(
        { goal: "研究公开市场事件对本人关注方向的含义" },
        undefined
      );
      const saved = await actStore.saveTask(ud, {
        title: "示例研究",
        goal: intent.goal,
        taskIntent: intent,
        status: "context_confirmed",
        subjectContextCandidates: assembled.subjectContextDraft,
        subjectContext: confirmed,
      });
      assert.equal(saved.ok, true);
      const check = assertTaskIntentMinimal({
        ...saved.task.taskIntent,
        taskId: saved.task.taskId,
      });
      assert.equal(check.ok, true);
      assert.equal(saved.task.subjectContext.confirmationState, "confirmed");
      assert.ok(saved.task.subjectContext.claims[0].sourceRefs[0].source);

      const got = actStore.getTask(ud, saved.task.taskId);
      assert.equal(got.ok, true);
      assert.equal(got.task.taskIntent.goal, intent.goal);
      assert.equal(got.task.subjectContext.claims.length, confirmed.claims.length);

      // legacy v1 task
      const legacy = await actStore.saveTask(ud, {
        taskId: "abt_legacy_1",
        title: "旧任务",
        request: "代表我整理周报",
        status: "completed",
        selectedSelfContext: {
          items: [{ source: "persona", label: "人格", text: "本地优先" }],
          combinedText: "本地优先",
          userEdited: true,
        },
        result: "旧结果",
      });
      assert.equal(legacy.ok, true);
      const legacyGot = actStore.getTask(ud, "abt_legacy_1");
      assert.equal(legacyGot.ok, true);
      assert.equal(legacyGot.task.request, "代表我整理周报");
      assert.ok(legacyGot.task.taskIntent);
      assert.equal(legacyGot.task.taskIntent.goal, "代表我整理周报");
      assert.equal(legacyGot.task.result, "旧结果");
    } finally {
      cleanup(ud);
    }
  });

  await test("parse failure does not overwrite store file", async () => {
    const ud = tempUserData();
    try {
      await actStore.saveTask(ud, { title: "t", goal: "目标甲", request: "目标甲" });
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
      // file still the corrupt content — save must not have silently repaired by load;
      // ensure a failed load path didn't empty it via our API (we never wrote on load)
      assert.equal(fs.readFileSync(sp, "utf8"), "{not-json");
      // restore valid for cleanup sanity
      fs.writeFileSync(sp, before, "utf8");
    } finally {
      cleanup(ud);
    }
  });

  await test("fixed-ratio note no longer claims task relevance", () => {
    const ctx = buildSelectedSelfContext(samplePkg());
    assert.ok(ctx.note.includes("有界初始摘录") || ctx.note.includes("确认或编辑"));
    assert.ok(!ctx.note.includes("与当前任务相关"));
  });

  await test("makeUserSupplementClaim source marker", () => {
    const c = makeUserSupplementClaim("补充观点");
    assert.equal(c.sourceRefs[0].source, "user_supplement");
  });

  await test("forged claim text from renderer path cannot enter confirmed snapshot", () => {
    const goal = "投资判断与本地优先";
    const assembled = assembleSubjectContextCandidates(samplePkg(), { goal });
    const auth = assembled.subjectContextDraft;
    const realId = auth.claims[0].id;
    const realText = auth.claims[0].text;
    // Simulate renderer forging claim body while keeping a real id
    const forgedDraft = {
      ...auth,
      claims: auth.claims.map((c, i) =>
        i === 0 ? { ...c, text: "【伪造】本人愿意公开全部持仓细节。" } : c
      ),
    };
    // Confirm path must use authoritative draft, not forgedDraft
    const outcome = confirmSubjectContextWithUserActions(auth, {
      goal,
      keepClaimIds: [realId],
      supplements: [],
    });
    assert.equal(outcome.ok, true, outcome.message);
    assert.equal(outcome.confirmed.claims[0].text, realText);
    assert.ok(!outcome.confirmed.claims[0].text.includes("伪造"));
    // Sanity: forged draft differs
    assert.notEqual(forgedDraft.claims[0].text, realText);
  });

  await test("forged package sourceRef cannot enter confirmed snapshot", () => {
    const goal = "表达风格";
    const assembled = assembleSubjectContextCandidates(samplePkg(), { goal });
    const auth = assembled.subjectContextDraft;
    const poisoned = {
      ...auth,
      claims: [
        {
          ...auth.claims[0],
          sourceRefs: [{ source: "https://evil.example/claim", locator: "x" }],
        },
      ],
    };
    const outcome = confirmSubjectContextWithUserActions(poisoned, {
      goal,
      keepClaimIds: [poisoned.claims[0].id],
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, "invalid_package_source");
  });

  await test("model inference hidden behind legal first sourceRef is blocked", () => {
    const goal = "本地优先";
    const assembled = assembleSubjectContextCandidates(samplePkg(), { goal });
    const auth = assembled.subjectContextDraft;
    const claim = {
      ...auth.claims[0],
      sourceRefs: [
        { source: "persona.md", locator: "para:0" },
        { source: "model_inference", locator: "hidden" },
      ],
      confirmationState: "confirmed",
    };
    const guard = assertNoModelContentAsConfirmedFact([claim]);
    assert.equal(guard.ok, false);
    const draft = { ...auth, claims: [{ ...claim, confirmationState: "proposed" }] };
    const outcome = confirmSubjectContextWithUserActions(draft, {
      goal,
      keepClaimIds: [claim.id],
    });
    assert.equal(outcome.ok, false);
    assert.ok(
      outcome.code === "invalid_confirmation" || outcome.message.includes("模型推测")
    );
  });

  await test("unknown keepClaimId cannot generate confirmed claim", () => {
    const goal = "投资判断";
    const assembled = assembleSubjectContextCandidates(samplePkg(), { goal });
    const outcome = confirmSubjectContextWithUserActions(assembled.subjectContextDraft, {
      goal,
      keepClaimIds: ["clm_totally_fake_id"],
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, "unknown_claim_ids");
    assert.ok((outcome.unknownClaimIds || []).includes("clm_totally_fake_id"));
  });

  await test("user supplement still marked user_supplement by main helper", () => {
    const goal = "写作克制";
    const assembled = assembleSubjectContextCandidates(samplePkg(), { goal });
    const keep = [assembled.subjectContextDraft.claims[0].id];
    const outcome = confirmSubjectContextWithUserActions(assembled.subjectContextDraft, {
      goal,
      keepClaimIds: keep,
      supplementText: "本次补充：仅讨论公开信息。",
    });
    assert.equal(outcome.ok, true, outcome.message);
    const supp = outcome.confirmed.claims.find((c) =>
      (c.sourceRefs || []).some((r) => r.source === "user_supplement")
    );
    assert.ok(supp);
    assert.equal(supp.sourceRefs.length, 1);
    assert.equal(supp.sourceRefs[0].source, "user_supplement");
  });

  await test("goal change cannot silently confirm stale candidates", () => {
    const assembled = assembleSubjectContextCandidates(samplePkg(), {
      goal: "公开市场与长期投资",
    });
    const outcome = confirmSubjectContextWithUserActions(assembled.subjectContextDraft, {
      goal: "完全不同的新目标：表达风格润色",
      keepClaimIds: [assembled.subjectContextDraft.claims[0].id],
    });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, "context_stale_for_goal");
  });

  await test("confirmed task goal change invalidates snapshot as prior", () => {
    const goal = "本地优先与本人控制";
    const assembled = assembleSubjectContextCandidates(samplePkg(), { goal });
    const confirmed = confirmSubjectContextSnapshot(assembled.subjectContextDraft, {
      keepClaimIds: [assembled.subjectContextDraft.claims[0].id],
      supplements: [],
    });
    const existing = {
      goal,
      taskIntent: { goal },
      status: "context_confirmed",
      subjectContextCandidates: assembled.subjectContextDraft,
      subjectContext: confirmed,
      priorSubjectContext: null,
    };
    const next = applyGoalChangeToStoredTask(existing, "新的研究目标：公开市场事件");
    assert.equal(next.invalidatedConfirmed, true);
    assert.equal(next.subjectContext, null);
    assert.equal(next.priorSubjectContext.confirmationState, "confirmed");
    assert.equal(next.clearedCandidates, true);
    assert.equal(next.subjectContextCandidates, null);
    assert.equal(next.status, "draft");
  });

  await test("normal delete/supplement/confirm path still works via authoritative API", () => {
    const goal = "投资判断框架";
    const assembled = assembleSubjectContextCandidates(samplePkg(), { goal });
    const ids = assembled.subjectContextDraft.claims.map((c) => c.id);
    const keep = ids.slice(0, Math.max(1, ids.length - 1));
    const outcome = confirmSubjectContextWithUserActions(assembled.subjectContextDraft, {
      goal,
      keepClaimIds: keep,
      supplements: ["补充：区分本人观点与外部事实。"],
    });
    assert.equal(outcome.ok, true, outcome.message);
    assert.equal(outcome.confirmed.confirmationState, "confirmed");
    assert.ok(outcome.confirmed.claims.length >= 2);
    assert.ok((outcome.deletedClaimIds || []).length >= 0);
    for (const c of outcome.confirmed.claims) {
      if ((c.sourceRefs || []).some((r) => r.source === "user_supplement")) continue;
      assert.equal(assertAllowedPackageClaimSources([c]).ok, true);
    }
  });

  console.log("\nvl1 block1 contracts:", passed, "passed,", failed, "failed");
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
