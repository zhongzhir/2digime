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
const { mapInternalCapabilityToUser, sanitizeNavTarget, isUserStatus } = require("../src/subject-overview/panorama");

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
    // buildSubjectOverviewV1 only accepts runtime flags; forged panorama must be ignored
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
    assert.equal(byId.acts_for_me.userStatus, USER_STATUS.NOT_OPEN);
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
    assert.equal(byId.collaborate.userStatus, USER_STATUS.NOT_OPEN);
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
    const overview = buildSubjectOverviewV1(missing, {});
    assert.equal(overview.package.healthStatus, "missing");
    assert.equal(overview.panorama.hero.displayName, null);
    assert.match(overview.panorama.hero.title, /尚未命名/);
    assert.notEqual(overview.panorama.promises.find((p) => p.id === "this_is_me").userStatus, USER_STATUS.AVAILABLE);
  } finally {
    cleanup(path.dirname(missing));
  }
});

test("payload has no secrets absolute paths or persona body", () => {
  const dir = makeV02("leak");
  try {
    const overview = buildSubjectOverviewV1(dir, { hasApiKey: true });
    const raw = JSON.stringify(overview);
    assert.equal(raw.includes("apiKey"), false);
    assert.equal(raw.includes("sk-"), false);
    assert.equal(/[A-Za-z]:\\\\|\/Users\/|\/home\//.test(raw), false);
    assert.equal(raw.includes("persona.json"), false);
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
    assert.equal(overview.panorama.promises.find((p) => p.id === "acts_for_me").userStatus, USER_STATUS.NOT_OPEN);
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
      if (j.userStatus === USER_STATUS.NOT_OPEN || j.userStatus === USER_STATUS.PREVIEW) {
        if (j.id === "authorize" || j.id === "collaborate") {
          assert.equal(j.navTarget, null);
        }
      }
    }
  } finally {
    cleanup(dir);
  }
});

console.log(`\nPAN-01 results: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
