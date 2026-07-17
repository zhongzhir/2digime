"use strict";

/**
 * 本机可委派执行体注册（Agent Card 精简形）
 * CLI 执行体配置收束到 ToolBroker 窄字段；不再提供 shell:true 启动入口。
 */

const fs = require("node:fs");
const path = require("node:path");
const toolBroker = require("../tool-broker");

function storePath(userData) {
  return path.join(userData, "l0-agent-registry.json");
}

function defaultRegistry() {
  return {
    version: 1,
    activeId: "builtin",
    agents: [
      {
        id: "builtin",
        name: "本机对话与已武装工具",
        kind: "builtin",
        blurb: "由 Digital Me 直接回答，并按需调用你已启用的本地/联网工具。",
        card: {
          name: "Digital Me Builtin",
          description: "In-process chat + connected tool capabilities",
          skills: [{ id: "code-assist", description: "Code review and edit suggestions" }],
        },
      },
      {
        id: "cli-coder",
        name: "本地命令工具",
        kind: "cli",
        blurb: "经受控工具代理调用本机已注册的命令工具（须配置绝对路径与授权目录；高风险须确认）。",
        enabled: false,
        card: {
          name: "Local CLI Tool",
          description: "Registered local CLI via ToolBroker",
          skills: [{ id: "code-delegate", description: "Run registered local CLI for a task" }],
        },
      },
    ],
  };
}

function readRegistry(userData) {
  try {
    const p = storePath(userData);
    if (!fs.existsSync(p)) {
      const d = defaultRegistry();
      fs.writeFileSync(p, JSON.stringify(d, null, 2), "utf8");
    }
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!raw || !Array.isArray(raw.agents)) return defaultRegistry();
    return raw;
  } catch {
    return defaultRegistry();
  }
}

function writeRegistry(userData, reg) {
  fs.writeFileSync(storePath(userData), JSON.stringify(reg, null, 2), "utf8");
}

function buildCliAgentSnapshotFromSettings(settings, agent) {
  const ready = !!(settings.enabled && settings.executable && settings.authorizedCwdRoot);
  return {
    id: String((agent && agent.id) || "cli-coder"),
    name: String((agent && agent.name) || settings.name || "本地命令工具"),
    kind: "cli",
    enabled: ready,
    toolId: settings.toolId,
    definitionVersion: settings.definitionVersion,
    executable: settings.executable || "",
    authorizedCwdRoot: settings.authorizedCwdRoot || "",
    timeoutMs: settings.timeoutMs,
    maxOutputBytes: settings.maxOutputBytes,
    envAllowlist: [...(settings.envAllowlist || [])],
    argsTemplate: [...(settings.argsTemplate || ["{{task}}"])],
    command: settings.executable || "",
    cwd: settings.authorizedCwdRoot || "",
    cwdDisplay: settings.authorizedCwdRoot || "",
    cwdNormalized: settings.authorizedCwdRoot || "",
    commandBasename: settings.executable
      ? settings.executable.replace(/^.*[\\/]/, "")
      : "",
    configFingerprint: "",
  };
}

/**
 * @param {string|object} userDataOrAgent userData path, or legacy agent object for tests
 * @param {object} [agent]
 */
function buildCliAgentSnapshot(userDataOrAgent, agent) {
  if (typeof userDataOrAgent === "string") {
    const settings = toolBroker.getPublicSettings(userDataOrAgent);
    return buildCliAgentSnapshotFromSettings(settings, agent);
  }
  const legacy = userDataOrAgent && typeof userDataOrAgent === "object" ? userDataOrAgent : {};
  const executable = String(legacy.executable || legacy.command || "").trim();
  const authorizedCwdRoot = String(legacy.authorizedCwdRoot || legacy.cwd || "").trim();
  return buildCliAgentSnapshotFromSettings(
    {
      toolId: legacy.toolId || toolBroker.LOCAL_CLI_TOOL_ID,
      definitionVersion: legacy.definitionVersion || toolBroker.TOOL_BROKER_VERSION,
      name: legacy.name || "本地命令工具",
      enabled: legacy.enabled !== false && !!executable,
      executable,
      authorizedCwdRoot,
      timeoutMs: legacy.timeoutMs || 60000,
      maxOutputBytes: legacy.maxOutputBytes || 65536,
      envAllowlist: legacy.envAllowlist || [],
      argsTemplate: legacy.argsTemplate || ["{{task}}"],
    },
    legacy
  );
}

function listAgents(userData) {
  const reg = readRegistry(userData);
  const settings = toolBroker.getPublicSettings(userData);
  const cliReady = !!(settings.enabled && settings.executable && settings.authorizedCwdRoot);
  return {
    activeId: reg.activeId || "builtin",
    agents: (reg.agents || []).map((a) => {
      if (a.kind === "cli") {
        return {
          id: a.id,
          name: a.name || settings.name || "本地命令工具",
          kind: a.kind,
          blurb: a.blurb || "",
          enabled: cliReady,
          hasCommand: !!(settings.executable && String(settings.executable).trim()),
          card: a.card || null,
        };
      }
      return {
        id: a.id,
        name: a.name,
        kind: a.kind,
        blurb: a.blurb || "",
        enabled: true,
        hasCommand: false,
        card: a.card || null,
      };
    }),
  };
}

function setActiveAgent(userData, agentId) {
  const reg = readRegistry(userData);
  const found = (reg.agents || []).find((a) => a.id === agentId);
  if (!found) throw new Error("未知执行体");
  if (found.kind === "cli") {
    const settings = toolBroker.getPublicSettings(userData);
    if (!(settings.enabled && settings.executable && settings.authorizedCwdRoot)) {
      throw new Error("请先在设置中启用并配置已注册的本地命令工具");
    }
  }
  reg.activeId = agentId;
  writeRegistry(userData, reg);
  return { ok: true, activeId: agentId };
}

/**
 * Narrow settings only: executable absolute path, authorized cwd root, enabled.
 * Ignores free-form command strings / env maps / argsTemplate from renderer.
 */
function saveCliAgent(userData, payload) {
  const patch = {
    executable: payload.executable != null ? payload.executable : payload.command,
    authorizedCwdRoot:
      payload.authorizedCwdRoot != null ? payload.authorizedCwdRoot : payload.cwd,
    enabled: payload.enabled,
  };
  const result = toolBroker.saveNarrowSettings(userData, patch);
  if (!result.ok) {
    const err = new Error("本地命令工具配置无效：" + (result.reasonCodes || []).join(", "));
    err.reasonCodes = result.reasonCodes;
    throw err;
  }
  // Keep agent card entry present; do not copy legacy free-form command into registry.
  const reg = readRegistry(userData);
  const ag = (reg.agents || []).find((a) => a.id === "cli-coder");
  if (ag) {
    delete ag.command;
    delete ag.cwd;
    delete ag.argsTemplate;
    ag.enabled = !!result.definition.enabled;
    writeRegistry(userData, reg);
  }
  return listAgents(userData);
}

function getActiveAgent(userData) {
  const reg = readRegistry(userData);
  const id = reg.activeId || "builtin";
  return (reg.agents || []).find((a) => a.id === id) || (reg.agents || [])[0];
}

function getActiveCliAgentSnapshot(userData) {
  const ag = getActiveAgent(userData);
  if (!ag || ag.kind !== "cli") return null;
  return buildCliAgentSnapshot(userData, ag);
}

function normalizeCwd(cwd) {
  const value = String(cwd || "").trim();
  if (!value) return "";
  return path.resolve(value);
}

function getCliAgentConfig(userData) {
  const settings = toolBroker.getPublicSettings(userData);
  return {
    toolId: settings.toolId,
    definitionVersion: settings.definitionVersion,
    name: settings.name,
    executable: settings.executable || "",
    authorizedCwdRoot: settings.authorizedCwdRoot || "",
    enabled: !!settings.enabled,
    timeoutMs: settings.timeoutMs,
    maxOutputBytes: settings.maxOutputBytes,
    envAllowlist: [...(settings.envAllowlist || [])],
    argsTemplate: [...(settings.argsTemplate || [])],
    // Legacy field names for older UI bindings during transition:
    command: settings.executable || "",
    cwd: settings.authorizedCwdRoot || "",
  };
}

/**
 * Removed: shell-based CLI execution. Callers must use ToolBroker via external-agent-flow.
 */
function runCliAgent() {
  return Promise.reject(new Error("外部命令须经 ToolBroker 受控执行，已禁用直接启动入口。"));
}

module.exports = {
  listAgents,
  setActiveAgent,
  saveCliAgent,
  getActiveAgent,
  getActiveCliAgentSnapshot,
  buildCliAgentSnapshot,
  normalizeCwd,
  getCliAgentConfig,
  runCliAgent,
  readRegistry,
};
