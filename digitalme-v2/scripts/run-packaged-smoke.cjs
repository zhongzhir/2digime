"use strict";
/** Packaged 可见冒烟启动器(参数数组,隔离 userData)。 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function latestStaging() {
  const base = path.join(root, "release-staging");
  const dirs = fs
    .readdirSync(base)
    .filter((n) => n.startsWith("v2-") && fs.statSync(path.join(base, n)).isDirectory())
    .sort();
  return dirs.length ? path.join(base, dirs[dirs.length - 1]) : null;
}

function findExe(staging) {
  const stack = [staging];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) stack.push(full);
      else if (name.toLowerCase().endsWith(".exe")) return full;
    }
  }
  return null;
}

function prepareImportFile() {
  const src = path.join(
    root,
    "scripts",
    "_mvp-p14-real-capability-evidence",
    ".runtime-model-credential.json",
  );
  if (!fs.existsSync(src)) return null;
  const tmp = path.join(os.tmpdir(), `dmv2-smoke-cred-${process.pid}.json`);
  fs.copyFileSync(src, tmp);
  return tmp;
}

const staging = process.env.DIGITALME_V2_STAGING || latestStaging();
const exe = staging && findExe(staging);
const importFile = prepareImportFile();
if (!exe || !importFile) {
  console.error(JSON.stringify({ ok: false, error: "missing_exe_or_credential" }));
  process.exit(1);
}
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dmv2-p16-smoke-ud-"));
const evidence = path.join(root, "scripts", "_mvp-p16-packaged-smoke-evidence");
fs.mkdirSync(evidence, { recursive: true });

const child = spawn(exe, [`--user-data-dir=${userData}`], {
  cwd: staging,
  env: {
    ...process.env,
    DIGITALME_V2_PACKAGED_SMOKE: "1",
    DIGITALME_V2_CREDENTIAL_IMPORT: importFile,
    DIGITALME_V2_SMOKE_EVIDENCE: evidence,
    OPENAI_API_KEY: "",
    DEEPSEEK_API_KEY: "",
    DASHSCOPE_API_KEY: "",
    DIGITALME_MODEL_API_KEY: "",
  },
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
