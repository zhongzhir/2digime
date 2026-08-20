"use strict";
/**
 * 唯一开发启动入口: npm run dev
 * - 先编译领域层;
 * - 再以参数数组启动 Electron(shell:false);
 * - 从不拼接含空格路径的命令字符串。
 */
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const root = path.resolve(__dirname, "..");

function runNodeScript(scriptRel) {
  const script = path.join(root, scriptRel);
  const result = spawnSync(process.execPath, [script], {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function main() {
  const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
  if (!fs.existsSync(tsc)) {
    console.error("typescript 未安装，请先 npm install");
    process.exit(1);
  }
  const build = spawnSync(process.execPath, [tsc, "-p", "tsconfig.json"], {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  if (build.status !== 0) process.exit(build.status || 1);

  // 预检(含版本检查);失败则不启动 UI
  runNodeScript(path.join("scripts", "electron-preflight.cjs"));

  let electronPath;
  try {
    electronPath = require("electron");
  } catch {
    console.error("electron 未安装，请先 npm install");
    process.exit(1);
  }
  if (typeof electronPath !== "string") {
    console.error("require('electron') 未返回可执行路径");
    process.exit(1);
  }

  const mainEntry = path.join(root, "electron", "main.cjs");
  const child = spawn(electronPath, [mainEntry], {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      DIGITALME_V2_ROOT: root,
    },
  });
  child.on("exit", (code, signal) => {
    if (signal) process.exit(1);
    process.exit(code || 0);
  });
  child.on("error", (err) => {
    console.error("启动 Electron 失败:", err.message);
    process.exit(1);
  });
}

main();
