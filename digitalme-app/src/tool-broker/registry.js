"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  TOOL_BROKER_VERSION,
  LOCAL_CLI_TOOL_ID,
  defaultLocalCliDefinition,
  normalizeToolDefinition,
} = require("./schema");

function registryPath(userDataPath) {
  return path.join(userDataPath, "tool-broker", "registry.json");
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function loadRegistry(userDataPath) {
  const file = registryPath(userDataPath);
  if (!fs.existsSync(file)) {
    return {
      version: 1,
      brokerVersion: TOOL_BROKER_VERSION,
      tools: {
        [LOCAL_CLI_TOOL_ID]: defaultLocalCliDefinition(),
      },
    };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const tools = raw && raw.tools && typeof raw.tools === "object" ? raw.tools : {};
    const local = tools[LOCAL_CLI_TOOL_ID];
    const normalized = normalizeToolDefinition({
      ...defaultLocalCliDefinition(),
      ...(local && typeof local === "object" ? local : {}),
      toolId: LOCAL_CLI_TOOL_ID,
      definitionVersion:
        (local && local.definitionVersion) || TOOL_BROKER_VERSION,
    });
    return {
      version: 1,
      brokerVersion: TOOL_BROKER_VERSION,
      tools: {
        [LOCAL_CLI_TOOL_ID]: normalized.ok
          ? normalized.definition
          : defaultLocalCliDefinition(),
      },
    };
  } catch {
    return {
      version: 1,
      brokerVersion: TOOL_BROKER_VERSION,
      tools: {
        [LOCAL_CLI_TOOL_ID]: defaultLocalCliDefinition(),
      },
    };
  }
}

function saveRegistry(userDataPath, registry) {
  const file = registryPath(userDataPath);
  ensureDir(file);
  const payload = {
    version: 1,
    brokerVersion: TOOL_BROKER_VERSION,
    tools: registry.tools || {},
    updatedAt: new Date().toISOString(),
  };
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmp, file);
  return payload;
}

function getToolDefinition(userDataPath, toolId = LOCAL_CLI_TOOL_ID) {
  const registry = loadRegistry(userDataPath);
  const def = registry.tools[toolId];
  if (!def) return null;
  return def;
}

/**
 * Narrow Owner settings update for local_cli only.
 * Does not accept free-form shell commands or arbitrary env maps.
 */
function updateLocalCliSettings(userDataPath, patch = {}) {
  const pathMod = require("node:path");
  const fsMod = require("node:fs");
  const { FORBIDDEN_EXECUTABLE_EXTS, FIXED_LOCAL_CLI_ARGS_TEMPLATE } = require("./schema");
  const { looksLikeNetworkOrCloudSync } = require("./paths");
  const { verifyLocalCliProfileIdentity, getLocalCliProfile } = require("./profiles");
  const registry = loadRegistry(userDataPath);
  const current = registry.tools[LOCAL_CLI_TOOL_ID] || defaultLocalCliDefinition();
  const nextRaw = {
    ...current,
    toolId: LOCAL_CLI_TOOL_ID,
    definitionVersion: TOOL_BROKER_VERSION,
    profileId: getLocalCliProfile().profileId,
    name: current.name || "本地命令工具",
    argsTemplate: [...FIXED_LOCAL_CLI_ARGS_TEMPLATE],
    allowedActions: ["execute_task"],
    timeoutMs: current.timeoutMs,
    maxOutputBytes: current.maxOutputBytes,
    envAllowlist: current.envAllowlist,
    executable: patch.executable != null ? String(patch.executable).trim() : current.executable,
    authorizedCwdRoot:
      patch.authorizedCwdRoot != null
        ? String(patch.authorizedCwdRoot).trim()
        : current.authorizedCwdRoot,
    enabled: patch.enabled != null ? !!patch.enabled : current.enabled,
  };
  if (patch.timeoutMs != null && Number.isFinite(Number(patch.timeoutMs))) {
    nextRaw.timeoutMs = Math.floor(Number(patch.timeoutMs));
  }
  if (patch.maxOutputBytes != null && Number.isFinite(Number(patch.maxOutputBytes))) {
    nextRaw.maxOutputBytes = Math.floor(Number(patch.maxOutputBytes));
  }

  const reasonCodes = [];
  let pinnedIdentity = current.pinnedIdentity || null;
  if (nextRaw.executable) {
    if (!pathMod.isAbsolute(nextRaw.executable)) reasonCodes.push("executable_not_absolute");
    if (looksLikeNetworkOrCloudSync(nextRaw.executable)) reasonCodes.push("network_or_cloud_path_rejected");
    const ext = pathMod.extname(nextRaw.executable).toLowerCase();
    if (FORBIDDEN_EXECUTABLE_EXTS.has(ext)) reasonCodes.push("forbidden_executable_type");
    if (fsMod.existsSync(nextRaw.executable)) {
      try {
        const real = fsMod.realpathSync(nextRaw.executable);
        const profileCheck = verifyLocalCliProfileIdentity(real);
        if (!profileCheck.ok) {
          reasonCodes.push(...(profileCheck.reasonCodes || ["profile_identity_mismatch"]));
        } else {
          pinnedIdentity = {
            profileId: profileCheck.profileId,
            originalFilename: profileCheck.identity.originalFilename,
            internalName: profileCheck.identity.internalName,
            productName: profileCheck.identity.productName,
          };
        }
      } catch {
        reasonCodes.push("executable_rejected");
      }
    } else if (nextRaw.enabled) {
      reasonCodes.push("executable_missing");
    }
  }
  if (nextRaw.authorizedCwdRoot) {
    if (!pathMod.isAbsolute(nextRaw.authorizedCwdRoot)) reasonCodes.push("cwd_not_absolute");
    if (looksLikeNetworkOrCloudSync(nextRaw.authorizedCwdRoot)) {
      reasonCodes.push("network_or_cloud_path_rejected");
    }
  }
  if (nextRaw.enabled && (!nextRaw.executable || !nextRaw.authorizedCwdRoot)) {
    reasonCodes.push("incomplete_tool_settings");
  }
  if (reasonCodes.length) {
    return { ok: false, reasonCodes, definition: current };
  }

  nextRaw.pinnedIdentity = pinnedIdentity;
  const normalized = normalizeToolDefinition(nextRaw);
  if (!normalized.ok) {
    return { ok: false, reasonCodes: normalized.reasonCodes, definition: current };
  }
  registry.tools[LOCAL_CLI_TOOL_ID] = normalized.definition;
  saveRegistry(userDataPath, registry);
  return { ok: true, definition: normalized.definition, reasonCodes: [] };
}

function publicToolSettings(definition) {
  if (!definition) {
    return {
      toolId: LOCAL_CLI_TOOL_ID,
      definitionVersion: TOOL_BROKER_VERSION,
      name: "本地命令工具",
      enabled: false,
      executable: "",
      authorizedCwdRoot: "",
      timeoutMs: 60000,
      maxOutputBytes: 65536,
      envAllowlist: [],
      argsTemplate: ["{{task}}"],
    };
  }
  return {
    toolId: definition.toolId,
    definitionVersion: definition.definitionVersion,
    name: definition.name,
    enabled: !!definition.enabled,
    executable: definition.executable || "",
    authorizedCwdRoot: definition.authorizedCwdRoot || "",
    timeoutMs: definition.timeoutMs,
    maxOutputBytes: definition.maxOutputBytes,
    envAllowlist: [...(definition.envAllowlist || [])],
    argsTemplate: [...(definition.argsTemplate || [])],
  };
}

module.exports = {
  registryPath,
  loadRegistry,
  saveRegistry,
  getToolDefinition,
  updateLocalCliSettings,
  publicToolSettings,
  LOCAL_CLI_TOOL_ID,
  registryPath,
};
