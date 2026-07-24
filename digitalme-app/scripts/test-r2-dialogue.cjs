"use strict";

/**
 * R2 user-facing acceptance index.
 * It only aggregates successful real Electron/contract suites; no case is
 * marked passed unless its owning suite exits successfully.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.resolve(ROOT, "..", ".codex-qa", "r2-dialogue");
const OUT_FILE = path.join(OUT_DIR, "acceptance.json");

const cases = [
  ["dialogue-opens-in-new-shell", "R2 Electron: controlled next entry and chat root"],
  ["send-and-stream-message", "R2 Electron: send, stream, persist"],
  ["stop-and-retry", "R2 Electron: stop lifecycle and real UI retry"],
  ["session-persistence", "R2 Electron: CRUD and restart restore"],
  ["session-switch-guard", "R2 Electron: active request navigation guard"],
  ["display-model-separation", "R2 contracts/Electron: DTO and attachment isolation"],
  ["artifact-link-card", "R2 Electron: compact linked artifact card and handoff"],
  ["reload-recovery", "R2 Electron: reload during active request"],
  ["subject-context-regression", "Doing-context Electron: confirmed context and audit"],
].map(([name, evidence]) => ({ case: name, pass: false, evidence, failureReason: null }));

function runScript(name) {
  const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
  const args = process.platform === "win32" ? ["/d", "/s", "/c", `npm run ${name}`] : ["run", name];
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: false,
  });
  return result.status === 0;
}

function writeResult() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify(
      {
        suite: "r2-dialogue",
        generatedAt: new Date().toISOString(),
        passed: cases.filter((item) => item.pass).length,
        total: cases.length,
        cases,
      },
      null,
      2
    ),
    "utf8"
  );
}

const r2Passed = runScript("test:r2");
for (const item of cases.slice(0, 8)) {
  item.pass = r2Passed;
  if (!r2Passed) item.failureReason = "test:r2 failed; see command output";
}

const doingContextPassed = r2Passed && runScript("test:doing-context-acceptance");
const subjectCase = cases[8];
subjectCase.pass = doingContextPassed;
if (!doingContextPassed) {
  subjectCase.failureReason = r2Passed
    ? "test:doing-context-acceptance failed; see command output"
    : "skipped because test:r2 failed";
}

writeResult();
console.log(`R2 dialogue acceptance: ${cases.filter((item) => item.pass).length}/${cases.length}`);
process.exit(cases.every((item) => item.pass) ? 0 : 1);
