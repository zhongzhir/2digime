"use strict";

/**
 * P1-07 Life / identity → PackageStore hermetic tests (hardened after Codex R1).
 * Run: npm run test:p1-07
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
const lifePackageWrite = require("../src/life/package-write");
const life = require("../src/life");
const materials = require("../src/materials");
const builderPackageWrite = require("../src/builder/package-write");

const ROOT = path.join(__dirname, "..");

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
  return fs.mkdtempSync(path.join(os.tmpdir(), `dm-p107-${label}-`));
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
  const store = new PackageStore({ packageDir: dir, ownerId: "test:p107" });
  store.migrateToV02({ actor: "test:p107", toolVersion: "p1-07-test" });
  return dir;
}

function sampleIdentity(overrides = {}) {
  return {
    events: [
      {
        when: "2020",
        what: "任测试职务",
        org: "测试机构有限公司",
        roleLabels: ["测试职务"],
        facets: ["roles", "outcomes"],
        outcome: "完成试点成果",
        confidence: "high",
      },
    ],
    facts: ["补充短句事实一条"],
    inferences: [
      { claim: "可能关注测试议题", type: "activity", confidence: "low", basedOn: "材料提及" },
    ],
    outcomes: [{ title: "完成测试项目", when: "2021" }],
    domains: ["测试领域"],
    org_touchpoints: [{ org: "合作方研究院", kind: "partner" }],
    alter_candidates: [{ name: "张三", relationType: "同事", confidence: "low" }],
    mind_hooks: ["关于决策方式的线索"],
    capability_signals: [{ signal: "擅长结构化表达", polarity: "scope", confidence: "medium" }],
    ...overrides,
  };
}

function payload(extra = {}) {
  const {
    sourceMeta,
    injectSourceMeta,
    filePath,
    title,
    identity,
    factConfirmedFields,
    reason,
    ...rest
  } = extra;
  const inject =
    injectSourceMeta ||
    sourceMeta || {
      id: "src_p107",
      title: "P1-07 测试材料",
      location: "C:\\tmp\\p107.txt",
    };
  return {
    identity: identity || sampleIdentity(),
    factConfirmedFields: factConfirmedFields != null ? factConfirmedFields : [],
    filePath: filePath != null ? filePath : inject.location || "C:\\tmp\\p107.txt",
    title: title != null ? title : inject.title || "P1-07 测试材料",
    reason: reason != null ? reason : "P1-07 人生事实写入验收",
    injectSourceMeta: inject,
    ...rest,
  };
}

/** Simulate main IPC identity preview fields (no sourceMeta / inject). */
function ipcIdentityPreviewPayload(extra = {}) {
  return {
    identity: sampleIdentity(),
    factConfirmedFields: [],
    filePath: "C:\\tmp\\p107.txt",
    title: "P1-07 测试材料",
    reason: "P1-07 人生事实写入验收",
    ...extra,
  };
}

function readCs(dir, id) {
  return JSON.parse(fs.readFileSync(path.join(storeRootFor(dir), "changesets", id + ".json"), "utf8"));
}

function commit(dir, preview, hooks) {
  return lifePackageWrite.commitLifeIdentityWrite(
    dir,
    { changeSetId: preview.changeSetId, confirmed: true },
    hooks
  );
}

function assertPathKindsComplete(preview) {
  const paths = [...preview.affectedPaths].sort();
  const kindPaths = Object.keys(preview.pathDataKinds || {}).sort();
  assert.deepEqual(kindPaths, paths);
  for (const p of paths) {
    assert.ok(Array.isArray(preview.pathDataKinds[p]));
    assert.ok(preview.pathDataKinds[p].length > 0);
  }
  const union = new Set();
  for (const arr of Object.values(preview.pathDataKinds)) {
    for (const k of arr) union.add(k);
  }
  assert.deepEqual([...union].sort(), [...preview.dataKinds].sort());
}

function runNodeScript(rel) {
  const r = spawnSync(process.execPath, [path.join(ROOT, rel)], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 600000,
    windowsHide: true,
  });
  if (r.status !== 0) {
    throw new Error(`${rel} failed:\n${r.stdout || ""}\n${r.stderr || ""}`);
  }
}

async function runAll() {
  test("1. preview does not change package bytes or revision", () => {
    const d = makeV02("preview");
    try {
      const fp = dirByteFingerprint(d);
      const rev = readManifest(d).revision;
      lifePackageWrite.previewLifeIdentityWrite(d, payload());
      assert.deepEqual(dirByteFingerprint(d), fp);
      assert.equal(readManifest(d).revision, rev);
    } finally {
      cleanup(d);
    }
  });

  test("2. preview does not scaffold life files and missing paths work", () => {
    const d = makeV02("no-scaffold");
    try {
      const fp = dirByteFingerprint(d);
      assert.ok(!fs.existsSync(path.join(d, "life")));
      const built = lifePackageWrite.identityPayloadToOps(
        d,
        sampleIdentity(),
        { id: "src_missing", title: "缺失文件", createdAt: "2026-01-01T00:00:00.000Z" },
        { factConfirmedFields: [] }
      );
      assert.ok(built.ops.some((o) => o.path === "life/events.jsonl"));
      const p = lifePackageWrite.previewLifeIdentityWrite(d, payload());
      assert.ok(p.affectedPaths.includes("life/events.jsonl"));
      assert.deepEqual(dirByteFingerprint(d), fp);
      assert.ok(!fs.existsSync(path.join(d, "life")));
    } finally {
      cleanup(d);
    }
  });

  test("3. unconfirmed cannot commit", () => {
    const d = makeV02("unconfirmed");
    try {
      const p = lifePackageWrite.previewLifeIdentityWrite(d, payload());
      assert.throws(
        () => lifePackageWrite.commitLifeIdentityWrite(d, { changeSetId: p.changeSetId }),
        (e) => e && e.code === "confirmation_required"
      );
    } finally {
      cleanup(d);
    }
  });

  test("4. cancel confirmation does not write", () => {
    const d = makeV02("cancel");
    try {
      const fp = dirByteFingerprint(d);
      lifePackageWrite.previewLifeIdentityWrite(d, payload());
      assert.deepEqual(dirByteFingerprint(d), fp);
      const app = fs.readFileSync(path.join(ROOT, "src", "renderer", "app.js"), "utf8");
      const fn = app.slice(
        app.indexOf("async function previewAndCommitIdentityWrite"),
        app.indexOf("async function autoWriteDistillResult")
      );
      assert.ok(fn.indexOf("if (!ok)") < fn.lastIndexOf("window.digitalMe.writeDistill"));
    } finally {
      cleanup(d);
    }
  });

  test("5. commit only affects previewed paths", () => {
    const d = makeV02("paths");
    try {
      const p = lifePackageWrite.previewLifeIdentityWrite(d, payload());
      const r = commit(d, p);
      assert.deepEqual([...r.affectedPaths].sort(), [...p.affectedPaths].sort());
    } finally {
      cleanup(d);
    }
  });

  test("6. commit increments revision", () => {
    const d = makeV02("revision");
    try {
      const before = readManifest(d).revision;
      const r = commit(d, lifePackageWrite.previewLifeIdentityWrite(d, payload()));
      assert.ok(r.revision > before);
    } finally {
      cleanup(d);
    }
  });

  test("7. each affectedPath has pathDataKinds; no extras", () => {
    const d = makeV02("path-kinds");
    try {
      const p = lifePackageWrite.previewLifeIdentityWrite(
        d,
        payload({ factConfirmedFields: ["events", "facts", "outcomes"] })
      );
      assertPathKindsComplete(p);
    } finally {
      cleanup(d);
    }
  });

  test("8. event-derived outcomes and org_touchpoints classified", () => {
    const d = makeV02("derived");
    try {
      const p = lifePackageWrite.previewLifeIdentityWrite(
        d,
        payload({
          identity: sampleIdentity({
            outcomes: [],
            org_touchpoints: [],
          }),
          factConfirmedFields: ["events"],
        })
      );
      assert.ok(p.pathDataKinds["life/outcomes.json"].includes("fact"));
      assert.ok(p.pathDataKinds["life/org_touchpoints.json"].includes("current_state"));
      assert.ok(p.pathDataKinds["life/roles.json"].includes("fact"));
    } finally {
      cleanup(d);
    }
  });

  test("9. field confirmations are independent", () => {
    const d = makeV02("fields");
    try {
      const onlyEvents = lifePackageWrite.previewLifeIdentityWrite(
        d,
        payload({ factConfirmedFields: ["events"] })
      );
      assert.ok(onlyEvents.pathDataKinds["life/events.jsonl"].includes("fact"));
      assert.ok(onlyEvents.pathDataKinds["identity-facts.md"].includes("inference"));
      assert.ok(onlyEvents.dataKinds.includes("owner_assertion"));

      const onlyFacts = lifePackageWrite.previewLifeIdentityWrite(
        d,
        payload({
          factConfirmedFields: ["facts"],
          sourceMeta: { id: "src_facts", title: "仅事实" },
        })
      );
      assert.ok(onlyFacts.pathDataKinds["identity-facts.md"].includes("fact"));
      assert.ok(onlyFacts.pathDataKinds["life/events.jsonl"].includes("inference"));
      assert.ok(!onlyFacts.affectedPaths.includes("identity.json"));

      const onlyOut = lifePackageWrite.previewLifeIdentityWrite(
        d,
        payload({
          factConfirmedFields: ["outcomes"],
          sourceMeta: { id: "src_out", title: "仅成就" },
        })
      );
      assert.ok(onlyOut.pathDataKinds["life/outcomes.json"].includes("fact"));
      assert.ok(onlyOut.pathDataKinds["life/events.jsonl"].includes("inference"));
    } finally {
      cleanup(d);
    }
  });

  test("10. mixed kinds and inferences never upgrade", () => {
    const d = makeV02("mixed");
    try {
      const p = lifePackageWrite.previewLifeIdentityWrite(
        d,
        payload({ factConfirmedFields: ["events", "facts", "outcomes"] })
      );
      for (const k of ["fact", "inference", "current_state", "owner_assertion"]) {
        assert.ok(p.dataKinds.includes(k), "missing " + k);
      }
      assert.equal(p.fieldKinds.inferences, "inference");
      assert.ok(p.pathDataKinds["life/inferences.jsonl"].includes("inference"));
      assert.ok(!p.pathDataKinds["life/inferences.jsonl"].includes("fact"));
    } finally {
      cleanup(d);
    }
  });

  test("11. forged renderer dataKinds ignored", () => {
    const d = makeV02("forged");
    try {
      const p = lifePackageWrite.previewLifeIdentityWrite(
        d,
        payload({
          dataKinds: ["owner_assertion"],
          pathDataKinds: { "life/events.jsonl": ["owner_assertion"] },
        })
      );
      assert.ok(p.pathDataKinds["life/events.jsonl"].includes("inference"));
      assert.ok(!p.dataKinds.includes("owner_assertion"));
    } finally {
      cleanup(d);
    }
  });

  test("12. corrupt JSON fails preview and keeps bytes", () => {
    const d = makeV02("bad-json");
    try {
      fs.mkdirSync(path.join(d, "life"), { recursive: true });
      fs.writeFileSync(path.join(d, "life", "roles.json"), "{not-json", "utf8");
      const fp = dirByteFingerprint(d);
      const rev = readManifest(d).revision;
      assert.throws(
        () => lifePackageWrite.previewLifeIdentityWrite(d, payload()),
        (e) => e && e.code === "package_content_invalid"
      );
      assert.deepEqual(dirByteFingerprint(d), fp);
      assert.equal(readManifest(d).revision, rev);
    } finally {
      cleanup(d);
    }
  });

  test("13. corrupt JSONL fails preview and keeps bytes", () => {
    const d = makeV02("bad-jsonl");
    try {
      fs.mkdirSync(path.join(d, "life"), { recursive: true });
      fs.writeFileSync(path.join(d, "life", "events.jsonl"), "{bad\n", "utf8");
      const fp = dirByteFingerprint(d);
      assert.throws(
        () => lifePackageWrite.previewLifeIdentityWrite(d, payload()),
        (e) => e && e.code === "package_content_invalid"
      );
      assert.deepEqual(dirByteFingerprint(d), fp);
    } finally {
      cleanup(d);
    }
  });

  test("13b. facet items as string rejected; bytes unchanged", () => {
    const d = makeV02("bad-facet-items");
    try {
      fs.mkdirSync(path.join(d, "life"), { recursive: true });
      fs.writeFileSync(
        path.join(d, "life", "roles.json"),
        JSON.stringify({ version: 1, facet: "roles", items: "not-array" }, null, 2),
        "utf8"
      );
      const fp = dirByteFingerprint(d);
      const rev = readManifest(d).revision;
      assert.throws(
        () => lifePackageWrite.previewLifeIdentityWrite(d, payload()),
        (e) => e && e.code === "package_content_invalid"
      );
      assert.deepEqual(dirByteFingerprint(d), fp);
      assert.equal(readManifest(d).revision, rev);
    } finally {
      cleanup(d);
    }
  });

  test("13c. slice items as object rejected; bytes unchanged", () => {
    const d = makeV02("bad-slice-items");
    try {
      fs.mkdirSync(path.join(d, "life"), { recursive: true });
      fs.writeFileSync(
        path.join(d, "life", "domains.json"),
        JSON.stringify({ version: 1, slice: "domains", items: { a: 1 } }, null, 2),
        "utf8"
      );
      const fp = dirByteFingerprint(d);
      assert.throws(
        () => lifePackageWrite.previewLifeIdentityWrite(d, payload()),
        (e) => e && e.code === "package_content_invalid"
      );
      assert.deepEqual(dirByteFingerprint(d), fp);
    } finally {
      cleanup(d);
    }
  });

  test("13d. source-index sources non-array rejected; bytes unchanged", () => {
    const d = makeV02("bad-source-index");
    try {
      fs.writeFileSync(
        path.join(d, "sources", "source-index.json"),
        JSON.stringify({ sources: { id: "x" } }, null, 2),
        "utf8"
      );
      const fp = dirByteFingerprint(d);
      assert.throws(
        () => lifePackageWrite.previewLifeIdentityWrite(d, payload()),
        (e) => e && e.code === "package_content_invalid"
      );
      assert.deepEqual(dirByteFingerprint(d), fp);
    } finally {
      cleanup(d);
    }
  });

  test("13e. identityClaims non-array rejected; bytes unchanged", () => {
    const d = makeV02("bad-claims");
    try {
      fs.writeFileSync(
        path.join(d, "identity.json"),
        JSON.stringify({ displayName: "x", identityClaims: "bad" }, null, 2),
        "utf8"
      );
      const fp = dirByteFingerprint(d);
      assert.throws(
        () =>
          lifePackageWrite.previewLifeIdentityWrite(
            d,
            payload({ factConfirmedFields: ["events"] })
          ),
        (e) => e && e.code === "package_content_invalid"
      );
      assert.deepEqual(dirByteFingerprint(d), fp);
    } finally {
      cleanup(d);
    }
  });

  test("13f. JSONL string/array/null rows rejected", () => {
    const d = makeV02("bad-jsonl-types");
    try {
      fs.mkdirSync(path.join(d, "life"), { recursive: true });
      for (const row of ['"just-string"', "[1,2]", "null"]) {
        fs.writeFileSync(path.join(d, "life", "events.jsonl"), row + "\n", "utf8");
        const fp = dirByteFingerprint(d);
        assert.throws(
          () => lifePackageWrite.previewLifeIdentityWrite(d, payload()),
          (e) => e && e.code === "package_content_invalid",
          "row=" + row
        );
        assert.deepEqual(dirByteFingerprint(d), fp);
      }
    } finally {
      cleanup(d);
    }
  });

  test("14. all-duplicate content cannot create source-only revision", () => {
    const d = makeV02("dup");
    try {
      const first = lifePackageWrite.previewLifeIdentityWrite(
        d,
        payload({ factConfirmedFields: ["events", "facts", "outcomes"] })
      );
      commit(d, first);
      const rev = readManifest(d).revision;
      const fp = dirByteFingerprint(d);
      // Same source id + identical content → no substantive ops, no source-only revision.
      assert.throws(
        () =>
          lifePackageWrite.previewLifeIdentityWrite(
            d,
            payload({ factConfirmedFields: ["events", "facts", "outcomes"] })
          ),
        (e) => e && e.code === "empty_write"
      );
      assert.equal(readManifest(d).revision, rev);
      assert.deepEqual(dirByteFingerprint(d), fp);
    } finally {
      cleanup(d);
    }
  });

  test("14b. duplicate content with new sourceRef is substantive", () => {
    const d = makeV02("dup-src");
    try {
      commit(
        d,
        lifePackageWrite.previewLifeIdentityWrite(
          d,
          payload({ factConfirmedFields: ["events"] })
        )
      );
      const rev = readManifest(d).revision;
      const p2 = lifePackageWrite.previewLifeIdentityWrite(
        d,
        payload({
          factConfirmedFields: ["events"],
          sourceMeta: { id: "src_dup_ref", title: "补充来源", location: "C:\\tmp\\dup-ref.txt" },
        })
      );
      assert.ok(p2.affectedPaths.includes("life/roles.json"));
      assert.ok(p2.affectedPaths.includes("sources/source-index.json"));
      const r = commit(d, p2);
      assert.ok(r.revision > rev);
      const roles = JSON.parse(fs.readFileSync(path.join(d, "life", "roles.json"), "utf8"));
      const refs = (roles.items[0] && roles.items[0].sourceRefs) || [];
      assert.ok(refs.includes("src_p107"));
      assert.ok(refs.includes("src_dup_ref"));
    } finally {
      cleanup(d);
    }
  });

  test("15. missing lifeIdentityMeta rejects commit", () => {
    const d = makeV02("meta-missing");
    try {
      const p = lifePackageWrite.previewLifeIdentityWrite(d, payload());
      const file = path.join(storeRootFor(d), "changesets", p.changeSetId + ".json");
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      delete data.lifeIdentityMeta;
      fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
      assert.throws(() => commit(d, p), (e) => e && e.code === "changeset_meta_missing");
    } finally {
      cleanup(d);
    }
  });

  test("16. missing materialKind rejects commit", () => {
    const d = makeV02("mk-missing");
    try {
      const p = lifePackageWrite.previewLifeIdentityWrite(d, payload());
      const file = path.join(storeRootFor(d), "changesets", p.changeSetId + ".json");
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      delete data.lifeIdentityMeta.materialKind;
      fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
      assert.throws(() => commit(d, p), (e) => e && e.code === "changeset_material_mismatch");
    } finally {
      cleanup(d);
    }
  });

  test("17. missing actor rejects commit", () => {
    const d = makeV02("actor-missing");
    try {
      const p = lifePackageWrite.previewLifeIdentityWrite(d, payload());
      const file = path.join(storeRootFor(d), "changesets", p.changeSetId + ".json");
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      delete data.actor;
      fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
      assert.throws(() => commit(d, p), (e) => e && e.code === "changeset_actor_mismatch");
    } finally {
      cleanup(d);
    }
  });

  test("18. expiresAt missing/invalid/expired rejected", () => {
    const d = makeV02("expiry");
    try {
      const p1 = lifePackageWrite.previewLifeIdentityWrite(d, payload());
      const f1 = path.join(storeRootFor(d), "changesets", p1.changeSetId + ".json");
      const d1 = JSON.parse(fs.readFileSync(f1, "utf8"));
      delete d1.expiresAt;
      fs.writeFileSync(f1, JSON.stringify(d1, null, 2), "utf8");
      assert.throws(() => commit(d, p1), (e) => e && e.code === "changeset_expiry_missing");

      const p2 = lifePackageWrite.previewLifeIdentityWrite(
        d,
        payload({ sourceMeta: { id: "src_e2", title: "e2" } })
      );
      const f2 = path.join(storeRootFor(d), "changesets", p2.changeSetId + ".json");
      const d2 = JSON.parse(fs.readFileSync(f2, "utf8"));
      d2.expiresAt = "not-a-date";
      fs.writeFileSync(f2, JSON.stringify(d2, null, 2), "utf8");
      assert.throws(() => commit(d, p2), (e) => e && e.code === "changeset_expiry_invalid");

      const p3 = lifePackageWrite.previewLifeIdentityWrite(
        d,
        payload({ sourceMeta: { id: "src_e3", title: "e3" } })
      );
      const f3 = path.join(storeRootFor(d), "changesets", p3.changeSetId + ".json");
      const d3 = JSON.parse(fs.readFileSync(f3, "utf8"));
      d3.expiresAt = new Date(Date.now() - 1000).toISOString();
      fs.writeFileSync(f3, JSON.stringify(d3, null, 2), "utf8");
      assert.throws(() => commit(d, p3), (e) => e && e.code === "changeset_expired");
    } finally {
      cleanup(d);
    }
  });

  test("19. pathDataKinds / dataKinds mismatch rejects commit", () => {
    const d = makeV02("kind-mismatch");
    try {
      const p = lifePackageWrite.previewLifeIdentityWrite(d, payload());
      const file = path.join(storeRootFor(d), "changesets", p.changeSetId + ".json");
      const data = JSON.parse(fs.readFileSync(file, "utf8"));
      data.lifeIdentityMeta.pathDataKinds = { "life/events.jsonl": ["inference"] };
      fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
      assert.throws(() => commit(d, p), (e) => e && e.code === "path_kind_mismatch");

      const p2 = lifePackageWrite.previewLifeIdentityWrite(
        d,
        payload({ sourceMeta: { id: "src_km2", title: "km2" } })
      );
      const f2 = path.join(storeRootFor(d), "changesets", p2.changeSetId + ".json");
      const d2 = JSON.parse(fs.readFileSync(f2, "utf8"));
      d2.dataKinds = ["fact"];
      fs.writeFileSync(f2, JSON.stringify(d2, null, 2), "utf8");
      assert.throws(() => commit(d, p2), (e) => e && e.code === "data_kinds_mismatch");
    } finally {
      cleanup(d);
    }
  });

  test("20. injectSwapFailureAfterBackup restores prior version", () => {
    const d = makeV02("swap-fail");
    try {
      const p = lifePackageWrite.previewLifeIdentityWrite(d, payload());
      const fp = dirByteFingerprint(d);
      const rev = readManifest(d).revision;
      assert.throws(
        () =>
          commit(d, p, {
            injectSwapFailureAfterBackup: () => {
              const e = new Error("injected_swap");
              e.code = "injected_swap";
              throw e;
            },
          }),
        (e) => e && (e.code === "swap_failed" || /swap/i.test(String(e.message || e.code)))
      );
      // Commit path restores from backup; package bytes/revision unchanged (P1-02 pattern).
      assert.equal(readManifest(d).revision, rev);
      assert.deepEqual(dirByteFingerprint(d), fp);
    } finally {
      cleanup(d);
    }
  });

  test("21. staging failure keeps old version", () => {
    const d = makeV02("stage-fail");
    try {
      const p = lifePackageWrite.previewLifeIdentityWrite(d, payload());
      const fp = dirByteFingerprint(d);
      const rev = readManifest(d).revision;
      assert.throws(
        () =>
          commit(d, p, {
            beforeValidateStaging: () => {
              const e = new Error("injected");
              e.code = "inject_fail";
              throw e;
            },
          }),
        (e) => e && e.code === "inject_fail"
      );
      assert.equal(readManifest(d).revision, rev);
      assert.deepEqual(dirByteFingerprint(d), fp);
    } finally {
      cleanup(d);
    }
  });

  test("22. commit failure does not archive", () => {
    const d = makeV02("no-archive");
    let archiveCalls = 0;
    let commitCalls = 0;
    try {
      const p = lifePackageWrite.previewLifeIdentityWrite(d, payload());
      assert.throws(
        () =>
          lifePackageWrite.runIdentityCommitAndArchive({
            packageDir: d,
            payload: { changeSetId: p.changeSetId, confirmed: true },
            userData: tempDir("ua"),
            commitFn: (dir, body, hooks) => {
              commitCalls += 1;
              return lifePackageWrite.commitLifeIdentityWrite(dir, body, {
                beforeValidateStaging: () => {
                  const e = new Error("fail");
                  e.code = "inject_fail";
                  throw e;
                },
              });
            },
            archiveFn: () => {
              archiveCalls += 1;
            },
          }),
        (e) => e && e.code === "inject_fail"
      );
      assert.equal(commitCalls, 1);
      assert.equal(archiveCalls, 0);
    } finally {
      cleanup(d);
    }
  });

  test("23. archive stores real claims/facts; archive fail does not re-commit", () => {
    const d = makeV02("archive-real");
    const userData = tempDir("archive-user");
    let archiveCalls = 0;
    let commitCalls = 0;
    let seen = null;
    try {
      const p = lifePackageWrite.previewLifeIdentityWrite(
        d,
        payload({ factConfirmedFields: ["events", "facts"] })
      );
      const r = lifePackageWrite.runIdentityCommitAndArchive({
        packageDir: d,
        payload: { changeSetId: p.changeSetId, confirmed: true },
        userData,
        commitFn: (dir, body, hooks) => {
          commitCalls += 1;
          return lifePackageWrite.commitLifeIdentityWrite(dir, body, hooks);
        },
        archiveFn: (ud, record) => {
          archiveCalls += 1;
          seen = record;
          return materials.archiveIdentityRun(ud, record);
        },
      });
      assert.equal(commitCalls, 1);
      assert.equal(archiveCalls, 1);
      assert.ok(seen.facts.includes("补充短句事实一条"));
      assert.ok(Array.isArray(seen.claims) && seen.claims.length >= 1);
      assert.equal(r.archiveRecord, undefined);

      const p2 = lifePackageWrite.previewLifeIdentityWrite(
        d,
        payload({
          identity: sampleIdentity({
            events: [{ when: "2022", what: "另一职务", org: "另一机构有限公司", facets: ["roles"] }],
            facts: ["另一短句"],
            inferences: [],
            outcomes: [],
            domains: [],
            org_touchpoints: [],
            alter_candidates: [],
            mind_hooks: [],
            capability_signals: [],
          }),
          factConfirmedFields: ["events", "facts"],
          sourceMeta: { id: "src_a2", title: "归档失败材料" },
        })
      );
      commitCalls = 0;
      archiveCalls = 0;
      const r2 = lifePackageWrite.runIdentityCommitAndArchive({
        packageDir: d,
        payload: { changeSetId: p2.changeSetId, confirmed: true },
        userData,
        commitFn: (dir, body, hooks) => {
          commitCalls += 1;
          return lifePackageWrite.commitLifeIdentityWrite(dir, body, hooks);
        },
        archiveFn: () => {
          archiveCalls += 1;
          throw new Error("archive boom");
        },
      });
      assert.equal(commitCalls, 1);
      assert.equal(archiveCalls, 1);
      assert.ok(r2.ok);
      assert.ok(r2.archiveWarning);
      assert.equal(r2.archiveRecord, undefined);
    } finally {
      cleanup(d);
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });

  test("24. writeLifeBack / materials identity blocked", () => {
    assert.throws(() => life.writeLifeBack(), (e) => e && e.code === "life_direct_write_blocked");
    assert.throws(
      () => materials.writeIdentityBack(),
      (e) => e && e.code === "materials_identity_direct_write_blocked"
    );
  });

  test("25. commit rejects raw identity payload", () => {
    const d = makeV02("raw");
    try {
      const p = lifePackageWrite.previewLifeIdentityWrite(d, payload());
      assert.throws(
        () =>
          lifePackageWrite.commitLifeIdentityWrite(d, {
            changeSetId: p.changeSetId,
            confirmed: true,
            identity: sampleIdentity(),
          }),
        (e) => e && e.code === "identity_commit_payload_rejected"
      );
    } finally {
      cleanup(d);
    }
  });

  test("26. renderer smart path uses empty factConfirmedFields", () => {
    const app = fs.readFileSync(path.join(ROOT, "src", "renderer", "app.js"), "utf8");
    assert.match(app, /factConfirmedFields:\s*\[\]/);
    assert.match(app, /factConfirmedFields\.push\("events"\)/);
    const auto = app.slice(
      app.indexOf("async function autoWriteDistillResult"),
      app.indexOf("async function runMaterialPipeline")
    );
    assert.ok(!/writeDistill\(\{[\s\S]{0,180}identity\s*:/.test(auto));
  });

  test("27. reopen / rollback / persona regression", () => {
    const d = makeV02("reopen");
    try {
      const r = commit(d, lifePackageWrite.previewLifeIdentityWrite(d, payload()));
      const store = new PackageStore({ packageDir: d, ownerId: "reopen" });
      store.recover();
      assert.equal(store.inspect().revision, r.revision);
      const beforePersona = fs.readFileSync(path.join(d, "persona.md"), "utf8");
      const rolled = store.rollback(r.rollbackVersion, { confirmed: true });
      assert.ok(rolled.revision > r.revision);
      assert.equal(fs.readFileSync(path.join(d, "persona.md"), "utf8"), beforePersona);
    } finally {
      cleanup(d);
    }
    const d2 = makeV02("persona");
    try {
      const p = builderPackageWrite.previewPersonaWrite(d2, {
        agg: {
          memories: [{ content: "P1-07 persona regression", confidence: "high" }],
          decisionFrameworks: [],
          styleObservations: [],
          personaNotes: [],
        },
        title: "回归材料",
      });
      const r = builderPackageWrite.commitPersonaWrite(d2, {
        changeSetId: p.changeSetId,
        confirmed: true,
      });
      assert.ok(r.ok);
    } finally {
      cleanup(d2);
    }
  });

  test("28. provenance metadata correct", () => {
    const d = makeV02("prov");
    try {
      const p = lifePackageWrite.previewLifeIdentityWrite(d, payload());
      assert.equal(p.actor, "owner:life");
      assert.match(p.reason, /P1-07/);
      assert.equal(p.sourceMeta.id, "src_p107");
      const stored = readCs(d, p.changeSetId);
      assert.equal(stored.lifeIdentityMeta.schemaVersion, 1);
      assert.deepEqual(stored.lifeIdentityMeta.factConfirmedFields, []);
    } finally {
      cleanup(d);
    }
  });

  test("30. forged body.sourceMeta.id ignored; IPC does not pass sourceMeta", () => {
    const mainSrc = fs.readFileSync(path.join(ROOT, "src", "main.js"), "utf8");
    const idPreview = mainSrc.slice(
      mainSrc.indexOf('if (body.materialKind === "identity")'),
      mainSrc.indexOf("return builderPackageWrite.previewPersonaWrite")
    );
    assert.ok(!/sourceMeta\s*:\s*body\.sourceMeta/.test(idPreview));
    assert.ok(!/injectSourceMeta/.test(idPreview));

    const d = makeV02("forged-src");
    try {
      const p = lifePackageWrite.previewLifeIdentityWrite(
        d,
        ipcIdentityPreviewPayload({
          sourceMeta: { id: "forged_evil_id", title: "伪造来源" },
        })
      );
      assert.notEqual(p.sourceMeta.id, "forged_evil_id");
      assert.match(p.sourceMeta.id, /^src_life_[0-9a-f]{32}$/i);
      const stored = readCs(d, p.changeSetId);
      assert.equal(stored.lifeIdentityMeta.sourceMeta.id, p.sourceMeta.id);
      assert.ok(!JSON.stringify(stored).includes("forged_evil_id"));
      const index = JSON.parse(
        stored.ops.find((o) => o.path === "sources/source-index.json").content
      );
      assert.ok(!index.sources.some((s) => s && s.id === "forged_evil_id"));
      assert.ok(index.sources.some((s) => s && s.id === p.sourceMeta.id));
    } finally {
      cleanup(d);
    }
  });

  test("31. generated source id consistent across preview / change set", () => {
    const d = makeV02("src-gen");
    try {
      const p = lifePackageWrite.previewLifeIdentityWrite(d, ipcIdentityPreviewPayload());
      assert.match(p.sourceMeta.id, /^src_life_[0-9a-f]{32}$/i);
      assert.ok(p.sourceRefs.includes(p.sourceMeta.id));
      const stored = readCs(d, p.changeSetId);
      assert.equal(stored.lifeIdentityMeta.sourceMeta.id, p.sourceMeta.id);
      assert.ok((stored.sourceRefs || []).includes(p.sourceMeta.id));
    } finally {
      cleanup(d);
    }
  });

  test("32. archive error path not leaked to log or public result", () => {
    const d = makeV02("archive-redact");
    const userData = tempDir("archive-redact-ud");
    const secret = "C:\\Users\\secret\\leak\\private-file.txt";
    const warns = [];
    const origWarn = console.warn;
    console.warn = (...args) => {
      warns.push(args.map(String).join(" "));
    };
    try {
      const p = lifePackageWrite.previewLifeIdentityWrite(
        d,
        payload({ factConfirmedFields: ["events", "facts"] })
      );
      const r = lifePackageWrite.runIdentityCommitAndArchive({
        packageDir: d,
        payload: { changeSetId: p.changeSetId, confirmed: true },
        userData,
        archiveFn: () => {
          throw new Error("ENOENT: no such file or directory, open '" + secret + "'");
        },
      });
      assert.ok(r.archiveWarning);
      assert.ok(!r.archiveWarning.includes(secret));
      assert.ok(!JSON.stringify(r).includes(secret));
      assert.ok(!JSON.stringify(r).includes("Users\\secret"));
      const logText = warns.join("\n");
      assert.ok(/archive_failed/.test(logText));
      assert.ok(!logText.includes(secret));
      assert.ok(!logText.includes("Users\\secret"));
    } finally {
      console.warn = origWarn;
      cleanup(d);
      fs.rmSync(userData, { recursive: true, force: true });
    }
  });

  // Full P1-01..P1-06 suite is covered by `npm run test:p1-phase1` / `test:p1-06`.
  // Optional nested regression (slow): set P107_NESTED_REGRESSION=1.
  if (process.env.P107_NESTED_REGRESSION === "1") {
    await testAsync("29. P1-01 through P1-06 hermetic regression", async () => {
      [
        "scripts/test-p1-01-secret-store.cjs",
        "scripts/test-p1-01-secret-leak-scan.cjs",
        "scripts/test-p1-02-package-store.cjs",
        "scripts/test-p1-03-subject-overview.cjs",
        "scripts/test-p1-04-policy-decision-audit.cjs",
        "scripts/test-p1-05-tool-broker.cjs",
        "scripts/test-p1-05-stop-ipc.cjs",
        "scripts/test-p1-06-builder-package-store.cjs",
      ].forEach(runNodeScript);
    });
  } else {
    test("29. nested prior-phase regression deferred to test:p1-phase1", () => {
      assert.ok(true);
    });
  }

  console.log(`\nP1-07 results: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

runAll().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
