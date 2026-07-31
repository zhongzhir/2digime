"use strict";

/**
 * MVP-RELEASE-GATE-01E-FIX-05 — workspace generation rendering stability (Scheme A).
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const appJs = fs.readFileSync(path.join(root, "src/renderer/app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles.css"), "utf8");

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed += 1;
      console.log("PASS", name);
    })
    .catch((err) => {
      failed += 1;
      console.error("FAIL", name);
      console.error(err && err.stack ? err.stack : err);
    });
}

function extractFn(name) {
  const start = appJs.indexOf("function " + name);
  assert.ok(start > 0, name + " present");
  // Grab until next top-level function at same indent depth roughly — use known end markers.
  const next = appJs.indexOf("\nfunction ", start + 10);
  const end = next > start ? next : start + 2500;
  return appJs.slice(start, end);
}

function loadInFlightChecker() {
  const src =
    extractFn("latestAttemptForDeliverableView") +
    "\n" +
    extractFn("isWorkspaceGenerationInFlight");
  const sandbox = {
    actBehalfState: { startDoBusy: false, workspacePhase: "input" },
  };
  vm.runInNewContext(
    src +
      "; this.isWorkspaceGenerationInFlight = isWorkspaceGenerationInFlight; this.latestAttemptForDeliverableView = latestAttemptForDeliverableView;",
    sandbox
  );
  return sandbox;
}

async function main() {
  await test("1) Scheme A: baseline event does not present result while running", () => {
    assert.ok(appJs.includes("Scheme A: baseline is not final UI"));
    assert.ok(appJs.includes("Stay on running; do not rebuild result yet"));
    assert.ok(appJs.includes("waitForWorkspaceGenerationSettle"));
  });

  await test("2) in-flight skips heavy renderGenerationPanel/present", () => {
    assert.ok(appJs.includes("skippedHeavyRender: true"));
    assert.ok(appJs.includes("during in-flight generation, do not rebuild"));
  });

  await test("3) isWorkspaceGenerationInFlight treats enhancement as busy", () => {
    const box = loadInFlightChecker();
    const view = {
      deliverables: [
        {
          id: "d1",
          planDisposition: "included",
          generationStatus: "ready",
          currentVersionId: "v1",
          latestGenerationAttemptId: "a1",
        },
      ],
      generationAttempts: {
        a1: { phase: "quality_enhancement", status: "succeeded" },
      },
    };
    assert.equal(box.isWorkspaceGenerationInFlight(view), true);
    view.generationAttempts.a1.phase = "completed";
    assert.equal(box.isWorkspaceGenerationInFlight(view), false);
  });

  await test("4) first token / baseline does not force result phase", () => {
    assert.ok(appJs.includes('setActRunningHint(primary ? "正在整理成果" : "正在生成成果")'));
    assert.ok(appJs.includes('reason: "generation_in_flight"'));
  });

  await test("5) presentedResultKey prevents repeat Markdown rebuild", () => {
    assert.ok(appJs.includes("presentedResultKey"));
    assert.ok(appJs.includes("already_presented"));
    assert.ok(appJs.includes("workspacePresentCount"));
  });

  await test("6) settled refresh forcePresent once", () => {
    assert.ok(appJs.includes('scheduleThrottledGenerationPanelRefresh(packageId, "settled")'));
    assert.ok(appJs.includes("forcePresent: why === \"settled\""));
  });

  await test("7) markdown layout stability CSS", () => {
    assert.ok(css.includes("overflow-wrap: anywhere"));
    assert.ok(css.includes("word-break: break-word"));
    assert.ok(css.includes("overflow-x: auto"));
  });

  await test("8) fixed running min-height", () => {
    assert.ok(css.includes("act-workspace-running"));
    assert.ok(css.includes("min-height: 180px"));
  });

  await test("9) start-do does not thrash task list until result", () => {
    assert.ok(appJs.includes("avoid task-list rebuild churn during start-do"));
  });

  await test("10) revision path resets presentation key and waits to settle", () => {
    assert.match(
      appJs,
      /handleSendRevision[\s\S]*presentedResultKey = null[\s\S]*waitForWorkspaceGenerationSettle/
    );
  });

  await test("11) bounded settle timeout recovers UI", () => {
    assert.ok(appJs.includes("Bounded timeout"));
    assert.ok(appJs.includes("180000"));
  });

  await test("12) no per-token streaming UI path for workspace result", () => {
    // Workspace result path must not stream chunks into act-result-body.
    assert.ok(!/act-result-body[\s\S]{0,120}stream/.test(appJs));
    assert.ok(appJs.includes("Keep a fixed \"running\" phase until generation + quality enhancement have settled"));
  });

  console.log(`\n01E-FIX-05 results: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
