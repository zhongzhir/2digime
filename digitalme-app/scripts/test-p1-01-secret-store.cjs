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
} = require("../src/security/config-secrets");

const FAKE_MODEL_KEY = "sk-test-MODEL-KEY-9f3a2c1b";
const FAKE_BRAVE = "BSA-test-brave-token-7788";
const FAKE_GITHUB = "ghp_test_github_token_AABB";

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    results.push({ name, ok: true });
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    results.push({ name, ok: false, error: String(err && err.message ? err.message : err) });
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

function makeService(dir, adapterOpts) {
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
  });
  return { svc, store, configPath };
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
    const json = JSON.parse(raw);
    assert.ok(json.secrets[MODEL_API_KEY_ID].ciphertext);
    assert.notEqual(json.secrets[MODEL_API_KEY_ID].ciphertext, FAKE_MODEL_KEY);
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
          {
            id: "brave-search",
            name: "Brave",
            command: "npx",
            args: [],
            env: { BRAVE_API_KEY: FAKE_BRAVE },
          },
        ],
      }),
      "utf8"
    );
    const mig = svc.migrateLegacySecrets();
    assert.equal(mig.status, "completed");
    const pub = svc.readPublicConfig();
    assert.equal(pub.apiKey, "");
    assert.equal(pub.apiKeyConfigured, true);
    const hit = deepContainsSecret(pub, [FAKE_MODEL_KEY, FAKE_BRAVE]);
    assert.equal(hit, null);
    const disk = fs.readFileSync(configPath, "utf8");
    assert.equal(disk.includes(FAKE_MODEL_KEY), false);
    assert.equal(disk.includes(FAKE_BRAVE), false);
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
    assert.equal(first.migratedCount, 1);
    const cfgDisk = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(cfgDisk.apiKey, undefined);
    const runtime = svc.getRuntimeConfig();
    assert.equal(runtime.apiKey, FAKE_MODEL_KEY);
    assert.ok(fs.existsSync(svc.backupPath()));
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
    const mig = svc.migrateLegacySecrets();
    assert.equal(mig.status, "completed");
    assert.equal(store.get(extensionSecretId("brave-search", "BRAVE_API_KEY")), FAKE_BRAVE);
    assert.equal(store.get(extensionSecretId("github", "GITHUB_PERSONAL_ACCESS_TOKEN")), FAKE_GITHUB);
    assert.equal(store.has(extensionSecretId("brave-search", "GITHUB_PERSONAL_ACCESS_TOKEN")), false);
    const hydratedBrave = svc.hydrateExtensionEnv({ id: "brave-search", envKeyNames: ["BRAVE_API_KEY"] });
    assert.equal(hydratedBrave.env.BRAVE_API_KEY, FAKE_BRAVE);
    assert.equal(hydratedBrave.env.GITHUB_PERSONAL_ACCESS_TOKEN, undefined);
    const disk = fs.readFileSync(configPath, "utf8");
    assert.equal(disk.includes(FAKE_BRAVE), false);
    assert.equal(disk.includes(FAKE_GITHUB), false);
  } finally {
    cleanup(dir);
  }
});

test("migration is idempotent", () => {
  const dir = tempDir("idem");
  try {
    const { svc, store, configPath } = makeService(dir);
    fs.writeFileSync(configPath, JSON.stringify({ apiKey: FAKE_MODEL_KEY }), "utf8");
    const a = svc.migrateLegacySecrets();
    const b = svc.migrateLegacySecrets();
    assert.equal(a.status, "completed");
    assert.equal(b.status, "completed");
    assert.equal(store.get(MODEL_API_KEY_ID), FAKE_MODEL_KEY);
    const list = store.listConfigured().filter((id) => id === MODEL_API_KEY_ID);
    assert.equal(list.length, 1);
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
    const disk = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(disk.apiKey, FAKE_MODEL_KEY);
  } finally {
    cleanup(dir);
  }
});

test("encrypt failure keeps plaintext config", () => {
  const dir = tempDir("encfail");
  try {
    const { svc, configPath } = makeService(dir, { failEncrypt: true });
    fs.writeFileSync(configPath, JSON.stringify({ apiKey: FAKE_MODEL_KEY }), "utf8");
    const mig = svc.migrateLegacySecrets();
    assert.equal(mig.status, "failed");
    const disk = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(disk.apiKey, FAKE_MODEL_KEY);
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
    assert.equal(svc.getRuntimeConfig().apiKey, FAKE_MODEL_KEY);
    svc.setConfigFromRenderer({
      baseURL: "https://b.test/v1",
      model: "m2",
      apiKey: "",
      packageDir: "p",
    });
    assert.equal(svc.getRuntimeConfig().apiKey, FAKE_MODEL_KEY);
    assert.equal(svc.readPublicConfig().baseURL, "https://b.test/v1");
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
    assert.equal(svc.readPublicConfig().apiKeyConfigured, false);
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
    const pub = svc.readPublicConfig();
    const exts = svc.getPublicExtensions();
    const hit = deepContainsSecret({ pub, exts }, [FAKE_MODEL_KEY, FAKE_BRAVE, FAKE_GITHUB]);
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

console.log("\nSummary:", { passed, failed });
if (failed) process.exit(1);
console.log("OK");
