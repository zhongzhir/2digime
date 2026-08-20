"use strict";
/**
 * Electron 启动预检(P1.5 第一步)。
 * 定位并防止两类历史错误:
 * 1) 把 `console.log(process.versions.electron)` 当成应用路径 → 出现 console.log(...) 命名的伪路径
 * 2) 拼接含空格路径(如 `Some Directory/Digital Me`)时未可靠引号 → 被截断成 `Some Directory/Digital`
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const failures = [];

function fail(code, message, detail) {
  failures.push({ code, message, ...(detail ? { detail } : {}) });
}

function readPackageScripts() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  return pkg.scripts || {};
}

function scanScripts() {
  const scripts = readPackageScripts();
  for (const [name, body] of Object.entries(scripts)) {
    const text = String(body);
    if (/electron\s+-e\b/.test(text) || /electron\s+--eval\b/.test(text)) {
      fail(
        "script_uses_electron_eval",
        `script "${name}" 使用 electron -e/--eval，易把表达式误当作应用路径`,
        text,
      );
    }
    if (/console\.log\s*\(\s*process\.versions\.electron/.test(text)) {
      fail(
        "script_embeds_console_log_path",
        `script "${name}" 内嵌 console.log(process.versions.electron)`,
        text,
      );
    }
    // 未引号的 Digital Me 截断风险(粗检)
    if (/Digital\s+Me/.test(text) && !/["'].*Digital\s+Me.*["']/.test(text)) {
      fail(
        "script_unquoted_space_path",
        `script "${name}" 可能含未可靠引号的空格路径`,
        text,
      );
    }
  }

  if (!scripts.dev) {
    fail("missing_dev_script", "缺少唯一开发启动命令 npm run dev");
  }
  if (!scripts["electron:version"]) {
    fail("missing_electron_version_script", "缺少独立 electron:version 命令");
  }
}

function checkElectronBinary() {
  let electronPath;
  try {
    electronPath = require("electron");
  } catch {
    fail("electron_missing", "digitalme-v2 未安装 electron 依赖");
    return null;
  }
  if (typeof electronPath !== "string") {
    fail("electron_path_not_string", "require('electron') 未返回二进制路径字符串", {
      typeofPath: typeof electronPath,
    });
    return null;
  }
  if (!fs.existsSync(electronPath)) {
    fail("electron_binary_missing", "Electron 二进制不存在", { electronPath });
    return null;
  }
  return electronPath;
}

function checkVersionCommand(electronPath) {
  if (!electronPath) return;
  const checker = path.join(__dirname, "check-electron-version.cjs");
  const result = spawnSync(process.execPath, [checker], {
    cwd: root,
    encoding: "utf8",
    shell: false,
    env: process.env,
  });
  if (result.status !== 0) {
    fail("electron_version_check_failed", "electron:version 预检失败", {
      status: result.status,
      stderr: String(result.stderr || "").slice(0, 400),
      stdout: String(result.stdout || "").slice(0, 400),
    });
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(String(result.stdout || ""));
  } catch {
    fail("electron_version_json_invalid", "版本检查输出不是 JSON");
    return;
  }
  if (!parsed.ok || !parsed.runtimeVersion) {
    fail("electron_version_incomplete", "版本检查未返回 runtimeVersion", parsed);
  }
}

function checkSpawnWithSpacePath(electronPath) {
  if (!electronPath) return;
  const spaced = fs.mkdtempSync(path.join(os.tmpdir(), "dm v2 preflight "));
  const script = path.join(spaced, "ok.cjs");
  fs.writeFileSync(
    script,
    "process.stdout.write('space-path-ok\\n'); process.exit(0);\n",
    "utf8",
  );
  const result = spawnSync(electronPath, [script], {
    cwd: spaced,
    encoding: "utf8",
    shell: false,
    env: process.env,
  });
  try {
    fs.rmSync(spaced, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  if (result.status !== 0 || !String(result.stdout || "").includes("space-path-ok")) {
    fail("spawn_space_path_failed", "含空格路径的参数数组启动失败", {
      status: result.status,
      stderr: String(result.stderr || "").slice(0, 400),
    });
  }
}

function checkMainEntry() {
  const main = path.join(root, "electron", "main.cjs");
  if (!fs.existsSync(main)) {
    fail("main_entry_missing", "缺少 electron/main.cjs");
  }
  const preload = path.join(root, "electron", "preload.cjs");
  if (!fs.existsSync(preload)) {
    fail("preload_missing", "缺少 electron/preload.cjs");
  }
}

function checkForbiddenPatternsInRepoScripts() {
  const scriptsDir = path.join(root, "scripts");
  const files = fs.readdirSync(scriptsDir).filter((f) => f.endsWith(".cjs") || f.endsWith(".js"));
  for (const file of files) {
    const text = fs.readFileSync(path.join(scriptsDir, file), "utf8");
    // 禁止拼接含路径的 shell 命令字符串启动 electron
    if (/spawnSync?\(\s*[`'"][^`'"]*electron[^`'"]*\$\{/.test(text)) {
      fail("interpolated_electron_spawn", `${file} 使用模板字符串拼接 electron 启动命令`);
    }
    if (/exec\(['"][^'"]*electron/.test(text)) {
      fail("exec_electron_string", `${file} 使用 exec 字符串启动 electron`);
    }
  }
}

function main() {
  scanScripts();
  const electronPath = checkElectronBinary();
  checkVersionCommand(electronPath);
  checkSpawnWithSpacePath(electronPath);
  checkMainEntry();
  checkForbiddenPatternsInRepoScripts();

  if (failures.length > 0) {
    console.error(JSON.stringify({ ok: false, failures }, null, 2));
    process.exit(1);
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        root,
        electronPath,
        notes: [
          "历史错误 console.log(process.versions.electron) 来自把 -e 表达式当应用路径",
          "历史错误 截断的路径 来自未引号的空格路径拼接",
          "本预检强制参数数组启动，并提供 npm run electron:version / npm run dev",
        ],
      },
      null,
      2,
    ),
  );
}

main();
