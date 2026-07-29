"use strict";

/**
 * GLOBAL-RENDERER-RESPONSIVENESS-01 — automated performance / listener guards.
 *
 * Covers:
 * - package/task/plan store loadStore cache (no re-parse of multi-MB JSON)
 * - compact persist (no pretty-print of multi-MB stores)
 * - wireActBehalfUi / bindEvents idempotency in source
 * - generation panel refresh throttle in source
 * - no sticky "已打开草稿任务。" success copy
 * - no document-level capture listener for artifact open (paused FIX-01C)
 *
 * Run: npm run test:global-renderer-responsiveness-01
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");

function fromAppRoot(...parts) {
  return path.resolve(ROOT, ...parts);
}

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name);
    console.error(err && err.stack ? err.stack : err);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name);
    console.error(err && err.stack ? err.stack : err);
  }
}

async function main() {
  const packageStore = require(fromAppRoot("src", "act-behalf", "deliverable-package-store"));
  const taskStore = require(fromAppRoot("src", "act-behalf", "task-store"));
  const planStore = require(fromAppRoot("src", "act-behalf", "deliverable-plan-store"));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dm-resp-"));
  try {
    // Seed a multi-MB-ish package store (still fast enough for CI).
    const bigText = "x".repeat(80 * 1024);
    await packageStore.mutateStore(tmp, (s) => {
      for (let i = 0; i < 40; i += 1) {
        const pid = "delivery_perf_" + i;
        const did = "deliverable_perf_" + i;
        const vid = "dver_perf_" + i;
        const aid = "aref_perf_" + i;
        s.packages[pid] = {
          id: pid,
          taskId: "abt_perf",
          deliverableIds: [did],
          softDeletedAt: null,
          note: bigText,
        };
        s.deliverables[did] = {
          id: did,
          packageId: pid,
          kind: "document",
          generationStatus: "ready",
          currentVersionId: vid,
          versionIds: [vid],
          planDisposition: "included",
        };
        s.versions[vid] = {
          id: vid,
          deliverableId: did,
          packageId: pid,
          artifactRef: { id: aid, format: "md" },
          artifactRefs: [{ id: aid, format: "md" }],
          body: bigText,
        };
        s.artifacts[aid] = {
          id: aid,
          versionId: vid,
          relativePath: "deliverable-artifacts/" + pid + "/" + did + "/" + vid + "/artifact.md",
          format: "md",
          mimeType: "text/markdown",
          byteSize: 12,
          contentHash: "deadbeef",
        };
      }
      return true;
    });

    const storePath = packageStore.storePath(tmp);
    const sizeKb = Math.round(fs.statSync(storePath).size / 1024);
    test("seeded package store is large enough to expose sync cost (" + sizeKb + " KB)", () => {
      assert.ok(sizeKb >= 200, "expected >=200KB got " + sizeKb);
    });

    test("persist uses compact JSON (no pretty-print indent)", () => {
      const raw = fs.readFileSync(storePath, "utf8");
      assert.ok(!raw.includes("\n  \"schemaVersion\""), "pretty-printed indent must not be used");
      assert.ok(raw.includes('"schemaVersion"'));
    });

    packageStore.invalidateStoreCache();
    const t0 = process.hrtime.bigint();
    packageStore.loadStore(tmp);
    const coldMs = Number(process.hrtime.bigint() - t0) / 1e6;

    const samples = [];
    for (let i = 0; i < 20; i += 1) {
      const a = process.hrtime.bigint();
      packageStore.loadStore(tmp);
      samples.push(Number(process.hrtime.bigint() - a) / 1e6);
    }
    samples.sort((x, y) => x - y);
    const warmP95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))];

    test("warm loadStore is cached and far cheaper than cold parse", () => {
      assert.ok(coldMs > 0);
      assert.ok(warmP95 < Math.max(5, coldMs * 0.25), {
        coldMs,
        warmP95,
      });
      assert.ok(warmP95 < 5, "warm cache hit should be <5ms, got " + warmP95);
    });

    await testAsync("mutateStore then loadStore stays warm without re-parse thrash", async () => {
      await packageStore.mutateStore(tmp, (s) => {
        s.packages.delivery_perf_0.touch = Date.now();
        return true;
      });
      const a = process.hrtime.bigint();
      for (let i = 0; i < 10; i += 1) packageStore.loadStore(tmp);
      const avg = Number(process.hrtime.bigint() - a) / 1e6 / 10;
      assert.ok(avg < 5, "post-mutate warm avg " + avg);
    });

    await testAsync("task-store cache + compact persist", async () => {
      taskStore.invalidateStoreCache();
      await taskStore.saveTask(tmp, {
        taskId: undefined,
        title: "perf",
        goal: "g",
      });
      const p = taskStore.storePath(tmp);
      const raw = fs.readFileSync(p, "utf8");
      assert.ok(!raw.includes("\n  \"version\""));
      const cold = process.hrtime.bigint();
      taskStore.invalidateStoreCache();
      taskStore.loadStore(tmp);
      const coldMs2 = Number(process.hrtime.bigint() - cold) / 1e6;
      const warm = process.hrtime.bigint();
      taskStore.loadStore(tmp);
      const warmMs = Number(process.hrtime.bigint() - warm) / 1e6;
      assert.ok(warmMs < Math.max(2, coldMs2), { coldMs2, warmMs });
    });

    await testAsync("plan-store cache + compact persist", async () => {
      planStore.invalidateStoreCache();
      // Write via mutate path used by savePlanRecord if available; else direct persist.
      const store = planStore.emptyStore();
      store.plans.plan_perf = { id: "plan_perf", taskId: "abt_perf", versions: {} };
      await planStore.persistStoreAtomic(tmp, store);
      const raw = fs.readFileSync(planStore.storePath(tmp), "utf8");
      assert.ok(!raw.includes("\n  \"version\""));
      planStore.invalidateStoreCache();
      planStore.loadStore(tmp);
      const a = process.hrtime.bigint();
      planStore.loadStore(tmp);
      const warmMs = Number(process.hrtime.bigint() - a) / 1e6;
      assert.ok(warmMs < 5, warmMs);
    });
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  test("wireActBehalfUi is idempotent (source contract)", () => {
    const src = fs.readFileSync(fromAppRoot("src", "renderer", "app.js"), "utf8");
    assert.ok(src.includes("dmActBehalfUiBound"));
    assert.ok(src.includes("wireActBehalfUiSkipped"));
    assert.ok(src.includes("dmEventsBound"));
    assert.ok(src.includes("dmActTaskOverflowDelegate"));
    assert.ok(src.includes("genItems.dataset.wired") || src.includes('genItems.dataset.wired = "1"'));
  });

  test("generation panel refresh is throttled for IPC pushes", () => {
    const src = fs.readFileSync(fromAppRoot("src", "renderer", "app.js"), "utf8");
    assert.ok(src.includes("scheduleThrottledGenerationPanelRefresh"));
    assert.ok(src.includes("enhancementRefreshScheduled"));
    assert.ok(src.includes('scheduleThrottledGenerationPanelRefresh(packageId, "enhancement")'));
    assert.ok(src.includes('scheduleThrottledGenerationPanelRefresh(packageId, "baseline")'));
    // Direct await refresh on enhancement push must be gone.
    const enhIdx = src.indexOf("onActBehalfEnhancementSettled");
    assert.ok(enhIdx > 0);
    const enhBlock = src.slice(enhIdx, enhIdx + 350);
    assert.ok(enhBlock.includes("scheduleThrottledGenerationPanelRefresh"));
    assert.ok(!enhBlock.includes("await refreshActGenerationPanel"));
  });

  test("artifact open uses card-local feedback and does not sticky-write bottom progress", () => {
    const src = fs.readFileSync(fromAppRoot("src", "renderer", "app.js"), "utf8");
    assert.ok(src.includes("showArtifactOpenErrorNearButton") || src.includes("bindArtifactOpenRootOnce"));
    assert.ok(src.includes('btn.textContent = "正在打开…"'));
    assert.ok(src.includes("handleArtifactOpenAtRootCapture"));
    assert.ok(!src.includes('setActProgress("已打开草稿任务。")'));
    assert.ok(!src.includes('setActProgress("已打开成果")'));
  });

  test("no FIX-01C document capture listener / no per-button open bind", () => {
    const src = fs.readFileSync(fromAppRoot("src", "renderer", "app.js"), "utf8");
    assert.ok(!src.includes("handleDeliverableArtifactClickCapture"));
    assert.ok(!src.includes("wireDeliverableArtifactCaptureOnce"));
    assert.ok(!src.includes("bindArtifactOpenButtons"));
    assert.ok(!src.includes("handleArtifactOpenButtonClick"));
    assert.ok(src.includes("bindArtifactOpenRootOnce"));
    assert.ok(src.includes('addEventListener("click", handleArtifactOpenAtRootCapture, true)'));
  });

  test("production default does not spam large console traces for open path", () => {
    const src = fs.readFileSync(fromAppRoot("src", "renderer", "app.js"), "utf8");
    assert.ok(!src.includes('console.info("[artifact-open-ui]"'));
    assert.ok(!/console\.(log|info|debug)\([^\n]*deliverable-packages/.test(src));
  });

  console.log(JSON.stringify({ passed, failed }, null, 2));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
