"use strict";

/**
 * Real Package baseline check (P1-00).
 *
 * Compares the local gitignored digital-me-package tree against the frozen
 * P1-00 report. May fail when Owner's private package has drifted.
 * Not part of hermetic test:p1-phase1.
 *
 * Run: npm run test:p1-baseline-real
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");

const REPO = path.join(__dirname, "..", "..");
const PACKAGE_DIR = path.join(REPO, "digital-me-package");
const P100_BASELINE = path.join(REPO, "build", "reports", "p1-00-package-baseline.json");
const EXPECTED_MANIFEST_SHA256 =
  "3309ea5b286fdf93fc5e1b4af9a9664b6738aa6bb71902cba676d2d523e6d42a";

function sha256File(abs) {
  return crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
}

function walkFiles(root) {
  const out = [];
  function walk(dir) {
    const names = fs.readdirSync(dir).sort();
    for (const name of names) {
      const full = path.join(dir, name);
      const stat = fs.lstatSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (stat.isFile()) {
        out.push({
          relativePath: path.relative(root, full).split(path.sep).join("/"),
          size: stat.size,
          sha256: sha256File(full),
        });
      }
    }
  }
  walk(root);
  return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

console.log("Real package baseline check (optional; local drift may fail)");
console.log("Package:", PACKAGE_DIR);
console.log("Baseline report:", P100_BASELINE);

assert.ok(fs.existsSync(P100_BASELINE), "missing p1-00 baseline report");
assert.ok(fs.existsSync(PACKAGE_DIR), "missing local digital-me-package directory");

const baseline = JSON.parse(fs.readFileSync(P100_BASELINE, "utf8"));
assert.ok(baseline && Array.isArray(baseline.files) && baseline.files.length > 0);
assert.equal(
  baseline.packageDigest && baseline.packageDigest.manifestSha256,
  EXPECTED_MANIFEST_SHA256
);

const expected = baseline.files.map((item) => ({
  relativePath: item.relativePath,
  size: item.size,
  sha256: item.sha256,
}));
const current = walkFiles(PACKAGE_DIR);

try {
  assert.deepEqual(current, expected);
} catch (err) {
  console.error(
    "FAIL real package does not match P1-00 baseline (local package drift is allowed; this check is not part of test:p1-phase1)"
  );
  throw err;
}

console.log(
  `PASS real package matches P1-00 baseline (${current.length} files, manifest ${EXPECTED_MANIFEST_SHA256})`
);
