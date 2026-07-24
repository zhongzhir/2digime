"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.DIGITALME_OWNER_RUNTIME_TEST = "1";
process.env.DIGITALME_DOING_CONTEXT_ACCEPTANCE = "1";
process.env.DIGITALME_ACT_BEHALF_FAKE = "1";
const { app } = require("electron");
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "dm-doing-context-ui-")));
process.env.DIGITALME_DOING_CONTEXT_OUTPUT = path.resolve(__dirname, "..", "..", ".codex-qa", "doing-context");
require("../src/main.js");
