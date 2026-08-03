"use strict";
/**
 * 唯一 packaged 构建命令入口: npm run build:packaged
 * - 独立 staging 目录,不覆盖旧候选;
 * - 嵌入 build-meta(gitHead/buildId);
 * - 敏感文件扫描;
 * - 与 dev 同一 dist/ + electron/ 运行链。
 */
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: { ...process.env, ...(opts.env || {}) },
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function gitHead() {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
    shell: false,
  });
  if (result.status !== 0) return "unknown";
  return String(result.stdout || "").trim();
}

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walkFiles(full, out);
    else out.push(full);
  }
  return out;
}

function sensitiveScan(stagingDir) {
  const findings = [];
  const files = walkFiles(stagingDir);
  const bannedName = /(secrets?\.v\d+\.json|\.runtime-model-credential|userData|_mvp-.*-evidence)/i;
  const textExt = /\.(js|cjs|mjs|json|html|css|md|txt|yml|yaml|map)$/i;
  for (const file of files) {
    const rel = path.relative(stagingDir, file);
    if (bannedName.test(rel)) {
      findings.push({ file: rel, reason: "banned_path" });
      continue;
    }
    if (!textExt.test(file)) continue;
    let text = "";
    try {
      const buf = fs.readFileSync(file);
      if (buf.length > 2_000_000) continue;
      text = buf.toString("utf8");
    } catch {
      continue;
    }
    if (/sk-[A-Za-z0-9_-]{16,}/.test(text) || /BEGIN\s+PRIVATE\s+KEY/.test(text)) {
      findings.push({ file: rel, reason: "secret_like_content" });
    }
    if (/Authorization:\s*Bearer\s+\S+/i.test(text)) {
      findings.push({ file: rel, reason: "authorization_header" });
    }
  }
  return findings;
}

function main() {
  const buildId = `v2-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${gitHead().slice(0, 8)}`;
  const staging = path.join(root, "release-staging", buildId);
  fs.mkdirSync(staging, { recursive: true });

  // 1) compile domain
  const tsc = path.join(root, "node_modules", "typescript", "bin", "tsc");
  run(process.execPath, [tsc, "-p", "tsconfig.json"]);

  // 2) build-meta
  const meta = {
    buildId,
    gitHead: gitHead(),
    builtAt: new Date().toISOString(),
    productName: "DigitalMeV2",
    entry: {
      packaged: "electron/main.cjs",
      dev: "electron/main.cjs",
      domain: "dist/runtime/digitalme-runtime.js",
      jobRunner: "dist/work-runtime/job-runner.js",
      adapter: "dist/capability/adapters/openai-compatible.js",
    },
    sameRuntimeChain: true,
  };
  fs.writeFileSync(path.join(root, "build-meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");

  // 3) electron-builder → staging
  const ebCli = path.join(root, "node_modules", "electron-builder", "cli.js");
  if (!fs.existsSync(ebCli)) {
    console.error("electron-builder 未安装");
    process.exit(1);
  }
  run(process.execPath, [ebCli, "--win", "zip", "--x64", "--config", "electron-builder.yml"], {
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: "false",
    },
  });

  // electron-builder 默认写到 release-staging/_default;搬移到 buildId 目录
  const defaultOut = path.join(root, "release-staging", "_default");
  if (!fs.existsSync(defaultOut)) {
    console.error("electron-builder 输出目录缺失");
    process.exit(1);
  }
  for (const name of fs.readdirSync(defaultOut)) {
    const src = path.join(defaultOut, name);
    const dest = path.join(staging, name);
    fs.renameSync(src, dest);
  }
  fs.writeFileSync(path.join(staging, "build-meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");

  const allFiles = walkFiles(staging);
  const zip = allFiles.find((f) => /DigitalMeV2-.*-win-x64\.zip$/i.test(f));
  const exe =
    allFiles.find((f) => /DigitalMeV2\.exe$/i.test(path.basename(f)) && /win-unpacked/i.test(f)) ||
    allFiles.find((f) => /DigitalMeV2\.exe$/i.test(path.basename(f)));
  const asar = allFiles.find((f) => f.toLowerCase().endsWith(".asar"));
  const integrity = {
    buildId,
    gitHead: meta.gitHead,
    staging,
    deliveryFormat: "zip",
    zip: zip
      ? { path: path.relative(root, zip), sha256: sha256File(zip), bytes: fs.statSync(zip).size }
      : null,
    exe: exe
      ? { path: path.relative(root, exe), sha256: sha256File(exe), bytes: fs.statSync(exe).size }
      : null,
    asar: asar
      ? { path: path.relative(root, asar), sha256: sha256File(asar), bytes: fs.statSync(asar).size }
      : null,
    sensitiveFindings: sensitiveScan(staging),
    entryCompare: meta.entry,
  };
  fs.writeFileSync(
    path.join(staging, "integrity.json"),
    `${JSON.stringify(integrity, null, 2)}\n`,
    "utf8",
  );

  if (integrity.sensitiveFindings.length > 0) {
    console.error(JSON.stringify({ ok: false, integrity }, null, 2));
    process.exit(2);
  }

  console.log(JSON.stringify({ ok: true, integrity }, null, 2));
}

main();
