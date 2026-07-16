"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { readJson } = require("./fs-util");

/** Lease duration; heartbeat extends leaseExpiresAt. Stale only when expired AND pid dead. */
const LEASE_MS = 5 * 60 * 1000;

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
    // EPERM (and similar): process exists but we cannot signal it.
    if (e && e.code === "EPERM") return true;
    return false;
  }
}

function isLeaseExpired(lockBody, now = Date.now()) {
  const expires = lockBody && lockBody.leaseExpiresAt;
  if (typeof expires === "number" && Number.isFinite(expires)) {
    return now >= expires;
  }
  // Legacy / corrupt: treat missing lease as expired so reclaim can proceed only if pid dead.
  return true;
}

function isStale(lockBody, now = Date.now()) {
  if (!lockBody) return true;
  return isLeaseExpired(lockBody, now) && !isPidAlive(lockBody.pid);
}

class PackageLock {
  constructor(storeRoot, hooks = {}) {
    this.lockPath = path.join(storeRoot, "lock.json");
    this.hooks = hooks;
  }

  /**
   * Acquire exclusive lock. `actor` is logical only; each acquire gets a fresh operationToken.
   * Same actor in another process is blocked while the first holds a live lease.
   * @returns {{ actor, operationToken, pid, acquiredAt, leaseExpiresAt, heartbeatAt }}
   */
  acquire(actor) {
    if (typeof this.hooks.beforeAcquireLock === "function") this.hooks.beforeAcquireLock();
    const who = String(actor || "").trim();
    if (!who) throw err("actor_required", "actor_required");

    const maxAttempts = 8;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const created = this._tryCreateExclusive(who);
      if (created) return created;

      const cur = readJson(this.lockPath, null);
      if (cur && !isStale(cur)) {
        throw err("package_locked", "package_locked", {
          actor: cur.actor || cur.owner,
          pid: cur.pid,
        });
      }

      // Stale: lease expired and holder pid not alive — reclaim atomically via rename + wx.
      if (typeof this.hooks.beforeStaleReclaim === "function") {
        this.hooks.beforeStaleReclaim(cur);
      }
      const deadToken = crypto.randomBytes(8).toString("hex");
      const deadPath = `${this.lockPath}.dead.${deadToken}`;
      try {
        fs.renameSync(this.lockPath, deadPath);
      } catch {
        // Lost race or lock vanished — retry exclusive create / locked check.
        continue;
      }
      try {
        fs.unlinkSync(deadPath);
      } catch {
        /* best-effort cleanup of dead marker */
      }

      const afterReclaim = this._tryCreateExclusive(who);
      if (afterReclaim) return afterReclaim;
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

  heartbeat(operationToken) {
    const token = String(operationToken || "");
    if (!token) return;
    const cur = readJson(this.lockPath, null);
    if (!cur || cur.operationToken !== token) return;
    const now = Date.now();
    cur.heartbeatAt = now;
    cur.leaseExpiresAt = now + LEASE_MS;
    this._rewriteLockInPlace(cur);
  }

  release(operationToken) {
    const token = String(operationToken || "");
    if (!token) return;
    const cur = readJson(this.lockPath, null);
    if (!cur) return;
    if (cur.operationToken !== token) return;
    try {
      fs.unlinkSync(this.lockPath);
    } catch {
      /* ignore */
    }
  }

  _rewriteLockInPlace(body) {
    const tmp =
      this.lockPath + ".hb." + process.pid + "." + crypto.randomBytes(4).toString("hex");
    fs.writeFileSync(tmp, JSON.stringify(body, null, 2), "utf8");
    try {
      // Prefer replace via rename of existing → bak → new, without unlink-then-copy.
      if (!fs.existsSync(this.lockPath)) {
        fs.renameSync(tmp, this.lockPath);
        return;
      }
      const bak = this.lockPath + ".bak." + crypto.randomBytes(4).toString("hex");
      fs.renameSync(this.lockPath, bak);
      try {
        fs.renameSync(tmp, this.lockPath);
      } catch (e) {
        try {
          fs.renameSync(bak, this.lockPath);
        } catch {
          /* restore best-effort */
        }
        try {
          fs.unlinkSync(tmp);
        } catch {
          /* ignore */
        }
        throw e;
      }
      try {
        fs.unlinkSync(bak);
      } catch {
        /* ignore */
      }
    } catch (e) {
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      throw e;
    }
  }
}

module.exports = { PackageLock, LEASE_MS, isPidAlive, isStale };
