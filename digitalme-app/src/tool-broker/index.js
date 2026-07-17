"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  TOOL_BROKER_VERSION,
  LOCAL_CLI_TOOL_ID,
  FORBIDDEN_EXECUTABLE_EXTS,
  FIXED_LOCAL_CLI_ARGS_TEMPLATE,
  MAX_TASK_CHARS,
  MAX_ARG_COUNT,
  normalizeToolDefinition,
} = require("./schema");
const {
  getToolDefinition,
  updateLocalCliSettings,
  publicToolSettings,
  loadRegistry,
  registryPath,
} = require("./registry");
const { resolveAuthorizedCwd, looksLikeNetworkOrCloudSync } = require("./paths");
const { buildMinimalEnv, listEnvKeyNames } = require("./environment");
const { executePlan } = require("./executor");
const {
  verifyLocalCliProfileIdentity,
  getLocalCliProfile,
  pinnedIdentityMatches,
} = require("./profiles");
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
  const profileCheck = verifyLocalCliProfileIdentity(real, {
    size: realStat.size,
    mtimeMs: Math.floor(realStat.mtimeMs),
    sha256,
  });
  if (!profileCheck.ok) {
    throw fail(
      (profileCheck.reasonCodes && profileCheck.reasonCodes[0]) || "profile_identity_mismatch",
      "可执行文件身份与已注册工具配置不一致"
    );
  }

  const fingerprint = digestValue(
    stableStringify({
      realPath: real,
      size: realStat.size,
      mtimeMs: Math.floor(realStat.mtimeMs),
      sha256,
      profileId: profileCheck.profileId,
      contractId: profileCheck.contractId,
      originalFilename: profileCheck.identity.originalFilename,
      internalName: profileCheck.identity.internalName,
      companyName: profileCheck.identity.companyName,
    })
  );
  return {
    executable: real,
    executableBasename: path.basename(real),
    executableFingerprint: fingerprint,
    size: realStat.size,
    mtimeMs: Math.floor(realStat.mtimeMs),
    sha256,
    profileId: profileCheck.profileId,
    identity: profileCheck.identity,
  };
}

const ALLOWED_PLACEHOLDERS = new Set(["{{task}}"]);

function expandArgsTemplate(argsTemplate, taskText) {
  // Always enforce code-owned contract regardless of caller input.
  const template = [...FIXED_LOCAL_CLI_ARGS_TEMPLATE];
  void argsTemplate;
  if (template.length > MAX_ARG_COUNT) {
    throw fail("args_template_too_long", "参数过多");
  }
  const task = String(taskText || "");
  if (!task.trim()) throw fail("task_empty", "任务为空");
  if (task.length > MAX_TASK_CHARS) throw fail("task_too_long", "任务过长");
  if (task.includes("\0")) throw fail("task_nul", "任务含非法字符");

  const args = [];
  for (const part of template) {
    if (typeof part !== "string") throw fail("invalid_args_template", "参数模板非法");
    if (part.includes("\0")) throw fail("args_nul", "参数含非法字符");
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
      throw fail("placeholder_must_be_whole_arg", "占位符须作为完整参数项");
    }
    args.push(part);
  }
  return args;
}

/**
 * Build an immutable execution plan for the registered local_cli tool.
 */
function preparePlan(userDataPath, input = {}) {
  const toolId = String(input.toolId || LOCAL_CLI_TOOL_ID).trim();
  if (toolId !== LOCAL_CLI_TOOL_ID) {
    return { ok: false, reasonCodes: ["unknown_tool_id"], plan: null };
  }

  let definition;
  let rawExecutable = "";
  try {
    const registry = loadRegistry(userDataPath);
    if (!registry || !registry.tools || !registry.tools[toolId]) {
      return { ok: false, reasonCodes: ["registry_load_failed"], plan: null };
    }
    try {
      const disk = JSON.parse(fs.readFileSync(registryPath(userDataPath), "utf8"));
      rawExecutable = String(
        (disk && disk.tools && disk.tools[toolId] && disk.tools[toolId].executable) || ""
      ).trim();
    } catch {
      rawExecutable = String(registry.tools[toolId].executable || "").trim();
    }
    // Profile identity gate on the on-disk path (code-owned contract; not basename / not self-pin).
    if (rawExecutable && path.isAbsolute(rawExecutable) && fs.existsSync(rawExecutable)) {
      try {
        const real = fs.realpathSync(rawExecutable);
        const st = fs.statSync(real);
        const sha256 = crypto.createHash("sha256").update(fs.readFileSync(real)).digest("hex");
        const profileCheck = verifyLocalCliProfileIdentity(real, {
          size: st.size,
          mtimeMs: Math.floor(st.mtimeMs),
          sha256,
        });
        if (!profileCheck.ok) {
          return {
            ok: false,
            reasonCodes: profileCheck.reasonCodes || ["profile_identity_mismatch"],
            plan: null,
          };
        }
      } catch {
        return { ok: false, reasonCodes: ["executable_rejected"], plan: null };
      }
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

  // pinnedIdentity is a snapshot of a prior code-owned match; it cannot invent trust on its own.
  if (definition.pinnedIdentity) {
    if (
      !pinnedIdentityMatches(
        definition.pinnedIdentity,
        resolvedExe.identity,
        resolvedExe.profileId || getLocalCliProfile().profileId
      )
    ) {
      return { ok: false, reasonCodes: ["pinned_identity_mismatch"], plan: null };
    }
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

  const env = buildMinimalEnv(definition.envAllowlist, process.env, { includePath: false });
  const envKeyNames = listEnvKeyNames(env);

  const plan = Object.freeze({
    toolId: definition.toolId,
    definitionVersion: definition.definitionVersion,
    profileId: resolvedExe.profileId || getLocalCliProfile().profileId,
    toolName: definition.name,
    action: "execute_task",
    executable: resolvedExe.executable,
    executableBasename: resolvedExe.executableBasename,
    executableFingerprint: resolvedExe.executableFingerprint,
    identityOriginalFilename: (resolvedExe.identity && resolvedExe.identity.originalFilename) || "",
    args: Object.freeze([...args]),
    argsTemplate: Object.freeze([...FIXED_LOCAL_CLI_ARGS_TEMPLATE]),
    cwd: cwdInfo.cwdReal,
    authorizedCwdRoot: cwdInfo.rootReal,
    envKeyNames: Object.freeze([...envKeyNames]),
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
      profileId: plan.profileId,
      executableFingerprint: plan.executableFingerprint,
      identityOriginalFilename: plan.identityOriginalFilename,
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
async function executePreparedPlan(plan, { signal, executorDeps } = {}) {
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
      totalBytes: 0,
      stdoutTotalBytes: 0,
      stderrTotalBytes: 0,
      retainedBytes: 0,
      fullOutputSha256: "",
      retainedSha256: "",
      outputDigestKind: "none",
    };
  }
  const result = await executePlan(
    {
      executable: plan.executable,
      args: [...plan.args],
      cwd: plan.cwd,
      env: plan._env || buildMinimalEnv(plan.envKeyNames || [], process.env, { includePath: false }),
      timeoutMs: plan.timeoutMs,
      maxOutputBytes: plan.maxOutputBytes,
      signal,
    },
    executorDeps || {}
  );

  const retained = String(result.stdout || "");
  return {
    ok: !!result.ok,
    aborted: !!result.cancelled,
    timedOut: !!result.timedOut,
    truncated: !!result.truncated,
    code: result.exitCode,
    statusCode: result.code,
    output: retained,
    // Full stream accounting (not limited to retained prefix).
    totalBytes: Number(result.totalBytes) || 0,
    stdoutTotalBytes: Number(result.stdoutTotalBytes) || 0,
    stderrTotalBytes: Number(result.stderrTotalBytes) || 0,
    retainedBytes: Number(result.retainedBytes) || 0,
    fullOutputSha256: String(result.fullOutputSha256 || ""),
    retainedSha256: String(result.retainedSha256 || ""),
    outputDigestKind: result.truncated ? "retained_prefix" : String(result.outputDigestKind || "full"),
    // Legacy fields: lengths are full totals, not retained-only.
    stdoutLen: Number(result.stdoutTotalBytes) || 0,
    stderrLen: Number(result.stderrTotalBytes) || 0,
    orphanRisk: !!result.orphanRisk,
    reclaim: result.reclaim || null,
    message: result.message || "",
  };
}

function getPublicSettings(userDataPath) {
  return publicToolSettings(getToolDefinition(userDataPath, LOCAL_CLI_TOOL_ID));
}

function saveNarrowSettings(userDataPath, patch) {
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
  FIXED_LOCAL_CLI_ARGS_TEMPLATE,
  preparePlan,
  revalidatePlan,
  executePreparedPlan,
  resolveExecutable,
  expandArgsTemplate,
  getPublicSettings,
  saveNarrowSettings,
  getToolDefinition,
  loadRegistry,
  verifyLocalCliProfileIdentity,
  getLocalCliProfile,
};
