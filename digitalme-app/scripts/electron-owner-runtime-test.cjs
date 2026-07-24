"use strict";

/**
 * Real Electron window Owner-runtime probe.
 *
 * Run: npm run test:owner-runtime
 *   or: npx electron scripts/electron-owner-runtime-test.cjs
 *
 * Loads the same main/preload/renderer as `npm start`, then drives the window.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (!process.versions.electron) {
  console.error("FAIL: must run under Electron (npm run test:owner-runtime)");
  process.exit(1);
}

process.env.DIGITALME_OWNER_RUNTIME_TEST = "1";
process.env.DIGITALME_ACT_BEHALF_FAKE = "1";

const { app } = require("electron");
const toolBroker = require("../src/tool-broker");
const agentsLib = require("../src/orchestration/agents");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dm-owner-runtime-"));
app.setPath("userData", userData);

const work = path.join(userData, "workdir");
fs.mkdirSync(work, { recursive: true });
const sleepJs = path.join(work, "sleep-long.js");
fs.writeFileSync(sleepJs, "setTimeout(() => {}, 120000);\n", "utf8");

const nodeExec =
  process.env.npm_node_execpath ||
  process.env.NODE_BINARY ||
  (process.platform === "win32" ? "node.exe" : "node");

const saved = toolBroker.saveNarrowSettings(userData, {
  executable: nodeExec,
  authorizedCwdRoot: work,
  enabled: true,
  timeoutMs: 45000,
});
if (!saved.ok) {
  console.error("FAIL: cannot prepare CLI executor", saved.reasonCodes || saved);
  process.exit(1);
}
agentsLib.setActiveAgent(userData, "cli-coder");

// Persist fixture paths for harness
fs.writeFileSync(
  path.join(userData, "owner-runtime-fixture.json"),
  JSON.stringify({ sleepJs, work, nodeExec }, null, 2),
  "utf8"
);

process.on("exit", () => {
  try {
    fs.rmSync(userData, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

// Hand off to application main (registers whenReady + window + harness).
require("../src/main.js");
