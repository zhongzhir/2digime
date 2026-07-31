"use strict";

/**
 * MVP-RELEASE-GATE-01E-FIX-04 — start-do availability derivation + packaged contracts.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const appJs = fs.readFileSync(path.join(root, "src/renderer/app.js"), "utf8");
const plannerJs = fs.readFileSync(path.join(root, "src/renderer/deliverable-planner.js"), "utf8");
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

function loadDerive() {
  const start = appJs.indexOf("function deriveStartDoAvailability");
  const end = appJs.indexOf("function renderStartDoAvailability");
  assert.ok(start > 0 && end > start, "deriveStartDoAvailability present");
  const fnSrc = appJs.slice(start, end);
  const sandbox = {};
  vm.runInNewContext(fnSrc + "; this.deriveStartDoAvailability = deriveStartDoAvailability;", sandbox);
  return sandbox.deriveStartDoAvailability;
}

async function main() {
  const derive = loadDerive();

  await test("1) empty goal disables with reason", () => {
    const r = derive({
      goal: "   ",
      workspacePhase: "input",
      startDoBusy: false,
      packageReady: true,
      modelReady: true,
    });
    assert.equal(r.enabled, false);
    assert.equal(r.reasonCode, "no_goal");
    assert.match(r.reasonText, /先描述你希望完成的工作/);
  });

  await test("2) goal only (no materials) enables", () => {
    const r = derive({
      goal: "写一篇公众号文章",
      workspacePhase: "input",
      startDoBusy: false,
      packageReady: true,
      modelReady: true,
    });
    assert.equal(r.enabled, true);
    assert.equal(r.reasonCode, null);
  });

  await test("3) materials are not gates (file/folder/both still enable)", () => {
    // Availability function does not receive materials — product rule encoded by omission.
    assert.ok(!/materialsRequired|requireMaterials|至少一个文件|至少一个文件夹/.test(appJs));
    const r = derive({
      goal: "有材料也可开始",
      workspacePhase: "input",
      startDoBusy: false,
      packageReady: true,
      modelReady: true,
    });
    assert.equal(r.enabled, true);
  });

  await test("4) auto title / fallback / reviewer are not gates", () => {
    assert.ok(appJs.includes("Materials / title / plan / reviewer fallbacks are never hard gates"));
    assert.ok(!/reviewer.*disabled|fallback.*startDo|titleRequired/.test(appJs));
  });

  await test("5) DeepSeek single-model readiness enables when modelReady", () => {
    const r = derive({
      goal: "任务",
      workspacePhase: "input",
      startDoBusy: false,
      packageReady: true,
      modelReady: true,
    });
    assert.equal(r.enabled, true);
    assert.ok(appJs.includes("function isModelReadyForStart"));
    assert.ok(appJs.includes("fr.modelConfigured"));
  });

  await test("6) running disables with 正在进行 label", () => {
    const r = derive({
      goal: "任务",
      workspacePhase: "running",
      startDoBusy: false,
      packageReady: true,
      modelReady: true,
    });
    assert.equal(r.enabled, false);
    assert.equal(r.reasonCode, "running");
    assert.equal(r.buttonLabel, "正在进行");
  });

  await test("7) no package / no model reasons", () => {
    const a = derive({
      goal: "任务",
      workspacePhase: "input",
      packageReady: false,
      modelReady: true,
    });
    assert.equal(a.reasonCode, "no_package");
    assert.match(a.reasonText, /创建或导入/);
    const b = derive({
      goal: "任务",
      workspacePhase: "input",
      packageReady: true,
      modelReady: false,
    });
    assert.equal(b.reasonCode, "no_model");
    assert.match(b.reasonText, /连接模型/);
    assert.equal(b.reasonAction, "connect_model");
  });

  await test("8) single writer: planner no longer disables start button", () => {
    assert.ok(!/startBtn\.disabled\s*=/.test(plannerJs));
    assert.ok(plannerJs.includes("Never write #btn-act-start-do"));
    assert.ok(appJs.includes("function deriveStartDoAvailability"));
    assert.ok(appJs.includes("function renderStartDoAvailability"));
  });

  await test("9) reason element exists; HTML start button not pre-disabled", () => {
    assert.ok(html.includes('id="act-start-do-reason"'));
    assert.ok(!/id="btn-act-start-do"[^>]*\bdisabled\b/.test(html));
  });

  await test("10) refresh hooks after model/package/materials/input", () => {
    assert.ok(appJs.includes('requestEl.addEventListener("input"'));
    assert.ok(appJs.includes('requestEl.addEventListener("paste"'));
    assert.ok(appJs.includes('requestEl.addEventListener("compositionend"'));
    assert.ok(appJs.includes("handleActSelectFiles"));
    assert.match(appJs, /if \(actBehalfState\.taskId\) await persistActReferenceMaterials\(actBehalfState\.taskId\);\s*renderStartDoAvailability\(\);/);
    assert.ok(appJs.includes("saveFirstModelConnectionAndStart"));
    assert.ok(appJs.includes("completeFirstRunSetup"));
  });

  await test("11) click guards prevent double start; FIX-03 rollback retained", () => {
    assert.ok(appJs.includes("if (actBehalfState.startDoBusy || actBehalfState.workspacePhase === \"running\")"));
    assert.ok(appJs.includes("actBehalfState.startDoBusy = true"));
    assert.ok(appJs.includes("actBehalfState.startDoBusy = false"));
    assert.ok(appJs.includes("userFacingStartDoError"));
  });

  await test("12) packaged portable asar contract strings present in source", () => {
    assert.ok(appJs.includes("MVP-RELEASE-GATE-01E-FIX-04"));
    assert.ok(appJs.includes("deriveStartDoAvailability(collectStartDoWorkspaceState())"));
  });

  console.log(`\n01E-FIX-04 results: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
