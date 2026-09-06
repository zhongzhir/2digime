"use strict";
/**
 * P1-CLOSE:模型横幅可见性回归(不启 Electron)。
 * - CSS 必须显式覆盖 .model-gate[hidden]
 * - Renderer 必须用同一派生函数驱动顶部与横幅
 */
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "..");
const css = fs.readFileSync(path.join(root, "electron/renderer/styles.css"), "utf8");
const app = fs.readFileSync(path.join(root, "electron/renderer/app.js"), "utf8");

assert.match(css, /\.model-gate\[hidden\]\s*\{[^}]*display:\s*none\s*!important/s);
assert.match(app, /function deriveModelAvailability\s*\(/);
assert.match(app, /showGate:\s*!available/);
assert.match(app, /els\.modelGate\.style\.display\s*=\s*"none"/);
assert.match(app, /applyConnectionUi\(state\)/);
assert.doesNotMatch(app, /els\.modelGate\.hidden\s*=\s*connected/);

/** 与 Renderer 同语义的派生,四种状态断言 */
function isMainChatModelCapability(c) {
  if (!c) return false;
  if (c.id === "cap_model_openai_compatible") return true;
  if (c.kind === "model") return true;
  const adapter = c.adapter || {};
  return adapter.type === "openai-compatible-model" || adapter.adapterId === "openai-compatible-chat";
}

function deriveModelAvailability(capabilities) {
  const list = Array.isArray(capabilities) ? capabilities : [];
  const modelCaps = list.filter(isMainChatModelCapability);
  const available = modelCaps.some((c) => c.availability === "available");
  const needsSetup = modelCaps.some((c) => c.availability === "needs_setup");
  return {
    available,
    needsSetup: !available && needsSetup,
    showGate: !available,
  };
}

const none = deriveModelAvailability([]);
assert.equal(none.available, false);
assert.equal(none.showGate, true);

const needsSetup = deriveModelAvailability([
  {
    id: "cap_model_openai_compatible",
    kind: "model",
    availability: "needs_setup",
    outputArtifactTypes: ["document"],
  },
]);
assert.equal(needsSetup.available, false);
assert.equal(needsSetup.showGate, true);
assert.equal(needsSetup.needsSetup, true);

const searchOnly = deriveModelAvailability([
  {
    id: "cap_gemini_web_search",
    kind: "tool",
    availability: "available",
    outputArtifactTypes: ["document"],
  },
]);
assert.equal(searchOnly.available, false);
assert.equal(searchOnly.showGate, true);

const available = deriveModelAvailability([
  {
    id: "cap_model_openai_compatible",
    kind: "model",
    availability: "available",
    outputArtifactTypes: ["document"],
  },
]);
assert.equal(available.available, true);
assert.equal(available.showGate, false);

const unavailable = deriveModelAvailability([
  {
    id: "cap_model_openai_compatible",
    kind: "model",
    availability: "unavailable",
    outputArtifactTypes: ["document"],
  },
]);
assert.equal(unavailable.available, false);
assert.equal(unavailable.showGate, true);

console.log(JSON.stringify({ ok: true, cases: ["none", "needs_setup", "available", "unavailable"] }));
