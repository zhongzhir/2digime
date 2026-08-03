"use strict";
/** P2A ZIP 候选最小验收启动器。 */
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

function findUnpackedExe(staging) {
  const stack = [staging];
  while (stack.length) {
    const dir = stack.pop();
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) stack.push(full);
      else if (/DigitalMeV2\.exe$/i.test(name) && /win-unpacked/i.test(full)) return full;
    }
  }
  return null;
}

function prepareImportFile() {
  const candidates = [
    process.env.DIGITALME_V2_CREDENTIAL_IMPORT,
    path.join(root, "scripts", "_mvp-p14-real-capability-evidence", ".runtime-model-credential.json"),
  ].filter(Boolean);
  for (const src of candidates) {
    if (src && fs.existsSync(src)) {
      const tmp = path.join(os.tmpdir(), `dmv2-p2a-cred-${process.pid}.json`);
      fs.copyFileSync(src, tmp);
      return tmp;
    }
  }
  return null;
}

function materializeV2Slice() {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), "dmv2-p2a-slice-"));
  const files = [
    "package.json",
    "src/runtime/commands.ts",
    "src/work-runtime/execution-job.ts",
    "src/work-runtime/job-runner.ts",
    "src/work-runtime/context-snapshot.ts",
    "src/work-runtime/context-policy.ts",
    "src/capability/adapter.ts",
    "src/capability/registration.ts",
    "src/capability/adapters/code-repo-analysis.ts",
    "src/subject-core/subject-service.ts",
    "src/artifact-workspace/workspace.ts",
    "src/collaboration/local-simulation.ts",
    "electron/main.cjs",
  ];
  for (const rel of files) {
    const out = path.join(dest, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(path.join(root, rel), out);
  }
  return dest;
}

function main() {
  const staging = process.env.DIGITALME_V2_STAGING || latestStaging();
  if (!staging) {
    console.error(JSON.stringify({ ok: false, error: "no_staging_build" }));
    process.exit(1);
  }
  const exe = findUnpackedExe(staging);
  if (!exe) {
    console.error(JSON.stringify({ ok: false, error: "exe_missing", staging }));
    process.exit(1);
  }
  const importFile = prepareImportFile();
  if (!importFile) {
    console.error(JSON.stringify({ ok: false, error: "credential_import_missing" }));
    process.exit(2);
  }

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dmv2-p2a-userdata-"));
  const evidenceDir = path.join(root, "scripts", "_mvp-p2a-zip-candidate-evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });
  const v2Slice = materializeV2Slice();

  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(OPENAI|DEEPSEEK|ANTHROPIC|DIGITALME).*KEY$/i.test(key)) delete env[key];
  }
  delete env.DIGITALME_V2_PACKAGED_ACCEPTANCE;
  delete env.DIGITALME_V2_PACKAGED_SMOKE;
  delete env.DIGITALME_V2_CREDENTIAL_SETUP_ACCEPTANCE;
  delete env.DIGITALME_V2_P17_ACCEPTANCE;
  delete env.DIGITALME_V2_P23_ACCEPTANCE;
  env.DIGITALME_V2_CREDENTIAL_IMPORT = importFile;
  env.DIGITALME_V2_P2A_ACCEPTANCE = "1";
  env.DIGITALME_V2_P2A_EVIDENCE = evidenceDir;
  env.DIGITALME_V2_P2A_V2_SLICE = v2Slice;
  env.DIGITALME_V2_P2A_OTHER_REPO = process.env.DIGITALME_V2_P2A_OTHER_REPO || "D:\\Projects\\IMPRINT";
  env.DIGITALME_V2_APP_ROOT = root;

  console.log(JSON.stringify({ staging, exe, evidenceDir }));
  const child = spawn(exe, [`--user-data-dir=${userData}`], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => {
    stdout += d.toString("utf8");
    process.stdout.write(d);
  });
  child.stderr.on("data", (d) => {
    stderr += d.toString("utf8");
    process.stderr.write(d);
  });
  child.on("exit", (code) => {
    try {
      fs.unlinkSync(importFile);
    } catch {
      /* ignore */
    }
    const summaryPath = path.join(evidenceDir, "p2a-summary.json");
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
