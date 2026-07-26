"use strict";

const fs = require("node:fs");
const path = require("node:path");

if (!process.versions.electron) {
  throw new Error("Run via npm run test:dvl2-03-generation-acceptance");
}

process.env.DIGITALME_OWNER_RUNTIME_TEST = "1";
process.env.DIGITALME_DVL2_03_GENERATION_ACCEPTANCE = "1";
process.env.DIGITALME_DVL2_03_MOCK_MODEL = "1";
process.env.DIGITALME_DVL2_03_MOCK_IMAGE = "1";
process.env.DIGITALME_PLANNER_FORCE_RULE = "1";
process.env.DIGITALME_ACT_BEHALF_FAKE = "1";

const { app } = require("electron");
const userData = process.env.DIGITALME_DVL2_03_USER_DATA;
if (!userData) throw new Error("DIGITALME_DVL2_03_USER_DATA required");
fs.mkdirSync(userData, { recursive: true });
app.setPath("userData", userData);

if (!process.env.DIGITALME_DVL2_03_OUTPUT) {
  process.env.DIGITALME_DVL2_03_OUTPUT = path.resolve(
    __dirname,
    "..",
    "..",
    ".codex-qa",
    "dvl2-03-generation-acceptance"
  );
}

require("../src/main.js");
