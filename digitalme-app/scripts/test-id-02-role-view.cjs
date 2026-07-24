"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const {
  DEFAULT_ROLES,
  loadRoleView,
  getCurrentRole,
  setCurrentRole,
  getRoleContext,
} = require("../src/identity/role-view");
const { normalizeTaskIntent, DEFAULT_ROLE } = require("../src/act-behalf/task-intent");

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + label); }
}

// Test 1: default role list correct
assert(DEFAULT_ROLES.length === 4, "default has 4 roles");
assert(DEFAULT_ROLES[0].id === "founder" && DEFAULT_ROLES[0].label === "创始人", "founder role correct");
assert(DEFAULT_ROLES[1].id === "investor" && DEFAULT_ROLES[1].label === "投资人", "investor role correct");
assert(DEFAULT_ROLES[2].id === "writer" && DEFAULT_ROLES[2].label === "写作者", "writer role correct");
assert(DEFAULT_ROLES[3].id === "researcher" && DEFAULT_ROLES[3].label === "研究者", "researcher role correct");
for (const r of DEFAULT_ROLES) {
  assert(
    r.description && Array.isArray(r.visibleClaims) && r.expressionStyle && Array.isArray(r.boundaries),
    "role " + r.id + " has description/visibleClaims/expressionStyle/boundaries"
  );
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-test-role-view-"));

// Test 2: fresh Package defaults to founder without writing a file
const fresh = loadRoleView(tmpDir);
assert(fresh.currentRole === "founder", "fresh package defaults to founder");
assert(fresh.roles.length === 4, "fresh package returns default roles");
assert(!fs.existsSync(path.join(tmpDir, "role-view.json")), "no role-view.json written on load");

// Test 3: role switch persists
const saved = setCurrentRole(tmpDir, "writer");
assert(saved.currentRole === "writer", "setCurrentRole returns updated view");
assert(saved.updatedAt, "updatedAt stamped on save");
assert(fs.existsSync(path.join(tmpDir, "role-view.json")), "role-view.json persisted");
const reloaded = loadRoleView(tmpDir);
assert(reloaded.currentRole === "writer", "role switch persisted across loads");
const current = getCurrentRole(tmpDir);
assert(current.id === "writer" && current.label === "写作者", "getCurrentRole returns switched role");

// Test 4: role context returned correctly
const ctx = getRoleContext(tmpDir);
assert(ctx.roleId === "writer", "context roleId correct");
assert(ctx.roleLabel === "写作者", "context roleLabel correct");
assert(
  Array.isArray(ctx.visibleClaims) && ctx.visibleClaims.join(",") === "writing,style,creativity",
  "context visibleClaims correct"
);
assert(ctx.expressionStyle === "creative", "context expressionStyle correct");
assert(
  Array.isArray(ctx.boundaries) && ctx.boundaries.includes("no_plagiarism"),
  "context boundaries correct"
);

// Test 5: unknown role rejected
let threw = false;
try {
  setCurrentRole(tmpDir, "astronaut");
} catch (err) {
  threw = /未知角色/.test(err.message);
}
assert(threw, "unknown role rejected");
assert(loadRoleView(tmpDir).currentRole === "writer", "rejected switch leaves current role unchanged");

// Test 6: corrupt role-view.json falls back to defaults
fs.writeFileSync(path.join(tmpDir, "role-view.json"), "{not-json", "utf8");
const fallback = loadRoleView(tmpDir);
assert(fallback.currentRole === "founder" && fallback.roles.length === 4, "corrupt file falls back to defaults");

// Test 7: task intent uses current role context when packageDir provided
setCurrentRole(tmpDir, "researcher");
const intent = normalizeTaskIntent({ goal: "整理一份行业研究综述" }, "abt_role", tmpDir);
assert(intent.role === "研究者", "intent role falls back to current role label");
assert(intent.roleContext && intent.roleContext.roleId === "researcher", "intent carries roleContext");
assert(intent.roleContext.expressionStyle === "academic", "intent roleContext style correct");

// Test 8: explicit role wins over role view; without packageDir behavior unchanged
const explicit = normalizeTaskIntent({ goal: "g", role: "自定义角色" }, "abt_role2", tmpDir);
assert(explicit.role === "自定义角色", "explicit role wins over role view");
const noDir = normalizeTaskIntent({ goal: "g" }, "abt_role3");
assert(noDir.role === DEFAULT_ROLE && !noDir.roleContext, "no packageDir keeps legacy default role");

// Cleanup
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
