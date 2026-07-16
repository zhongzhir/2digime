"use strict";

/**
 * P1-02 PackageStore + Feedback wiring tests (temp fixtures only).
 * Run: node scripts/test-p1-02-package-store.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
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
const { writeJsonAtomic } = require("../src/package-store/fs-util");
const feedback = require("../src/feedback");

const RACE_PAIR = path.join(__dirname, "p1-02-lock-race-pair.cjs");

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

function store(packageDir, hooks, actor) {
  return new PackageStore({
    packageDir,
    hooks: hooks || {},
    actor: actor || `test:${process.pid}`,
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
    // Simpler: bump revision in manifest to force conflict_revision.
    const m = readManifest(dir);
    m.revision = (m.revision || 0) + 99;
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(m, null, 2), "utf8");
    assertCode(() => s.commit(cs2.id, { confirmed: true }), "conflict_revision");
  } finally {
    cleanup(dir);
  }
});

// ---------- §10.8 concurrent writers (real child_process) ----------
test("8. concurrent writers: only one succeeds (same + different actors)", () => {
  function parallelRace(label, actorA, actorB) {
    const dir = makeV02(`race-${label}`);
    try {
      const prepA = store(dir, {}, actorA);
      const csA = prepA.createChangeSet({
        actor: actorA,
        reason: "race-a",
        sourceRefs: [],
        dataKinds: ["owner_assertion"],
        ops: [
          {
            type: "ensure_section_append",
            path: "style-guide.md",
            section: "## 用户反馈（风格纠正）",
            line: `- race-a-${label}-${Date.now()}`,
          },
        ],
      });
      const prepB = store(dir, {}, actorB);
      const csB = prepB.createChangeSet({
        actor: actorB,
        reason: "race-b",
        sourceRefs: [],
        dataKinds: ["owner_assertion"],
        ops: [
          {
            type: "ensure_section_append",
            path: "style-guide.md",
            section: "## 用户反馈（风格纠正）",
            line: `- race-b-${label}-${Date.now()}`,
          },
        ],
      });

      const pair = spawnSync(
        process.execPath,
        [RACE_PAIR, dir, csA.id, actorA, csB.id, actorB],
        { encoding: "utf8", timeout: 120_000 }
      );
      assert.equal(pair.status, 0, `pair runner failed: ${pair.stderr || pair.stdout}`);
      const line = String(pair.stdout || "")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .pop();
      const body = JSON.parse(line);
      assert.equal(body.ok, true);
      const parsed = (body.results || []).map((r) => r.parsed);
      const successes = parsed.filter((p) => p && p.ok === true);
      const failures = parsed.filter((p) => p && p.ok === false);
      assert.equal(
        successes.length,
        1,
        `${label}: exactly one success, got ${JSON.stringify(parsed)}`
      );
      assert.ok(failures.length >= 1, `${label}: at least one failure`);
      const failCodes = failures.map((f) => f.code);
      assert.ok(
        failCodes.some((c) =>
          [
            "package_locked",
            "conflict_revision",
            "conflict_root_hash",
            "conflict_before_hash",
          ].includes(c)
        ),
        `${label}: failure should be lock/conflict, got ${failCodes}`
      );
    } finally {
      cleanup(dir);
    }
  }

  parallelRace("diff-actors", "writer-a", "writer-b");
  parallelRace("same-actor", "same-actor", "same-actor");
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
    const beforeHash = computeContentDigest(dir).rootSha256;
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
        backupRootSha256: beforeHash,
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
        revisionBefore: 1,
        revisionAfter: 2,
        backupRootSha256: beforeHash,
        expectedRootSha256: "0".repeat(64),
      }),
      "utf8"
    );
    const r2 = s.recover();
    assert.equal(r2.ok, true);
    assert.equal(r2.action, "restored_backup_after_swap_interrupt");
    assert.equal(fs.existsSync(dir), true);
    assert.equal(fingerprintPackage(dir), before);

    // Ambiguous: live + backup both present with mismatched hashes → fail closed
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
        revisionBefore: 1,
        revisionAfter: 2,
        backupRootSha256: beforeHash,
        expectedRootSha256: "a".repeat(64),
      }),
      "utf8"
    );
    assertCode(() => s.recover(), "recover_ambiguous");
    assert.equal(fs.existsSync(journal), true, "journal must remain on ambiguous recover");
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

// ---------- Hardening extras ----------
test("15. unreadable subdirectory → digest throws readdir_failed", () => {
  const dir = makeV02("unreadable");
  try {
    const sub = path.join(dir, "memory", "hidden");
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, "a.txt"), "a", "utf8");
    const orig = fs.readdirSync;
    fs.readdirSync = function patched(p, opts) {
      if (String(p).replace(/\\/g, "/").includes("/memory/hidden")) {
        const e = new Error("EACCES");
        e.code = "EACCES";
        throw e;
      }
      return orig.call(fs, p, opts);
    };
    try {
      assertCode(() => computeContentDigest(dir), "readdir_failed");
      assertCode(() => listContentFiles(dir), "readdir_failed");
    } finally {
      fs.readdirSync = orig;
    }
  } finally {
    cleanup(dir);
  }
});

test("16. symlink in package → inspect unhealthy and commit rejects", () => {
  const dir = makeV02("symlink-pkg");
  try {
    const outside = tempDir("symlink-out");
    fs.writeFileSync(path.join(outside, "x.txt"), "x", "utf8");
    const linkPath = path.join(dir, "memory", "escape-link");
    let ok = false;
    try {
      fs.symlinkSync(outside, linkPath, "junction");
      ok = true;
    } catch {
      try {
        fs.symlinkSync(outside, linkPath, "dir");
        ok = true;
      } catch {
        ok = false;
      }
    }
    if (!ok) {
      console.log("  (skip: cannot create symlink/junction)");
      return;
    }
    const s = store(dir);
    const report = s.inspect();
    assert.equal(report.healthy, false);
    assert.ok(
      report.issues.some((i) =>
        ["symlink_rejected", "reparse_rejected"].includes(i.code)
      )
    );
    const cs = s.createChangeSet({
      actor: "test",
      reason: "commit with symlink present",
      sourceRefs: ["test"],
      dataKinds: ["owner_assertion"],
      ops: [
        {
          type: "ensure_section_append",
          path: "style-guide.md",
          section: "## 用户反馈（风格纠正）",
          line: "- should fail",
        },
      ],
    });
    let code = null;
    try {
      s.commit(cs.id, { confirmed: true });
    } catch (e) {
      code = e.code;
    }
    assert.ok(
      ["symlink_rejected", "reparse_rejected"].includes(code),
      `expected symlink/reparse reject, got ${code}`
    );
    cleanup(outside);
  } finally {
    cleanup(dir);
  }
});

test("17. corrupted live + no backup → recover_ambiguous keeps journal", () => {
  const dir = makeV02("corrupt-live");
  try {
    const s = store(dir);
    const storeRoot = storeRootFor(dir);
    const journal = path.join(storeRoot, "journal.json");
    const staging = path.join(storeRoot, "staging");
    const backup = path.join(storeRoot, "swap-backup");
    const goodHash = computeContentDigest(dir).rootSha256;

    // Corrupt live manifest so digest/revision cannot match journal expectations.
    fs.writeFileSync(path.join(dir, "manifest.json"), "{not-json", "utf8");
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(staging, "x.txt"), "staging", "utf8");
    fs.writeFileSync(
      journal,
      JSON.stringify({
        phase: "swapping",
        op: "commit",
        livePath: dir,
        stagingPath: staging,
        backupPath: backup,
        revisionBefore: 1,
        revisionAfter: 2,
        expectedRootSha256: goodHash,
        backupRootSha256: goodHash,
      }),
      "utf8"
    );

    assertCode(() => s.recover(), "recover_ambiguous");
    assert.equal(fs.existsSync(journal), true);
    assert.equal(fs.existsSync(staging), true);
  } finally {
    cleanup(dir);
  }
});

test("18. snapshot mid-copy failure leaves existing vN unchanged", () => {
  const dir = makeV02("snap-mid");
  try {
    const s1 = store(dir);
    const cs1 = s1.createChangeSet({
      actor: "test",
      reason: "first commit for snapshot",
      sourceRefs: ["test"],
      dataKinds: ["owner_assertion"],
      ops: [
        {
          type: "ensure_section_append",
          path: "style-guide.md",
          section: "## 用户反馈（风格纠正）",
          line: "- first",
        },
      ],
    });
    const r1 = s1.commit(cs1.id, { confirmed: true });
    const snapPath = path.join(storeRootFor(dir), "snapshots", r1.rollbackVersion);
    assert.equal(fs.existsSync(snapPath), true);
    const snapFp = dirByteFingerprint(snapPath);

    const s2 = store(dir, {
      afterSnapshotCopy() {
        throw Object.assign(new Error("mid_copy_fail"), { code: "mid_copy_fail" });
      },
    });
    const cs2 = s2.createChangeSet({
      actor: "test",
      reason: "second commit fails mid snapshot",
      sourceRefs: ["test"],
      dataKinds: ["owner_assertion"],
      ops: [
        {
          type: "ensure_section_append",
          path: "style-guide.md",
          section: "## 用户反馈（风格纠正）",
          line: "- second",
        },
      ],
    });
    assertCode(() => s2.commit(cs2.id, { confirmed: true }), "mid_copy_fail");
    assert.equal(fs.existsSync(snapPath), true);
    assert.equal(dirByteFingerprint(snapPath), snapFp, "existing vN must stay byte-identical");
  } finally {
    cleanup(dir);
  }
});

test("19. writeJsonAtomic rename failure leaves old target readable", () => {
  const dir = tempDir("atomic-json");
  try {
    const target = path.join(dir, "journal.json");
    writeJsonAtomic(target, { phase: "staging", keep: true });
    const before = fs.readFileSync(target, "utf8");
    assert.ok(before.includes("staging"));

    let threw = false;
    try {
      writeJsonAtomic(
        target,
        { phase: "swapping", keep: false },
        {
          beforeReplaceTarget() {
            throw Object.assign(new Error("rename_boom"), { code: "rename_boom" });
          },
        }
      );
    } catch (e) {
      threw = true;
      assert.equal(e.code, "rename_boom");
    }
    assert.equal(threw, true);
    assert.equal(fs.existsSync(target), true);
    const after = fs.readFileSync(target, "utf8");
    assert.equal(after, before);
    assert.ok(after.includes('"phase": "staging"') || after.includes('"phase":"staging"'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("20. createChangeSet forbids manifest.json path", () => {
  const dir = makeV02("forbid-manifest");
  try {
    const s = store(dir);
    assertCode(
      () =>
        s.createChangeSet({
          actor: "test",
          reason: "try write manifest",
          sourceRefs: ["test"],
          dataKinds: ["owner_assertion"],
          ops: [{ type: "write_text", path: "manifest.json", content: "{}" }],
        }),
      "path_rejected"
    );
    assertCode(() => normalizeRel("manifest.json", { allowManifest: false }), "path_rejected");
    assert.equal(normalizeRel("manifest.json"), "manifest.json");
  } finally {
    cleanup(dir);
  }
});

test("21. same actor second process blocked while lock held", () => {
  const dir = makeV02("same-actor-lock");
  try {
    const a = store(dir, {}, "shared-actor");
    const lockInfo = a.lock.acquire("shared-actor");
    try {
      const b = store(dir, {}, "shared-actor");
      assertCode(() => b.lock.acquire("shared-actor"), "package_locked");
    } finally {
      a.lock.release(lockInfo.operationToken);
    }
  } finally {
    cleanup(dir);
  }
});

console.log("");
console.log(`P1-02 results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
