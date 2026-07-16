"use strict";

/**
 * P1-03 SubjectOverview v1 tests (temp fixtures only).
 * Run: node scripts/test-p1-03-subject-overview.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { PackageStore, dirByteFingerprint, DATA_KINDS } = require("../src/package-store");
const { createMinimalFixture } = require("../src/package-store/fixture");
const {
  buildSubjectOverviewV1,
  SUBJECT_OVERVIEW_CONTRACT_VERSION,
} = require("../src/subject-overview");
const { LAYER_META } = require("../src/subject-overview/constants");

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
  return fs.mkdtempSync(path.join(os.tmpdir(), `dm-p103-${label}-`));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function makeV01(label) {
  const dir = tempDir(label);
  createMinimalFixture(dir);
  return dir;
}

function makeV02(label) {
  const dir = makeV01(label);
  const s = new PackageStore({ packageDir: dir, ownerId: "test:migrate" });
  s.migrateToV02({ actor: "test:migrate", toolVersion: "test-p1-03" });
  return dir;
}

function seedLifeFiles(dir) {
  const life = path.join(dir, "life");
  fs.mkdirSync(life, { recursive: true });
  fs.writeFileSync(
    path.join(life, "inferences.jsonl"),
    JSON.stringify({ id: "inf1", claim: "候选推断", status: "open" }) + "\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(life, "events.jsonl"),
    JSON.stringify({ id: "ev1", title: "事件" }) + "\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(life, "roles.json"),
    JSON.stringify({ items: [{ id: "r1", title: "角色" }] }),
    "utf8"
  );
}

function assertNoSecretsInPayload(overview) {
  const raw = JSON.stringify(overview);
  assert.equal(raw.includes("apiKey"), false);
  assert.equal(raw.includes("sk-"), false);
  assert.match(raw, /"locationLabel":"本机资料目录"/);
  assert.equal(/\b[A-Z]:\\/.test(raw), false, "must not expose absolute paths");
  assert.equal(raw.includes("演示用人格说明"), false, "must not embed persona body");
}

test("1. contractVersion fixed", () => {
  assert.equal(SUBJECT_OVERVIEW_CONTRACT_VERSION, "1");
});

test("2. v0.1 fixture overview leaves bytes unchanged", () => {
  const dir = makeV01("v01-readonly");
  try {
    const before = dirByteFingerprint(dir);
    const overview = buildSubjectOverviewV1(dir, { hasApiKey: false });
    const after = dirByteFingerprint(dir);
    assert.deepEqual(before, after);
    assert.equal(overview.contractVersion, "1");
    assert.ok(overview.layers.length === DATA_KINDS.length);
    assert.equal(overview.package.schemaVersion, null);
    assert.equal(overview.package.privacyLabel, "默认私有 · 未公开");
  } finally {
    cleanup(dir);
  }
});

test("3. v0.2 fixture returns revision and recoverability", () => {
  const dir = makeV02("v02-revision");
  try {
    seedLifeFiles(dir);
    const s = new PackageStore({ packageDir: dir, ownerId: "test:commit" });
    const cs = s.createChangeSet({
      actor: "owner:feedback",
      reason: "subject overview test",
      sourceRefs: ["test"],
      dataKinds: ["owner_assertion"],
      ops: [
        {
          type: "ensure_section_append",
          path: "style-guide.md",
          section: "## 用户反馈（风格纠正）",
          line: "- overview test line",
        },
      ],
    });
    s.commit(cs.id, { confirmed: true });
    const overview = buildSubjectOverviewV1(dir, { hasApiKey: true });
    assert.ok(typeof overview.package.revision === "number");
    assert.ok(overview.package.recoverability);
    assert.equal(overview.package.healthStatus, "healthy");
  } finally {
    cleanup(dir);
  }
});

test("4. seven layers mapped with labels and provenance", () => {
  const dir = makeV01("layers");
  try {
    seedLifeFiles(dir);
    fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "sources", "source-index.json"),
      JSON.stringify({ sources: [{ id: "s1" }] }),
      "utf8"
    );
    const overview = buildSubjectOverviewV1(dir);
    const kinds = overview.layers.map((l) => l.kind);
    assert.deepEqual(kinds, [...DATA_KINDS]);
    for (const layer of overview.layers) {
      assert.ok(LAYER_META[layer.kind], layer.kind);
      assert.equal(layer.userLabel, LAYER_META[layer.kind].userLabel);
      assert.ok(layer.explanation);
      assert.ok(["known", "unknown", "partial"].includes(layer.countStatus));
    }
    const inf = overview.layers.find((l) => l.kind === "inference");
    assert.equal(inf.count, 1);
    assert.notEqual(inf.userLabel, LAYER_META.fact.userLabel);
  } finally {
    cleanup(dir);
  }
});

test("5. inference not mapped as fact or owner assertion", () => {
  const dir = makeV01("inference-kind");
  try {
    seedLifeFiles(dir);
    const overview = buildSubjectOverviewV1(dir);
    const inf = overview.layers.find((l) => l.kind === "inference");
    const fact = overview.layers.find((l) => l.kind === "fact");
    const owner = overview.layers.find((l) => l.kind === "owner_assertion");
    assert.equal(inf.visualClass, "layer-inference");
    assert.equal(fact.visualClass, "layer-fact");
    assert.equal(owner.visualClass, "layer-owner");
    assert.notEqual(inf.userLabel, fact.userLabel);
    assert.notEqual(inf.userLabel, owner.userLabel);
  } finally {
    cleanup(dir);
  }
});

test("6. corrupt JSON returns warning and unknown counts", () => {
  const dir = makeV01("corrupt");
  try {
    fs.mkdirSync(path.join(dir, "policies"), { recursive: true });
    fs.writeFileSync(path.join(dir, "policies", "boundaries.json"), "{not json", "utf8");
    const overview = buildSubjectOverviewV1(dir);
    assert.ok(overview.warnings.some((w) => w.code === "boundaries_parse_error"));
    const policy = overview.layers.find((l) => l.kind === "capability_policy");
    assert.equal(policy.countStatus, "unknown");
  } finally {
    cleanup(dir);
  }
});

test("7. missing display name not fabricated", () => {
  const dir = makeV01("no-name");
  try {
    fs.writeFileSync(path.join(dir, "identity.json"), "{}", "utf8");
    fs.writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({ digitalMeId: "x", updatedAt: new Date().toISOString() }),
      "utf8"
    );
    const overview = buildSubjectOverviewV1(dir);
    assert.equal(overview.identity.displayName, null);
    assert.ok(overview.warnings.some((w) => w.code === "display_name_unknown"));
  } finally {
    cleanup(dir);
  }
});

test("8. privacy and collaboration default private / not established", () => {
  const dir = makeV02("privacy");
  try {
    const overview = buildSubjectOverviewV1(dir);
    assert.equal(overview.package.privacyStatus, "local_private");
    assert.equal(overview.collaboration.visibility, "private");
    assert.equal(overview.collaboration.authorizationStatus, "none");
    assert.equal(overview.collaboration.autoAuthorization, false);
    assert.match(overview.collaboration.cardStatusLabel, /尚未建立|仅为示例/);
  } finally {
    cleanup(dir);
  }
});

test("9. IPC-shaped payload has no secrets or body samples", () => {
  const dir = makeV01("payload");
  try {
    const overview = buildSubjectOverviewV1(dir, { hasApiKey: false });
    assertNoSecretsInPayload(overview);
    const dialogue = overview.capabilities.find((c) => c.id === "dialogue");
    assert.equal(dialogue.status, "unavailable");
  } finally {
    cleanup(dir);
  }
});

test("10. malicious displayName passes through model; textContent render is safe", () => {
  const dir = makeV01("xss");
  try {
    const malicious = '<img src=x onerror="alert(1)">';
    fs.writeFileSync(
      path.join(dir, "identity.json"),
      JSON.stringify({ displayName: malicious, digitalMeId: "demo" }),
      "utf8"
    );
    const overview = buildSubjectOverviewV1(dir);
    assert.equal(overview.identity.displayName, malicious);
    const el = { _v: "" };
    Object.defineProperty(el, "textContent", {
      set(v) {
        this._v = String(v);
      },
      get() {
        return this._v;
      },
    });
    el.textContent = overview.identity.displayName;
    assert.equal(el.textContent, malicious);
    assert.equal(el.textContent.includes("<img"), true);
    const escaped = el.textContent
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    assert.equal(escaped.includes("<img"), false);
  } finally {
    cleanup(dir);
  }
});

test("11. overview generation preserves fixture manifest hash", () => {
  const dir = makeV02("hash-stable");
  try {
    const before = dirByteFingerprint(dir);
    buildSubjectOverviewV1(dir);
    buildSubjectOverviewV1(dir);
    const after = dirByteFingerprint(dir);
    assert.deepEqual(before, after);
  } finally {
    cleanup(dir);
  }
});

test("12. capabilities include limitation and five-state statuses", () => {
  const dir = makeV01("caps");
  try {
    const overview = buildSubjectOverviewV1(dir, { hasApiKey: true, readyExtensionCount: 2 });
    assert.ok(overview.capabilities.length >= 3);
    for (const cap of overview.capabilities) {
      assert.ok(cap.label);
      assert.ok(cap.limitation);
      assert.ok(
        ["available", "limited", "experimental", "unavailable", "unknown"].includes(cap.status)
      );
    }
    const mcp = overview.capabilities.find((c) => c.id === "mcp_extensions");
    assert.equal(mcp.status, "limited");
  } finally {
    cleanup(dir);
  }
});

console.log("");
console.log(`P1-03 results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
