"use strict";

/**
 * VL1 block 2 focused contracts: Skill + readonly external research invocations.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const actStore = require("../src/act-behalf/task-store");
const { normalizeTaskIntent, assertTaskIntentMinimal } = require("../src/act-behalf/task-intent");
const {
  assembleSubjectContextCandidates,
  confirmSubjectContextSnapshot,
} = require("../src/act-behalf/subject-context-assembly");
const {
  ALLOWED_SKILL_ID,
  TOOL_CAPABILITY_ID,
  MAX_SOURCES_TOTAL,
  MAX_QUERY_CHARS,
  buildResearchQueries,
  assertResearchPreconditions,
  dedupeAndCapSources,
  normalizeDiscoveredSource,
  healRunningInvocations,
  runReadonlyExternalResearch,
  isResearchResultCurrent,
} = require("../src/act-behalf/research-run");
const { PRESET_RESEARCH_SKILLS } = require("../src/skills/research-presets");
const personalSkills = require("../src/skills/personal");

let passed = 0;
let failed = 0;
let feedbackApplyCalls = 0;
let packageWriteCalls = 0;

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
  return fs.mkdtempSync(path.join(os.tmpdir(), "dm-vl1-b2-"));
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
    title: "调研任务",
    goal,
    taskIntent: intent,
    status: "context_confirmed",
    subjectContextCandidates: assembled.subjectContextDraft,
    subjectContext: confirmed,
    invocations: [],
  });
  assert.equal(saved.ok, true);
  assert.equal(assertTaskIntentMinimal({ ...saved.task.taskIntent, taskId: saved.task.taskId }).ok, true);
  return saved.task;
}

function fakeSearchWebFactory(hitsByQuery) {
  let calls = 0;
  async function searchWeb(_em, query) {
    calls += 1;
    const q = String(query || "");
    const preset = hitsByQuery && hitsByQuery[q];
    const results =
      preset ||
      [
        {
          title: "示例来源 A",
          url: "https://example.com/a?q=" + encodeURIComponent(q.slice(0, 20)),
          snippet: "摘要 A",
          provider: "fake",
        },
        {
          title: "示例来源 B",
          url: "https://example.com/b",
          snippet: "摘要 B",
          provider: "fake",
        },
        {
          title: "重复 URL",
          url: "https://example.com/b/",
          snippet: "应被去重",
          provider: "fake",
        },
      ];
    return { query: q, provider: "fake", results };
  }
  searchWeb.calls = () => calls;
  return searchWeb;
}

async function main() {
  await test("preset general research skill exists in source definition", () => {
    const skill = PRESET_RESEARCH_SKILLS.find((s) => s.id === ALLOWED_SKILL_ID);
    assert.ok(skill);
    assert.equal(skill.id, "psk_preset_general_research");
    assert.ok(skill.systemHint);
    assert.ok(Array.isArray(skill.steps));
  });

  await test("cannot start without confirmed subject context", async () => {
    const ud = tempUserData();
    try {
      const intent = normalizeTaskIntent({ goal: "公开市场与长期框架" }, undefined);
      const saved = await actStore.saveTask(ud, {
        title: "无确认",
        goal: intent.goal,
        taskIntent: intent,
        status: "draft",
        subjectContext: null,
      });
      const searchWeb = fakeSearchWebFactory();
      const out = await runReadonlyExternalResearch({
        userData: ud,
        taskId: saved.task.taskId,
        store: actStore,
        skills: personalSkills,
        searchWeb,
        forceFake: true,
      });
      assert.equal(out.ok, false);
      assert.equal(out.code, "context_not_confirmed");
      assert.equal(searchWeb.calls(), 0);
    } finally {
      cleanup(ud);
    }
  });

  await test("cannot start when confirmed snapshot goal mismatches intent", async () => {
    const ud = tempUserData();
    try {
      const task = await seedConfirmedTask(ud, "公开市场与长期框架");
      task.taskIntent = normalizeTaskIntent({ goal: "完全不同的新目标：表达风格" }, task.taskId);
      task.goal = task.taskIntent.goal;
      await actStore.saveTask(ud, task);
      const searchWeb = fakeSearchWebFactory();
      const out = await runReadonlyExternalResearch({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        searchWeb,
        forceFake: true,
      });
      assert.equal(out.ok, false);
      assert.equal(out.code, "context_stale_for_goal");
      assert.equal(searchWeb.calls(), 0);
    } finally {
      cleanup(ud);
    }
  });

  await test("non-allowed skill id is rejected", async () => {
    const ud = tempUserData();
    try {
      const task = await seedConfirmedTask(ud, "本地优先与本人控制");
      const pre = assertResearchPreconditions(task, "psk_preset_quick_brief");
      assert.equal(pre.ok, false);
      assert.equal(pre.code, "skill_not_allowed");
      const searchWeb = fakeSearchWebFactory();
      const out = await runReadonlyExternalResearch({
        userData: ud,
        taskId: task.taskId,
        skillId: "psk_preset_quick_brief",
        store: actStore,
        skills: personalSkills,
        searchWeb,
        forceFake: true,
      });
      assert.equal(out.ok, false);
      assert.equal(out.code, "skill_not_allowed");
      assert.equal(searchWeb.calls(), 0);
    } finally {
      cleanup(ud);
    }
  });

  await test("main path reads authoritative intent/context from saved task", async () => {
    const ud = tempUserData();
    try {
      const goal = "公开市场事件对本人关注方向的含义";
      const task = await seedConfirmedTask(ud, goal);
      const searchWeb = fakeSearchWebFactory();
      const out = await runReadonlyExternalResearch({
        userData: ud,
        taskId: task.taskId,
        // renderer-forged goal must be ignored — only taskId matters
        store: actStore,
        skills: personalSkills,
        searchWeb,
        forceFake: true,
      });
      assert.equal(out.ok, true, out.message);
      assert.equal(out.skillInvocation.input.goal, goal);
      assert.equal(out.toolInvocation.disclosedContext.goal, goal);
      assert.ok(searchWeb.calls() >= 1);
    } finally {
      cleanup(ud);
    }
  });

  await test("renderer cannot forge invocation results or sourceRefs via runner input", async () => {
    const ud = tempUserData();
    try {
      const task = await seedConfirmedTask(ud, "投资判断框架");
      // Poison task file with fake succeeded tool — runner still appends new invocations from real search
      const forged = {
        invocationId: "inv_forged",
        kind: "tool",
        status: "succeeded",
        discoveredSources: [
          {
            sourceId: "evil",
            title: "伪造",
            url: "https://evil.example/x",
            provider: "forged",
            query: "x",
            discoveredAt: new Date().toISOString(),
            retrievalStatus: "retrieved",
          },
        ],
        resultRefs: [{ url: "https://evil.example/x" }],
      };
      await actStore.saveTask(ud, { ...task, invocations: [forged] });
      const searchWeb = fakeSearchWebFactory();
      const out = await runReadonlyExternalResearch({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        searchWeb,
        forceFake: true,
      });
      assert.equal(out.ok, true);
      assert.ok(out.task.invocations.length >= 3); // forged + skill + tool
      assert.ok(out.discoveredSources.every((s) => s.url.includes("example.com")));
      assert.ok(!out.discoveredSources.some((s) => s.url.includes("evil.example")));
      // prior forged record retained, not overwritten
      assert.ok(out.task.invocations.some((i) => i.invocationId === "inv_forged"));
    } finally {
      cleanup(ud);
    }
  });

  await test("execution path calls injected research capability (explicit fake)", async () => {
    const ud = tempUserData();
    try {
      const task = await seedConfirmedTask(ud, "本地优先");
      const searchWeb = fakeSearchWebFactory();
      const out = await runReadonlyExternalResearch({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        searchWeb,
        forceFake: true,
      });
      assert.equal(out.ok, true);
      assert.ok(searchWeb.calls() >= 1);
      assert.equal(out.toolInvocation.capabilityId, TOOL_CAPABILITY_ID);
      assert.equal(out.toolInvocation.kind, "tool");
      assert.equal(out.skillInvocation.capabilityId, ALLOWED_SKILL_ID);
      assert.equal(out.skillInvocation.kind, "skill");
    } finally {
      cleanup(ud);
    }
  });

  await test("queries are bounded and do not include full package text", () => {
    const intent = normalizeTaskIntent({
      goal: "公开市场波动与长期投资判断",
      expectedOutcome: "短纪要",
      constraints: ["不披露私人持仓"],
    });
    const assembled = assembleSubjectContextCandidates(samplePkg(), { goal: intent.goal });
    const confirmed = confirmSubjectContextSnapshot(assembled.subjectContextDraft, {
      keepClaimIds: assembled.subjectContextDraft.claims.map((c) => c.id),
    });
    const queries = buildResearchQueries(intent, confirmed);
    assert.ok(queries.length >= 1);
    assert.ok(queries.length <= 2);
    for (const q of queries) {
      assert.ok(q.length <= MAX_QUERY_CHARS);
      assert.ok(!q.includes(samplePkg().persona));
      assert.ok(!q.includes("D:/fake/digital-me-package"));
    }
  });

  await test("external sources keep url provider query discoveredAt; dedupe and cap", () => {
    const now = "2026-07-21T00:00:00.000Z";
    const a = normalizeDiscoveredSource(
      { title: "A", url: "https://example.com/x", snippet: "s", provider: "fake" },
      { query: "q1", provider: "fake", discoveredAt: now }
    );
    const b = normalizeDiscoveredSource(
      { title: "B", url: "https://example.com/x/", snippet: "s2", provider: "fake" },
      { query: "q1", provider: "fake", discoveredAt: now }
    );
    const many = [];
    for (let i = 0; i < 20; i += 1) {
      many.push(
        normalizeDiscoveredSource(
          { title: "T" + i, url: "https://example.com/p/" + i, snippet: "n", provider: "fake" },
          { query: "q", provider: "fake", discoveredAt: now }
        )
      );
    }
    assert.equal(a.url, "https://example.com/x");
    assert.equal(a.provider, "fake");
    assert.equal(a.query, "q1");
    assert.equal(a.discoveredAt, now);
    const capped = dedupeAndCapSources([a, b, ...many], MAX_SOURCES_TOTAL);
    assert.equal(capped.length, MAX_SOURCES_TOTAL);
    assert.equal(capped.filter((s) => s.url.includes("/x")).length, 1);
  });

  await test("success saves succeeded; failure saves failed without overwriting prior success", async () => {
    const ud = tempUserData();
    try {
      const task = await seedConfirmedTask(ud, "表达克制与少口号");
      const okSearch = fakeSearchWebFactory();
      const ok = await runReadonlyExternalResearch({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        searchWeb: okSearch,
        forceFake: true,
      });
      assert.equal(ok.ok, true);
      assert.equal(ok.toolInvocation.status, "succeeded");
      const successId = ok.toolInvocation.invocationId;

      const failSearch = async () => {
        throw new Error("模拟搜索失败 token=SECRET_VALUE");
      };
      const bad = await runReadonlyExternalResearch({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        searchWeb: failSearch,
        forceFake: true,
      });
      assert.equal(bad.ok, false);
      assert.equal(bad.toolInvocation.status, "failed");
      assert.ok(bad.toolInvocation.error && bad.toolInvocation.error.message);
      assert.ok(!String(bad.toolInvocation.error.message).includes("SECRET_VALUE"));
      const still = bad.task.invocations.find((i) => i.invocationId === successId);
      assert.ok(still);
      assert.equal(still.status, "succeeded");
      assert.ok((still.discoveredSources || []).length >= 1);
    } finally {
      cleanup(ud);
    }
  });

  await test("running invocations heal to interrupted on reload", async () => {
    const ud = tempUserData();
    try {
      const task = await seedConfirmedTask(ud, "数字化主体建设");
      await actStore.saveTask(ud, {
        ...task,
        invocations: [
          {
            invocationId: "inv_running_1",
            kind: "tool",
            status: "running",
            startedAt: new Date().toISOString(),
            discoveredSources: [],
          },
        ],
      });
      const got = actStore.getTask(ud, task.taskId);
      assert.equal(got.ok, true);
      assert.equal(got.task.invocations[0].status, "interrupted");
      const healed = healRunningInvocations([{ status: "running" }, { status: "succeeded" }]);
      assert.equal(healed.changed, true);
      assert.equal(healed.invocations[0].status, "interrupted");
      assert.equal(healed.invocations[1].status, "succeeded");
    } finally {
      cleanup(ud);
    }
  });

  await test("invocations and sources persist and reload; external not in subject context", async () => {
    const ud = tempUserData();
    try {
      const task = await seedConfirmedTask(ud, "长期投资判断");
      const beforeClaims = JSON.stringify(task.subjectContext.claims);
      const out = await runReadonlyExternalResearch({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        searchWeb: fakeSearchWebFactory(),
        forceFake: true,
      });
      assert.equal(out.ok, true);
      const got = actStore.getTask(ud, task.taskId);
      assert.equal(got.ok, true);
      assert.ok(got.task.invocations.length >= 2);
      const tool = got.task.invocations.find((i) => i.kind === "tool" && i.status === "succeeded");
      assert.ok(tool);
      assert.ok(tool.discoveredSources.length >= 1);
      assert.equal(JSON.stringify(got.task.subjectContext.claims), beforeClaims);
      assert.ok(
        !(got.task.subjectContext.claims || []).some((c) =>
          (c.sourceRefs || []).some((r) => r.source === "external_web")
        )
      );
      assert.equal(isResearchResultCurrent(got.task), true);
    } finally {
      cleanup(ud);
    }
  });

  await test("legacy task without invocations still readable", async () => {
    const ud = tempUserData();
    try {
      const legacy = await actStore.saveTask(ud, {
        taskId: "abt_legacy_b2",
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
      const got = actStore.getTask(ud, "abt_legacy_b2");
      assert.equal(got.ok, true);
      assert.ok(Array.isArray(got.task.invocations));
      assert.equal(got.task.invocations.length, 0);
      assert.equal(got.task.result, "旧结果");
    } finally {
      cleanup(ud);
    }
  });

  await test("parse/write failure does not damage original task file", async () => {
    const ud = tempUserData();
    try {
      const task = await seedConfirmedTask(ud, "边界与本地优先");
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
      const got = actStore.getTask(ud, task.taskId);
      assert.equal(got.ok, true);
    } finally {
      cleanup(ud);
    }
  });

  await test("block2 path does not call feedback.apply or package write hooks", async () => {
    const ud = tempUserData();
    try {
      feedbackApplyCalls = 0;
      packageWriteCalls = 0;
      const task = await seedConfirmedTask(ud, "只读调研审计");
      const out = await runReadonlyExternalResearch({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        searchWeb: fakeSearchWebFactory(),
        forceFake: true,
        // If a future hook is accidentally added, tests can watch these counters
        feedbackApply: () => {
          feedbackApplyCalls += 1;
        },
        packageWrite: () => {
          packageWriteCalls += 1;
        },
      });
      assert.equal(out.ok, true);
      assert.equal(feedbackApplyCalls, 0);
      assert.equal(packageWriteCalls, 0);
      assert.deepEqual(out.toolInvocation.permissionScope, ["readonly_external_research"]);
      assert.ok(!out.toolInvocation.permissionScope.includes("package_write"));
    } finally {
      cleanup(ud);
    }
  });

  // --- save boundary: production helper used by actBehalf:save ---
  const { saveDraftFromRenderer, buildDraftSaveRecord } = require("../src/act-behalf/task-save-boundary");

  await test("renderer save without invocations keeps history intact", async () => {
    const ud = tempUserData();
    try {
      const task = await seedConfirmedTask(ud, "保存边界目标甲");
      const researched = await runReadonlyExternalResearch({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        searchWeb: fakeSearchWebFactory(),
        forceFake: true,
      });
      assert.equal(researched.ok, true);
      const before = researched.task.invocations.slice();
      assert.ok(before.length >= 2);

      const saved = await saveDraftFromRenderer(actStore, ud, {
        taskId: task.taskId,
        title: "标题微调",
        goal: "保存边界目标甲",
        status: "draft",
        taskIntent: { goal: "保存边界目标甲", role: "代表本人做研究与表达" },
      });
      assert.equal(saved.ok, true);
      assert.equal(saved.task.invocations.length, before.length);
      assert.equal(saved.task.invocations[0].invocationId, before[0].invocationId);
      assert.equal(
        saved.task.invocations[before.length - 1].invocationId,
        before[before.length - 1].invocationId
      );
    } finally {
      cleanup(ud);
    }
  });

  await test("renderer forged invocations cannot enter persisted task", async () => {
    const ud = tempUserData();
    try {
      const task = await seedConfirmedTask(ud, "拒收伪造调用");
      const researched = await runReadonlyExternalResearch({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        searchWeb: fakeSearchWebFactory(),
        forceFake: true,
      });
      const beforeLen = researched.task.invocations.length;
      const saved = await saveDraftFromRenderer(actStore, ud, {
        taskId: task.taskId,
        goal: "拒收伪造调用",
        invocations: [
          {
            invocationId: "inv_forged_save",
            kind: "tool",
            status: "succeeded",
            discoveredSources: [{ url: "https://evil.example/x", title: "evil" }],
          },
        ],
        discoveredSources: [{ url: "https://evil.example/y" }],
        resultRefs: [{ url: "https://evil.example/z" }],
        sourceRefs: [{ source: "external_web", locator: "https://evil.example/z" }],
      });
      assert.equal(saved.ok, true);
      assert.equal(saved.rejectedRendererResearch, true);
      assert.equal(saved.task.invocations.length, beforeLen);
      assert.ok(!saved.task.invocations.some((i) => i.invocationId === "inv_forged_save"));
      assert.ok(
        !JSON.stringify(saved.task.invocations).includes("evil.example")
      );
    } finally {
      cleanup(ud);
    }
  });

  await test("renderer cannot change existing invocation status or clear history", async () => {
    const ud = tempUserData();
    try {
      const task = await seedConfirmedTask(ud, "状态保护");
      const researched = await runReadonlyExternalResearch({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        searchWeb: fakeSearchWebFactory(),
        forceFake: true,
      });
      const success = researched.task.invocations.find((i) => i.status === "succeeded");
      assert.ok(success);
      const mutated = researched.task.invocations.map((i) =>
        i.invocationId === success.invocationId ? { ...i, status: "failed", error: { message: "hack" } } : i
      );
      const cleared = await saveDraftFromRenderer(actStore, ud, {
        taskId: task.taskId,
        goal: "状态保护",
        invocations: [],
      });
      assert.equal(cleared.ok, true);
      assert.ok(cleared.task.invocations.length >= 2);
      assert.equal(
        cleared.task.invocations.find((i) => i.invocationId === success.invocationId).status,
        "succeeded"
      );

      const statusAttack = await saveDraftFromRenderer(actStore, ud, {
        taskId: task.taskId,
        goal: "状态保护",
        invocations: mutated,
      });
      assert.equal(statusAttack.ok, true);
      assert.equal(
        statusAttack.task.invocations.find((i) => i.invocationId === success.invocationId).status,
        "succeeded"
      );
    } finally {
      cleanup(ud);
    }
  });

  await test("renderer cannot forge selectedSkillId over authoritative value", async () => {
    const ud = tempUserData();
    try {
      const task = await seedConfirmedTask(ud, "Skill 选择保护");
      const researched = await runReadonlyExternalResearch({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        searchWeb: fakeSearchWebFactory(),
        forceFake: true,
      });
      assert.equal(researched.task.selectedSkillId, ALLOWED_SKILL_ID);
      const saved = await saveDraftFromRenderer(actStore, ud, {
        taskId: task.taskId,
        goal: "Skill 选择保护",
        selectedSkillId: "psk_preset_quick_brief",
      });
      assert.equal(saved.ok, true);
      assert.equal(saved.task.selectedSkillId, ALLOWED_SKILL_ID);
    } finally {
      cleanup(ud);
    }
  });

  await test("new task cannot receive forged invocation from renderer payload", async () => {
    const ud = tempUserData();
    try {
      const saved = await saveDraftFromRenderer(actStore, ud, {
        title: "新任务",
        goal: "新任务合法目标",
        status: "draft",
        taskIntent: { goal: "新任务合法目标" },
        invocations: [
          {
            invocationId: "inv_new_forged",
            kind: "tool",
            status: "succeeded",
            discoveredSources: [{ url: "https://evil.example/new" }],
          },
        ],
        selectedSkillId: "psk_preset_deep_dive",
      });
      assert.equal(saved.ok, true);
      assert.ok(Array.isArray(saved.task.invocations));
      assert.equal(saved.task.invocations.length, 0);
      assert.equal(saved.task.selectedSkillId, null);
      assert.equal(saved.task.taskIntent.goal, "新任务合法目标");
    } finally {
      cleanup(ud);
    }
  });

  await test("legal goal/intent edits still save; goal change keeps history but not current", async () => {
    const ud = tempUserData();
    try {
      const goal1 = "公开市场与长期框架";
      const task = await seedConfirmedTask(ud, goal1);
      const researched = await runReadonlyExternalResearch({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        searchWeb: fakeSearchWebFactory(),
        forceFake: true,
      });
      assert.equal(isResearchResultCurrent(researched.task), true);
      const histLen = researched.task.invocations.length;

      const edited = await saveDraftFromRenderer(actStore, ud, {
        taskId: task.taskId,
        goal: goal1,
        title: "合法改标题",
        taskIntent: {
          goal: goal1,
          role: "代表本人核对公开信息",
          expectedOutcome: "要点清单",
        },
      });
      assert.equal(edited.ok, true);
      assert.equal(edited.task.title, "合法改标题");
      assert.equal(edited.task.taskIntent.role, "代表本人核对公开信息");
      assert.equal(edited.task.invocations.length, histLen);

      const goal2 = "完全不同的新目标：表达风格润色";
      const changed = await saveDraftFromRenderer(actStore, ud, {
        taskId: task.taskId,
        goal: goal2,
        status: "draft",
        taskIntent: { goal: goal2 },
      });
      assert.equal(changed.ok, true);
      assert.equal(changed.invalidatedConfirmed, true);
      assert.equal(changed.task.invocations.length, histLen);
      assert.equal(changed.task.subjectContext, null);
      assert.ok(changed.task.priorSubjectContext);
      assert.equal(isResearchResultCurrent(changed.task), false);
    } finally {
      cleanup(ud);
    }
  });

  await test("runReadonlyExternalResearch still appends after boundary save", async () => {
    const ud = tempUserData();
    try {
      const task = await seedConfirmedTask(ud, "追加调用仍可用");
      await saveDraftFromRenderer(actStore, ud, {
        taskId: task.taskId,
        goal: "追加调用仍可用",
        invocations: [{ invocationId: "should_ignore", status: "succeeded" }],
      });
      const out = await runReadonlyExternalResearch({
        userData: ud,
        taskId: task.taskId,
        store: actStore,
        skills: personalSkills,
        searchWeb: fakeSearchWebFactory(),
        forceFake: true,
      });
      assert.equal(out.ok, true);
      assert.ok(out.task.invocations.length >= 2);
      assert.ok(!out.task.invocations.some((i) => i.invocationId === "should_ignore"));
      assert.equal(out.toolInvocation.status, "succeeded");
    } finally {
      cleanup(ud);
    }
  });

  await test("buildDraftSaveRecord never copies nested task.invocations forge", () => {
    const existing = {
      taskId: "abt_x",
      goal: "g",
      taskIntent: normalizeTaskIntent({ goal: "g" }, "abt_x"),
      invocations: [{ invocationId: "inv_real", status: "succeeded" }],
      selectedSkillId: ALLOWED_SKILL_ID,
    };
    const built = buildDraftSaveRecord({
      existing,
      rendererPayload: {
        taskId: "abt_x",
        goal: "g",
        task: {
          invocations: [{ invocationId: "inv_nested", status: "succeeded" }],
          selectedSkillId: "psk_preset_quick_brief",
        },
      },
    });
    assert.equal(built.record.invocations.length, 1);
    assert.equal(built.record.invocations[0].invocationId, "inv_real");
    assert.equal(built.record.selectedSkillId, ALLOWED_SKILL_ID);
    assert.equal(built.rejectedRendererResearch, true);
  });

  console.log("\nvl1 block2 contracts:", passed, "passed,", failed, "failed");
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
