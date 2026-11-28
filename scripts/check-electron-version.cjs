"use strict";
/**
 * 独立 Electron 版本检查。
 * - 不把 JS 表达式或临时脚本当作应用入口路径；
 * - 只调用 Electron 标准 --version，并设置硬超时。
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

function main() {
  let electronPath;
  try {
    electronPath = require("electron");
  } catch (err) {
    console.error(
      JSON.stringify({
        ok: false,
        error: "electron_not_installed",
        message: "请先在 digitalme-v2 目录执行 npm install",
      }),
    );
    process.exit(1);
  }

  if (typeof electronPath !== "string" || !electronPath.trim()) {
    console.error(
      JSON.stringify({
        ok: false,
        error: "electron_path_invalid",
        typeofPath: typeof electronPath,
      }),
    );
    process.exit(1);
  }

  const pkgVersion = require("electron/package.json").version;
  const result = spawnSync(electronPath, ["--version"], {
    encoding: "utf8",
    shell: false,
    cwd: path.resolve(__dirname, ".."),
    env: process.env,
    timeout: 30_000,
    windowsHide: true,
  });

  if (result.error) {
    console.error(
      JSON.stringify({
        ok: false,
        error: "spawn_failed",
        message: String(result.error.message || result.error),
        electronPath,
      }),
    );
    process.exit(1);
  }

  const runtimeVersion = String(result.stdout || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .pop()
    ?.replace(/^v/i, "");
  if (result.status !== 0 || !runtimeVersion) {
    console.error(
      JSON.stringify({
        ok: false,
        error: "version_print_failed",
        status: result.status,
        stderr: String(result.stderr || "").slice(0, 400),
      }),
    );
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        packageVersion: pkgVersion,
        runtimeVersion,
        electronPath,
      },
      null,
      2,
    ),
  );
}

main();
