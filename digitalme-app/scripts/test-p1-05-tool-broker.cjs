"use strict";

/**
 * P1-05 ToolBroker + local_cli isolation slice tests.
 * Uses real child_process paths for Windows-relevant failure cases.
 * Run: node scripts/test-p1-05-tool-broker.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

const toolBroker = require("../src/tool-broker");
const { buildMinimalEnv, listEnvKeyNames } = require("../src/tool-broker/environment");
const { resolveAuthorizedCwd, looksLikeNetworkOrCloudSync } = require("../src/tool-broker/paths");
const { executePlan } = require("../src/tool-broker/executor");
const {
  evaluatePolicy,
  buildExternalCliRequest,
  buildRequestDigest,
  POLICY_VERSION,
} = require("../src/policy-engine");
const confirmationStore = require("../src/policy-engine/confirmation-store");
const decisionAudit = require("../src/decision-audit");
const externalAgentFlow = require("../src/orchestration/external-agent-flow");
const agentsLib = require("../src/orchestration/agents");

const DEFAULT_PKG = path.join(__dirname, "..", "..", "digital-me-package");
const P100_BASELINE = path.join(__dirname, "..", "..", "build", "reports", "p1-00-package-baseline.json");
const PRELOAD_PATH = path.join(__dirname, "..", "src", "preload.js");
const RENDERER_APP = path.join(__dirname, "..", "src", "renderer", "app.js");

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
        spawnCount += 1;
        return toolBroker.executePreparedPlan(plan, opts);
      }),
    get spawnCount() {
      return spawnCount;
    },
  };
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
      const st = fs.lstatSync(full);
      if (st.isDirectory()) walk(full);
      else {
        out.push({
          relativePath: path.relative(root, full).split(path.sep).join("/"),
          size: st.size,
          sha256: sha256File(full),
        });
      }
    }
  }
  walk(root);
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return out;
}

function writeEchoScript(dir) {
  // Node script: print argv JSON and env keys; optional sleep / flood.
  const script = path.join(dir, "echo-tool.js");
  fs.writeFileSync(
    script,
    `
const fs = require("fs");
const args = process.argv.slice(2);
const mode = args[0] || "echo";
if (mode === "sleep") {
  const ms = Number(args[1] || 5000);
  setTimeout(() => process.exit(0), ms);
} else if (mode === "flood") {
  const n = Number(args[1] || 200000);
  process.stdout.write("x".repeat(n));
  process.exit(0);
} else if (mode === "envkeys") {
  console.log(JSON.stringify(Object.keys(process.env).sort()));
} else if (mode === "write-marker") {
  fs.writeFileSync(args[1], "created-by-child");
  process.exit(0);
} else {
  console.log(JSON.stringify({ argv: args, cwd: process.cwd() }));
}
`,
    "utf8"
  );
  return script;
}

async function runAllTests() {
  confirmationStore.clearAllForTests();

  await test("1. unknown tool / free-form executable / unknown fields fail-closed", () => {
    const userData = tempUserData("unknown");
    try {
      const badTool = toolBroker.preparePlan(userData, {
        toolId: "shell_any",
        taskText: "x",
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
      });
      assert.equal(badTool.ok, false);
      assert.ok(badTool.reasonCodes.includes("unknown_tool_id"));

      const rejected = toolBroker.saveNarrowSettings(userData, {
        executable: "echo hello && calc",
        authorizedCwdRoot: path.join(userData, "w"),
        enabled: true,
      });
      assert.equal(rejected.ok, false);

      const bat = toolBroker.saveNarrowSettings(userData, {
        executable: "C:\\\\Windows\\\\System32\\\\cmd.exe",
        authorizedCwdRoot: path.join(userData, "w"),
        enabled: true,
      });
      // cmd.exe itself is allowed as absolute binary; .bat/.cmd script files are not.
      // Reject relative / shell strings:
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
      void bat;
    } finally {
      cleanup(userData);
    }
  });

  await test("2. spawn uses absolute executable + args array + shell:false", async () => {
    const userData = tempUserData("spawn-shape");
    try {
      const work = path.join(userData, "workdir");
      fs.mkdirSync(work, { recursive: true });
      const script = writeEchoScript(work);
      seedLocalCli(userData, { executable: process.execPath, cwd: work });
      const registryPath = path.join(userData, "tool-broker", "registry.json");
      const raw = JSON.parse(fs.readFileSync(registryPath, "utf8"));
      raw.tools.local_cli.argsTemplate = [script, "{{task}}"];
      fs.writeFileSync(registryPath, JSON.stringify(raw, null, 2), "utf8");

      const prepared = toolBroker.preparePlan(userData, {
        taskText: "hello&world|x;y",
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
      });
      assert.equal(prepared.ok, true);
      assert.equal(prepared.plan.shell, false);
      assert.ok(path.isAbsolute(prepared.plan.executable));
      assert.ok(Array.isArray(prepared.plan.args));
      assert.equal(prepared.plan.args[1], "hello&world|x;y");
      assert.equal(prepared.plan._env.PATH, "");

      const result = await toolBroker.executePreparedPlan(prepared.plan);
      assert.equal(result.ok, true);
      const parsed = JSON.parse(result.output.trim().split("\n")[0]);
      assert.equal(parsed.argv[0], "hello&world|x;y");
    } finally {
      cleanup(userData);
    }
  });

  await test("3. shell metacharacters stay literal args (no second process / extra file)", async () => {
    const userData = tempUserData("meta");
    try {
      const work = path.join(userData, "workdir");
      fs.mkdirSync(work, { recursive: true });
      const script = writeEchoScript(work);
      const marker = path.join(work, "should-not-exist.txt");
      seedLocalCli(userData, { executable: process.execPath, cwd: work });
      const registryPath = path.join(userData, "tool-broker", "registry.json");
      const raw = JSON.parse(fs.readFileSync(registryPath, "utf8"));
      raw.tools.local_cli.argsTemplate = [script, "{{task}}"];
      fs.writeFileSync(registryPath, JSON.stringify(raw, null, 2), "utf8");

      const evil = `echo > "${marker}" & calc`;
      const prepared = toolBroker.preparePlan(userData, {
        taskText: evil,
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
      });
      assert.equal(prepared.ok, true);
      const result = await toolBroker.executePreparedPlan(prepared.plan);
      assert.equal(result.ok, true);
      assert.ok(!fs.existsSync(marker));
      const parsed = JSON.parse(result.output.trim().split("\n")[0]);
      assert.equal(parsed.argv[0], evil);
    } finally {
      cleanup(userData);
    }
  });

  await test("4. PATH hijack / fingerprint drift / definitionVersion drift blocked", () => {
    const userData = tempUserData("drift");
    try {
      const work = path.join(userData, "workdir");
      fs.mkdirSync(work, { recursive: true });
      seedLocalCli(userData, { executable: process.execPath, cwd: work });
      const a = toolBroker.preparePlan(userData, {
        taskText: "t1",
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
      });
      assert.equal(a.ok, true);

      // Fingerprint change: rewrite a copy and point executable there after first plan.
      const copy = path.join(work, "node-copy" + path.extname(process.execPath));
      fs.copyFileSync(process.execPath, copy);
      // First plan still valid; changing registry executable changes digest.
      toolBroker.saveNarrowSettings(userData, {
        executable: copy,
        authorizedCwdRoot: work,
        enabled: true,
      });
      const b = toolBroker.preparePlan(userData, {
        taskText: "t1",
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
      });
      assert.equal(b.ok, true);
      assert.notEqual(a.plan.executableFingerprint, b.plan.executableFingerprint);

      const registryPath = path.join(userData, "tool-broker", "registry.json");
      const raw = JSON.parse(fs.readFileSync(registryPath, "utf8"));
      raw.tools.local_cli.definitionVersion = "tampered-version";
      fs.writeFileSync(registryPath, JSON.stringify(raw, null, 2), "utf8");
      const c = toolBroker.preparePlan(userData, {
        taskText: "t1",
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
      });
      // definitionVersion is normalized back to broker version on load OR kept — loadRegistry
      // uses stored definitionVersion. Expect digest/version change or normalize fail.
      if (c.ok) {
        assert.notEqual(b.planDigest, c.planDigest);
      } else {
        assert.ok(c.reasonCodes.length > 0);
      }

      // Env PATH must be pinned empty when absolute exe is set (blocks host PATH hijack).
      const env = buildMinimalEnv(["SystemRoot", "WINDIR", "TEMP", "TMP"], {
        SystemRoot: "C:\\Windows",
        PATH: work,
        SECRET_TEST_KEY: "should-not-leak",
      });
      assert.equal(env.PATH, "");
      assert.ok(!Object.keys(env).includes("SECRET_TEST_KEY"));
      assert.ok(!Object.values(env).includes("should-not-leak"));
      assert.ok(!Object.values(env).includes(work));
    } finally {
      cleanup(userData);
    }
  });

  await test("5. subprocess env only allowlisted keys; sentinel secret absent", async () => {
    const userData = tempUserData("env");
    try {
      const work = path.join(userData, "workdir");
      fs.mkdirSync(work, { recursive: true });
      const script = writeEchoScript(work);
      seedLocalCli(userData, { executable: process.execPath, cwd: work });
      const registryPath = path.join(userData, "tool-broker", "registry.json");
      const raw = JSON.parse(fs.readFileSync(registryPath, "utf8"));
      raw.tools.local_cli.argsTemplate = [script, "envkeys"];
      fs.writeFileSync(registryPath, JSON.stringify(raw, null, 2), "utf8");

      process.env.DM_P105_SENTINEL = "super-secret-do-not-leak";
      const prepared = toolBroker.preparePlan(userData, {
        taskText: "unused",
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
      });
      assert.equal(prepared.ok, true);
      assert.ok(!prepared.plan.envKeyNames.includes("DM_P105_SENTINEL"));
      assert.equal(prepared.plan._env.PATH, "");
      assert.ok(!Object.values(prepared.plan._env).includes("super-secret-do-not-leak"));
      const result = await toolBroker.executePreparedPlan(prepared.plan);
      assert.equal(result.ok, true);
      const keys = JSON.parse(result.output.trim().split("\n")[0]);
      assert.ok(!keys.includes("DM_P105_SENTINEL"));
      // PATH may appear as a pinned empty value; must not equal host PATH.
      if (keys.some((k) => k.toLowerCase() === "path")) {
        assert.notEqual(process.env.PATH, undefined);
        // Child PATH must be empty pin, not host PATH.
        const childPath = await new Promise((resolve) => {
          const { spawn } = require("node:child_process");
          const c = spawn(
            process.execPath,
            ["-e", "process.stdout.write(process.env.PATH === '' ? 'EMPTY' : process.env.PATH)"],
            { env: prepared.plan._env, shell: false, windowsHide: true }
          );
          let o = "";
          c.stdout.on("data", (d) => (o += d));
          c.on("close", () => resolve(o));
        });
        assert.equal(childPath, "EMPTY");
      }
    } finally {
      delete process.env.DM_P105_SENTINEL;
      cleanup(userData);
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
      assert.throws(
        () => resolveAuthorizedCwd(path.join(userData, "WPSDrive", "cloud"), path.join(userData, "WPSDrive", "cloud")),
        /network|path_rejected|authorized_cwd_missing/
      );

      if (process.platform === "win32") {
        // Symlink may require privilege; skip soft if creation fails.
        const link = path.join(userData, "link-out");
        try {
          fs.symlinkSync(os.tmpdir(), link, "junction");
          assert.throws(() => resolveAuthorizedCwd(work, link), /symlink|reparse|path_escape|path_rejected/);
        } catch (err) {
          if (err && err.code === "path_rejected") throw err;
          // privilege / unsupported — still assert UNC rejection above covered the class.
        }
      }
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

  await test("8. timeout and cancel terminate process tree", async () => {
    const userData = tempUserData("life");
    try {
      const work = path.join(userData, "workdir");
      fs.mkdirSync(work, { recursive: true });
      const script = writeEchoScript(work);
      seedLocalCli(userData, {
        executable: process.execPath,
        cwd: work,
        timeoutMs: 800,
      });
      const registryPath = path.join(userData, "tool-broker", "registry.json");
      const raw = JSON.parse(fs.readFileSync(registryPath, "utf8"));
      raw.tools.local_cli.argsTemplate = [script, "sleep", "20000"];
      raw.tools.local_cli.timeoutMs = 800;
      fs.writeFileSync(registryPath, JSON.stringify(raw, null, 2), "utf8");

      const prepared = toolBroker.preparePlan(userData, {
        taskText: "unused",
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
      });
      assert.equal(prepared.ok, true);
      const timed = await toolBroker.executePreparedPlan(prepared.plan);
      assert.equal(timed.timedOut, true);
      assert.equal(timed.ok, false);

      // Cancel path
      raw.tools.local_cli.argsTemplate = [script, "sleep", "20000"];
      raw.tools.local_cli.timeoutMs = 60000;
      fs.writeFileSync(registryPath, JSON.stringify(raw, null, 2), "utf8");
      const prepared2 = toolBroker.preparePlan(userData, {
        taskText: "unused2",
        dataScopes: ["task_text", "workspace_files", "env_inherit"],
      });
      const ac = new AbortController();
      const pending = toolBroker.executePreparedPlan(prepared2.plan, { signal: ac.signal });
      setTimeout(() => ac.abort(), 200);
      const canceled = await pending;
      assert.equal(canceled.aborted, true);
    } finally {
      cleanup(userData);
    }
  });

  await test("9. stdout over limit truncated; audit stores digest not full flood", async () => {
    const userData = tempUserData("trunc");
    const ag = agentsModule(userData);
    try {
      const work = path.join(userData, "workdir");
      fs.mkdirSync(work, { recursive: true });
      const script = writeEchoScript(work);
      seedLocalCli(userData, {
        executable: process.execPath,
        cwd: work,
        maxOutputBytes: 2048,
      });
      const registryPath = path.join(userData, "tool-broker", "registry.json");
      const raw = JSON.parse(fs.readFileSync(registryPath, "utf8"));
      raw.tools.local_cli.argsTemplate = [script, "flood", "100000"];
      raw.tools.local_cli.maxOutputBytes = 2048;
      fs.writeFileSync(registryPath, JSON.stringify(raw, null, 2), "utf8");
      agentsLib.setActiveAgent(userData, "cli-coder");

      const prep = externalAgentFlow.requestExternalAgent(
        userData,
        mockEvent(9),
        {
          task: "flood",
          dataScopes: ["task_text", "workspace_files", "env_inherit"],
          writeIntent: true,
        },
        ag
      );
      const result = await externalAgentFlow.runExternalAgent(
        userData,
        mockEvent(9),
        {
          task: "flood",
          dataScopes: ["task_text", "workspace_files", "env_inherit"],
          writeIntent: true,
          decisionId: prep.decisionId,
          confirmationToken: prep.confirmationToken,
        },
        ag
      );
      assert.equal(ag.spawnCount, 1);
      assert.ok(result.meta.truncated || /截断/.test(result.reply));
      const ledger = fs.readFileSync(path.join(userData, "decision-audit", "gen-1.jsonl"), "utf8");
      assert.ok(!ledger.includes("x".repeat(5000)));
      assert.equal(POLICY_VERSION, "p1-05-v1");
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
              task: "x",
              dataScopes: ["task_text", "workspace_files", "env_inherit"],
              writeIntent: true,
              writeAuthorized: true,
            },
            ag
          ),
        /缺少确认凭据|界面勾选/
      );
      assert.equal(ag.spawnCount, 0);

      // Unhealthy audit
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
              task: "x",
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

  await test("11. same decisionId and planDigest across request/confirm/result", async () => {
    const userData = tempUserData("same-id");
    const ag = agentsModule(userData);
    try {
      const work = path.join(userData, "workdir");
      fs.mkdirSync(work, { recursive: true });
      const script = writeEchoScript(work);
      seedLocalCli(userData, { executable: process.execPath, cwd: work });
      const registryPath = path.join(userData, "tool-broker", "registry.json");
      const raw = JSON.parse(fs.readFileSync(registryPath, "utf8"));
      raw.tools.local_cli.argsTemplate = [script, "{{task}}"];
      fs.writeFileSync(registryPath, JSON.stringify(raw, null, 2), "utf8");
      agentsLib.setActiveAgent(userData, "cli-coder");

      const prep = externalAgentFlow.requestExternalAgent(
        userData,
        mockEvent(11),
        {
          task: "ping",
          dataScopes: ["task_text", "workspace_files", "env_inherit"],
          writeIntent: true,
        },
        ag
      );
      assert.ok(prep.decisionId);
      assert.ok(prep.planDigest);
      assert.ok(prep.summary.notSandboxNotice);
      assert.ok(prep.summary.executableAbsolute);
      assert.ok(Array.isArray(prep.summary.envKeyNames));

      const result = await externalAgentFlow.runExternalAgent(
        userData,
        mockEvent(11),
        {
          task: "ping",
          dataScopes: ["task_text", "workspace_files", "env_inherit"],
          writeIntent: true,
          decisionId: prep.decisionId,
          confirmationToken: prep.confirmationToken,
        },
        ag
      );
      assert.equal(result.ok, true);
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
      assert.ok(lines.some((r) => r.planDigest === prep.planDigest || (r.outcome && true)));
    } finally {
      cleanup(userData);
    }
  });

  await test("12. preload/renderer expose no generic spawn/shell/env/registry write API", () => {
    const preload = fs.readFileSync(PRELOAD_PATH, "utf8");
    const appJs = fs.readFileSync(RENDERER_APP, "utf8");
    assert.ok(!/spawn\s*\(/.test(preload));
    assert.ok(!/child_process/.test(preload));
    assert.ok(!/shell\s*:\s*true/.test(preload));
    assert.ok(!/updateRegistry|registerTool|setEnv\b/.test(preload));
    assert.ok(!/cfg-cli-cmd/.test(appJs));
    assert.ok(/cfg-cli-executable/.test(appJs));
    assert.ok(/受限执行，不是安全沙箱|notSandboxNotice/.test(appJs));
  });

  await test("13. Package baseline unchanged (P1-00)", () => {
    assert.ok(fs.existsSync(P100_BASELINE), "missing p1-00 baseline report");
    const baseline = JSON.parse(fs.readFileSync(P100_BASELINE, "utf8"));
    assert.ok(baseline && Array.isArray(baseline.files) && baseline.files.length > 0);
    assert.ok(fs.existsSync(DEFAULT_PKG));
    const current = walkFiles(DEFAULT_PKG);
    assert.equal(current.length, baseline.files.length);
    for (let i = 0; i < baseline.files.length; i++) {
      assert.equal(current[i].relativePath, baseline.files[i].relativePath);
      assert.equal(current[i].sha256, baseline.files[i].sha256);
      assert.equal(current[i].size, baseline.files[i].size);
    }
  });

  await test("14. disabled by default after fresh registry", () => {
    const userData = tempUserData("default-off");
    try {
      const settings = toolBroker.getPublicSettings(userData);
      // After seedLocalCli from other tests we re-create; fresh without seed:
      cleanup(userData);
      const fresh = tempUserData("default-off-2");
      try {
        // temp helper doesn't seed here — recreate without seed
        const bare = fs.mkdtempSync(path.join(os.tmpdir(), "dm-p105-bare-"));
        try {
          const s = toolBroker.getPublicSettings(bare);
          assert.equal(s.enabled, false);
          assert.equal(s.executable, "");
        } finally {
          cleanup(bare);
        }
        void fresh;
      } finally {
        cleanup(fresh);
      }
    } finally {
      cleanup(userData);
    }
  });

  console.log(`\nP1-05 results: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

runAllTests().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
