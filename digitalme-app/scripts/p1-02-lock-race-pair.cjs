"use strict";

/**
 * Launch two commit workers in parallel and wait for both.
 * Usage: node scripts/p1-02-lock-race-pair.cjs <packageDir> <csA> <actorA> <csB> <actorB>
 * Prints one JSON line: { results: [ {...}, {...} ] }
 */

const { spawn } = require("node:child_process");
const path = require("node:path");

const WORKER = path.join(__dirname, "p1-02-lock-race-worker.cjs");
const packageDir = process.argv[2];
const csA = process.argv[3];
const actorA = process.argv[4];
const csB = process.argv[5];
const actorB = process.argv[6];

if (!packageDir || !csA || !actorA || !csB || !actorB) {
  process.stdout.write(JSON.stringify({ ok: false, code: "args_required" }) + "\n");
  process.exit(2);
}

function launch(changeSetId, actor) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WORKER, packageDir, changeSetId, actor], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("close", (code) => {
      const line = String(out || "")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .pop();
      let parsed = null;
      try {
        parsed = line ? JSON.parse(line) : null;
      } catch {
        parsed = null;
      }
      resolve({ code, parsed, stderr: err });
    });
  });
}

Promise.all([launch(csA, actorA), launch(csB, actorB)])
  .then((results) => {
    process.stdout.write(JSON.stringify({ ok: true, results }) + "\n");
    process.exit(0);
  })
  .catch((e) => {
    process.stdout.write(
      JSON.stringify({ ok: false, code: "pair_failed", message: String(e && e.message) }) + "\n"
    );
    process.exit(1);
  });
