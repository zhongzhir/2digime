"use strict";
/**
 * 运行 packaged 凭证设置验收:全新隔离 userData,不预导入凭证。
 * 测试凭证仅经临时文件交给子进程内的 acceptance 读取并写入 safeStorage。
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function latestStaging() {
  const base = path.join(root, "release-staging");
  if (!fs.existsSync(base)) return null;
  const dirs = fs
    .readdirSync(base)
    .filter((n) => n.startsWith("v2-") && fs.statSync(path.join(base, n)).isDirectory())
    .filter((n) => !fs.existsSync(path.join(base, n, "REJECTED")))
    .sort();
  if (dirs.length === 0) return null;
  return path.join(base, dirs[dirs.length - 1]);
}

function findExe(staging) {
  // Prefer win-unpacked DigitalMeV2.exe for automation(portable self-extract can EPERM under some AV locks).
  const portable = [];
  const unpacked = [];
  const stack = [staging];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) stack.push(full);
      else if (name.toLowerCase().endsWith(".exe")) {
        if (/DigitalMeV2\.exe$/i.test(name) && /win-unpacked/i.test(full)) unpacked.push(full);
        else if (/portable/i.test(name)) portable.push(full);
      }
    }
  }
  return unpacked[0] || portable[0] || null;
}

function prepareImportFile() {
  const candidates = [
    process.env.DIGITALME_V2_CREDENTIAL_IMPORT,
    path.join(root, "scripts", "_mvp-p14-real-capability-evidence", ".runtime-model-credential.json"),
  ].filter(Boolean);
  for (const src of candidates) {
    if (src && fs.existsSync(src)) {
      const tmp = path.join(os.tmpdir(), `dmv2-cred-setup-src-${process.pid}.json`);
      fs.copyFileSync(src, tmp);
      return tmp;
    }
  }
  return null;
}

function main() {
  const staging = process.env.DIGITALME_V2_STAGING || latestStaging();
  if (!staging) {
    console.error(JSON.stringify({ ok: false, error: "no_staging_build" }));
    process.exit(1);
  }
  const exe = findExe(staging);
  if (!exe) {
    console.error(JSON.stringify({ ok: false, error: "exe_missing", staging }));
    process.exit(1);
  }
  const importFile = prepareImportFile();
  if (!importFile) {
    console.error(JSON.stringify({ ok: false, error: "credential_import_missing" }));
    process.exit(2);
  }

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dmv2-cred-setup-userdata-"));
  const evidenceDir = path.join(root, "scripts", "_mvp-p16-credential-setup-evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });

  // 关键:不设置 DIGITALME_V2_CREDENTIAL_IMPORT,确保首次启动无凭证。
  // acceptance 内部通过 DIGITALME_V2_CREDENTIAL_SETUP_SOURCE 读取测试密钥并走 saveCredential。
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/api[_-]?key|secret|token|password/i.test(key) && key !== "DIGITALME_V2_CREDENTIAL_SETUP_SOURCE") {
      // 不向子进程传递密钥类 env
      if (/^(OPENAI|DEEPSEEK|ANTHROPIC|DIGITALME).*KEY$/i.test(key)) delete env[key];
    }
  }
  delete env.DIGITALME_V2_CREDENTIAL_IMPORT;
  env.DIGITALME_V2_CREDENTIAL_SETUP_ACCEPTANCE = "1";
  env.DIGITALME_V2_CREDENTIAL_SETUP_SOURCE = importFile;
  env.DIGITALME_V2_CREDENTIAL_SETUP_EVIDENCE = evidenceDir;

  const child = spawn(exe, [`--user-data-dir=${userData}`], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => {
    stdout += d.toString("utf8");
  });
  child.stderr.on("data", (d) => {
    stderr += d.toString("utf8");
  });

  child.on("exit", (code) => {
    try {
      fs.unlinkSync(importFile);
    } catch {
      /* ignore */
    }
    const summaryPath = path.join(evidenceDir, "summary.json");
    if (fs.existsSync(summaryPath)) {
      process.stdout.write(fs.readFileSync(summaryPath, "utf8"));
    } else {
      console.error(
        JSON.stringify({
          ok: false,
          error: "summary_missing",
          code,
          stderr: stderr.slice(0, 2000),
          stdout: stdout.slice(0, 2000),
        }),
      );
    }
    process.exit(code == null ? 1 : code);
  });
}

main();
