"use strict";

/**
 * P1-05 ToolBroker + local_cli isolation slice tests (hermetic package checks).
 * Uses real child_process paths for Windows-relevant failure cases.
 * Does not read the real digital-me-package tree; real baseline is test:p1-baseline-real.
 * Run: node scripts/test-p1-05-tool-broker.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const toolBroker = require("../src/tool-broker");
const { buildMinimalEnv } = require("../src/tool-broker/environment");
const { resolveAuthorizedCwd, looksLikeNetworkOrCloudSync } = require("../src/tool-broker/paths");
const {
  executePlan,
  killProcessTree,
  resolveTaskkillPath,
  taskkillEnv,
} = require("../src/tool-broker/executor");
const { POLICY_VERSION } = require("../src/policy-engine");
const confirmationStore = require("../src/policy-engine/confirmation-store");
const decisionAudit = require("../src/decision-audit");
const externalAgentFlow = require("../src/orchestration/external-agent-flow");
const agentsLib = require("../src/orchestration/agents");
const delegateRuntime = require("../src/orchestration/delegate-runtime");

const {
  createHermeticPackageFixture,
  cleanupHermeticPackageFixture,
  fingerprintPackage,
} = require("./hermetic-package-fixture.cjs");
const PRELOAD_PATH = path.join(__dirname, "..", "src", "preload.js");
const RENDERER_APP = path.join(__dirname, "..", "src", "renderer", "app.js");
const MAIN_PATH = path.join(__dirname, "..", "src", "main.js");

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
  return fs.mkdtempSync(path.join(os.tmpdir(), `dm-p105-${label}-`));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
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
  return { cwd, definition: saved.definition };
}

function mockEvent(senderId) {
  return { sender: { id: senderId } };
}

function agentsModule(userData, runImpl) {
  let spawnCount = 0;
  return {
    getActiveCliAgentSnapshot() {
      return agentsLib.getActiveCliAgentSnapshot(userData);
    },
    executePreparedPlan:
      runImpl ||
      (async (plan, opts) => {
        const result = await toolBroker.executePreparedPlan(plan, opts);
        if (result && result.spawned) spawnCount += 1;
        return result;
      }),
    get spawnCount() {
      return spawnCount;
    },
  };
}

/** Same-length UTF-16LE in-place replacements (keeps PE layout; breaks Authenticode). */
function patchUtf16leStrings(filePath, pairs) {
  let buf = Buffer.from(fs.readFileSync(filePath));
  for (const [from, to] of pairs) {
    assert.equal(from.length, to.length, `length mismatch: ${from} / ${to}`);
    const fromBuf = Buffer.from(from, "utf16le");
    const toBuf = Buffer.from(to, "utf16le");
    let idx = buf.indexOf(fromBuf);
    let hits = 0;
    while (idx !== -1) {
      toBuf.copy(buf, idx);
      hits += 1;
      idx = buf.indexOf(fromBuf, idx + 2);
    }
    assert.ok(hits > 0, `expected UTF-16LE hits for ${JSON.stringify(from)}`);
  }
  fs.writeFileSync(filePath, buf);
}

/** Overwrite a possibly-locked executable (Windows AV/Authenticode handle races). */
function replaceExecutableFile(target, fill) {
  const tmp = target + ".replace-tmp-" + process.pid + "-" + Date.now();
  fill(tmp);
  let lastErr = null;
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      fs.copyFileSync(tmp, target);
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* ignore */
      }
      return;
    } catch (err) {
      lastErr = err;
      const start = Date.now();
      while (Date.now() - start < 120) {
        /* spin wait for handle release */
      }
    }
  }
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  throw lastErr || new Error("replaceExecutableFile failed");
}

function nodePlan(args, overrides = {}) {
  const cwd = overrides.cwd || os.tmpdir();
  const env = buildMinimalEnv(["SystemRoot", "WINDIR", "TEMP", "TMP"], process.env, {
    includePath: false,
  });
  const resolved = toolBroker.resolveExecutable(overrides.executable || process.execPath);
  return {
    executable: resolved.executable,
    executableBasename: resolved.executableBasename,
    executableFingerprint: resolved.executableFingerprint,
    executableSize: resolved.size,
    executableMtimeMs: resolved.mtimeMs,
    executableSha256: resolved.sha256,
    args,
    cwd,
    env,
    _env: env,
    timeoutMs: overrides.timeoutMs || 10000,
    maxOutputBytes: overrides.maxOutputBytes || 4096,
    shell: false,
    envKeyNames: Object.keys(env),
  };
}

async function runAllTests() {
  confirmationStore.clearAllForTests();
  delegateRuntime.clearAllForTests();

  await test("1. unknown tool / profile identity / free-form executable fail-closed", () => {
    const userData = tempUserData("unknown");
    try {
      const badTool = toolBroker.preparePlan(userData, {
        toolId: "shell_any",
        taskText: "x",
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
      });
      assert.equal(badTool.ok, false);
      assert.ok(badTool.reasonCodes.includes("unknown_tool_id"));

      const hosts = [
        path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe"),
        path.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
        path.join(process.env.SystemRoot || "C:\\Windows", "System32", "wscript.exe"),
        path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cscript.exe"),
        path.join(process.env.SystemRoot || "C:\\Windows", "System32", "mshta.exe"),
      ];
      for (const exe of hosts) {
        if (!fs.existsSync(exe)) continue;
        const rejected = toolBroker.saveNarrowSettings(userData, {
          executable: exe,
          authorizedCwdRoot: path.join(userData, "w"),
          enabled: true,
        });
        assert.equal(rejected.ok, false, exe);
        assert.ok(
          rejected.reasonCodes.includes("profile_identity_mismatch"),
          exe + " => " + rejected.reasonCodes.join(",")
        );
      }

      const rel = toolBroker.saveNarrowSettings(userData, {
        executable: "node",
        authorizedCwdRoot: path.join(userData, "w"),
        enabled: true,
      });
      assert.equal(rel.ok, false);
      assert.ok(rel.reasonCodes.includes("executable_not_absolute"));

      const scriptBat = toolBroker.saveNarrowSettings(userData, {
        executable: path.join(userData, "x.bat"),
        authorizedCwdRoot: path.join(userData, "w"),
        enabled: true,
      });
      assert.equal(scriptBat.ok, false);
      assert.ok(scriptBat.reasonCodes.includes("forbidden_executable_type"));
    } finally {
      cleanup(userData);
    }
  });

  await test("2. VersionInfo-tampered cmd.exe copy rejected (spawn=0, no marker)", async () => {
    const userData = tempUserData("cmd-vi-tamper");
    const ag = agentsModule(userData);
    try {
      const work = path.join(userData, "workdir");
      fs.mkdirSync(work, { recursive: true });
      const marker = path.join(work, "p105-cmd-marker.txt");
      const cmdPath = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe");
      assert.ok(fs.existsSync(cmdPath));
      const renamed = path.join(work, "helper-tool.exe");
      fs.copyFileSync(cmdPath, renamed);

      // Strip cmd/Cmd/CMD VersionInfo labels to ordinary same-length names (old "exclude shell token" model would pass).
      patchUtf16leStrings(renamed, [
        ["Cmd.Exe", "AppTool"],
        ["CMD.EXE", "APPTOOL"],
        ["cmd.exe", "apptool"],
      ]);
      // InternalName value is typically the three-letter "cmd" — rewrite isolated UTF-16 token after common VersionInfo key layout.
      patchUtf16leStrings(renamed, [["cmd\u0000", "app\u0000"]]);

      const { extractVersionStrings } = require("../src/tool-broker/pe-identity");
      const vi = extractVersionStrings(renamed);
      assert.equal(vi.ok, true);
      const blob = `${vi.originalFilename}|${vi.internalName}|${vi.productName}|${vi.fileDescription}`.toLowerCase();
      assert.ok(!/\bcmd\b/.test(blob), "tamper must remove cmd identity labels: " + blob);

      const saved = toolBroker.saveNarrowSettings(userData, {
        executable: renamed,
        authorizedCwdRoot: work,
        enabled: true,
      });
      assert.equal(saved.ok, false);
      assert.ok(saved.reasonCodes.includes("profile_identity_mismatch"));

      // Hand-written registry + self-attested pin must not invent trust.
      const registryPath = path.join(userData, "tool-broker", "registry.json");
      fs.mkdirSync(path.dirname(registryPath), { recursive: true });
      fs.writeFileSync(
        registryPath,
        JSON.stringify(
          {
            version: 1,
            tools: {
              local_cli: {
                toolId: "local_cli",
                definitionVersion: "p1-05-v1",
                profileId: "local_cli_nodejs_v1",
                name: "本地命令工具",
                executable: renamed,
                argsTemplate: ["{{task}}"],
                allowedActions: ["execute_task"],
                timeoutMs: 60000,
                maxOutputBytes: 65536,
                envAllowlist: ["SystemRoot", "WINDIR", "TEMP", "TMP"],
                authorizedCwdRoot: work,
                enabled: true,
                pinnedIdentity: {
                  profileId: "local_cli_nodejs_v1",
                  contractId: "nodejs_openjs_v1",
                  originalFilename: "node.exe",
                  internalName: "node",
                  companyName: "Node.js",
                  fileDescription: "Node.js JavaScript Runtime",
                  productName: "Node.js",
                  signerSubject: "CN=OpenJS Foundation",
                },
              },
            },
          },
          null,
          2
        ),
        "utf8"
      );

      const prepared = toolBroker.preparePlan(userData, {
        taskText: `/c echo pwned> "${marker}"`,
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
      });
      assert.equal(prepared.ok, false);
      assert.ok(prepared.reasonCodes.includes("profile_identity_mismatch"));
      assert.equal(ag.spawnCount, 0);
      assert.ok(!fs.existsSync(marker));
    } finally {
      cleanup(userData);
    }
  });

  await test("3. spawn uses absolute executable + args array + shell:false; metacharacters literal", async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), "dm-p105-meta-"));
    try {
      const marker = path.join(work, "should-not-exist.txt");
      const evil = `echo > "${marker}" & calc`;
      const plan = nodePlan(
        ["-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))", evil],
        { cwd: work }
      );
      assert.equal(plan.shell, false);
      assert.ok(path.isAbsolute(plan.executable));
      const result = await toolBroker.executePreparedPlan(plan);
      assert.equal(result.ok, true);
      const parsed = JSON.parse(result.output);
      assert.ok(Array.isArray(parsed));
      assert.ok(parsed.includes(evil));
      assert.ok(!fs.existsSync(marker));
    } finally {
      cleanup(work);
    }
  });

  await test("4. PATH pin / fingerprint drift / fixed args contract", () => {
    const userData = tempUserData("drift");
    try {
      const work = path.join(userData, "workdir");
      fs.mkdirSync(work, { recursive: true });
      seedLocalCli(userData, { executable: process.execPath, cwd: work });
      const a = toolBroker.preparePlan(userData, {
        taskText: "--version",
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
      });
      assert.equal(a.ok, true);
      assert.deepEqual([...a.plan.argsTemplate], ["{{task}}"]);
      assert.deepEqual([...a.plan.args], ["--version"]);

      // Tampered widened argsTemplate on disk must be ignored (code-owned contract).
      const registryPath = path.join(userData, "tool-broker", "registry.json");
      const raw = JSON.parse(fs.readFileSync(registryPath, "utf8"));
      raw.tools.local_cli.argsTemplate = ["/c", "{{task}}"];
      fs.writeFileSync(registryPath, JSON.stringify(raw, null, 2), "utf8");
      const b = toolBroker.preparePlan(userData, {
        taskText: "--version",
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
      });
      assert.equal(b.ok, true);
      assert.deepEqual([...b.plan.args], ["--version"]);

      const copy = path.join(work, "node-copy" + path.extname(process.execPath));
      fs.copyFileSync(process.execPath, copy);
      toolBroker.saveNarrowSettings(userData, {
        executable: copy,
        authorizedCwdRoot: work,
        enabled: true,
      });
      const c = toolBroker.preparePlan(userData, {
        taskText: "--version",
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
      });
      assert.equal(c.ok, true);
      assert.notEqual(a.plan.executableFingerprint, c.plan.executableFingerprint);

      const env = buildMinimalEnv(["SystemRoot", "WINDIR", "TEMP", "TMP"], {
        SystemRoot: "C:\\Windows",
        PATH: work,
        SECRET_TEST_KEY: "should-not-leak",
      });
      assert.equal(env.PATH, "");
      assert.ok(!Object.keys(env).includes("SECRET_TEST_KEY"));
    } finally {
      cleanup(userData);
    }
  });

  await test("5. subprocess env only allowlisted keys; sentinel secret absent", async () => {
    process.env.DM_P105_SENTINEL = "super-secret-do-not-leak";
    try {
      const plan = nodePlan([
        "-e",
        "process.stdout.write(JSON.stringify(Object.keys(process.env).sort()))",
      ]);
      assert.ok(!Object.values(plan._env).includes("super-secret-do-not-leak"));
      assert.equal(plan._env.PATH, "");
      const result = await toolBroker.executePreparedPlan(plan);
      assert.equal(result.ok, true);
      const keys = JSON.parse(result.output);
      assert.ok(!keys.includes("DM_P105_SENTINEL"));
      const childPath = await new Promise((resolve) => {
        const { spawn } = require("node:child_process");
        const c = spawn(
          process.execPath,
          ["-e", "process.stdout.write(process.env.PATH === '' ? 'EMPTY' : 'NONEMPTY')"],
          { env: plan._env, shell: false, windowsHide: true }
        );
        let o = "";
        c.stdout.on("data", (d) => (o += d));
        c.on("close", () => resolve(o));
      });
      assert.equal(childPath, "EMPTY");
    } finally {
      delete process.env.DM_P105_SENTINEL;
    }
  });

  await test("6. cwd missing / escape / UNC / cloud-like paths rejected", () => {
    const userData = tempUserData("cwd");
    try {
      const work = path.join(userData, "workdir");
      fs.mkdirSync(work, { recursive: true });
      seedLocalCli(userData, { executable: process.execPath, cwd: work });
      assert.throws(() => resolveAuthorizedCwd(work, path.join(work, "missing-sub")), /cwd_missing|path_rejected/);
      assert.throws(() => resolveAuthorizedCwd(work, path.join(work, "..", "..")), /path_escape|path_rejected/);
      assert.throws(() => resolveAuthorizedCwd("\\\\server\\share", "\\\\server\\share\\a"), /network|path_rejected/);
      assert.ok(looksLikeNetworkOrCloudSync("C:\\\\Users\\\\x\\\\WPSDrive\\\\pkg"));
    } finally {
      cleanup(userData);
    }
  });

  await test("7. without workspace_files preparePlan fails and spawn=0", async () => {
    const userData = tempUserData("no-ws");
    const ag = agentsModule(userData);
    try {
      seedLocalCli(userData);
      agentsLib.setActiveAgent(userData, "cli-coder");
      const prepared = toolBroker.preparePlan(userData, {
        taskText: "x",
        dataScopes: ["task_text", "env_inherit"],
      });
      assert.equal(prepared.ok, false);
      assert.ok(prepared.reasonCodes.includes("workspace_files_required"));
      assert.throws(
        () =>
          externalAgentFlow.requestExternalAgent(
            userData,
            mockEvent(1),
            { task: "x", dataScopes: ["task_text", "env_inherit"], writeIntent: false },
            ag
          ),
        /必须先明确确认可改动授权目录中的文件/
      );
      assert.equal(ag.spawnCount, 0);
    } finally {
      cleanup(userData);
    }
  });

  await test("8. timeout/cancel reclaim; taskkill absolute path + orphanRisk fault injection", async () => {
    const tk = resolveTaskkillPath();
    if (process.platform === "win32") {
      assert.ok(tk);
      assert.ok(path.isAbsolute(tk));
      assert.ok(tk.toLowerCase().endsWith("\\system32\\taskkill.exe"));
      const env = taskkillEnv();
      assert.equal(env.PATH, "");
      assert.ok(!Object.keys(env).some((k) => k.toLowerCase() === "path" && env[k] !== ""));
    }

    // Real timeout reclaim
    const timed = await executePlan(
      nodePlan(["-e", "setTimeout(()=>{}, 20000)"], { timeoutMs: 600 })
    );
    assert.equal(timed.timedOut, true);
    assert.equal(timed.ok, false);
    if (timed.orphanRisk) {
      assert.equal(timed.orphanRisk, true);
    } else {
      assert.equal(timed.reclaim && timed.reclaim.orphanRisk, false);
    }

    // Cancel
    const ac = new AbortController();
    const pending = executePlan(
      nodePlan(["-e", "setTimeout(()=>{}, 20000)"], { timeoutMs: 60000 }),
      {}
    );
    // Need to pass signal on plan
    const pending2 = executePlan({
      ...nodePlan(["-e", "setTimeout(()=>{}, 20000)"], { timeoutMs: 60000 }),
      signal: ac.signal,
    });
    setTimeout(() => ac.abort(), 150);
    const canceled = await pending2;
    assert.equal(canceled.cancelled, true);
    void pending;

    // Fault: missing/hijacked taskkill path
    const hijack = await killProcessTree(process.pid, {
      taskkillPath: path.join(os.tmpdir(), "not-real-taskkill.exe"),
    });
    assert.equal(hijack.orphanRisk, true);

    // Fault: taskkill failure injection
    const failKill = await killProcessTree(999999, { forceTaskkillFail: true });
    assert.equal(failKill.orphanRisk, true);

    // Fault: target still alive after reclaim attempt
    const still = await killProcessTree(process.pid, {
      forceDead: false,
      forceStillAlive: true,
      forceTaskkillFail: false,
      // Use real taskkill against current process would be dangerous — mock via forceStillAlive only.
      killProcessTreeImpl: async () => ({
        reclaimed: false,
        orphanRisk: true,
        method: "taskkill",
        detail: "process_still_alive",
      }),
    });
    assert.equal(still.orphanRisk, true);
  });

  await test("9. combined output cap; full byte counts + streaming sha; audit not prefix-as-full", async () => {
    const userData = tempUserData("trunc");
    try {
      const plan = nodePlan(
        ["-e", "process.stdout.write('x'.repeat(100000)); process.stderr.write('y'.repeat(50000));"],
        { maxOutputBytes: 2048 }
      );
      const result = await toolBroker.executePreparedPlan(plan);
      assert.equal(result.truncated, true);
      assert.ok(result.totalBytes >= 100000);
      assert.ok(result.stdoutTotalBytes >= 100000);
      assert.ok(result.stderrTotalBytes >= 50000);
      assert.ok(result.retainedBytes <= 2048);
      assert.ok(result.fullOutputSha256);
      assert.ok(result.retainedSha256);
      assert.notEqual(result.fullOutputSha256, result.retainedSha256);
      assert.equal(result.outputDigestKind, "retained_prefix");

      const digest = decisionAudit.digestExecutionOutput(result);
      assert.equal(digest.truncated, true);
      assert.equal(digest.outputSha256, result.fullOutputSha256);
      assert.equal(digest.outputDigestKind, "full_stream");
      // Must not claim retained prefix hash is the full digest when truncated.
      assert.notEqual(digest.outputSha256, result.retainedSha256);

      seedLocalCli(userData, { maxOutputBytes: 2048 });
      agentsLib.setActiveAgent(userData, "cli-coder");
      const ag = agentsModule(userData, async () => {
        agSpawn();
        return result;
      });
      let spawn = 0;
      function agSpawn() {
        spawn += 1;
      }
      // Direct digest check above is the audit contract; ledger path covered in test 11.
      void spawn;
    } finally {
      cleanup(userData);
    }
  });

  await test("10. policy/confirm/audit failure keeps spawn=0", async () => {
    const userData = tempUserData("spawn0");
    const ag = agentsModule(userData);
    try {
      seedLocalCli(userData);
      agentsLib.setActiveAgent(userData, "cli-coder");
      await assert.rejects(
        () =>
          externalAgentFlow.runExternalAgent(
            userData,
            mockEvent(1),
            {
              task: "--version",
              dataScopes: ["task_text", "workspace_files", "env_inherit"],
              writeIntent: true,
              writeAuthorized: true,
            },
            ag
          ),
        /缺少确认凭据|界面勾选/
      );
      assert.equal(ag.spawnCount, 0);

      decisionAudit.appendEntry(userData, {
        event: "policy_evaluated",
        decisionId: "dec_x",
        policyVersion: POLICY_VERSION,
        requestDigest: "abc",
        actor: "owner:renderer",
        purpose: "code_delegate",
        action: "external_cli_execute",
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
        destination: "local_subprocess",
        outcome: { status: "require_confirmation" },
      });
      fs.appendFileSync(path.join(userData, "decision-audit", "gen-1.jsonl"), "{broken", "utf8");
      assert.throws(
        () =>
          externalAgentFlow.requestExternalAgent(
            userData,
            mockEvent(1),
            {
              task: "--version",
              dataScopes: ["task_text", "workspace_files", "env_inherit"],
              writeIntent: true,
            },
            ag
          ),
        /完整性异常/
      );
      assert.equal(ag.spawnCount, 0);
    } finally {
      cleanup(userData);
    }
  });

  await test("11. same decisionId/planDigest; full-chain with node --version", async () => {
    const userData = tempUserData("same-id");
    const ag = agentsModule(userData);
    try {
      seedLocalCli(userData, { executable: process.execPath });
      agentsLib.setActiveAgent(userData, "cli-coder");

      const prep = externalAgentFlow.requestExternalAgent(
        userData,
        mockEvent(11),
        {
          task: "--version",
          dataScopes: ["task_text", "workspace_files", "env_inherit"],
          writeIntent: true,
        },
        ag
      );
      assert.ok(prep.decisionId);
      assert.ok(prep.planDigest);
      assert.ok(prep.summary.notSandboxNotice);
      assert.ok(prep.summary.executableAbsolute);

      const result = await externalAgentFlow.runExternalAgent(
        userData,
        mockEvent(11),
        {
          task: "--version",
          dataScopes: ["task_text", "workspace_files", "env_inherit"],
          writeIntent: true,
          decisionId: prep.decisionId,
          confirmationToken: prep.confirmationToken,
        },
        ag
      );
      assert.equal(result.ok, true);
      assert.equal(ag.spawnCount, 1);
      const lines = fs
        .readFileSync(path.join(userData, "decision-audit", "gen-1.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      for (const row of lines) {
        if (row.decisionId && String(row.decisionId).startsWith("dec_")) {
          assert.equal(row.decisionId, prep.decisionId);
        }
      }
      const completed = lines.find((r) => r.event === "execution_completed");
      assert.ok(completed);
      assert.ok(completed.outcome.outputSha256);
      assert.ok(completed.outcome.outputDigestKind);
      assert.notEqual(completed.outcome.outputDigestKind, "retained_prefix");
    } finally {
      cleanup(userData);
    }
  });

  await test("12. preload/renderer/main expose no generic spawn; requestId + quit abort wiring", () => {
    const preload = fs.readFileSync(PRELOAD_PATH, "utf8");
    const appJs = fs.readFileSync(RENDERER_APP, "utf8");
    const mainJs = fs.readFileSync(MAIN_PATH, "utf8");
    assert.ok(!/spawn\s*\(/.test(preload));
    assert.ok(!/child_process/.test(preload));
    assert.ok(!/shell\s*:\s*true/.test(preload));
    assert.ok(!/cfg-cli-cmd/.test(appJs));
    assert.ok(/cfg-cli-executable/.test(appJs));
    assert.ok(/受限执行，不是安全沙箱|notSandboxNotice/.test(appJs));
    assert.ok(/delegateRuntime/.test(mainJs));
    assert.ok(/abortAllAndWait/.test(mainJs));
    assert.ok(/duplicate_request_id|相同请求编号/.test(mainJs));
    assert.ok(/abortForSender/.test(mainJs));
    assert.ok(/l0:external-agent-started/.test(mainJs));
    assert.ok(/onExternalAgentStarted/.test(fs.readFileSync(PRELOAD_PATH, "utf8")));
    assert.ok(/onExternalAgentStarted|l0StopExternalAgent/.test(fs.readFileSync(RENDERER_APP, "utf8")));
    assert.ok(/codeStopBusy|正在停止/.test(fs.readFileSync(RENDERER_APP, "utf8")));
  });

  await test("13. hermetic package fixture fingerprint is stable (no real package)", () => {
    const { packageDir, expected, fingerprint } = createHermeticPackageFixture("p105");
    try {
      assert.deepEqual(fingerprint, expected);
      assert.deepEqual(fingerprintPackage(packageDir), expected);
      assert.ok(expected.fileCount >= 5);
      assert.ok(!packageDir.includes("digital-me-package"));
    } finally {
      cleanupHermeticPackageFixture(packageDir);
      assert.equal(fs.existsSync(packageDir), false);
    }
  });

  await test("14. operationId mint; sender-bound stop; cross-sender/unknown no side effects", async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "dm-p105-bare-"));
    try {
      const s = toolBroker.getPublicSettings(bare);
      assert.equal(s.enabled, false);
      assert.deepEqual(s.argsTemplate, ["{{task}}"]);
    } finally {
      cleanup(bare);
    }

    delegateRuntime.clearAllForTests();
    const a = delegateRuntime.begin(mockEvent(7), "req_dup");
    assert.equal(a.ok, true);
    assert.ok(a.operationId.startsWith("op_"));
    assert.equal(a.senderId, "7");
    const b = delegateRuntime.begin(mockEvent(7), "req_dup");
    assert.equal(b.ok, false);
    assert.equal(b.reason, "duplicate_request_id");

    // Other sender with same client requestId is allowed (different key space).
    const c = delegateRuntime.begin(mockEvent(9), "req_dup");
    assert.equal(c.ok, true);
    assert.notEqual(c.operationId, a.operationId);

    // Cross-sender stop must not abort owner task.
    const cross = delegateRuntime.abortOne(mockEvent(9), a.operationId);
    assert.equal(cross.ok, false);
    assert.equal(cross.reason, "sender_mismatch");
    assert.equal(cross.aborted, false);
    assert.equal(a.abort.signal.aborted, false);

    const unknown = delegateRuntime.abortOne(mockEvent(7), "op_does_not_exist");
    assert.equal(unknown.ok, false);
    assert.equal(unknown.reason, "unknown_operation");

    const okStop = delegateRuntime.abortOne(mockEvent(7), a.operationId);
    assert.equal(okStop.ok, true);
    assert.equal(a.abort.signal.aborted, true);
    // Other sender's task still running.
    assert.equal(c.abort.signal.aborted, false);

    const repeat = delegateRuntime.abortOne(mockEvent(7), a.operationId);
    assert.equal(repeat.ok, true); // already aborted controller; still owner match
    assert.equal(c.abort.signal.aborted, false);

    let settled = false;
    const slow = new Promise((resolve) =>
      setTimeout(() => {
        settled = true;
        resolve({ ok: true });
      }, 50)
    );
    delegateRuntime.attachPromise(c.operationId, slow);
    const wait = await delegateRuntime.abortAllAndWait(2000);
    assert.equal(wait.ok, true);
    assert.equal(settled, true);
    delegateRuntime.clearAllForTests();
  });

  await test("15. kill failure → audit orphanRisk + user-facing risk wording (not 已停止)", async () => {
    const userData = tempUserData("orphan-chain");
    try {
      seedLocalCli(userData, { executable: process.execPath });
      agentsLib.setActiveAgent(userData, "cli-coder");
      let spawn = 0;
      const ag = agentsModule(userData, async () => {
        spawn += 1;
        return {
          ok: false,
          aborted: true,
          timedOut: false,
          truncated: false,
          orphanRisk: true,
          code: null,
          output: "",
          totalBytes: 0,
          stdoutTotalBytes: 0,
          stderrTotalBytes: 0,
          retainedBytes: 0,
          fullOutputSha256: "aa".repeat(32),
          retainedSha256: "bb".repeat(32),
          outputDigestKind: "full",
        };
      });

      const prep = externalAgentFlow.requestExternalAgent(
        userData,
        mockEvent(15),
        {
          task: "--version",
          dataScopes: ["task_text", "workspace_files", "env_inherit"],
          writeIntent: true,
        },
        ag
      );
      const result = await externalAgentFlow.runExternalAgent(
        userData,
        mockEvent(15),
        {
          task: "--version",
          dataScopes: ["task_text", "workspace_files", "env_inherit"],
          writeIntent: true,
          decisionId: prep.decisionId,
          confirmationToken: prep.confirmationToken,
        },
        ag
      );
      assert.equal(spawn, 1);
      assert.equal(result.orphanRisk, true);
      assert.equal(result.meta.orphanRisk, true);
      assert.ok(/残留进程|未能确认进程/.test(result.reply));
      assert.ok(!/^已停止外部程序/.test(result.reply));
      assert.ok(!result.reply.includes("已停止外部程序。") || /残留/.test(result.reply));

      const lines = fs
        .readFileSync(path.join(userData, "decision-audit", "gen-1.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      const canceled = lines.find((r) => r.event === "execution_canceled");
      assert.ok(canceled);
      assert.equal(canceled.outcome.orphanRisk, true);
    } finally {
      cleanup(userData);
    }
  });

  await test("16. abortAllAndWait reports risk; main before-quit must not silent-exit", async () => {
    delegateRuntime.clearAllForTests();
    const began = delegateRuntime.begin(mockEvent(3), "quit_risk");
    assert.equal(began.ok, true);
    delegateRuntime.attachPromise(
      began.operationId,
      new Promise(() => {
        /* hang */
      })
    );
    const wait = await delegateRuntime.abortAllAndWait(80);
    assert.equal(wait.timedOut, true);
    assert.equal(wait.ok, false);
    assert.ok(wait.remaining >= 1);

    const mainJs = fs.readFileSync(MAIN_PATH, "utf8");
    assert.ok(/abortAllAndWait/.test(mainJs));
    assert.ok(/仍要退出/.test(mainJs));
    assert.ok(/取消退出/.test(mainJs));
    assert.ok(/waitResult/.test(mainJs));
    assert.ok(/risky/.test(mainJs));
    delegateRuntime.clearAllForTests();
  });

  await test("17. renderer/main wiring for operationId stop and orphanRisk copy", () => {
    const appJs = fs.readFileSync(RENDERER_APP, "utf8");
    const mainJs = fs.readFileSync(MAIN_PATH, "utf8");
    const brokerIndex = fs.readFileSync(
      path.join(__dirname, "..", "src", "tool-broker", "index.js"),
      "utf8"
    );
    assert.ok(/codeOperationId/.test(appJs));
    assert.ok(/operationId:\s*(codeOperationId|oid)/.test(appJs));
    assert.ok(/残留进程/.test(appJs));
    assert.ok(/operationId/.test(mainJs));
    assert.ok(/sender_mismatch|missing_operation_id/.test(mainJs));
    assert.ok(/verifyLocalCliProfileIdentity/.test(brokerIndex));
    assert.ok(/assertExecutableUnchangedForSpawn|executable_changed_before_spawn/.test(brokerIndex));
    assert.ok(/onExternalAgentStarted/.test(appJs));
    assert.ok(/codeStopBusy/.test(appJs));
    assert.ok(/l0StopExternalAgent/.test(appJs));
  });

  await test("18. TOCTOU: replace executable after prepare/confirm → spawn=0 + audit deny", async () => {
    const { spawn: realSpawn } = require("node:child_process");
    const cases = [
      {
        name: "ordinary-file",
        replace(target) {
          replaceExecutableFile(target, (tmp) => {
            fs.writeFileSync(tmp, "not-a-pe-executable", "utf8");
          });
        },
      },
      {
        name: "tampered-cmd",
        replace(target) {
          replaceExecutableFile(target, (tmp) => {
            const cmdPath = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "cmd.exe");
            fs.copyFileSync(cmdPath, tmp);
            patchUtf16leStrings(tmp, [
              ["Cmd.Exe", "AppTool"],
              ["CMD.EXE", "APPTOOL"],
              ["cmd.exe", "apptool"],
            ]);
            patchUtf16leStrings(tmp, [["cmd\u0000", "app\u0000"]]);
          });
        },
      },
    ];

    for (const c of cases) {
      const userData = tempUserData(`toctou-${c.name}`);
      let actualSpawns = 0;
      try {
        const work = path.join(userData, "workdir");
        fs.mkdirSync(work, { recursive: true });
        const toolPath = path.join(work, "local-tool.exe");
        fs.copyFileSync(process.execPath, toolPath);
        seedLocalCli(userData, { executable: toolPath, cwd: work });
        agentsLib.setActiveAgent(userData, "cli-coder");

        const prepared = toolBroker.preparePlan(userData, {
          taskText: "--version",
          dataScopes: ["task_text", "workspace_files", "env_inherit"],
        });
        assert.equal(prepared.ok, true, c.name + " prepare: " + (prepared.reasonCodes || []).join(","));
        assert.ok(prepared.plan.executableFingerprint);
        assert.ok(prepared.plan.executableSha256);

        // Direct boundary: replace after prepare, before spawn.
        c.replace(toolPath);
        const direct = await toolBroker.executePreparedPlan(prepared.plan, {
          executorDeps: {
            spawn: (...args) => {
              actualSpawns += 1;
              return realSpawn(...args);
            },
          },
        });
        assert.equal(direct.ok, false, c.name);
        assert.equal(direct.spawned, false, c.name);
        assert.equal(direct.statusCode, "executable_changed_before_spawn", c.name);
        assert.ok(
          (direct.reasonCodes || []).includes("executable_changed_before_spawn"),
          c.name + " reasons=" + (direct.reasonCodes || []).join(",")
        );
        assert.equal(actualSpawns, 0, c.name + " direct spawn");

        // Restore good tool, then full confirm chain with replace injected at execute boundary.
        fs.copyFileSync(process.execPath, toolPath);
        try {
          const { clearAuthenticodeCacheForTests } = require("../src/tool-broker/authenticode");
          clearAuthenticodeCacheForTests();
        } catch {
          /* ignore */
        }
        confirmationStore.clearAllForTests();
        // Brief pause so prior Authenticode probes release file handles on Windows.
        await new Promise((r) => setTimeout(r, 250));
        const ag = {
          getActiveCliAgentSnapshot() {
            return agentsLib.getActiveCliAgentSnapshot(userData);
          },
          async executePreparedPlan(plan, opts) {
            c.replace(toolPath);
            // Self-attested pin must not bypass the spawn gate.
            const mutated = Object.assign({}, plan, {
              pinnedIdentity: {
                profileId: "local_cli_nodejs_v1",
                originalFilename: "node.exe",
                internalName: "node",
                companyName: "Node.js",
              },
            });
            return toolBroker.executePreparedPlan(mutated, {
              ...opts,
              executorDeps: {
                spawn: (...args) => {
                  actualSpawns += 1;
                  return realSpawn(...args);
                },
              },
            });
          },
        };

        const prep = externalAgentFlow.requestExternalAgent(
          userData,
          mockEvent(18),
          {
            task: "--version",
            dataScopes: ["task_text", "workspace_files", "env_inherit"],
            writeIntent: true,
          },
          ag
        );
        assert.ok(prep.confirmationToken, c.name);

        const result = await externalAgentFlow.runExternalAgent(
          userData,
          mockEvent(18),
          {
            task: "--version",
            dataScopes: ["task_text", "workspace_files", "env_inherit"],
            writeIntent: true,
            decisionId: prep.decisionId,
            confirmationToken: prep.confirmationToken,
          },
          ag
        );
        assert.equal(result.ok, false, c.name);
        assert.equal(result.spawnCount, 0, c.name);
        assert.equal(result.statusCode, "executable_changed_before_spawn", c.name);
        assert.ok(/启动前发生变化|已取消执行/.test(result.reply), c.name + " reply");
        assert.equal(actualSpawns, 0, c.name + " chain spawn");

        const lines = fs
          .readFileSync(path.join(userData, "decision-audit", "gen-1.jsonl"), "utf8")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l));
        const denied = lines.find(
          (r) =>
            r.event === "execution_failed" &&
            r.outcome &&
            Array.isArray(r.outcome.reasonCodes) &&
            r.outcome.reasonCodes.includes("executable_changed_before_spawn")
        );
        assert.ok(denied, c.name + " missing audit deny record");
        assert.equal(denied.outcome.status, "denied");
        assert.equal(denied.outcome.spawned, false);
        assert.equal(denied.outcome.statusCode, "executable_changed_before_spawn");
      } finally {
        cleanup(userData);
      }
    }
  });

  await test("19. long-running cancel after spawn → execution_canceled (not timeout)", async () => {
    const { spawn: realSpawn } = require("node:child_process");
    const { isProcessAlive } = require("../src/tool-broker/executor");
    const userData = tempUserData("live-cancel");
    try {
      const work = path.join(userData, "workdir");
      fs.mkdirSync(work, { recursive: true });
      const sleepJs = path.join(work, "sleep-long.js");
      fs.writeFileSync(sleepJs, "setTimeout(() => {}, 120000);\n", "utf8");

      seedLocalCli(userData, {
        executable: process.execPath,
        cwd: work,
        timeoutMs: 60000,
      });
      agentsLib.setActiveAgent(userData, "cli-coder");

      const ac = new AbortController();
      let spawned = false;
      let childPid = null;
      const ag = {
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
                setTimeout(() => {
                  try {
                    ac.abort();
                  } catch {
                    /* ignore */
                  }
                }, 120);
                return child;
              },
            },
          });
        },
      };

      const prep = externalAgentFlow.requestExternalAgent(
        userData,
        mockEvent(19),
        {
          task: sleepJs,
          dataScopes: ["task_text", "workspace_files", "env_inherit"],
          writeIntent: true,
        },
        ag
      );
      assert.ok(prep.confirmationToken);

      const result = await externalAgentFlow.runExternalAgent(
        userData,
        mockEvent(19),
        {
          task: sleepJs,
          dataScopes: ["task_text", "workspace_files", "env_inherit"],
          writeIntent: true,
          decisionId: prep.decisionId,
          confirmationToken: prep.confirmationToken,
        },
        ag,
        { signal: ac.signal }
      );

      assert.equal(spawned, true, "spawn must have occurred before cancel");
      assert.ok(childPid, "child pid recorded");
      assert.equal(result.ok, false);
      assert.equal(result.aborted, true);
      assert.notEqual(result.timedOut, true);
      assert.ok(!result.timedOut);

      // Process must be reclaimed (or orphanRisk explicitly reported).
      await new Promise((r) => setTimeout(r, 200));
      if (!result.orphanRisk) {
        assert.equal(isProcessAlive(childPid), false, "child must be reclaimed");
      }

      const lines = fs
        .readFileSync(path.join(userData, "decision-audit", "gen-1.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      const canceled = lines.find((r) => r.event === "execution_canceled");
      const timedOut = lines.find((r) => r.event === "execution_timed_out");
      assert.ok(canceled, "audit must record execution_canceled");
      assert.ok(!timedOut, "audit must not record execution_timed_out");

      // Repeat stop via delegateRuntime must not disturb other work.
      delegateRuntime.clearAllForTests();
      const began = delegateRuntime.begin(mockEvent(19), "post_cancel");
      assert.equal(began.ok, true);
      const first = delegateRuntime.abortOne(mockEvent(19), began.operationId);
      assert.equal(first.ok, true);
      const second = delegateRuntime.abortOne(mockEvent(19), began.operationId);
      assert.equal(second.ok, true);
      assert.equal(began.abort.signal.aborted, true);
      const other = delegateRuntime.begin(mockEvent(20), "other_ok");
      assert.equal(other.ok, true);
      assert.equal(other.abort.signal.aborted, false);
      const cross = delegateRuntime.abortOne(mockEvent(20), began.operationId);
      assert.equal(cross.ok, false);
      assert.equal(other.abort.signal.aborted, false);
    } finally {
      cleanup(userData);
      delegateRuntime.clearAllForTests();
    }
  });

  console.log(`\nP1-05 results: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

runAllTests().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
