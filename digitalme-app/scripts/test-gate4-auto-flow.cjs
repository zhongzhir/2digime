"use strict";

/**
 * Gate 4 auto-flow contract tests
 * Validates autoSelectCandidates complete chain without Electron.
 */

const { autoSelectCandidates, assembleSubjectContextCandidates } = require("../src/act-behalf/subject-context-assembly");

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error("FAIL: " + label);
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
    identitySummary: "个人数字主体建设者。",
    preferences: "偏好结构化短文。",
    longTermMemory:
      JSON.stringify({ type: "long_term", content: "我认为公开市场短期波动不应直接改写长期投资框架。", theme: "投资判断", confidence: "high" }) +
      "\n" +
      JSON.stringify({ type: "long_term", content: "写作时应区分本人既有观点与外部事实。", theme: "表达", confidence: "high" }) +
      "\n",
    decisionFrameworks: JSON.stringify({ frameworks: [{ name: "长期框架优先", principles: ["证据不足时明确不确定"] }] }),
  };
}

// ── Test 1: autoSelectCandidates 存在且返回正确结构 ──
(function testStructure() {
  console.log("Test 1: autoSelectCandidates exists and returns correct shape");

  const pkg = samplePkg();
  const result = autoSelectCandidates(pkg, { goal: "研究投资框架" });

  assert(result && typeof result === "object", "result is object");
  assert(typeof result.ok === "boolean", "result.ok is boolean");
  assert(Array.isArray(result.autoSelectedClaims), "autoSelectedClaims is array");
  assert(typeof result.autoSelectedCount === "number", "autoSelectedCount is number");
  assert(Array.isArray(result.sensitiveClaims), "sensitiveClaims is array");
  assert(Array.isArray(result.excludedByAutoSelect), "excludedByAutoSelect is array");
  assert(result.ok === true, "result.ok is true with valid goal");
})();

// ── Test 2: 空 goal——不崩溃，返回降级结果 ──
(function testEmptyGoal() {
  console.log("Test 2: empty goal returns degraded result without crash");

  const pkg = samplePkg();
  let result;
  try {
    result = autoSelectCandidates(pkg, { goal: "" });
  } catch (e) {
    assert(false, "empty goal should not throw: " + e.message);
    return;
  }

  assert(result && typeof result === "object", "result is object for empty goal");
  assert(result.ok === true, "ok is true for empty goal (degraded fallback)");
  const draft = result.subjectContextDraft;
  assert(draft && typeof draft === "object", "draft is present");
  if (draft && draft.rankingMeta) {
    assert(draft.rankingMeta.degraded === true, "degraded flag is true when goal is empty");
    assert(typeof draft.rankingMeta.method === "string", "ranking method is set");
  }
})();

// ── Test 3: 有 goal 返回 autoSelectedClaims ──
(function testValidGoalReturnsClaims() {
  console.log("Test 3: valid goal returns autoSelectedClaims");

  const pkg = samplePkg();
  const result = autoSelectCandidates(pkg, { goal: "公开市场波动与长期投资判断框架" });

  assert(Array.isArray(result.autoSelectedClaims), "autoSelectedClaims is array");
  assert(result.autoSelectedClaims.length > 0, "autoSelectedClaims not empty for valid goal");
  assert(typeof result.autoSelectedClaims[0].id === "string", "claim has id");
  assert(typeof result.autoSelectedClaims[0].text === "string", "claim has text");
  assert(typeof result.autoSelectedClaims[0].kind === "string", "claim has kind");
  assert(Array.isArray(result.autoSelectedClaims[0].sourceRefs), "claim has sourceRefs");
})();

// ── Test 4: autoSelectedCount 正确 ──
(function testAutoSelectedCount() {
  console.log("Test 4: autoSelectedCount matches claims array length");

  const pkg = samplePkg();
  const result = autoSelectCandidates(pkg, { goal: "投资与表达风格" });

  assert(
    result.autoSelectedCount === result.autoSelectedClaims.length,
    "autoSelectedCount equals claims length (" +
      result.autoSelectedCount +
      " vs " +
      result.autoSelectedClaims.length +
      ")"
  );
})();

// ── Test 5: sensitiveClaims 中只包含 boundary/identity 类型 ──
(function testSensitiveClaimsOnlyBoundaryOrIdentity() {
  console.log("Test 5: sensitiveClaims only contain boundary/identity kinds");

  const pkg = samplePkg();
  const result = autoSelectCandidates(pkg, { goal: "个人边界与身份验证" });

  assert(Array.isArray(result.sensitiveClaims), "sensitiveClaims is array");

  // sensitiveClaims source is a file path (e.g. "policies/boundaries.json", "identity.json")
  const boundaryIdentityPaths = [
    "policies/boundaries.json",
    "identity.json",
    "boundaries",
    "identity",
    "boundary",
  ];
  for (const sc of result.sensitiveClaims) {
    const src = (sc.source || "").toLowerCase();
    const isSensitiveSource = boundaryIdentityPaths.some(
      (p) => src.includes(p) || p.includes(src)
    );
    assert(
      isSensitiveSource,
      "sensitive claim source is boundary/identity, got: " + sc.source
    );
  }

  for (const sc of result.sensitiveClaims) {
    assert(typeof sc.claimId === "string", "sensitive claim has claimId");
    assert(typeof sc.text === "string", "sensitive claim has text");
    assert(typeof sc.source === "string", "sensitive claim has source");
    assert(
      sc.reason === "sensitive_or_high_impact",
      "sensitive claim reason is sensitive_or_high_impact"
    );
  }
})();

// ── Test 6: 零资料 Package 不崩溃 ──
(function testEmptyMinimalPackage() {
  console.log("Test 6: empty/minimal package does not crash");

  const emptyPkg = { exists: true };

  let result1;
  try {
    result1 = autoSelectCandidates(emptyPkg, { goal: "任意目标" });
  } catch (e) {
    assert(false, "empty pkg should not throw: " + e.message);
    return;
  }
  assert(result1 && typeof result1 === "object", "result is object for empty pkg");
  assert(typeof result1.ok === "boolean", "ok is boolean for empty pkg");

  const minimalPkg = {
    exists: true,
    persona: "测试用户，关注AI和投资领域。",
    styleGuide: "表达简洁直接。",
    boundariesSummary: "不泄露个人隐私。",
  };

  let result2;
  try {
    result2 = autoSelectCandidates(minimalPkg, { goal: "AI与投资趋势" });
  } catch (e) {
    assert(false, "minimal pkg should not throw: " + e.message);
    return;
  }
  assert(result2 && typeof result2 === "object", "result is object for minimal pkg");
  assert(result2.ok === true, "ok is true for minimal pkg with goal");

  // Test with null pkg edge case
  let result3;
  try {
    result3 = autoSelectCandidates(null, { goal: "" });
  } catch (e) {
    assert(false, "null pkg should not throw: " + e.message);
    return;
  }
  assert(result3 && typeof result3 === "object", "result is object for null pkg");
  assert(Array.isArray(result3.autoSelectedClaims), "autoSelectedClaims is array for null pkg");
  assert(result3.autoSelectedCount === 0, "autoSelectedCount is 0 for null pkg");
})();

// ── Test 7: excludedByAutoSelect 结构正确 ──
(function testExcludedByAutoSelect() {
  console.log("Test 7: excludedByAutoSelect has correct shape");

  const pkg = samplePkg();
  const result = autoSelectCandidates(pkg, { goal: "投资判断" });

  assert(Array.isArray(result.excludedByAutoSelect), "excludedByAutoSelect is array");

  for (const exc of result.excludedByAutoSelect) {
    assert(typeof exc.claimId === "string", "excluded item has claimId");
    assert(typeof exc.text === "string", "excluded item has text");
    assert(typeof exc.source === "string", "excluded item has source");
    assert(typeof exc.score === "number", "excluded item has score");
  }

  // Total claims should be autoSelected + excluded (+ potential sensitive overlap accounted for)
  const total = result.autoSelectedCount + result.excludedByAutoSelect.length;
  const draft = result.subjectContextDraft;
  const sourceClaims = (draft && draft.claims) ? draft.claims.length : 0;
  assert(total >= sourceClaims, "autoSelected + excluded covers all claims (or more)");
})();

// ── Summary ──
console.log("\n" + passed + " passed, " + failed + " failed");
if (failed) process.exit(1);
