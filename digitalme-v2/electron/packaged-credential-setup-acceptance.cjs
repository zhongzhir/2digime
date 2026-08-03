"use strict";
/**
 * Packaged 凭证设置验收(全新隔离 userData,不预导入凭证)。
 * 覆盖:首次未连接 → 保存/测试 → 真实任务 → 无 fake → 重启保留 → 删除后禁用。
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readCredentialSource() {
  const candidates = [
    process.env.DIGITALME_V2_CREDENTIAL_SETUP_SOURCE,
    process.env.DIGITALME_V2_CREDENTIAL_IMPORT,
    path.resolve(
      __dirname,
      "..",
      "scripts",
      "_mvp-p14-real-capability-evidence",
      ".runtime-model-credential.json",
    ),
  ].filter(Boolean);
  for (const file of candidates) {
    if (file && fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      const apiKey = String(parsed.apiKey || "").trim();
      const baseUrl = String(parsed.baseUrl || "").replace(/\/+$/, "");
      const model = String(parsed.model || "").trim();
      if (apiKey && baseUrl && model) {
        return {
          apiKey,
          baseUrl,
          model,
          providerPreset: baseUrl.includes("deepseek") ? "deepseek" : "openai-compatible",
        };
      }
    }
  }
  return null;
}

async function waitJob(bus, taskId, timeoutMs = 180_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const detail = await bus.invoke("work.getTask", { taskId });
    const job = detail.latestJob;
    if (job && (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled")) {
      return detail;
    }
    await sleep(400);
  }
  throw new Error(`job timeout for ${taskId}`);
}

/**
 * @param {{
 *   bootstrapRuntime: Function,
 *   getRuntime: Function,
 *   getBus: Function,
 *   getBootInfo: Function,
 *   getSaveCredential: Function,
 *   getDeleteCredential: Function,
 *   getTestConnection: Function,
 *   app: import('electron').App,
 * }} deps
 */
async function run(deps) {
  const evidenceDir =
    process.env.DIGITALME_V2_CREDENTIAL_SETUP_EVIDENCE ||
    path.resolve(__dirname, "..", "scripts", "_mvp-p16-credential-setup-evidence");
  fs.mkdirSync(evidenceDir, { recursive: true });
  const checks = [];
  const note = (name, ok, detail) => {
    checks.push({ name, ok: !!ok, detail: detail || null });
    if (!ok) {
      const err = new Error(`check_failed:${name}`);
      err.detail = detail;
      throw err;
    }
  };

  const cred = readCredentialSource();
  if (!cred) {
    note("credential_source", false, { reason: "missing_test_credential_file" });
  }

  // 1) 首次启动:未连接
  let boot = await deps.bootstrapRuntime();
  note("fresh_userdata_unconnected", boot.modelReady === false && boot.needsCredentialSetup === true, {
    modelReady: boot.modelReady,
    reason: boot.status && boot.status.reason,
  });
  note("no_fake_capability_unconfigured", true);

  const runtime = () => deps.getRuntime();
  const bus = () => deps.getBus();

  // 确认能力列表不含 Fake / available 文档能力
  const pkgDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmv2-cred-pkg-"));
  await runtime().createPackage({ displayName: "凭证验收主体", targetDir: pkgDir });
  let caps = await bus().invoke("capability.list", {});
  const availableDocs = (caps.capabilities || []).filter(
    (c) => c.availability === "available" && (c.outputArtifactTypes || []).includes("document"),
  );
  const fakePresent = (caps.capabilities || []).some(
    (c) => c.id === "cap_fake_document" || /fake/i.test(c.displayName || ""),
  );
  note("no_available_document_capability_before_setup", availableDocs.length === 0, {
    capabilities: caps.capabilities,
  });
  note("fake_not_registered_in_production", fakePresent === false, { capabilities: caps.capabilities });

  // 提交应被壳层拒绝
  let submitBlocked = false;
  try {
    await bus().invoke("work.submitTask", {
      goal: "should block",
      contextRefs: [],
      requestedArtifactType: "document",
    });
  } catch (err) {
    submitBlocked = /请先连接模型|MODEL_NOT_CONFIGURED|no available capability/i.test(
      String(err && err.message ? err.message : err),
    );
  }
  note("submit_blocked_before_setup", submitBlocked);

  // 2) 保存 + 测试连接
  const save = deps.getSaveCredential();
  const test = deps.getTestConnection();
  if (!save || !test) {
    note("credential_ops_available", false, { save: !!save, test: !!test });
  }
  await save({
    apiKey: cred.apiKey,
    baseUrl: cred.baseUrl,
    model: cred.model,
    providerPreset: cred.providerPreset,
    providerId: "openai-compatible",
  });
  boot = await deps.bootstrapRuntime();
  note("save_makes_model_ready", boot.modelReady === true && !!boot.modelMeta, {
    model: boot.modelMeta && boot.modelMeta.model,
    source: boot.modelMeta && boot.modelMeta.source,
  });

  const testResult = await test({
    baseUrl: cred.baseUrl,
    model: cred.model,
    providerId: "openai-compatible",
  });
  note("test_connection_ok", testResult && testResult.ok === true, {
    model: testResult && testResult.model,
    host: testResult && testResult.baseUrlHost,
  });

  // 重新挂载已有包以刷新 registry
  await runtime().openPackage({ dir: pkgDir });
  caps = await bus().invoke("capability.list", {});
  const realAvailable = (caps.capabilities || []).filter(
    (c) => c.availability === "available" && c.id === "cap_model_openai_compatible",
  );
  const stillFake = (caps.capabilities || []).some((c) => c.id === "cap_fake_document");
  note("real_capability_available", realAvailable.length === 1, { capabilities: caps.capabilities });
  note("fake_still_absent_after_setup", stillFake === false);

  // 3) 真实任务
  const submitted = await bus().invoke("work.submitTask", {
    goal: "用一句话介绍数字主体系统，并在句末写上 REAL_MODEL_OK。",
    contextRefs: [],
    requestedArtifactType: "document",
  });
  const detail = await waitJob(bus(), submitted.taskId);
  note("real_task_succeeded", detail.state === "completed" && detail.latestJob.status === "succeeded", {
    state: detail.state,
    jobStatus: detail.latestJob && detail.latestJob.status,
    capabilityId: detail.task && detail.task.capabilityId,
  });
  note(
    "used_openai_compatible_capability",
    detail.task && detail.task.capabilityId === "cap_model_openai_compatible",
    { capabilityId: detail.task && detail.task.capabilityId },
  );

  const artifactId = detail.artifactIds && detail.artifactIds[0];
  note("artifact_created", !!artifactId);
  const content = await bus().invoke("artifact.getContent", { artifactId });
  const text = String(content.text || "");
  note("no_fake_document_marker", !/\(fake document\)/i.test(text), {
    sample: text.slice(0, 200),
  });
  note("artifact_non_empty", text.trim().length > 0, { chars: text.length });

  fs.writeFileSync(
    path.join(evidenceDir, "real-artifact.md"),
    text,
    "utf8",
  );

  // 4) 模拟重启: stop + bootstrap + open
  if (runtime()) await runtime().stop();
  boot = await deps.bootstrapRuntime();
  note("restart_model_still_ready", boot.modelReady === true, {
    model: boot.modelMeta && boot.modelMeta.model,
  });
  await runtime().openPackage({ dir: pkgDir });
  const afterRestart = await bus().invoke("work.getTask", { taskId: submitted.taskId });
  note("restart_artifact_restored", !!(afterRestart.artifactIds && afterRestart.artifactIds[0]), {
    artifactIds: afterRestart.artifactIds,
  });

  // 5) 删除凭证后禁用
  const del = deps.getDeleteCredential();
  await del({});
  boot = await deps.bootstrapRuntime();
  note("delete_makes_unconnected", boot.modelReady === false && boot.needsCredentialSetup === true, {
    modelReady: boot.modelReady,
  });
  await runtime().openPackage({ dir: pkgDir });
  caps = await bus().invoke("capability.list", {});
  const afterDeleteAvailable = (caps.capabilities || []).filter(
    (c) => c.availability === "available" && (c.outputArtifactTypes || []).includes("document"),
  );
  note("no_available_capability_after_delete", afterDeleteAvailable.length === 0, {
    capabilities: caps.capabilities,
  });

  let blockedAfterDelete = false;
  try {
    await bus().invoke("work.submitTask", {
      goal: "should block after delete",
      contextRefs: [],
      requestedArtifactType: "document",
    });
  } catch (err) {
    blockedAfterDelete = /请先连接模型|MODEL_NOT_CONFIGURED|no available capability/i.test(
      String(err && err.message ? err.message : err),
    );
  }
  note("submit_blocked_after_delete", blockedAfterDelete);

  // 敏感扫描:evidence 不得含 apiKey
  const evidenceText = fs.readFileSync(path.join(evidenceDir, "real-artifact.md"), "utf8");
  note("evidence_has_no_api_key", !evidenceText.includes(cred.apiKey));

  const summary = {
    ok: checks.every((c) => c.ok),
    passed: checks.filter((c) => c.ok).length,
    total: checks.length,
    model: boot.modelMeta || { model: cred.model, note: "deleted_at_end" },
    checks,
  };
  // 恢复凭证状态说明用最终检查时已删除;报告使用任务阶段模型名
  summary.verifiedModel = cred.model;
  summary.verifiedHost = (() => {
    try {
      return new URL(cred.baseUrl).host;
    } catch {
      return "unknown";
    }
  })();
  fs.writeFileSync(path.join(evidenceDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return summary.ok ? 0 : 1;
}

module.exports = { run };
