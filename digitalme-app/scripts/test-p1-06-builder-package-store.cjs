"use strict";

/**
 * P1-06 Builder → PackageStore write path tests (temp fixtures only; hermetic).
 * Does not read the real digital-me-package tree; real baseline is test:p1-baseline-real.
 * Run: npm run test:p1-06
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

const {
  PackageStore,
  storeRootFor,
  dirByteFingerprint,
  readManifest,
} = require("../src/package-store");
const { createMinimalFixture } = require("../src/package-store/fixture");
const builderPackageWrite = require("../src/builder/package-write");
const builder = require("../src/builder");

const ROOT = path.join(__dirname, "..");
const {
  createHermeticPackageFixture,
  cleanupHermeticPackageFixture,
  fingerprintPackage,
} = require("./hermetic-package-fixture.cjs");

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

async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, err && err.stack ? err.stack : err);
  }
}

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dm-p106-${label}-`));
}

function cleanup(dir) {
  try {
    fs.rmSync(storeRootFor(dir), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function makeV02(label) {
  const dir = tempDir(label);
  createMinimalFixture(dir, { withMemoryLine: true });
  fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "sources", "source-index.json"),
    JSON.stringify({ sources: [] }, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(dir, "decision-frameworks.json"),
    JSON.stringify({ frameworks: [] }, null, 2),
    "utf8"
  );
  const store = new PackageStore({ packageDir: dir, ownerId: "test:p106" });
  store.migrateToV02({ actor: "test:p106", toolVersion: "p1-06-test" });
  return dir;
}

function sampleAgg() {
  return {
    memories: [{ content: "P1-06 测试记忆：偏好先列要点再展开。", confidence: "high" }],
    decisionFrameworks: [
      {
        name: "P1-06测试框架",
        domain: "general",
        principles: ["先核对来源"],
        positiveSignals: [],
        negativeSignals: [],
        typicalQuestions: [],
      },
    ],
    styleObservations: ["用词偏书面，少用口号。"],
    personaNotes: ["做决定前会先问约束条件。"],
  };
}

function runNodeScript(relScript) {
  const script = path.join(ROOT, relScript);
  const r = spawnSync(process.execPath, [script], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 600000,
    windowsHide: true,
  });
  if (r.status !== 0) {
    throw new Error(
      `${relScript} failed (status=${r.status})\n${r.stdout || ""}\n${r.stderr || ""}`
    );
  }
}

async function runAll() {
  // 1. Preview does not change package bytes
  test("1. Builder preview does not change Package bytes", () => {
    const dir = makeV02("preview");
    try {
      const before = dirByteFingerprint(dir);
      const preview = builderPackageWrite.previewPersonaWrite(dir, {
        agg: sampleAgg(),
        title: "测试材料.txt",
        filePath: "C:\\tmp\\p106-sample.txt",
      });
      assert.ok(preview.changeSetId);
      assert.equal(typeof preview.baseRevision, "number");
      const after = dirByteFingerprint(dir);
      assert.deepEqual(after, before, "preview must not mutate package content bytes");
      assert.ok((preview.affectedPaths || []).length > 0);
      assert.ok((preview.dataKinds || []).includes("inference"));
    } finally {
      cleanup(dir);
    }
  });

  // 2. Unconfirmed commit rejected
  test("2. Unconfirmed commit cannot write", () => {
    const dir = makeV02("unconfirmed");
    try {
      const preview = builderPackageWrite.previewPersonaWrite(dir, {
        agg: sampleAgg(),
        title: "未确认",
      });
      const before = dirByteFingerprint(dir);
      assert.throws(
        () => builderPackageWrite.commitPersonaWrite(dir, { changeSetId: preview.changeSetId }),
        (e) => e && e.code === "confirmation_required"
      );
      assert.throws(
        () =>
          builderPackageWrite.commitPersonaWrite(dir, {
            changeSetId: preview.changeSetId,
            confirmed: false,
          }),
        (e) => e && e.code === "confirmation_required"
      );
      assert.deepEqual(dirByteFingerprint(dir), before);
    } finally {
      cleanup(dir);
    }
  });

  // 3. Confirmed commit only previewed paths
  test("3. Confirmed commit only applies previewed paths", () => {
    const dir = makeV02("confirm-paths");
    try {
      const preview = builderPackageWrite.previewPersonaWrite(dir, {
        agg: sampleAgg(),
        title: "路径检查",
        filePath: "/tmp/p106-path.txt",
      });
      const committed = builderPackageWrite.commitPersonaWrite(dir, {
        changeSetId: preview.changeSetId,
        confirmed: true,
      });
      assert.equal(committed.ok, true);
      const previewPaths = [...preview.affectedPaths].sort();
      const committedPaths = [...(committed.affectedPaths || [])].sort();
      assert.deepEqual(committedPaths, previewPaths);
      const mem = fs.readFileSync(path.join(dir, "memory", "long-term-memory.jsonl"), "utf8");
      assert.ok(mem.includes("P1-06 测试记忆"));
      const style = fs.readFileSync(path.join(dir, "style-guide.md"), "utf8");
      assert.ok(style.includes("用词偏书面"));
    } finally {
      cleanup(dir);
    }
  });

  // 4. New revision
  test("4. Write produces new revision", () => {
    const dir = makeV02("revision");
    try {
      const beforeRev = readManifest(dir).revision;
      const preview = builderPackageWrite.previewPersonaWrite(dir, {
        agg: sampleAgg(),
        title: "版本",
      });
      const committed = builderPackageWrite.commitPersonaWrite(dir, {
        changeSetId: preview.changeSetId,
        confirmed: true,
      });
      assert.ok(committed.revision > beforeRev);
      assert.equal(readManifest(dir).revision, committed.revision);
      assert.ok(committed.rollbackVersion != null);
    } finally {
      cleanup(dir);
    }
  });

  // 5. Metadata preserved
  test("5. sourceRefs / dataKind / actor / reason saved", () => {
    const dir = makeV02("meta");
    try {
      const preview = builderPackageWrite.previewPersonaWrite(dir, {
        agg: sampleAgg(),
        title: "元数据材料",
        filePath: "D:\\materials\\meta.txt",
        reason: "P1-06 元数据验收",
      });
      assert.equal(preview.actor, "owner:builder");
      assert.ok(preview.dataKinds.includes("inference"));
      assert.ok(preview.sourceRefs.some((r) => String(r).includes("meta.txt") || String(r).startsWith("src_")));
      assert.match(preview.reason, /P1-06 元数据验收|构建写入/);
      const csPath = path.join(storeRootFor(dir), "changesets", preview.changeSetId + ".json");
      const cs = JSON.parse(fs.readFileSync(csPath, "utf8"));
      assert.equal(cs.actor, "owner:builder");
      assert.deepEqual(cs.dataKinds, ["inference"]);
      assert.ok(Array.isArray(cs.sourceRefs) && cs.sourceRefs.length >= 1);
      const committed = builderPackageWrite.commitPersonaWrite(dir, {
        changeSetId: preview.changeSetId,
        confirmed: true,
      });
      assert.equal(committed.actor, "owner:builder");
      assert.ok(committed.sourceRefs.length >= 1);
      assert.ok(committed.dataKinds.includes("inference"));
    } finally {
      cleanup(dir);
    }
  });

  // 6. Expired change set rejected
  test("6. Expired changeSet rejected", () => {
    const dir = makeV02("expired");
    try {
      const preview = builderPackageWrite.previewPersonaWrite(dir, {
        agg: sampleAgg(),
        title: "过期",
      });
      const csPath = path.join(storeRootFor(dir), "changesets", preview.changeSetId + ".json");
      const cs = JSON.parse(fs.readFileSync(csPath, "utf8"));
      cs.expiresAt = new Date(Date.now() - 1000).toISOString();
      fs.writeFileSync(csPath, JSON.stringify(cs, null, 2), "utf8");
      const before = dirByteFingerprint(dir);
      assert.throws(
        () =>
          builderPackageWrite.commitPersonaWrite(dir, {
            changeSetId: preview.changeSetId,
            confirmed: true,
          }),
        (e) => e && e.code === "changeset_expired"
      );
      assert.deepEqual(dirByteFingerprint(dir), before);
    } finally {
      cleanup(dir);
    }
  });

  // 7. Revision / hash conflict rejected
  test("7. Revision/hash conflict rejected", () => {
    const dir = makeV02("conflict");
    try {
      const preview = builderPackageWrite.previewPersonaWrite(dir, {
        agg: sampleAgg(),
        title: "冲突",
      });
      // Mutate an affected file after preview → before-hash conflict.
      fs.appendFileSync(path.join(dir, "persona.md"), "\n<!-- conflict probe -->\n", "utf8");
      assert.throws(
        () =>
          builderPackageWrite.commitPersonaWrite(dir, {
            changeSetId: preview.changeSetId,
            confirmed: true,
          }),
        (e) =>
          e &&
          (e.code === "conflict_before_hash" ||
            e.code === "conflict_root_hash" ||
            e.code === "conflict_revision")
      );
    } finally {
      cleanup(dir);
    }
  });

  // 8. Commit failure leaves previous version
  test("8. PackageStore commit failure keeps prior version", () => {
    const dir = makeV02("fail-commit");
    try {
      const preview = builderPackageWrite.previewPersonaWrite(dir, {
        agg: sampleAgg(),
        title: "失败",
      });
      const beforeFp = dirByteFingerprint(dir);
      const beforeRev = readManifest(dir).revision;
      assert.throws(
        () =>
          builderPackageWrite.commitPersonaWrite(
            dir,
            { changeSetId: preview.changeSetId, confirmed: true },
            {
              // Fail before live swap so package bytes stay on the prior revision.
              beforeValidateStaging: () => {
                const e = new Error("injected_validate_failure");
                e.code = "injected_validate_failure";
                throw e;
              },
            }
          ),
        (e) =>
          e &&
          (e.code === "injected_validate_failure" || /injected_validate_failure/.test(String(e.message)))
      );
      assert.equal(readManifest(dir).revision, beforeRev);
      assert.deepEqual(dirByteFingerprint(dir), beforeFp);
      assert.ok(
        !fs.readFileSync(path.join(dir, "memory", "long-term-memory.jsonl"), "utf8").includes(
          "P1-06 测试记忆"
        )
      );
    } finally {
      cleanup(dir);
    }
  });

  // 9. Restart consistency
  test("9. After restart revision and content stay consistent", () => {
    const dir = makeV02("restart");
    try {
      const preview = builderPackageWrite.previewPersonaWrite(dir, {
        agg: sampleAgg(),
        title: "重启",
      });
      const committed = builderPackageWrite.commitPersonaWrite(dir, {
        changeSetId: preview.changeSetId,
        confirmed: true,
      });
      const fp = dirByteFingerprint(dir);
      const store2 = new PackageStore({ packageDir: dir, ownerId: "test:p106-reopen" });
      store2.recover();
      const inspect = store2.inspect();
      assert.equal(inspect.revision, committed.revision);
      assert.deepEqual(dirByteFingerprint(dir), fp);
      const mem = fs.readFileSync(path.join(dir, "memory", "long-term-memory.jsonl"), "utf8");
      assert.ok(mem.includes("P1-06 测试记忆"));
    } finally {
      cleanup(dir);
    }
  });

  // 10. Rollback
  test("10. Rollback creates new revision and restores content", () => {
    const dir = makeV02("rollback");
    try {
      const beforePersona = fs.readFileSync(path.join(dir, "persona.md"), "utf8");
      const beforeMem = fs.readFileSync(path.join(dir, "memory", "long-term-memory.jsonl"), "utf8");
      const beforeRev = readManifest(dir).revision;
      const preview = builderPackageWrite.previewPersonaWrite(dir, {
        agg: sampleAgg(),
        title: "回滚",
      });
      const committed = builderPackageWrite.commitPersonaWrite(dir, {
        changeSetId: preview.changeSetId,
        confirmed: true,
      });
      assert.ok(committed.revision > beforeRev);
      assert.ok(
        fs.readFileSync(path.join(dir, "memory", "long-term-memory.jsonl"), "utf8").includes(
          "P1-06 测试记忆"
        )
      );
      const store = new PackageStore({ packageDir: dir, ownerId: "test:p106-rollback" });
      const rolled = store.rollback(committed.rollbackVersion, { confirmed: true });
      assert.ok(rolled.revision > committed.revision);
      const mem = fs.readFileSync(path.join(dir, "memory", "long-term-memory.jsonl"), "utf8");
      assert.ok(!mem.includes("P1-06 测试记忆"));
      assert.equal(mem, beforeMem);
      assert.equal(fs.readFileSync(path.join(dir, "persona.md"), "utf8"), beforePersona);
    } finally {
      cleanup(dir);
    }
  });

  // 11. Builder no longer direct-writes Package
  test("11. Builder no longer directly writes Package", () => {
    assert.throws(
      () => builder.writeBack("/tmp/x", sampleAgg(), { id: "x" }),
      (e) => e && e.code === "builder_direct_write_blocked"
    );
    assert.throws(
      () => builderPackageWrite.writeBack(),
      (e) => e && e.code === "builder_direct_write_blocked"
    );

    const builderJs = fs.readFileSync(path.join(ROOT, "src", "builder.js"), "utf8");
    assert.ok(!/fs\.writeFileSync\(/.test(builderJs), "builder.js must not writeFileSync");
    assert.ok(!/fs\.appendFileSync\(/.test(builderJs), "builder.js must not appendFileSync");
    assert.ok(!/fs\.renameSync\(/.test(builderJs), "builder.js must not renameSync");
    assert.ok(!/fs\.unlinkSync\(/.test(builderJs), "builder.js must not unlinkSync");

    const mainJs = fs.readFileSync(path.join(ROOT, "src", "main.js"), "utf8");
    assert.ok(!/builder\.writeBack\(/.test(mainJs), "main must not call builder.writeBack");
    assert.ok(/previewPersonaWrite/.test(mainJs));
    assert.ok(/commitPersonaWrite/.test(mainJs));
    assert.ok(/builder:previewWrite/.test(mainJs));

    const preload = fs.readFileSync(path.join(ROOT, "src", "preload.js"), "utf8");
    assert.ok(/previewDistillWrite/.test(preload));

    // Renderer must not send raw agg on persona commit path (changeSetId required).
    const appJs = fs.readFileSync(path.join(ROOT, "src", "renderer", "app.js"), "utf8");
    assert.ok(/previewAndCommitPersonaWrite/.test(appJs));
    assert.ok(/changeSetId:\s*preview\.changeSetId/.test(appJs));
    assert.ok(/confirmed:\s*true/.test(appJs));
  });

  // 12. P1-01..P1-05 regression
  await testAsync("12. P1-01～P1-05 full regression", async () => {
    runNodeScript("scripts/test-p1-01-secret-store.cjs");
    runNodeScript("scripts/test-p1-01-secret-leak-scan.cjs");
    runNodeScript("scripts/test-p1-02-package-store.cjs");
    runNodeScript("scripts/test-p1-03-subject-overview.cjs");
    runNodeScript("scripts/test-p1-04-policy-decision-audit.cjs");
    runNodeScript("scripts/test-p1-05-tool-broker.cjs");
    runNodeScript("scripts/test-p1-05-stop-ipc.cjs");
  });

  // 13. Hermetic fixture integrity (real Package check is test:p1-baseline-real)
  test("13. hermetic package fixture fingerprint is stable (no real package)", () => {
    const { packageDir, expected, fingerprint } = createHermeticPackageFixture("p106");
    try {
      assert.deepEqual(fingerprint, expected);
      assert.deepEqual(fingerprintPackage(packageDir), expected);
      assert.ok(expected.fileCount >= 5);
      assert.ok(!packageDir.includes("digital-me-package"));
    } finally {
      cleanupHermeticPackageFixture(packageDir);
      assert.equal(fs.existsSync(packageDir), false);
    }
  });

  // Missing changeSetId
  test("14. commit without changeSetId rejected", () => {
    const dir = makeV02("no-id");
    try {
      assert.throws(
        () => builderPackageWrite.commitPersonaWrite(dir, { confirmed: true }),
        (e) => e && e.code === "changeset_required"
      );
    } finally {
      cleanup(dir);
    }
  });

  console.log(`\nP1-06 results: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

runAll().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
