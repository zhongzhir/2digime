"use strict";

/**
 * Claim granularity: list bullets → independent deletable claims.
 * Run: npm run test:vl1-claim-granularity
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");

const {
  assembleSubjectContextCandidates,
  confirmSubjectContextWithUserActions,
  buildFallbackClaims,
  splitDocumentUnits,
  MAX_CANDIDATES,
} = require("../src/act-behalf/subject-context-assembly");
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

function hashDirFiles(dir) {
  const names = fs.readdirSync(dir).sort();
  const h = crypto.createHash("sha256");
  for (const name of names) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (!st.isFile()) continue;
    h.update(name);
    h.update(fs.readFileSync(p));
  }
  return h.digest("hex");
}

function lifeListPkg() {
  return {
    exists: true,
    dir: "D:/fake/digital-me-package",
    manifest: { packageId: "pkg_granularity", revision: 1, ownerDisplayName: "Owner" },
    persona: "我坚持本地优先与本人控制。",
    styleGuide: "表达克制、清楚。",
    lifeSummary:
      "## 社会角色与任职\n\n" +
      "- 本人参加了某培训研讨班（6月29日报到）\n" +
      "- 本人担任某机构负责人\n" +
      "- 本人长期关注一级市场投资\n",
    boundariesSummary: "不得擅自对外发送。",
    longTermMemory: "",
    decisionFrameworks: "",
    preferences: "",
    identitySummary: "",
  };
}

async function main() {
  await test("1. multi-bullet life list becomes three independent claims", () => {
    const units = splitDocumentUnits(lifeListPkg().lifeSummary, 480);
    assert.equal(units.length, 3);
    assert.ok(units.every((u) => u.kind === "list"));
    assert.ok(units.every((u) => u.sectionTitle === "社会角色与任职"));
    const texts = units.map((u) => u.text);
    assert.ok(texts.includes("本人参加了某培训研讨班（6月29日报到）"));
    assert.ok(texts.includes("本人担任某机构负责人"));
    assert.ok(texts.includes("本人长期关注一级市场投资"));
    assert.ok(!texts.some((t) => t.includes("##") || t === "社会角色与任职"));

    const assembled = assembleSubjectContextCandidates(lifeListPkg(), {
      goal: "培训研讨班与机构任职经历",
    });
    assert.equal(assembled.ok, true);
    const claims = assembled.subjectContextDraft.claims;
    const lifeFacts = claims.filter(
      (c) =>
        c.text.includes("培训研讨班") ||
        c.text.includes("机构负责人") ||
        c.text.includes("一级市场投资")
    );
    assert.equal(lifeFacts.length, 3, "expected three separate life fact claims, got " + lifeFacts.length);
    assert.ok(!claims.some((c) => (c.text || "").includes("\n- ")));
    assert.ok(!claims.some((c) => /^社会角色与任职$/.test(String(c.text || "").trim())));
  });

  await test("2. claim ids exist and are unique (not array indices)", () => {
    const assembled = assembleSubjectContextCandidates(lifeListPkg(), {
      goal: "培训研讨班与机构任职经历",
    });
    const lifeFacts = assembled.subjectContextDraft.claims.filter(
      (c) =>
        c.text.includes("培训研讨班") ||
        c.text.includes("机构负责人") ||
        c.text.includes("一级市场投资")
    );
    assert.equal(lifeFacts.length, 3);
    const ids = lifeFacts.map((c) => c.id);
    assert.ok(ids.every((id) => typeof id === "string" && id.length > 4));
    assert.equal(new Set(ids).size, 3);
    assert.ok(ids.every((id) => !/^(0|1|2)$/.test(id)));
  });

  await test("3. deleting one claim id keeps sibling bullets", () => {
    const assembled = assembleSubjectContextCandidates(lifeListPkg(), {
      goal: "培训研讨班与机构任职经历",
    });
    let claims = assembled.subjectContextDraft.claims.slice();
    const target = claims.find((c) => c.text.includes("培训研讨班"));
    assert.ok(target);
    const n = claims.length;
    claims = claims.filter((x) => x.id !== target.id);
    assert.equal(claims.length, n - 1);
    assert.ok(!claims.some((c) => c.text.includes("培训研讨班")));
    assert.ok(claims.some((c) => c.text.includes("机构负责人")));
    assert.ok(claims.some((c) => c.text.includes("一级市场投资")));
  });

  await test("4. split items keep life source and distinct item locators", () => {
    const assembled = assembleSubjectContextCandidates(lifeListPkg(), {
      goal: "培训研讨班与机构任职经历",
    });
    const lifeFacts = assembled.subjectContextDraft.claims.filter(
      (c) =>
        c.text.includes("培训研讨班") ||
        c.text.includes("机构负责人") ||
        c.text.includes("一级市场投资")
    );
    assert.equal(lifeFacts.length, 3);
    const locators = [];
    for (const c of lifeFacts) {
      assert.equal(c.kind, "life");
      assert.ok(c.label === "社会角色与任职" || c.label === "人生与经历摘要");
      const ref = c.sourceRefs && c.sourceRefs[0];
      assert.ok(ref);
      assert.equal(ref.source, "life/");
      assert.ok(String(ref.locator || "").startsWith("item:"));
      locators.push(ref.locator);
    }
    assert.equal(new Set(locators).size, 3);
  });

  await test("5. markdown heading is not a fact claim", () => {
    const units = splitDocumentUnits(
      "## 社会角色与任职\n\n- 本人参加了某培训研讨班（6月29日报到）\n",
      480
    );
    assert.ok(!units.some((u) => u.text.includes("##") || u.text === "社会角色与任职"));
    const assembled = assembleSubjectContextCandidates(lifeListPkg(), {
      goal: "培训研讨班",
    });
    assert.ok(
      !assembled.subjectContextDraft.claims.some(
        (c) => String(c.text || "").trim() === "社会角色与任职"
      )
    );
  });

  await test("6. ordinary multi-line prose is not split on single newlines", () => {
    const prose =
      "第一句说明本地优先的长期立场\n" +
      "第二句继续同一段落而未使用列表标记\n" +
      "第三句仍属同一说明块";
    const units = splitDocumentUnits(prose, 480);
    assert.equal(units.length, 1, "expected one prose unit, got " + units.length);
    assert.equal(units[0].kind, "para");
    assert.ok(units[0].text.includes("第一句"));
    assert.ok(units[0].text.includes("第二句"));
  });

  await test("7. mixed heading + prose + list splits lists only", () => {
    const mixed =
      "## 社会角色与任职\n\n" +
      "以下为补充说明，两行同属说明文字\n仍不应当因单换行拆开。\n\n" +
      "- 本人参加了某培训研讨班（6月29日报到）\n" +
      "- 本人担任某机构负责人\n";
    const units = splitDocumentUnits(mixed, 480);
    const lists = units.filter((u) => u.kind === "list");
    const paras = units.filter((u) => u.kind === "para");
    assert.equal(lists.length, 2);
    assert.ok(paras.length >= 1);
    assert.ok(paras.every((p) => !p.text.startsWith("- ")));
    assert.ok(lists.every((l) => l.sectionTitle === "社会角色与任职"));
  });

  await test("8. delete-style filter does not change package fixture bytes", () => {
    const pkgDir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-pkg-gran-"));
    try {
      fs.writeFileSync(path.join(pkgDir, "persona.md"), "本地优先。\n", "utf8");
      fs.writeFileSync(
        path.join(pkgDir, "life-note.md"),
        "## 社会角色与任职\n\n- 本人参加了某培训研讨班（6月29日报到）\n- 本人担任某机构负责人\n",
        "utf8"
      );
      const before = hashDirFiles(pkgDir);
      const assembled = assembleSubjectContextCandidates(
        {
          ...lifeListPkg(),
          dir: pkgDir,
        },
        { goal: "培训研讨班与机构任职经历" }
      );
      let claims = assembled.subjectContextDraft.claims.slice();
      const target = claims.find((c) => c.text.includes("培训研讨班"));
      assert.ok(target);
      claims = claims.filter((x) => x.id !== target.id);
      assert.ok(claims.length >= 1);
      const after = hashDirFiles(pkgDir);
      assert.equal(after, before);
    } finally {
      fs.rmSync(pkgDir, { recursive: true, force: true });
    }
  });

  await test("9. unsaved delete does not rewrite persisted subjectContextCandidates", async () => {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dm-gran-task-"));
    try {
      const assembled = assembleSubjectContextCandidates(lifeListPkg(), {
        goal: "培训研讨班与机构任职经历",
      });
      const saved = await actStore.saveTask(userData, {
        title: "粒度测试",
        request: "培训研讨班与机构任职经历",
        goal: "培训研讨班与机构任职经历",
        status: "draft",
        taskIntent: {
          goal: "培训研讨班与机构任职经历",
          role: "代表本人做研究与表达",
          expectedOutcome: "可编辑短文",
          riskLevel: "low",
          approvalPolicy: { allowExternalSend: false },
          constraints: [],
        },
        subjectContextCandidates: assembled.subjectContextDraft,
        subjectContext: null,
      });
      const originalIds = (saved.task.subjectContextCandidates.claims || []).map((c) => c.id);
      assert.ok(originalIds.length >= 3);

      // Simulate renderer-only delete (memory), without save.
      let draftClaims = (saved.task.subjectContextCandidates.claims || []).slice();
      const target = draftClaims.find((c) => c.text.includes("培训研讨班"));
      assert.ok(target);
      draftClaims = draftClaims.filter((x) => x.id !== target.id);

      const reloaded = actStore.getTask(userData, saved.task.taskId);
      assert.equal(reloaded.ok, true);
      const persisted = reloaded.task.subjectContextCandidates.claims || [];
      assert.equal(persisted.length, originalIds.length);
      assert.ok(persisted.some((c) => c.text.includes("培训研讨班")));
      assert.equal(draftClaims.length, originalIds.length - 1);
    } finally {
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });

  await test("10. confirm keeps keepClaimIds only and does not require package write", () => {
    const assembled = assembleSubjectContextCandidates(lifeListPkg(), {
      goal: "培训研讨班与机构任职经历",
    });
    const draft = assembled.subjectContextDraft;
    const keep = draft.claims
      .filter((c) => !c.text.includes("培训研讨班"))
      .map((c) => c.id);
    assert.ok(keep.length >= 2);
    const outcome = confirmSubjectContextWithUserActions(draft, {
      goal: "培训研讨班与机构任职经历",
      keepClaimIds: keep,
    });
    assert.equal(outcome.ok, true, outcome.message);
    assert.ok(!outcome.confirmed.claims.some((c) => c.text.includes("培训研讨班")));
    assert.ok(outcome.confirmed.claims.some((c) => c.text.includes("机构负责人")));
    assert.ok(Array.isArray(outcome.deletedClaimIds));
    assert.ok(outcome.deletedClaimIds.length >= 1);
    assert.ok(MAX_CANDIDATES >= 14);
  });

  await test("fallback path also splits multi-bullet life summary", () => {
    const claims = buildFallbackClaims(lifeListPkg());
    const lifeFacts = claims.filter(
      (c) =>
        c.text.includes("培训研讨班") ||
        c.text.includes("机构负责人") ||
        c.text.includes("一级市场投资")
    );
    assert.equal(lifeFacts.length, 3);
    assert.equal(new Set(lifeFacts.map((c) => c.id)).size, 3);
    assert.ok(lifeFacts.every((c) => String(c.sourceRefs[0].locator).includes("item:")));
  });

  console.log(`vl1 claim granularity: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
