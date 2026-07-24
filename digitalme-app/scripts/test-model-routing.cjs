"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SecretStore } = require("../src/security/secret-store");
const { ConfigSecretsService } = require("../src/security/config-secrets");
const { invokeModelRoute, providerSecretId } = require("../src/model-routing");

const secret = "FAKE_MODEL_KEY_DO_NOT_LEAK_123456789";
function fakeCrypto() { return { isAvailable: () => true, encryptString: (s) => `cipher:${Buffer.from(String(s)).toString("base64")}`, decryptString: (s) => Buffer.from(String(s).replace(/^cipher:/, ""), "base64").toString("utf8") }; }
function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), "dm-model-routing-")); }
async function main() {
  const dir = tmp();
  try {
    const store = new SecretStore({ userDataPath: dir, encryptAdapter: fakeCrypto() });
    const service = new ConfigSecretsService({ userDataPath: dir, secretStore: store, defaultPackageDir: "D:/fake-package" });
    service.setConfigFromRenderer({ baseURL: "https://legacy.example/v1", model: "legacy-model", apiKey: secret, packageDir: "D:/fake-package" });
    const runtime = service.getRuntimeConfig();
    assert.equal(runtime.modelRouting.routes.chat.primary, "default-openai-compatible/legacy-model");
    assert.equal(store.has(providerSecretId("default-openai-compatible")), true);
    const publicRouting = service.getPublicModelRouting();
    assert.equal(JSON.stringify(publicRouting).includes(secret), false, "public config never contains secret");
    assert.equal(JSON.stringify(service.readPublicConfig()).includes(secret), false, "renderer config never contains secret");
    console.log("PASS model-migration + model-key-isolation");

    const routing = {
      providers: [
        { id: "fake-a", name: "Fake A", type: "fake", enabled: true, models: [{ id: "fake-a/chat", model: "chat-a", enabled: true }, { id: "fake-a/review", model: "review-a", enabled: true }] },
        { id: "fake-b", name: "Fake B", type: "fake", enabled: true, models: [{ id: "fake-b/artifact", model: "artifact-b", enabled: true }, { id: "fake-b/fallback", model: "fallback-b", enabled: true }] },
      ],
      routes: { chat: { primary: "fake-a/chat", fallbacks: ["fake-b/fallback"] }, artifact: { primary: "fake-b/artifact", fallbacks: ["fake-a/chat"] }, review: { primary: "fake-a/review", fallbacks: ["fake-b/fallback"] } },
    };
    service.setModelRoutingFromRenderer({ routing });
    const afterSave = service.getRuntimeConfig();
    const used = [];
    for (const taskType of ["chat", "artifact", "review"]) {
      const result = await invokeModelRoute({ routing: afterSave.modelRouting, taskType, secretStore: store, invokeProvider: async (candidate) => { used.push(`${taskType}:${candidate.model.model}`); return candidate.model.model; } });
      assert.equal(result.ok, true); assert.equal(result.model, taskType === "chat" ? "chat-a" : taskType === "artifact" ? "artifact-b" : "review-a");
    }
    assert.deepEqual(used, ["chat:chat-a", "artifact:artifact-b", "review:review-a"]);
    console.log("PASS model-config + task-routing");

    const fallback = await invokeModelRoute({ routing: afterSave.modelRouting, taskType: "chat", secretStore: store, invokeProvider: async (candidate) => { if (candidate.model.model === "chat-a") throw new Error("network failure"); return "fallback"; } });
    assert.equal(fallback.ok, true); assert.equal(fallback.fallbackUsed, true); assert.equal(fallback.attempts.length, 2);
    const allFail = await invokeModelRoute({ routing: afterSave.modelRouting, taskType: "chat", secretStore: store, invokeProvider: async () => { throw new Error("network failure"); } });
    assert.equal(allFail.ok, false); assert.equal(allFail.friendlyMessage, "当前模型不可用。可以检查模型设置，或切换到备用模型。");
    console.log("PASS model-fallback");

    const reloaded = new ConfigSecretsService({ userDataPath: dir, secretStore: store, defaultPackageDir: "D:/fake-package" }).getPublicModelRouting();
    assert.equal(reloaded.providers.length, 2); assert.equal(JSON.stringify(reloaded).includes(secret), false);
    console.log("PASS model-restart");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
main().catch((error) => { console.error("FAIL model-routing", error); process.exitCode = 1; });
