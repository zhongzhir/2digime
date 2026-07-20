"use strict";

/**
 * PAN-01S / PAN-01S.1 Minimal Product Surface hermetic tests (temp fixtures only).
 * Run: node scripts/test-pan-01s-minimal-surface.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { createMinimalFixture } = require("../src/package-store/fixture");
const { PackageStore } = require("../src/package-store");
const { buildSubjectOverviewV1 } = require("../src/subject-overview");
const {
  PANORAMA_NAV_TARGETS,
  PANORAMA_TEST_ONLY_NAV_TARGETS,
  SUBJECT_IDENTITY_LINE,
  MINIMAL_SURFACE_ACTIONS,
} = require("../src/subject-overview/constants");
const {
  buildMinimalSurface,
  buildBuildFlow,
  summarizeInboxForOverview,
  sanitizeNavTarget,
  resolveSubjectIntegrity,
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
  return fs.mkdtempSync(path.join(os.tmpdir(), `dm-pan01s-${label}-`));
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
  const s = new PackageStore({ packageDir: dir, ownerId: "test:pan01s" });
  s.migrateToV02({ actor: "test:pan01s", toolVersion: "test-pan-01s" });
  return dir;
}

function assertNoLeak(raw) {
  assert.equal(raw.includes("apiKey"), false);
  assert.equal(raw.includes("sk-"), false);
  assert.equal(/[A-Za-z]:\\\\|\/Users\/|\/home\//.test(raw), false);
  assert.equal(raw.includes("persona.md"), false);
}

function msOf(overview) {
  return overview.panorama.minimalSurface;
}

function assertIdentityTwoLine(summary, line2Snippet) {
  assert.ok(typeof summary === "string");
  assert.ok(summary.startsWith(SUBJECT_IDENTITY_LINE));
  assert.ok(summary.includes("\n"));
  if (line2Snippet) assert.match(summary, line2Snippet);
}

test("G/L: missing → P1 让我认识你, no fake ownership/privacy", () => {
  const missing = path.join(tempDir("missing-root"), "no-such-package");
  try {
    const overview = buildSubjectOverviewV1(missing, {});
    const ms = msOf(overview);
    assert.equal(ms.priority, "P1");
    assert.equal(ms.primaryAction, "continue_build");
    assert.equal(ms.primaryActionLabel, MINIMAL_SURFACE_ACTIONS.continue_build);
    assert.equal(ms.primaryActionLabel, "让我认识你");
    assert.equal(ms.primaryNavTarget, "me-build");
    assertIdentityTwoLine(ms.summary, /还不够了解你，可以先从已有资料开始/);
    assert.equal(/简短对话|几分钟对话/.test(ms.summary), false);
    assert.equal(overview.package.privacyLabel, "隐私状态尚无法确认");
    assert.equal(ms.summary.includes("属于你"), false);
    assert.equal(ms.summary.includes("状态正常"), false);
  } finally {
    cleanup(path.dirname(missing));
  }
});

test("M: read_error → P0 恢复我的信息", () => {
  const dir = makeV02("read-error");
  try {
    fs.writeFileSync(path.join(dir, "manifest.json"), "{not-json", "utf8");
    const overview = buildSubjectOverviewV1(dir, {});
    const ms = msOf(overview);
    assert.equal(ms.priority, "P0");
    assert.equal(ms.primaryAction, "view_problems");
    assert.equal(ms.primaryActionLabel, "恢复我的信息");
    assert.equal(ms.primaryNavTarget, "settings-package-versions");
    assertIdentityTwoLine(ms.summary, /无法读取/);
  } finally {
    cleanup(dir);
  }
});

test("M: content_degraded → P0", () => {
  const dir = makeV02("degraded");
  try {
    fs.mkdirSync(path.join(dir, "life"), { recursive: true });
    fs.writeFileSync(path.join(dir, "life", "roles.json"), "{bad", "utf8");
    const overview = buildSubjectOverviewV1(dir, {});
    const state = resolveSubjectIntegrity({
      ...overview,
      _packageExists: true,
    });
    assert.equal(state.contentDegraded || state.subjectReadStatus === "content_degraded", true);
    const ms = msOf(overview);
    assert.equal(ms.priority, "P0");
    assert.equal(ms.primaryActionLabel, "恢复我的信息");
  } finally {
    cleanup(dir);
  }
});

test("U: awaiting_review + suggested → P2 确认我的理解", () => {
  const dir = makeV02("u-conflict");
  try {
    const inbox = summarizeInboxForOverview({
      items: [
        { status: "awaiting_review" },
        { status: "suggested" },
      ],
    });
    const overview = buildSubjectOverviewV1(dir, { inboxSummary: inbox });
    const ms = msOf(overview);
    assert.equal(ms.priority, "P2");
    assert.equal(ms.primaryActionLabel, "确认我的理解");
    assert.equal(ms.primaryNavTarget, "me-build");
    assertIdentityTwoLine(ms.summary, /需要你确认/);
  } finally {
    cleanup(dir);
  }
});

test("V: read_error + awaiting_review → P0", () => {
  const dir = makeV02("v-conflict");
  try {
    fs.writeFileSync(path.join(dir, "identity.json"), "{broken", "utf8");
    const inbox = summarizeInboxForOverview({
      items: [{ status: "awaiting_review" }],
    });
    const overview = buildSubjectOverviewV1(dir, { inboxSummary: inbox });
    assert.equal(msOf(overview).priority, "P0");
    assert.equal(msOf(overview).primaryActionLabel, "恢复我的信息");
  } finally {
    cleanup(dir);
  }
});

test("W: missing + suggested → P1", () => {
  const missing = path.join(tempDir("w-root"), "gone");
  try {
    const inbox = summarizeInboxForOverview({ items: [{ status: "suggested" }] });
    const overview = buildSubjectOverviewV1(missing, { inboxSummary: inbox });
    assert.equal(msOf(overview).priority, "P1");
    assert.equal(msOf(overview).primaryActionLabel, "让我认识你");
  } finally {
    cleanup(path.dirname(missing));
  }
});

test("X: processing only + readable → P4 + reminder + chat primary", () => {
  const dir = makeV02("x-proc");
  try {
    const inbox = summarizeInboxForOverview({ items: [{ status: "processing" }] });
    const overview = buildSubjectOverviewV1(dir, { inboxSummary: inbox });
    const ms = msOf(overview);
    assert.equal(ms.priority, "P4");
    assert.equal(ms.primaryAction, "start_work");
    assert.equal(ms.primaryActionLabel, "开始一次对话");
    assert.equal(ms.primaryNavTarget, "chat");
    assert.equal(ms.secondaryAction && ms.secondaryAction.label, "查看目前的我");
    assert.match(ms.reminder || "", /有内容正在处理中/);
    assertIdentityTwoLine(ms.summary);
    assert.notEqual(ms.primaryAction, "continue_build");
  } finally {
    cleanup(dir);
  }
});

test("Y: unknown inbox status → fail-closed", () => {
  const dir = makeV02("y-unknown");
  try {
    const inbox = summarizeInboxForOverview({ items: [{ status: "totally_unknown_xyz" }] });
    const overview = buildSubjectOverviewV1(dir, { inboxSummary: inbox });
    const ms = msOf(overview);
    assert.equal(ms.failClosed, true);
    assert.equal(ms.primaryNavTarget, null);
    assert.equal(ms.primaryAction, null);
    assertIdentityTwoLine(ms.summary, /无法确认/);
  } finally {
    cleanup(dir);
  }
});

test("N: unknown navTarget sanitized to null (fail-closed)", () => {
  assert.equal(sanitizeNavTarget("panorama-experience"), null);
  assert.equal(sanitizeNavTarget("evil-path"), null);
  assert.equal(PANORAMA_NAV_TARGETS.has("panorama-experience"), false);
  assert.equal(PANORAMA_TEST_ONLY_NAV_TARGETS.has("panorama-experience"), true);
  const forged = buildMinimalSurface(
    {
      identity: { displayName: "T" },
      package: { healthStatus: "healthy", privacyStatus: "local_private", subjectRead: {
        manifestPresent: true, manifestParseOk: true, identityPresent: true, identityParseOk: true,
      } },
      warnings: [],
      _packageExists: true,
    },
    summarizeInboxForOverview(null)
  );
  // Inject impossible target via direct call — sanitize already applied inside builder
  assert.ok(forged.primaryNavTarget === null || PANORAMA_NAV_TARGETS.has(forged.primaryNavTarget));
});

test("O: renderer cannot inject priority via runtime junk", () => {
  const dir = makeV02("o-inject");
  try {
    const overview = buildSubjectOverviewV1(dir, {
      hasApiKey: true,
      priority: "P0",
      primaryAction: "view_problems",
      panorama: { minimalSurface: { priority: "P0", primaryActionLabel: "HACK" } },
    });
    assert.equal(msOf(overview).priority, "P4");
    assert.equal(msOf(overview).primaryActionLabel, "开始一次对话");
    assert.equal(msOf(overview).primaryAction, "start_work");
  } finally {
    cleanup(dir);
  }
});

test("P: package bytes unchanged around overview", () => {
  const dir = makeV02("bytes");
  try {
    const before = dirFingerprint(dir);
    buildSubjectOverviewV1(dir, {
      inboxSummary: summarizeInboxForOverview({ items: [{ status: "suggested" }] }),
    });
    assert.equal(dirFingerprint(dir), before);
  } finally {
    cleanup(dir);
  }
});

test("Q: no path/secret leaks in minimalSurface payload", () => {
  const dir = makeV02("leak");
  try {
    const overview = buildSubjectOverviewV1(dir, {
      inboxSummary: summarizeInboxForOverview({
        items: [{ status: "suggested", filePath: "C:\\\\Users\\\\secret\\\\persona.md" }],
      }),
    });
    assertNoLeak(JSON.stringify(overview.panorama.minimalSurface));
    assertNoLeak(JSON.stringify(overview.panorama.buildFlow));
    assertNoLeak(JSON.stringify(overview));
  } finally {
    cleanup(dir);
  }
});

test("nextAction aligns with minimalSurface; never panorama-experience", () => {
  const dir = makeV02("next");
  try {
    const overview = buildSubjectOverviewV1(dir, {});
    assert.equal(overview.panorama.nextAction.navTarget, overview.panorama.minimalSurface.primaryNavTarget);
    assert.equal(overview.panorama.nextAction.label, overview.panorama.minimalSurface.primaryActionLabel);
    assert.equal(overview.panorama.nextAction.navTarget, "chat");
    assert.notEqual(overview.panorama.nextAction.navTarget, "panorama-experience");
    for (const p of overview.panorama.promises) {
      assert.notEqual(p.navTarget, "panorama-experience");
    }
    for (const j of overview.panorama.journey) {
      assert.notEqual(j.navTarget, "panorama-experience");
    }
  } finally {
    cleanup(dir);
  }
});

test("P3: suggested alone → 继续完善我", () => {
  const dir = makeV02("p3");
  try {
    const overview = buildSubjectOverviewV1(dir, {
      inboxSummary: summarizeInboxForOverview({ items: [{ status: "suggested" }] }),
    });
    assert.equal(msOf(overview).priority, "P3");
    assert.equal(msOf(overview).primaryActionLabel, "继续完善我");
    assertIdentityTwoLine(msOf(overview).summary, /继续完善/);
  } finally {
    cleanup(dir);
  }
});

test("pending_confirmation maps to P2", () => {
  const dir = makeV02("pending-conf");
  try {
    const overview = buildSubjectOverviewV1(dir, {
      inboxSummary: summarizeInboxForOverview({ items: [{ status: "pending_confirmation" }] }),
    });
    assert.equal(msOf(overview).priority, "P2");
    assert.equal(msOf(overview).primaryActionLabel, "确认我的理解");
  } finally {
    cleanup(dir);
  }
});

test("buildFlow: B0 empty inbox; B2 actionable; B3 processing; B4 awaiting", () => {
  const dir = makeV02("build-flow");
  try {
    const overview = buildSubjectOverviewV1(dir, {});
    const b0 = overview.panorama.buildFlow;
    assert.equal(b0.step, "B0");
    assert.equal(typeof b0.pendingCount, "number");
    assert.equal(typeof b0.hasIntakeEvidence, "boolean");

    const b2 = buildBuildFlow(overview, summarizeInboxForOverview({
      items: [{ status: "suggested" }, { status: "queued" }],
    }), {});
    assert.equal(b2.step, "B2");
    assert.equal(b2.pendingCount, 2);

    const b3 = buildBuildFlow(overview, summarizeInboxForOverview({
      items: [{ status: "processing" }],
    }), {});
    assert.equal(b3.step, "B3");

    const b4 = buildBuildFlow(overview, summarizeInboxForOverview({
      items: [{ status: "awaiting_review" }],
    }), {});
    assert.equal(b4.step, "B4");
  } finally {
    cleanup(dir);
  }
});

test("no unsupported conversational build promise in P1/B0; P4 chat primary kept", () => {
  const missing = path.join(tempDir("no-chat-build"), "gone");
  try {
    const p1 = msOf(buildSubjectOverviewV1(missing, {}));
    assert.equal(p1.priority, "P1");
    assert.match(p1.summary, /可以先从已有资料开始/);
    assert.equal(/简短对话/.test(p1.summary), false);
    assert.equal(/几分钟对话/.test(p1.summary), false);
  } finally {
    cleanup(path.dirname(missing));
  }

  const html = fs.readFileSync(path.join(__dirname, "../src/renderer/index.html"), "utf8");
  const b0Block = html.slice(html.indexOf('id="build-step-b0"'), html.indexOf('id="build-step-b1"'));
  assert.match(b0Block, /你可以从已有的简历、项目材料、文章或决策记录开始，不必事先整理完整档案/);
  assert.equal(/几分钟对话/.test(b0Block), false);
  assert.equal(/简短对话/.test(b0Block), false);
  assert.equal(/先去对话里聊聊/.test(html), false);
  assert.equal(html.includes("btn-build-b0-chat-note"), false);

  const appSrc = fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8");
  assert.equal(appSrc.includes("btn-build-b0-chat-note"), false);

  const dir = makeV02("p4-chat-kept");
  try {
    const p4 = msOf(buildSubjectOverviewV1(dir, {}));
    assert.equal(p4.priority, "P4");
    assert.equal(p4.primaryAction, "start_work");
    assert.equal(p4.primaryActionLabel, "开始一次对话");
    assert.equal(p4.primaryNavTarget, "chat");
  } finally {
    cleanup(dir);
  }
});

test("buildFlow hasIntakeEvidence from source-index substring", () => {
  const dir = makeV02("intake-ev");
  try {
    const sourcesDir = path.join(dir, "sources");
    fs.mkdirSync(sourcesDir, { recursive: true });
    fs.writeFileSync(
      path.join(sourcesDir, "source-index.json"),
      JSON.stringify({ sources: [{ id: "x", label: "intake-questionnaire-v0.3" }] }, null, 2),
      "utf8"
    );
    const overview = buildSubjectOverviewV1(dir, {});
    assert.equal(overview.panorama.buildFlow.hasIntakeEvidence, true);
  } finally {
    cleanup(dir);
  }
});

test("S/T/Z: production constants reject harness nav; harness flag is env-only", () => {
  assert.equal(sanitizeNavTarget("panorama-experience"), null);
  // Renderer-side enable vectors must not be trusted by constants
  assert.equal(sanitizeNavTarget("?harness=1"), null);
  assert.equal(sanitizeNavTarget("#panorama-experience"), null);
  assert.equal(
    process.env.DIGITALME_PAN01R_TEST_HARNESS === "1" ||
      process.env.DIGITALME_PAN01R_OWNER_RUNTIME === "1",
    false,
    "hermetic node test must not enable harness by default"
  );
  // preload source gate
  const preload = fs.readFileSync(path.join(__dirname, "../src/preload.js"), "utf8");
  assert.match(preload, /PAN01R_TEST_HARNESS/);
  assert.match(preload, /DIGITALME_PAN01R_TEST_HARNESS/);
  assert.ok(preload.includes("getPanoramaSubjectBrief"));
  // APIs only inside harness branch
  const harnessBlock = preload.slice(preload.indexOf("if (PAN01R_TEST_HARNESS)"));
  assert.match(harnessBlock, /getPanoramaSubjectBrief/);
  const before = preload.slice(0, preload.indexOf("if (PAN01R_TEST_HARNESS)"));
  assert.equal(before.includes("getPanoramaSubjectBrief"), false);
});

test("production HTML has wizard + demoted bootstrap; intake under more", () => {
  const html = fs.readFileSync(path.join(__dirname, "../src/renderer/index.html"), "utf8");
  assert.equal(html.includes("panorama-sovereign-cta"), false);
  assert.equal(html.includes("panorama-promises-card"), false);
  assert.equal(html.includes("panorama-journey-card"), false);
  assert.equal(html.includes('id="pkg-status"'), false);
  assert.equal(html.includes('id="model-status"'), false);
  assert.equal(html.includes('id="capabilities-status"'), false);
  assert.equal(html.includes("属于你 · 可带走 · 可信任"), false);
  assert.match(html, /subject-minimal-summary/);
  assert.match(html, /subject-minimal-actions/);
  assert.match(html, /id="build-wizard-step"/);
  assert.match(html, /id="build-wizard-more"/);
  assert.match(html, /id="build-step-b0"/);
  assert.match(html, /id="build-step-b5"/);
  assert.match(html, /id="btn-build-b0-import"/);
  assert.match(html, /id="btn-inbox-pick"/);
  assert.match(html, /id="btn-access-add"/);
  // bootstrap-guide not on main path (absent or permanently hidden)
  const bootstrapIdx = html.indexOf('id="bootstrap-guide"');
  if (bootstrapIdx >= 0) {
    const slice = html.slice(Math.max(0, bootstrapIdx - 120), bootstrapIdx + 80);
    assert.match(slice, /hidden/);
    assert.equal(html.includes("建议先备齐两类材料"), false);
  }
  // intake-card inside build-wizard-more
  const moreIdx = html.indexOf('id="build-wizard-more"');
  const intakeIdx = html.indexOf('id="intake-card"');
  assert.ok(moreIdx >= 0 && intakeIdx > moreIdx);
  const moreClose = html.indexOf("</details>", intakeIdx);
  assert.ok(moreClose > intakeIdx);
});

test("help.js contains promises/journey; no PAN-01R CTA", () => {
  const help = fs.readFileSync(path.join(__dirname, "../src/renderer/help.js"), "utf8");
  assert.match(help, /认识 Digital Me/);
  assert.match(help, /这是我/);
  assert.match(help, /构建我/);
  assert.match(help, /看见我/);
  assert.equal(help.includes("体验一次 Digital Me 如何代表我"), false);
  assert.equal(help.includes("panorama-experience"), false);
});

test("app.js rejects panorama-experience production entry; wires build wizard", () => {
  const appJs = fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8");
  assert.match(appJs, /renderMinimalSurface/);
  assert.match(appJs, /applyBuildWizard/);
  assert.match(appJs, /refreshBuildFlowFromOverview/);
  assert.match(appJs, /MINIMAL_SURFACE_ACTION_WHITELIST/);
  assert.match(appJs, /pan01rTestHarness !== true/);
  assert.match(appJs, /never recompute P0/);
  assert.match(appJs, /subject-minimal-line1/);
  // Production whitelist must not include panorama-experience
  const wl = appJs.match(/const PANORAMA_NAV_WHITELIST = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(wl);
  assert.equal(wl[1].includes("panorama-experience"), false);
});

console.log(`\nPAN-01S hermetic: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
