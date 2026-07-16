"use strict";

/**
 * Exclusive package lock: ownership file never renamed/replaced while held.
 * Heartbeat uses a sidecar generation file; staleness is PID-death based.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { readJson, ensureDir } = require("./fs-util");

const LEASE_MS = 5 * 60 * 1000;
const LOCK_NAME = "lock.json";

function err(code, message, extra) {
  const e = new Error(message || code);
  e.code = code;
  if (extra && typeof extra === "object") Object.assign(e, extra);
  return e;
}

function isPidAlive(pid) {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e && e.code === "ESRCH") return false;
    if (e && e.code === "EPERM") return true;
    return false;
  }
}

/** Stale only when holder PID is not alive. Lease age alone never steals a live lock. */
function isStale(lockBody) {
  if (!lockBody) return true;
  return !isPidAlive(lockBody.pid);
}

class PackageLock {
  constructor(storeRoot, hooks = {}) {
    this.storeRoot = storeRoot;
    this.lockPath = path.join(storeRoot, LOCK_NAME);
    this.heartbeatDir = path.join(storeRoot, "lock-heartbeats");
    this.hooks = hooks;
  }

  /**
   * @returns {{ actor, operationToken, pid, acquiredAt, leaseExpiresAt, heartbeatAt }}
   */
  acquire(actor) {
    if (typeof this.hooks.beforeAcquireLock === "function") this.hooks.beforeAcquireLock();
    const who = String(actor || "").trim();
    if (!who) throw err("actor_required", "actor_required");
    ensureDir(this.storeRoot);

    const maxAttempts = 8;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const created = this._tryCreateExclusive(who);
      if (created) return created;

      const cur = readJson(this.lockPath, null);
      if (cur && !isStale(cur)) {
        throw err("package_locked", "package_locked", {
          actor: cur.actor || cur.owner,
          pid: cur.pid,
          operationToken: cur.operationToken,
        });
      }

      if (typeof this.hooks.beforeStaleReclaim === "function") {
        this.hooks.beforeStaleReclaim(cur);
      }
      const deadToken = crypto.randomBytes(8).toString("hex");
      const deadPath = `${this.lockPath}.dead.${deadToken}`;
      try {
        // Atomic reclaim: rename ownership file away, then wx-create a new one.
        fs.renameSync(this.lockPath, deadPath);
      } catch {
        continue;
      }
      try {
        fs.unlinkSync(deadPath);
      } catch {
        /* ignore */
      }
      this._cleanupHeartbeatSidecars();

      const after = this._tryCreateExclusive(who);
      if (after) return after;
    }

    throw err("package_locked", "package_locked");
  }

  _tryCreateExclusive(actor) {
    const now = Date.now();
    const operationToken = crypto.randomBytes(16).toString("hex");
    const body = {
      actor,
      operationToken,
      pid: process.pid,
      acquiredAt: now,
      heartbeatAt: now,
      leaseExpiresAt: now + LEASE_MS,
    };

    let fd;
    try {
      fd = fs.openSync(this.lockPath, "wx");
    } catch (e) {
      if (e && e.code === "EEXIST") return null;
      throw e;
    }
    try {
      fs.writeFileSync(fd, JSON.stringify(body, null, 2), "utf8");
    } finally {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }

    const verify = readJson(this.lockPath, null);
    if (!verify || verify.operationToken !== operationToken) {
      throw err("lock_acquire_failed", "lock_acquire_failed");
    }
    return body;
  }

  /**
   * Heartbeat must NOT rename/unlink/replace the ownership lock file.
   * Writes an immutable sidecar under lock-heartbeats/.
   */
  heartbeat(operationToken) {
    const token = String(operationToken || "");
    if (!token) return;
    if (typeof this.hooks.beforeHeartbeat === "function") {
      this.hooks.beforeHeartbeat(token);
    }
    const cur = readJson(this.lockPath, null);
    if (!cur || cur.operationToken !== token) return;

    const now = Date.now();
    ensureDir(this.heartbeatDir);
    const seq = String(now).padStart(16, "0") + "-" + crypto.randomBytes(4).toString("hex");
    const sidePath = path.join(this.heartbeatDir, `hb-${seq}.json`);
    const payload = {
      operationToken: token,
      actor: cur.actor,
      pid: cur.pid,
      heartbeatAt: now,
      leaseExpiresAt: now + LEASE_MS,
    };
    let fd;
    try {
      fd = fs.openSync(sidePath, "wx");
      fs.writeFileSync(fd, JSON.stringify(payload, null, 2), "utf8");
    } finally {
      if (fd != null) {
        try {
          fs.closeSync(fd);
        } catch {
          /* ignore */
        }
      }
    }
    // Ownership lock.json is untouched — no gap for a second wx acquire.
    if (typeof this.hooks.afterHeartbeat === "function") {
      this.hooks.afterHeartbeat(token, sidePath);
    }
  }

  release(operationToken) {
    const token = String(operationToken || "");
    if (!token) return;
    const cur = readJson(this.lockPath, null);
    if (!cur) {
      this._cleanupHeartbeatSidecars();
      return;
    }
    if (cur.operationToken !== token) return;
    try {
      fs.unlinkSync(this.lockPath);
    } catch {
      /* ignore */
    }
    this._cleanupHeartbeatSidecars();
  }

  _cleanupHeartbeatSidecars() {
    if (!fs.existsSync(this.heartbeatDir)) return;
    let names;
    try {
      names = fs.readdirSync(this.heartbeatDir);
    } catch {
      return;
    }
    for (const name of names) {
      try {
        fs.unlinkSync(path.join(this.heartbeatDir, name));
      } catch {
        /* ignore */
      }
    }
    try {
      fs.rmdirSync(this.heartbeatDir);
    } catch {
      /* ignore */
    }
  }
}

module.exports = {
  PackageLock,
  LEASE_MS,
  isPidAlive,
  isStale,
  LOCK_NAME,
};
