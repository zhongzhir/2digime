"use strict";

/**
 * P1-01 automatic tests (no real userData, no real secrets).
 * Run: node scripts/test-p1-01-secret-store.cjs
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const {
  SecretStore,
  createFakeEncryptAdapter,
} = require("../src/security/secret-store");
const {
  ConfigSecretsService,
  MODEL_API_KEY_ID,
  extensionSecretId,
  deepContainsSecret,
  scanDirForPlaintextSecrets,
  LEGACY_BACKUP_NAME,
} = require("../src/security/config-secrets");

const FAKE_MODEL_KEY = "sk-test-MODEL-KEY-9f3a2c1b";
const FAKE_BRAVE = "BSA-test-brave-token-7788";
const FAKE_GITHUB = "ghp_test_github_token_AABB";
const FAKE_LOG_LEVEL = "info";
const ALL_FAKES = [FAKE_MODEL_KEY, FAKE_BRAVE, FAKE_GITHUB, FAKE_LOG_LEVEL];

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, err && err.stack ? err.stack : err);
  }
}

function tempDir(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dm-p101-${label}-`));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function makeService(dir, adapterOpts, hooks) {
  const store = new SecretStore({
    userDataPath: dir,
    encryptAdapter: createFakeEncryptAdapter(adapterOpts || {}),
  });
  const configPath = path.join(dir, "config.json");
  const svc = new ConfigSecretsService({
    userDataPath: dir,
    configPath,
    secretStore: store,
    defaultPackageDir: path.join(dir, "pkg"),
    hooks: hooks || {},
  });
  return { svc, store, configPath };
}

function assertNoPlaintextArtifacts(dir, secrets) {
  const hits = scanDirForPlaintextSecrets(dir, secrets);
  assert.equal(hits.length, 0, "plaintext remains: " + JSON.stringify(hits));
  assert.equal(fs.existsSync(path.join(dir, LEGACY_BACKUP_NAME)), false);
  const leftovers = fs
    .readdirSync(dir)
    .filter((n) => n.startsWith("config.json.migrate-tmp.") && n.endsWith(".bak"));
  assert.equal(leftovers.length, 0, "temp backups remain: " + leftovers.join(","));
}

test("SecretStore set/get/has/delete", () => {
  const dir = tempDir("crud");
  try {
    const store = new SecretStore({
      userDataPath: dir,
      encryptAdapter: createFakeEncryptAdapter(),
    });
    assert.equal(store.has(MODEL_API_KEY_ID), false);
    store.set(MODEL_API_KEY_ID, FAKE_MODEL_KEY);
    assert.equal(store.has(MODEL_API_KEY_ID), true);
    assert.equal(store.get(MODEL_API_KEY_ID), FAKE_MODEL_KEY);
    assert.ok(store.listConfigured().includes(MODEL_API_KEY_ID));
    assert.equal(store.delete(MODEL_API_KEY_ID), true);
    assert.equal(store.has(MODEL_API_KEY_ID), false);
    assert.equal(store.get(MODEL_API_KEY_ID), null);
  } finally {
    cleanup(dir);
  }
});

test("storage file does not contain plaintext secret", () => {
  const dir = tempDir("plain");
  try {
    const store = new SecretStore({
      userDataPath: dir,
      encryptAdapter: createFakeEncryptAdapter(),
    });
    store.set(MODEL_API_KEY_ID, FAKE_MODEL_KEY);
    const raw = fs.readFileSync(path.join(dir, "secrets.v1.json"), "utf8");
    assert.equal(raw.includes(FAKE_MODEL_KEY), false);
  } finally {
    cleanup(dir);
  }
});

test("successful migration leaves no plaintext in config or backups", () => {
  const dir = tempDir("no-bak");
  try {
    const { svc, configPath } = makeService(dir);
    // Plant a legacy permanent backup to ensure cleanup.
    fs.writeFileSync(
      path.join(dir, LEGACY_BACKUP_NAME),
      JSON.stringify({ apiKey: FAKE_MODEL_KEY }),
      "utf8"
    );
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        baseURL: "https://example.test/v1",
        model: "demo",
        apiKey: FAKE_MODEL_KEY,
        capabilityExtensions: [
          {
            id: "brave-search",
            env: { BRAVE_API_KEY: FAKE_BRAVE, LOG_LEVEL: FAKE_LOG_LEVEL },
          },
        ],
      }),
      "utf8"
    );
    const mig = svc.migrateLegacySecrets();
    assert.equal(mig.status, "completed");
    assert.notEqual(mig.status, "failed");
    const disk = fs.readFileSync(configPath, "utf8");
    assert.equal(disk.includes(FAKE_MODEL_KEY), false);
    assert.equal(disk.includes(FAKE_BRAVE), false);
    assertNoPlaintextArtifacts(dir, [FAKE_MODEL_KEY, FAKE_BRAVE]);
    // LOG_LEVEL value "info" may appear in unrelated words; check structured absence in config JSON.
    const cfg = JSON.parse(disk);
    assert.equal(cfg.apiKey, undefined);
    const ext = cfg.capabilityExtensions[0];
    assert.equal(ext.env, undefined);
    assert.ok(ext.envKeyNames.includes("LOG_LEVEL"));
    assert.ok(ext.envKeyNames.includes("BRAVE_API_KEY"));
  } finally {
    cleanup(dir);
  }
});

test("short env LOG_LEVEL=info migrates and hydrates", () => {
  const dir = tempDir("loglevel");
  try {
    const { svc, store, configPath } = makeService(dir);
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        capabilityExtensions: [
          { id: "fetch", env: { LOG_LEVEL: FAKE_LOG_LEVEL, BRAVE_API_KEY: FAKE_BRAVE } },
        ],
      }),
      "utf8"
    );
    const mig = svc.migrateLegacySecrets();
    assert.equal(mig.status, "completed");
    assert.equal(store.get(extensionSecretId("fetch", "LOG_LEVEL")), FAKE_LOG_LEVEL);
    assert.equal(store.get(extensionSecretId("fetch", "BRAVE_API_KEY")), FAKE_BRAVE);
    const hydrated = svc.hydrateExtensionEnv({
      id: "fetch",
      envKeyNames: ["LOG_LEVEL", "BRAVE_API_KEY"],
    });
    assert.equal(hydrated.env.LOG_LEVEL, FAKE_LOG_LEVEL);
    assert.equal(hydrated.env.BRAVE_API_KEY, FAKE_BRAVE);
    const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(cfg.capabilityExtensions[0].env, undefined);
  } finally {
    cleanup(dir);
  }
});

test("corrupt JSON is not overwritten", () => {
  const dir = tempDir("corrupt");
  try {
    const { svc, configPath } = makeService(dir);
    const corrupt = "{ not-json apiKey: \"" + FAKE_MODEL_KEY + "\"";
    fs.writeFileSync(configPath, corrupt, "utf8");
    const before = fs.readFileSync(configPath, "utf8");
    const mig = svc.migrateLegacySecrets();
    assert.equal(mig.status, "blocked");
    assert.equal(mig.code, "config_json_corrupt");
    assert.notEqual(mig.status, "completed");
    const after = fs.readFileSync(configPath, "utf8");
    assert.equal(after, before);
    assert.ok(after.includes(FAKE_MODEL_KEY));
  } finally {
    cleanup(dir);
  }
});

test("unreadable config file is not overwritten", () => {
  const dir = tempDir("unreadable");
  try {
    const { svc, configPath } = makeService(dir);
    // Make configPath a directory so readFileSync fails with EISDIR.
    fs.mkdirSync(configPath);
    fs.writeFileSync(path.join(configPath, "nested.txt"), FAKE_MODEL_KEY, "utf8");
    const mig = svc.migrateLegacySecrets();
    assert.equal(mig.status, "blocked");
    assert.ok(
      mig.code === "config_not_a_file" ||
        mig.code === "config_read_failed" ||
        mig.code === "config_permission_denied"
    );
    assert.notEqual(mig.status, "completed");
    assert.ok(fs.statSync(configPath).isDirectory());
    assert.equal(fs.readFileSync(path.join(configPath, "nested.txt"), "utf8"), FAKE_MODEL_KEY);
  } finally {
    cleanup(dir);
  }
});

test("SecretStore write failure keeps old config and is not completed", () => {
  const dir = tempDir("writefail");
  try {
    const { svc, configPath } = makeService(dir, { failEncrypt: true });
    const original = JSON.stringify({ apiKey: FAKE_MODEL_KEY, model: "keep-me" }, null, 2);
    fs.writeFileSync(configPath, original, "utf8");
    const mig = svc.migrateLegacySecrets();
    assert.equal(mig.status, "failed");
    assert.notEqual(mig.status, "completed");
    const disk = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(disk.apiKey, FAKE_MODEL_KEY);
    assert.equal(disk.model, "keep-me");
    assertNoPlaintextArtifacts(
      dir,
      // config still has plaintext by design on failure; exclude config.json from artifact claim
      []
    );
    assert.equal(fs.existsSync(path.join(dir, LEGACY_BACKUP_NAME)), false);
    const tmpLeft = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith("config.json.migrate-tmp."));
    assert.equal(tmpLeft.length, 0);
  } finally {
    cleanup(dir);
  }
});

test("verify/readback failure keeps old config and is not completed", () => {
  const dir = tempDir("verifyfail");
  try {
    const { svc, configPath } = makeService(dir, { failDecrypt: true });
    fs.writeFileSync(configPath, JSON.stringify({ apiKey: FAKE_MODEL_KEY }), "utf8");
    const mig = svc.migrateLegacySecrets();
    assert.equal(mig.status, "failed");
    assert.ok(mig.code === "secret_verify_failed" || mig.code === "secret_decrypt_failed");
    assert.notEqual(mig.status, "completed");
    const disk = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(disk.apiKey, FAKE_MODEL_KEY);
    const tmpLeft = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith("config.json.migrate-tmp."));
    assert.equal(tmpLeft.length, 0);
  } finally {
    cleanup(dir);
  }
});

test("cleaned config write failure keeps old config and is not completed", () => {
  const dir = tempDir("finalwrite");
  try {
    const { svc, store, configPath } = makeService(dir, {}, {
      beforeCommitCleanedConfig() {
        const err = new Error("forced_clean_write_fail");
        err.code = "forced_clean_write_fail";
        throw err;
      },
    });
    fs.writeFileSync(
      configPath,
      JSON.stringify({ apiKey: FAKE_MODEL_KEY, model: "still-here" }),
      "utf8"
    );
    const before = fs.readFileSync(configPath, "utf8");
    const mig = svc.migrateLegacySecrets();
    assert.equal(mig.status, "failed");
    assert.equal(mig.code, "forced_clean_write_fail");
    assert.notEqual(mig.status, "completed");
    const after = fs.readFileSync(configPath, "utf8");
    assert.equal(after, before);
    assert.ok(after.includes(FAKE_MODEL_KEY));
    // Secrets may already be written; that is OK. Must not claim completed or leave tmp backups.
    assert.equal(store.has(MODEL_API_KEY_ID), true);
    const tmpLeft = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith("config.json.migrate-tmp."));
    assert.equal(tmpLeft.length, 0);
    assert.equal(fs.existsSync(path.join(dir, LEGACY_BACKUP_NAME)), false);
  } finally {
    cleanup(dir);
  }
});

test("PublicConfig serialization excludes secrets", () => {
  const dir = tempDir("public");
  try {
    const { svc, configPath } = makeService(dir);
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        baseURL: "https://example.test/v1",
        model: "demo",
        apiKey: FAKE_MODEL_KEY,
        capabilityExtensions: [
          { id: "brave-search", env: { BRAVE_API_KEY: FAKE_BRAVE } },
        ],
      }),
      "utf8"
    );
    const mig = svc.migrateLegacySecrets();
    assert.equal(mig.status, "completed");
    const pub = svc.readPublicConfig();
    assert.equal(pub.apiKey, "");
    assert.equal(pub.apiKeyConfigured, true);
    assert.equal(deepContainsSecret(pub, [FAKE_MODEL_KEY, FAKE_BRAVE]), null);
  } finally {
    cleanup(dir);
  }
});

test("legacy API key migration then runtime still resolves", () => {
  const dir = tempDir("mig-api");
  try {
    const { svc, configPath } = makeService(dir);
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        baseURL: "https://example.test/v1",
        model: "demo",
        apiKey: FAKE_MODEL_KEY,
        packageDir: "X",
      }),
      "utf8"
    );
    const first = svc.migrateLegacySecrets();
    assert.equal(first.status, "completed");
    assert.equal(svc.getRuntimeConfig().apiKey, FAKE_MODEL_KEY);
    assert.equal(fs.existsSync(svc.backupPath()), false);
    assertNoPlaintextArtifacts(dir, [FAKE_MODEL_KEY]);
  } finally {
    cleanup(dir);
  }
});

test("extension env migration isolates by extension id", () => {
  const dir = tempDir("mig-ext");
  try {
    const { svc, store, configPath } = makeService(dir);
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        capabilityExtensions: [
          { id: "brave-search", env: { BRAVE_API_KEY: FAKE_BRAVE } },
          { id: "github", env: { GITHUB_PERSONAL_ACCESS_TOKEN: FAKE_GITHUB } },
        ],
      }),
      "utf8"
    );
    assert.equal(svc.migrateLegacySecrets().status, "completed");
    assert.equal(store.get(extensionSecretId("brave-search", "BRAVE_API_KEY")), FAKE_BRAVE);
    assert.equal(store.get(extensionSecretId("github", "GITHUB_PERSONAL_ACCESS_TOKEN")), FAKE_GITHUB);
    assert.equal(store.has(extensionSecretId("brave-search", "GITHUB_PERSONAL_ACCESS_TOKEN")), false);
  } finally {
    cleanup(dir);
  }
});

test("migration is idempotent", () => {
  const dir = tempDir("idem");
  try {
    const { svc, store, configPath } = makeService(dir);
    fs.writeFileSync(configPath, JSON.stringify({ apiKey: FAKE_MODEL_KEY }), "utf8");
    assert.equal(svc.migrateLegacySecrets().status, "completed");
    assert.equal(svc.migrateLegacySecrets().status, "completed");
    assert.equal(store.get(MODEL_API_KEY_ID), FAKE_MODEL_KEY);
  } finally {
    cleanup(dir);
  }
});

test("encryption unavailable keeps plaintext config", () => {
  const dir = tempDir("unavail");
  try {
    const { svc, configPath } = makeService(dir, { available: false });
    fs.writeFileSync(configPath, JSON.stringify({ apiKey: FAKE_MODEL_KEY }), "utf8");
    const mig = svc.migrateLegacySecrets();
    assert.equal(mig.status, "blocked");
    assert.notEqual(mig.status, "completed");
    assert.equal(JSON.parse(fs.readFileSync(configPath, "utf8")).apiKey, FAKE_MODEL_KEY);
  } finally {
    cleanup(dir);
  }
});

test("blank save keeps key; replace and clear work", () => {
  const dir = tempDir("ui");
  try {
    const { svc } = makeService(dir);
    svc.setConfigFromRenderer({
      baseURL: "https://a.test/v1",
      model: "m1",
      apiKey: FAKE_MODEL_KEY,
      packageDir: "p",
    });
    svc.setConfigFromRenderer({
      baseURL: "https://b.test/v1",
      model: "m2",
      apiKey: "",
      packageDir: "p",
    });
    assert.equal(svc.getRuntimeConfig().apiKey, FAKE_MODEL_KEY);
    const replaced = "sk-test-REPLACED-KEY-0001";
    svc.setConfigFromRenderer({
      baseURL: "https://b.test/v1",
      model: "m2",
      apiKey: replaced,
      packageDir: "p",
    });
    assert.equal(svc.getRuntimeConfig().apiKey, replaced);
    svc.clearModelApiKey();
    assert.equal(svc.getRuntimeConfig().apiKey, "");
  } finally {
    cleanup(dir);
  }
});

test("IPC-shaped public objects never embed known secrets", () => {
  const dir = tempDir("ipc");
  try {
    const { svc } = makeService(dir);
    svc.setConfigFromRenderer({
      baseURL: "https://x.test/v1",
      model: "m",
      apiKey: FAKE_MODEL_KEY,
      packageDir: "p",
    });
    svc.saveExtensionsList([
      {
        id: "brave-search",
        name: "Brave",
        command: "npx",
        args: [],
        env: { BRAVE_API_KEY: FAKE_BRAVE },
      },
    ]);
    const hit = deepContainsSecret(
      { pub: svc.readPublicConfig(), exts: svc.getPublicExtensions() },
      [FAKE_MODEL_KEY, FAKE_BRAVE, FAKE_GITHUB]
    );
    assert.equal(hit, null);
  } finally {
    cleanup(dir);
  }
});

test("refuses noop base64-as-encryption adapter", () => {
  const dir = tempDir("noop");
  try {
    const badAdapter = {
      isAvailable: () => true,
      encryptString: (s) => Buffer.from(s, "utf8").toString("base64"),
      decryptString: (c) => Buffer.from(c, "base64").toString("utf8"),
    };
    const store = new SecretStore({ userDataPath: dir, encryptAdapter: badAdapter });
    assert.throws(() => store.set(MODEL_API_KEY_ID, FAKE_MODEL_KEY), /secret_encrypt_noop/);
  } finally {
    cleanup(dir);
  }
});

test("setConfigFromRenderer refuses to overwrite corrupt config", () => {
  const dir = tempDir("set-corrupt");
  try {
    const { svc, configPath } = makeService(dir);
    const corrupt = "{ broken " + FAKE_MODEL_KEY;
    fs.writeFileSync(configPath, corrupt, "utf8");
    assert.throws(() => {
      svc.setConfigFromRenderer({ baseURL: "https://x", model: "m", apiKey: "", packageDir: "p" });
    }, /config_json_corrupt|损坏|无法/);
    assert.equal(fs.readFileSync(configPath, "utf8"), corrupt);
  } finally {
    cleanup(dir);
  }
});

console.log("\nSummary:", { passed, failed });
if (failed) process.exit(1);
console.log("OK");
