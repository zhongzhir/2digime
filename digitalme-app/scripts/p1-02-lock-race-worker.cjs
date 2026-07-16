"use strict";

/**
 * Child worker for P1-02 lock race tests.
 * Usage: node scripts/p1-02-lock-race-worker.cjs <packageDir> <changeSetId> <actor>
 * Prints JSON line: { ok: true, revision } or { ok: false, code }
 */

const { PackageStore } = require("../src/package-store");

const packageDir = process.argv[2];
const changeSetId = process.argv[3];
const actor = process.argv[4] || `worker:${process.pid}`;

if (!packageDir || !changeSetId) {
  process.stdout.write(JSON.stringify({ ok: false, code: "args_required" }) + "\n");
  process.exit(2);
}

try {
  const store = new PackageStore({ packageDir, actor });
  const result = store.commit(changeSetId, { confirmed: true });
  process.stdout.write(
    JSON.stringify({
      ok: true,
      revision: result.revision,
      rootSha256: result.rootSha256,
      pid: process.pid,
    }) + "\n"
  );
  process.exit(0);
} catch (e) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      code: e && e.code ? e.code : "unknown",
      message: e && e.message ? e.message : String(e),
      pid: process.pid,
    }) + "\n"
  );
  process.exit(1);
}
