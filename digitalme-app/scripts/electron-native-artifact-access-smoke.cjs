"use strict";

/**
 * ARTIFACT-ACCESS-MIN-01 — Owner-userData smoke for native selection → open/reveal.
 * This proves main secure path with real packages; it does NOT replace
 * developer File-menu acceptance in `npm start`.
 *
 * Run: npx electron scripts/electron-native-artifact-access-smoke.cjs
 */

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

if (!process.versions.electron) {
  console.error("FAIL: run under Electron");
  process.exit(1);
}

const OWNER_USERDATA =
  process.env.DIGITALME_OWNER_USERDATA ||
  path.join(process.env.APPDATA || "", "digitalme-app");

const OWNER_TASK = {
  packageId: "delivery_ms5k9963_57dea4cf",
  taskId: "abt_ms5k8vpk_fd0a2b",
};

const { app } = require("electron");
const openMod = require(path.join(__dirname, "..", "src", "act-behalf", "deliverable-artifact-open"));

app.disableHardwareAcceleration?.();
const sessionUd = fs.mkdtempSync(path.join(os.tmpdir(), "dm-access-min-session-"));
app.setPath("userData", sessionUd);

async function run() {
  await app.whenReady();
  const { shell } = require("electron");
  const selection = { taskId: OWNER_TASK.taskId, packageId: OWNER_TASK.packageId };
  const resolved = openMod.resolvePrimaryForSelection(OWNER_USERDATA, selection);
  console.log("RESOLVE", {
    ok: !!(resolved && resolved.ok),
    code: resolved && resolved.code,
    artifactId: resolved && resolved.artifact && resolved.artifact.id,
    deliverableId: resolved && resolved.deliverable && resolved.deliverable.id,
  });
  if (!resolved || !resolved.ok) {
    app.exit(1);
    return;
  }
  const openRes = await openMod.openPrimaryForSelection({
    userData: OWNER_USERDATA,
    selection,
    shell,
  });
  console.log("OPEN", { ok: !!openRes.ok, code: openRes.code });
  const rev = openMod.revealPrimaryForSelection({
    userData: OWNER_USERDATA,
    selection,
    shell,
  });
  console.log("REVEAL", { ok: !!rev.ok, code: rev.code });
  const ok = !!(openRes && openRes.ok && rev && rev.ok);
  try {
    fs.rmSync(sessionUd, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  app.exit(ok ? 0 : 1);
}

run().catch((err) => {
  console.error(err);
  app.exit(1);
});
