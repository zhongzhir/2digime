"use strict";

/**
 * IDCOLLAB-MIN-01.1 UI minimal surface contracts (static source checks).
 */

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const plannerSrc = fs.readFileSync(
  path.join(__dirname, "../src/renderer/deliverable-planner.js"),
  "utf8"
);

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

function main() {
  test("default generation panel avoids internal identity jargon", () => {
    const genFn = plannerSrc.slice(
      plannerSrc.indexOf("function renderGenerationPanel"),
      plannerSrc.indexOf("function escapeAttr")
    );
    assert.ok(!genFn.includes("代表主体"), "must not show 代表主体 on default surface");
    assert.ok(!genFn.includes("行动主体"), "must not show 行动主体 on default surface");
    assert.ok(!genFn.includes("授权范围"), "must not show 授权范围 on default surface");
    assert.ok(!genFn.includes("高级：身份与授权"), "must not show old identity block title");
    assert.ok(genFn.includes("由你的 Digital Me 生成，成果归你所有"), "must keep one-line summary");
    assert.ok(genFn.includes('data-testid="act-gen-details"'), "must have details entry");
    assert.ok(genFn.includes('data-testid="act-gen-audit"'), "must have advanced audit fold");
  });

  test("plan editor hides advanced fields behind more settings", () => {
    const itemFn = plannerSrc.slice(
      plannerSrc.indexOf("function renderItemRow"),
      plannerSrc.indexOf("function bindItemControls")
    );
    assert.ok(itemFn.includes('data-testid="act-plan-item-more"'), "item more settings fold");
    assert.ok(!itemFn.includes("依赖项 ID"), "must not expose dependency id label");
    assert.ok(itemFn.includes("更多设置"), "must label more settings");
    const uFn = plannerSrc.slice(
      plannerSrc.indexOf("function renderUnderstanding"),
      plannerSrc.indexOf("function renderItemRow")
    );
    assert.ok(uFn.includes('data-testid="act-plan-more-settings"'), "plan more settings fold");
  });

  test("revoked state disables regenerate in panel markup", () => {
    assert.ok(plannerSrc.includes("canGenerate"), "panel reads canGenerate");
    assert.ok(plannerSrc.includes('disabled title="本次授权已撤销"'), "regen disabled when revoked");
    assert.ok(plannerSrc.includes("act-auth-revoked-banner"), "revoked banner present");
  });

  console.log(`\nIDCOLLAB-MIN-01.1 UI minimal: ${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
}

main();
