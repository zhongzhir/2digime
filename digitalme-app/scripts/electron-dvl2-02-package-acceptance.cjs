"use strict";

/**
 * Electron entry for DVL2-02 package acceptance.
 * Driven by DIGITALME_DVL2_02_ACCEPT_PHASE=A|B and isolated userData.
 */

const fs = require("node:fs");
const path = require("node:path");

if (!process.versions.electron) {
  throw new Error("Run via npm run test:dvl2-02-package-acceptance (orchestrator)");
}

process.env.DIGITALME_OWNER_RUNTIME_TEST = "1";
process.env.DIGITALME_DVL2_02_PACKAGE_ACCEPTANCE = "1";
process.env.DIGITALME_PLANNER_FORCE_RULE = "1";
process.env.DIGITALME_ACT_BEHALF_FAKE = "1";

const { app } = require("electron");
const userData = process.env.DIGITALME_DVL2_02_USER_DATA;
if (!userData) {
  throw new Error("DIGITALME_DVL2_02_USER_DATA required for acceptance");
}
fs.mkdirSync(userData, { recursive: true });
app.setPath("userData", userData);

if (!process.env.DIGITALME_DVL2_02_OUTPUT) {
  process.env.DIGITALME_DVL2_02_OUTPUT = path.resolve(
    __dirname,
    "..",
    "..",
    ".codex-qa",
    "dvl2-02-package-acceptance"
  );
}

require("../src/main.js");
