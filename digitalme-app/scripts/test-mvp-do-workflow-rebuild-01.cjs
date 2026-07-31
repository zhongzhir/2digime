"use strict";

/**
 * MVP-DO-WORKFLOW-REBUILD-01 — single runtime state + render path contracts.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const doJs = fs.readFileSync(path.join(root, "src/renderer/do-workspace.js"), "utf8");
const appJs = fs.readFileSync(path.join(root, "src/renderer/app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "src/renderer/index.html"), "utf8");

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

function loadDoWorkspace() {
  const sandbox = { window: {}, console };
  sandbox.window = sandbox;
  vm.runInNewContext(doJs, sandbox);
  return sandbox.DoWorkspace || sandbox.window.DoWorkspace;
}

async function main() {
  const DW = loadDoWorkspace();

  await test("1) derive phases: draft/ready/running/result/accepted", () => {
    const draft = DW.deriveDoWorkspaceViewModel({
      goal: "",
      packageReady: true,
      modelReady: true,
      materials: [],
    });
    assert.equal(draft.phase, "draft");
    assert.equal(draft.start.enabled, false);

    const ready = DW.deriveDoWorkspaceViewModel({
      goal: "写一篇文章",
      packageReady: true,
      modelReady: true,
      materials: [],
    });
    assert.equal(ready.phase, "ready");
    assert.equal(ready.start.enabled, true);

    DW.setRuntime({ busy: true, phaseHint: "running" });
    const running = DW.deriveDoWorkspaceViewModel({
      goal: "写一篇文章",
      packageReady: true,
      modelReady: true,
    });
    assert.equal(running.phase, "running");
    assert.equal(running.start.label, "正在进行");
    DW.resetRuntimePresentation();
  });

  await test("2) materials never gate start", () => {
    const vm = DW.deriveDoWorkspaceViewModel({
      goal: "任务",
      packageReady: true,
      modelReady: true,
      materials: [],
    });
    assert.equal(vm.start.enabled, true);
  });

  await test("3) enhancement in-flight keeps generation busy", () => {
    assert.equal(
      DW.isGenerationInFlight({
        deliverables: [
          {
            planDisposition: "included",
            generationStatus: "ready",
            currentVersionId: "v1",
            latestGenerationAttemptId: "a1",
          },
        ],
        generationAttempts: { a1: { phase: "quality_enhancement" } },
      }),
      true
    );
  });

  await test("4) app wires canonical verbs startDo/revise/accept", () => {
    assert.ok(appJs.includes("window.startDo = handleStartDoWork"));
    assert.ok(appJs.includes("window.reviseCurrentResult = handleSendRevision"));
    assert.ok(appJs.includes("window.acceptCurrentResult = handleAcceptWorkspaceResult"));
    assert.ok(appJs.includes("renderDoWorkspaceNow"));
  });

  await test("5) single render path used by availability + phase", () => {
    assert.ok(appJs.includes("MVP-DO-WORKFLOW-REBUILD-01: phase changes go through the single render path"));
    assert.ok(appJs.includes("DoWorkspace owns button/phase/reason visibility"));
  });

  await test("6) formal UI copy: 你希望完成什么 / 任务材料", () => {
    assert.ok(html.includes("你希望完成什么？"));
    assert.ok(html.includes("任务材料"));
    assert.ok(!html.includes("手动确认上下文（高级）"));
    assert.ok(html.includes("do-workspace.js"));
  });

  await test("7) legacy plan panel is backend-only / hidden", () => {
    assert.ok(html.includes("Backend-only hooks"));
    assert.ok(html.includes('aria-hidden="true"'));
    assert.ok(appJs.includes("Legacy planner panels must never control") || doJs.includes("never control the formal surface"));
  });

  await test("8) no new Store / IPC invented for rebuild", () => {
    assert.ok(!appJs.includes("DoWorkspaceStore"));
    assert.ok(!doJs.includes("ipcRenderer"));
    assert.ok(appJs.includes("actBehalfConfirmPlanAndGenerate"));
  });

  console.log(`\nDO-WORKFLOW-REBUILD-01 results: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
