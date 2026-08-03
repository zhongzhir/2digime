"use strict";
/** P1.7 packaged 验收启动器。 */
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
  return dirs.length ? path.join(base, dirs[dirs.length - 1]) : null;
}

function findExe(staging) {
  const unpacked = [];
  const portable = [];
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
      const tmp = path.join(os.tmpdir(), `dmv2-p17-cred-${process.pid}.json`);
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

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dmv2-p17-userdata-"));
  const evidenceDir = path.join(root, "scripts", "_mvp-p17-owner-feedback-evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });

  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(OPENAI|DEEPSEEK|ANTHROPIC|DIGITALME).*KEY$/i.test(key)) delete env[key];
  }
  delete env.DIGITALME_V2_PACKAGED_ACCEPTANCE;
  delete env.DIGITALME_V2_PACKAGED_SMOKE;
  delete env.DIGITALME_V2_CREDENTIAL_SETUP_ACCEPTANCE;
  env.DIGITALME_V2_CREDENTIAL_IMPORT = importFile;
  env.DIGITALME_V2_P17_ACCEPTANCE = "1";
  env.DIGITALME_V2_P17_EVIDENCE = evidenceDir;

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
    if (fs.existsSync(summaryPath)) process.stdout.write(fs.readFileSync(summaryPath, "utf8"));
    else {
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
