"use strict";

/**
 * Static scan: renderer/preload/public paths must not read or echo secret fields unsafely.
 * Also ensures security modules do not hardcode real-looking production secrets.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const TARGETS = [
  "src/preload.js",
  "src/renderer/app.js",
  "src/renderer/index.html",
  "src/security/secret-store.js",
  "src/security/config-secrets.js",
  "src/security/electron-safe-storage-adapter.js",
];

const FORBIDDEN = [
  { re: /sk-[a-zA-Z0-9]{20,}/, name: "openai_like_key" },
  { re: /ghp_[a-zA-Z0-9]{20,}/, name: "github_pat" },
  { re: /BSA[A-Za-z0-9_-]{20,}/, name: "brave_like" },
];

const RENDERER_FORBIDDEN = [
  { re: /cfg\.apiKey\b(?!Configured)/, name: "renderer_uses_cfg.apiKey_plaintext_field" },
  { re: /\.value\s*=\s*cfg\.apiKey/, name: "fills_input_from_apiKey" },
];

let failed = 0;

for (const rel of TARGETS) {
  const full = path.join(ROOT, rel);
  const text = fs.readFileSync(full, "utf8");
  for (const rule of FORBIDDEN) {
    if (rule.re.test(text)) {
      // Allow test fake prefixes in test files only — these are production src paths.
      console.error("FAIL", rel, rule.name);
      failed += 1;
    }
  }
  if (rel.includes("renderer") || rel.includes("preload")) {
    for (const rule of RENDERER_FORBIDDEN) {
      if (rule.re.test(text)) {
        console.error("FAIL", rel, rule.name);
        failed += 1;
      }
    }
  }
}

// preload must not expose getSecret
const preload = fs.readFileSync(path.join(ROOT, "src/preload.js"), "utf8");
if (/getSecret\s*:/.test(preload) || /invoke\(\s*["']secrets:get/.test(preload)) {
  console.error("FAIL preload exposes getSecret");
  failed += 1;
}

if (failed) {
  console.error("leak scan failed:", failed);
  process.exit(1);
}
console.log("PASS secret leak scan");
