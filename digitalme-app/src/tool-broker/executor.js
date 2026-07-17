"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");
const { buildMinimalEnv } = require("./environment");

function resolveSystem32Binary(basename) {
  const root =
    process.env.SystemRoot ||
    process.env.WINDIR ||
    (process.platform === "win32" ? "C:\\Windows" : "");
  if (!root) return null;
  return path.join(root, "System32", basename);
}

function resolveTaskkillPath() {
  if (process.platform !== "win32") return null;
  const candidate = resolveSystem32Binary("taskkill.exe");
  if (candidate && fs.existsSync(candidate)) return candidate;
  return null;
}

function resolveTasklistPath() {
  if (process.platform !== "win32") return null;
  const candidate = resolveSystem32Binary("tasklist.exe");
  if (candidate && fs.existsSync(candidate)) return candidate;
  return null;
}

function taskkillEnv() {
  return buildMinimalEnv(["SystemRoot", "WINDIR", "TEMP", "TMP"], process.env, {
    includePath: false,
  });
}

function isProcessAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err && (err.code === "ESRCH" || err.code === "ENOENT")) return false;
    // EPERM means the process exists but we cannot signal it.
    if (err && err.code === "EPERM") return true;
    return false;
  }
}

function runExecFile(file, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        windowsHide: true,
        env: opts.env || taskkillEnv(),
        timeout: opts.timeoutMs || 5000,
        maxBuffer: 64 * 1024,
      },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          error: err || null,
          exitCode: err && err.code != null && Number.isFinite(Number(err.code)) ? Number(err.code) : err ? 1 : 0,
          status: err && err.status != null ? err.status : err ? null : 0,
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
        });
      }
    );
  });
}

/**
 * Terminate a process tree. On Windows uses absolute taskkill + minimal env,
 * then verifies the target pid is gone.
 * @returns {Promise<{ reclaimed: boolean, orphanRisk: boolean, method: string, detail?: string }>}
 */
async function killProcessTree(pid, deps = {}) {
  if (!pid) {
    return { reclaimed: true, orphanRisk: false, method: "noop" };
  }

  const killImpl = deps.killProcessTreeImpl;
  if (typeof killImpl === "function") {
    return killImpl(pid);
  }

  if (process.platform === "win32") {
    const taskkillPath = deps.taskkillPath != null ? deps.taskkillPath : resolveTaskkillPath();
    if (!taskkillPath || !path.isAbsolute(String(taskkillPath))) {
      return {
        reclaimed: false,
        orphanRisk: true,
        method: "taskkill_missing",
        detail: "taskkill absolute path unavailable",
      };
    }
    if (deps.forceTaskkillFail) {
      return {
        reclaimed: false,
        orphanRisk: true,
        method: "taskkill_failed",
        detail: "injected_failure",
      };
    }

    const result = await runExecFile(
      taskkillPath,
      ["/pid", String(pid), "/T", "/F"],
      { env: taskkillEnv(), timeoutMs: 8000 }
    );

    // taskkill exit 128 / 255 often means process already gone — still verify.
    const exitOk = result.ok || result.status === 0 || result.status === 128;
    if (!exitOk && deps.treatNonZeroAsFailure !== false) {
      // Continue to liveness check; failure alone is not enough without proof.
    }

    let alive = isProcessAlive(pid);
    if (deps.forceStillAlive) alive = true;
    if (deps.forceDead) alive = false;

    if (alive) {
      return {
        reclaimed: false,
        orphanRisk: true,
        method: "taskkill",
        detail: result.ok
          ? "process_still_alive"
          : `taskkill_failed:${result.status != null ? result.status : "err"}`,
      };
    }
    return {
      reclaimed: true,
      orphanRisk: false,
      method: "taskkill",
      detail: result.ok ? "ok" : `already_gone:${result.status}`,
    };
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* ignore */
    }
  }
  // Brief settle then probe.
  await new Promise((r) => setTimeout(r, 30));
  let alive = isProcessAlive(pid);
  if (deps.forceStillAlive) alive = true;
  if (deps.forceDead) alive = false;
  if (alive) {
    return { reclaimed: false, orphanRisk: true, method: "posix_kill", detail: "process_still_alive" };
  }
  return { reclaimed: true, orphanRisk: false, method: "posix_kill" };
}

/**
 * Execute a prepared plan with shell:false, combined output retention,
 * streaming full-byte SHA-256, timeout, cancel, and process-tree reclaim.
 */
function executePlan(plan, deps = {}) {
  return new Promise((resolve) => {
    const executable = String(plan.executable || "");
    const args = Array.isArray(plan.args) ? plan.args.map(String) : [];
    const cwd = String(plan.cwd || "");
    const env = plan.env && typeof plan.env === "object" ? plan.env : Object.create(null);
    const timeoutMs = Number(plan.timeoutMs) || 60000;
    const maxOutputBytes = Number(plan.maxOutputBytes) || 65536;
    const signal = plan.signal;
    const spawnFn = deps.spawn || spawn;

    let child;
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let retainedChunks = [];
    let retainedBytes = 0;
    let truncated = false;
    let totalBytes = 0;
    let stdoutTotalBytes = 0;
    let stderrTotalBytes = 0;
    const fullHasher = crypto.createHash("sha256");
    let timer = null;
    let onAbort = null;
    let reclaimInfo = { reclaimed: true, orphanRisk: false, method: "none" };

    function finish(result) {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (signal && onAbort) {
        try {
          signal.removeEventListener("abort", onAbort);
        } catch {
          /* ignore */
        }
      }
      resolve(result);
    }

    function retainedText() {
      return Buffer.concat(retainedChunks).toString("utf8");
    }

    let metricsFinalized = false;
    let cachedMetrics = null;

    function snapshotMetrics() {
      if (metricsFinalized && cachedMetrics) return cachedMetrics;
      metricsFinalized = true;
      const retained = retainedText();
      const retainedSha256 = crypto.createHash("sha256").update(retained, "utf8").digest("hex");
      const fullOutputSha256 = fullHasher.digest("hex");
      cachedMetrics = {
        stdout: retained,
        stderr: "",
        truncated,
        retainedBytes,
        totalBytes,
        stdoutTotalBytes,
        stderrTotalBytes,
        retainedSha256,
        fullOutputSha256,
        outputDigestKind: truncated ? "retained_prefix" : "full",
      };
      return cachedMetrics;
    }

    function ingest(stream, chunk) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      if (!buf.length) return;
      fullHasher.update(buf);
      totalBytes += buf.length;
      if (stream === "stdout") stdoutTotalBytes += buf.length;
      else stderrTotalBytes += buf.length;

      if (retainedBytes >= maxOutputBytes) {
        truncated = true;
        return;
      }
      const room = maxOutputBytes - retainedBytes;
      if (buf.length > room) {
        retainedChunks.push(buf.subarray(0, room));
        retainedBytes += room;
        truncated = true;
      } else {
        retainedChunks.push(buf);
        retainedBytes += buf.length;
      }
    }

    function reclaimAndFinish(partial) {
      const pid = child && child.pid;
      Promise.resolve()
        .then(() => killProcessTree(pid, deps))
        .then((info) => {
          reclaimInfo = info || reclaimInfo;
          const metrics = snapshotMetrics();
          finish({
            ...partial,
            ...metrics,
            orphanRisk: !!(info && info.orphanRisk),
            reclaim: info,
          });
        })
        .catch(() => {
          const metrics = snapshotMetrics();
          finish({
            ...partial,
            ...metrics,
            orphanRisk: true,
            reclaim: { reclaimed: false, orphanRisk: true, method: "reclaim_error" },
          });
        });
    }

    onAbort = () => {
      cancelled = true;
      reclaimAndFinish({
        ok: false,
        code: "cancelled",
        exitCode: null,
        signal: "SIGKILL",
        timedOut: false,
        cancelled: true,
      });
    };

    try {
      child = spawnFn(executable, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
      });
    } catch (err) {
      const metrics = snapshotMetrics();
      finish({
        ok: false,
        code: "spawn_failed",
        message: String((err && err.message) || err),
        exitCode: null,
        signal: null,
        timedOut: false,
        cancelled: false,
        orphanRisk: false,
        ...metrics,
      });
      return;
    }

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    timer = setTimeout(() => {
      timedOut = true;
      reclaimAndFinish({
        ok: false,
        code: "timeout",
        exitCode: null,
        signal: "SIGKILL",
        timedOut: true,
        cancelled: false,
      });
    }, timeoutMs);

    if (child.stdout) {
      child.stdout.on("data", (chunk) => ingest("stdout", chunk));
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk) => ingest("stderr", chunk));
    }

    child.on("error", (err) => {
      reclaimAndFinish({
        ok: false,
        code: "spawn_error",
        message: String((err && err.message) || err),
        exitCode: null,
        signal: null,
        timedOut,
        cancelled,
      });
    });

    child.on("close", (exitCode, signalName) => {
      if (settled) return;
      const ok = !timedOut && !cancelled && exitCode === 0;
      const metrics = snapshotMetrics();
      finish({
        ok,
        code: ok ? "ok" : timedOut ? "timeout" : cancelled ? "cancelled" : "exit_nonzero",
        exitCode: exitCode == null ? null : exitCode,
        signal: signalName || null,
        timedOut,
        cancelled,
        orphanRisk: false,
        reclaim: reclaimInfo,
        ...metrics,
      });
    });
  });
}

module.exports = {
  executePlan,
  killProcessTree,
  isProcessAlive,
  resolveTaskkillPath,
  resolveTasklistPath,
  taskkillEnv,
};
