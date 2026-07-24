#!/usr/bin/env node
"use strict";

/**
 * Digital Me CLI — 在终端里与 Digital Me 协作。
 *
 * 独立于 Electron 运行，直接从 Package 目录读取资料。
 * 数据加载逻辑复用 src/main.js 中 loadPackageForActBehalf 的读取路径；
 * 输出生成复用 act-behalf 的上下文组装与消息构建模块。
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const crypto = require("node:crypto");

const life = require("../life");
const policies = require("../policies");
const { PackageStore } = require("../package-store");
const {
  assembleSubjectContextCandidates,
  resolveSubjectId,
  resolveSubjectVersion,
} = require("../act-behalf/subject-context-assembly");
const { buildSelectedSelfContext, truncateText } = require("../act-behalf/select-self-context");
const { buildActBehalfMessages, parseActBehalfOutput } = require("../act-behalf/parse-output");
const { cmdRun } = require("./commands/run");
const { cmdProject } = require("./commands/project");
const { cmdReview } = require("./commands/review");
const { listCollaborations } = require("../collaboration");
const {
  exportInvite,
  importInvite,
  exportUpdate,
  importUpdate,
} = require("../collaboration/exchange");
const { exportCredential, importCredential } = require("../identity/credential-exchange");

// 与桌面应用一致：Package 默认位于应用目录上一级的 digital-me-package。
// （本文件位于 src/cli/，比 src/main.js 深一层，因此多回退一级。）
const DEFAULT_PACKAGE_DIR = path.join(__dirname, "..", "..", "..", "digital-me-package");
const MODEL_TIMEOUT_MS = 120000;

// ---------- 终端输出 ----------

function out(line) {
  process.stdout.write(String(line == null ? "" : line) + "\n");
}

function errOut(line) {
  process.stderr.write(String(line == null ? "" : line) + "\n");
}

function fail(message, hint) {
  errOut("错误：" + message);
  if (hint) errOut("提示：" + hint);
  return 1;
}

// ---------- CLI 配置（package 目录 / 模型） ----------

function cliHome(env) {
  return (env && env.DM_CLI_HOME) || path.join(os.homedir(), ".digitalme-cli");
}

function readCliConfig(env) {
  try {
    const raw = fs.readFileSync(path.join(cliHome(env), "config.json"), "utf8");
    const cfg = JSON.parse(raw);
    return cfg && typeof cfg === "object" ? cfg : {};
  } catch {
    return {};
  }
}

function resolvePackageDir(opts, env) {
  const fromConfig = readCliConfig(env).packageDir;
  return path.resolve(
    String(
      (opts && opts["package-dir"]) ||
        (env && env.DM_PACKAGE_DIR) ||
        fromConfig ||
        DEFAULT_PACKAGE_DIR
    )
  );
}

function modelConfig(env) {
  const cfg = readCliConfig(env);
  return {
    baseURL: String((env && env.DM_BASE_URL) || cfg.baseURL || ""),
    apiKey: String((env && env.DM_API_KEY) || cfg.apiKey || ""),
    model: String((env && env.DM_MODEL) || cfg.model || ""),
  };
}

/**
 * 解析模型配置与 fake 模式；未配置且非 fake 时返回 errorHint 供各命令友好报错。
 * @returns {{ fake: boolean, cfg: object, errorHint: string }}
 */
function resolveModel(opts) {
  const env = (opts && opts.env) || process.env;
  const fake = !!(opts && opts.fake) || env.DM_FAKE === "1";
  const cfg = modelConfig(env);
  if (!fake && (!cfg.baseURL || !cfg.apiKey || !cfg.model)) {
    return {
      fake,
      cfg,
      errorHint:
        "设置环境变量 DM_BASE_URL / DM_API_KEY / DM_MODEL，或在 " +
        path.join(cliHome(env), "config.json") +
        " 中配置 baseURL/apiKey/model；测试时可用 --fake。",
    };
  }
  return { fake, cfg, errorHint: "" };
}

// ---------- Package 加载（复用 loadPackageForActBehalf 的读取逻辑） ----------

function safeRead(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

/**
 * @param {{ env?: object, "package-dir"?: string }} [opts]
 */
function loadPackage(opts = {}) {
  const env = opts.env || process.env;
  const dir = resolvePackageDir(opts, env);
  const manifestRaw = safeRead(path.join(dir, "manifest.json"));
  const exists = !!manifestRaw;

  // 恢复与脚手架是写操作：仅在确认是 Package 目录后才执行，且失败不影响读取。
  if (exists) {
    try {
      const store = new PackageStore({ packageDir: dir, ownerId: "cli:recover" });
      store.recover();
    } catch {
      /* 恢复失败不阻塞只读 CLI */
    }
    try {
      life.ensureLifeScaffold(dir);
    } catch {
      /* optional */
    }
    try {
      policies.ensureBoundariesScaffold(dir);
    } catch {
      /* optional */
    }
  }

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
  if (exists) {
    try {
      lifeSummary = life.summarizeLifeForPrompt(dir);
    } catch {
      /* optional */
    }
    try {
      boundariesSummary = policies.summarizeBoundariesForPrompt(dir);
    } catch {
      /* optional */
    }
  }

  return {
    dir,
    exists,
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

// ---------- 模型调用（OpenAI 兼容 chat completions；支持 fake 模式） ----------

/** 与桌面应用 fakeActBehalfModelOutput 相同的假输出结构。 */
function fakeModelOutput(goal) {
  return (
    "## 使用的本人信息\n\n- （测试）已读取本次确认的本人信息摘录\n\n" +
    "## 本人已有事实或观点\n\n- （测试）根据摘录整理的既有立场\n\n" +
    "## Digital Me 的新分析或建议\n\n- （测试）针对「" +
    String(goal || "").slice(0, 80) +
    "」给出的新建议\n\n" +
    "## 完整结果\n\n（测试）这是一份结合本人信息生成的完整结果草稿，可直接修改后使用。"
  );
}

function callModel(cfg, messages, options = {}) {
  if (options.forceFake) {
    // 各命令可提供自己的 fake 输出（如代码审查三栏），缺省用通用假输出。
    return Promise.resolve(
      options.fakeOutput != null ? String(options.fakeOutput) : fakeModelOutput(options.goal)
    );
  }
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(cfg.baseURL.replace(/\/$/, "") + "/chat/completions");
    } catch {
      return reject(new Error("连接地址无效，请检查 DM_BASE_URL。"));
    }
    const body = JSON.stringify({
      model: cfg.model,
      messages,
      temperature: options.temperature ?? 0.7,
    });
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        port: url.port || 443,
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: "Bearer " + cfg.apiKey,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            const data = Buffer.concat(chunks).toString("utf8");
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(json.error.message || "模型返回错误"));
            const msg = json.choices && json.choices[0] && json.choices[0].message;
            if (!msg || msg.content == null) return reject(new Error("模型返回格式异常"));
            resolve(String(msg.content) || "(空响应)");
          } catch {
            const raw = Buffer.concat(chunks).toString("utf8");
            reject(new Error("解析响应失败：" + raw.slice(0, 300)));
          }
        });
      }
    );
    req.setTimeout(MODEL_TIMEOUT_MS, () => {
      req.destroy(new Error("模型请求超时（" + Math.round(MODEL_TIMEOUT_MS / 1000) + " 秒）"));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ---------- 对外凭据存储 ----------

function credentialStorePath(env) {
  return path.join(cliHome(env), "credentials.json");
}

function readCredentialStore(env) {
  try {
    const raw = fs.readFileSync(credentialStorePath(env), "utf8");
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.credentials)) return data;
  } catch {
    /* 不存在或损坏时按空存储处理 */
  }
  return { version: 1, credentials: [] };
}

function writeCredentialStore(env, data) {
  const home = cliHome(env);
  fs.mkdirSync(home, { recursive: true });
  const file = credentialStorePath(env);
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

function findCredential(store, id) {
  const want = String(id || "").trim();
  return store.credentials.find((c) => c && c.id === want) || null;
}

// ---------- 命令：status ----------

function cmdStatus(opts) {
  const pkg = loadPackage(opts);
  out("== Digital Me 状态 ==");
  out("Package 目录：" + pkg.dir);
  if (!pkg.exists) {
    out("状态：未找到 Package（manifest.json 不存在）");
    out("提示：用 --package-dir <目录> 或环境变量 DM_PACKAGE_DIR 指定 Package 目录。");
    return 0;
  }
  const m = pkg.manifest || {};
  out("状态：正常");
  out("Package 版本：" + (m.packageVersion || m.version || "未知"));
  if (m.schemaVersion) out("Schema 版本：" + String(m.schemaVersion));
  if (typeof m.revision === "number") out("修订号：" + String(m.revision));
  out("身份标识 digitalMeId：" + (m.digitalMeId || resolveSubjectId(pkg)));
  if (m.ownerDisplayName) out("主体：" + String(m.ownerDisplayName));
  if (m.updatedAt) out("更新时间：" + String(m.updatedAt));
  out("资料概览：");
  const sections = [
    ["人格（persona.md）", pkg.persona],
    ["表达风格（style-guide.md）", pkg.styleGuide],
    ["判断框架（decision-frameworks.json）", pkg.decisionFrameworks],
    ["偏好（preferences.json）", pkg.preferences],
    ["长期记忆（memory/long-term-memory.jsonl）", pkg.longTermMemory],
    ["人生摘要（life/）", pkg.lifeSummary],
    ["边界（policies/boundaries.json）", pkg.boundariesSummary],
    ["身份声明（identity.json）", pkg.identitySummary],
  ];
  for (const [label, text] of sections) {
    out("  - " + label + "：" + (String(text || "").trim() ? "已就绪" : "缺失"));
  }
  return 0;
}

// ---------- 命令：context ----------

function cmdContext(opts, goal) {
  const pkg = loadPackage(opts);
  if (!pkg.exists) {
    errOut("警告：未找到 Package（" + pkg.dir + "），以下为降级上下文。");
  }
  out("== 个性化上下文 ==");
  if (goal) {
    const assembled = assembleSubjectContextCandidates(pkg, { goal });
    const draft = assembled.subjectContextDraft || { claims: [], prohibitedUses: [] };
    out("目标：" + goal);
    out("主体：" + draft.subjectId + "（版本 " + draft.subjectVersion + "）");
    if (assembled.note) out("说明：" + assembled.note);
    out("");
    out("候选条目（" + draft.claims.length + " 条）：");
    draft.claims.forEach((c, i) => {
      const src = (c.sourceRefs && c.sourceRefs[0] && c.sourceRefs[0].source) || "unknown";
      out("  " + (i + 1) + ". [" + (c.kind || "other") + "] " + (c.label || "（无标题）"));
      out("     " + truncateText(c.text, 120));
      out("     来源：" + src);
    });
    const banned = (Array.isArray(draft.prohibitedUses) ? draft.prohibitedUses : []).filter(
      (b) => !/^#{1,6}\s/.test(String(b).trim())
    );
    if (banned.length) {
      out("");
      out("禁止用途：");
      for (const b of banned) out("  - " + b);
    }
    return 0;
  }
  const sel = buildSelectedSelfContext(pkg);
  out("主体：" + resolveSubjectId(pkg) + "（版本 " + resolveSubjectVersion(pkg) + "）");
  if (!sel.items.length) {
    out("（Package 中没有可用的本人资料摘录。请先用桌面应用或 Builder 构建 Package。）");
    return 0;
  }
  out("有界摘录（" + sel.items.length + " 段，预算 " + sel.charCount + "/" + sel.budget + " 字符）：");
  out("");
  for (const it of sel.items) {
    out("### " + it.label + "（" + it.source + "）");
    out(truncateText(it.text, 400));
    out("");
  }
  return 0;
}

// ---------- 命令：generate ----------

async function cmdGenerate(opts, goal) {
  if (!goal) {
    return fail("缺少生成目标。", "用法：dm generate <目标>，例如：dm generate 写一篇关于本地优先的短文");
  }
  const pkg = loadPackage(opts);
  if (!pkg.exists) {
    errOut("警告：未找到 Package（" + pkg.dir + "），将在没有本人资料的情况下生成。");
  }
  const assembled = assembleSubjectContextCandidates(pkg, { goal });
  const contextText =
    (assembled.selectedSelfContext && assembled.selectedSelfContext.combinedText) || "";
  const messages = buildActBehalfMessages({
    request: goal,
    selectedSelfContextText: contextText,
    title: goal.slice(0, 40),
  });

  const model = resolveModel(opts);
  if (model.errorHint) {
    return fail("未配置模型，无法生成。", model.errorHint);
  }

  errOut("正在生成（" + (model.fake ? "fake 模式" : model.cfg.model) + "）…");
  let raw;
  try {
    raw = await callModel(model.cfg, messages, { forceFake: model.fake, goal, temperature: 0.4 });
  } catch (e) {
    return fail("模型调用失败：" + (e && e.message ? e.message : e));
  }

  const parsed = parseActBehalfOutput(raw);
  out("== 生成结果 ==");
  out("目标：" + goal);
  out("");
  if (parsed.usedSelfInfo) {
    out("## 使用的本人信息");
    out(parsed.usedSelfInfo);
    out("");
  }
  if (parsed.existingUserPositions) {
    out("## 本人已有事实或观点");
    out(parsed.existingUserPositions);
    out("");
  }
  if (parsed.digitalMeInferences) {
    out("## Digital Me 的新分析或建议");
    out(parsed.digitalMeInferences);
    out("");
  }
  out("## 完整结果");
  out(parsed.result);
  return 0;
}

// ---------- 命令：credential ----------

function cmdCredential(opts, sub) {
  const env = opts.env || process.env;
  const store = readCredentialStore(env);

  if (sub === "generate") {
    const pkg = loadPackage(opts);
    const subjectId = pkg.exists
      ? String((pkg.manifest && pkg.manifest.digitalMeId) || resolveSubjectId(pkg))
      : "local:unknown";
    const cred = {
      id: "cred_" + crypto.randomBytes(6).toString("hex"),
      label: String(opts.label || "").trim(),
      subjectId,
      secret: crypto.randomBytes(24).toString("hex"),
      issuedAt: new Date().toISOString(),
      revokedAt: null,
    };
    store.credentials.push(cred);
    try {
      writeCredentialStore(env, store);
    } catch (e) {
      return fail("无法写入凭据存储：" + (e && e.message ? e.message : e));
    }
    out("== 已生成对外凭据 ==");
    out("凭据 ID：" + cred.id);
    if (cred.label) out("备注：" + cred.label);
    out("绑定主体：" + cred.subjectId);
    out("签发时间：" + cred.issuedAt);
    out("提示：用 dm credential show " + cred.id + " 向外部出示凭据；用 dm credential revoke " + cred.id + " 撤销。");
    return 0;
  }

  if (sub === "list" || sub === undefined || sub === "") {
    out("== 对外凭据 ==");
    if (!store.credentials.length) {
      out("（暂无凭据。用 dm credential generate 生成。）");
      return 0;
    }
    for (const c of store.credentials) {
      const status = c.revokedAt ? "已撤销" : "有效";
      out("  - " + c.id + "  [" + status + "]  主体：" + c.subjectId + "  签发：" + c.issuedAt + (c.label ? "  备注：" + c.label : ""));
    }
    return 0;
  }

  if (sub === "show") {
    const id = String(opts._id || "").trim();
    if (!id) return fail("缺少凭据 ID。", "用法：dm credential show <凭据ID>");
    const cred = findCredential(store, id);
    if (!cred) return fail("找不到凭据 " + id + "。", "用 dm credential list 查看已有凭据。");
    if (cred.revokedAt) {
      return fail("凭据 " + id + " 已撤销（撤销时间：" + cred.revokedAt + "），不能出示。");
    }
    out("== 出示凭据 ==");
    out("凭据 ID：" + cred.id);
    out("绑定主体：" + cred.subjectId);
    out("凭据密钥：" + cred.secret);
    out("签发时间：" + cred.issuedAt);
    if (cred.label) out("备注：" + cred.label);
    return 0;
  }

  if (sub === "revoke") {
    const id = String(opts._id || "").trim();
    if (!id) return fail("缺少凭据 ID。", "用法：dm credential revoke <凭据ID>");
    const cred = findCredential(store, id);
    if (!cred) return fail("找不到凭据 " + id + "。", "用 dm credential list 查看已有凭据。");
    if (cred.revokedAt) {
      out("凭据 " + id + " 此前已撤销（" + cred.revokedAt + "）。");
      return 0;
    }
    cred.revokedAt = new Date().toISOString();
    try {
      writeCredentialStore(env, store);
    } catch (e) {
      return fail("无法写入凭据存储：" + (e && e.message ? e.message : e));
    }
    out("已撤销凭据 " + id + "。");
    return 0;
  }

  if (sub === "export") {
    const id = String(opts._id || "").trim();
    if (!id) return fail("缺少凭据 ID。", "用法：dm credential export <凭据ID> --output <文件>");
    const output = String(opts.output || "").trim();
    if (!output) return fail("缺少输出文件路径。", "用法：dm credential export <凭据ID> --output <文件>");
    const packageDir = resolvePackageDir(opts, env);
    const result = exportCredential(packageDir, id, output);
    if (!result.ok) return fail(result.message || "导出失败。");
    out("== 凭据已导出 ==");
    out("凭据 ID：" + id);
    out("导出文件：" + result.filePath);
    out("提示：导出文件包含签发者公钥，接收方可用 dm credential import <文件> 导入并验证。");
    return 0;
  }

  if (sub === "import") {
    const file = String(opts._id || "").trim();
    if (!file) return fail("缺少凭据文件路径。", "用法：dm credential import <文件>");
    const packageDir = resolvePackageDir(opts, env);
    const result = importCredential(packageDir, file);
    if (!result.ok) return fail(result.message || "导入失败。");
    if (!result.valid) {
      out("== 凭据导入：验证未通过 ==");
      out("签发者：" + (result.issuer || "未知"));
      out("原因：" + (result.reason || "未知"));
      return 1;
    }
    out("== 凭据已导入并验证 ==");
    out("签发者：" + result.issuer);
    out("凭据 ID：" + result.credential.id);
    if (result.credential.scope) out("授权范围：" + result.credential.scope);
    if (result.credential.validUntil) out("有效期至：" + result.credential.validUntil);
    return 0;
  }

  return fail(
    "未知的 credential 子命令：" + sub,
    "可用子命令：generate [--label 备注] / list / show <id> / revoke <id>"
  );
}

// ---------- 命令：collaboration ----------

function cmdCollaboration(opts, sub, args) {
  const env = opts.env || process.env;
  const packageDir = resolvePackageDir(opts, env);
  const arg0 = String((args && args[0]) || "").trim();

  if (sub === "invite") {
    if (!arg0) {
      return fail("缺少协作 ID。", "用法：dm collaboration invite <协作ID> --output <文件>");
    }
    const output = String(opts.output || "").trim();
    if (!output) {
      return fail("缺少输出文件路径。", "用法：dm collaboration invite <协作ID> --output <文件>");
    }
    const res = exportInvite(packageDir, arg0, output);
    if (!res.ok) return fail(res.message);
    out("== 协作邀请已导出 ==");
    out("协作 ID：" + arg0);
    out("邀请文件：" + res.filePath);
    out("提示：将邀请文件发送给协作方，对方用 dm collaboration accept <文件> 接受。");
    return 0;
  }

  if (sub === "accept") {
    if (!arg0) {
      return fail("缺少邀请文件路径。", "用法：dm collaboration accept <邀请文件>");
    }
    const res = importInvite(packageDir, arg0);
    if (!res.ok) return fail(res.message);
    out("== 协作邀请已接受 ==");
    out("协作 ID：" + res.collaboration.id);
    out("标题：" + res.collaboration.title);
    out("目标：" + res.collaboration.goal);
    out("邀请方 DID：" + (res.collaboration.collaborator && res.collaboration.collaborator.did));
    out("状态：" + res.collaboration.status);
    out("提示：协作过程中用 dm collaboration export-update / import-update 同步进展。");
    return 0;
  }

  if (sub === "export-update") {
    if (!arg0) {
      return fail("缺少协作 ID。", "用法：dm collaboration export-update <协作ID> --output <文件>");
    }
    const output = String(opts.output || "").trim();
    if (!output) {
      return fail("缺少输出文件路径。", "用法：dm collaboration export-update <协作ID> --output <文件>");
    }
    const res = exportUpdate(packageDir, arg0, output);
    if (!res.ok) return fail(res.message);
    out("== 协作更新已导出 ==");
    out("协作 ID：" + arg0);
    out("更新文件：" + res.filePath);
    out("提示：将更新文件发送给协作方，对方用 dm collaboration import-update <文件> 合并。");
    return 0;
  }

  if (sub === "import-update") {
    if (!arg0) {
      return fail("缺少更新文件路径。", "用法：dm collaboration import-update <更新文件>");
    }
    const res = importUpdate(packageDir, arg0);
    if (!res.ok) return fail(res.message);
    out("== 协作更新已合并 ==");
    out("协作 ID：" + res.collaboration.id);
    out("标题：" + res.collaboration.title);
    out("状态：" + res.collaboration.status);
    out(
      "过程记录：" +
        res.collaboration.interactions.length + " 条交互、" +
        res.collaboration.deliverables.length + " 个交付物、" +
        res.collaboration.feedback.length + " 条反馈"
    );
    return 0;
  }

  if (sub === "list" || sub === undefined || sub === "") {
    const res = listCollaborations(packageDir);
    out("== 协作列表 ==");
    if (!res.collaborations.length) {
      out("（暂无协作。用 dm collaboration accept <邀请文件> 接受协作邀请。）");
      return 0;
    }
    for (const c of res.collaborations) {
      const partner = c.collaborator && (c.collaborator.did || c.collaborator.name);
      out(
        "  - " + c.id + "  [" + c.status + "]  " + c.title +
          (partner ? "  协作方：" + partner : "") +
          (c.validUntil ? "  有效期至：" + c.validUntil : "")
      );
    }
    return 0;
  }

  return fail(
    "未知的 collaboration 子命令：" + sub,
    "可用子命令：invite <协作ID> --output <文件> / accept <邀请文件> / " +
      "export-update <协作ID> --output <文件> / import-update <更新文件> / list"
  );
}

// ---------- 用法与入口 ----------

// 注入到 src/cli/commands/ 各命令模块的共享能力（复用现有数据加载与模型调用逻辑）。
const cliDeps = {
  loadPackage,
  callModel,
  resolveModel,
  assembleSubjectContextCandidates,
  truncateText,
  out,
  errOut,
  fail,
};

function usageText() {
  return [
    "Digital Me CLI — 在终端里与 Digital Me 协作",
    "",
    "用法：",
    "  dm status                              显示 Package 状态（版本、身份标识）",
    "  dm context [目标]                      显示个性化上下文（带目标时按相关性排序）",
    "  dm generate <目标> [--fake]            生成内容（写作/研究/编程）",
    "  dm run <文件> [--exec] [--fake]        审查代码；加 --exec 实际执行（带超时保护）",
    "  dm project [目录]                      分析项目结构，生成项目上下文摘要",
    "  dm review <文件> [--fake]              代码审查（问题/建议/改进方案）",
    "  dm credential generate [--label 备注]  生成对外凭据",
    "  dm credential list                     列出对外凭据",
    "  dm credential show <id>                出示对外凭据",
    "  dm credential revoke <id>              撤销对外凭据",
    "  dm credential export <id> --output <文件>  导出身份凭据为 JSON（含签发者公钥）",
    "  dm credential import <文件>                导入并验证身份凭据（跨账户）",
    "  dm collaboration invite <协作ID> --output <文件>   导出协作邀请文件",
    "  dm collaboration accept <邀请文件>                 接受协作邀请",
    "  dm collaboration export-update <协作ID> --output <文件>  导出协作进展更新",
    "  dm collaboration import-update <更新文件>          导入并合并协作更新",
    "  dm collaboration list                            列出所有协作",
    "",
    "选项：",
    "  --package-dir <目录>  指定 Package 目录（也可用环境变量 DM_PACKAGE_DIR）",
    "  --fake                使用内置假模型，不调用真实 API（也可用 DM_FAKE=1）",
    "  --exec                dm run 时实际执行代码（默认仅审查，不执行）",
    "  --timeout <毫秒>      dm run --exec 的执行超时（默认 15000，上限 120000）",
    "",
    "模型配置：环境变量 DM_BASE_URL / DM_API_KEY / DM_MODEL，",
    "或 " + path.join(os.homedir(), ".digitalme-cli", "config.json") + " 中的 baseURL/apiKey/model。",
  ].join("\n");
}

function parseArgs(argv) {
  const opts = {};
  const pos = [];
  const flagOnly = new Set(["fake", "help", "json", "exec"]);
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i]);
    if (a.startsWith("--")) {
      const key = a.slice(2);
      if (flagOnly.has(key)) {
        opts[key] = true;
      } else if (i + 1 < argv.length) {
        opts[key] = argv[i + 1];
        i += 1;
      } else {
        opts[key] = true;
      }
    } else {
      pos.push(a);
    }
  }
  return { opts, pos };
}

async function main(argv, env) {
  const { opts, pos } = parseArgs(argv || []);
  opts.env = env || process.env;
  const cmd = pos[0] || "help";
  const rest = pos.slice(1);

  switch (cmd) {
    case "status":
      return cmdStatus(opts);
    case "context":
      return cmdContext(opts, rest.join(" ").trim());
    case "generate":
      return cmdGenerate(opts, rest.join(" ").trim());
    case "run":
      return cmdRun(cliDeps, opts, rest.join(" ").trim());
    case "project":
      return cmdProject(cliDeps, opts, rest.join(" ").trim());
    case "review":
      return cmdReview(cliDeps, opts, rest.join(" ").trim());
    case "credential": {
      // credential show/revoke 的 id 是第二个位置参数。
      opts._id = rest[1] || "";
      return cmdCredential(opts, rest[0]);
    }
    case "collaboration":
      return cmdCollaboration(opts, rest[0], rest.slice(1));
    case "help":
      out(usageText());
      return 0;
    default:
      errOut("未知命令：" + cmd);
      errOut("");
      errOut(usageText());
      return 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((e) => {
      errOut("错误：" + (e && e.message ? e.message : e));
      process.exitCode = 1;
    });
}

module.exports = {
  DEFAULT_PACKAGE_DIR,
  cliHome,
  readCliConfig,
  resolvePackageDir,
  modelConfig,
  resolveModel,
  loadPackage,
  callModel,
  fakeModelOutput,
  readCredentialStore,
  writeCredentialStore,
  cmdStatus,
  cmdContext,
  cmdGenerate,
  cmdRun,
  cmdProject,
  cmdReview,
  cmdCredential,
  cmdCollaboration,
  parseArgs,
  usageText,
  main,
};
