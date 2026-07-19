"use strict";

/**
 * PAN-01S Minimal Product Surface hermetic tests (temp fixtures only).
 * Covers task package §12.1 A–Z (logic / contract layer).
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
} = require("../src/subject-overview/constants");
const {
  buildMinimalSurface,
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

test("G/L: missing → P1 继续构建, no fake ownership/privacy", () => {
  const missing = path.join(tempDir("missing-root"), "no-such-package");
  try {
    const overview = buildSubjectOverviewV1(missing, {});
    const ms = msOf(overview);
    assert.equal(ms.priority, "P1");
    assert.equal(ms.primaryAction, "continue_build");
    assert.equal(ms.primaryActionLabel, "继续构建");
    assert.equal(ms.primaryNavTarget, "me-build");
    assert.match(ms.summary, /还没有完成建立/);
    assert.equal(overview.package.privacyLabel, "隐私状态尚无法确认");
    assert.equal(ms.summary.includes("属于你"), false);
    assert.equal(ms.summary.includes("状态正常"), false);
  } finally {
    cleanup(path.dirname(missing));
  }
});

test("M: read_error → P0 查看问题", () => {
  const dir = makeV02("read-error");
  try {
    fs.writeFileSync(path.join(dir, "manifest.json"), "{not-json", "utf8");
    const overview = buildSubjectOverviewV1(dir, {});
    const ms = msOf(overview);
    assert.equal(ms.priority, "P0");
    assert.equal(ms.primaryAction, "view_problems");
    assert.equal(ms.primaryActionLabel, "查看问题");
    assert.equal(ms.primaryNavTarget, "settings-package-versions");
    assert.match(ms.summary, /无法读取/);
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
    assert.equal(ms.primaryActionLabel, "查看问题");
  } finally {
    cleanup(dir);
  }
});

test("U: awaiting_review + suggested → P2 继续确认", () => {
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
    assert.equal(ms.primaryActionLabel, "继续确认");
    assert.equal(ms.primaryNavTarget, "me-build");
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
    assert.equal(msOf(overview).primaryActionLabel, "查看问题");
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
    assert.equal(msOf(overview).primaryActionLabel, "继续构建");
  } finally {
    cleanup(path.dirname(missing));
  }
});

test("X: processing only + readable → P4 + reminder", () => {
  const dir = makeV02("x-proc");
  try {
    const inbox = summarizeInboxForOverview({ items: [{ status: "processing" }] });
    const overview = buildSubjectOverviewV1(dir, { inboxSummary: inbox });
    const ms = msOf(overview);
    assert.equal(ms.priority, "P4");
    assert.equal(ms.primaryActionLabel, "查看我的信息");
    assert.equal(ms.primaryNavTarget, "me-cognition");
    assert.match(ms.reminder || "", /处理中/);
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
    assert.equal(msOf(overview).primaryActionLabel, "查看我的信息");
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

test("P3: suggested alone → 继续完善", () => {
  const dir = makeV02("p3");
  try {
    const overview = buildSubjectOverviewV1(dir, {
      inboxSummary: summarizeInboxForOverview({ items: [{ status: "suggested" }] }),
    });
    assert.equal(msOf(overview).priority, "P3");
    assert.equal(msOf(overview).primaryActionLabel, "继续完善");
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
    assert.equal(msOf(overview).primaryActionLabel, "继续确认");
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

test("production HTML has no sovereign CTA / promise walls", () => {
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

test("app.js rejects panorama-experience production entry", () => {
  const appJs = fs.readFileSync(path.join(__dirname, "../src/renderer/app.js"), "utf8");
  assert.match(appJs, /renderMinimalSurface/);
  assert.match(appJs, /MINIMAL_SURFACE_ACTION_WHITELIST/);
  assert.match(appJs, /pan01rTestHarness !== true/);
  assert.match(appJs, /never recompute P0/);
  // Production whitelist must not include panorama-experience
  const wl = appJs.match(/const PANORAMA_NAV_WHITELIST = new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(wl);
  assert.equal(wl[1].includes("panorama-experience"), false);
});

console.log(`\nPAN-01S hermetic: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
