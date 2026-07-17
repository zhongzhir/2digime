"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  TOOL_BROKER_VERSION,
  LOCAL_CLI_TOOL_ID,
  FORBIDDEN_EXECUTABLE_EXTS,
  MAX_TASK_CHARS,
  MAX_ARG_COUNT,
  normalizeToolDefinition,
} = require("./schema");
const {
  getToolDefinition,
  updateLocalCliSettings,
  publicToolSettings,
  loadRegistry,
} = require("./registry");
const { resolveAuthorizedCwd, looksLikeNetworkOrCloudSync } = require("./paths");
const { buildMinimalEnv, listEnvKeyNames } = require("./environment");
const { executePlan } = require("./executor");
const { digestValue, stableStringify } = require("../policy-engine/digest");

function fail(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

function resolveExecutable(executableRaw) {
  const raw = String(executableRaw || "").trim();
  if (!raw) throw fail("executable_missing", "未配置可执行文件");
  if (raw.includes("\0")) throw fail("path_nul", "可执行路径非法");
  if (looksLikeNetworkOrCloudSync(raw)) {
    throw fail("network_or_cloud_path_rejected", "不支持网络或云同步路径上的可执行文件");
  }
  if (!path.isAbsolute(raw)) {
    throw fail("executable_not_absolute", "可执行文件须为绝对路径");
  }
  const ext = path.extname(raw).toLowerCase();
  if (FORBIDDEN_EXECUTABLE_EXTS.has(ext)) {
    throw fail("forbidden_executable_type", "不支持通过脚本解释器间接启动的文件类型");
  }
  if (!fs.existsSync(raw)) throw fail("executable_missing", "可执行文件不存在");
  const st = fs.lstatSync(raw);
  if (st.isSymbolicLink()) throw fail("symlink_rejected", "可执行文件不能是符号链接");
  if (!st.isFile()) throw fail("executable_not_file", "可执行路径不是普通文件");
  const real = fs.realpathSync(raw);
  if (looksLikeNetworkOrCloudSync(real)) {
    throw fail("network_or_cloud_path_rejected", "不支持网络或云同步路径上的可执行文件");
  }
  const realExt = path.extname(real).toLowerCase();
  if (FORBIDDEN_EXECUTABLE_EXTS.has(realExt)) {
    throw fail("forbidden_executable_type", "不支持通过脚本解释器间接启动的文件类型");
  }
  const realStat = fs.statSync(real);
  const sha256 = crypto.createHash("sha256").update(fs.readFileSync(real)).digest("hex");
  const fingerprint = digestValue(
    stableStringify({
      realPath: real,
      size: realStat.size,
      mtimeMs: Math.floor(realStat.mtimeMs),
      sha256,
    })
  );
  return {
    executable: real,
    executableBasename: path.basename(real),
    executableFingerprint: fingerprint,
    size: realStat.size,
    mtimeMs: Math.floor(realStat.mtimeMs),
    sha256,
  };
}

const ALLOWED_PLACEHOLDERS = new Set(["{{task}}"]);

function expandArgsTemplate(argsTemplate, taskText) {
  if (!Array.isArray(argsTemplate) || !argsTemplate.length) {
    throw fail("missing_args_template", "缺少参数模板");
  }
  if (argsTemplate.length > MAX_ARG_COUNT) {
    throw fail("args_template_too_long", "参数过多");
  }
  const task = String(taskText || "");
  if (!task.trim()) throw fail("task_empty", "任务为空");
  if (task.length > MAX_TASK_CHARS) throw fail("task_too_long", "任务过长");
  if (task.includes("\0")) throw fail("task_nul", "任务含非法字符");

  const args = [];
  for (const part of argsTemplate) {
    if (typeof part !== "string") throw fail("invalid_args_template", "参数模板非法");
    if (part.includes("\0")) throw fail("args_nul", "参数含非法字符");
    // Only whole-token placeholder replacement; no shell interpolation.
    if (part === "{{task}}") {
      args.push(task);
      continue;
    }
    const matches = part.match(/\{\{[^}]+\}\}/g) || [];
    for (const m of matches) {
      if (!ALLOWED_PLACEHOLDERS.has(m)) {
        throw fail("unknown_placeholder", "参数模板含未知占位符");
      }
    }
    if (matches.length) {
      // Refuse partial embedding that could look like concatenation tricks.
      throw fail("placeholder_must_be_whole_arg", "占位符须作为完整参数项");
    }
    args.push(part);
  }
  return args;
}

/**
 * Build an immutable execution plan for the registered local_cli tool.
 * @param {string} userDataPath
 * @param {{
 *   taskText: string,
 *   dataScopes?: string[],
 *   requestedCwd?: string,
 *   toolId?: string,
 * }} input
 */
function preparePlan(userDataPath, input = {}) {
  const toolId = String(input.toolId || LOCAL_CLI_TOOL_ID).trim();
  if (toolId !== LOCAL_CLI_TOOL_ID) {
    return { ok: false, reasonCodes: ["unknown_tool_id"], plan: null };
  }

  let definition;
  try {
    const registry = loadRegistry(userDataPath);
    if (!registry || !registry.tools || !registry.tools[toolId]) {
      return { ok: false, reasonCodes: ["registry_load_failed"], plan: null };
    }
    const normalized = normalizeToolDefinition(registry.tools[toolId]);
    if (!normalized.ok) {
      return { ok: false, reasonCodes: normalized.reasonCodes, plan: null };
    }
    definition = normalized.definition;
  } catch {
    return { ok: false, reasonCodes: ["registry_load_failed"], plan: null };
  }

  if (!definition.enabled) {
    return { ok: false, reasonCodes: ["tool_disabled"], plan: null };
  }

  const scopes = Array.isArray(input.dataScopes)
    ? input.dataScopes.map((s) => String(s || "").trim()).filter(Boolean)
    : [];
  if (!scopes.includes("workspace_files")) {
    return { ok: false, reasonCodes: ["workspace_files_required"], plan: null };
  }

  let resolvedExe;
  try {
    resolvedExe = resolveExecutable(definition.executable);
  } catch (err) {
    return {
      ok: false,
      reasonCodes: [err.code || "executable_rejected"],
      plan: null,
    };
  }

  let cwdInfo;
  try {
    cwdInfo = resolveAuthorizedCwd(definition.authorizedCwdRoot, input.requestedCwd || definition.authorizedCwdRoot);
  } catch (err) {
    return {
      ok: false,
      reasonCodes: [err.code || "cwd_rejected"],
      plan: null,
    };
  }

  let args;
  try {
    args = expandArgsTemplate(definition.argsTemplate, input.taskText);
  } catch (err) {
    return {
      ok: false,
      reasonCodes: [err.code || "args_rejected"],
      plan: null,
    };
  }

  // Absolute executable → do not pass PATH.
  const env = buildMinimalEnv(definition.envAllowlist, process.env, { includePath: false });
  const envKeyNames = listEnvKeyNames(env);

  const plan = Object.freeze({
    toolId: definition.toolId,
    definitionVersion: definition.definitionVersion,
    toolName: definition.name,
    action: "execute_task",
    executable: resolvedExe.executable,
    executableBasename: resolvedExe.executableBasename,
    executableFingerprint: resolvedExe.executableFingerprint,
    args: Object.freeze([...args]),
    argsTemplate: Object.freeze([...definition.argsTemplate]),
    cwd: cwdInfo.cwdReal,
    authorizedCwdRoot: cwdInfo.rootReal,
    envKeyNames: Object.freeze([...envKeyNames]),
    // env values stay internal to executor; not frozen into public plan snapshot fields for audit UI
    _env: env,
    timeoutMs: definition.timeoutMs,
    maxOutputBytes: definition.maxOutputBytes,
    dataScopes: Object.freeze([...scopes].sort()),
    shell: false,
  });

  const planDigest = digestValue(
    stableStringify({
      toolId: plan.toolId,
      definitionVersion: plan.definitionVersion,
      executableFingerprint: plan.executableFingerprint,
      args: plan.args,
      cwd: plan.cwd,
      envKeyNames: plan.envKeyNames,
      timeoutMs: plan.timeoutMs,
      maxOutputBytes: plan.maxOutputBytes,
      dataScopes: plan.dataScopes,
      shell: false,
    })
  );

  return {
    ok: true,
    reasonCodes: [],
    plan,
    planDigest,
    publicSummary: {
      toolId: plan.toolId,
      definitionVersion: plan.definitionVersion,
      toolName: plan.toolName,
      executable: plan.executable,
      executableBasename: plan.executableBasename,
      cwd: plan.cwd,
      envKeyNames: [...plan.envKeyNames],
      timeoutMs: plan.timeoutMs,
      maxOutputBytes: plan.maxOutputBytes,
      dataScopes: [...plan.dataScopes],
      notSandbox: true,
    },
  };
}

function revalidatePlan(userDataPath, previousPlan, taskText, dataScopes) {
  const prepared = preparePlan(userDataPath, {
    toolId: previousPlan.toolId,
    taskText,
    dataScopes,
    requestedCwd: previousPlan.cwd,
  });
  if (!prepared.ok) {
    return { ok: false, reasonCodes: prepared.reasonCodes, plan: null, planDigest: "" };
  }
  if (
    prepared.plan.executable !== previousPlan.executable ||
    prepared.plan.executableFingerprint !== previousPlan.executableFingerprint ||
    prepared.plan.definitionVersion !== previousPlan.definitionVersion ||
    prepared.plan.cwd !== previousPlan.cwd ||
    prepared.plan.timeoutMs !== previousPlan.timeoutMs ||
    JSON.stringify(prepared.plan.args) !== JSON.stringify(previousPlan.args) ||
    JSON.stringify(prepared.plan.envKeyNames) !== JSON.stringify(previousPlan.envKeyNames)
  ) {
    return { ok: false, reasonCodes: ["plan_drift"], plan: null, planDigest: prepared.planDigest };
  }
  return prepared;
}

/**
 * Execute a prepared plan. Does not re-check policy; caller must gate.
 */
async function executePreparedPlan(plan, { signal } = {}) {
  if (!plan || plan.shell !== false) {
    return {
      ok: false,
      aborted: false,
      code: "invalid_plan",
      output: "",
      truncated: false,
      timedOut: false,
      cancelled: false,
      orphanRisk: false,
    };
  }
  const result = await executePlan({
    executable: plan.executable,
    args: [...plan.args],
    cwd: plan.cwd,
    env: plan._env || buildMinimalEnv(plan.envKeyNames || [], process.env, { includePath: false }),
    timeoutMs: plan.timeoutMs,
    maxOutputBytes: plan.maxOutputBytes,
    signal,
  });

  const combined = ((result.stdout || "") + (result.stderr ? "\n---\n" + result.stderr : "")).trim();
  const orphanRisk = !!(result.timedOut || result.cancelled) && result.code === "spawn_error";

  return {
    ok: !!result.ok,
    aborted: !!result.cancelled,
    timedOut: !!result.timedOut,
    truncated: !!result.truncated,
    code: result.exitCode,
    statusCode: result.code,
    output: combined.slice(0, plan.maxOutputBytes || 65536),
    stdoutLen: Buffer.byteLength(result.stdout || "", "utf8"),
    stderrLen: Buffer.byteLength(result.stderr || "", "utf8"),
    orphanRisk,
    message: result.message || "",
  };
}

function getPublicSettings(userDataPath) {
  return publicToolSettings(getToolDefinition(userDataPath, LOCAL_CLI_TOOL_ID));
}

function saveNarrowSettings(userDataPath, patch) {
  // Strip unknown fields — only narrow Owner settings.
  const allowed = {
    executable: patch.executable,
    authorizedCwdRoot: patch.authorizedCwdRoot,
    enabled: patch.enabled,
    timeoutMs: patch.timeoutMs,
    maxOutputBytes: patch.maxOutputBytes,
  };
  return updateLocalCliSettings(userDataPath, allowed);
}

module.exports = {
  TOOL_BROKER_VERSION,
  LOCAL_CLI_TOOL_ID,
  preparePlan,
  revalidatePlan,
  executePreparedPlan,
  resolveExecutable,
  expandArgsTemplate,
  getPublicSettings,
  saveNarrowSettings,
  getToolDefinition,
  loadRegistry,
};
