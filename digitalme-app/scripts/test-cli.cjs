"use strict";

/**
 * CLI (src/cli/index.js) end-to-end tests.
 * Spawns the CLI as a plain node process (no Electron) against a hermetic
 * Package fixture; generate runs in fake mode (no real API calls).
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const {
  createHermeticPackageFixture,
  cleanupHermeticPackageFixture,
} = require("./hermetic-package-fixture.cjs");

const CLI = path.join(__dirname, "..", "src", "cli", "index.js");

let passed = 0;
let failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed += 1;
      console.log("PASS", name);
    })
    .catch((err) => {
      failed += 1;
      console.error("FAIL", name);
      console.error(err && err.stack ? err.stack : err);
    });
}

function runCli(args, env) {
  const res = spawnSync(process.execPath, [CLI].concat(args), {
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
  return {
    status: res.status,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
  };
}

async function main() {
  const fixture = createHermeticPackageFixture("cli");
  const cliHome = fs.mkdtempSync(path.join(os.tmpdir(), "dm-cli-home-"));
  const baseEnv = {
    DM_PACKAGE_DIR: fixture.packageDir,
    DM_CLI_HOME: cliHome,
    DM_FAKE: "1",
  };

  try {
    await test("dm status 显示 Package 状态与身份标识", () => {
      const r = runCli(["status"], baseEnv);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.includes("Digital Me 状态"), r.stdout);
      assert.ok(r.stdout.includes("Package 目录"), r.stdout);
      assert.ok(r.stdout.includes("0.1.0"), r.stdout); // fixture packageVersion
      assert.ok(r.stdout.includes("hermetic-dm"), r.stdout); // fixture digitalMeId
      assert.ok(r.stdout.includes("资料概览"), r.stdout);
    });

    await test("dm status 在 Package 缺失时给出清晰提示", () => {
      const missing = path.join(os.tmpdir(), "dm-cli-no-such-package-dir");
      const r = runCli(["status"], { ...baseEnv, DM_PACKAGE_DIR: missing });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.includes("未找到 Package"), r.stdout);
      assert.ok(r.stdout.includes("DM_PACKAGE_DIR"), r.stdout);
      // 只读命令不得在缺失目录下创建脚手架。
      assert.equal(fs.existsSync(missing), false, "missing dir must not be created");
    });

    await test("dm context（带目标）按目标显示个性化上下文", () => {
      const r = runCli(["context", "测试"], baseEnv);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.includes("个性化上下文"), r.stdout);
      assert.ok(r.stdout.includes("目标：测试"), r.stdout);
      assert.ok(r.stdout.includes("候选条目"), r.stdout);
      assert.ok(r.stdout.includes("来源："), r.stdout);
    });

    await test("dm context（无目标）显示有界本人摘录", () => {
      const r = runCli(["context"], baseEnv);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.includes("个性化上下文"), r.stdout);
      assert.ok(r.stdout.includes("有界摘录"), r.stdout);
      assert.ok(r.stdout.includes("人格与自我描述"), r.stdout); // fixture persona
    });

    await test("dm generate 在 fake 模式下生成内容", () => {
      const r = runCli(["generate", "写一篇测试短文"], baseEnv);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.includes("生成结果"), r.stdout);
      assert.ok(r.stdout.includes("目标：写一篇测试短文"), r.stdout);
      assert.ok(r.stdout.includes("完整结果"), r.stdout);
      assert.ok(r.stdout.includes("（测试）"), r.stdout);
      assert.ok(!r.stderr.includes("模型调用失败"), r.stderr);
    });

    await test("dm generate --fake 旗标同样生效", () => {
      const r = runCli(["generate", "测试旗标", "--fake"], { ...baseEnv, DM_FAKE: "" });
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.includes("完整结果"), r.stdout);
    });

    await test("dm generate 缺少目标时友好报错", () => {
      const r = runCli(["generate"], baseEnv);
      assert.equal(r.status, 1);
      assert.ok(r.stderr.includes("缺少生成目标"), r.stderr);
      assert.ok(r.stderr.includes("用法"), r.stderr);
    });

    await test("dm generate 未配置模型且非 fake 时提示配置方法", () => {
      const r = runCli(["generate", "测试"], {
        ...baseEnv,
        DM_FAKE: "",
        DM_BASE_URL: "",
        DM_API_KEY: "",
        DM_MODEL: "",
      });
      assert.equal(r.status, 1);
      assert.ok(r.stderr.includes("未配置模型"), r.stderr);
      assert.ok(r.stderr.includes("DM_BASE_URL"), r.stderr);
    });

    await test("dm credential 生成 / 列表 / 出示 / 撤销闭环", () => {
      const gen = runCli(["credential", "generate", "--label", "测试凭据"], baseEnv);
      assert.equal(gen.status, 0, gen.stderr);
      assert.ok(gen.stdout.includes("已生成对外凭据"), gen.stdout);
      assert.ok(gen.stdout.includes("hermetic-dm"), gen.stdout);
      const m = gen.stdout.match(/cred_[0-9a-f]+/);
      assert.ok(m, gen.stdout);
      const id = m[0];

      const list = runCli(["credential", "list"], baseEnv);
      assert.equal(list.status, 0, list.stderr);
      assert.ok(list.stdout.includes(id), list.stdout);
      assert.ok(list.stdout.includes("有效"), list.stdout);
      assert.ok(list.stdout.includes("测试凭据"), list.stdout);

      const show = runCli(["credential", "show", id], baseEnv);
      assert.equal(show.status, 0, show.stderr);
      assert.ok(show.stdout.includes("出示凭据"), show.stdout);
      assert.ok(show.stdout.includes(id), show.stdout);
      assert.ok(show.stdout.includes("凭据密钥："), show.stdout);
      assert.ok(show.stdout.includes("hermetic-dm"), show.stdout);

      const revoke = runCli(["credential", "revoke", id], baseEnv);
      assert.equal(revoke.status, 0, revoke.stderr);
      assert.ok(revoke.stdout.includes("已撤销"), revoke.stdout);

      const showAfter = runCli(["credential", "show", id], baseEnv);
      assert.equal(showAfter.status, 1);
      assert.ok(showAfter.stderr.includes("已撤销"), showAfter.stderr);

      const listAfter = runCli(["credential", "list"], baseEnv);
      assert.equal(listAfter.status, 0, listAfter.stderr);
      assert.ok(listAfter.stdout.includes("已撤销"), listAfter.stdout);
    });

    await test("dm credential show 未知 ID 时友好报错", () => {
      const r = runCli(["credential", "show", "cred_000000000000"], baseEnv);
      assert.equal(r.status, 1);
      assert.ok(r.stderr.includes("找不到凭据"), r.stderr);
    });

    await test("未知命令显示用法并以非零退出", () => {
      const r = runCli(["frobnicate"], baseEnv);
      assert.equal(r.status, 1);
      assert.ok(r.stderr.includes("未知命令"), r.stderr);
      assert.ok(r.stderr.includes("用法"), r.stderr);
    });

    await test("dm help 显示命令列表", () => {
      const r = runCli(["help"], baseEnv);
      assert.equal(r.status, 0, r.stderr);
      for (const cmd of ["status", "context", "generate", "credential"]) {
        assert.ok(r.stdout.includes(cmd), r.stdout);
      }
    });
  } finally {
    cleanupHermeticPackageFixture(fixture.packageDir);
    try {
      fs.rmSync(cliHome, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  console.log("");
  console.log("cli tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
