"use strict";
/**
 * 以参数数组启动 P1.5 开发态真实验收(与 npm run dev 同链:build → electron 二进制 → 脚本)。
 */
const { spawnSync, spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const root = path.resolve(__dirname, "..");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
run(process.execPath, [tsc, "-p", "tsconfig.json"]);

let electronPath;
try {
  electronPath = require("electron");
} catch {
  console.error("electron 未安装");
  process.exit(1);
}
if (typeof electronPath !== "string") {
  console.error("require('electron') 未返回路径");
  process.exit(1);
}

const script = path.join(root, "scripts", "electron-p15-dev-acceptance.cjs");
if (!fs.existsSync(script)) {
  console.error("missing acceptance script");
  process.exit(1);
}

const child = spawn(electronPath, [script], {
  cwd: root,
  stdio: "inherit",
  shell: false,
  env: { ...process.env, DIGITALME_V2_ROOT: root },
});
child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code || 0);
});
child.on("error", (err) => {
  console.error(err.message);
  process.exit(1);
});
