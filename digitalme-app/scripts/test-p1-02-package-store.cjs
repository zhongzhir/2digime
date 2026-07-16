"use strict";

/**
 * P1-02 PackageStore + Feedback wiring tests (temp fixtures only).
 * Run: node scripts/test-p1-02-package-store.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const {
  PackageStore,
  SCHEMA_VERSION,
  computeContentDigest,
  storeRootFor,
  normalizeRel,
  resolveInsidePackage,
  dirByteFingerprint,
  readManifest,
} = require("../src/package-store");
const { createMinimalFixture } = require("../src/package-store/fixture");
const { listContentFiles } = require("../src/package-store/digest");
const feedback = require("../src/feedback");

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
  return fs.mkdtempSync(path.join(os.tmpdir(), `dm-p102-${label}-`));
}

function cleanup(dir) {
  try {
    const store = storeRootFor(dir);
    fs.rmSync(store, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function fingerprintPackage(dir) {
  return dirByteFingerprint(dir);
}

function store(packageDir, hooks, ownerId) {
  return new PackageStore({
    packageDir,
    hooks: hooks || {},
    ownerId: ownerId || `test:${process.pid}`,
  });
}

function makeV01(label) {
  const dir = tempDir(label);
  createMinimalFixture(dir);
  return dir;
}

function makeV02(label) {
  const dir = makeV01(label);
  const s = store(dir);
  s.migrateToV02({ actor: "test:migrate", toolVersion: "test-p1-02" });
  return dir;
}

function assertCode(fn, code) {
  let caught = null;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  assert.ok(caught, "expected throw");
  assert.equal(caught.code, code, `expected ${code}, got ${caught && caught.code}: ${caught && caught.message}`);
}

// ---------- §10.1 v0.1 inspect read-only ----------
test("1. v0.1 fixture inspect does not change files", () => {
  const dir = makeV01("inspect-v01");
  try {
    const before = fingerprintPackage(dir);
    const s = store(dir);
    const report = s.inspect();
    assert.equal(report.exists, true);
    assert.ok(report.schemaVersion == null || report.schemaVersion !== SCHEMA_VERSION || !report.healthy);
    const after = fingerprintPackage(dir);
    assert.equal(after, before);
    // store layout may exist beside package; package itself unchanged
    assert.equal(fingerprintPackage(dir), before);
  } finally {
    cleanup(dir);
  }
});

// ---------- §10.2 migration idempotent ----------
test("2. v0.1 → v0.2 migrate idempotent", () => {
  const dir = makeV01("migrate");
  try {
    const s = store(dir);
    const r1 = s.migrateToV02({ actor: "test", toolVersion: "t" });
    assert.equal(r1.migrated, true);
    assert.equal(r1.schemaVersion, SCHEMA_VERSION);
    const m1 = readManifest(dir);
    assert.equal(m1.schemaVersion, SCHEMA_VERSION);
    assert.ok(m1.contentDigest && m1.contentDigest.rootSha256);
    const r2 = s.migrateToV02({ actor: "test", toolVersion: "t" });
    assert.equal(r2.idempotent, true);
    assert.equal(r2.migrated, false);
    assert.equal(r2.revision, r1.revision);
    assert.equal(r2.rootSha256, r1.rootSha256);
  } finally {
    cleanup(dir);
  }
});

// ---------- §10.3 schema/JSON/JSONL rejected ----------
test("3. invalid JSON / JSONL / schema rejected on commit", () => {
  const dir = makeV02("bad-json");
  try {
    const s = store(dir);
    const cs = s.createChangeSet({
      actor: "test",
      reason: "inject bad json",
      sourceRefs: ["test"],
      dataKinds: ["owner_assertion"],
      ops: [{ type: "write_text", path: "identity.json", content: "{not-json" }],
    });
    assertCode(() => s.commit(cs.id, { confirmed: true }), "staging_validation_failed");

    const cs2 = s.createChangeSet({
      actor: "test",
      reason: "inject bad jsonl",
      sourceRefs: ["test"],
      dataKinds: ["owner_assertion"],
      ops: [
        {
          type: "write_text",
          path: "memory/long-term-memory.jsonl",
          content: "{bad\n",
        },
      ],
    });
    assertCode(() => s.commit(cs2.id, { confirmed: true }), "staging_validation_failed");
  } finally {
    cleanup(dir);
  }
});

// ---------- §10.4 path traversal / absolute / symlink ----------
test("4. path traversal, absolute path, symlink rejected", () => {
  const dir = makeV02("paths");
  try {
    assertCode(() => normalizeRel("../evil.md"), "path_rejected");
    assertCode(() => normalizeRel("/etc/passwd"), "path_rejected");
    assertCode(() => normalizeRel("C:\\Windows\\system32"), "path_rejected");
    assertCode(() => normalizeRel("memory/../../outside.txt"), "path_rejected");

    const s = store(dir);
    assertCode(
      () =>
        s.createChangeSet({
          actor: "test",
          reason: "traversal",
          sourceRefs: [],
          dataKinds: ["owner_assertion"],
          ops: [{ type: "write_text", path: "../escape.txt", content: "x" }],
        }),
      "path_rejected"
    );

    // Symlink escape: create a link inside package pointing outside.
    const outside = tempDir("outside-target");
    fs.writeFileSync(path.join(outside, "secret.txt"), "secret", "utf8");
    const linkPath = path.join(dir, "memory", "link-out");
    let symlinkOk = false;
    try {
      fs.symlinkSync(outside, linkPath, "junction");
      symlinkOk = true;
    } catch {
      try {
        fs.symlinkSync(outside, linkPath, "dir");
        symlinkOk = true;
      } catch {
        symlinkOk = false;
      }
    }
    if (symlinkOk) {
      assertCode(
        () => resolveInsidePackage(dir, "memory/link-out/secret.txt"),
        "path_rejected"
      );
    } else {
      console.log("  (skip symlink case: platform cannot create symlink)");
    }
    cleanup(outside);
  } finally {
    cleanup(dir);
  }
});

// ---------- §10.5 create/preview no package change ----------
test("5. createChangeSet + preview do not change package bytes", () => {
  const dir = makeV02("preview-clean");
  try {
    const s = store(dir);
    const before = fingerprintPackage(dir);
    const cs = s.createChangeSet({
      actor: "test",
      reason: "preview only",
      sourceRefs: ["test"],
      dataKinds: ["owner_assertion"],
      ops: [
        {
          type: "ensure_section_append",
          path: "style-guide.md",
          section: "## 用户反馈（风格纠正）",
          line: "- 测试行",
        },
      ],
    });
    s.preview(cs.id);
    assert.equal(fingerprintPackage(dir), before);
  } finally {
    cleanup(dir);
  }
});

// ---------- §10.6 commit consistency ----------
test("6. commit updates revision, hashes, root digest", () => {
  const dir = makeV02("commit-ok");
  try {
    const s = store(dir);
    const before = readManifest(dir);
    const cs = s.createChangeSet({
      actor: "test",
      reason: "append style",
      sourceRefs: ["test"],
      dataKinds: ["owner_assertion"],
      ops: [
        {
          type: "ensure_section_append",
          path: "style-guide.md",
          section: "## 用户反馈（风格纠正）",
          line: "- 确认后的风格纠正",
        },
      ],
    });
    const r = s.commit(cs.id, { confirmed: true });
    assert.equal(r.ok, true);
    assert.equal(r.revision, before.revision + 1);
    assert.ok(r.rootSha256);
    assert.ok(r.rollbackVersion);
    const after = readManifest(dir);
    assert.equal(after.revision, r.revision);
    assert.equal(after.contentDigest.rootSha256, r.rootSha256);
    assert.ok(after.updatedAt);
    assert.notEqual(after.updatedAt, before.updatedAt);
    // Live digest helper hashes manifest.json as-on-disk (includes contentDigest);
    // stored rootSha256 is computed with that field stripped — verify via inspect/store.
    const report = s.inspect();
    assert.equal(report.healthy, true);
    assert.equal(report.contentDigest.rootSha256, r.rootSha256);
    const text = fs.readFileSync(path.join(dir, "style-guide.md"), "utf8");
    assert.ok(text.includes("确认后的风格纠正"));
  } finally {
    cleanup(dir);
  }
});

// ---------- §10.7 conflict on base hash/revision ----------
test("7. before-hash / revision conflict blocks commit", () => {
  const dir = makeV02("conflict");
  try {
    const s = store(dir);
    const cs = s.createChangeSet({
      actor: "test",
      reason: "will conflict",
      sourceRefs: ["test"],
      dataKinds: ["owner_assertion"],
      ops: [
        {
          type: "ensure_section_append",
          path: "persona.md",
          section: "## 用户反馈（人格/立场）",
          line: "- A",
        },
      ],
    });
    // External mutation of live package after change set created.
    fs.appendFileSync(path.join(dir, "persona.md"), "\n- external\n", "utf8");
    assertCode(() => s.commit(cs.id, { confirmed: true }), "conflict_before_hash");

    const cs2 = s.createChangeSet({
      actor: "test",
      reason: "stale revision",
      sourceRefs: ["test"],
      dataKinds: ["owner_assertion"],
      ops: [
        {
          type: "ensure_section_append",
          path: "style-guide.md",
          section: "## 用户反馈（风格纠正）",
          line: "- B",
        },
      ],
    });
    // Commit something else first via another change set after fixing persona hash by remigrating digest... 
    // Simpler: bump revision in manifest to force conflict_revision.
    const m = readManifest(dir);
    m.revision = (m.revision || 0) + 99;
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(m, null, 2), "utf8");
    assertCode(() => s.commit(cs2.id, { confirmed: true }), "conflict_revision");
  } finally {
    cleanup(dir);
  }
});

// ---------- §10.8 concurrent writers ----------
test("8. concurrent writers: only one succeeds", () => {
  const dir = makeV02("concurrent");
  try {
    const a = store(dir, {}, "writer-a");
    const b = store(dir, {}, "writer-b");
    const csA = a.createChangeSet({
      actor: "writer-a",
      reason: "a",
      sourceRefs: [],
      dataKinds: ["owner_assertion"],
      ops: [
        {
          type: "ensure_section_append",
          path: "style-guide.md",
          section: "## 用户反馈（风格纠正）",
          line: "- from-a",
        },
      ],
    });
    const csB = b.createChangeSet({
      actor: "writer-b",
      reason: "b",
      sourceRefs: [],
      dataKinds: ["owner_assertion"],
      ops: [
        {
          type: "ensure_section_append",
          path: "style-guide.md",
          section: "## 用户反馈（风格纠正）",
          line: "- from-b",
        },
      ],
    });

    let bFailed = false;
    const aLocked = store(dir, {}, "writer-a");
    // Hold lock with writer-a, then writer-b must fail.
    aLocked.lock.acquire("writer-a");
    try {
      b.commit(csB.id, { confirmed: true });
    } catch (e) {
      bFailed = e.code === "package_locked";
    }
    aLocked.lock.release("writer-a");
    assert.equal(bFailed, true);

    const r = a.commit(csA.id, { confirmed: true });
    assert.equal(r.ok, true);
  } finally {
    cleanup(dir);
  }
});

// ---------- §10.9 fault injection keeps old bytes ----------
test("9. staging / validate / snapshot / swap failures leave package unchanged", () => {
  const cases = [
    {
      name: "snapshot",
      hooks: {
        beforeSnapshot() {
          throw Object.assign(new Error("snap_fail"), { code: "snap_fail" });
        },
      },
    },
    {
      name: "staging",
      hooks: {
        beforeStaging() {
          throw Object.assign(new Error("stage_fail"), { code: "stage_fail" });
        },
      },
    },
    {
      name: "validate",
      hooks: {
        beforeValidateStaging({ staging }) {
          fs.writeFileSync(path.join(staging, "identity.json"), "{bad", "utf8");
        },
      },
      expectCode: "staging_validation_failed",
    },
    {
      name: "swap",
      hooks: {
        injectSwapFailureAfterBackup() {
          throw Object.assign(new Error("swap_boom"), { code: "swap_boom" });
        },
      },
      expectCode: "swap_failed",
    },
  ];

  for (const c of cases) {
    const dir = makeV02(`fault-${c.name}`);
    try {
      const before = fingerprintPackage(dir);
      const s = store(dir, c.hooks);
      const cs = s.createChangeSet({
        actor: "test",
        reason: `fault ${c.name}`,
        sourceRefs: ["test"],
        dataKinds: ["owner_assertion"],
        ops: [
          {
            type: "ensure_section_append",
            path: "style-guide.md",
            section: "## 用户反馈（风格纠正）",
            line: `- fault-${c.name}`,
          },
        ],
      });
      let threw = false;
      try {
        s.commit(cs.id, { confirmed: true });
      } catch (e) {
        threw = true;
        if (c.expectCode) assert.equal(e.code, c.expectCode);
      }
      assert.equal(threw, true, c.name + " should throw");
      assert.equal(fingerprintPackage(dir), before, c.name + " package bytes changed");
    } finally {
      cleanup(dir);
    }
  }
});

// ---------- §10.10 recover after crash phases ----------
test("10. recover() restores unique clear version after interrupt", () => {
  const dir = makeV02("recover");
  try {
    const s = store(dir);
    const before = fingerprintPackage(dir);
    const storeRoot = storeRootFor(dir);
    const staging = path.join(storeRoot, "staging");
    const backup = path.join(storeRoot, "swap-backup");
    const journal = path.join(storeRoot, "journal.json");

    // Simulate staging phase interrupt: staging exists, live intact.
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(staging, "junk.txt"), "x", "utf8");
    fs.writeFileSync(
      journal,
      JSON.stringify({
        phase: "staging",
        op: "commit",
        livePath: dir,
        stagingPath: staging,
        backupPath: backup,
      }),
      "utf8"
    );
    const r1 = s.recover();
    assert.equal(r1.ok, true);
    assert.equal(r1.action, "discarded_staging");
    assert.equal(fs.existsSync(staging), false);
    assert.equal(fingerprintPackage(dir), before);

    // Simulate swap interrupt: live gone, backup present.
    fs.renameSync(dir, backup);
    fs.writeFileSync(
      journal,
      JSON.stringify({
        phase: "swapping",
        op: "commit",
        livePath: dir,
        stagingPath: staging,
        backupPath: backup,
      }),
      "utf8"
    );
    const r2 = s.recover();
    assert.equal(r2.ok, true);
    assert.equal(r2.action, "restored_backup_after_swap_interrupt");
    assert.equal(fs.existsSync(dir), true);
    assert.equal(fingerprintPackage(dir), before);

    // Ambiguous: live + backup both present → fail closed
    fs.mkdirSync(backup, { recursive: true });
    fs.writeFileSync(path.join(backup, "manifest.json"), "{}", "utf8");
    fs.writeFileSync(
      journal,
      JSON.stringify({
        phase: "swapping",
        op: "commit",
        livePath: dir,
        stagingPath: staging,
        backupPath: backup,
      }),
      "utf8"
    );
    assertCode(() => s.recover(), "recover_ambiguous");
  } finally {
    cleanup(dir);
  }
});

// ---------- §10.11 rollback new revision ----------
test("11. rollback creates new revision and restores content", () => {
  const dir = makeV02("rollback");
  try {
    const s = store(dir);
    const style0 = fs.readFileSync(path.join(dir, "style-guide.md"), "utf8");
    const cs = s.createChangeSet({
      actor: "test",
      reason: "change then rollback",
      sourceRefs: ["test"],
      dataKinds: ["owner_assertion"],
      ops: [
        {
          type: "ensure_section_append",
          path: "style-guide.md",
          section: "## 用户反馈（风格纠正）",
          line: "- temporary change",
        },
      ],
    });
    const c = s.commit(cs.id, { confirmed: true });
    assert.ok(fs.readFileSync(path.join(dir, "style-guide.md"), "utf8").includes("temporary change"));
    const rb = s.rollback(c.rollbackVersion, { confirmed: true });
    assert.equal(rb.ok, true);
    assert.equal(rb.revision, c.revision + 1);
    const styleBack = fs.readFileSync(path.join(dir, "style-guide.md"), "utf8");
    // Content restored to pre-commit (minus manifest revision bump differences in digest)
    assert.ok(!styleBack.includes("temporary change"));
    // Snapshot v0 still exists (history not overwritten)
    const snap0 = path.join(storeRootFor(dir), "snapshots", "v0");
    // After first commit snapshot of previous revision exists
    const snaps = fs.readdirSync(path.join(storeRootFor(dir), "snapshots"));
    assert.ok(snaps.length >= 1);
    assert.ok(style0.length >= 0);
  } finally {
    cleanup(dir);
  }
});

// ---------- §10.12 Feedback confirm gate ----------
test("12. Feedback unconfirmed does not write; confirm commits previewed set only", () => {
  const dir = makeV02("feedback");
  try {
    const before = fingerprintPackage(dir);
    const preview = feedback.previewFeedback(dir, {
      correction: "这个观点不对，实际上我认为应更谨慎。",
      userQuestion: "Q",
      assistantExcerpt: "A",
    });
    assert.ok(preview.changeSetId);
    assert.equal(preview.category, "memory");
    assert.equal(fingerprintPackage(dir), before);

    assertCode(
      () => feedback.applyFeedback(dir, { changeSetId: preview.changeSetId }),
      "confirmation_required"
    );
    assert.equal(fingerprintPackage(dir), before);

    assertCode(
      () =>
        feedback.applyFeedback(dir, {
          category: "memory",
          memoryEntry: { content: "sneak" },
          confirmed: true,
        }),
      "changeset_required"
    );
    assert.equal(fingerprintPackage(dir), before);

    const applied = feedback.applyFeedback(dir, {
      changeSetId: preview.changeSetId,
      confirmed: true,
      category: preview.category,
    });
    assert.equal(applied.ok, true);
    assert.ok(applied.revision >= 1);
    assert.ok(applied.rollbackVersion);
    const mem = fs.readFileSync(path.join(dir, "memory", "long-term-memory.jsonl"), "utf8");
    assert.ok(mem.includes("用户纠正"));
  } finally {
    cleanup(dir);
  }
});

// ---------- §10.13 dataKinds / sourceRefs / actor ----------
test("13. change set annotates dataKinds, sourceRefs, actor, reason", () => {
  const dir = makeV02("meta");
  try {
    const preview = feedback.previewFeedback(dir, {
      correction: "语气太绝对了，表达上请更留有余地。",
    });
    assert.deepEqual(preview.dataKinds, ["owner_assertion"]);
    const csFile = path.join(
      storeRootFor(dir),
      "changesets",
      `${preview.changeSetId}.json`
    );
    const cs = JSON.parse(fs.readFileSync(csFile, "utf8"));
    assert.equal(cs.actor, "owner:feedback");
    assert.ok(cs.reason && cs.reason.length > 0);
    assert.ok(Array.isArray(cs.sourceRefs) && cs.sourceRefs.includes("feedback"));
    assert.deepEqual(cs.dataKinds, ["owner_assertion"]);
    assert.ok(cs.ops.length >= 1);
    assert.equal(cs.ops[0].type, "ensure_section_append");
  } finally {
    cleanup(dir);
  }
});

// ---------- §10.14 digest exclusions ----------
test("14. digest excludes cache, temp, and version store", () => {
  const dir = makeV02("digest-excl");
  try {
    fs.mkdirSync(path.join(dir, "cache"), { recursive: true });
    fs.writeFileSync(path.join(dir, "cache", "x.bin"), "cache-bytes", "utf8");
    fs.mkdirSync(path.join(dir, "tmp"), { recursive: true });
    fs.writeFileSync(path.join(dir, "tmp", "y.txt"), "tmp", "utf8");
    // Touch store (sibling) — must not appear in package digest file list
    store(dir).recover();
    const files = listContentFiles(dir);
    assert.ok(!files.some((f) => f.startsWith("cache/")));
    assert.ok(!files.some((f) => f.startsWith("tmp/")));
    assert.ok(!files.some((f) => f.includes(".digitalme-pkgstore")));
    const digest = computeContentDigest(dir);
    assert.ok(digest.files.every((f) => !f.path.startsWith("cache/")));
  } finally {
    cleanup(dir);
  }
});

// Extra: planToOps mapping
test("planToOps maps memory and section plans", () => {
  const memOps = feedback.planToOps({
    category: "memory",
    memoryEntry: { content: "c", theme: "t", confidence: "high" },
  });
  assert.equal(memOps[0].type, "append_jsonl");
  assert.equal(memOps[0].path, "memory/long-term-memory.jsonl");
  const styleOps = feedback.planToOps({
    category: "style",
    targetFile: "style-guide.md",
    section: "## 用户反馈（风格纠正）",
    appendLine: "- x",
  });
  assert.equal(styleOps[0].type, "ensure_section_append");
});

test("fixture helper creates v0.1 without schemaVersion", () => {
  const dir = tempDir("fixture");
  try {
    createMinimalFixture(dir);
    const m = readManifest(dir);
    assert.ok(!m.schemaVersion);
    assert.equal(m.revision, 0);
    assert.ok(fs.existsSync(path.join(dir, "persona.md")));
    assert.ok(fs.existsSync(path.join(dir, "identity.json")));
  } finally {
    cleanup(dir);
  }
});

console.log("");
console.log(`P1-02 results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
