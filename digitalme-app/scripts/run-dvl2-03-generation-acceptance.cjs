"use strict";

/**
 * Two-phase Electron acceptance for DVL2-03 real deliverable generation (mock model).
 */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const electronBin = require("electron");
const root = path.resolve(__dirname, "..");
const entry = path.join(__dirname, "electron-dvl2-03-generation-acceptance.cjs");
const outputDir = path.resolve(__dirname, "..", "..", ".codex-qa", "dvl2-03-generation-acceptance");
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-dvl2-03-accept-"));
const userData = path.join(workDir, "userData");
const markerPath = path.join(workDir, "phase-a-marker.json");

fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

function runPhase(phase) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      DIGITALME_OWNER_RUNTIME_TEST: "1",
      DIGITALME_DVL2_03_GENERATION_ACCEPTANCE: "1",
      DIGITALME_DVL2_03_ACCEPT_PHASE: phase,
      DIGITALME_DVL2_03_USER_DATA: userData,
      DIGITALME_DVL2_03_MARKER: markerPath,
      DIGITALME_DVL2_03_OUTPUT: outputDir,
      DIGITALME_DVL2_03_MOCK_MODEL: "1",
      DIGITALME_DVL2_03_MOCK_IMAGE: "1",
      DIGITALME_PLANNER_FORCE_RULE: "1",
      DIGITALME_ACT_BEHALF_FAKE: "1",
    };
    const child = spawn(electronBin, [entry], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stdout.on("data", (d) => process.stdout.write(d));
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      process.stderr.write(d);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("phase " + phase + " exited " + code + "\n" + stderr));
    });
  });
}

async function main() {
  try {
    console.log("DVL2-03 acceptance workDir=", workDir);
    await runPhase("A");
    if (!fs.existsSync(markerPath)) throw new Error("phase A missing marker");
    await runPhase("B");
    const summary = {
      pass: true,
      workDir,
      userData,
      marker: JSON.parse(fs.readFileSync(markerPath, "utf8")),
      outputDir,
      noRealModel: true,
      noPaidQuota: true,
      mockImage: true,
    };
    fs.writeFileSync(path.join(outputDir, "two-phase-summary.json"), JSON.stringify(summary, null, 2));
    console.log("PASS dvl2-03 two-phase acceptance");
    console.log("summary=", path.join(outputDir, "two-phase-summary.json"));
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error(err);
  try {
    fs.rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  process.exit(1);
});
