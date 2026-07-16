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

const DEFAULT_PKG = path.join(__dirname, "..", "..", "digital-me-package");
const P100_BASELINE = path.join(__dirname, "..", "..", "build", "reports", "p1-00-package-baseline.json");

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
  return agentsLib.buildCliAgentSnapshot({
    id: "cli-coder",
    kind: "cli",
    name: "测试执行体",
    command: "C:\\tools\\cli\\echo.cmd",
    argsTemplate: ["{{task}}", "--safe"],
    cwd: "",
    enabled: true,
    ...overrides,
  });
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
    runCliAgent:
      runImpl ||
      (async () => {
        spawnCount += 1;
        return { ok: true, code: 0, output: "demo-output", aborted: false };
      }),
    get spawnCount() {
      return spawnCount;
    },
  };
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

function sha256File(target) {
  return crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
}

function walkFiles(root) {
  const out = [];
  function walk(dir) {
    const names = fs.readdirSync(dir).sort();
    for (const name of names) {
      const full = path.join(dir, name);
      const stat = fs.lstatSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else {
        out.push({
          relativePath: path.relative(root, full).split(path.sep).join("/"),
          size: stat.size,
          sha256: sha256File(full),
        });
      }
    }
  }
  walk(root);
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return out;
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

  await test("2. deny when CLI not configured or workspace_files missing", () => {
    const decision = evaluatePolicy(baseRequest(), { cliEnabled: false, hasCommand: false });
    assert.equal(decision.effect, "deny");
    assert.ok(decision.reasonCodes.includes("cli_not_configured"));
    const noWrite = evaluatePolicy(
      buildExternalCliRequest({
        taskText: "alpha",
        dataScopes: ["task_text", "env_inherit"],
        agent: cliAgent(),
        writeIntent: false,
      }),
      { cliEnabled: true, hasCommand: true }
    );
    assert.equal(noWrite.effect, "deny");
    assert.ok(noWrite.reasonCodes.includes("workspace_write_confirmation_required"));
  });

  await test("3. deny on missing or unknown fields", () => {
    const bad = evaluatePolicy({ actor: "owner:renderer" }, { cliEnabled: true, hasCommand: true });
    assert.equal(bad.effect, "deny");
    assert.ok(bad.reasonCodes.length > 0);
    const unknown = evaluatePolicy({ ...baseRequest(), action: "unknown_action" }, { cliEnabled: true, hasCommand: true });
    assert.equal(unknown.effect, "deny");
  });

  await test("4. request digest stable for key order and sensitive to semantic change", () => {
    const a = buildExternalCliRequest({
      taskText: "alpha",
      dataScopes: ["workspace_files", "task_text", "env_inherit"],
      agent: cliAgent(),
      writeIntent: true,
    });
    const b = buildExternalCliRequest({
      taskText: "alpha",
      dataScopes: ["env_inherit", "task_text", "workspace_files"],
      agent: cliAgent(),
      writeIntent: true,
    });
    assert.equal(buildRequestDigest(a), buildRequestDigest(b));
    const c = buildExternalCliRequest({
      taskText: "beta",
      dataScopes: ["env_inherit", "task_text", "workspace_files"],
      agent: cliAgent(),
      writeIntent: true,
    });
    assert.notEqual(buildRequestDigest(a), buildRequestDigest(c));
  });

  await test("5. request digest binds full command path and argsTemplate", () => {
    const pathA = buildExternalCliRequest({
      taskText: "alpha",
      dataScopes: ["task_text", "workspace_files", "env_inherit"],
      agent: cliAgent({ command: "C:\\tools\\agent-a\\echo.cmd" }),
      writeIntent: true,
    });
    const pathB = buildExternalCliRequest({
      taskText: "alpha",
      dataScopes: ["task_text", "workspace_files", "env_inherit"],
      agent: cliAgent({ command: "D:\\other\\echo.cmd" }),
      writeIntent: true,
    });
    const argsChanged = buildExternalCliRequest({
      taskText: "alpha",
      dataScopes: ["task_text", "workspace_files", "env_inherit"],
      agent: cliAgent({ argsTemplate: ["--mode=apply", "{{task}}"] }),
      writeIntent: true,
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
      ag.setAgent(cliAgent({ command: "D:\\changed\\echo.cmd" }));
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
      ag.setAgent(cliAgent({ argsTemplate: ["--changed", "{{task}}"] }));
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
        () => externalAgentFlow.confirmAuditRotate(userData, { decisionId: "x", rotationToken: "fake" }),
        /无效|失效/
      );
      const rotatePrep = externalAgentFlow.requestAuditRotate(userData);
      const rotated = externalAgentFlow.confirmAuditRotate(userData, rotatePrep);
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

  await test("19. digital-me-package matches P1-00 per-file baseline and manifest hash", () => {
    if (!fs.existsSync(DEFAULT_PKG) || !fs.existsSync(P100_BASELINE)) {
      console.log("SKIP package baseline compare");
      return;
    }
    const baseline = JSON.parse(fs.readFileSync(P100_BASELINE, "utf8"));
    assert.equal(
      baseline.packageDigest && baseline.packageDigest.manifestSha256,
      "3309ea5b286fdf93fc5e1b4af9a9664b6738aa6bb71902cba676d2d523e6d42a"
    );
    const expected = baseline.files.map((item) => ({
      relativePath: item.relativePath,
      size: item.size,
      sha256: item.sha256,
    }));
    assert.deepEqual(walkFiles(DEFAULT_PKG), expected);
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
