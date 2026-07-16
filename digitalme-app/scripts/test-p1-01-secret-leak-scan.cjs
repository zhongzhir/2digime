"use strict";

/**
 * Leak scan:
 * 1) Static scan of security-related source files
 * 2) Migration artifact scan under a temporary userData (never real userData)
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  SecretStore,
  createFakeEncryptAdapter,
} = require("../src/security/secret-store");
const {
  ConfigSecretsService,
  scanDirForPlaintextSecrets,
  LEGACY_BACKUP_NAME,
} = require("../src/security/config-secrets");

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

const FAKE_MODEL_KEY = "sk-test-LEAKSCAN-MODEL-KEY-aa11";
const FAKE_BRAVE = "BSA-test-leakscan-brave-bb22";
const FAKE_SHORT = "info";

let failed = 0;

for (const rel of TARGETS) {
  const full = path.join(ROOT, rel);
  const text = fs.readFileSync(full, "utf8");
  for (const rule of FORBIDDEN) {
    if (rule.re.test(text)) {
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

const preload = fs.readFileSync(path.join(ROOT, "src/preload.js"), "utf8");
if (/getSecret\s*:/.test(preload) || /invoke\(\s*["']secrets:get/.test(preload)) {
  console.error("FAIL preload exposes getSecret");
  failed += 1;
}

// --- Temp userData migration artifact scan ---
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dm-p101-leakscan-"));
try {
  const configPath = path.join(tmp, "config.json");
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      apiKey: FAKE_MODEL_KEY,
      capabilityExtensions: [
        {
          id: "brave-search",
          env: { BRAVE_API_KEY: FAKE_BRAVE, LOG_LEVEL: FAKE_SHORT },
        },
      ],
    }),
    "utf8"
  );
  // Plant legacy permanent backup that must be removed on success.
  fs.writeFileSync(
    path.join(tmp, LEGACY_BACKUP_NAME),
    JSON.stringify({ apiKey: FAKE_MODEL_KEY }),
    "utf8"
  );

  const store = new SecretStore({
    userDataPath: tmp,
    encryptAdapter: createFakeEncryptAdapter(),
  });
  const svc = new ConfigSecretsService({
    userDataPath: tmp,
    configPath,
    secretStore: store,
  });
  const mig = svc.migrateLegacySecrets();
  if (mig.status !== "completed") {
    console.error("FAIL migration_artifact_scan migration_not_completed", mig);
    failed += 1;
  } else {
    const hits = scanDirForPlaintextSecrets(tmp, [FAKE_MODEL_KEY, FAKE_BRAVE]);
    if (hits.length) {
      console.error("FAIL migration_artifact_plaintext", hits);
      failed += 1;
    }
    if (fs.existsSync(path.join(tmp, LEGACY_BACKUP_NAME))) {
      console.error("FAIL legacy_plaintext_backup_remains");
      failed += 1;
    }
    const tmpBackups = fs
      .readdirSync(tmp)
      .filter((n) => n.startsWith("config.json.migrate-tmp."));
    if (tmpBackups.length) {
      console.error("FAIL temp_plaintext_backup_remains", tmpBackups);
      failed += 1;
    }
  }
} catch (err) {
  console.error("FAIL migration_artifact_scan_error", err);
  failed += 1;
} finally {
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

if (failed) {
  console.error("leak scan failed:", failed);
  process.exit(1);
}
console.log("PASS secret leak scan (source + temp migration artifacts)");
