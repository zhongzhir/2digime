"use strict";

/**
 * P1-04 PolicyEngine + DecisionAudit + external CLI gate tests.
 * Run: node scripts/test-p1-04-policy-decision-audit.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { evaluatePolicy, buildExternalCliRequest, buildRequestDigest } = require("../src/policy-engine");
const { digestTaskText, stableStringify } = require("../src/policy-engine/digest");
const confirmationStore = require("../src/policy-engine/confirmation-store");
const decisionAudit = require("../src/decision-audit");
const externalAgentFlow = require("../src/orchestration/external-agent-flow");
const { dirByteFingerprint } = require("../src/package-store");

const DEFAULT_PKG = path.join(__dirname, "..", "..", "digital-me-package");

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, err && err.stack ? err.stack : err);
  }
}

function tempUserData(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dm-p104-${label}-`));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function cliAgent(overrides = {}) {
  return {
    id: "cli-coder",
    kind: "cli",
    name: "测试执行体",
    command: "echo",
    cwd: "",
    enabled: true,
    ...overrides,
  };
}

function agentsModule(agent, runImpl) {
  let spawnCount = 0;
  const mod = {
    getActiveAgent() {
      return agent;
    },
    runCliAgent: runImpl || (async () => {
      spawnCount += 1;
      return { ok: true, code: 0, output: "demo-output", aborted: false };
    }),
    get spawnCount() {
      return spawnCount;
    },
  };
  return mod;
}

function mockEvent(senderId) {
  return { sender: { id: senderId } };
}

function baseRequest(task = "fix lint, secret=TEST_KEY_DO_NOT_LOG") {
  return buildExternalCliRequest({
    taskText: task,
    dataScopes: ["task_text", "workspace_files", "env_inherit"],
    agent: cliAgent(),
    writeIntent: true,
  });
}

async function runAllTests() {
  confirmationStore.clearAllForTests();

  await test("1. external_cli_execute requires confirmation when CLI configured", () => {
    const decision = evaluatePolicy(baseRequest(), { cliEnabled: true, hasCommand: true });
    assert.equal(decision.effect, "require_confirmation");
    assert.ok(decision.reasonCodes.includes("external_cli_requires_confirmation"));
    assert.ok(decision.confirmationSummary);
    assert.ok(decision.requestDigest);
  });

  await test("2. deny when CLI not configured (fail-closed)", () => {
    const decision = evaluatePolicy(baseRequest(), { cliEnabled: false, hasCommand: false });
    assert.equal(decision.effect, "deny");
    assert.ok(decision.reasonCodes.includes("cli_not_configured"));
  });

  await test("3. deny on missing/unknown fields", () => {
    const bad = evaluatePolicy({ actor: "owner:renderer" }, { cliEnabled: true, hasCommand: true });
    assert.equal(bad.effect, "deny");
    assert.ok(bad.reasonCodes.length > 0);
    const unknown = evaluatePolicy(
      {
        ...baseRequest(),
        action: "unknown_action",
      },
      { cliEnabled: true, hasCommand: true }
    );
    assert.equal(unknown.effect, "deny");
  });

  await test("4. request digest stable for key order and sensitive to semantic change", () => {
    const a = buildExternalCliRequest({
      taskText: "alpha",
      dataScopes: ["task_text", "env_inherit"],
      agent: cliAgent(),
      writeIntent: false,
    });
    const b = buildExternalCliRequest({
      taskText: "alpha",
      dataScopes: ["env_inherit", "task_text"],
      agent: cliAgent(),
      writeIntent: false,
    });
    const da = buildRequestDigest(a);
    const db = buildRequestDigest(b);
    assert.equal(da, db);
    const c = buildExternalCliRequest({
      taskText: "beta",
      dataScopes: ["task_text", "env_inherit"],
      agent: cliAgent(),
      writeIntent: false,
    });
    assert.notEqual(da, buildRequestDigest(c));
  });

  await test("5. confirmation token binds, consumes once, rejects replay", () => {
    confirmationStore.clearAllForTests();
    const req = baseRequest();
    const digest = buildRequestDigest(req);
    const { tokenId } = confirmationStore.issueToken(
      {
        requestDigest: digest,
        actor: req.actor,
        action: req.action,
        destination: req.destination,
        dataScopes: req.dataScopes,
        cwd: "",
        senderId: "7",
        taskDigest: req.taskDigest,
        decisionId: "dec_test",
      },
      { ttlMs: 60000 }
    );
    const ok = confirmationStore.consumeToken(tokenId, {
      requestDigest: digest,
      actor: req.actor,
      action: req.action,
      destination: req.destination,
      dataScopes: req.dataScopes,
      cwd: "",
      senderId: "7",
      taskDigest: req.taskDigest,
    });
    assert.equal(ok.ok, true);
    const replay = confirmationStore.consumeToken(tokenId, {
      requestDigest: digest,
      actor: req.actor,
      action: req.action,
      destination: req.destination,
      dataScopes: req.dataScopes,
      cwd: "",
      senderId: "7",
      taskDigest: req.taskDigest,
    });
    assert.equal(replay.ok, false);
    assert.equal(replay.reason, "token_replayed");
  });

  await test("6. token rejects expiry, tamper, and sender mismatch", () => {
    confirmationStore.clearAllForTests();
    const req = baseRequest();
    const digest = buildRequestDigest(req);
    const short = confirmationStore.issueToken(
      {
        requestDigest: digest,
        actor: req.actor,
        action: req.action,
        destination: req.destination,
        dataScopes: req.dataScopes,
        cwd: "",
        senderId: "1",
        taskDigest: req.taskDigest,
        decisionId: "dec_exp",
      },
      { ttlMs: 1 }
    );
    const start = Date.now();
    while (Date.now() - start < 5) {
      /* spin */
    }
    const expired = confirmationStore.consumeToken(short.tokenId, {
      requestDigest: digest,
      actor: req.actor,
      action: req.action,
      destination: req.destination,
      dataScopes: req.dataScopes,
      cwd: "",
      senderId: "1",
      taskDigest: req.taskDigest,
    });
    assert.equal(expired.reason, "token_expired");

    confirmationStore.clearAllForTests();
    const issued = confirmationStore.issueToken(
      {
        requestDigest: digest,
        actor: req.actor,
        action: req.action,
        destination: req.destination,
        dataScopes: req.dataScopes,
        cwd: "",
        senderId: "1",
        taskDigest: req.taskDigest,
        decisionId: "dec_tamper",
      },
      { ttlMs: 60000 }
    );
    const tampered = confirmationStore.consumeToken(issued.tokenId, {
      requestDigest: digest + "ff",
      actor: req.actor,
      action: req.action,
      destination: req.destination,
      dataScopes: req.dataScopes,
      cwd: "",
      senderId: "1",
      taskDigest: req.taskDigest,
    });
    assert.equal(tampered.reason, "token_binding_mismatch");

    const senderBad = confirmationStore.consumeToken(issued.tokenId, {
      requestDigest: digest,
      actor: req.actor,
      action: req.action,
      destination: req.destination,
      dataScopes: req.dataScopes,
      cwd: "",
      senderId: "999",
      taskDigest: req.taskDigest,
    });
    assert.equal(senderBad.reason, "token_binding_mismatch");
  });

  await test("7. renderer booleans and fake token cannot execute (spawn count 0)", async () => {
    confirmationStore.clearAllForTests();
    const userData = tempUserData("no-bypass");
    const ag = agentsModule(cliAgent());
    try {
      await assert.rejects(
        () =>
          externalAgentFlow.runExternalAgent(
            userData,
            mockEvent(1),
            {
              task: "demo task",
              dataScopes: ["task_text", "workspace_files", "env_inherit"],
              writeIntent: true,
              writeAuthorized: true,
              confirmed: true,
            },
            ag
          ),
        /缺少确认凭据|界面勾选不能代替确认/
      );
      assert.equal(ag.spawnCount, 0);

      const prep = externalAgentFlow.requestExternalAgent(
        userData,
        mockEvent(1),
        {
          task: "demo task",
          dataScopes: ["task_text", "workspace_files", "env_inherit"],
          writeIntent: true,
        },
        ag
      );
      await assert.rejects(
        () =>
          externalAgentFlow.runExternalAgent(
            userData,
            mockEvent(1),
            {
              task: "demo task",
              dataScopes: ["task_text", "workspace_files", "env_inherit"],
              writeIntent: true,
              confirmationToken: "forged-token-id",
            },
            ag
          ),
        /无效|校验失败/
      );
      assert.equal(ag.spawnCount, 0);
      assert.ok(prep.confirmationToken);
    } finally {
      cleanup(userData);
    }
  });

  await test("8. unconfirmed and audit failure before approved keep spawn at 0", async () => {
    confirmationStore.clearAllForTests();
    const userData = tempUserData("audit-fail");
    const ag = agentsModule(cliAgent());
    const originalAppend = decisionAudit.appendEntry;
    let appendCalls = 0;
    decisionAudit.appendEntry = (ud, fields) => {
      appendCalls += 1;
      if (fields.event === "execution_approved") {
        throw new Error("simulated disk full");
      }
      return originalAppend(ud, fields);
    };
    try {
      const prep = externalAgentFlow.requestExternalAgent(
        userData,
        mockEvent(2),
        {
          task: "demo",
          dataScopes: ["task_text", "workspace_files", "env_inherit"],
          writeIntent: true,
        },
        ag
      );
      await assert.rejects(
        () =>
          externalAgentFlow.runExternalAgent(
            userData,
            mockEvent(2),
            {
              task: "demo",
              dataScopes: ["task_text", "workspace_files", "env_inherit"],
              writeIntent: true,
              confirmationToken: prep.confirmationToken,
            },
            ag
          ),
        /决策记录写入失败/
      );
      assert.equal(ag.spawnCount, 0);
      assert.ok(appendCalls >= 3);
    } finally {
      decisionAudit.appendEntry = originalAppend;
      cleanup(userData);
    }
  });

  await test("9. confirmed run forms full event chain without leaking secrets", async () => {
    confirmationStore.clearAllForTests();
    const userData = tempUserData("full-chain");
    const secretTask = "run with secret=SUPER_SECRET_12345";
    const ag = agentsModule(cliAgent());
    try {
      const prep = externalAgentFlow.requestExternalAgent(
        userData,
        mockEvent(3),
        {
          task: secretTask,
          dataScopes: ["task_text", "workspace_files", "env_inherit"],
          writeIntent: true,
        },
        ag
      );
      await externalAgentFlow.runExternalAgent(
        userData,
        mockEvent(3),
        {
          task: secretTask,
          dataScopes: ["task_text", "workspace_files", "env_inherit"],
          writeIntent: true,
          confirmationToken: prep.confirmationToken,
        },
        ag
      );
      assert.equal(ag.spawnCount, 1);
      const listed = decisionAudit.list(userData, { limit: 50 });
      assert.equal(listed.healthy, true);
      const events = listed.entries.map((e) => e.event).reverse();
      assert.ok(events.includes("policy_evaluated"));
      assert.ok(events.includes("confirmation_issued"));
      assert.ok(events.includes("confirmation_consumed"));
      assert.ok(events.includes("execution_approved"));
      assert.ok(events.includes("execution_started"));
      assert.ok(events.includes("execution_completed"));
      const raw = fs.readFileSync(
        path.join(userData, "decision-audit", "gen-1.jsonl"),
        "utf8"
      );
      assert.ok(!raw.includes("SUPER_SECRET_12345"));
      assert.ok(!raw.includes(secretTask));
      const completed = listed.entries.find((e) => e.event === "execution_completed");
      assert.ok(completed.outcome.outputSha256);
      assert.ok(completed.outcome.outputLength >= 0);
    } finally {
      cleanup(userData);
    }
  });

  await test("10. hash chain detects tamper and trailing partial line", () => {
    const userData = tempUserData("hash-chain");
    try {
      decisionAudit.appendEntry(userData, {
        event: "policy_evaluated",
        decisionId: "dec_a",
        policyVersion: "p1-04-v1",
        requestDigest: "abc",
        actor: "owner:renderer",
        purpose: "code_delegate",
        action: "external_cli_execute",
        dataScopes: ["task_text"],
        destination: "local_subprocess",
        outcome: { status: "require_confirmation" },
      });
      decisionAudit.appendEntry(userData, {
        event: "confirmation_issued",
        decisionId: "dec_a",
        policyVersion: "p1-04-v1",
        requestDigest: "abc",
        actor: "owner:renderer",
        purpose: "code_delegate",
        action: "external_cli_execute",
        dataScopes: ["task_text"],
        destination: "local_subprocess",
        outcome: { status: "awaiting_confirmation" },
      });
      let healthy = decisionAudit.verify(userData);
      assert.equal(healthy.healthy, true);

      const lp = path.join(userData, "decision-audit", "gen-1.jsonl");
      let lines = fs.readFileSync(lp, "utf8").trimEnd().split("\n");
      const tampered = JSON.parse(lines[0]);
      tampered.actor = "attacker";
      lines[0] = JSON.stringify(tampered);
      fs.writeFileSync(lp, lines.join("\n") + "\n", "utf8");
      healthy = decisionAudit.verify(userData);
      assert.equal(healthy.healthy, false);

      fs.writeFileSync(lp, lines.join("\n") + "\n{\"broken\":", "utf8");
      const partial = decisionAudit.verifyGeneration(userData, 1);
      assert.equal(partial.healthy, false);
      assert.ok(partial.issues.some((i) => i.type === "trailing_partial_line"));
    } finally {
      cleanup(userData);
    }
  });

  await test("11. rotate opens new generation and keeps old readable", () => {
    const userData = tempUserData("rotate");
    try {
      decisionAudit.appendEntry(userData, {
        event: "policy_evaluated",
        decisionId: "dec_old",
        policyVersion: "p1-04-v1",
        requestDigest: "x",
        actor: "owner:renderer",
        purpose: "code_delegate",
        action: "external_cli_execute",
        dataScopes: ["task_text"],
        destination: "local_subprocess",
        outcome: { status: "deny" },
      });
      const rotated = decisionAudit.rotate(userData);
      assert.equal(rotated.previousGeneration, 1);
      assert.equal(rotated.currentGeneration, 2);
      const old = decisionAudit.list(userData, { generation: 1, limit: 10 });
      assert.equal(old.entries.length, 1);
      const current = decisionAudit.list(userData, { generation: 2, limit: 10 });
      assert.ok(current.entries.some((e) => e.event === "generation_rotated"));
    } finally {
      cleanup(userData);
    }
  });

  await test("12. preload exposes no trusted auditAppend", () => {
    const preload = fs.readFileSync(path.join(__dirname, "..", "src", "preload.js"), "utf8");
    assert.ok(!preload.includes("l0AuditAppend"));
    assert.ok(!preload.includes("l0AuditClear"));
    assert.ok(preload.includes("decisionAuditList"));
    assert.ok(preload.includes("l0RequestExternalAgent"));
  });

  await test("13. digestTaskText and stableStringify behave deterministically", () => {
    const d1 = digestTaskText("hello");
    const d2 = digestTaskText("hello");
    assert.equal(d1.taskDigest, d2.taskDigest);
    assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
  });

  await test("14. digital-me-package tree unchanged (no writes from P1-04)", () => {
    if (!fs.existsSync(DEFAULT_PKG)) {
      console.log("SKIP package hash (digital-me-package not present)");
      return;
    }
    const repoRoot = path.join(__dirname, "..", "..");
    const diff = spawnSync("git", ["diff", "--quiet", "--", "digital-me-package"], {
      cwd: repoRoot,
    });
    assert.equal(diff.status, 0, "digital-me-package must not be modified");
    const fp = dirByteFingerprint(DEFAULT_PKG);
    console.log("INFO package fingerprint:", fp);
  });

  console.log("");
  console.log(`P1-04 results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);

  console.log("");
  console.log("Running P1-01..P1-03 regression...");
  const regress = spawnSync(process.execPath, ["scripts/test-p1-01-secret-store.cjs"], {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
  });
  if (regress.status !== 0) process.exit(regress.status || 1);
  const regress2 = spawnSync(process.execPath, ["scripts/test-p1-01-secret-leak-scan.cjs"], {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
  });
  if (regress2.status !== 0) process.exit(regress2.status || 1);
  const regress3 = spawnSync(process.execPath, ["scripts/test-p1-02-package-store.cjs"], {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
  });
  if (regress3.status !== 0) process.exit(regress3.status || 1);
  const regress4 = spawnSync(process.execPath, ["scripts/test-p1-03-subject-overview.cjs"], {
    cwd: path.join(__dirname, ".."),
    stdio: "inherit",
  });
  if (regress4.status !== 0) process.exit(regress4.status || 1);
  console.log("P1-01..P1-03 regression OK");
}

runAllTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
