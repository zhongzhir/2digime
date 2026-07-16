"use strict";

/**
 * 本机可委派执行体注册（Agent Card 精简形）
 * 默认：builtin（自有对话+工具）；可选：cli（用户配置的外部命令）
 * 完整 HTTP A2A 后置；此处先落地「发现 + 用户确认 + 调度 + 回流审计」
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { stableStringify } = require("../policy-engine/digest");

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
        name: "外部命令执行体",
        kind: "cli",
        blurb: "调用本机已安装的代码助手命令（需你填写命令；高风险须确认）。",
        enabled: false,
        command: "",
        argsTemplate: ["{{task}}"],
        cwd: "",
        card: {
          name: "Local CLI Coding Agent",
          description: "User-configured shell coding agent",
          skills: [{ id: "code-delegate", description: "Run external coding agent for a task" }],
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
      return d;
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

function normalizeCwd(cwd) {
  const value = String(cwd || "").trim();
  if (!value) return "";
  return path.resolve(value);
}

function buildCliAgentSnapshot(agent) {
  const command = String((agent && agent.command) || "").trim();
  const argsTemplate = Array.isArray(agent && agent.argsTemplate)
    ? agent.argsTemplate.map((item) => String(item))
    : ["{{task}}"];
  const cwdDisplay = String((agent && agent.cwd) || "").trim();
  const cwdNormalized = normalizeCwd(cwdDisplay);
  const fingerprint = crypto
    .createHash("sha256")
    .update(
      stableStringify({
        executorId: String((agent && agent.id) || "cli-coder"),
        command,
        argsTemplate,
        cwdNormalized,
      }),
      "utf8"
    )
    .digest("hex");
  return {
    id: String((agent && agent.id) || "cli-coder"),
    name: String((agent && agent.name) || "外部命令执行体"),
    kind: "cli",
    enabled: !!(agent && agent.enabled),
    command,
    argsTemplate,
    cwd: cwdDisplay,
    cwdDisplay,
    cwdNormalized,
    commandBasename: command ? command.replace(/^.*[\\/]/, "") : "",
    configFingerprint: fingerprint,
  };
}

function listAgents(userData) {
  const reg = readRegistry(userData);
  return {
    activeId: reg.activeId || "builtin",
    agents: (reg.agents || []).map((a) => ({
      id: a.id,
      name: a.name,
      kind: a.kind,
      blurb: a.blurb || "",
      enabled: a.kind === "builtin" ? true : !!a.enabled && !!a.command,
      hasCommand: !!(a.command && String(a.command).trim()),
      card: a.card || null,
    })),
  };
}

function setActiveAgent(userData, agentId) {
  const reg = readRegistry(userData);
  const found = (reg.agents || []).find((a) => a.id === agentId);
  if (!found) throw new Error("未知执行体");
  if (found.kind === "cli" && !(found.enabled && found.command)) {
    throw new Error("请先在设置中启用并填写外部命令");
  }
  reg.activeId = agentId;
  writeRegistry(userData, reg);
  return { ok: true, activeId: agentId };
}

function saveCliAgent(userData, payload) {
  const reg = readRegistry(userData);
  const ag = (reg.agents || []).find((a) => a.id === "cli-coder");
  if (!ag) throw new Error("缺少外部命令执行体条目");
  if (payload.command != null) ag.command = String(payload.command || "").trim();
  if (payload.cwd != null) ag.cwd = String(payload.cwd || "").trim();
  if (payload.argsTemplate != null) {
    ag.argsTemplate = Array.isArray(payload.argsTemplate)
      ? payload.argsTemplate.map(String)
      : String(payload.argsTemplate || "{{task}}")
          .split(/\s+/)
          .filter(Boolean);
  }
  if (payload.enabled != null) ag.enabled = !!payload.enabled;
  if (ag.command) ag.enabled = payload.enabled !== false ? true : !!payload.enabled;
  writeRegistry(userData, reg);
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
  return buildCliAgentSnapshot(ag);
}

function getCliAgentConfig(userData) {
  const reg = readRegistry(userData);
  const ag = (reg.agents || []).find((a) => a.id === "cli-coder");
  if (!ag) return { command: "", cwd: "", enabled: false };
  return {
    command: String(ag.command || ""),
    cwd: String(ag.cwd || ""),
    enabled: !!ag.enabled,
    argsTemplate: Array.isArray(ag.argsTemplate) ? ag.argsTemplate.map(String) : ["{{task}}"],
    configFingerprint: buildCliAgentSnapshot(ag).configFingerprint,
  };
}

/**
 * Run CLI agent with user-confirmed task. Authorization is enforced in main process (P1-04).
 * Returns { ok, output, code, aborted }
 */
function runCliAgent(userData, { task, signal, agentConfig } = {}) {
  return new Promise((resolve, reject) => {
    const ag = agentConfig ? buildCliAgentSnapshot(agentConfig) : getActiveCliAgentSnapshot(userData);
    if (!ag || ag.kind !== "cli") {
      reject(new Error("当前执行体不是外部命令类型"));
      return;
    }
    const cmd = String(ag.command || "").trim();
    if (!cmd) {
      reject(new Error("未配置外部命令"));
      return;
    }
    const taskText = String(task || "").trim();
    if (!taskText) {
      reject(new Error("任务为空"));
      return;
    }
    const args = (ag.argsTemplate && ag.argsTemplate.length ? ag.argsTemplate : ["{{task}}"]).map((a) =>
      String(a).replace(/\{\{task\}\}/g, taskText)
    );
    const cwd = ag.cwdNormalized && fs.existsSync(ag.cwdNormalized) ? ag.cwdNormalized : undefined;
    const child = spawn(cmd, args, {
      cwd,
      shell: true,
      windowsHide: true,
      env: { ...process.env },
    });
    let out = "";
    let err = "";
    const onAbort = () => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    };
    if (signal) {
      if (signal.aborted) {
        onAbort();
        resolve({ ok: false, aborted: true, output: "", code: -1 });
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    child.stdout.on("data", (buf) => {
      out += buf.toString("utf8");
      if (out.length > 120000) out = out.slice(-120000);
    });
    child.stderr.on("data", (buf) => {
      err += buf.toString("utf8");
      if (err.length > 40000) err = err.slice(-40000);
    });
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      const combined = (out + (err ? "\n---\n" + err : "")).trim();
      resolve({
        ok: code === 0,
        code,
        output: combined.slice(0, 80000),
        aborted: false,
      });
    });
  });
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
