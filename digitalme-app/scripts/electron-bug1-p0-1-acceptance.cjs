"use strict";

/**
 * BUG1-P0-1: window layout — input always visible; stamp/boot-log never cover composer.
 * Temp userData only. Output: .codex-qa/bug1-fix/p0-1-window-acceptance/
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

if (!process.versions.electron) throw new Error("Run with Electron");

process.env.DIGITALME_OWNER_RUNTIME_TEST = "1";
process.env.DIGITALME_BUG1_P0_1 = "1";

const { app } = require("electron");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dm-bug1-p0-1-"));
app.setPath("userData", userData);
process.env.DIGITALME_VISUAL_OUTPUT = path.resolve(
  __dirname,
  "..",
  "..",
  ".codex-qa",
  "bug1-fix",
  "p0-1-window-acceptance"
);

require("../src/main.js");
