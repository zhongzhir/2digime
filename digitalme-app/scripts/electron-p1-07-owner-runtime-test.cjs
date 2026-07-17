"use strict";

/**
 * P1-07 Owner runtime Electron probe.
 * Run: npm run test:p1-07-owner-runtime
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (!process.versions.electron) {
  console.error("FAIL: must run under Electron (npm run test:p1-07-owner-runtime)");
  process.exit(1);
}

process.env.DIGITALME_OWNER_RUNTIME_TEST = "1";
process.env.DIGITALME_P107_OWNER_RUNTIME = "1";

const { app } = require("electron");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dm-p107-owner-runtime-"));
app.setPath("userData", userData);

process.on("exit", () => {
  try {
    fs.rmSync(userData, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

require("../src/main.js");
