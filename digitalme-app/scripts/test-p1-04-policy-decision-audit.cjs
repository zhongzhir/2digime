"use strict";

/**
 * P1-04 PolicyEngine + DecisionAudit + external CLI gate tests (hermetic).
 * Does not read the real digital-me-package tree; real baseline is test:p1-baseline-real.
 * Run: node scripts/test-p1-04-policy-decision-audit.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const {
  evaluatePolicy,
  buildExternalCliRequest,
  buildRequestDigest,
  POLICY_VERSION,
} = require("../src/policy-engine");
const { digestTaskText, stableStringify } = require("../src/policy-engine/digest");
const confirmationStore = require("../src/policy-engine/confirmation-store");
const decisionAudit = require("../src/decision-audit");
const externalAgentFlow = require("../src/orchestration/external-agent-flow");
const agentsLib = require("../src/orchestration/agents");
const { buildEntryHash } = require("../src/decision-audit/hash");
const toolBroker = require("../src/tool-broker");
const {
  createHermeticPackageFixture,
  cleanupHermeticPackageFixture,
  fingerprintPackage,
} = require("./hermetic-package-fixture.cjs");

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dm-p104-${label}-`));
  // Integration paths prepare a ToolBroker plan from userData; keep CLI ready by default.
  seedLocalCli(dir);
  return dir;
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function fakePlan(overrides = {}) {
  return {
    toolId: "local_cli",
    definitionVersion: "p1-05-v1",
    toolName: "测试工具",
    executable: "C:\\tools\\cli\\node.exe",
    executableBasename: "node.exe",
    executableFingerprint: "fp_" + (overrides._fp || "a"),
    args: ["demo"],
    argsTemplate: overrides.argsTemplate || ["{{task}}"],
    cwd: "C:\\tmp\\work",
    envKeyNames: ["SystemRoot", "TEMP", "TMP", "WINDIR"],
    timeoutMs: 60000,
    maxOutputBytes: 65536,
    dataScopes: ["env_inherit", "task_text", "workspace_files"],
    shell: false,
    ...overrides,
  };
}

function cliAgent(overrides = {}) {
  return agentsLib.buildCliAgentSnapshot({
    id: "cli-coder",
    kind: "cli",
    name: "测试执行体",
    executable: "C:\\tools\\cli\\node.exe",
    authorizedCwdRoot: "C:\\tmp\\work",
    argsTemplate: ["{{task}}"],
    enabled: true,
    ...overrides,
  });
}

function policyContext(extra = {}) {
  return { cliEnabled: true, hasCommand: true, hasPlan: true, ...extra };
}

function seedLocalCli(userData, overrides = {}) {
  const cwd = overrides.cwd || path.join(userData, "workdir");
  fs.mkdirSync(cwd, { recursive: true });
  const saved = toolBroker.saveNarrowSettings(userData, {
    executable: overrides.executable || process.execPath,
    authorizedCwdRoot: cwd,
    enabled: overrides.enabled !== false,
    timeoutMs: overrides.timeoutMs,
    maxOutputBytes: overrides.maxOutputBytes,
  });
  assert.equal(saved.ok, true, String((saved.reasonCodes || []).join(",")));
  return cwd;
}

function agentsModule(agent, runImpl) {
  let spawnCount = 0;
  let current = { ...agent };
  return {
    getActiveAgent() {
      return { ...current };
    },
    getActiveCliAgentSnapshot() {
      return { ...current };
    },
    setAgent(next) {
      current = { ...next };
    },
    executePreparedPlan:
      runImpl ||
      (async () => {
        spawnCount += 1;
        return {
          ok: true,
          code: 0,
          output: "demo-output",
          aborted: false,
          timedOut: false,
          truncated: false,
          stdoutLen: 11,
          stderrLen: 0,
        };
      }),
    get spawnCount() {
      return spawnCount;
    },
  };
}

function mockEvent(senderId) {
  return { sender: { id: senderId } };
}

function baseRequest(task = "fix lint, secret=TEST_KEY_DO_NOT_LOG", planOverrides = {}) {
  const plan = fakePlan(planOverrides);
  const planDigest = "plan_" + (planOverrides._fp || "a");
  return buildExternalCliRequest({
    taskText: task,
    dataScopes: ["task_text", "workspace_files", "env_inherit"],
    agent: cliAgent(),
    writeIntent: true,
    plan,
    planDigest,
  });
}

function appendManualLedgerEntry(userData, generation, fields, previousHash, sequence) {
  const entry = {
    generation,
    sequence,
    at: new Date().toISOString(),
    event: fields.event,
    decisionId: fields.decisionId,
    policyVersion: POLICY_VERSION,
    requestDigest: fields.requestDigest,
    actor: fields.actor,
    purpose: fields.purpose,
    action: fields.action,
    dataScopes: [...fields.dataScopes].sort(),
    destination: fields.destination,
    approval: fields.approval || null,
    outcome: fields.outcome || null,
    previousHash,
  };
  entry.entryHash = buildEntryHash(previousHash, entry);
  fs.appendFileSync(path.join(userData, "decision-audit", `gen-${generation}.jsonl`), JSON.stringify(entry) + "\n", "utf8");
  return entry;
}

async function runAllTests() {
  confirmationStore.clearAllForTests();

  await test("1. external_cli_execute requires confirmation when CLI configured", () => {
    const decision = evaluatePolicy(baseRequest(), policyContext());
    assert.equal(decision.effect, "require_confirmation");
    assert.ok(decision.reasonCodes.includes("external_cli_requires_confirmation"));
    assert.ok(decision.confirmationSummary);
    assert.ok(decision.requestDigest);
  });

  await test("2. deny when CLI not configured or workspace_files missing", () => {
    const decision = evaluatePolicy(baseRequest(), policyContext({ cliEnabled: false, hasCommand: false, hasPlan: false }));
    assert.equal(decision.effect, "deny");
    assert.ok(decision.reasonCodes.includes("cli_not_configured"));
    const noWrite = evaluatePolicy(
      buildExternalCliRequest({
        taskText: "alpha",
        dataScopes: ["task_text", "env_inherit"],
        agent: cliAgent(),
        writeIntent: false,
        plan: fakePlan(),
        planDigest: "plan_a",
      }),
      policyContext()
    );
    assert.equal(noWrite.effect, "deny");
    assert.ok(noWrite.reasonCodes.includes("workspace_write_confirmation_required"));
  });

  await test("3. deny on missing or unknown fields", () => {
    const bad = evaluatePolicy({ actor: "owner:renderer" }, policyContext());
    assert.equal(bad.effect, "deny");
    assert.ok(bad.reasonCodes.length > 0);
    const unknown = evaluatePolicy({ ...baseRequest(), action: "unknown_action" }, policyContext());
    assert.equal(unknown.effect, "deny");
  });

  await test("4. request digest stable for key order and sensitive to semantic change", () => {
    const a = buildExternalCliRequest({
      taskText: "alpha",
      dataScopes: ["workspace_files", "task_text", "env_inherit"],
      agent: cliAgent(),
      writeIntent: true,
      plan: fakePlan(),
      planDigest: "plan_a",
    });
    const b = buildExternalCliRequest({
      taskText: "alpha",
      dataScopes: ["env_inherit", "task_text", "workspace_files"],
      agent: cliAgent(),
      writeIntent: true,
      plan: fakePlan(),
      planDigest: "plan_a",
    });
    assert.equal(buildRequestDigest(a), buildRequestDigest(b));
    const c = buildExternalCliRequest({
      taskText: "beta",
      dataScopes: ["env_inherit", "task_text", "workspace_files"],
      agent: cliAgent(),
      writeIntent: true,
      plan: fakePlan(),
      planDigest: "plan_a",
    });
    assert.notEqual(buildRequestDigest(a), buildRequestDigest(c));
  });

  await test("5. request digest binds executable fingerprint and argsTemplate", () => {
    const pathA = buildExternalCliRequest({
      taskText: "alpha",
      dataScopes: ["task_text", "workspace_files", "env_inherit"],
      agent: cliAgent(),
      writeIntent: true,
      plan: fakePlan({ executable: "C:\\tools\\agent-a\\node.exe", _fp: "a" }),
      planDigest: "plan_a",
    });
    const pathB = buildExternalCliRequest({
      taskText: "alpha",
      dataScopes: ["task_text", "workspace_files", "env_inherit"],
      agent: cliAgent(),
      writeIntent: true,
      plan: fakePlan({
        executable: "D:\\other\\node.exe",
        executableFingerprint: "fp_b",
        _fp: "b",
      }),
      planDigest: "plan_b",
    });
    const argsChanged = buildExternalCliRequest({
      taskText: "alpha",
      dataScopes: ["task_text", "workspace_files", "env_inherit"],
      agent: cliAgent(),
      writeIntent: true,
      plan: fakePlan({ argsTemplate: ["--mode=apply", "{{task}}"], _fp: "c" }),
      planDigest: "plan_c",
    });
    assert.notEqual(buildRequestDigest(pathA), buildRequestDigest(pathB));
    assert.notEqual(buildRequestDigest(pathA), buildRequestDigest(argsChanged));
  });

  await test("6. confirmation token binds, consumes once, rejects replay", () => {
    confirmationStore.clearAllForTests();
    const req = baseRequest();
    const digest = buildRequestDigest(req);
    const { tokenId } = confirmationStore.issueToken({
      requestDigest: digest,
      actor: req.actor,
      action: req.action,
      destination: req.destination,
      dataScopes: req.dataScopes,
      cwd: req.resource.cwdNormalized,
      senderId: "7",
      taskDigest: req.taskDigest,
      decisionId: "dec_test",
      executorConfigFingerprint: req.resource.configFingerprint,
    });
    const ok = confirmationStore.consumeToken(tokenId, {
      requestDigest: digest,
      actor: req.actor,
      action: req.action,
      destination: req.destination,
      dataScopes: req.dataScopes,
      cwd: req.resource.cwdNormalized,
      senderId: "7",
      taskDigest: req.taskDigest,
      decisionId: "dec_test",
      executorConfigFingerprint: req.resource.configFingerprint,
    });
    assert.equal(ok.ok, true);
    const replay = confirmationStore.consumeToken(tokenId, {
      requestDigest: digest,
      actor: req.actor,
      action: req.action,
      destination: req.destination,
      dataScopes: req.dataScopes,
      cwd: req.resource.cwdNormalized,
      senderId: "7",
      taskDigest: req.taskDigest,
      decisionId: "dec_test",
      executorConfigFingerprint: req.resource.configFingerprint,
    });
    assert.equal(replay.ok, false);
    assert.equal(replay.reason, "token_replayed");
  });

  await test("7. token rejects expiry, tamper, sender mismatch, and fixed TTL ignores renderer", () => {
    confirmationStore.clearAllForTests();
    const req = baseRequest();
    const digest = buildRequestDigest(req);
    const short = confirmationStore.issueToken({
      requestDigest: digest,
      actor: req.actor,
      action: req.action,
      destination: req.destination,
      dataScopes: req.dataScopes,
      cwd: req.resource.cwdNormalized,
      senderId: "1",
      taskDigest: req.taskDigest,
      decisionId: "dec_exp",
      executorConfigFingerprint: req.resource.configFingerprint,
    });
    const forcedExpired = confirmationStore.peekToken(short.tokenId);
    forcedExpired.expiresAt = new Date(Date.now() - 1000).toISOString();
    const expired = confirmationStore.consumeToken(short.tokenId, {
      requestDigest: digest,
      actor: req.actor,
      action: req.action,
      destination: req.destination,
      dataScopes: req.dataScopes,
      cwd: req.resource.cwdNormalized,
      senderId: "1",
      taskDigest: req.taskDigest,
      decisionId: "dec_exp",
      executorConfigFingerprint: req.resource.configFingerprint,
    });
    assert.equal(expired.reason, "token_expired");

    const issued = confirmationStore.issueToken({
      requestDigest: digest,
      actor: req.actor,
      action: req.action,
      destination: req.destination,
      dataScopes: req.dataScopes,
      cwd: req.resource.cwdNormalized,
      senderId: "1",
      taskDigest: req.taskDigest,
      decisionId: "dec_tamper",
      executorConfigFingerprint: req.resource.configFingerprint,
    });
    const tampered = confirmationStore.consumeToken(issued.tokenId, {
      requestDigest: digest + "ff",
      actor: req.actor,
      action: req.action,
      destination: req.destination,
      dataScopes: req.dataScopes,
      cwd: req.resource.cwdNormalized,
      senderId: "1",
      taskDigest: req.taskDigest,
      decisionId: "dec_tamper",
      executorConfigFingerprint: req.resource.configFingerprint,
    });
    assert.equal(tampered.reason, "token_binding_mismatch");
    const senderBad = confirmationStore.consumeToken(issued.tokenId, {
      requestDigest: digest,
      actor: req.actor,
      action: req.action,
      destination: req.destination,
      dataScopes: req.dataScopes,
      cwd: req.resource.cwdNormalized,
      senderId: "999",
      taskDigest: req.taskDigest,
      decisionId: "dec_tamper",
      executorConfigFingerprint: req.resource.configFingerprint,
    });
    assert.equal(senderBad.reason, "token_binding_mismatch");

    const userData = tempUserData("ttl");
    try {
      const ag = agentsModule(cliAgent());
      const prep = externalAgentFlow.requestExternalAgent(
        userData,
        mockEvent(4),
        {
          task: "ttl test",
          dataScopes: ["task_text", "workspace_files", "env_inherit"],
          writeIntent: true,
          confirmationTtlMs: 86400000,
        },
        ag
      );
      const ttl = Date.parse(prep.expiresAt) - Date.now();
      assert.ok(ttl <= confirmationStore.DEFAULT_TTL_MS + 2000);
    } finally {
      cleanup(userData);
    }
  });

  await test("8. renderer booleans, fake token, and missing workspace_files cannot execute", async () => {
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
      assert.throws(
        () =>
          externalAgentFlow.requestExternalAgent(
            userData,
            mockEvent(1),
            {
              task: "demo task",
              dataScopes: ["task_text", "env_inherit"],
              writeIntent: false,
            },
            ag
          ),
        /必须先明确确认可改动授权目录中的文件/
      );
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
              decisionId: prep.decisionId,
              confirmationToken: "forged-token-id",
            },
            ag
          ),
        /无效|校验失败/
      );
      assert.equal(ag.spawnCount, 0);
    } finally {
      cleanup(userData);
    }
  });

  await test("9. tampered ledger and trailing partial block execution with spawn=0", async () => {
    confirmationStore.clearAllForTests();
    const userData = tempUserData("tamper-block");
    const ag = agentsModule(cliAgent());
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
      const lp = path.join(userData, "decision-audit", "gen-1.jsonl");
      const lines = fs.readFileSync(lp, "utf8").trimEnd().split("\n");
      const row = JSON.parse(lines[0]);
      row.actor = "attacker";
      lines[0] = JSON.stringify(row);
      fs.writeFileSync(lp, lines.join("\n") + "\n", "utf8");
      await assert.rejects(
        () =>
          externalAgentFlow.runExternalAgent(
            userData,
            mockEvent(2),
            {
              task: "demo",
              dataScopes: ["task_text", "workspace_files", "env_inherit"],
              writeIntent: true,
              decisionId: prep.decisionId,
              confirmationToken: prep.confirmationToken,
            },
            ag
          ),
        /完整性异常/
      );
      assert.equal(ag.spawnCount, 0);
    } finally {
      cleanup(userData);
    }

    const userData2 = tempUserData("partial-block");
    const ag2 = agentsModule(cliAgent());
    try {
      const prep2 = externalAgentFlow.requestExternalAgent(
        userData2,
        mockEvent(2),
        {
          task: "demo",
          dataScopes: ["task_text", "workspace_files", "env_inherit"],
          writeIntent: true,
        },
        ag2
      );
      fs.appendFileSync(path.join(userData2, "decision-audit", "gen-1.jsonl"), "{\"broken\":", "utf8");
      await assert.rejects(
        () =>
          externalAgentFlow.runExternalAgent(
            userData2,
            mockEvent(2),
            {
              task: "demo",
              dataScopes: ["task_text", "workspace_files", "env_inherit"],
              writeIntent: true,
              decisionId: prep2.decisionId,
              confirmationToken: prep2.confirmationToken,
            },
            ag2
          ),
        /完整性异常/
      );
      assert.equal(ag2.spawnCount, 0);
    } finally {
      cleanup(userData2);
    }
  });

  await test("10. meta corrupt, missing, and stale-to-ledger recover uniquely", () => {
    const userData = tempUserData("meta-recover");
    try {
      const first = decisionAudit.appendEntry(userData, {
        event: "policy_evaluated",
        decisionId: "dec_a",
        policyVersion: POLICY_VERSION,
        requestDigest: "abc",
        actor: "owner:renderer",
        purpose: "code_delegate",
        action: "external_cli_execute",
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
        destination: "local_subprocess",
        outcome: { status: "require_confirmation" },
      });
      fs.writeFileSync(decisionAudit.metaPath(userData), "{broken", "utf8");
      const recoveredCorrupt = decisionAudit.resolveState(userData, { allowRecover: true });
      assert.equal(recoveredCorrupt.ok, true);
      assert.equal(recoveredCorrupt.state.lastSequence, 1);
      assert.equal(recoveredCorrupt.state.lastHash, first.entryHash);

      fs.unlinkSync(decisionAudit.metaPath(userData));
      const recoveredMissing = decisionAudit.resolveState(userData, { allowRecover: true });
      assert.equal(recoveredMissing.ok, true);
      assert.equal(recoveredMissing.state.lastSequence, 1);

      decisionAudit.writeMetaAtomic(userData, {
        version: 2,
        currentGeneration: 1,
        lastSequence: 1,
        lastHash: first.entryHash,
        generationCount: 1,
      });
      const second = appendManualLedgerEntry(
        userData,
        1,
        {
          event: "confirmation_issued",
          decisionId: "dec_a",
          requestDigest: "abc",
          actor: "owner:renderer",
          purpose: "code_delegate",
          action: "external_cli_execute",
          dataScopes: ["task_text", "workspace_files", "env_inherit"],
          destination: "local_subprocess",
          outcome: { status: "awaiting_confirmation" },
        },
        first.entryHash,
        2
      );
      const recoveredLag = decisionAudit.resolveState(userData, { allowRecover: true });
      assert.equal(recoveredLag.ok, true);
      assert.equal(recoveredLag.state.lastSequence, 2);
      assert.equal(recoveredLag.state.lastHash, second.entryHash);
      const third = decisionAudit.appendEntry(userData, {
        event: "confirmation_consumed",
        decisionId: "dec_a",
        policyVersion: POLICY_VERSION,
        requestDigest: "abc",
        actor: "owner:renderer",
        purpose: "code_delegate",
        action: "external_cli_execute",
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
        destination: "local_subprocess",
        outcome: { status: "confirmed" },
      });
      assert.equal(third.sequence, 3);
    } finally {
      cleanup(userData);
    }
  });

  await test("11. audit failure before approved keep spawn at 0", async () => {
    confirmationStore.clearAllForTests();
    const userData = tempUserData("audit-fail");
    const ag = agentsModule(cliAgent());
    const originalAppend = decisionAudit.appendEntry;
    let appendCalls = 0;
    decisionAudit.appendEntry = (ud, fields, options) => {
      appendCalls += 1;
      if (fields.event === "execution_approved") {
        throw new Error("simulated disk full");
      }
      return originalAppend(ud, fields, options);
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
              decisionId: prep.decisionId,
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

  await test("12. config drift after confirmation denies execution and audit omits bearer", async () => {
    confirmationStore.clearAllForTests();
    const userData = tempUserData("config-drift");
    const ag = agentsModule(cliAgent());
    try {
      const prep = externalAgentFlow.requestExternalAgent(
        userData,
        mockEvent(3),
        {
          task: "demo",
          dataScopes: ["task_text", "workspace_files", "env_inherit"],
          writeIntent: true,
        },
        ag
      );
      const driftedCwd = path.join(userData, "workdir-drift");
      fs.mkdirSync(driftedCwd, { recursive: true });
      const drifted = toolBroker.saveNarrowSettings(userData, {
        executable: process.execPath,
        authorizedCwdRoot: driftedCwd,
        enabled: true,
      });
      assert.equal(drifted.ok, true);
      await assert.rejects(
        () =>
          externalAgentFlow.runExternalAgent(
            userData,
            mockEvent(3),
            {
              task: "demo",
              dataScopes: ["task_text", "workspace_files", "env_inherit"],
              writeIntent: true,
              decisionId: prep.decisionId,
              confirmationToken: prep.confirmationToken,
            },
            ag
          ),
        /执行配置与确认时不一致|重新发起/
      );

      // Restore primary cwd then issue a new confirmation; drift timeout afterwards.
      seedLocalCli(userData);
      const prep2 = externalAgentFlow.requestExternalAgent(
        userData,
        mockEvent(3),
        {
          task: "demo2",
          dataScopes: ["task_text", "workspace_files", "env_inherit"],
          writeIntent: true,
        },
        ag
      );
      const timeoutDrift = toolBroker.saveNarrowSettings(userData, {
        executable: process.execPath,
        authorizedCwdRoot: path.join(userData, "workdir"),
        enabled: true,
        timeoutMs: 120000,
      });
      assert.equal(timeoutDrift.ok, true);
      await assert.rejects(
        () =>
          externalAgentFlow.runExternalAgent(
            userData,
            mockEvent(3),
            {
              task: "demo2",
              dataScopes: ["task_text", "workspace_files", "env_inherit"],
              writeIntent: true,
              decisionId: prep2.decisionId,
              confirmationToken: prep2.confirmationToken,
            },
            ag
          ),
        /执行配置与确认时不一致|重新发起/
      );
      const raw = fs.readFileSync(path.join(userData, "decision-audit", "gen-1.jsonl"), "utf8");
      assert.ok(!raw.includes(prep.confirmationToken));
      assert.ok(!raw.includes(prep2.confirmationToken));
    } finally {
      cleanup(userData);
    }
  });

  await test("13. confirmed run keeps one decision chain and no bearer token leakage", async () => {
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
          decisionId: prep.decisionId,
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
      assert.equal(new Set(listed.entries.map((e) => e.decisionId)).size, 1);
      assert.equal(listed.entries[0].decisionId, prep.decisionId);
      const raw = fs.readFileSync(path.join(userData, "decision-audit", "gen-1.jsonl"), "utf8");
      assert.ok(!raw.includes("SUPER_SECRET_12345"));
      assert.ok(!raw.includes(secretTask));
      assert.ok(!raw.includes(prep.confirmationToken));
      const completed = listed.entries.find((e) => e.event === "execution_completed");
      assert.ok(completed.outcome.outputSha256);
      assert.ok(completed.outcome.outputLength >= 0);
    } finally {
      cleanup(userData);
    }
  });

  await test("14. hash chain detects tamper and trailing partial line", () => {
    const userData = tempUserData("hash-chain");
    try {
      decisionAudit.appendEntry(userData, {
        event: "policy_evaluated",
        decisionId: "dec_a",
        policyVersion: POLICY_VERSION,
        requestDigest: "abc",
        actor: "owner:renderer",
        purpose: "code_delegate",
        action: "external_cli_execute",
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
        destination: "local_subprocess",
        outcome: { status: "require_confirmation" },
      });
      decisionAudit.appendEntry(userData, {
        event: "confirmation_issued",
        decisionId: "dec_a",
        policyVersion: POLICY_VERSION,
        requestDigest: "abc",
        actor: "owner:renderer",
        purpose: "code_delegate",
        action: "external_cli_execute",
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
        destination: "local_subprocess",
        outcome: { status: "awaiting_confirmation" },
      });
      let healthy = decisionAudit.verify(userData);
      assert.equal(healthy.healthy, true);
      const lp = path.join(userData, "decision-audit", "gen-1.jsonl");
      const lines = fs.readFileSync(lp, "utf8").trimEnd().split("\n");
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

  await test("15. cancel invalidates token and rotate requires main-process token", async () => {
    const userData = tempUserData("cancel-rotate");
    try {
      const ag = agentsModule(cliAgent());
      const prep = externalAgentFlow.requestExternalAgent(
        userData,
        mockEvent(9),
        {
          task: "demo",
          dataScopes: ["task_text", "workspace_files", "env_inherit"],
          writeIntent: true,
        },
        ag
      );
      externalAgentFlow.cancelExternalAgentConfirmation(
        userData,
        mockEvent(9),
        { decisionId: prep.decisionId, confirmationToken: prep.confirmationToken }
      );
      await assert.rejects(
        () =>
          externalAgentFlow.runExternalAgent(
            userData,
            mockEvent(9),
            {
              task: "demo",
              dataScopes: ["task_text", "workspace_files", "env_inherit"],
              writeIntent: true,
              decisionId: prep.decisionId,
              confirmationToken: prep.confirmationToken,
            },
            ag
          ),
        /已取消/
      );
      const listed = decisionAudit.list(userData, { limit: 50 });
      assert.ok(listed.entries.some((e) => e.event === "confirmation_canceled"));

      assert.throws(
        () =>
          externalAgentFlow.confirmAuditRotate(userData, mockEvent(9), {
            decisionId: "x",
            rotationToken: "fake",
          }),
        /无效|失效/
      );
      const rotatePrep = externalAgentFlow.requestAuditRotate(userData, mockEvent(9));
      const rotated = externalAgentFlow.confirmAuditRotate(userData, mockEvent(9), rotatePrep);
      assert.equal(rotated.currentGeneration, 2);
      const old = decisionAudit.list(userData, { generation: 1, limit: 20 });
      const current = decisionAudit.list(userData, { generation: 2, limit: 20 });
      assert.ok(old.entries.length > 0);
      assert.ok(current.entries.some((e) => e.event === "generation_rotated"));
    } finally {
      cleanup(userData);
    }
  });

  await test("16. UI exposes old generation viewer and global integrity messaging", () => {
    const html = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "index.html"), "utf8");
    const appJs = fs.readFileSync(path.join(__dirname, "..", "src", "renderer", "app.js"), "utf8");
    const preload = fs.readFileSync(path.join(__dirname, "..", "src", "preload.js"), "utf8");
    assert.match(html, /id="settings-audit-generation"/);
    assert.match(html, /可检测篡改，但不是签名或不可删除存证/);
    assert.match(appJs, /globalHealthy/);
    assert.match(preload, /decisionAuditRequestRotate/);
    assert.match(preload, /l0CancelExternalAgentConfirmation/);
  });

  await test("17. preload exposes no trusted auditAppend", () => {
    const preload = fs.readFileSync(path.join(__dirname, "..", "src", "preload.js"), "utf8");
    assert.ok(!preload.includes("l0AuditAppend"));
    assert.ok(!preload.includes("l0AuditClear"));
    assert.ok(preload.includes("decisionAuditList"));
    assert.ok(preload.includes("l0RequestExternalAgent"));
  });

  await test("18. digestTaskText and stableStringify behave deterministically", () => {
    const d1 = digestTaskText("hello");
    const d2 = digestTaskText("hello");
    assert.equal(d1.taskDigest, d2.taskDigest);
    assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
  });

  await test("19. hermetic package fixture fingerprint is stable (no real package)", () => {
    const { packageDir, expected, fingerprint } = createHermeticPackageFixture("p104");
    try {
      assert.deepEqual(fingerprint, expected);
      assert.deepEqual(fingerprintPackage(packageDir), expected);
      assert.ok(expected.fileCount >= 5);
      assert.ok(expected.manifestSha256);
      assert.ok(!packageDir.includes("digital-me-package"));
    } finally {
      cleanupHermeticPackageFixture(packageDir);
      assert.equal(fs.existsSync(packageDir), false);
    }
  });

  await test("20. deleting gen2 after rotate blocks next request and does not roll back to gen1", async () => {
    confirmationStore.clearAllForTests();
    const userData = tempUserData("delete-gen2");
    const ag = agentsModule(cliAgent());
    try {
      externalAgentFlow.requestExternalAgent(
        userData,
        mockEvent(1),
        {
          task: "seed",
          dataScopes: ["task_text", "workspace_files", "env_inherit"],
          writeIntent: true,
        },
        ag
      );
      const rotatePrep = externalAgentFlow.requestAuditRotate(userData, mockEvent(1));
      externalAgentFlow.confirmAuditRotate(userData, mockEvent(1), rotatePrep);
      assert.equal(decisionAudit.verify(userData).meta.currentGeneration, 2);
      fs.unlinkSync(path.join(userData, "decision-audit", "gen-2.jsonl"));
      const state = decisionAudit.resolveState(userData, { allowRecover: true });
      assert.equal(state.ok, false);
      assert.ok(
        state.assessment.reason === "meta_ahead_generation" ||
          state.assessment.reason === "meta_generation_missing" ||
          (state.verify && state.verify.healthy === false)
      );
      assert.throws(
        () =>
          externalAgentFlow.requestExternalAgent(
            userData,
            mockEvent(1),
            {
              task: "after delete",
              dataScopes: ["task_text", "workspace_files", "env_inherit"],
              writeIntent: true,
            },
            ag
          ),
        /完整性异常/
      );
      assert.equal(ag.spawnCount, 0);
      assert.equal(decisionAudit.parseMeta(userData).meta.currentGeneration, 2);
    } finally {
      cleanup(userData);
    }
  });

  await test("21. meta sequence ahead of ledger and truncated ledger both block", () => {
    const userData = tempUserData("meta-ahead");
    try {
      const first = decisionAudit.appendEntry(userData, {
        event: "policy_evaluated",
        decisionId: "dec_a",
        policyVersion: POLICY_VERSION,
        requestDigest: "abc",
        actor: "owner:renderer",
        purpose: "code_delegate",
        action: "external_cli_execute",
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
        destination: "local_subprocess",
        outcome: { status: "require_confirmation" },
      });
      const second = decisionAudit.appendEntry(userData, {
        event: "confirmation_issued",
        decisionId: "dec_a",
        policyVersion: POLICY_VERSION,
        requestDigest: "abc",
        actor: "owner:renderer",
        purpose: "code_delegate",
        action: "external_cli_execute",
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
        destination: "local_subprocess",
        outcome: { status: "awaiting_confirmation" },
      });
      decisionAudit.writeMetaAtomic(userData, {
        version: 2,
        currentGeneration: 1,
        lastSequence: 99,
        lastHash: second.entryHash,
        generationCount: 1,
      });
      const ahead = decisionAudit.resolveState(userData, { allowRecover: true });
      assert.equal(ahead.ok, false);
      assert.equal(ahead.assessment.reason, "meta_ahead_sequence");

      decisionAudit.writeMetaAtomic(userData, {
        version: 2,
        currentGeneration: 1,
        lastSequence: 2,
        lastHash: second.entryHash,
        generationCount: 1,
      });
      const lp = path.join(userData, "decision-audit", "gen-1.jsonl");
      const lines = fs.readFileSync(lp, "utf8").trimEnd().split("\n");
      fs.writeFileSync(lp, lines[0] + "\n", "utf8");
      const truncated = decisionAudit.resolveState(userData, { allowRecover: true });
      assert.equal(truncated.ok, false);
      assert.ok(
        truncated.assessment.reason === "meta_ahead_sequence" ||
          truncated.assessment.reason === "meta_hash_prefix_mismatch" ||
          truncated.assessment.reason === "ledger_unhealthy"
      );
      assert.ok(first.entryHash);
    } finally {
      cleanup(userData);
    }
  });

  await test("22. legal append/meta-fail and rotate/meta-fail recover forward uniquely", () => {
    const userData = tempUserData("forward-recover");
    try {
      const first = decisionAudit.appendEntry(userData, {
        event: "policy_evaluated",
        decisionId: "dec_a",
        policyVersion: POLICY_VERSION,
        requestDigest: "abc",
        actor: "owner:renderer",
        purpose: "code_delegate",
        action: "external_cli_execute",
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
        destination: "local_subprocess",
        outcome: { status: "require_confirmation" },
      });
      const second = appendManualLedgerEntry(
        userData,
        1,
        {
          event: "confirmation_issued",
          decisionId: "dec_a",
          requestDigest: "abc",
          actor: "owner:renderer",
          purpose: "code_delegate",
          action: "external_cli_execute",
          dataScopes: ["task_text", "workspace_files", "env_inherit"],
          destination: "local_subprocess",
          outcome: { status: "awaiting_confirmation" },
        },
        first.entryHash,
        2
      );
      decisionAudit.writeMetaAtomic(userData, {
        version: 2,
        currentGeneration: 1,
        lastSequence: 1,
        lastHash: first.entryHash,
        generationCount: 1,
      });
      const recovered = decisionAudit.resolveState(userData, { allowRecover: true });
      assert.equal(recovered.ok, true);
      assert.equal(recovered.state.lastSequence, 2);
      assert.equal(recovered.state.lastHash, second.entryHash);

      const rotated = decisionAudit.rotate(userData, { decisionId: "rot_test" });
      assert.equal(rotated.currentGeneration, 2);
      const tipBeforeMetaFail = decisionAudit.verify(userData).meta;
      // Simulate rotate ledger written but meta still on gen1 tip.
      decisionAudit.writeMetaAtomic(userData, {
        version: 2,
        currentGeneration: 1,
        lastSequence: 2,
        lastHash: second.entryHash,
        generationCount: 1,
      });
      const recoverRotate = decisionAudit.resolveState(userData, { allowRecover: true });
      assert.equal(recoverRotate.ok, true);
      assert.equal(recoverRotate.state.currentGeneration, 2);
      assert.equal(recoverRotate.state.lastHash, tipBeforeMetaFail.lastHash);
      assert.equal(recoverRotate.state.lastSequence, tipBeforeMetaFail.lastSequence);
    } finally {
      cleanup(userData);
    }
  });

  await test("23. tampered previousGenerationLastHash and missing generation_rotated are globally unhealthy", () => {
    const userData = tempUserData("gen-link");
    try {
      decisionAudit.appendEntry(userData, {
        event: "policy_evaluated",
        decisionId: "dec_old",
        policyVersion: POLICY_VERSION,
        requestDigest: "x",
        actor: "owner:renderer",
        purpose: "code_delegate",
        action: "external_cli_execute",
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
        destination: "local_subprocess",
        outcome: { status: "deny" },
      });
      decisionAudit.rotate(userData, { decisionId: "rot_ok" });
      const lp2 = path.join(userData, "decision-audit", "gen-2.jsonl");
      const lines = fs.readFileSync(lp2, "utf8").trimEnd().split("\n");
      const first = JSON.parse(lines[0]);
      first.outcome.previousGenerationLastHash = "f".repeat(64);
      // Recompute entryHash so only the link field is semantically wrong after rehash? Spec wants
      // tampering previousGenerationLastHash to be detected — either via link check on stored value
      // or via entry hash mismatch. Keep body change and recompute hash so chain is locally valid
      // but cross-gen link fails.
      const prevHash = first.previousHash;
      delete first.entryHash;
      first.entryHash = buildEntryHash(prevHash, first);
      lines[0] = JSON.stringify(first);
      fs.writeFileSync(lp2, lines.join("\n") + "\n", "utf8");
      decisionAudit.writeMetaAtomic(userData, {
        version: 2,
        currentGeneration: 2,
        lastSequence: 1,
        lastHash: first.entryHash,
        generationCount: 2,
      });
      const badLink = decisionAudit.verify(userData);
      assert.equal(badLink.healthy, false);
      assert.ok(badLink.issues.some((i) => i.type === "generation_link_hash_mismatch"));

      // Replace first event with a non-rotation record.
      const fake = {
        generation: 2,
        sequence: 1,
        at: new Date().toISOString(),
        event: "policy_evaluated",
        decisionId: "dec_fake",
        policyVersion: POLICY_VERSION,
        requestDigest: "y",
        actor: "owner:renderer",
        purpose: "code_delegate",
        action: "external_cli_execute",
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
        destination: "local_subprocess",
        approval: null,
        outcome: { status: "deny" },
        previousHash: decisionAudit.GENESIS_HASH,
      };
      fake.entryHash = buildEntryHash(decisionAudit.GENESIS_HASH, fake);
      fs.writeFileSync(lp2, JSON.stringify(fake) + "\n", "utf8");
      decisionAudit.writeMetaAtomic(userData, {
        version: 2,
        currentGeneration: 2,
        lastSequence: 1,
        lastHash: fake.entryHash,
        generationCount: 2,
      });
      const missingRotated = decisionAudit.verify(userData);
      assert.equal(missingRotated.healthy, false);
      assert.ok(missingRotated.issues.some((i) => i.type === "missing_generation_rotated"));
    } finally {
      cleanup(userData);
    }
  });

  await test("24. renderer-supplied first decisionId is ignored; rotate/cancel reject cross-sender and repeat cancel", async () => {
    confirmationStore.clearAllForTests();
    const userData = tempUserData("trusted-ids");
    const ag = agentsModule(cliAgent());
    try {
      const prep = externalAgentFlow.requestExternalAgent(
        userData,
        mockEvent(1),
        {
          task: "demo",
          dataScopes: ["task_text", "workspace_files", "env_inherit"],
          writeIntent: true,
          decisionId: "dec_attacker_chosen",
        },
        ag
      );
      assert.notEqual(prep.decisionId, "dec_attacker_chosen");
      assert.match(prep.decisionId, /^dec_/);

      assert.throws(
        () =>
          externalAgentFlow.cancelExternalAgentConfirmation(userData, mockEvent(99), {
            decisionId: prep.decisionId,
            confirmationToken: prep.confirmationToken,
          }),
        /不一致|校验失败/
      );
      externalAgentFlow.cancelExternalAgentConfirmation(userData, mockEvent(1), {
        decisionId: prep.decisionId,
        confirmationToken: prep.confirmationToken,
      });
      assert.throws(
        () =>
          externalAgentFlow.cancelExternalAgentConfirmation(userData, mockEvent(1), {
            decisionId: prep.decisionId,
            confirmationToken: prep.confirmationToken,
          }),
        /已取消/
      );
      const cancels = decisionAudit
        .list(userData, { limit: 50 })
        .entries.filter((e) => e.event === "confirmation_canceled");
      assert.equal(cancels.length, 1);

      const rotatePrep = externalAgentFlow.requestAuditRotate(userData, mockEvent(3));
      assert.throws(
        () => externalAgentFlow.confirmAuditRotate(userData, mockEvent(4), rotatePrep),
        /不一致|校验失败/
      );
      const rotated = externalAgentFlow.confirmAuditRotate(userData, mockEvent(3), rotatePrep);
      assert.equal(rotated.currentGeneration, 2);
    } finally {
      cleanup(userData);
    }
  });

  await test("25. meta with history but all ledgers deleted is unhealthy and not re-initialized empty", () => {
    const userData = tempUserData("ledgers-gone");
    try {
      decisionAudit.appendEntry(userData, {
        event: "policy_evaluated",
        decisionId: "dec_a",
        policyVersion: POLICY_VERSION,
        requestDigest: "abc",
        actor: "owner:renderer",
        purpose: "code_delegate",
        action: "external_cli_execute",
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
        destination: "local_subprocess",
        outcome: { status: "deny" },
      });
      fs.unlinkSync(path.join(userData, "decision-audit", "gen-1.jsonl"));
      const state = decisionAudit.resolveState(userData, {
        allowInitialize: true,
        allowRecover: true,
      });
      assert.equal(state.ok, false);
      assert.equal(state.assessment.reason, "ledgers_deleted");
      const meta = decisionAudit.parseMeta(userData).meta;
      assert.ok(meta.lastSequence > 0);
    } finally {
      cleanup(userData);
    }
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
