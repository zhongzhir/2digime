"use strict";
/**
 * P1.4：从正式应用 userData SecretStore 导出本机可用模型接入配置到临时运行时文件。
 * - 仅供 digitalme-v2 真实模型测试引导；不进入产品运行时。
 * - 输出含密钥，路径必须在 .gitignore 内；控制台只打印元数据。
 *
 * 用法（在 digitalme-app 目录）：
 *   npx electron ../digitalme-v2/scripts/load-app-model-credential.cjs
 */
const fs = require("node:fs");
const path = require("node:path");

if (!process.versions.electron) {
  console.error(JSON.stringify({ ok: false, error: "must_run_under_electron" }));
  process.exit(1);
}

for (const k of [
  "DEEPSEEK_API_KEY",
  "OPENAI_API_KEY",
  "DASHSCOPE_API_KEY",
  "DIGITALME_ACT_BEHALF_FAKE",
  "DIGITALME_DVL2_03_MOCK_MODEL",
  "DIGITALME_FORCE_FAKE",
]) {
  if (process.env[k]) delete process.env[k];
}

const { app, safeStorage } = require("electron");
{
  const productUd = path.join(app.getPath("appData"), "digitalme-app");
  app.setPath("userData", productUd);
}

async function main() {
  await app.whenReady();
  const appRoot = path.resolve(__dirname, "..", "..", "digitalme-app");
  const { SecretStore } = require(path.join(appRoot, "src", "security", "secret-store"));
  const { ConfigSecretsService } = require(path.join(appRoot, "src", "security", "config-secrets"));
  const {
    createElectronSafeStorageAdapter,
  } = require(path.join(appRoot, "src", "security", "electron-safe-storage-adapter"));
  const { resolveModelRoute } = require(path.join(appRoot, "src", "model-routing"));

  const encryptAdapter = createElectronSafeStorageAdapter(safeStorage);
  const productUd = path.join(app.getPath("appData"), "digitalme-app");
  const productSecrets = new ConfigSecretsService({
    userDataPath: productUd,
    configPath: path.join(productUd, "config.json"),
    secretStore: new SecretStore({ userDataPath: productUd, encryptAdapter }),
    defaultPackageDir: "",
  });
  const routing = (productSecrets.getRuntimeConfig() || {}).modelRouting || null;
  const resolved = resolveModelRoute(routing, "artifact", productSecrets.secretStore);
  const primary = (resolved.candidates || []).find((c) => c.apiKey) || null;
  if (!primary || !primary.apiKey) {
    console.error(
      JSON.stringify({
        ok: false,
        error: "app_model_credential_missing",
        message: "应用内未检测到已连接模型凭证",
      }),
    );
    app.quit();
    process.exit(2);
  }

  const outDir = path.resolve(__dirname, "..", "scripts", "_mvp-p14-real-capability-evidence");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, ".runtime-model-credential.json");
  const payload = {
    providerId: "openai-compatible",
    baseUrl: String(primary.provider.baseUrl || "").replace(/\/+$/, ""),
    model: String(primary.model.model || "").trim(),
    apiKey: String(primary.apiKey),
    source: "app_secret_store_model_routing",
    appProviderId: primary.provider.id,
    writtenAt: new Date().toISOString(),
  };
  fs.writeFileSync(outPath, `${JSON.stringify(payload)}\n`, "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        outPath,
        model: payload.model,
        baseUrlHost: new URL(payload.baseUrl).host,
        source: payload.source,
        appProviderId: payload.appProviderId,
        apiKeyChars: payload.apiKey.length,
      },
      null,
      2,
    ),
  );
  app.quit();
  process.exit(0);
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err && err.message ? err.message : err) }));
  process.exit(1);
});
