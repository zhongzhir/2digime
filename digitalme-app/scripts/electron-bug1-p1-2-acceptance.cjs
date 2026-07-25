"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
if (!process.versions.electron) throw new Error("Run with Electron");
process.env.DIGITALME_OWNER_RUNTIME_TEST = "1";
process.env.DIGITALME_BUG1_P1_2 = "1";
const { app } = require("electron");
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "dm-bug1-p1-2-")));
process.env.DIGITALME_VISUAL_OUTPUT = path.resolve(
  __dirname,
  "..",
  "..",
  ".codex-qa",
  "bug1-fix",
  "p1-2-identity"
);
require("../src/main.js");
