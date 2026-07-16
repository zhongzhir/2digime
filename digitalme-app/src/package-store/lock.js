"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { writeJsonAtomic, readJson } = require("./fs-util");

const STALE_MS = 5 * 60 * 1000;

class PackageLock {
  constructor(storeRoot, hooks = {}) {
    this.lockPath = path.join(storeRoot, "lock.json");
    this.hooks = hooks;
  }

  acquire(owner) {
    if (typeof this.hooks.beforeAcquireLock === "function") this.hooks.beforeAcquireLock();
    const now = Date.now();
    if (fs.existsSync(this.lockPath)) {
      const cur = readJson(this.lockPath, null);
      if (cur && cur.owner && cur.owner !== owner) {
        const age = now - (cur.heartbeatAt || cur.acquiredAt || 0);
        if (age < STALE_MS) {
          const err = new Error("package_locked");
          err.code = "package_locked";
          err.owner = cur.owner;
          throw err;
        }
      }
    }
    const body = {
      owner,
      pid: process.pid,
      acquiredAt: now,
      heartbeatAt: now,
    };
    writeJsonAtomic(this.lockPath, body);
    const verify = readJson(this.lockPath, null);
    if (!verify || verify.owner !== owner) {
      const err = new Error("lock_acquire_failed");
      err.code = "lock_acquire_failed";
      throw err;
    }
    return body;
  }

  heartbeat(owner) {
    const cur = readJson(this.lockPath, null);
    if (!cur || cur.owner !== owner) return;
    cur.heartbeatAt = Date.now();
    writeJsonAtomic(this.lockPath, cur);
  }

  release(owner) {
    const cur = readJson(this.lockPath, null);
    if (!cur) return;
    if (cur.owner && cur.owner !== owner) return;
    try {
      fs.unlinkSync(this.lockPath);
    } catch {
      /* ignore */
    }
  }
}

module.exports = { PackageLock, STALE_MS };
