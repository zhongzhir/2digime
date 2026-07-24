#!/usr/bin/env node
"use strict";

/**
 * Digital Me MCP Server.
 *
 * Exposes the local Digital Me Package (persona, style guide, boundaries,
 * memory, decision frameworks, identity, life summary) to external tools
 * such as Cursor / VS Code over the Model Context Protocol (stdio).
 *
 * Standalone: no Electron, no app IPC. The Package directory is read
 * directly, mirroring main.js loadPackageForActBehalf().
 *
 * Package directory resolution order:
 *   1. --package-dir <dir> CLI argument
 *   2. DIGITALME_PACKAGE_DIR environment variable
 *   3. packageDir in the desktop app's config.json (best effort)
 *   4. <appRoot>/../digital-me-package (repo default)
 *
 * Logging goes to stderr only — stdout is the JSON-RPC channel.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");

// Pure Node modules shared with the desktop app (no Electron imports).
const life = require("../life");
const policies = require("../policies");
const { buildSelectedSelfContext } = require("../act-behalf/select-self-context");
const { buildActBehalfMessages } = require("../act-behalf/parse-output");
const { autoSelectCandidates } = require("../act-behalf/subject-context-assembly");

const SERVER_NAME = "digitalme-mcp-server";
const SERVER_VERSION = "0.1.0";

// Same repo-relative default as main.js DEFAULT_PACKAGE_DIR.
const DEFAULT_PACKAGE_DIR = path.join(__dirname, "..", "..", "..", "digital-me-package");

function log(...args) {
  console.error("[dm-mcp]", ...args);
}

// ---------- Package directory resolution ----------

function parsePackageDirArg(argv) {
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i] || "");
    if (a === "--package-dir" && argv[i + 1]) return String(argv[i + 1]);
    if (a.startsWith("--package-dir=")) return a.slice("--package-dir=".length);
  }
  return "";
}

function candidateAppConfigPaths() {
  const home = os.homedir();
  const out = [];
  if (process.platform === "win32") {
    if (process.env.APPDATA) out.push(path.join(process.env.APPDATA, "digitalme-app", "config.json"));
  } else if (process.platform === "darwin") {
    out.push(path.join(home, "Library", "Application Support", "digitalme-app", "config.json"));
  } else {
    const xdg = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
    out.push(path.join(xdg, "digitalme-app", "config.json"));
  }
  return out;
}

function packageDirFromAppConfig() {
  for (const p of candidateAppConfigPaths()) {
    try {
      const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
      if (cfg && typeof cfg.packageDir === "string" && cfg.packageDir.trim()) {
        return cfg.packageDir.trim();
      }
    } catch {
      /* best effort */
    }
  }
  return "";
}

function resolvePackageDir(argv = process.argv.slice(2), env = process.env) {
  const fromArg = parsePackageDirArg(argv);
  if (fromArg) return path.resolve(fromArg);
  const fromEnv = String(env.DIGITALME_PACKAGE_DIR || "").trim();
  if (fromEnv) return path.resolve(fromEnv);
  const fromConfig = packageDirFromAppConfig();
  if (fromConfig) return path.resolve(fromConfig);
  return DEFAULT_PACKAGE_DIR;
}

// ---------- Package loading (mirrors main.js loadPackageForActBehalf) ----------

function safeRead(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function loadPackage(packageDir) {
  const dir = packageDir;
  try {
    life.ensureLifeScaffold(dir);
  } catch (e) {
    log("life scaffold skipped:", e && (e.code || e.message));
  }
  try {
    policies.ensureBoundariesScaffold(dir);
  } catch (e) {
    log("boundaries scaffold skipped:", e && (e.code || e.message));
  }
  const manifestRaw = safeRead(path.join(dir, "manifest.json"));
  let manifest = {};
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {
    /* ignore */
  }
  let identitySummary = "";
  try {
    const idRaw = safeRead(path.join(dir, "identity.json"));
    if (idRaw) {
      const idObj = JSON.parse(idRaw);
      const claims = Array.isArray(idObj.identityClaims)
        ? idObj.identityClaims
        : Array.isArray(idObj.claims)
          ? idObj.claims
          : [];
      identitySummary = claims
        .map((c) => String((c && (c.text || c.content || c.summary)) || "").trim())
        .filter(Boolean)
        .slice(0, 20)
        .join("\n\n");
      if (!identitySummary && idObj.summary) identitySummary = String(idObj.summary);
    }
  } catch {
    /* optional */
  }
  let lifeSummary = "";
  let boundariesSummary = "";
  try {
    lifeSummary = life.summarizeLifeForPrompt(dir);
  } catch (e) {
    log("life summary skipped:", e && (e.code || e.message));
  }
  try {
    boundariesSummary = policies.summarizeBoundariesForPrompt(dir);
  } catch (e) {
    log("boundaries summary skipped:", e && (e.code || e.message));
  }
  return {
    dir,
    exists: !!manifestRaw,
    manifest,
    persona: safeRead(path.join(dir, "persona.md")),
    styleGuide: safeRead(path.join(dir, "style-guide.md")),
    systemPrompt: safeRead(path.join(dir, "prompts", "system-prompt.md")),
    decisionFrameworks: safeRead(path.join(dir, "decision-frameworks.json")),
    preferences: safeRead(path.join(dir, "preferences.json")),
    longTermMemory: safeRead(path.join(dir, "memory", "long-term-memory.jsonl")),
    lifeSummary,
    boundariesSummary,
    identitySummary,
  };
}

// ---------- Resources ----------

const EMPTY_NOTE = "（该资料当前为空或尚未配置。）";

const RESOURCES = [
  {
    uri: "dm://persona",
    name: "人格与自我描述",
    description: "Digital Me Package 的 persona.md：用户的人格与自我描述。",
    mimeType: "text/markdown",
    pick: (pkg) => pkg.persona,
  },
  {
    uri: "dm://style-guide",
    name: "表达风格",
    description: "Digital Me Package 的 style-guide.md：用户的表达风格要点。",
    mimeType: "text/markdown",
    pick: (pkg) => pkg.styleGuide,
  },
  {
    uri: "dm://boundaries",
    name: "边界与禁忌",
    description: "用户的边界与禁忌摘要（来自 policies/boundaries）。",
    mimeType: "text/markdown",
    pick: (pkg) => pkg.boundariesSummary,
  },
  {
    uri: "dm://memory",
    name: "长期记忆摘录",
    description: "长期记忆摘录（memory/long-term-memory.jsonl，每行一条 JSON）。",
    mimeType: "application/x-ndjson",
    pick: (pkg) => pkg.longTermMemory,
  },
  {
    uri: "dm://frameworks",
    name: "判断框架",
    description: "用户的判断与决策框架（decision-frameworks.json）。",
    mimeType: "application/json",
    pick: (pkg) => pkg.decisionFrameworks,
  },
  {
    uri: "dm://identity",
    name: "身份信息",
    description: "用户身份主张摘要（identity.json 的 identityClaims）。",
    mimeType: "text/markdown",
    pick: (pkg) => pkg.identitySummary,
  },
  {
    uri: "dm://life-summary",
    name: "人生与经历摘要",
    description: "人生与经历摘要（由 life/ 事件目录汇总）。",
    mimeType: "text/markdown",
    pick: (pkg) => pkg.lifeSummary,
  },
];

function findResource(uri) {
  return RESOURCES.find((r) => r.uri === uri) || null;
}

// ---------- Tools ----------

const GENERATE_TYPE_INSTRUCTIONS = {
  draft: "产出一份可直接修改后使用的完整草稿。",
  reply: "产出一段可直接发送的回复文本。",
  summary: "产出一份结构化的要点摘要。",
  plan: "产出一份分步骤、可执行的计划或方案。",
};

const TOOLS = [
  {
    name: "dm_get_context",
    description:
      "获取当前任务的 Digital Me 个性化上下文：根据 goal 从用户的 Package" +
      "（人格、风格、边界、记忆、判断框架、身份、经历）中自动选出相关摘录。" +
      "返回的摘录是让 AI 回答「更像本人」的唯一依据，请勿编造摘录之外的私人事实。",
    inputSchema: {
      type: "object",
      properties: {
        goal: {
          type: "string",
          description: "当前任务目标或问题，用于按相关性挑选本人信息摘录。",
        },
      },
      required: ["goal"],
    },
  },
  {
    name: "dm_generate",
    description:
      "为指定目标构建一套「像本人」的生成提示（system + user messages）以及与目标相关的本人信息摘录。" +
      "本服务不直接调用模型；请把返回的 messages 交给调用方 AI 完成生成。" +
      "type 可取 draft / reply / summary / plan。",
    inputSchema: {
      type: "object",
      properties: {
        goal: {
          type: "string",
          description: "要完成的任务或要生成的内容目标。",
        },
        type: {
          type: "string",
          enum: Object.keys(GENERATE_TYPE_INSTRUCTIONS),
          description: "产出类型：draft（草稿）/ reply（回复）/ summary（摘要）/ plan（计划）。默认 draft。",
        },
      },
      required: ["goal"],
    },
  },
  {
    name: "dm_credential",
    description:
      "生成一份对外凭据（JSON）：声明指定 audience 可在有效期内使用本 Digital Me 上下文，" +
      "附带 Package 内容指纹与 sha256 摘要，供接收方核对来源与有效期。" +
      "注意：proof 为内容摘要而非数字签名，适用于互信环境。",
    inputSchema: {
      type: "object",
      properties: {
        audience: {
          type: "string",
          description: "凭据接收方，例如某个工具、协作者或服务的名称。",
        },
        validityDays: {
          type: "number",
          description: "有效天数（1-365），默认 30。",
          minimum: 1,
          maximum: 365,
        },
      },
      required: ["audience"],
    },
  },
];

function textResult(text, extra = {}) {
  return { content: [{ type: "text", text: String(text) }], ...extra };
}

function errorResult(message) {
  return textResult("错误：" + message, { isError: true });
}

function selectContextForGoal(pkg, goal) {
  const selected = autoSelectCandidates(pkg, { goal });
  const claims = selected.autoSelectedClaims || [];
  if (claims.length > 0) {
    return {
      mode: "goal_related",
      claims,
      combinedText: claims
        .map((c) => "### " + (c.label || "本人信息") + "\n" + c.text)
        .join("\n\n"),
    };
  }
  // Fallback: bounded excerpt across all package sections.
  const bounded = buildSelectedSelfContext(pkg);
  return { mode: "bounded_excerpt", claims: [], combinedText: bounded.combinedText };
}

function handleGetContext(args) {
  const goal = String((args && args.goal) || "").trim();
  if (!goal) return errorResult("请提供 goal（当前任务目标）。");
  const pkg = loadPackage(resolvePackageDir());
  if (!pkg.exists) {
    return errorResult("未找到 Digital Me Package（目录：" + pkg.dir + "）。请先在 Digital Me 应用中配置资料包。");
  }
  const ctx = selectContextForGoal(pkg, goal);
  const lines = [
    "# Digital Me 个性化上下文",
    "",
    "目标：" + goal,
    "",
    ctx.mode === "goal_related"
      ? "以下摘录按目标相关性从本人资料中自动选出（共 " + ctx.claims.length + " 条）："
      : "未选到与目标直接相关的条目，以下为有界摘录：",
    "",
    ctx.combinedText || "（本人资料不足，请先补充 Package 内容。）",
    "",
    "---",
    "使用要求：严格依据以上摘录回答；禁止编造摘录之外的私人事实；信息不足时请明确说明缺口。",
  ];
  return textResult(lines.join("\n"));
}

function handleGenerate(args) {
  const goal = String((args && args.goal) || "").trim();
  if (!goal) return errorResult("请提供 goal（要完成的任务）。");
  const type = String((args && args.type) || "draft").trim() || "draft";
  const typeInstruction = GENERATE_TYPE_INSTRUCTIONS[type];
  if (!typeInstruction) {
    return errorResult("不支持的 type：" + type + "（可选：" + Object.keys(GENERATE_TYPE_INSTRUCTIONS).join(" / ") + "）。");
  }
  const pkg = loadPackage(resolvePackageDir());
  if (!pkg.exists) {
    return errorResult("未找到 Digital Me Package（目录：" + pkg.dir + "）。请先在 Digital Me 应用中配置资料包。");
  }
  const ctx = selectContextForGoal(pkg, goal);
  const messages = buildActBehalfMessages({
    request: goal + "\n\n产出类型要求：" + typeInstruction,
    title: goal.slice(0, 40) + (goal.length > 40 ? "…" : ""),
    selectedSelfContextText: ctx.combinedText,
  });
  const out = {
    goal,
    type,
    contextMode: ctx.mode,
    note:
      "本 MCP Server 不直接调用模型。请将 messages 交给当前 AI（如 Cursor）完成生成，" +
      "并遵循其中的分栏输出要求。",
    messages,
  };
  return textResult(JSON.stringify(out, null, 2));
}

function handleCredential(args) {
  const audience = String((args && args.audience) || "").trim();
  if (!audience) return errorResult("请提供 audience（凭据接收方）。");
  let validityDays = Number(args && args.validityDays);
  if (!Number.isFinite(validityDays) || validityDays <= 0) validityDays = 30;
  validityDays = Math.min(365, Math.max(1, Math.floor(validityDays)));

  const pkg = loadPackage(resolvePackageDir());
  if (!pkg.exists) {
    return errorResult("未找到 Digital Me Package（目录：" + pkg.dir + "）。请先在 Digital Me 应用中配置资料包。");
  }

  const fingerprint = crypto
    .createHash("sha256")
    .update(JSON.stringify(pkg.manifest || {}))
    .update("\n")
    .update(pkg.persona || "")
    .update("\n")
    .update(pkg.styleGuide || "")
    .digest("hex");

  const now = Date.now();
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + validityDays * 24 * 60 * 60 * 1000).toISOString();

  const credential = {
    type: "DigitalMeContextCredential",
    version: 1,
    id: "dmc_" + crypto.randomUUID(),
    issuer: SERVER_NAME + "@" + SERVER_VERSION,
    subject: {
      name: String((pkg.manifest && (pkg.manifest.name || pkg.manifest.digitalMeId)) || ""),
      packageFingerprint: fingerprint,
    },
    audience,
    issuedAt,
    expiresAt,
    validityDays,
    scope: RESOURCES.map((r) => r.uri),
  };
  // Self-contained digest so the receiver can detect tampering of the fields
  // above against the package fingerprint. Not a cryptographic signature.
  credential.proof = crypto
    .createHash("sha256")
    .update(JSON.stringify(credential))
    .digest("hex");

  return textResult(JSON.stringify(credential, null, 2));
}

const TOOL_HANDLERS = {
  dm_get_context: handleGetContext,
  dm_generate: handleGenerate,
  dm_credential: handleCredential,
};

// ---------- Server ----------

function createServer() {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { resources: {}, tools: {} },
      instructions:
        "Digital Me MCP Server：提供用户本人的个性化上下文（人格、风格、边界、记忆、" +
        "判断框架、身份、经历）。回答涉及用户本人的问题时，先通过 dm:// 资源或" +
        " dm_get_context 获取摘录，并严格依据摘录作答，不要编造私人事实。",
    }
  );

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: RESOURCES.map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = String(request.params.uri || "");
    const res = findResource(uri);
    if (!res) {
      throw new McpError(ErrorCode.InvalidParams, "未知资源 URI：" + uri);
    }
    const pkg = loadPackage(resolvePackageDir());
    const text = String(res.pick(pkg) || "").trim();
    return {
      contents: [
        {
          uri: res.uri,
          mimeType: res.mimeType,
          text: text || EMPTY_NOTE,
        },
      ],
    };
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = String(request.params.name || "");
    const handler = TOOL_HANDLERS[name];
    if (!handler) {
      throw new McpError(ErrorCode.InvalidParams, "未知工具：" + name);
    }
    try {
      return handler(request.params.arguments || {});
    } catch (err) {
      log("tool failed:", name, err && (err.stack || err.message || err));
      return errorResult(
        "工具 " + name + " 执行失败：" + String((err && err.message) || err || "unknown")
      );
    }
  });

  server.onerror = (err) => {
    log("server error:", err && (err.stack || err.message || err));
  };

  return server;
}

async function main() {
  const packageDir = resolvePackageDir();
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log("server running on stdio; package dir:", packageDir);

  const shutdown = () => {
    server.close().catch(() => {});
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    log("fatal:", err && (err.stack || err.message || err));
    process.exit(1);
  });
}

module.exports = {
  SERVER_NAME,
  SERVER_VERSION,
  RESOURCES,
  TOOLS,
  createServer,
  loadPackage,
  resolvePackageDir,
};
