"use strict";

/**
 * PAN-01R dual isolated execution (generic vs Digital Me).
 * Prompt isolation MUST be separate message arrays.
 */

const crypto = require("node:crypto");
const { consumeToken, buildInferenceEnvironment } = require("./authorization");
const { resolveEvidenceByIds, sanitizeShortText } = require("./subject-brief");

const MAX_EVIDENCE_CHARS = 1800;
const MAX_BOUNDARY_CHARS = 800;
const MAX_RESULT_CHARS = 12000;

/** @type {Map<string, object>} */
const runStore = new Map();

const GENERIC_SYSTEM =
  "你是通用研究助手。只根据用户给出的任务作答。不要假设任何个人背景、偏好或私有资料。用中文给出简短研究判断框架：核心判断、依据、不确定性、下一步问题。不要编造可核实的最新事实。";

function nowMs(now) {
  if (typeof now === "function") return now();
  if (typeof now === "number") return now;
  return Date.now();
}

function digestText(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function createExecutor(deps = {}) {
  return {
    callModelStream: deps.callModelStream,
    getRuntimeConfig: deps.getRuntimeConfig,
    appendAudit: deps.appendAudit,
    userData: deps.userData,
    now: deps.now,
  };
}

function modelConfigured(getRuntimeConfig) {
  try {
    const cfg = typeof getRuntimeConfig === "function" ? getRuntimeConfig() : null;
    if (!cfg || cfg.configUnreadable) return false;
    if (!cfg.apiKey || !String(cfg.apiKey).trim()) return false;
    if (!cfg.model || !String(cfg.model).trim()) return false;
    return true;
  } catch {
    return false;
  }
}

function buildDigitalMeSystem(evidence, boundaries) {
  const lines = [
    "你是 Digital Me 受控研究助手。只能使用下方已授权的主体依据与必须遵守的边界。",
    "引用依据时使用 E1、E2 等编号；不得引用未列出的内容。",
    "用中文给出简短研究判断框架：核心判断、依据、不确定性、下一步问题。",
    "不要编造可核实的最新事实；不要输出密钥或绝对路径。",
    "",
    "【已授权主体依据】",
  ];
  let used = 0;
  evidence.forEach((ev, idx) => {
    const cite = `E${idx + 1}`;
    const block = `${cite}（${ev.kindLabel || ev.kind}）：${ev.shortText}`;
    if (used + block.length > MAX_EVIDENCE_CHARS) return;
    lines.push(block);
    used += block.length + 1;
  });
  lines.push("", "【必须遵守的边界】");
  let bUsed = 0;
  for (const b of boundaries || []) {
    const block = `- ${b.shortText}`;
    if (bUsed + block.length > MAX_BOUNDARY_CHARS) break;
    lines.push(block);
    bUsed += block.length + 1;
  }
  if (!(boundaries || []).length) {
    lines.push("- （本次无额外边界条目，仍须尊重用户主权与最小必要原则）");
  }
  return lines.join("\n");
}

function parseCitations(text, allowedCiteIds) {
  const allowed = new Set(allowedCiteIds || []);
  const found = new Set();
  const re = /\bE(\d+)\b/g;
  let m;
  const raw = String(text || "");
  while ((m = re.exec(raw))) {
    const id = `E${m[1]}`;
    if (allowed.has(id)) found.add(id);
  }
  return [...found].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

function safeResultText(text) {
  let s = sanitizeShortText(String(text || ""), MAX_RESULT_CHARS);
  if (!s) s = "（空响应）";
  return s.length > MAX_RESULT_CHARS ? s.slice(0, MAX_RESULT_CHARS) + "…" : s;
}

function publicRunView(run) {
  if (!run) return null;
  const base = {
    runId: run.runId,
    requestId: run.requestId,
    status: run.status,
    stage: run.stage,
    cancelLabel: run.cancelLabel,
    inferenceEnvironment: run.inferenceEnvironment,
    capabilityIds: run.capabilityIds.slice(),
    evidenceCount: run.evidenceIds.length,
    personalizedAvailable: run.personalizedAvailable,
    previewMode: run.previewMode,
    sentToSimulationPartner: false,
    localSimulation: true,
    message: run.message || null,
    code: run.code || null,
    settingsTarget: run.settingsTarget || null,
    adoptable: !!run.adoptable,
  };
  if (run.status === "completed" && run.result) {
    base.result = {
      genericText: run.result.genericText,
      digitalMeText: run.result.digitalMeText,
      citations: run.result.citations.slice(),
      authorizedEvidence: run.result.authorizedEvidence.map((e) => ({
        id: e.id,
        citeId: e.citeId,
        shortText: e.shortText,
        kindLabel: e.kindLabel,
      })),
      boundaries: run.result.boundaries.map((b) => ({
        id: b.id,
        shortText: b.shortText,
        kindLabel: b.kindLabel,
      })),
      unusedEvidenceIds: run.result.unusedEvidenceIds.slice(),
      inferenceEnvironment: run.inferenceEnvironment,
      sentToSimulationPartner: false,
    };
  }
  return base;
}

async function callOne(callModelStream, cfg, messages, signal) {
  if (typeof callModelStream !== "function") {
    throw Object.assign(new Error("model_unavailable"), { code: "model_unavailable" });
  }
  return callModelStream(cfg, messages, () => {}, { signal, temperature: 0.4 });
}

/**
 * Confirm authorization (consumes token) and run dual isolated generations.
 */
async function confirmAndExecute({ tokenId, senderId, packageDir, userData, deps = {} }) {
  const callModelStream = deps.callModelStream;
  const getRuntimeConfig = deps.getRuntimeConfig;
  const appendAudit = deps.appendAudit;
  const now = deps.now;

  if (!modelConfigured(getRuntimeConfig)) {
    return {
      ok: false,
      code: "model_unavailable",
      message: "智能引擎未连接/不可用",
      settingsTarget: "settings",
    };
  }

  const consumed = consumeToken(tokenId, senderId, null, now);
  if (!consumed.ok) return consumed;
  const token = consumed.token;

  const runId = "run_" + crypto.randomBytes(10).toString("hex");
  const inferenceEnvironment = buildInferenceEnvironment(getRuntimeConfig);
  const abortController = new AbortController();

  const run = {
    runId,
    requestId: token.requestId,
    tokenId: token.tokenId,
    senderId: String(senderId),
    status: "running",
    stage: "starting",
    cancelLabel: "停止",
    evidenceIds: token.evidenceIds.slice(),
    capabilityIds: token.capabilityIds.slice(),
    taskDigest: token.taskDigest,
    topic: token.topic,
    task: token.task,
    inferenceEnvironment,
    abortController,
    adoptable: false,
    completionAuditOk: false,
    personalizedAvailable: token.evidenceIds.length > 0,
    previewMode: token.evidenceIds.length === 0,
    result: null,
    message: null,
    code: null,
    settingsTarget: null,
    createdAt: new Date(nowMs(now)).toISOString(),
    decisionId: runId,
  };
  runStore.set(runId, run);

  // Notify renderer ASAP so cancel can bind runId before model calls finish.
  if (typeof deps.onRunCreated === "function") {
    try {
      deps.onRunCreated({ runId, status: "running", stage: "starting" });
    } catch {
      /* ignore notifier errors */
    }
  }

  // Pre-audit — fail-closed before any model call
  if (typeof appendAudit === "function" && userData) {
    try {
      appendAudit(userData, {
        event: "execution_started",
        decisionId: runId,
        policyVersion: "pan01r-v1",
        requestDigest: token.requestId,
        actor: `owner:sender:${senderId}`,
        purpose: "panorama_sovereign_collaboration",
        action: "confirm_and_execute",
        dataScopes: ["authorized_evidence", "task_text"],
        destination: inferenceEnvironment.configured
          ? "configured_inference_provider"
          : "none",
        outcome: {
          status: "started",
          evidenceCount: token.evidenceIds.length,
          taskDigest: token.taskDigest,
        },
      });
    } catch {
      run.status = "failed";
      run.code = "audit_failed";
      run.message = "无法写入决策记录，已阻止执行";
      run.stage = "failed";
      run.adoptable = false;
      return {
        ok: false,
        code: "audit_failed",
        message: run.message,
        runId,
        ...publicRunView(run),
      };
    }
  } else if (!appendAudit) {
    // Tests may inject no-op; production always passes appendAudit via facade.
  }

  const resolved = resolveEvidenceByIds(packageDir, token.evidenceIds);
  const authorized = resolved.evidence;
  // Fail-closed if any authorized ID vanished
  if (authorized.length !== token.evidenceIds.length) {
    run.status = "failed";
    run.code = "evidence_resolve_failed";
    run.message = "无法解析已授权的主体依据";
    run.stage = "failed";
    return { ok: false, code: run.code, message: run.message, runId, ...publicRunView(run) };
  }

  const citeMap = authorized.map((ev, idx) => ({
    ...ev,
    citeId: `E${idx + 1}`,
  }));
  const allowedCiteIds = citeMap.map((e) => e.citeId);
  const boundaries = resolved.boundaries || [];

  const userTask = `主题：${token.topic}\n\n任务：${token.task}`;

  const genericMessages = [
    { role: "system", content: GENERIC_SYSTEM },
    { role: "user", content: userTask },
  ];
  const digitalMeMessages = [
    { role: "system", content: buildDigitalMeSystem(citeMap, boundaries) },
    { role: "user", content: userTask },
  ];

  // Capture for tests / security audit — never send to renderer
  run._promptAudit = {
    genericHasEvidence: /E\d+|已授权主体依据/.test(
      genericMessages.map((m) => m.content).join("\n")
    ),
    digitalMeEvidenceIds: citeMap.map((e) => e.id),
    genericMessages,
    digitalMeMessages,
  };

  let cfg;
  try {
    cfg = getRuntimeConfig();
  } catch {
    run.status = "failed";
    run.code = "model_unavailable";
    run.message = "智能引擎未连接/不可用";
    run.settingsTarget = "settings";
    return {
      ok: false,
      code: "model_unavailable",
      message: run.message,
      settingsTarget: "settings",
      runId,
      ...publicRunView(run),
    };
  }

  run.stage = "generic";
  let genericText = "";
  let digitalMeText = "";

  try {
    genericText = await callOne(callModelStream, cfg, genericMessages, abortController.signal);
    if (run.status === "cancelled" || run.status === "abandoned") {
      return { ok: true, ...publicRunView(run) };
    }
    run.stage = "digital_me";
    digitalMeText = await callOne(
      callModelStream,
      cfg,
      digitalMeMessages,
      abortController.signal
    );
  } catch (err) {
    if (run.status === "cancelled" || run.status === "abandoned" || (err && err.aborted)) {
      run.status = run.status === "abandoned" ? "abandoned" : "cancelled";
      run.adoptable = false;
      run.stage = run.status;
      return { ok: true, ...publicRunView(run) };
    }
    run.status = "failed";
    run.code = (err && err.code) || "execution_failed";
    run.message = "生成失败，请稍后重试";
    run.stage = "failed";
    run.adoptable = false;
    if (typeof appendAudit === "function" && userData) {
      try {
        appendAudit(userData, {
          event: "execution_failed",
          decisionId: runId,
          policyVersion: "pan01r-v1",
          requestDigest: token.requestId,
          actor: `owner:sender:${senderId}`,
          purpose: "panorama_sovereign_collaboration",
          action: "confirm_and_execute",
          dataScopes: [],
          destination: "owner_local_review",
          outcome: { status: "failed", code: run.code },
        });
      } catch {
        /* ignore */
      }
    }
    return { ok: false, code: run.code, message: run.message, runId, ...publicRunView(run) };
  }

  if (run.status === "cancelled" || run.status === "abandoned") {
    return { ok: true, ...publicRunView(run) };
  }

  const citations = parseCitations(digitalMeText, allowedCiteIds);
  const authSet = new Set(token.evidenceIds);
  const unusedEvidenceIds = (resolved.brief.evidence || [])
    .filter((e) => e.usableInExperience && !authSet.has(e.id))
    .map((e) => e.id);

  run.result = {
    genericText: safeResultText(genericText),
    digitalMeText: safeResultText(digitalMeText),
    citations,
    authorizedEvidence: citeMap,
    boundaries: boundaries.map((b) => ({
      id: b.id,
      shortText: b.shortText,
      kindLabel: b.kindLabel,
    })),
    unusedEvidenceIds,
    genericDigest: digestText(genericText),
    digitalMeDigest: digestText(digitalMeText),
  };

  let completionAuditOk = false;
  if (typeof appendAudit === "function" && userData) {
    try {
      appendAudit(userData, {
        event: "execution_completed",
        decisionId: runId,
        policyVersion: "pan01r-v1",
        requestDigest: token.requestId,
        actor: `owner:sender:${senderId}`,
        purpose: "panorama_sovereign_collaboration",
        action: "confirm_and_execute",
        dataScopes: ["authorized_evidence"],
        destination: "owner_local_review",
        outcome: {
          status: "completed",
          genericDigest: run.result.genericDigest,
          digitalMeDigest: run.result.digitalMeDigest,
          citationCount: citations.length,
        },
      });
      completionAuditOk = true;
    } catch {
      completionAuditOk = false;
    }
  } else {
    completionAuditOk = true; // hermetic stubs without audit still mark completable when deps say so
  }

  run.completionAuditOk = completionAuditOk;
  if (!completionAuditOk) {
    run.status = "completed";
    run.adoptable = false;
    run.stage = "completed_not_adoptable";
    run.message = "结果已生成，但决策记录写入失败，不可采纳";
    run.code = "completion_audit_failed";
  } else {
    run.status = "completed";
    run.adoptable = true;
    run.stage = "completed";
  }

  return { ok: true, ...publicRunView(run) };
}

function cancelOrAbandonRun({ runId, senderId, userData, deps = {} }) {
  const run = runStore.get(String(runId || ""));
  if (!run) return { ok: false, code: "run_not_found", message: "运行不存在" };
  if (String(run.senderId) !== String(senderId)) {
    return { ok: false, code: "sender_mismatch", message: "发送方不匹配" };
  }
  if (run.status !== "running") {
    return { ok: true, runId: run.runId, status: run.status, alreadyFinished: true };
  }

  let aborted = false;
  try {
    if (run.abortController && typeof run.abortController.abort === "function") {
      run.abortController.abort();
      aborted = true;
    }
  } catch {
    aborted = false;
  }

  run.status = aborted ? "cancelled" : "abandoned";
  run.cancelLabel = aborted ? "停止" : "放弃本次结果";
  run.stage = run.status;
  run.adoptable = false;
  run.result = null; // discard late results

  if (typeof deps.appendAudit === "function" && userData) {
    try {
      deps.appendAudit(userData, {
        event: "execution_cancelled",
        decisionId: run.runId,
        policyVersion: "pan01r-v1",
        requestDigest: run.requestId,
        actor: `owner:sender:${senderId}`,
        purpose: "panorama_sovereign_collaboration",
        action: aborted ? "cancel_run" : "abandon_run",
        dataScopes: [],
        destination: "none",
        outcome: { status: run.status, aborted },
      });
    } catch {
      /* cancel still takes effect */
    }
  }

  return {
    ok: true,
    runId: run.runId,
    status: run.status,
    cancelLabel: run.cancelLabel,
    aborted,
  };
}

function getRun(runId) {
  const run = runStore.get(String(runId || ""));
  if (!run) return { ok: false, code: "run_not_found", message: "运行不存在" };
  return { ok: true, ...publicRunView(run) };
}

function getRunRecord(runId) {
  return runStore.get(String(runId || "")) || null;
}

function clearRunStoreForTests() {
  runStore.clear();
}

module.exports = {
  createExecutor,
  confirmAndExecute,
  cancelOrAbandonRun,
  getRun,
  getRunRecord,
  parseCitations,
  buildDigitalMeSystem,
  clearRunStoreForTests,
  GENERIC_SYSTEM,
  MAX_EVIDENCE_CHARS,
};
