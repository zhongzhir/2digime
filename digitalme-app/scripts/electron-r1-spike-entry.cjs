"use strict";

/**
 * Playwright Electron bootstrap for R1 spike.
 * Sets isolated userData + hermetic Package path before app ready.
 * Never touches real digital-me-package / sessions / userData.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createHermeticPackageFixture,
  cleanupHermeticPackageFixture,
} = require("./hermetic-package-fixture.cjs");

if (!process.versions.electron) {
  console.error("FAIL: must run under Electron");
  process.exit(1);
}

const { app } = require("electron");

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dm-r1-spike-"));
app.setPath("userData", userData);

const fixture = createHermeticPackageFixture("r1-spike");
fs.writeFileSync(
  path.join(userData, "config.json"),
  JSON.stringify(
    {
      packageDir: fixture.packageDir,
      modelProvider: "",
      modelName: "",
      modelBaseUrl: "",
    },
    null,
    2
  ),
  "utf8"
);

process.on("exit", () => {
  try {
    cleanupHermeticPackageFixture(fixture.packageDir);
  } catch {
    /* ignore */
  }
  try {
    fs.rmSync(userData, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

require("../src/main.js");
