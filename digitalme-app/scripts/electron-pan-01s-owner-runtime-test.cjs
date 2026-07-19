"use strict";

/**
 * PAN-01S Owner runtime Electron probe.
 * Run: npm run test:pan-01s-owner-runtime
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (!process.versions.electron) {
  console.error("FAIL: must run under Electron (npm run test:pan-01s-owner-runtime)");
  process.exit(1);
}

process.env.DIGITALME_OWNER_RUNTIME_TEST = "1";
process.env.DIGITALME_PAN01S_OWNER_RUNTIME = "1";

const { app } = require("electron");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dm-pan01s-owner-runtime-"));
app.setPath("userData", userData);

process.on("exit", () => {
  try {
    fs.rmSync(userData, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

require("../src/main.js");
