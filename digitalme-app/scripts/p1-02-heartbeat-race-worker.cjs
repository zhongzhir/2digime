"use strict";

/**
 * Child: try acquire PackageLock while parent holds it (heartbeat window).
 * Args: storeRoot actor
 * Prints: LOCKED | ACQUIRED_DURING_HEARTBEAT | ERROR ...
 */

const path = require("node:path");
const { PackageLock } = require("../src/package-store/lock");

const storeRoot = process.argv[2];
const actor = process.argv[3] || "race-actor";

try {
  const lock = new PackageLock(storeRoot);
  const handle = lock.acquire(actor);
  // Should not reach here while parent holds lock.json
  lock.release(handle.operationToken);
  process.stdout.write("ACQUIRED_DURING_HEARTBEAT\n");
  process.exit(0);
} catch (e) {
  if (e && e.code === "package_locked") {
    process.stdout.write("LOCKED\n");
    process.exit(0);
  }
  process.stdout.write("ERROR " + (e && e.code ? e.code : String(e)) + "\n");
  process.exit(1);
}
