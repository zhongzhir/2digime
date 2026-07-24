"use strict";

/**
 * CLI Phase 3 增强命令（dm run / dm project / dm review）端到端测试。
 * 以纯 node 进程启动 CLI（不依赖 Electron），Package 使用 hermetic fixture；
 * 模型调用一律走 fake 模式，--exec 测试使用当前 node 解释器执行真实临时文件。
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

/** 无模型配置且非 fake 的环境（覆盖 baseEnv 中的 DM_FAKE）。 */
function noModelEnv(baseEnv) {
  return { ...baseEnv, DM_FAKE: "", DM_BASE_URL: "", DM_API_KEY: "", DM_MODEL: "" };
}

async function main() {
  const fixture = createHermeticPackageFixture("cli-enh");
  const cliHome = fs.mkdtempSync(path.join(os.tmpdir(), "dm-cli-home-"));
  const baseEnv = {
    DM_PACKAGE_DIR: fixture.packageDir,
    DM_CLI_HOME: cliHome,
    DM_FAKE: "1",
  };

  // 临时工作目录：代码文件 + 演示项目。
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-cli-enh-"));
  const helloFile = path.join(workDir, "hello.js");
  const failFile = path.join(workDir, "fail.js");
  const slowFile = path.join(workDir, "slow.js");
  const textFile = path.join(workDir, "notes.txt");
  const emptyFile = path.join(workDir, "empty.js");
  fs.writeFileSync(helloFile, 'console.log("hello-from-run");\n', "utf8");
  fs.writeFileSync(failFile, 'console.error("boom-detail");\nprocess.exit(3);\n', "utf8");
  fs.writeFileSync(slowFile, "setTimeout(() => {}, 60000);\n", "utf8");
  fs.writeFileSync(textFile, "plain text, not runnable\n", "utf8");
  fs.writeFileSync(emptyFile, "", "utf8");

  const projDir = path.join(workDir, "demo-proj");
  fs.mkdirSync(path.join(projDir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(projDir, "package.json"),
    JSON.stringify(
      {
        name: "demo-proj",
        version: "1.2.3",
        description: "演示项目",
        scripts: { start: "node src/index.js", test: "node --test" },
        dependencies: { react: "^18.0.0" },
        devDependencies: { vite: "^5.0.0" },
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  fs.writeFileSync(
    path.join(projDir, "README.md"),
    "# Demo Proj\n\n这是一个用于 CLI 测试的演示项目。\n",
    "utf8"
  );
  fs.writeFileSync(path.join(projDir, "tsconfig.json"), "{}\n", "utf8");
  fs.writeFileSync(path.join(projDir, "src", "index.js"), "console.log(1);\n", "utf8");

  try {
    // ---------- dm review ----------

    await test("dm review 在 fake 模式下输出三栏审查结果", () => {
      const r = runCli(["review", helloFile, "--fake"], baseEnv);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.includes("代码审查"), r.stdout);
      assert.ok(r.stdout.includes("hello.js"), r.stdout);
      assert.ok(r.stdout.includes("JavaScript"), r.stdout);
      assert.ok(r.stdout.includes("## 问题"), r.stdout);
      assert.ok(r.stdout.includes("## 建议"), r.stdout);
      assert.ok(r.stdout.includes("## 改进方案"), r.stdout);
      assert.ok(r.stdout.includes("（测试）"), r.stdout);
      assert.ok(!r.stderr.includes("模型调用失败"), r.stderr);
    });

    await test("dm review 缺少文件时友好报错", () => {
      const r = runCli(["review"], baseEnv);
      assert.equal(r.status, 1);
      assert.ok(r.stderr.includes("缺少代码文件"), r.stderr);
      assert.ok(r.stderr.includes("用法"), r.stderr);
    });

    await test("dm review 文件不存在时友好报错", () => {
      const r = runCli(["review", path.join(workDir, "no-such.js")], baseEnv);
      assert.equal(r.status, 1);
      assert.ok(r.stderr.includes("文件不存在"), r.stderr);
    });

    await test("dm review 空文件时友好报错", () => {
      const r = runCli(["review", emptyFile], baseEnv);
      assert.equal(r.status, 1);
      assert.ok(r.stderr.includes("文件为空"), r.stderr);
    });

    await test("dm review 未配置模型且非 fake 时提示配置方法", () => {
      const r = runCli(["review", helloFile], noModelEnv(baseEnv));
      assert.equal(r.status, 1);
      assert.ok(r.stderr.includes("未配置模型"), r.stderr);
      assert.ok(r.stderr.includes("DM_BASE_URL"), r.stderr);
    });

    // ---------- dm run ----------

    await test("dm run（无 --exec）仅审查并提示执行方式", () => {
      const r = runCli(["run", helloFile, "--fake"], baseEnv);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.includes("代码执行"), r.stdout);
      assert.ok(r.stdout.includes("模型审查"), r.stdout);
      assert.ok(r.stdout.includes("## 问题"), r.stdout);
      assert.ok(r.stdout.includes("## 建议"), r.stdout);
      assert.ok(r.stdout.includes("加 --exec"), r.stdout);
      // 未执行：不应出现执行结果与脚本输出。
      assert.ok(!r.stdout.includes("执行结果"), r.stdout);
      assert.ok(!r.stdout.includes("hello-from-run"), r.stdout);
    });

    await test("dm run --exec 实际执行并输出结果", () => {
      const r = runCli(["run", helloFile, "--fake", "--exec"], baseEnv);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.includes("模型审查"), r.stdout);
      assert.ok(r.stdout.includes("执行结果"), r.stdout);
      assert.ok(r.stdout.includes("退出码：0"), r.stdout);
      assert.ok(r.stdout.includes("hello-from-run"), r.stdout);
    });

    await test("dm run --exec 脚本非零退出时透出退出码", () => {
      const r = runCli(["run", failFile, "--fake", "--exec"], baseEnv);
      assert.equal(r.status, 1, r.stderr);
      assert.ok(r.stdout.includes("退出码：3"), r.stdout);
      assert.ok(r.stdout.includes("boom-detail"), r.stdout);
      assert.ok(r.stderr.includes("执行失败"), r.stderr);
    });

    await test("dm run --exec 不支持的文件类型直接报错", () => {
      const r = runCli(["run", textFile, "--fake", "--exec"], baseEnv);
      assert.equal(r.status, 1);
      assert.ok(r.stderr.includes("不支持执行的文件类型"), r.stderr);
      assert.ok(r.stderr.includes(".js"), r.stderr);
    });

    await test("dm run --exec 超时后终止进程", () => {
      const r = runCli(["run", slowFile, "--fake", "--exec", "--timeout", "1500"], baseEnv);
      assert.equal(r.status, 1, r.stderr);
      assert.ok(r.stdout.includes("执行超时"), r.stdout);
    });

    await test("dm run 缺少文件时友好报错", () => {
      const r = runCli(["run"], baseEnv);
      assert.equal(r.status, 1);
      assert.ok(r.stderr.includes("缺少代码文件"), r.stderr);
      assert.ok(r.stderr.includes("用法"), r.stderr);
    });

    // ---------- dm project ----------

    await test("dm project 生成项目上下文摘要", () => {
      const r = runCli(["project", projDir], baseEnv);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.includes("项目上下文"), r.stdout);
      assert.ok(r.stdout.includes("demo-proj"), r.stdout);
      assert.ok(r.stdout.includes("1.2.3"), r.stdout);
      assert.ok(r.stdout.includes("演示项目"), r.stdout);
      assert.ok(r.stdout.includes("关键文件"), r.stdout);
      assert.ok(r.stdout.includes("README.md"), r.stdout);
      assert.ok(r.stdout.includes("tsconfig.json"), r.stdout);
      assert.ok(r.stdout.includes("TypeScript 配置"), r.stdout);
      assert.ok(r.stdout.includes("目录结构"), r.stdout);
      assert.ok(r.stdout.includes("src/"), r.stdout);
      assert.ok(r.stdout.includes("脚本（来自 package.json）"), r.stdout);
      assert.ok(r.stdout.includes("start：node src/index.js"), r.stdout);
      assert.ok(r.stdout.includes("dependencies 1 个（react）"), r.stdout);
      assert.ok(r.stdout.includes("devDependencies 1 个（vite）"), r.stdout);
      assert.ok(r.stdout.includes("JavaScript（.js）：1 个"), r.stdout);
    });

    await test("dm project 目录不存在时友好报错", () => {
      const r = runCli(["project", path.join(workDir, "no-such-dir")], baseEnv);
      assert.equal(r.status, 1);
      assert.ok(r.stderr.includes("目录不存在"), r.stderr);
    });

    await test("dm project 对普通目录也能给出降级摘要", () => {
      const r = runCli(["project", workDir], baseEnv);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.includes("项目上下文"), r.stdout);
      assert.ok(r.stdout.includes("未检测到 package.json"), r.stdout);
      assert.ok(r.stdout.includes("hello.js"), r.stdout);
    });

    // ---------- help ----------

    await test("dm help 包含新命令", () => {
      const r = runCli(["help"], baseEnv);
      assert.equal(r.status, 0, r.stderr);
      assert.ok(r.stdout.includes("dm run"), r.stdout);
      assert.ok(r.stdout.includes("dm project"), r.stdout);
      assert.ok(r.stdout.includes("dm review"), r.stdout);
      assert.ok(r.stdout.includes("--exec"), r.stdout);
    });
  } finally {
    cleanupHermeticPackageFixture(fixture.packageDir);
    for (const dir of [cliHome, workDir]) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }

  console.log("");
  console.log("cli-enhanced tests: " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
