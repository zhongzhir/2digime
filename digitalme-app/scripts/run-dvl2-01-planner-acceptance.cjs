"use strict";

/**
 * Two-phase Electron acceptance orchestrator for DVL2-01.
 * Phase A: create plan in isolated userData, exit cleanly.
 * Phase B: new process, same userData, verify restore.
 * No real model / secrets.
 */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const electronBin = require("electron");
const root = path.resolve(__dirname, "..");
const entry = path.join(__dirname, "electron-dvl2-01-planner-acceptance.cjs");
const outputDir = path.resolve(__dirname, "..", "..", ".codex-qa", "dvl2-01-planner-acceptance");
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-dvl2-01-accept-"));
const userData = path.join(workDir, "userData");
const markerPath = path.join(workDir, "phase-a-marker.json");

fs.mkdirSync(userData, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });

function runPhase(phase) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      DIGITALME_OWNER_RUNTIME_TEST: "1",
      DIGITALME_DVL2_01_PLANNER_ACCEPTANCE: "1",
      DIGITALME_DVL2_01_ACCEPT_PHASE: phase,
      DIGITALME_DVL2_01_USER_DATA: userData,
      DIGITALME_DVL2_01_MARKER: markerPath,
      DIGITALME_DVL2_01_OUTPUT: outputDir,
      DIGITALME_PLANNER_FORCE_RULE: "1",
      DIGITALME_ACT_BEHALF_FAKE: "1",
    };
    const child = spawn(electronBin, [entry], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d.toString();
      process.stdout.write(d);
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
      process.stderr.write(d);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error("phase " + phase + " exited " + code + "\n" + stderr));
    });
  });
}

async function main() {
  try {
    console.log("DVL2-01 acceptance workDir=", workDir);
    await runPhase("A");
    if (!fs.existsSync(markerPath)) {
      throw new Error("phase A did not write marker");
    }
    await runPhase("B");
    const summary = {
      pass: true,
      workDir,
      userData,
      marker: JSON.parse(fs.readFileSync(markerPath, "utf8")),
      outputDir,
    };
    fs.writeFileSync(path.join(outputDir, "two-phase-summary.json"), JSON.stringify(summary, null, 2));
    console.log("PASS dvl2-01 two-phase acceptance");
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
