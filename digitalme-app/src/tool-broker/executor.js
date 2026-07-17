"use strict";

const { spawn, execFile } = require("node:child_process");

function killProcessTree(pid) {
  return new Promise((resolve) => {
    if (!pid) {
      resolve();
      return;
    }
    if (process.platform === "win32") {
      execFile(
        "taskkill",
        ["/pid", String(pid), "/T", "/F"],
        { windowsHide: true },
        () => resolve()
      );
      return;
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
    resolve();
  });
}

/**
 * Execute a prepared plan with shell:false, timeout, output caps, and process-tree reclaim.
 * @param {{
 *   executable: string,
 *   args: string[],
 *   cwd: string,
 *   env: Record<string, string>,
 *   timeoutMs: number,
 *   maxOutputBytes: number,
 *   signal?: AbortSignal,
 * }} plan
 */
function executePlan(plan) {
  return new Promise((resolve) => {
    const executable = String(plan.executable || "");
    const args = Array.isArray(plan.args) ? plan.args.map(String) : [];
    const cwd = String(plan.cwd || "");
    const env = plan.env && typeof plan.env === "object" ? plan.env : Object.create(null);
    const timeoutMs = Number(plan.timeoutMs) || 60000;
    const maxOutputBytes = Number(plan.maxOutputBytes) || 65536;
    const signal = plan.signal;

    let child;
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let stdoutChunks = [];
    let stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let truncated = false;
    let timer = null;
    let onAbort = null;

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

    function reclaimAndFinish(partial) {
      const pid = child && child.pid;
      Promise.resolve()
        .then(() => killProcessTree(pid))
        .finally(() => finish(partial));
    }

    onAbort = () => {
      cancelled = true;
      reclaimAndFinish({
        ok: false,
        code: "cancelled",
        exitCode: null,
        signal: "SIGKILL",
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        truncated,
        timedOut: false,
        cancelled: true,
      });
    };

    try {
      child = spawn(executable, args, {
        cwd,
        env,
        shell: false,
        windowsHide: true,
        // On POSIX, start a new process group so tree reclaim via kill(-pid) works.
        detached: process.platform !== "win32",
      });
    } catch (err) {
      finish({
        ok: false,
        code: "spawn_failed",
        message: String((err && err.message) || err),
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: "",
        truncated: false,
        timedOut: false,
        cancelled: false,
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
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        truncated,
        timedOut: true,
        cancelled: false,
      });
    }, timeoutMs);

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        if (stdoutBytes >= maxOutputBytes) {
          truncated = true;
          return;
        }
        const room = maxOutputBytes - stdoutBytes;
        if (buf.length > room) {
          stdoutChunks.push(buf.subarray(0, room));
          stdoutBytes += room;
          truncated = true;
        } else {
          stdoutChunks.push(buf);
          stdoutBytes += buf.length;
        }
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        if (stderrBytes >= maxOutputBytes) {
          truncated = true;
          return;
        }
        const room = maxOutputBytes - stderrBytes;
        if (buf.length > room) {
          stderrChunks.push(buf.subarray(0, room));
          stderrBytes += room;
          truncated = true;
        } else {
          stderrChunks.push(buf);
          stderrBytes += buf.length;
        }
      });
    }

    child.on("error", (err) => {
      reclaimAndFinish({
        ok: false,
        code: "spawn_error",
        message: String((err && err.message) || err),
        exitCode: null,
        signal: null,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        truncated,
        timedOut,
        cancelled,
      });
    });

    child.on("close", (exitCode, signalName) => {
      if (settled) return;
      const ok = !timedOut && !cancelled && exitCode === 0;
      finish({
        ok,
        code: ok ? "ok" : timedOut ? "timeout" : cancelled ? "cancelled" : "exit_nonzero",
        exitCode: exitCode == null ? null : exitCode,
        signal: signalName || null,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        truncated,
        timedOut,
        cancelled,
      });
    });
  });
}

module.exports = {
  executePlan,
  killProcessTree,
};
