"use strict";

/**
 * Real IPC-path stop test for P1-05 (not AbortController-only).
 *
 * Simulates main-process handler behavior:
 *   begin → send l0:external-agent-started → run long Node child → stop via operationId
 *
 * Restart requirement: if Owner UI still times out after this passes, fully quit Digital Me
 * (including tray/background Electron) and relaunch so renderer/preload are not stale.
 *
 * Run: node scripts/test-p1-05-stop-ipc.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawn: realSpawn } = require("node:child_process");

const toolBroker = require("../src/tool-broker");
const { isProcessAlive } = require("../src/tool-broker/executor");
const externalAgentFlow = require("../src/orchestration/external-agent-flow");
const agentsLib = require("../src/orchestration/agents");
const delegateRuntime = require("../src/orchestration/delegate-runtime");
const confirmationStore = require("../src/policy-engine/confirmation-store");
const decisionAudit = require("../src/decision-audit");

function tempUserData(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dm-p105-ipc-${label}-`));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function mockEvent(senderId) {
  return { sender: { id: senderId } };
}

/**
 * Mirror main.js l0:runExternalAgent / l0:stopExternalAgent IPC surface.
 */
function createIpcHarness(userData, agents) {
  const startedEvents = [];
  const activeDelegateAborts = new Map();

  function sender(event) {
    return {
      send(channel, data) {
        if (channel === "l0:external-agent-started" || channel === "chat:progress") {
          startedEvents.push({ channel, data });
        }
      },
      id: event.sender.id,
    };
  }

  async function runExternalAgentIpc(event, payload) {
    const clientRequestId = String((payload && payload.requestId) || "").trim();
    const began = delegateRuntime.begin(event, clientRequestId);
    if (!began.ok) {
      throw new Error(began.reason || "begin_failed");
    }
    const { operationId, abort: ac, senderId } = began;
    activeDelegateAborts.set(operationId, ac);
    // Immediate expose — same as main.js
    try {
      sender(event).send("l0:external-agent-started", {
        requestId: clientRequestId || "",
        operationId,
        senderId,
      });
    } catch {
      /* ignore */
    }
    const progressRequestId = clientRequestId || operationId;
    const sendProg = (p) => {
      try {
        sender(event).send("chat:progress", {
          requestId: progressRequestId,
          operationId,
          ...p,
        });
      } catch {
        /* ignore */
      }
    };
    sendProg({ phase: "thinking", label: "正在登记外部委派…" });

    const runPromise = externalAgentFlow
      .runExternalAgent(userData, event, payload || {}, agents, {
        onProgress: sendProg,
        signal: ac.signal,
      })
      .then((result) => {
        if (result && typeof result === "object") {
          result.operationId = operationId;
          if (!result.meta) result.meta = {};
          result.meta.operationId = operationId;
          result.meta.senderId = senderId;
        }
        return result;
      });
    delegateRuntime.attachPromise(operationId, runPromise);
    try {
      return await runPromise;
    } finally {
      activeDelegateAborts.delete(operationId);
      delegateRuntime.end(operationId);
    }
  }

  function stopExternalAgentIpc(event, payload) {
    const operationId = String((payload && payload.operationId) || "").trim();
    if (!operationId) return { ok: false, reason: "missing_operation_id" };
    const result = delegateRuntime.abortOne(event, operationId);
    if (result.ok && result.operationId) {
      const ac = activeDelegateAborts.get(result.operationId);
      if (ac) {
        try {
          ac.abort();
        } catch {
          /* ignore */
        }
      }
    }
    return result;
  }

  return {
    startedEvents,
    runExternalAgentIpc,
    stopExternalAgentIpc,
  };
}

async function main() {
  confirmationStore.clearAllForTests();
  delegateRuntime.clearAllForTests();
  const userData = tempUserData("stop");
  let childPid = null;
  try {
    const work = path.join(userData, "workdir");
    fs.mkdirSync(work, { recursive: true });
    const sleepJs = path.join(work, "sleep-long.js");
    fs.writeFileSync(sleepJs, "setTimeout(() => {}, 120000);\n", "utf8");

    const saved = toolBroker.saveNarrowSettings(userData, {
      executable: process.execPath,
      authorizedCwdRoot: work,
      enabled: true,
      timeoutMs: 45000,
    });
    assert.equal(saved.ok, true, String((saved.reasonCodes || []).join(",")));
    agentsLib.setActiveAgent(userData, "cli-coder");

    let spawned = false;
    const agents = {
      getActiveCliAgentSnapshot() {
        return agentsLib.getActiveCliAgentSnapshot(userData);
      },
      async executePreparedPlan(plan, opts) {
        return toolBroker.executePreparedPlan(plan, {
          ...opts,
          executorDeps: {
            spawn: (...args) => {
              const child = realSpawn(...args);
              spawned = true;
              childPid = child.pid;
              return child;
            },
          },
        });
      },
    };

    const ipc = createIpcHarness(userData, agents);
    const event = mockEvent(11);
    const requestId = "creq_ipc_stop_test";

    // Renderer-side: register listener BEFORE invoke (mirrors fixed init order).
    let rendererOperationId = null;
    const onStarted = (data) => {
      if (!data || !data.operationId) return;
      if (data.requestId && data.requestId !== requestId) return;
      rendererOperationId = String(data.operationId);
    };

    const prep = externalAgentFlow.requestExternalAgent(
      userData,
      event,
      {
        task: sleepJs,
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
        writeIntent: true,
        requestId,
      },
      agents
    );
    assert.ok(prep.confirmationToken);

    const runPromise = ipc.runExternalAgentIpc(event, {
      task: sleepJs,
      dataScopes: ["task_text", "workspace_files", "env_inherit"],
      writeIntent: true,
      decisionId: prep.decisionId,
      confirmationToken: prep.confirmationToken,
      requestId,
    });

    // Wait until main exposed operationId via l0:external-agent-started
    const deadline = Date.now() + 10000;
    while (!rendererOperationId && Date.now() < deadline) {
      for (const ev of ipc.startedEvents) {
        if (ev.channel === "l0:external-agent-started") onStarted(ev.data);
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(rendererOperationId, "renderer must receive operationId before run returns");

    // Wait until child actually spawned, then stop via IPC (same as l0:stopExternalAgent).
    const spawnDeadline = Date.now() + 15000;
    while (!spawned && Date.now() < spawnDeadline) {
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.equal(spawned, true, "long-running child must spawn");
    assert.ok(childPid, "child pid required");

    const stopResult = ipc.stopExternalAgentIpc(event, { operationId: rendererOperationId });
    assert.equal(stopResult.ok, true, "stop IPC must succeed with main-minted operationId");

    // Repeat stop must not throw / must be side-effect free on other ops.
    const stopAgain = ipc.stopExternalAgentIpc(event, { operationId: rendererOperationId });
    assert.ok(stopAgain.ok === true || stopAgain.reason === "unknown_operation");

    const result = await runPromise;
    assert.equal(result.aborted, true, "result must be canceled/aborted");
    assert.ok(!result.timedOut, "result must not be timed_out");
    assert.equal(result.operationId, rendererOperationId);

    await new Promise((r) => setTimeout(r, 250));
    if (!result.orphanRisk) {
      assert.equal(isProcessAlive(childPid), false, "child process must be reclaimed");
    }

    const lines = fs
      .readFileSync(path.join(userData, "decision-audit", "gen-1.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    const canceled = lines.find((r) => r.event === "execution_canceled");
    const timedOut = lines.find((r) => r.event === "execution_timed_out");
    assert.ok(canceled, "audit must include execution_canceled");
    assert.ok(!timedOut, "audit must not include execution_timed_out");

    console.log("PASS p1-05 stop IPC harness");
    console.log(
      "NOTE: Owner UI re-check requires fully quitting and relaunching Digital Me so renderer/preload are not stale."
    );
  } finally {
    if (childPid && isProcessAlive(childPid)) {
      try {
        process.kill(childPid);
      } catch {
        /* ignore */
      }
    }
    cleanup(userData);
    delegateRuntime.clearAllForTests();
    confirmationStore.clearAllForTests();
  }
}

main().catch((err) => {
  console.error("FAIL p1-05 stop IPC harness", err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
