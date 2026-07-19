"use strict";

/**
 * PAN-01 Product Panorama Home hermetic tests (temp fixtures only).
 * Run: node scripts/test-pan-01-product-panorama.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { createMinimalFixture } = require("../src/package-store/fixture");
const { PackageStore } = require("../src/package-store");
const {
  buildSubjectOverviewV1,
  SUBJECT_OVERVIEW_CONTRACT_VERSION,
} = require("../src/subject-overview");
const {
  USER_STATUS,
  USER_STATUS_LABEL,
  PANORAMA_STATUS_CONTRACT_VERSION,
  PANORAMA_NAV_TARGETS,
} = require("../src/subject-overview/constants");
const {
  mapInternalCapabilityToUser,
  sanitizeNavTarget,
  isUserStatus,
  buildDirection,
} = require("../src/subject-overview/panorama");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, err && err.stack ? err.stack : err);
  }
}

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dm-pan01-${label}-`));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function dirFingerprint(root) {
  const out = [];
  function walk(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      const st = fs.lstatSync(full);
      if (st.isDirectory()) walk(full);
      else {
        const buf = fs.readFileSync(full);
        out.push({
          rel,
          sha256: crypto.createHash("sha256").update(buf).digest("hex"),
          bytes: buf.length,
        });
      }
    }
  }
  if (fs.existsSync(root)) walk(root);
  return JSON.stringify(out);
}

function makeV02(label) {
  const dir = tempDir(label);
  createMinimalFixture(dir);
  const s = new PackageStore({ packageDir: dir, ownerId: "test:pan01" });
  s.migrateToV02({ actor: "test:pan01", toolVersion: "test-pan-01" });
  return dir;
}

function assertFiveState(status) {
  assert.equal(isUserStatus(status), true, `not a five-state: ${status}`);
}

function collectUserStatuses(panorama) {
  const out = [];
  for (const p of panorama.promises || []) out.push(p.userStatus);
  for (const j of panorama.journey || []) out.push(j.userStatus);
  return out;
}

function promiseById(overview, id) {
  return overview.panorama.promises.find((p) => p.id === id);
}

function assertNoLeak(raw) {
  assert.equal(raw.includes("apiKey"), false);
  assert.equal(raw.includes("sk-"), false);
  assert.equal(/[A-Za-z]:\\\\|\/Users\/|\/home\//.test(raw), false);
  assert.equal(raw.includes("persona.md"), false);
}

test("bytes unchanged around buildSubjectOverviewV1", () => {
  const dir = makeV02("bytes");
  try {
    const before = dirFingerprint(dir);
    const overview = buildSubjectOverviewV1(dir, { hasApiKey: false });
    const after = dirFingerprint(dir);
    assert.equal(after, before);
    assert.equal(overview.contractVersion, SUBJECT_OVERVIEW_CONTRACT_VERSION);
    assert.ok(overview.panorama);
  } finally {
    cleanup(dir);
  }
});

test("panorama structure and status contract fixed", () => {
  const dir = makeV02("struct");
  try {
    const overview = buildSubjectOverviewV1(dir, { hasApiKey: true });
    const p = overview.panorama;
    assert.equal(p.statusContractVersion, PANORAMA_STATUS_CONTRACT_VERSION);
    assert.ok(p.hero && typeof p.hero.title === "string");
    assert.ok(Array.isArray(p.promises) && p.promises.length === 4);
    assert.ok(Array.isArray(p.journey) && p.journey.length === 5);
    assert.ok(p.direction && p.nextAction);
    assert.ok(p.minimalSurface && p.minimalSurface.priority === "P4");
    assert.equal(p.minimalSurface.primaryAction, "start_work");
    assert.equal(p.nextAction.navTarget, "chat");
    assert.notEqual(p.nextAction.navTarget, "panorama-experience");
  } finally {
    cleanup(dir);
  }
});

test("all user statuses are five-state only", () => {
  const dir = makeV02("fivestate");
  try {
    const overview = buildSubjectOverviewV1(dir, { hasApiKey: false });
    for (const s of collectUserStatuses(overview.panorama)) assertFiveState(s);
    for (const cap of overview.capabilities) {
      assertFiveState(cap.userStatus);
      assert.equal(cap.userStatusLabel, USER_STATUS_LABEL[cap.userStatus]);
    }
  } finally {
    cleanup(dir);
  }
});

test("renderer cannot pass or override status via getOverview args", () => {
  const dir = makeV02("no-override");
  try {
    const forged = {
      hasApiKey: false,
      panorama: { promises: [{ userStatus: "available" }] },
      identity: { displayName: "HACKED" },
    };
    const overview = buildSubjectOverviewV1(dir, forged);
    assert.notEqual(overview.identity.displayName, "HACKED");
    assert.notEqual(
      JSON.stringify(overview.panorama.promises),
      JSON.stringify(forged.panorama.promises)
    );
  } finally {
    cleanup(dir);
  }
});

test("four promises order and initial statuses", () => {
  const dir = makeV02("promises");
  try {
    const overview = buildSubjectOverviewV1(dir, { hasApiKey: true });
    const ids = overview.panorama.promises.map((p) => p.id);
    assert.deepEqual(ids, ["this_is_me", "belongs_to_me", "controlled_by_me", "acts_for_me"]);
    const byId = Object.fromEntries(overview.panorama.promises.map((p) => [p.id, p]));
    assert.equal(byId.this_is_me.userStatus, USER_STATUS.AVAILABLE);
    assert.equal(byId.belongs_to_me.userStatus, USER_STATUS.EXPERIMENT);
    assert.equal(byId.controlled_by_me.userStatus, USER_STATUS.EXPERIMENT);
    assert.equal(byId.acts_for_me.userStatus, USER_STATUS.LOCAL_SIM);
    assert.equal(byId.acts_for_me.navTarget, null);
  } finally {
    cleanup(dir);
  }
});

test("journey order and initial statuses", () => {
  const dir = makeV02("journey");
  try {
    const overview = buildSubjectOverviewV1(dir, { hasApiKey: true });
    const ids = overview.panorama.journey.map((j) => j.id);
    assert.deepEqual(ids, ["build", "see", "arm", "authorize", "collaborate"]);
    const byId = Object.fromEntries(overview.panorama.journey.map((j) => [j.id, j]));
    assert.equal(byId.build.userStatus, USER_STATUS.EXPERIMENT);
    assert.equal(byId.see.userStatus, USER_STATUS.AVAILABLE);
    assert.equal(byId.arm.userStatus, USER_STATUS.EXPERIMENT);
    assert.equal(byId.authorize.userStatus, USER_STATUS.PREVIEW);
    assert.equal(byId.collaborate.userStatus, USER_STATUS.LOCAL_SIM);
    assert.equal(byId.authorize.navTarget, null);
    assert.equal(byId.collaborate.navTarget, null);
  } finally {
    cleanup(dir);
  }
});

test("internalStatus to userStatus mapping fail-closed", () => {
  assert.equal(mapInternalCapabilityToUser("available").userStatus, USER_STATUS.AVAILABLE);
  assert.equal(mapInternalCapabilityToUser("limited").userStatus, USER_STATUS.EXPERIMENT);
  assert.equal(mapInternalCapabilityToUser("experimental").userStatus, USER_STATUS.EXPERIMENT);
  assert.equal(mapInternalCapabilityToUser("unavailable").userStatus, USER_STATUS.NOT_OPEN);
  assert.equal(mapInternalCapabilityToUser("unknown").userStatus, USER_STATUS.NOT_OPEN);
  assert.equal(mapInternalCapabilityToUser("totally_bogus").userStatus, USER_STATUS.NOT_OPEN);
});

test("missing API key only sets currentCondition", () => {
  const mapped = mapInternalCapabilityToUser("unavailable", { missingApiKey: true });
  assert.equal(mapped.userStatus, USER_STATUS.NOT_OPEN);
  assert.equal(mapped.currentCondition, "尚未配置智能引擎");
  const dir = makeV02("apikey");
  try {
    const overview = buildSubjectOverviewV1(dir, { hasApiKey: false });
    const dialogue = overview.capabilities.find((c) => c.id === "dialogue");
    assert.ok(dialogue);
    assert.equal(dialogue.currentCondition, "尚未配置智能引擎");
    assertFiveState(dialogue.userStatus);
    assert.notEqual(dialogue.userStatusLabel, "不可用");
    assert.notEqual(dialogue.userStatusLabel, "未知");
    assert.notEqual(dialogue.userStatusLabel, "受限");
    assert.notEqual(dialogue.userStatusLabel, "实验中");
  } finally {
    cleanup(dir);
  }
});

test("package missing / unknown name fail-closed", () => {
  const missing = path.join(tempDir("missing-root"), "no-such-package");
  try {
    const beforeParent = dirFingerprint(path.dirname(missing));
    const overview = buildSubjectOverviewV1(missing, {});
    assert.equal(overview.package.healthStatus, "missing");
    assert.equal(overview.panorama.hero.displayName, null);
    assert.match(overview.panorama.hero.title, /尚未命名/);
    assert.match(overview.panorama.hero.statusLine, /本机资料尚未就绪/);
    assert.equal(overview.panorama.hero.statusLine.includes("本机私有"), false);
    assert.equal(overview.panorama.hero.statusLine.includes("资料由你保管"), false);
    assert.equal(overview.package.privacyLabel, "隐私状态尚无法确认");
    assert.notEqual(promiseById(overview, "this_is_me").userStatus, USER_STATUS.AVAILABLE);
    assert.equal(promiseById(overview, "belongs_to_me").userStatus, USER_STATUS.PREVIEW);
    assert.equal(overview.panorama.nextAction.navTarget, "me-build");
    assert.equal(dirFingerprint(path.dirname(missing)), beforeParent);
  } finally {
    cleanup(path.dirname(missing));
  }
});

test("payload has no secrets absolute paths or persona body", () => {
  const dir = makeV02("leak");
  try {
    const overview = buildSubjectOverviewV1(dir, { hasApiKey: true });
    assertNoLeak(JSON.stringify(overview));
  } finally {
    cleanup(dir);
  }
});

test("contracts examples do not open collaboration", () => {
  const dir = makeV02("contracts");
  try {
    const contracts = path.join(dir, "contracts");
    fs.mkdirSync(contracts, { recursive: true });
    fs.writeFileSync(path.join(contracts, "agent-card.example.json"), "{}", "utf8");
    const overview = buildSubjectOverviewV1(dir, {});
    assert.equal(overview.collaboration.authorizationStatus, "none");
    assert.equal(promiseById(overview, "acts_for_me").userStatus, USER_STATUS.LOCAL_SIM);
  } finally {
    cleanup(dir);
  }
});

test("navTarget whitelist only", () => {
  assert.equal(sanitizeNavTarget("me-build"), "me-build");
  assert.equal(sanitizeNavTarget("capabilities"), "capabilities");
  assert.equal(sanitizeNavTarget("evil"), null);
  assert.equal(sanitizeNavTarget("../../etc"), null);
  assert.equal(sanitizeNavTarget(null), null);
  const dir = makeV02("nav");
  try {
    const overview = buildSubjectOverviewV1(dir, {});
    for (const p of overview.panorama.promises) {
      if (p.navTarget) assert.equal(PANORAMA_NAV_TARGETS.has(p.navTarget), true);
    }
    for (const j of overview.panorama.journey) {
      if (j.navTarget) assert.equal(PANORAMA_NAV_TARGETS.has(j.navTarget), true);
      if (j.id === "authorize") {
        assert.equal(j.navTarget, null);
      }
      if (j.id === "collaborate") {
        assert.equal(j.navTarget, null);
      }
    }
  } finally {
    cleanup(dir);
  }
});

test("manifest.json corrupt: desensitized warning and Hero fail-closed", () => {
  const dir = makeV02("manifest-corrupt");
  try {
    fs.writeFileSync(path.join(dir, "manifest.json"), "{not-json", "utf8");
    const before = dirFingerprint(dir);
    const overview = buildSubjectOverviewV1(dir, {});
    assert.equal(dirFingerprint(dir), before);
    assert.ok(overview.warnings.some((w) => w.code === "manifest_parse_error"));
    assert.equal(
      overview.warnings.some((w) => /not-json|SyntaxError|[A-Za-z]:\\|\/Users\//.test(w.message || "")),
      false
    );
    assert.notEqual(promiseById(overview, "this_is_me").userStatus, USER_STATUS.AVAILABLE);
    assert.equal(overview.panorama.hero.statusLine.includes("本机私有"), false);
    assert.equal(overview.panorama.hero.statusLine.includes("资料由你保管"), false);
    assert.equal(overview.panorama.hero.accessLabel, "隐私状态尚无法确认");
    assert.equal(overview.package.privacyStatus, "unknown");
    assert.equal(overview.package.privacyLabel, "隐私状态尚无法确认");
    assert.equal(overview.panorama.hero.subjectReadStatus, "read_error");
    assertNoLeak(JSON.stringify(overview));
  } finally {
    cleanup(dir);
  }
});

test("identity.json corrupt: fail-closed", () => {
  const dir = makeV02("identity-corrupt");
  try {
    fs.writeFileSync(path.join(dir, "identity.json"), "{broken", "utf8");
    const before = dirFingerprint(dir);
    const overview = buildSubjectOverviewV1(dir, {});
    assert.equal(dirFingerprint(dir), before);
    assert.ok(overview.warnings.some((w) => w.code === "identity_parse_error"));
    assert.equal(promiseById(overview, "this_is_me").userStatus, USER_STATUS.PREVIEW);
    const see = overview.panorama.journey.find((j) => j.id === "see");
    assert.equal(see.userStatus, USER_STATUS.PREVIEW);
    assert.equal(overview.panorama.hero.subjectReadStatus, "read_error");
    assert.equal(overview.panorama.hero.ownerLabel, "尚无法确认");
    assert.notEqual(overview.panorama.hero.accessLabel, "当前仅本人可访问");
    assert.match(overview.panorama.hero.accessLabel, /尚无法确认|读取异常/);
    assert.equal(overview.panorama.hero.statusLine.includes("本机私有"), false);
    assert.equal(overview.panorama.hero.statusLine.includes("资料由你保管"), false);
    assert.match(overview.panorama.hero.statusLine, /主体资料读取异常/);
    // Manifest may still expose default-private *configuration*, not verified access.
    if (overview.package.privacyStatus === "local_private") {
      assert.match(overview.panorama.hero.privacyLabel, /^隐私配置：/);
      assert.equal(overview.panorama.hero.privacyLabel.includes("默认私有"), true);
    }
    // 属于我 remains independent when only identity fails
    assert.equal(promiseById(overview, "belongs_to_me").userStatus, USER_STATUS.EXPERIMENT);
    assertNoLeak(JSON.stringify(overview));
  } finally {
    cleanup(dir);
  }
});

test("layer JSON corrupt: unknown count and degrade 这是我/看见我", () => {
  const dir = makeV02("layer-corrupt");
  try {
    fs.mkdirSync(path.join(dir, "life"), { recursive: true });
    fs.writeFileSync(path.join(dir, "life", "roles.json"), "{bad", "utf8");
    const before = dirFingerprint(dir);
    const overview = buildSubjectOverviewV1(dir, {});
    assert.equal(dirFingerprint(dir), before);
    const state = overview.layers.find((l) => l.kind === "current_state");
    assert.ok(state);
    assert.notEqual(state.countStatus, "known");
    assert.ok(state.countStatus === "unknown" || state.countStatus === "partial");
    if (state.countStatus === "unknown") assert.equal(state.count, null);
    assert.equal(promiseById(overview, "this_is_me").userStatus, USER_STATUS.PREVIEW);
    const see = overview.panorama.journey.find((j) => j.id === "see");
    assert.equal(see.userStatus, USER_STATUS.PREVIEW);
    assert.equal(promiseById(overview, "this_is_me").currentCondition, "部分主体资料损坏或无法读取");
    assert.equal(see.currentCondition, "部分主体资料损坏或无法读取");
    assert.equal(overview.panorama.hero.subjectReadStatus, "content_degraded");
    // Independent promises not blanket-downgraded by layer damage
    assert.equal(promiseById(overview, "belongs_to_me").userStatus, USER_STATUS.EXPERIMENT);
    assert.equal(promiseById(overview, "controlled_by_me").userStatus, USER_STATUS.EXPERIMENT);
    const raw = JSON.stringify(overview);
    assert.equal(raw.includes("{bad"), false);
    assertNoLeak(raw);
  } finally {
    cleanup(dir);
  }
});

test("JSONL corrupt degrades 这是我/看见我", () => {
  const dir = makeV02("jsonl-corrupt");
  try {
    fs.mkdirSync(path.join(dir, "life"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "life", "events.jsonl"),
      '{"id":"ok","type":"event"}\n{not-json\n',
      "utf8"
    );
    const before = dirFingerprint(dir);
    const overview = buildSubjectOverviewV1(dir, {});
    assert.equal(dirFingerprint(dir), before);
    assert.ok(
      overview.warnings.some(
        (w) =>
          w.code === "jsonl_parse_error" ||
          w.code === "jsonl_invalid" ||
          w.code === "json_parse_error"
      )
    );
    assert.equal(promiseById(overview, "this_is_me").userStatus, USER_STATUS.PREVIEW);
    const see = overview.panorama.journey.find((j) => j.id === "see");
    assert.equal(see.userStatus, USER_STATUS.PREVIEW);
    assert.equal(see.currentCondition, "部分主体资料损坏或无法读取");
    assert.equal(overview.panorama.hero.subjectReadStatus, "content_degraded");
    assertNoLeak(JSON.stringify(overview));
  } finally {
    cleanup(dir);
  }
});

test("legacy v0.1 readable package is not treated as content damaged", () => {
  const dir = tempDir("v01-legacy");
  try {
    createMinimalFixture(dir);
    const before = dirFingerprint(dir);
    const overview = buildSubjectOverviewV1(dir, {});
    assert.equal(dirFingerprint(dir), before);
    assert.notEqual(overview.package.healthStatus, "unhealthy");
    assert.notEqual(overview.panorama.hero.subjectReadStatus, "content_degraded");
    assert.equal(promiseById(overview, "this_is_me").userStatus, USER_STATUS.AVAILABLE);
    const see = overview.panorama.journey.find((j) => j.id === "see");
    assert.equal(see.userStatus, USER_STATUS.AVAILABLE);
  } finally {
    cleanup(dir);
  }
});

test("privacyStatus unknown: no private success claims", () => {
  const dir = makeV02("privacy-unknown");
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    manifest.packageType = "shared";
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    const overview = buildSubjectOverviewV1(dir, {});
    assert.equal(overview.package.privacyStatus, "unknown");
    assert.equal(overview.package.privacyLabel, "隐私状态尚无法确认");
    assert.equal(overview.panorama.hero.accessLabel, "隐私状态尚无法确认");
    assert.equal(overview.panorama.hero.privacyLabel, "隐私状态尚无法确认");
    assert.equal(overview.panorama.hero.statusLine.includes("本机私有"), false);
    assert.equal(overview.panorama.hero.statusLine.includes("资料由你保管"), false);
    assert.match(overview.panorama.hero.statusLine, /隐私状态尚无法确认/);
  } finally {
    cleanup(dir);
  }
});

test("ordinary owner_assertion is not confirmed development intent", () => {
  const dir = makeV02("owner-not-intent");
  try {
    const now = new Date().toISOString();
    fs.appendFileSync(
      path.join(dir, "memory", "long-term-memory.jsonl"),
      JSON.stringify({
        id: "oa_1",
        type: "long_term",
        content: "我偏好简洁表达",
        dataKind: "owner_assertion",
        ownerConfirmed: true,
        confirmedBy: "owner",
        createdAt: now,
        sourceRefs: ["feedback"],
      }) + "\n",
      "utf8"
    );
    const overview = buildSubjectOverviewV1(dir, {});
    const owner = overview.layers.find((l) => l.kind === "owner_assertion");
    assert.ok(owner && owner.count > 0);
    assert.equal(overview.panorama.direction.kind, "none");
    assert.match(overview.panorama.direction.summary, /尚未建立本人确认的发展意图/);
  } finally {
    cleanup(dir);
  }
});

test("mind_hooks interests capability_signals are direction clues only", () => {
  const dir = makeV02("direction-clue");
  try {
    fs.mkdirSync(path.join(dir, "life"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "life", "mind_hooks.json"),
      JSON.stringify({ items: [{ id: "h1", text: "想加强写作" }] }, null, 2),
      "utf8"
    );
    fs.writeFileSync(
      path.join(dir, "life", "interests.json"),
      JSON.stringify({ items: [{ id: "i1", text: "产品设计" }] }, null, 2),
      "utf8"
    );
    const overview = buildSubjectOverviewV1(dir, {});
    assert.equal(overview.panorama.direction.kind, "direction_clue");
    assert.equal(overview.panorama.direction.title, "发展方向线索");
    assert.match(overview.panorama.direction.summary, /方向线索/);
  } finally {
    cleanup(dir);
  }
});

test("no direction evidence yields none", () => {
  const dir = makeV02("direction-none");
  try {
    const overview = buildSubjectOverviewV1(dir, {});
    assert.equal(overview.panorama.direction.kind, "none");
    assert.equal(buildDirection(overview.layers).kind, "none");
  } finally {
    cleanup(dir);
  }
});

test("controlled_by_me evidence reflects boundaries present / missing / corrupt", () => {
  const withBounds = makeV02("bounds-ok");
  try {
    fs.mkdirSync(path.join(withBounds, "policies"), { recursive: true });
    fs.writeFileSync(
      path.join(withBounds, "policies", "boundaries.json"),
      JSON.stringify({ items: [{ id: "b1", enabled: true, text: "不得对外自动授权" }] }, null, 2),
      "utf8"
    );
    const overview = buildSubjectOverviewV1(withBounds, {});
    const p = promiseById(overview, "controlled_by_me");
    assert.equal(p.userStatus, USER_STATUS.EXPERIMENT);
    assert.match(p.evidence, /已启用 1 条边界/);
    assert.equal(p.currentCondition || "", "");
  } finally {
    cleanup(withBounds);
  }

  const missingBounds = makeV02("bounds-missing");
  try {
    const policies = path.join(missingBounds, "policies");
    if (fs.existsSync(path.join(policies, "boundaries.json"))) {
      fs.unlinkSync(path.join(policies, "boundaries.json"));
    }
    const overview = buildSubjectOverviewV1(missingBounds, {});
    const p = promiseById(overview, "controlled_by_me");
    assert.match(p.evidence, /尚未建立边界文件/);
    assert.match(p.currentCondition || "", /尚未建立/);
  } finally {
    cleanup(missingBounds);
  }

  const corruptBounds = makeV02("bounds-corrupt");
  try {
    fs.mkdirSync(path.join(corruptBounds, "policies"), { recursive: true });
    fs.writeFileSync(path.join(corruptBounds, "policies", "boundaries.json"), "{nope", "utf8");
    const overview = buildSubjectOverviewV1(corruptBounds, {});
    const p = promiseById(overview, "controlled_by_me");
    assert.match(p.evidence, /无法解析/);
    assert.match(p.currentCondition || "", /无法解析/);
    assert.ok(overview.warnings.some((w) => w.code === "boundaries_parse_error"));
    assertNoLeak(JSON.stringify(overview));
  } finally {
    cleanup(corruptBounds);
  }
});

test("belongs_to_me evidence uses revision recoverability without absolute paths", () => {
  const dir = makeV02("belongs");
  try {
    const overview = buildSubjectOverviewV1(dir, {});
    const p = promiseById(overview, "belongs_to_me");
    assert.equal(p.userStatus, USER_STATUS.EXPERIMENT);
    assert.match(p.evidence, /本机资料目录/);
    assert.equal(/[A-Za-z]:\\|\/Users\/|\/home\//.test(p.evidence), false);
  } finally {
    cleanup(dir);
  }
});

test("added statuses remain five-state across fail-closed fixtures", () => {
  const cases = [];
  const missing = path.join(tempDir("five-missing"), "gone");
  cases.push(missing);
  const corrupt = makeV02("five-corrupt");
  fs.writeFileSync(path.join(corrupt, "manifest.json"), "{x", "utf8");
  cases.push(corrupt);
  try {
    for (const dir of cases) {
      const overview = buildSubjectOverviewV1(dir, {});
      for (const s of collectUserStatuses(overview.panorama)) assertFiveState(s);
    }
  } finally {
    cleanup(path.dirname(missing));
    cleanup(corrupt);
  }
});

console.log(`\nPAN-01 results: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
