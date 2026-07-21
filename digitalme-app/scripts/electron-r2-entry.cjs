"use strict";

/**
 * Playwright Electron bootstrap for R2 chat/sessions.
 * Hermetic userData + Package only. Enables fake model seam.
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

const reuseUserData = process.env.DIGITALME_R2_USER_DATA
  ? String(process.env.DIGITALME_R2_USER_DATA)
  : null;
const userData = reuseUserData || fs.mkdtempSync(path.join(os.tmpdir(), "dm-r2-e2e-"));
if (reuseUserData && !fs.existsSync(userData)) {
  fs.mkdirSync(userData, { recursive: true });
}
app.setPath("userData", userData);

const fixture = createHermeticPackageFixture("r2-e2e");
const cfgPath = path.join(userData, "config.json");
if (!fs.existsSync(cfgPath)) {
  fs.writeFileSync(
    cfgPath,
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
}

process.env.DIGITALME_R1_SPIKE_HARNESS = "1";
process.env.DIGITALME_R2_FAKE_MODEL = "1";

process.on("exit", () => {
  try {
    cleanupHermeticPackageFixture(fixture.packageDir);
  } catch {
    /* ignore */
  }
  // Keep reused userData for multi-launch restart tests; only wipe ephemeral dirs.
  if (!reuseUserData) {
    try {
      fs.rmSync(userData, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

require("../src/main.js");
