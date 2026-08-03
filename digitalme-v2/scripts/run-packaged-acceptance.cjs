"use strict";
/**
 * 运行 packaged 自动验收:隔离 userData + 一次性凭证导入 + 参数数组启动 exe。
 */
const { spawn, spawnSync } = require("node:child_process");
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
    .sort();
  if (dirs.length === 0) return null;
  return path.join(base, dirs[dirs.length - 1]);
}

function findExe(staging) {
  const stack = [staging];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) stack.push(full);
      else if (name.toLowerCase().endsWith(".exe") && /portable/i.test(name)) return full;
    }
  }
  // fallback any exe
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        const hit = walk(full);
        if (hit) return hit;
      } else if (name.toLowerCase().endsWith(".exe")) return full;
    }
    return null;
  };
  return walk(staging);
}

function prepareImportFile() {
  const candidates = [
    process.env.DIGITALME_V2_CREDENTIAL_IMPORT,
    path.join(root, "scripts", "_mvp-p14-real-capability-evidence", ".runtime-model-credential.json"),
  ].filter(Boolean);
  for (const src of candidates) {
    if (src && fs.existsSync(src)) {
      const tmp = path.join(os.tmpdir(), `dmv2-cred-import-${process.pid}.json`);
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

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dmv2-p16-userdata-"));
  const evidence = path.join(root, "scripts", "_mvp-p16-packaged-acceptance-evidence");
  fs.mkdirSync(evidence, { recursive: true });

  const args = [`--user-data-dir=${userData}`];
  const env = {
    ...process.env,
    DIGITALME_V2_PACKAGED_ACCEPTANCE: "1",
    DIGITALME_V2_CREDENTIAL_IMPORT: importFile,
    DIGITALME_V2_ACCEPTANCE_EVIDENCE: evidence,
  };
  // 清除可能把 key 打进子进程命令行的变量? 我们不把 key 放进 env。
  delete env.OPENAI_API_KEY;
  delete env.DEEPSEEK_API_KEY;
  delete env.DASHSCOPE_API_KEY;
  delete env.DIGITALME_MODEL_API_KEY;

  const child = spawn(exe, args, {
    cwd: staging,
    env,
    stdio: "inherit",
    shell: false,
  });
  child.on("exit", (code) => {
    try {
      fs.unlinkSync(importFile);
    } catch {
      /* ignore */
    }
    process.exit(code || 0);
  });
  child.on("error", (err) => {
    console.error(String(err.message || err));
    process.exit(1);
  });
}

main();
