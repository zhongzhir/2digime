"use strict";
/**
 * 从正式 V2 userData SecretStore 导出本机模型接入到 gitignored 运行时文件。
 * 仅供 trial / 真实模型测试；控制台只打印元数据，不打印密钥。
 */
const fs = require("node:fs");
const path = require("node:path");

if (!process.versions.electron) {
  console.error(JSON.stringify({ ok: false, error: "must_run_under_electron" }));
  process.exit(1);
}

const { app, safeStorage } = require("electron");
const productUd = path.join(app.getPath("appData"), "digitalme-v2");
app.setPath("userData", productUd);

async function main() {
  await app.whenReady();
  const { resolveModelConfig } = require("../electron/bootstrap-secrets.cjs");
  const { providerCredentialKey } = require("../dist/infrastructure/secret-store");
  const resolved = await resolveModelConfig({
    safeStorage,
    userDataPath: productUd,
    isPackaged: false,
    allowDevRuntimeFile: false,
  });
  if (!resolved.ok || !resolved.openaiCompatible || !resolved.secrets) {
    console.error(
      JSON.stringify({
        ok: false,
        error: resolved.reason || "app_model_credential_missing",
      }),
    );
    app.quit();
    process.exit(2);
  }
  const apiKey = String(
    (await resolved.secrets.get(providerCredentialKey(resolved.openaiCompatible.providerId))) || "",
  ).trim();
  if (!apiKey) {
    console.error(JSON.stringify({ ok: false, error: "app_model_credential_missing" }));
    app.quit();
    process.exit(2);
  }
  const outDir = path.resolve(__dirname, "_mvp-p14-real-capability-evidence");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, ".runtime-model-credential.json");
  const payload = {
    providerId: resolved.openaiCompatible.providerId,
    baseUrl: String(resolved.openaiCompatible.baseUrl || "").replace(/\/+$/, ""),
    model: String(resolved.openaiCompatible.model || "").trim(),
    apiKey,
    source: "v2_secret_store",
    writtenAt: new Date().toISOString(),
  };
  fs.writeFileSync(outPath, `${JSON.stringify(payload)}\n`, "utf8");
  console.log(
    JSON.stringify({
      ok: true,
      outPath,
      model: payload.model,
      baseUrlHost: new URL(payload.baseUrl).host,
      source: payload.source,
    }),
  );
  app.quit();
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error && error.message ? error.message : error) }));
  try {
    app.quit();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
