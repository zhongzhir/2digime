"use strict";

/** Launch owner-mode artifact open acceptance with env set (no cross-env dependency). */
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const electronPath = require("electron");
process.env.DIGITALME_OPEN_OWNER_ACCEPTANCE = "1";
if (!process.env.DIGITALME_OPEN_ACCEPTANCE_OUT) {
  process.env.DIGITALME_OPEN_ACCEPTANCE_OUT = path.join(
    require("node:os").tmpdir(),
    "dm-artifact-open-owner-acceptance-result.json"
  );
}

const script = path.join(__dirname, "electron-artifact-open-acceptance.cjs");
const r = spawnSync(electronPath, [script], {
  stdio: "inherit",
  env: process.env,
  windowsHide: true,
});
process.exit(r.status == null ? 1 : r.status);
