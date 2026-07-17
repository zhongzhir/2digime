"use strict";

/** P1-07 Life / identity → PackageStore hermetic migration tests. */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { PackageStore, storeRootFor, dirByteFingerprint, readManifest } = require("../src/package-store");
const { createMinimalFixture } = require("../src/package-store/fixture");
const lifePackageWrite = require("../src/life/package-write");
const life = require("../src/life");
const materials = require("../src/materials");
const builderPackageWrite = require("../src/builder/package-write");

const ROOT = path.join(__dirname, "..");
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log("PASS", name); } catch (e) { failed++; console.error("FAIL", name, e?.stack || e); } }
async function testAsync(name, fn) { try { await fn(); passed++; console.log("PASS", name); } catch (e) { failed++; console.error("FAIL", name, e?.stack || e); } }
function tempDir(label) { return fs.mkdtempSync(path.join(os.tmpdir(), `dm-p107-${label}-`)); }
function cleanup(dir) { try { fs.rmSync(storeRootFor(dir), { recursive: true, force: true }); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} }
function makeV02(label) {
  const dir = tempDir(label);
  createMinimalFixture(dir, { withMemoryLine: true });
  fs.mkdirSync(path.join(dir, "sources"), { recursive: true });
  fs.writeFileSync(path.join(dir, "sources", "source-index.json"), JSON.stringify({ sources: [] }, null, 2), "utf8");
  const store = new PackageStore({ packageDir: dir, ownerId: "test:p107" });
  store.migrateToV02({ actor: "test:p107", toolVersion: "p1-07-test" });
  return dir;
}
const sampleIdentity = () => ({
  events: [{ when: "2020", what: "任测试职务", org: "测试机构", roleLabels: ["测试职务"], facets: ["roles"], confidence: "high" }],
  facts: ["补充短句事实一条"],
  inferences: [{ claim: "可能关注测试议题", type: "activity", confidence: "low", basedOn: "材料提及" }],
  outcomes: [{ title: "完成测试项目", when: "2021" }], domains: ["测试领域"],
  org_touchpoints: [{ org: "测试机构", kind: "employer" }],
  alter_candidates: [{ name: "张三", relationType: "同事", confidence: "low" }],
  mind_hooks: ["关于决策方式的线索"],
  capability_signals: [{ signal: "擅长结构化表达", polarity: "scope", confidence: "medium" }],
});
function payload(extra = {}) { return { identity: sampleIdentity(), confirmAsFact: false, sourceMeta: { id: "src_p107", title: "P1-07 测试材料", location: "C:\\tmp\\p107.txt", importedAt: "2026-01-01T00:00:00.000Z" }, reason: "P1-07 人生事实写入验收", ...extra }; }
function cs(dir, id) { return JSON.parse(fs.readFileSync(path.join(storeRootFor(dir), "changesets", id + ".json"), "utf8")); }
function runNodeScript(rel) { const r = spawnSync(process.execPath, [path.join(ROOT, rel)], { cwd: ROOT, encoding: "utf8" }); if (r.status !== 0) throw new Error(`${rel} failed:\n${r.stdout}\n${r.stderr}`); }
function commit(dir, preview, hooks) { return lifePackageWrite.commitLifeIdentityWrite(dir, { changeSetId: preview.changeSetId, confirmed: true }, hooks); }

async function runAll() {
  test("1. preview does not change package bytes or revision", () => { const d = makeV02("preview"); try { const fp = dirByteFingerprint(d), rev = readManifest(d).revision; lifePackageWrite.previewLifeIdentityWrite(d, payload()); assert.deepEqual(dirByteFingerprint(d), fp); assert.equal(readManifest(d).revision, rev); } finally { cleanup(d); } });
  test("2. preview does not scaffold life files and missing paths work", () => { const d = makeV02("no-scaffold"); try { const fp = dirByteFingerprint(d); assert.ok(!fs.existsSync(path.join(d, "life"))); const ops = lifePackageWrite.identityPayloadToOps(d, sampleIdentity(), { id: "src_missing", title: "缺失文件", createdAt: "2026-01-01T00:00:00.000Z" }, { confirmAsFact: false }); assert.ok(ops.ops.some((o) => o.path === "life/events.jsonl")); const p = lifePackageWrite.previewLifeIdentityWrite(d, payload()); assert.ok(p.affectedPaths.includes("life/events.jsonl")); assert.deepEqual(dirByteFingerprint(d), fp); assert.ok(!fs.existsSync(path.join(d, "life"))); } finally { cleanup(d); } });
  test("3. unconfirmed cannot commit", () => { const d = makeV02("unconfirmed"); try { const p = lifePackageWrite.previewLifeIdentityWrite(d, payload()); assert.throws(() => lifePackageWrite.commitLifeIdentityWrite(d, { changeSetId: p.changeSetId }), (e) => e?.code === "confirmation_required"); } finally { cleanup(d); } });
  test("4. cancel confirmation does not write", () => { const d = makeV02("cancel"); try { const fp = dirByteFingerprint(d); lifePackageWrite.previewLifeIdentityWrite(d, payload()); assert.deepEqual(dirByteFingerprint(d), fp); const app = fs.readFileSync(path.join(ROOT, "src", "renderer", "app.js"), "utf8"); const fn = app.slice(app.indexOf("async function previewAndCommitIdentityWrite"), app.indexOf("async function autoWriteDistillResult")); assert.ok(fn.indexOf("if (!ok)") < fn.lastIndexOf("window.digitalMe.writeDistill")); assert.match(fn, /return \{ ok: false, cancelled: true, preview \}/); } finally { cleanup(d); } });
  test("5. commit only affects previewed paths", () => { const d = makeV02("paths"); try { const p = lifePackageWrite.previewLifeIdentityWrite(d, payload()); const r = commit(d, p); assert.deepEqual([...r.affectedPaths].sort(), [...p.affectedPaths].sort()); assert.ok(r.affectedPaths.every((x) => p.affectedPaths.includes(x))); } finally { cleanup(d); } });
  test("6. commit increments revision", () => { const d = makeV02("revision"); try { const before = readManifest(d).revision; const r = commit(d, lifePackageWrite.previewLifeIdentityWrite(d, payload())); assert.ok(r.revision > before); assert.equal(readManifest(d).revision, r.revision); } finally { cleanup(d); } });
  test("7. mapping respects confirmation and owner assertion", () => { const d = makeV02("mapping"); try { const inf = lifePackageWrite.previewLifeIdentityWrite(d, payload()); assert.ok(inf.dataKinds.includes("inference")); assert.ok(!inf.dataKinds.includes("owner_assertion")); const fact = lifePackageWrite.previewLifeIdentityWrite(d, payload({ confirmAsFact: true, sourceMeta: { id: "src_fact", title: "确认材料" } })); assert.ok(fact.dataKinds.includes("fact")); assert.ok(fact.dataKinds.includes("owner_assertion")); } finally { cleanup(d); } });
  test("8. forged renderer dataKinds are ignored", () => { const d = makeV02("forged"); try { const p = lifePackageWrite.previewLifeIdentityWrite(d, payload({ dataKinds: ["owner_assertion"], pathDataKinds: { "life/events.jsonl": "owner_assertion" } })); assert.ok(!p.dataKinds.includes("owner_assertion")); assert.equal(p.pathDataKinds["life/events.jsonl"], "inference"); } finally { cleanup(d); } });
  test("9. model default is inference", () => { const d = makeV02("default"); try { const p = lifePackageWrite.previewLifeIdentityWrite(d, payload()); assert.equal(p.fieldKinds.events, "inference"); assert.equal(p.fieldKinds.facts, "inference"); assert.equal(p.fieldKinds.outcomes, "inference"); } finally { cleanup(d); } });
  test("10. fact only after confirmAsFact", () => { const d = makeV02("fact-only"); try { const a = lifePackageWrite.previewLifeIdentityWrite(d, payload()); const b = lifePackageWrite.previewLifeIdentityWrite(d, payload({ confirmAsFact: true, sourceMeta: { id: "src_yes", title: "确认" } })); assert.ok(!a.dataKinds.includes("fact")); assert.ok(b.dataKinds.includes("fact")); } finally { cleanup(d); } });
  test("11. identityClaims only with confirmAsFact", () => { const d = makeV02("claims"); try { const a = lifePackageWrite.previewLifeIdentityWrite(d, payload()); const b = lifePackageWrite.previewLifeIdentityWrite(d, payload({ confirmAsFact: true, sourceMeta: { id: "src_claim", title: "确认" } })); assert.ok(!a.affectedPaths.includes("identity.json")); assert.ok(b.affectedPaths.includes("identity.json")); } finally { cleanup(d); } });
  test("12. inferences are never facts", () => { const d = makeV02("inferences"); try { const p = lifePackageWrite.previewLifeIdentityWrite(d, payload({ confirmAsFact: true })); assert.equal(p.fieldKinds.inferences, "inference"); commit(d, p); const rows = fs.readFileSync(path.join(d, "life", "inferences.jsonl"), "utf8"); assert.match(rows, /"dataKindHint":"inference"/); } finally { cleanup(d); } });
  test("13. kinds metadata is auditable", () => { const d = makeV02("audit-meta"); try { const p = lifePackageWrite.previewLifeIdentityWrite(d, payload({ confirmAsFact: true })); const stored = cs(d, p.changeSetId); assert.deepEqual(stored.lifeIdentityMeta.pathDataKinds, p.pathDataKinds); assert.deepEqual(stored.lifeIdentityMeta.fieldKinds, p.fieldKinds); assert.ok(stored.dataKinds.includes("fact")); } finally { cleanup(d); } });
  test("14. provenance metadata is correct", () => { const d = makeV02("provenance"); try { const p = lifePackageWrite.previewLifeIdentityWrite(d, payload()); assert.equal(p.actor, "owner:life"); assert.match(p.reason, /P1-07/); assert.equal(p.sourceMeta.id, "src_p107"); assert.ok(p.sourceRefs.includes("src_p107")); assert.ok(p.sourceRefs.some((x) => x.includes("p107.txt"))); } finally { cleanup(d); } });
  test("15. expired changeSet rejected", () => { const d = makeV02("expired"); try { const p = lifePackageWrite.previewLifeIdentityWrite(d, payload()); const file = path.join(storeRootFor(d), "changesets", p.changeSetId + ".json"), data = JSON.parse(fs.readFileSync(file, "utf8")); data.expiresAt = new Date(Date.now() - 1000).toISOString(); fs.writeFileSync(file, JSON.stringify(data, null, 2)); assert.throws(() => commit(d, p), (e) => e?.code === "changeset_expired"); } finally { cleanup(d); } });
  test("16. revision conflict rejected", () => { const d = makeV02("revision-conflict"); try { const p = lifePackageWrite.previewLifeIdentityWrite(d, payload()); const s = new PackageStore({ packageDir: d, ownerId: "test:mutate" }); const other = s.createChangeSet({ actor: "owner:life", reason: "冲突变更", sourceRefs: ["x"], dataKinds: ["inference"], ops: [{ type: "write_text", path: "persona.md", content: "changed" }] }); s.commit(other.id, { confirmed: true }); assert.throws(() => commit(d, p), (e) => /conflict|revision|digest/i.test(e?.code || e?.message)); } finally { cleanup(d); } });
  test("17. before hash conflict rejected", () => { const d = makeV02("hash-conflict"); try { const p = lifePackageWrite.previewLifeIdentityWrite(d, payload()); fs.mkdirSync(path.join(d, "life"), { recursive: true }); fs.writeFileSync(path.join(d, "life", "events.jsonl"), "tampered\n"); assert.throws(() => commit(d, p), (e) => /conflict|hash/i.test(e?.code || e?.message)); } finally { cleanup(d); } });
  test("18. staging failure keeps old version", () => { const d = makeV02("injected"); try { const p = lifePackageWrite.previewLifeIdentityWrite(d, payload()), fp = dirByteFingerprint(d), rev = readManifest(d).revision; assert.throws(() => commit(d, p, { beforeValidateStaging: () => { const e = new Error("injected"); e.code = "inject_fail"; throw e; } }), (e) => e?.code === "inject_fail"); assert.equal(readManifest(d).revision, rev); assert.deepEqual(dirByteFingerprint(d), fp); } finally { cleanup(d); } });
  test("19. reopen store retains revision and content", () => { const d = makeV02("reopen"); try { const r = commit(d, lifePackageWrite.previewLifeIdentityWrite(d, payload())); const fp = dirByteFingerprint(d); const s = new PackageStore({ packageDir: d, ownerId: "test:reopen" }); s.recover(); assert.equal(s.inspect().revision, r.revision); assert.deepEqual(dirByteFingerprint(d), fp); } finally { cleanup(d); } });
  test("20. rollback creates revision and restores", () => { const d = makeV02("rollback"); try { const before = fs.readFileSync(path.join(d, "persona.md"), "utf8"); const r = commit(d, lifePackageWrite.previewLifeIdentityWrite(d, payload())); const rolled = new PackageStore({ packageDir: d, ownerId: "test:rollback" }).rollback(r.rollbackVersion, { confirmed: true }); assert.ok(rolled.revision > r.revision); assert.equal(fs.readFileSync(path.join(d, "persona.md"), "utf8"), before); assert.ok(!fs.existsSync(path.join(d, "life", "events.jsonl"))); } finally { cleanup(d); } });
  test("21. writeLifeBack is blocked", () => assert.throws(() => life.writeLifeBack(), (e) => e?.code === "life_direct_write_blocked"));
  test("22. materials.writeIdentityBack is blocked", () => assert.throws(() => materials.writeIdentityBack(), (e) => e?.code === "materials_identity_direct_write_blocked"));
  test("23. commit rejects raw identity payload", () => { const d = makeV02("raw-reject"); try { const p = lifePackageWrite.previewLifeIdentityWrite(d, payload()); assert.throws(() => lifePackageWrite.commitLifeIdentityWrite(d, { changeSetId: p.changeSetId, confirmed: true, identity: sampleIdentity() }), (e) => e?.code === "identity_commit_payload_rejected"); } finally { cleanup(d); } });
  test("24. renderer uses confirmed identity preview path", () => { const app = fs.readFileSync(path.join(ROOT, "src", "renderer", "app.js"), "utf8"); assert.match(app, /previewAndCommitIdentityWrite/); assert.match(app, /confirmAsFact:\s*false/); const auto = app.slice(app.indexOf("async function autoWriteDistillResult"), app.indexOf("async function runMaterialPipeline")); assert.ok(!/writeDistill\(\{[\s\S]{0,180}identity\s*:/.test(auto)); });
  test("25. archive occurs after successful identity commit", () => { const main = fs.readFileSync(path.join(ROOT, "src", "main.js"), "utf8"); const i = main.indexOf("lifePackageWrite.commitLifeIdentityWrite"), a = main.indexOf("materials.archiveIdentityRun", i); assert.ok(i >= 0 && a > i); const d = makeV02("archive"); const u = tempDir("archive-user"); try { const r = commit(d, lifePackageWrite.previewLifeIdentityWrite(d, payload())); assert.ok(r.ok); const archived = materials.archiveIdentityRun(u, { title: r.sourceMeta.title, claims: [], facts: [], events: [], inferences: [], outcomes: [] }); assert.ok(archived?.id); } finally { cleanup(d); fs.rmSync(u, { recursive: true, force: true }); } });
  test("26. P1-06 persona path still works", () => { const d = makeV02("persona"); try { const p = builderPackageWrite.previewPersonaWrite(d, { agg: { memories: [{ content: "P1-07 persona regression", confidence: "high" }], decisionFrameworks: [], styleObservations: [], personaNotes: [] }, title: "回归材料" }); const r = builderPackageWrite.commitPersonaWrite(d, { changeSetId: p.changeSetId, confirmed: true }); assert.ok(r.ok); } finally { cleanup(d); } });
  await testAsync("27. P1-01 through P1-06 hermetic regression", async () => { ["scripts/test-p1-01-secret-store.cjs", "scripts/test-p1-01-secret-leak-scan.cjs", "scripts/test-p1-02-package-store.cjs", "scripts/test-p1-03-subject-overview.cjs", "scripts/test-p1-04-policy-decision-audit.cjs", "scripts/test-p1-05-tool-broker.cjs", "scripts/test-p1-05-stop-ipc.cjs", "scripts/test-p1-06-builder-package-store.cjs"].forEach(runNodeScript); });
  console.log(`\nP1-07 results: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}
runAll();

