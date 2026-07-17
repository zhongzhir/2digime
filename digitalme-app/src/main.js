"use strict";

const { app, BrowserWindow, ipcMain, dialog, Menu, safeStorage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const https = require("node:https");
const builder = require("./builder");
const materials = require("./materials");
const life = require("./life");
const policies = require("./policies");
const inbox = require("./inbox");
const retrieval = require("./retrieval");
const feedback = require("./feedback");
const { PackageStore, buildVersionPanelInfo } = require("./package-store");
const { buildSubjectOverviewV1 } = require("./subject-overview");
const { createMinimalFixture } = require("./package-store/fixture");
const pptxOutput = require("./outputs/pptx");
const documentOutput = require("./outputs/document");
const library = require("./outputs/library");
const researchProjects = require("./research/projects");
const researchWebSearch = require("./research/web-search");
const researchAgentLoop = require("./research/agent-loop");
const researchGrounded = require("./research/grounded");
const personalSkills = require("./skills/personal");
const sessions = require("./sessions");
const catalog = require("./capabilities/catalog");
const capabilitySurface = require("./capabilities/surface");
const l0Orchestration = require("./orchestration/l0");
const l0Audit = require("./orchestration/audit-store");
const l0Agents = require("./orchestration/agents");
const externalAgentFlow = require("./orchestration/external-agent-flow");
const decisionAudit = require("./decision-audit");
const { SecretStore } = require("./security/secret-store");
const { createElectronSafeStorageAdapter } = require("./security/electron-safe-storage-adapter");
const { ConfigSecretsService, extensionSecretId } = require("./security/config-secrets");

// Digital Me Package lives one level up from the app folder by default.
const DEFAULT_PACKAGE_DIR = path.join(__dirname, "..", "..", "digital-me-package");
const CONFIG_PATH = path.join(app.getPath("userData"), "config.json");

let configSecrets = null;

function getConfigSecrets() {
  if (configSecrets) return configSecrets;
  const userDataPath = app.getPath("userData");
  const store = new SecretStore({
    userDataPath,
    encryptAdapter: createElectronSafeStorageAdapter(safeStorage),
  });
  configSecrets = new ConfigSecretsService({
    userDataPath,
    configPath: CONFIG_PATH,
    secretStore: store,
    defaultPackageDir: DEFAULT_PACKAGE_DIR,
  });
  return configSecrets;
}

function buildAppMenu() {
  const template = [
    {
      label: "文件",
      submenu: [{ role: "quit", label: "退出 Digital Me" }],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新加载" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "重置缩放" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" },
      ],
    },
    {
      label: "窗口",
      submenu: [
        { role: "minimize", label: "最小化" },
        { role: "close", label: "关闭窗口" },
      ],
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "关于 Digital Me",
          click: () => {
            dialog.showMessageBox({
              type: "info",
              title: "关于 Digital Me",
              message: "Digital Me v0.1",
              detail: "本地优先 · 平台中立 · 可迁移的个人数字主体系统。",
            });
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    title: "Digital Me",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "renderer", "index.html"));
  if (process.argv.includes("--dev")) win.webContents.openDevTools();
}

app.whenReady().then(() => {
  buildAppMenu();
  const migration = getConfigSecrets().migrateLegacySecrets();
  if (migration && (migration.status === "blocked" || migration.status === "failed") && migration.warning) {
    const title =
      migration.code === "config_json_corrupt" ||
      migration.code === "config_permission_denied" ||
      migration.code === "config_read_failed" ||
      migration.code === "config_not_a_file"
        ? "配置文件无法安全读取"
        : migration.code === "plaintext_backup_cleanup_failed"
          ? "明文配置备份未能安全清除"
          : "密钥未能迁入本机安全存储";
    dialog.showMessageBox({
      type: "warning",
      title,
      message: title,
      detail: migration.warning,
    });
  }
  // Recover interrupted PackageStore journal only — never auto-migrate schema.
  tryRecoverConfiguredPackageStore();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let quitting = false;
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  (async () => {
    try {
      const em = await getExtensionManager();
      await em.disconnectAll();
    } catch {}
    app.exit(0);
  })();
});

// ---------- Capability extensions (MCP Client) ----------
let extensionManager = null;
async function getExtensionManager() {
  if (!extensionManager) {
    extensionManager = await import("./capabilities/extension-manager.mjs");
  }
  return extensionManager;
}

function npxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

function defaultWorkspaceRoot() {
  const root = path.join(app.getPath("documents"), "DigitalMe");
  try {
    fs.mkdirSync(root, { recursive: true });
  } catch {}
  return root;
}

function draftsDir() {
  const dir = path.join(defaultWorkspaceRoot(), "成稿");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}
  return dir;
}

function safeFileStem(title) {
  return String(title || "成稿")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60) || "成稿";
}

/** Persist artifact to Documents/DigitalMe/成稿 — real disk write (.md + .docx for WPS). */
function saveArtifactToDisk(artifact) {
  if (!artifact || !artifact.content) return null;
  if (documentOutput.isMetaNoise(artifact.content)) return null;
  const dir = draftsDir();
  const stamp = new Date().toISOString().slice(0, 10);
  const stem = safeFileStem(artifact.title);
  let base = path.join(dir, `${stem}_${stamp}`);
  let n = 2;
  while (fs.existsSync(base + ".md") || fs.existsSync(base + ".docx")) {
    base = path.join(dir, `${stem}_${stamp}_${n}`);
    n += 1;
  }
  const header =
    "<!-- Digital Me 成稿 · 自动保存 · " + new Date().toLocaleString("zh-CN") + " -->\n\n";
  const mdPath = base + ".md";
  const docxPath = base + ".docx";
  fs.writeFileSync(mdPath, header + artifact.content, "utf8");
  try {
    const buf = documentOutput.buildDocxFromMarkdown(artifact.content, artifact.title || "成稿");
    fs.writeFileSync(docxPath, buf);
  } catch {}
  return { mdPath, docxPath, dir };
}

/**
 * Strip model tool-call leakage (DeepSeek DSML uses fullwidth ｜ U+FF5C).
 * Never show raw protocol to users.
 */
function stripToolLeakage(text) {
  let t = String(text || "");
  // DeepSeek V4 / V3.2 DSML blocks (fullwidth pipe U+FF5C)
  t = t.replace(/<｜DSML｜tool_calls>[\s\S]*?<\/｜DSML｜tool_calls>/gi, "");
  t = t.replace(/<｜DSML｜function_calls>[\s\S]*?<\/｜DSML｜function_calls>/gi, "");
  t = t.replace(/<｜DSML｜invoke\b[^>]*>[\s\S]*?<\/｜DSML｜invoke>/gi, "");
  t = t.replace(/<｜DSML｜parameter\b[^>]*>[\s\S]*?<\/｜DSML｜parameter>/gi, "");
  t = t.replace(/<｜DSML｜tool_calls>[\s\S]*$/gi, "");
  t = t.replace(/<｜DSML｜function_calls>[\s\S]*$/gi, "");
  t = t.replace(/<｜DSML｜invoke\b[^>]*>[\s\S]*$/gi, "");
  // ASCII-pipe / spaced / broken fragments
  t = t.replace(/<\|\s*DSML\s*\|[^>\n]*>[\s\S]*?(?:<\/\|\s*DSML\s*\|[^>\n]*>|$)/gi, "");
  t = t.replace(/<\/?\|\s*DSML\s*\|[^>\n]*>/gi, "");
  t = t.replace(/<\/?｜DSML｜[^>\n]*>/gi, "");
  t = t.replace(/<\|tool_calls?\|?>[\s\S]*?(?:<\/\|tool_calls?\|?>|$)/gi, "");
  t = t.replace(/```(?:xml|json|dsml)?\s*[\s\S]*?tool_calls[\s\S]*?```/gi, "");
  t = t.replace(/^\s*invoke\s+name\s*=\s*"[^"]+"\s*$/gim, "");
  t = t.replace(/^\s*parameter\s+\w+\s+is\s+.+$/gim, "");
  t = t.replace(/invoke\s+name\s*=\s*"[^"]+"[\s\S]{0,800}?(?=\n\n|$)/gi, "");
  t = t.replace(/<\/?tool_result[^>]*>/gi, "");
  t = t.replace(/<｜end▁of▁sentence｜>/g, "");
  // Drop any remaining line that still looks like protocol markup
  t = t
    .split(/\n/)
    .filter((line) => !/DSML|tool_calls|<\/?\s*[|｜]/i.test(line))
    .join("\n");
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  if (!t && /DSML|tool_calls/i.test(String(text || ""))) {
    return "";
  }
  return t;
}

/** Detect DSML (or ASCII lookalike) tool markup in assistant content. */
function hasDsmlToolMarkup(text) {
  const s = String(text || "");
  return (
    /<｜DSML｜(?:tool_calls|function_calls|invoke)/i.test(s) ||
    /<\|\s*DSML\s*\|/i.test(s) ||
    (/tool_calls/i.test(s) && /invoke\s+name\s*=/i.test(s))
  );
}

/**
 * Parse DeepSeek DSML tool calls from assistant content into OpenAI-shaped tool_calls.
 */
function parseDsmlToolCalls(text) {
  const s = String(text || "");
  if (!hasDsmlToolMarkup(s) && !/<｜DSML｜/i.test(s)) return [];
  const calls = [];
  const pushCall = (name, args) => {
    if (!name) return;
    calls.push({
      id: "dsml_" + Date.now().toString(36) + "_" + calls.length,
      type: "function",
      function: { name: String(name), arguments: JSON.stringify(args || {}) },
    });
  };

  const blocks = [];
  const blockRe =
    /<(?:｜|\|)\s*DSML\s*(?:｜|\|)\s*(?:tool_calls|function_calls)\s*>([\s\S]*?)<\/(?:｜|\|)\s*DSML\s*(?:｜|\|)\s*(?:tool_calls|function_calls)\s*>/gi;
  let bm;
  while ((bm = blockRe.exec(s))) blocks.push(bm[1]);
  if (!blocks.length) blocks.push(s);

  for (const block of blocks) {
    const invRe =
      /<(?:｜|\|)\s*DSML\s*(?:｜|\|)\s*invoke\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/(?:｜|\|)\s*DSML\s*(?:｜|\|)\s*invoke\s*>/gi;
    let im;
    let foundTagged = false;
    while ((im = invRe.exec(block))) {
      foundTagged = true;
      const name = im[1];
      const body = im[2] || "";
      const args = {};
      const pRe =
        /<(?:｜|\|)\s*DSML\s*(?:｜|\|)\s*parameter\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/(?:｜|\|)\s*DSML\s*(?:｜|\|)\s*parameter\s*>/gi;
      let pm;
      while ((pm = pRe.exec(body))) {
        args[pm[1]] = String(pm[2] || "").trim();
      }
      if (!Object.keys(args).length) {
        const trimmed = body.trim();
        if (trimmed.startsWith("{")) {
          try {
            Object.assign(args, JSON.parse(trimmed));
          } catch {}
        }
        const lineRe = /parameter\s+(\w+)\s+is\s+(.+)$/gim;
        let lm;
        while ((lm = lineRe.exec(body))) {
          args[lm[1]] = String(lm[2] || "")
            .trim()
            .replace(/^["']|["']$/g, "");
        }
      }
      pushCall(name, args);
    }
    if (foundTagged) continue;

    const looseRe = /invoke\s+name\s*=\s*"([^"]+)"([\s\S]*?)(?=invoke\s+name\s*=\s*"|$)/gi;
    let lm;
    while ((lm = looseRe.exec(block))) {
      const name = lm[1];
      const body = lm[2] || "";
      const args = {};
      const lineRe = /parameter\s+(\w+)\s+is\s+(.+)$/gim;
      let pm;
      while ((pm = lineRe.exec(body))) {
        args[pm[1]] = String(pm[2] || "")
          .trim()
          .replace(/^["']|["']$/g, "");
      }
      pushCall(name, args);
    }
  }
  return calls;
}

/** Only recover disk drafts when the user clearly asked for that kind of doc. */
function shouldRecoverFromWorkspace(userQuestion, reply) {
  const q = String(userQuestion || "");
  const r = String(reply || "");
  // Non-resume writing tasks must never pull old 简历 files
  if (/报告|请示|方案|备忘录|提纲|大纲|降雨|气候|分析|研究/.test(q) && !/简历/.test(q)) {
    return false;
  }
  if (/简历/.test(q)) return true;
  if (/简历[^\n\r|]{0,60}\.md/.test(r)) return true;
  return false;
}

/**
 * Recover draft body from workspace ONLY for matching resume requests,
 * and only when reply names a file or user asked for 简历.
 */
function recoverArtifactFromWorkspace(replyText, userQuestion) {
  if (!shouldRecoverFromWorkspace(userQuestion, replyText)) return null;

  const root = defaultWorkspaceRoot();
  const names = [];
  const re = /([^\s|`「」【】]+简历[^\s|`「」【】]*\.md)/g;
  let m;
  const blob = String(replyText || "");
  while ((m = re.exec(blob))) names.push(path.basename(m[1]));

  const candidates = [];
  function walk(d, depth) {
    if (depth > 2) return;
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.md$/i.test(e.name) && /简历/.test(e.name)) {
        try {
          const st = fs.statSync(p);
          candidates.push({ p, mtime: st.mtimeMs, name: e.name });
        } catch {}
      }
    }
  }
  walk(root, 0);
  candidates.sort((a, b) => b.mtime - a.mtime);

  // Prefer explicitly named files; otherwise do not guess from "any recent resume"
  const prefer = names.length
    ? candidates.filter((c) => names.some((n) => c.name === n || c.name.includes(n.replace(/\.md$/i, "").slice(0, 12))))
    : [];
  if (!prefer.length && !/简历/.test(String(userQuestion || ""))) return null;
  const pool = prefer.length ? prefer : candidates.slice(0, 1);

  for (const c of pool) {
    try {
      let text = fs.readFileSync(c.p, "utf8").replace(/^<!--[\s\S]*?-->\s*/, "");
      if (documentOutput.looksLikeResumeBody(text) && !documentOutput.isMetaNoise(text)) {
        const titleMatch = /^(?:#\s+)?(.+)$/m.exec(text);
        return {
          id: "art_" + Date.now().toString(36),
          type: "markdown",
          title: (titleMatch && titleMatch[1].slice(0, 48)) || c.name.replace(/\.md$/i, ""),
          content: text,
          createdAt: new Date().toISOString(),
          recoveredFrom: c.p,
        };
      }
    } catch {}
  }
  return null;
}

function resolveTemplateArgs(argsTemplate, params) {
  const map = {
    workspaceRoot: params.workspaceRoot || defaultWorkspaceRoot(),
    dbPath: params.dbPath || "",
  };
  return (argsTemplate || []).map((a) =>
    String(a).replace(/\{\{(\w+)\}\}/g, (_, key) => map[key] != null ? String(map[key]) : "")
  );
}

function buildExtensionFromCatalog(item, options = {}) {
  const params = options.params || {};
  const env = {};
  for (const ek of item.envKeys || []) {
    const val = (options.env && options.env[ek.key]) || "";
    if (val) env[ek.key] = String(val);
  }
  if (item.needsKey) {
    for (const ek of item.envKeys || []) {
      if (!env[ek.key]) throw new Error(`请先填写 ${ek.label || ek.key}`);
    }
  }
  if (item.pathParam?.required) {
    const key = item.pathParam.key;
    if (!params[key] || !String(params[key]).trim()) {
      throw new Error(`请填写 ${item.pathParam.label || key}`);
    }
  }
  if (item.id === "filesystem" || item.pathParam?.key === "workspaceRoot") {
    const root = params.workspaceRoot || defaultWorkspaceRoot();
    fs.mkdirSync(root, { recursive: true });
    params.workspaceRoot = root;
  }
  if (params.dbPath) {
    if (!fs.existsSync(params.dbPath)) throw new Error("数据库文件不存在：" + params.dbPath);
  }

  return {
    id: item.id,
    name: item.name,
    catalogId: item.id,
    command: item.command || npxCommand(),
    args: resolveTemplateArgs(item.argsTemplate, params),
    env: Object.keys(env).length ? env : undefined,
    note: item.tagline,
    params: {
      workspaceRoot: params.workspaceRoot || undefined,
      dbPath: params.dbPath || undefined,
    },
  };
}

function getCapabilityExtensions() {
  const svc = getConfigSecrets();
  const loaded = svc.loadRawConfig();
  if (loaded.status === "error") return [];
  const cfg = loaded.config;
  let list = Array.isArray(cfg.capabilityExtensions) ? cfg.capabilityExtensions : [];
  // 迁移旧版示例 id / 高摩擦启动方式
  let changed = false;
  list = list.map((ext) => {
    if (ext.id === "filesystem-demo") {
      changed = true;
      return { ...ext, id: "filesystem", catalogId: "filesystem", name: ext.name || "本地文件读写" };
    }
    // 网页抓取：从 uvx 迁到 npx，消除 Python/uv 门槛
    if (
      ext.id === "fetch" &&
      (ext.command === "uvx" || (ext.args || []).some((a) => String(a).includes("mcp-server-fetch")))
    ) {
      changed = true;
      return {
        ...ext,
        name: ext.name || "网页抓取",
        catalogId: "fetch",
        command: npxCommand(),
        args: ["-y", "mcp-fetch-server"],
        note: ext.note || "按 URL 拉取网页正文（npx，无需 uv）",
      };
    }
    return ext;
  });
  if (changed) {
    try {
      cfg.capabilityExtensions = list.map((e) => svc.sanitizeExtension(e, svc.secretStore));
      delete cfg.apiKey;
      svc.writeRawConfig(cfg);
    } catch {
      /* keep in-memory list; do not overwrite unreadable/corrupt configs */
    }
  }
  return list.map((e) => svc.sanitizeExtension(e, svc.secretStore));
}

function saveCapabilityExtensions(list) {
  return getConfigSecrets().saveExtensionsList(list);
}

function findExtensionById(id) {
  const ext = getCapabilityExtensions().find((e) => e.id === id);
  if (!ext) throw new Error("未找到已启用的扩展：" + id + "。请先在商店中启用。");
  return ext;
}

function findExtensionForConnect(id) {
  const publicExt = findExtensionById(id);
  return getConfigSecrets().hydrateExtensionEnv(publicExt);
}

function enrichCatalogForUi() {
  const enabled = new Set(getCapabilityExtensions().map((e) => e.id));
  const mapItem = (item) => ({
    ...item,
    enabled: enabled.has(item.id),
    defaultWorkspaceRoot: item.pathParam?.key === "workspaceRoot" ? defaultWorkspaceRoot() : undefined,
  });
  return {
    guide: catalog.GUIDE,
    categories: catalog.CATEGORIES,
    generalItems: catalog.CATALOG.filter(catalog.isGeneralItem).map(mapItem),
    advancedItems: catalog.CATALOG.filter(catalog.isAdvancedItem).map(mapItem),
    items: catalog.CATALOG.map(mapItem),
  };
}

// ---------- Config (PublicConfig for renderer; RuntimeConfig only in main) ----------
function readConfig() {
  // Legacy name kept for internal call sites that need runtime secrets.
  return getConfigSecrets().getRuntimeConfig();
}

function readPublicConfig() {
  return getConfigSecrets().readPublicConfig();
}

function writeConfig(cfg) {
  // Internal writes must not reintroduce plaintext apiKey.
  const svc = getConfigSecrets();
  const loaded = svc.loadRawConfig();
  if (loaded.status === "error") {
    const err = new Error(loaded.message || "config_unreadable");
    err.code = loaded.code || "config_unreadable";
    throw err;
  }
  const next = { ...cfg };
  delete next.apiKey;
  if (Array.isArray(next.capabilityExtensions)) {
    next.capabilityExtensions = next.capabilityExtensions.map((e) =>
      svc.sanitizeExtension(e, svc.secretStore)
    );
  }
  const raw = loaded.config;
  svc.writeRawConfig({
    ...raw,
    ...next,
    secretsMigration: next.secretsMigration || raw.secretsMigration,
  });
}

ipcMain.handle("config:get", () => readPublicConfig());
ipcMain.handle("config:set", (_e, cfg) => {
  getConfigSecrets().setConfigFromRenderer(cfg || {});
  return readPublicConfig();
});
ipcMain.handle("config:clearApiKey", () => {
  return getConfigSecrets().clearModelApiKey();
});
ipcMain.handle("secrets:clearExtensionEnv", (_e, payload) => {
  const extensionId = String(payload?.extensionId || "").trim();
  const envKey = String(payload?.envKey || "").trim();
  if (!extensionId || !envKey) throw new Error("请指定扩展与密钥名称");
  getConfigSecrets().clearExtensionSecret(extensionId, envKey);
  // Refresh sanitized list on disk
  const list = getCapabilityExtensions();
  saveCapabilityExtensions(list);
  return {
    ok: true,
    extensionId,
    envKey,
    configured: getConfigSecrets().secretStore.has(extensionSecretId(extensionId, envKey)),
  };
});

// ---------- Digital Me Package loading ----------
function safeRead(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function packageDirFromConfig() {
  return readPublicConfig().packageDir || DEFAULT_PACKAGE_DIR;
}

function isUnderTmpDir(dir) {
  const resolved = path.resolve(String(dir || ""));
  const tmp = path.resolve(os.tmpdir());
  return resolved === tmp || resolved.startsWith(tmp + path.sep);
}

function assertPackageStoreDirAllowed(packageDir) {
  const resolved = path.resolve(String(packageDir || ""));
  const cfgDir = path.resolve(packageDirFromConfig());
  if (resolved === cfgDir) return resolved;
  if (isUnderTmpDir(resolved)) return resolved;
  const e = new Error("仅允许操作当前配置的资料目录，或系统临时目录下的演示资料。");
  e.code = "package_dir_not_allowed";
  throw e;
}

function tryRecoverConfiguredPackageStore() {
  try {
    const dir = packageDirFromConfig();
    if (!dir || !fs.existsSync(dir)) return null;
    const store = new PackageStore({ packageDir: dir, ownerId: "app:recover" });
    return store.recover();
  } catch (e) {
    console.warn("[package-store] recover skipped:", e && (e.code || e.message));
    return null;
  }
}

ipcMain.handle("package:load", () => {
  const dir = packageDirFromConfig();
  tryRecoverConfiguredPackageStore();
  life.ensureLifeScaffold(dir);
  policies.ensureBoundariesScaffold(dir);
  const manifestRaw = safeRead(path.join(dir, "manifest.json"));
  let manifest = {};
  try {
    manifest = JSON.parse(manifestRaw);
  } catch {}
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
    lifeSummary: life.summarizeLifeForPrompt(dir),
    boundariesSummary: policies.summarizeBoundariesForPrompt(dir),
  };
});

ipcMain.handle("life:getGraph", (_e, opts) => {
  const dir = packageDirFromConfig();
  return life.getLifeGraph(dir, opts || {});
});

ipcMain.handle("life:getCognition", () => {
  const dir = packageDirFromConfig();
  const pkg = {
    persona: safeRead(path.join(dir, "persona.md")),
    decisionFrameworks: safeRead(path.join(dir, "decision-frameworks.json")),
    longTermMemory: safeRead(path.join(dir, "memory", "long-term-memory.jsonl")),
  };
  const snap = life.getCognitionSnapshot(dir, pkg);
  const boundaries = policies.readBoundaries(dir);
  snap.boundaries = (boundaries.items || []).filter((b) => b.enabled !== false).slice(0, 20);
  snap.gaps = life.buildCoverageGaps(dir, {
    ...pkg,
    boundariesCount: snap.boundaries.length,
  });
  return snap;
});

ipcMain.handle("life:updateInference", (_e, payload) => {
  const dir = packageDirFromConfig();
  return life.updateInference(dir, payload || {});
});

ipcMain.handle("life:updatePerson", (_e, payload) => {
  const dir = packageDirFromConfig();
  return life.updatePerson(dir, payload || {});
});

ipcMain.handle("life:updateMindHook", (_e, payload) => {
  const dir = packageDirFromConfig();
  return life.updateMindHook(dir, payload || {});
});

ipcMain.handle("life:distillMindHooks", async (e) => {
  const dir = packageDirFromConfig();
  const hooks = life.listPendingMindHooks(dir);
  if (!hooks.length) throw new Error("没有待蒸馏的观念线索。可先从材料提取，或去「观念与表达」直接导入。");
  const text =
    "以下是从本人材料中抽出的观念/原则线索，请据此蒸馏人格与判断相关条目：\n\n" +
    hooks.map((h, i) => `${i + 1}. ${h.text}`).join("\n");
  life.markMindHooksStatus(
    dir,
    hooks.map((h) => h.id),
    "in_review"
  );
  const res = await distillFromText(e, text, null, {
    fileName: "观念线索合集",
    skipFinalDone: false,
  });
  return {
    materialKind: "persona",
    agg: res.agg,
    meta: {
      ...(res.meta || {}),
      fileName: "观念线索合集",
      hookIds: hooks.map((h) => h.id),
      fromMindHooks: true,
    },
  };
});

/** Distill mind hooks and write all results without extra review (少决策). */
ipcMain.handle("life:applyMindHooks", async (e) => {
  const dir = packageDirFromConfig();
  const hooks = life.listPendingMindHooks(dir);
  if (!hooks.length) return { ok: false, error: "没有待写入的观念线索" };
  const text =
    "以下是从本人材料中抽出的观念/原则线索，请据此蒸馏人格与判断相关条目：\n\n" +
    hooks.map((h, i) => `${i + 1}. ${h.text}`).join("\n");
  life.markMindHooksStatus(
    dir,
    hooks.map((h) => h.id),
    "in_review"
  );
  const res = await distillFromText(e, text, null, {
    fileName: "观念线索合集",
    skipFinalDone: true,
  });
  const agg = res.agg || {};
  const sourceMeta = {
    id: "src_mindhooks_" + Date.now().toString(36),
    type: "mind_hooks",
    title: "观念线索合集",
    author: "",
    createdAt: new Date().toISOString(),
    location: "",
    sensitivity: "private",
    usedFor: ["style-guide", "persona", "decision-frameworks", "long-term-memory"],
    materialKind: "persona",
  };
  const written = builder.writeBack(dir, agg, sourceMeta);
  life.markMindHooksStatus(
    dir,
    hooks.map((h) => h.id),
    "distilled"
  );
  e.sender.send("builder:progress", { phase: "done", agg, materialKind: "persona" });
  return { ok: true, written, hookCount: hooks.length };
});

ipcMain.handle("life:markMindHooksDistilled", (_e, ids) => {
  const dir = packageDirFromConfig();
  const n = life.markMindHooksStatus(dir, ids || [], "distilled");
  return { ok: true, count: n };
});

ipcMain.handle("life:generateCognitionReport", async () => {
  const cfg = readConfig();
  if (!cfg.apiKey) throw new Error("还没有连接智能引擎。请打开设置，填好密钥后再试。");
  const dir = packageDirFromConfig();
  const pkg = {
    persona: safeRead(path.join(dir, "persona.md")),
    decisionFrameworks: safeRead(path.join(dir, "decision-frameworks.json")),
    longTermMemory: safeRead(path.join(dir, "memory", "long-term-memory.jsonl")),
  };
  const snap = life.getCognitionSnapshot(dir, pkg);
  const boundaries = policies.readBoundaries(dir);
  snap.boundaries = (boundaries.items || []).filter((b) => b.enabled !== false).slice(0, 20);
  const content = await callModel(cfg, life.buildCognitionReportPrompt(snap), { temperature: 0.35 });
  const item = library.upsertDeliverable(app.getPath("userData"), {
    type: "report",
    title: "自我认知简报 · " + new Date().toISOString().slice(0, 10),
    status: "draft",
    content: String(content || "").trim(),
    formats: ["md", "docx"],
    evidenceRefs: ["life/cognition"],
  });
  return { ok: true, item };
});

ipcMain.handle("life:upsertPerson", (_e, payload) => {
  const dir = packageDirFromConfig();
  const added = life.appendPeople(dir, [payload || {}], "manual");
  return { ok: added > 0, people: life.readSlice(dir, "people") };
});

ipcMain.handle("life:upsertEvent", (_e, payload) => {
  const dir = packageDirFromConfig();
  return life.upsertEvent(dir, payload || {});
});

ipcMain.handle("life:deleteEvent", (_e, id) => {
  const dir = packageDirFromConfig();
  return life.deleteEvent(dir, id);
});

ipcMain.handle("policies:getBoundaries", () => {
  const dir = packageDirFromConfig();
  return policies.readBoundaries(dir);
});

ipcMain.handle("policies:addBoundary", (_e, payload) => {
  const dir = packageDirFromConfig();
  return policies.addBoundary(dir, payload || {});
});

ipcMain.handle("policies:updateBoundary", (_e, payload) => {
  const dir = packageDirFromConfig();
  return policies.updateBoundary(dir, payload || {});
});

ipcMain.handle("policies:removeBoundary", (_e, payload) => {
  const dir = packageDirFromConfig();
  const id = typeof payload === "string" ? payload : payload && payload.id;
  const confirmed = typeof payload === "object" && payload && payload.confirmed;
  return policies.removeBoundary(dir, id, { confirmed });
});

ipcMain.handle("policies:restoreDefaults", (_e, payload) => {
  const dir = packageDirFromConfig();
  return policies.restoreSystemDefaults(dir, payload || {});
});

// Assemble the "像我" system prompt from the package.
function buildSystemPrompt(pkg) {
  const parts = [];
  const now = new Date();
  const dateLine = now.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  parts.push(
    "## 时间基准\n\n今天是 " +
      dateLine +
      "（" +
      now.toISOString().slice(0, 10) +
      "）。凡涉及「今年 / 未来 N 个月 / 近期 / 最新」等时间推断，一律以此日期为准，不要臆测或沿用训练数据里的旧日期。"
  );
  if (pkg.systemPrompt) parts.push(pkg.systemPrompt);
  if (pkg.persona) parts.push("## 人格卡\n\n" + pkg.persona);
  if (pkg.styleGuide) parts.push("## 表达风格\n\n" + pkg.styleGuide);
  if (pkg.boundariesSummary) parts.push(pkg.boundariesSummary);
  if (pkg.lifeSummary) parts.push(pkg.lifeSummary);
  if (pkg.decisionFrameworks)
    parts.push("## 判断框架（JSON）\n\n" + pkg.decisionFrameworks);
  if (pkg.longTermMemory)
    parts.push("## 长期记忆（每行一条 JSON）\n\n" + pkg.longTermMemory);
  return parts.join("\n\n---\n\n");
}

// ---------- Model gateway (OpenAI-compatible chat completions) ----------
const REPLACEMENT_CHAR = "\uFFFD";

function hasBadChars(text) {
  return String(text || "").includes(REPLACEMENT_CHAR);
}

function callModel(cfg, messages, options = {}) {
  return callModelRaw(cfg, messages, options).then((msg) => msg.content || "(空响应)");
}

/** Streaming chat completions; onDelta(textChunk); returns full content. Supports AbortSignal via options.signal. */
function callModelStream(cfg, messages, onDelta, options = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(cfg.baseURL.replace(/\/$/, "") + "/chat/completions");
    } catch (e) {
      return reject(new Error("连接地址无效，请在设置里检查。"));
    }
    const bodyObj = {
      model: cfg.model,
      messages,
      temperature: options.temperature ?? 0.7,
      stream: true,
    };
    const body = JSON.stringify(bodyObj);
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
        let buf = "";
        let full = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          if (options.signal?.aborted) {
            req.destroy();
            return;
          }
          buf += chunk;
          const parts = buf.split("\n");
          buf = parts.pop() || "";
          for (const line of parts) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const data = t.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta?.content || "";
              if (delta) {
                full += delta;
                onDelta(delta, full);
              }
            } catch {}
          }
        });
        res.on("end", () => {
          if (options.signal?.aborted) return reject(Object.assign(new Error("已停止"), { aborted: true }));
          if (!full) return reject(new Error("没有收到回复，请稍后再试。"));
          resolve(full);
        });
      }
    );
    if (options.signal) {
      options.signal.addEventListener("abort", () => {
        req.destroy();
        reject(Object.assign(new Error("已停止"), { aborted: true }));
      });
    }
    req.on("error", (err) => {
      if (options.signal?.aborted) reject(Object.assign(new Error("已停止"), { aborted: true }));
      else reject(err);
    });
    req.write(body);
    req.end();
  });
}

const activeChatAborts = new Map();

function friendlyToolLabel(toolName, extId) {
  const n = String(toolName || "").toLowerCase();
  const e = String(extId || "").toLowerCase();
  if (n.includes("fetch") || e === "fetch") return "正在阅读网页";
  if (n.includes("read") || n.includes("file") || e === "filesystem") return "正在查阅本地文件";
  if (n.includes("search") || e.includes("brave")) return "正在检索信息";
  if (e === "memory") return "正在查阅知识记忆";
  return "正在使用已连接的能力";
}

function callModelRaw(cfg, messages, options = {}) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(cfg.baseURL.replace(/\/$/, "") + "/chat/completions");
    } catch (e) {
      return reject(new Error("baseURL 无效：" + cfg.baseURL));
    }
    const bodyObj = {
      model: cfg.model,
      messages,
      temperature: options.temperature ?? 0.7,
    };
    if (options.tools?.length) {
      bodyObj.tools = options.tools.map((t) => ({
        type: t.type,
        function: t.function,
      }));
      bodyObj.tool_choice = options.tool_choice || "auto";
    }
    const body = JSON.stringify(bodyObj);
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
            const msg = json.choices?.[0]?.message;
            if (!msg) return reject(new Error("模型返回格式异常"));
            resolve(msg);
          } catch (e) {
            const raw = Buffer.concat(chunks).toString("utf8");
            reject(new Error("解析响应失败：" + raw.slice(0, 300)));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function getChatToolsModule() {
  return import("./capabilities/chat-tools.mjs");
}

async function runChatWithConnectedTools(cfg, system, history, em, progressFn) {
  const chatTools = await getChatToolsModule();
  const enabled = getCapabilityExtensions();
  await chatTools.ensureEnabledExtensionsConnected(em, enabled);
  const toolEntries = await chatTools.collectConnectedToolEntries(em, enabled);
  if (!toolEntries.length) {
    return { reply: null, toolEntries, usedTools: false, messages: null };
  }

  system += chatTools.buildCapabilitiesSystemAppend(toolEntries);
  const openAiTools = toolEntries.map((t) => chatTools.mcpToolToOpenAI(t.extensionId, t));
  const toolMap = new Map(openAiTools.map((t) => [t.function.name, t._meta]));

  let messages = [{ role: "system", content: system }, ...history];
  const maxRounds = 6;
  const notify = typeof progressFn === "function" ? progressFn : () => {};

  for (let round = 0; round < maxRounds; round++) {
    let msg;
    try {
      msg = await callModelRaw(cfg, messages, { tools: openAiTools });
    } catch (e) {
      const lastUser = [...history].reverse().find((m) => m.role === "user");
      const fallback = await tryHeuristicFetch(cfg, system, history, em, lastUser?.content);
      if (fallback) return { reply: fallback, toolEntries, usedTools: true, fallback: true, messages: null };
      throw e;
    }

    const openAiToolCalls = msg.tool_calls || [];
    const dsmlCalls = !openAiToolCalls.length && msg.content ? parseDsmlToolCalls(msg.content) : [];
    const toolCalls = openAiToolCalls.length ? openAiToolCalls : dsmlCalls;
    if (!toolCalls.length) {
      const cleaned = stripToolLeakage(msg.content || "");
      return {
        reply: cleaned || "(空响应)",
        toolEntries,
        usedTools: round > 0,
        messages: round > 0 ? messages.concat([{ role: "assistant", content: cleaned || "" }]) : null,
        finalMessages: messages,
        needsStream: false,
        assistantContent: cleaned || "",
      };
    }

    // If model leaked DSML in content, keep a short note only (not the protocol)
    const visibleNote = stripToolLeakage(msg.content || "") || null;
    messages.push({
      role: "assistant",
      content: openAiToolCalls.length ? msg.content || null : visibleNote,
      tool_calls: toolCalls,
    });

    for (const tc of toolCalls) {
      const fn = tc.function || {};
      const meta = toolMap.get(fn.name);
      let args = {};
      try {
        args = JSON.parse(fn.arguments || "{}");
      } catch {}
      notify({
        phase: "tool",
        label: friendlyToolLabel(meta?.toolName || fn.name, meta?.extensionId),
        detail: meta?.toolName || fn.name,
      });
      let resultText;
      try {
        if (!meta) throw new Error("未知工具：" + fn.name);
        const result = await em.callTool(meta.extensionId, meta.toolName, args);
        resultText = chatTools.formatToolResult(result).slice(0, 14000);
      } catch (err) {
        resultText = "未能完成：" + err.message;
      }
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: resultText,
      });
    }
  }

  // After tool rounds, let caller stream the final answer
  return {
    reply: null,
    toolEntries,
    usedTools: true,
    finalMessages: messages,
    needsStream: true,
  };
}

async function tryHeuristicFetch(cfg, system, history, em, userText) {
  const chatTools = await getChatToolsModule();
  const urls = chatTools.extractUrls(userText);
  if (!urls.length) return null;
  const st = em.getSessionStatus().find((s) => s.id === "fetch" && s.status === "connected");
  if (!st) return null;

  const chunks = [];
  for (const url of urls.slice(0, 2)) {
    try {
      const result = await em.callTool("fetch", "fetch_markdown", { url });
      chunks.push(`### ${url}\n${chatTools.formatToolResult(result).slice(0, 8000)}`);
    } catch (e) {
      chunks.push(`### ${url}\n抓取失败：${e.message}`);
    }
  }
  if (!chunks.length) return null;

  const augmented = system + "\n\n---\n\n## 已抓取的网页内容\n\n" + chunks.join("\n\n");
  const messages = [{ role: "system", content: augmented }, ...history];
  return callModel(cfg, messages);
}

ipcMain.handle("chat:send", async (e, { pkg, history, requestId, attachmentContext, scenarioHint }) => {
  const cfg = readConfig();
  if (!cfg.apiKey) throw new Error("还没有连接智能引擎。请打开设置，填好密钥后再试。");
  let system = buildSystemPrompt(pkg);
  system +=
    "\n\n---\n\n## 产出方式（必须遵守）\n\n" +
    "1）普通问答、解释、澄清、追问：把完整回答写在对话里，不要只用「请看右侧」搪塞。\n" +
    "2）仅当用户明确要求撰写较长成稿（简历、报告、请示、方案、备忘录、提纲等）时：\n" +
    "   - 对话里先用几句话说明做了什么；\n" +
    "   - 再把完整成稿放在 ```markdown 代码块中（供右侧「成稿预览」导出）。\n" +
    "3）若用户附上了材料正文，必须基于材料作答；禁止声称无法打开或无法读取附件；禁止编造材料中没有的日期与事实。\n" +
    "4）禁止声称「已保存到某目录 / 已写入文件」——文件由应用自动保存或用户导出。\n" +
    "5）```markdown 代码块里必须是成稿正文（如简历全文），禁止把下载说明、文件列表、打开方式放进代码块或当成成稿。";
  if (scenarioHint && String(scenarioHint).trim()) {
    system += "\n\n---\n\n## 当前场景约定\n\n" + String(scenarioHint).trim();
  }
  if (attachmentContext) {
    system +=
      "\n\n---\n\n## 用户本轮附带的材料（正文已提取，请直接使用）\n\n" +
      String(attachmentContext).slice(0, 80000);
  }

  const dir = cfg.packageDir || DEFAULT_PACKAGE_DIR;
  const lastUser = [...(history || [])].reverse().find((m) => m.role === "user");
  const evidence = [];
  if (lastUser && lastUser.content) {
    try {
      const result = retrieval.retrieve(dir, lastUser.content);
      const ctx = retrieval.renderContext(result);
      if (ctx) system += "\n\n---\n\n" + ctx;
      if (result?.memories?.length || result?.frameworks?.length) {
        for (const m of result.memories || []) {
          evidence.push({ type: "memory", summary: String(m.text || "").slice(0, 120) });
        }
        for (const f of result.frameworks || []) {
          evidence.push({ type: "framework", summary: String(f.name || f.text || "").slice(0, 120) });
        }
      }
    } catch {}
  }

  const rid = requestId || "req_" + Date.now();
  const ac = new AbortController();
  activeChatAborts.set(rid, ac);
  const sendProg = (payload) => {
    try {
      e.sender.send("chat:progress", { requestId: rid, ...payload });
    } catch {}
  };

  let reply = "";
  let meta = { capabilitiesUsed: [], usedTools: false, evidence, requestId: rid };
  let streamMessages = [{ role: "system", content: system }, ...(history || [])];

  try {
    sendProg({ phase: "thinking", label: "正在思考…" });
    try {
      const em = await getExtensionManager();
      const toolRun = await runChatWithConnectedTools(cfg, system, history, em, (p) =>
        sendProg(p)
      );
      if (toolRun.usedTools) meta.usedTools = true;
      meta.capabilitiesUsed = [...new Set((toolRun.toolEntries || []).map((t) => t.extensionId))];
      if (toolRun.needsStream && toolRun.finalMessages) {
        streamMessages = toolRun.finalMessages;
        sendProg({ phase: "writing", label: "正在整理回复…" });
        reply = await callModelStream(
          cfg,
          streamMessages,
          (delta, full) =>
            sendProg({ phase: "delta", delta, full: stripToolLeakage(full) }),
          { signal: ac.signal }
        );
      } else if (toolRun.reply != null) {
        reply = stripToolLeakage(toolRun.reply);
        // Simulate streaming for UI consistency when tools returned final text
        sendProg({ phase: "delta", delta: reply, full: reply });
      }
    } catch (toolErr) {
      if (toolErr.aborted) throw toolErr;
      // fall through to plain stream
    }

    if (!reply) {
      sendProg({ phase: "writing", label: "正在回复…" });
      reply = await callModelStream(
        cfg,
        streamMessages,
        (delta, full) =>
          sendProg({ phase: "delta", delta, full: stripToolLeakage(full) }),
        { signal: ac.signal }
      );
    }

    let rawReply = reply;
    reply = stripToolLeakage(reply);
    if (!reply && hasDsmlToolMarkup(rawReply)) {
      reply =
        "刚才尝试查阅外部网页，但没有整理成可读说明。请再试一次；或把链接手动添加到「参考材料」后再问。";
    }
    if (hasBadChars(reply)) throw new Error("回复里出现乱码，请再试一次，或在设置里换一个引擎。");
    const userQuestion = String(lastUser?.content || "").split("\n---\n")[0].trim();
    let split = documentOutput.splitReplyForCanvas(reply, { userQuestion });
    if (
      (!split.artifact || documentOutput.isMetaNoise(split.artifact.content)) &&
      shouldRecoverFromWorkspace(userQuestion, reply)
    ) {
      const recovered = recoverArtifactFromWorkspace(reply, userQuestion);
      if (recovered) {
        split = {
          chat:
            (documentOutput.isMetaNoise(split.chat) ? "" : split.chat) ||
            "已找到本机成稿正文，已放入右侧「成稿预览」。请用「导出 Word」在 WPS 中打开（宋体/雅黑）。",
          artifact: recovered,
        };
      } else if (split.artifact && documentOutput.isMetaNoise(split.artifact.content)) {
        split = { chat: reply, artifact: null };
      }
    }
    // Never keep a resume artifact for a non-resume writing task
    if (
      split.artifact &&
      documentOutput.looksLikeResumeBody(split.artifact.content) &&
      /报告|请示|方案|备忘录|提纲|降雨|气候/.test(userQuestion) &&
      !/简历/.test(userQuestion)
    ) {
      split = { chat: reply || split.chat, artifact: null };
    }
    let savedInfo = null;
    if (split.artifact) {
      try {
        savedInfo = saveArtifactToDisk(split.artifact);
        if (savedInfo) {
          split.artifact.savedPath = savedInfo.docxPath || savedInfo.mdPath;
          split.artifact.savedMdPath = savedInfo.mdPath;
          split.artifact.savedDocxPath = savedInfo.docxPath;
        }
      } catch {
        savedInfo = null;
      }
    }
    let chatOut = split.chat;
    if (savedInfo) {
      chatOut +=
        "\n\n——\n已自动保存到本机「成稿」文件夹：\n" +
        (savedInfo.docxPath ? "Word（推荐用 WPS 打开）：" + savedInfo.docxPath + "\n" : "") +
        (savedInfo.mdPath ? "Markdown：" + savedInfo.mdPath + "\n" : "") +
        "也可在右侧「成稿预览」再导出。";
    }
    sendProg({ phase: "done" });
    return {
      reply: chatOut,
      fullReply: reply,
      meta,
      artifact: split.artifact,
      savedPath: savedInfo && (savedInfo.docxPath || savedInfo.mdPath),
    };
  } catch (err) {
    if (err.aborted) {
      sendProg({ phase: "stopped" });
      const userQuestion = String(lastUser?.content || "").split("\n---\n")[0].trim();
      const split = documentOutput.splitReplyForCanvas(reply || "", { userQuestion });
      return {
        reply: split.chat || reply || "",
        fullReply: reply || "",
        meta: { ...meta, stopped: true },
        artifact: split.artifact,
      };
    }
    sendProg({ phase: "error", message: err.message });
    throw new Error(err.message || "暂时没办成，请稍后再试。");
  } finally {
    activeChatAborts.delete(rid);
  }
});

ipcMain.handle("chat:stop", async (_e, { requestId }) => {
  const ac = activeChatAborts.get(requestId);
  if (ac) ac.abort();
  return { ok: true };
});

ipcMain.handle("chat:pickAttachments", async () => {
  const res = await dialog.showOpenDialog({
    title: "添加材料",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "常用材料",
        extensions: ["docx", "pdf", "pptx", "txt", "md", "markdown", "png", "jpg", "jpeg", "webp", "gif"],
      },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  if (res.canceled || !res.filePaths.length) return [];
  const out = [];
  for (const filePath of res.filePaths.slice(0, 5)) {
    const ext = path.extname(filePath).toLowerCase();
    const name = path.basename(filePath);
    const isImage = [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext);
    let text = "";
    let note = "";
    let ok = false;
    let chars = 0;
    try {
      if (isImage) {
        note = "图片已附上（请用文字说明要点）";
        text = `[图片附件] ${name}\n路径：${filePath}`;
        ok = true;
      } else {
        text = await builder.extractText(filePath);
        text = String(text || "")
          .replace(/\n--\s*\d+\s+of\s+\d+\s*--\n/gi, "\n")
          .trim();
        if (!text) throw new Error("未提取到可读文字（若是扫描件，需先转成可选中文字的 PDF）");
        chars = text.length;
        if (text.length > 40000) {
          text = text.slice(0, 40000) + "\n\n…（后文已省略，共约 " + chars + " 字）";
        }
        note = "已读入约 " + chars + " 字";
        ok = true;
      }
    } catch (err) {
      note = "未能读入：" + (err.message || "未知原因");
      text = "";
      ok = false;
    }
    out.push({
      id: "att_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1000),
      name,
      path: filePath,
      ext,
      isImage,
      text,
      note,
      ok,
      chars,
    });
  }
  return out;
});

ipcMain.handle("sessions:list", async () => sessions.listSessions(app.getPath("userData")));
ipcMain.handle("sessions:get", async (_e, id) => sessions.getSession(app.getPath("userData"), id));
ipcMain.handle("sessions:create", async (_e, opts) => {
  const cfg = readConfig();
  return sessions.createSession(app.getPath("userData"), {
    title: opts?.title,
    packagePath: cfg.packageDir || DEFAULT_PACKAGE_DIR,
  });
});
ipcMain.handle("sessions:save", async (_e, session) =>
  sessions.saveSession(app.getPath("userData"), session)
);
ipcMain.handle("sessions:rename", async (_e, { id, title }) =>
  sessions.renameSession(app.getPath("userData"), id, title)
);
ipcMain.handle("sessions:delete", async (_e, id) =>
  sessions.deleteSession(app.getPath("userData"), id)
);
ipcMain.handle("sessions:setActive", async (_e, id) =>
  sessions.setActive(app.getPath("userData"), id)
);

ipcMain.handle("output:exportMarkdown", async (_e, { title, content }) => {
  const safe = safeFileStem(title);
  const res = await dialog.showSaveDialog({
    title: "保存为 Markdown",
    defaultPath: path.join(draftsDir(), safe + ".md"),
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  fs.writeFileSync(res.filePath, content || "", "utf8");
  return { canceled: false, filePath: res.filePath };
});

ipcMain.handle("output:exportDocx", async (_e, { title, content }) => {
  const safe = safeFileStem(title);
  const buf = documentOutput.buildDocxFromMarkdown(content || "", title || "成稿");
  const res = await dialog.showSaveDialog({
    title: "保存为 Word 文档",
    defaultPath: path.join(draftsDir(), safe + ".docx"),
    filters: [{ name: "Word", extensions: ["docx"] }],
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  fs.writeFileSync(res.filePath, buf);
  return { canceled: false, filePath: res.filePath };
});

ipcMain.handle("output:openDraftsFolder", async () => {
  const dir = draftsDir();
  const { shell } = require("electron");
  await shell.openPath(dir);
  return { path: dir };
});

ipcMain.handle("output:getDraftsDir", async () => ({ path: draftsDir() }));

ipcMain.handle("library:list", async () => library.listDeliverables(app.getPath("userData")));
ipcMain.handle("library:get", async (_e, id) => library.getDeliverable(app.getPath("userData"), id));
ipcMain.handle("library:save", async (_e, item) =>
  library.upsertDeliverable(app.getPath("userData"), item || {})
);
ipcMain.handle("library:delete", async (_e, id) =>
  library.deleteDeliverable(app.getPath("userData"), id)
);
ipcMain.handle("library:templates", async () => library.getTemplates());
ipcMain.handle("library:scenarioPacks", async () => library.getScenarioPacks());

// Research notebooks (ResearchNotebook; legacy IPC names kept)
ipcMain.handle("research:list", async () => researchProjects.listProjects(app.getPath("userData")));
ipcMain.handle("research:get", async (_e, id) => researchProjects.getProject(app.getPath("userData"), id));
ipcMain.handle("research:active", async () => researchProjects.getActiveProject(app.getPath("userData")));
ipcMain.handle("research:create", async (_e, payload) => {
  const cfg = readConfig();
  return researchProjects.createProject(app.getPath("userData"), {
    ...(payload || {}),
    packageRef: cfg.packageDir || DEFAULT_PACKAGE_DIR,
  });
});
ipcMain.handle("research:save", async (_e, item) => researchProjects.saveProject(app.getPath("userData"), item || {}));
ipcMain.handle("research:delete", async (_e, id) => researchProjects.deleteProject(app.getPath("userData"), id));
ipcMain.handle("research:setActive", async (_e, id) => researchProjects.setActiveProject(app.getPath("userData"), id));
ipcMain.handle("research:setStage", async (_e, payload) => {
  const progress = payload.progress || payload.stage;
  return researchProjects.setProgress(app.getPath("userData"), payload.id, progress);
});
ipcMain.handle("research:setProgress", async (_e, payload) =>
  researchProjects.setProgress(app.getPath("userData"), payload.id, payload.progress)
);
ipcMain.handle("research:addMaterial", async (_e, payload) =>
  researchProjects.addSource(app.getPath("userData"), payload.id, payload.material || payload.source || {})
);
ipcMain.handle("research:addSource", async (_e, payload) =>
  researchProjects.addSource(app.getPath("userData"), payload.id, payload.source || {})
);
ipcMain.handle("research:removeMaterial", async (_e, payload) =>
  researchProjects.removeSource(app.getPath("userData"), payload.id, payload.materialId || payload.sourceId)
);
ipcMain.handle("research:removeSource", async (_e, payload) =>
  researchProjects.removeSource(app.getPath("userData"), payload.id, payload.sourceId)
);
ipcMain.handle("research:addArtifact", async (_e, payload) =>
  researchProjects.addArtifact(app.getPath("userData"), payload.id, payload.artifact || {})
);
ipcMain.handle("research:removeArtifact", async (_e, payload) =>
  researchProjects.removeArtifact(app.getPath("userData"), payload.id, payload.artifactId)
);
ipcMain.handle("research:runCheck", async (_e, payload) =>
  researchProjects.runChecks(app.getPath("userData"), payload.id, payload.kind)
);
ipcMain.handle("research:runClaimAudit", async (_e, payload) =>
  researchProjects.runClaimAudit(app.getPath("userData"), payload.id)
);
ipcMain.handle("research:stages", async () => researchProjects.getProgressSteps());
ipcMain.handle("research:progressSteps", async () => researchProjects.getProgressSteps());
ipcMain.handle("research:methodPacks", async () => researchProjects.getAllActions());
ipcMain.handle("research:sourceActions", async () => researchProjects.getAllActions());
ipcMain.handle("research:discoveryActions", async () => researchProjects.getDiscoveryActions());

async function ensureExtensionConnected(cid) {
  const item = catalog.getById(cid);
  if (!item) return { id: cid, ok: false, message: "目录中无此项" };
  const existing = getCapabilityExtensions().find((e) => e.id === cid);
  const hasConfiguredKey =
    existing &&
    existing.envConfigured &&
    Object.values(existing.envConfigured).some(Boolean);
  if (item.needsKey && !hasConfiguredKey) {
    return { id: cid, name: item.name, ok: false, skipped: true, message: "需在「能力」页配置密钥后启用" };
  }
  try {
    let ext = existing;
    if (!ext) {
      const built = buildExtensionFromCatalog(item, { params: {}, env: {} });
      const publicBuilt = getConfigSecrets().sanitizeExtension(
        { ...built, env: undefined, envKeyNames: (item.envKeys || []).map((ek) => ek.key) },
        getConfigSecrets().secretStore
      );
      const list = getCapabilityExtensions().filter((e) => e.id !== publicBuilt.id);
      list.push(publicBuilt);
      saveCapabilityExtensions(list);
      ext = publicBuilt;
    }
    const em = await getExtensionManager();
    await em.connectExtension(getConfigSecrets().hydrateExtensionEnv(ext));
    return { id: cid, name: item.name, ok: true, connected: true };
  } catch (e) {
    return { id: cid, name: item.name, ok: false, message: e.message || String(e) };
  }
}

async function enrichSearchHitsWithFetch(em, hits, limit = 3) {
  const st = em.getSessionStatus().find((s) => s.id === "fetch" && s.status === "connected");
  if (!st || !Array.isArray(hits)) return hits;
  const chatTools = await getChatToolsModule();
  const out = hits.map((h) => ({ ...h }));
  for (let i = 0; i < Math.min(limit, out.length); i++) {
    const url = String(out[i].url || "").trim();
    if (!url.startsWith("http")) continue;
    try {
      const result = await em.callTool("fetch", "fetch_markdown", { url });
      const text = researchProjects.sanitizeExcerpt(chatTools.formatToolResult(result), 3500);
      if (text && text.length > 80) out[i].snippet = text;
      out[i].fetched = true;
    } catch {
      // keep search snippet
    }
  }
  return out;
}

ipcMain.handle("research:prepareScene", async () => {
  personalSkills.ensurePresetResearchSkills(app.getPath("userData"));
  const results = [];
  for (const cid of researchWebSearch.RESEARCH_DEFAULT_EXTENSIONS) {
    results.push(await ensureExtensionConnected(cid));
  }
  const ready = results.filter((r) => r.ok).map((r) => r.name || r.id);
  const skipped = results.filter((r) => r.skipped);
  let message = ready.length ? "研究能力已就绪：" + ready.join("、") + "。" : "";
  if (skipped.length) {
    message +=
      (message ? " " : "") +
      "未配置联网搜索密钥时将使用内置搜索；" +
      "在「能力」启用 Brave 搜索可获得更好结果。";
  }
  if (!message) message = "将使用内置搜索；可在「能力」中启用网页抓取与联网搜索。";
  return { results, message, fallbackSearch: true };
});

ipcMain.handle("research:discoverSources", async (_e, payload) => {
  const id = payload && payload.id;
  const query = String((payload && payload.query) || "").trim();
  if (!id) throw new Error("请指定研究项。");
  if (!query) throw new Error("请提供搜索关键词。");
  const item = researchProjects.getProject(app.getPath("userData"), id);
  if (!item) throw new Error("研究空间不存在。");
  await ensureExtensionConnected("fetch");
  const bravePrep = await ensureExtensionConnected("brave-search");
  const em = await getExtensionManager();
  const { provider, results } = await researchWebSearch.searchWeb(em, query);
  const enriched = await enrichSearchHitsWithFetch(em, results, 3);
  const { project, added } = researchProjects.addSourcesFromSearch(app.getPath("userData"), id, enriched);
  return {
    query,
    provider,
    braveConfigured: !!bravePrep.ok,
    results: enriched,
    added,
    project,
    message:
      added > 0
        ? `已从${provider === "brave" ? "联网搜索" : "内置搜索"}添加 ${added} 条参考材料。`
        : "检索完成，未发现可添加的新材料（可能已存在或结果为空）。",
  };
});

ipcMain.handle("research:runAgentLoop", async (e, payload) => {
  const cfg = readConfig();
  if (!cfg.apiKey) throw new Error("还没有连接智能引擎。请打开设置，填好密钥后再试。");
  const id = payload && payload.id;
  const question = String((payload && payload.question) || "").trim();
  if (!id) throw new Error("请指定研究项。");
  if (!question) throw new Error("请提供研究问题。");
  const item = researchProjects.getProject(app.getPath("userData"), id);
  if (!item) throw new Error("研究空间不存在。");
  const rid = (payload && payload.requestId) || "rag_" + Date.now();
  const sendProg = (p) => {
    try {
      e.sender.send("research:progress", { requestId: rid, ...p });
    } catch {}
  };
  personalSkills.ensurePresetResearchSkills(app.getPath("userData"));
  let pkg = {};
  try {
    const dir = cfg.packageDir || DEFAULT_PACKAGE_DIR;
    pkg = {
      systemPrompt: safeRead(path.join(dir, "prompts", "system-prompt.md")),
      persona: safeRead(path.join(dir, "persona.md")),
      styleGuide: safeRead(path.join(dir, "style-guide.md")),
    };
  } catch {}
  const scenarioHint =
    String(payload.scenarioHint || "").trim() ||
    researchGrounded.buildGroundedSystemAppend(item) +
      " 当前执行四步调研：澄清→检索→读源→成果稿。";
  const chatTools = await getChatToolsModule();
  const result = await researchAgentLoop.runResearchAgentLoop({
    userData: app.getPath("userData"),
    projectId: id,
    question,
    onProgress: sendProg,
    callModel,
    cfg,
    projects: researchProjects,
    webSearch: researchWebSearch,
    ensureExtensionConnected,
    enrichSearchHitsWithFetch,
    getExtensionManager,
    formatToolResult: chatTools.formatToolResult,
    scenarioHint,
  });
  sendProg({ step: "done", phase: "done", label: "调研完成" });
  return { ...result, requestId: rid };
});

ipcMain.handle("research:addLocalSource", async (_e, payload) => {
  const id = payload && payload.id;
  if (!id) throw new Error("请指定研究项。");
  const res = await dialog.showOpenDialog({
    title: "选择本地文件作为参考材料",
    properties: ["openFile"],
    filters: [
      { name: "文档", extensions: ["docx", "txt", "md", "markdown", "pdf", "pptx"] },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  if (res.canceled || !res.filePaths.length) return { canceled: true };
  const filePath = res.filePaths[0];
  let excerpt = "";
  try {
    excerpt = await builder.extractText(filePath);
  } catch (err) {
    throw new Error("无法读取文件：" + (err.message || err));
  }
  if (!excerpt || excerpt.trim().length < 20) {
    throw new Error("文件内容过短或无法提取正文，请换文件或手动粘贴摘录。");
  }
  const project = researchProjects.addLocalFileSource(app.getPath("userData"), id, {
    filePath,
    fileName: path.basename(filePath),
    title: path.basename(filePath, path.extname(filePath)),
    excerpt,
  });
  return { canceled: false, project, title: path.basename(filePath) };
});

ipcMain.handle("research:validateGrounded", async (_e, payload) => {
  const item = researchProjects.getProject(app.getPath("userData"), payload.id);
  if (!item) throw new Error("研究空间不存在。");
  return researchGrounded.validateGroundedContent(item, payload.text || "");
});

ipcMain.handle("research:prepareMethod", async (_e, packId) => {
  const pack = researchProjects.getSourceAction(packId);
  if (!pack) throw new Error("未知来源动作：" + packId);
  const results = [];
  for (const cid of pack.recommendedExtensions || []) {
    const prep = await ensureExtensionConnected(cid);
    results.push(prep);
  }
  return {
    pack,
    systemHint: pack.systemHint || "",
    results,
    message:
      "已为「" +
      pack.title +
      "」准备：" +
      (results.filter((r) => r.ok).map((r) => r.name || r.id).join("、") || "可直接基于来源集提问"),
  };
});
function researchDeliverToWriting(payload) {
  const item = researchProjects.getProject(app.getPath("userData"), payload.id);
  if (!item) throw new Error("研究空间不存在。");
  const hasSources = !!(item.sources || []).length;
  const mode =
    payload && payload.mode === "plan" ? "plan" : payload && payload.mode === "final" ? "final" : hasSources ? "final" : "plan";
  if (mode === "final" && hasSources && payload.draftContent) {
    const check = researchGrounded.validateGroundedExport(item, payload.draftContent);
    if (!check.ok) throw new Error(check.message);
  }
  if (mode === "plan") researchProjects.assertCanSendPlanToWriting(item);
  else researchProjects.assertCanSendToWriting(item);
  const content = payload.draftContent
    ? researchProjects.buildExportDeliverable(item, payload.draftContent)
    : researchProjects.buildWritingPayload(item);
  const cfg = readConfig();
  const dl = library.importFromArtifact(app.getPath("userData"), {
    id: mode === "final" ? item.deliverableId || undefined : undefined,
    title: researchProjects.getWritingExportTitle(item, mode === "plan" ? "plan" : "final"),
    content,
    type: "report",
    status: mode === "plan" ? "draft" : "ready",
    packageRef: cfg.packageDir || DEFAULT_PACKAGE_DIR,
  });
  if (mode === "final") {
    item.deliverableId = dl.id;
    item.progress = "write";
  }
  const saved = researchProjects.saveProject(app.getPath("userData"), item);
  return { deliverable: dl, project: saved, mode };
}
ipcMain.handle("research:exportFinal", async (_e, payload) => researchDeliverToWriting({ ...payload, mode: "final" }));
ipcMain.handle("research:sendToWriting", async (_e, payload) =>
  researchDeliverToWriting({ ...payload, mode: payload && payload.mode === "plan" ? "plan" : "final" })
);
ipcMain.handle("research:exportDeliverable", async (_e, payload) => {
  const item = researchProjects.getProject(app.getPath("userData"), payload.id);
  if (!item) throw new Error("研究空间不存在。");
  const content = researchProjects.buildExportDeliverable(item, payload.draftContent);
  const draftOnly = String(payload.draftContent || "").trim();
  const check = researchGrounded.validateGroundedExport(item, draftOnly || content);
  if (!check.ok) throw new Error(check.message);
  const title = item.question || "研究答复";
  const safe = safeFileStem(title);
  if (payload.format === "docx") {
    const buf = documentOutput.buildDocxFromMarkdown(content, title);
    const res = await dialog.showSaveDialog({
      title: "导出 Word（WPS 可开）",
      defaultPath: path.join(draftsDir(), safe + ".docx"),
      filters: [{ name: "Word", extensions: ["docx"] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    fs.writeFileSync(res.filePath, buf);
    return { canceled: false, filePath: res.filePath };
  }
  const res = await dialog.showSaveDialog({
    title: "导出文本",
    defaultPath: path.join(draftsDir(), safe + ".md"),
    filters: [{ name: "文本", extensions: ["md", "txt"] }],
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  fs.writeFileSync(res.filePath, content, "utf8");
  return { canceled: false, filePath: res.filePath };
});
ipcMain.handle("research:fetchSourceExcerpt", async (_e, payload) => {
  const url = String(payload.url || "").trim();
  if (!url) throw new Error("请提供链接。");
  const em = await getExtensionManager();
  const st = em.getSessionStatus().find((s) => s.id === "fetch" && s.status === "connected");
  if (!st) throw new Error("网页阅读能力尚未就绪。请先在「能力」中启用，或手动粘贴摘录。");
  const chatTools = await getChatToolsModule();
  const result = await em.callTool("fetch", "fetch_markdown", { url });
  const text = chatTools.formatToolResult(result).slice(0, 12000);
  if (!text || text.length < 20) throw new Error("未能读取该网页的有效内容。请手动添加材料。");
  return { excerpt: text, url };
});

// Personal skills
ipcMain.handle("skills:list", async (_e, scene) => personalSkills.listSkills(app.getPath("userData"), scene));
ipcMain.handle("skills:get", async (_e, id) => personalSkills.getSkill(app.getPath("userData"), id));
ipcMain.handle("skills:save", async (_e, skill) => personalSkills.saveSkill(app.getPath("userData"), skill || {}));
ipcMain.handle("skills:delete", async (_e, id) => personalSkills.deleteSkill(app.getPath("userData"), id));
ipcMain.handle("skills:setActive", async (_e, payload) => {
  const userData = app.getPath("userData");
  const scene = payload && payload.scene;
  const skillId = (payload && payload.skillId) || null;
  const result = personalSkills.setActiveSkill(userData, scene, skillId);
  const prepResults = [];
  if (skillId) {
    const skill = personalSkills.getSkill(userData, skillId);
    for (const cid of (skill && skill.recommendedExtensions) || []) {
      prepResults.push(await ensureExtensionConnected(cid));
    }
  }
  const ready = prepResults.filter((r) => r.ok).map((r) => r.name || r.id);
  const skipped = prepResults.filter((r) => r.skipped);
  const failed = prepResults.filter((r) => !r.ok && !r.skipped);
  let message = "";
  if (ready.length) message += "已为该 Skill 准备：" + ready.join("、") + "。";
  if (skipped.length) {
    message +=
      (message ? " " : "") +
      "需在「能力」配置后启用：" +
      skipped.map((s) => s.name || s.id).join("、") +
      "。";
  }
  if (failed.length) {
    message +=
      (message ? " " : "") +
      "未能就绪：" +
      failed.map((f) => (f.name || f.id) + "（" + (f.message || f.error || "失败") + "）").join("、") +
      "。";
  }
  return { ...result, prepResults, message };
});
ipcMain.handle("skills:getActive", async (_e, scene) => personalSkills.getActiveSkill(app.getPath("userData"), scene));
ipcMain.handle("skills:saveFromContext", async (_e, payload) =>
  personalSkills.saveFromContext(app.getPath("userData"), payload || {})
);

ipcMain.handle("code:prepareScene", async () => {
  personalSkills.ensurePresetCodeSkills(app.getPath("userData"));
  const results = [];
  for (const cid of ["filesystem"]) {
    results.push(await ensureExtensionConnected(cid));
  }
  const gh = await ensureExtensionConnected("github");
  results.push(gh);
  const ready = results.filter((r) => r.ok).map((r) => r.name || r.id);
  const skipped = results.filter((r) => r.skipped);
  let message = ready.length ? "编程能力已就绪：" + ready.join("、") + "。" : "";
  if (skipped.length) {
    message +=
      (message ? " " : "") +
      "GitHub 等需密钥的项请到「能力」配置；本地文件读写可先用于审阅与说明修改。";
  }
  if (!message) message = "请在「能力」启用本地文件读写后开始。";
  return { results, message };
});

ipcMain.handle("code:buildDelegationHint", async (_e, payload) => {
  const dir = packageDirFromConfig();
  const manifestRaw = (() => {
    try {
      return fs.existsSync(path.join(dir, "manifest.json"))
        ? fs.readFileSync(path.join(dir, "manifest.json"), "utf8")
        : "";
    } catch {
      return "";
    }
  })();
  let manifest = {};
  try {
    if (manifestRaw) manifest = JSON.parse(manifestRaw);
  } catch {
    manifest = {};
  }
  const pkg = { exists: !!manifestRaw, manifest };
  const writeAuthorized = !!(payload && payload.writeAuthorized);
  const workspaceLabel = (payload && payload.workspaceLabel) || "";
  const skill = personalSkills.getActiveSkill(app.getPath("userData"), "code");
  const ag = l0Agents.getActiveAgent(app.getPath("userData"));
  const control = l0Orchestration.buildControlBrief({
    writeAuthorized,
    workspaceLabel,
    scene: "code",
  });
  const persona = l0Orchestration.buildPersonaBrief(pkg);
  const sceneHint = l0Orchestration.buildCodeSceneHint({
    writeAuthorized,
    workspaceLabel,
    skillHint: (skill && skill.systemHint) || "",
    executorName: ag && ag.name,
  });
  return {
    scenarioHint: control + "\n" + persona + "\n\n" + sceneHint,
    trailHint: writeAuthorized ? "授权：可写" : "授权：只读",
    executor: ag ? { id: ag.id, name: ag.name, kind: ag.kind } : null,
  };
});

ipcMain.handle("l0:auditList", async (_e, opts) =>
  l0Audit.list(app.getPath("userData"), opts || {})
);

ipcMain.handle("decisionAudit:list", async (_e, opts) =>
  decisionAudit.list(app.getPath("userData"), opts || {})
);
ipcMain.handle("decisionAudit:verify", async () =>
  decisionAudit.verify(app.getPath("userData"))
);
ipcMain.handle("decisionAudit:requestRotate", async (e) =>
  externalAgentFlow.requestAuditRotate(app.getPath("userData"), e)
);
ipcMain.handle("decisionAudit:rotate", async (e, payload) =>
  externalAgentFlow.confirmAuditRotate(app.getPath("userData"), e, payload || {})
);

ipcMain.handle("l0:listAgents", async () => l0Agents.listAgents(app.getPath("userData")));
ipcMain.handle("l0:setActiveAgent", async (_e, agentId) =>
  l0Agents.setActiveAgent(app.getPath("userData"), agentId)
);
ipcMain.handle("l0:saveCliAgent", async (_e, payload) =>
  l0Agents.saveCliAgent(app.getPath("userData"), payload || {})
);
ipcMain.handle("l0:getCliAgentConfig", async () =>
  l0Agents.getCliAgentConfig(app.getPath("userData"))
);
ipcMain.handle("l0:buildControlBrief", async (_e, payload) => {
  const scene = (payload && payload.scene) || "write";
  return {
    brief: l0Orchestration.buildControlBrief({
      writeAuthorized: !!(payload && payload.writeAuthorized),
      workspaceLabel: (payload && payload.workspaceLabel) || "",
      scene,
    }),
  };
});

const activeDelegateAborts = new Map();

ipcMain.handle("l0:requestExternalAgent", async (e, payload) =>
  externalAgentFlow.requestExternalAgent(app.getPath("userData"), e, payload || {}, l0Agents)
);
ipcMain.handle("l0:cancelExternalAgentConfirmation", async (e, payload) =>
  externalAgentFlow.cancelExternalAgentConfirmation(app.getPath("userData"), e, payload || {})
);

ipcMain.handle("l0:runExternalAgent", async (e, payload) => {
  const userData = app.getPath("userData");
  const rid = (payload && payload.requestId) || "dlg_" + Date.now();
  const ac = new AbortController();
  activeDelegateAborts.set(rid, ac);
  const sendProg = (p) => {
    try {
      e.sender.send("chat:progress", { requestId: rid, ...p });
    } catch {
      /* ignore */
    }
  };
  try {
    return await externalAgentFlow.runExternalAgent(
      userData,
      e,
      payload || {},
      l0Agents,
      {
        runCliAgent: l0Agents.runCliAgent,
        onProgress: sendProg,
        signal: ac.signal,
      }
    );
  } finally {
    activeDelegateAborts.delete(rid);
  }
});

ipcMain.handle("l0:stopExternalAgent", async (_e, payload) => {
  const rid = payload && payload.requestId;
  const ac = rid && activeDelegateAborts.get(rid);
  if (ac) ac.abort();
  return { ok: true };
});

ipcMain.handle("scenarios:prepare", async (_e, packId) => {
  const pack = library.getScenarioPackById(packId);
  if (!pack) throw new Error("未知场景：" + packId);
  const em = await getExtensionManager();
  const results = [];
  for (const cid of pack.recommendedExtensions || []) {
    const item = catalog.getById(cid);
    if (!item) {
      results.push({ id: cid, ok: false, error: "目录中不存在" });
      continue;
    }
    if (item.needsKey) {
      results.push({
        id: cid,
        name: item.name,
        ok: false,
        skipped: true,
        reason: "需要密钥，请到「能力」页配置后启用",
      });
      continue;
    }
    try {
      const built = buildExtensionFromCatalog(item, { params: {}, env: {} });
      const publicBuilt = getConfigSecrets().sanitizeExtension(
        { ...built, env: undefined, envKeyNames: (item.envKeys || []).map((ek) => ek.key) },
        getConfigSecrets().secretStore
      );
      const list = getCapabilityExtensions().filter((e) => e.id !== publicBuilt.id);
      list.push(publicBuilt);
      saveCapabilityExtensions(list);
      await em.connectExtension(getConfigSecrets().hydrateExtensionEnv(publicBuilt));
      results.push({ id: cid, name: item.name, ok: true, connected: true });
    } catch (err) {
      results.push({ id: cid, name: item.name, ok: false, error: err.message || String(err) });
    }
  }
  const readyNames = results.filter((r) => r.ok).map((r) => r.name || r.id);
  const skipped = results.filter((r) => r.skipped);
  const failed = results.filter((r) => !r.ok && !r.skipped);
  let message = "";
  if (readyNames.length) message += "已为「" + pack.title + "」准备：" + readyNames.join("、") + "。";
  if (skipped.length) {
    message +=
      (message ? " " : "") +
      "以下需在「能力」页配置密钥：" +
      skipped.map((s) => s.name || s.id).join("、") +
      "。";
  }
  if (failed.length) {
    message +=
      (message ? " " : "") +
      "未能就绪：" +
      failed.map((f) => (f.name || f.id) + "（" + (f.error || "失败") + "）").join("、") +
      "。";
  }
  if (!message) message = "该场景暂无需要自动准备的能力。";
  return {
    pack,
    results,
    message,
    systemHint: pack.systemHint || "",
  };
});

ipcMain.handle("capabilities:surface", async (_e, payload) => {
  const em = await getExtensionManager();
  const statusList = em.getSessionStatus();
  return capabilitySurface.buildCapabilitySurface({
    catalogItems: catalog.listAll ? catalog.listAll() : catalog.CATALOG || [],
    enabledExtensions: getCapabilityExtensions(),
    statusList,
    scenarioPacks: library.getScenarioPacks(),
    templates: library.getTemplates(),
    activeScenario: (payload && payload.activeScenario) || null,
  });
});
ipcMain.handle("library:createFromTemplate", async (_e, payload) => {
  const cfg = readConfig();
  return library.createFromTemplate(app.getPath("userData"), {
    ...(payload || {}),
    packageRef: cfg.packageDir || DEFAULT_PACKAGE_DIR,
  });
});
ipcMain.handle("library:createBlank", async (_e, payload) => {
  const cfg = readConfig();
  return library.createBlank(app.getPath("userData"), {
    ...(payload || {}),
    packageRef: cfg.packageDir || DEFAULT_PACKAGE_DIR,
  });
});
ipcMain.handle("library:importArtifact", async (_e, payload) => {
  const cfg = readConfig();
  return library.importFromArtifact(app.getPath("userData"), {
    ...(payload || {}),
    packageRef: cfg.packageDir || DEFAULT_PACKAGE_DIR,
  });
});
ipcMain.handle("library:export", async (_e, { id, format }) => {
  const item = library.getDeliverable(app.getPath("userData"), id);
  if (!item) throw new Error("找不到该产物");
  const safe = safeFileStem(item.title);
  if (format === "csv") {
    const csv = library.markdownTableToCsv(item.content || "");
    const res = await dialog.showSaveDialog({
      title: "导出表格 CSV（WPS / Excel 可开）",
      defaultPath: path.join(draftsDir(), safe + ".csv"),
      filters: [{ name: "CSV", extensions: ["csv"] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    fs.writeFileSync(res.filePath, csv, "utf8");
    library.upsertDeliverable(app.getPath("userData"), { ...item, status: "exported" });
    return { canceled: false, filePath: res.filePath };
  }
  if (format === "docx") {
    const buf = documentOutput.buildDocxFromMarkdown(item.content || "", item.title || "成稿");
    const res = await dialog.showSaveDialog({
      title: "导出 Word（WPS 可开）",
      defaultPath: path.join(draftsDir(), safe + ".docx"),
      filters: [{ name: "Word", extensions: ["docx"] }],
    });
    if (res.canceled || !res.filePath) return { canceled: true };
    fs.writeFileSync(res.filePath, buf);
    library.upsertDeliverable(app.getPath("userData"), { ...item, status: "exported" });
    return { canceled: false, filePath: res.filePath };
  }
  const res = await dialog.showSaveDialog({
    title: "导出 Markdown",
    defaultPath: path.join(draftsDir(), safe + ".md"),
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  fs.writeFileSync(res.filePath, item.content || "", "utf8");
  library.upsertDeliverable(app.getPath("userData"), { ...item, status: "exported" });
  return { canceled: false, filePath: res.filePath };
});

// ---------- Task outputs ----------
ipcMain.handle("output:planPpt", async (_e, { pkg, brief }) => {
  const cfg = readConfig();
  if (!cfg.apiKey) throw new Error("尚未配置 API Key，请在设置中填写。");
  if (!brief?.topic?.trim()) throw new Error("请填写演讲主题。");

  let system = buildSystemPrompt(pkg);
  const dir = cfg.packageDir || DEFAULT_PACKAGE_DIR;
  try {
    const result = retrieval.retrieve(dir, brief.topic);
    const ctx = retrieval.renderContext(result);
    if (ctx) system += "\n\n---\n\n" + ctx;
  } catch {}

  const messages = pptxOutput.buildPptPlanMessages({ systemPrompt: system }, brief);
  let raw = await callModel(cfg, messages);
  if (hasBadChars(raw)) raw = await callModel(cfg, messages);
  if (hasBadChars(raw)) throw new Error("模型返回含乱码，请重试。");
  const plan = pptxOutput.parsePlanJson(raw);
  const owner = (pkg.manifest && pkg.manifest.ownerDisplayName) || "本人";
  plan.author = owner;
  return plan;
});

ipcMain.handle("output:savePpt", async (_e, { plan }) => {
  if (!plan?.slides?.length) throw new Error("没有可导出的幻灯片内容。");
  const buf = await pptxOutput.buildPptx(plan);
  const safeName = (plan.title || "演讲").replace(/[<>:"/\\|?*]/g, "_").slice(0, 60);
  const res = await dialog.showSaveDialog({
    title: "保存演讲 PPT",
    defaultPath: safeName + ".pptx",
    filters: [{ name: "PowerPoint 演示文稿", extensions: ["pptx"] }],
  });
  if (res.canceled || !res.filePath) return { canceled: true };
  fs.writeFileSync(res.filePath, buf);
  return { canceled: false, filePath: res.filePath, slideCount: plan.slides.length };
});

// ---------- Builder ----------
ipcMain.handle("builder:pickFile", async () => {
  const res = await dialog.showOpenDialog({
    title: "选择要蒸馏的素材（可多选）",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "支持的素材", extensions: ["docx", "txt", "md", "markdown", "pptx", "pdf"] },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  if (res.canceled || !res.filePaths.length) return [];
  return res.filePaths.slice(0, 20).map((filePath) => {
    const stat = fs.statSync(filePath);
    return { filePath, name: path.basename(filePath), size: stat.size };
  });
});

// Core distill pipeline shared by file import and questionnaire.
let distillCancelFlag = false;

function resetDistillCancel() {
  distillCancelFlag = false;
}

function throwIfDistillCanceled() {
  if (distillCancelFlag) {
    const err = new Error("已中断构建");
    err.code = "DISTILL_CANCELED";
    throw err;
  }
}

ipcMain.handle("builder:cancel", () => {
  distillCancelFlag = true;
  return { ok: true };
});

async function distillFromText(e, text, ownerName, progressExtra) {
  const cfg = readConfig();
  if (!cfg.apiKey) throw new Error("尚未配置 API Key，请在设置中填写。");
  const owner = ownerName || "本人";
  const send = (payload) => e.sender.send("builder:progress", { ...progressExtra, ...payload });

  const maxChars = progressExtra?.maxChars || 28000;
  const maxChunks = progressExtra?.maxChunks || 3;
  const prepared = builder.prepareTextForModel(text, { maxChars });
  if (prepared.skipped) {
    send({
      phase: "file",
      label: prepared.skipped,
      materialKind: progressExtra?.materialKind || "persona",
    });
    const agg = builder.aggregate([]);
    if (!progressExtra?.skipFinalDone) send({ phase: "done", agg });
    return {
      agg,
      results: [],
      meta: {
        chars: prepared.originalChars,
        chunks: 0,
        chunksAvailable: 0,
        skipped: true,
        truncated: true,
        truncateMode: prepared.truncateMode || "skipped",
        usedChars: 0,
      },
      sourceText: "",
    };
  }
  let chunks = builder.chunkText(prepared.text, 12000);
  const chunksAvailable = chunks.length;
  if (chunks.length > maxChunks) {
    send({
      phase: "file",
      label: `正文约 ${prepared.originalChars} 字，仅处理前 ${maxChunks} 段以加快（共可切 ${chunksAvailable} 段）`,
      materialKind: progressExtra?.materialKind || "persona",
    });
    chunks = chunks.slice(0, maxChunks);
  }
  const results = [];
  send({ phase: "start", chunks: chunks.length, chars: prepared.originalChars });

  for (let i = 0; i < chunks.length; i++) {
    throwIfDistillCanceled();
    send({ phase: "chunk", index: i + 1, total: chunks.length });
    let parsed = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      throwIfDistillCanceled();
      try {
        const raw = await callModel(cfg, builder.buildDistillMessages(chunks[i], owner));
        parsed = builder.parseDistillOutput(raw);
        if (!builder.distillResultEmpty(parsed)) break;
        if (attempt < 3) send({ phase: "chunk-retry", index: i + 1, attempt: attempt + 1, reason: "empty_or_corrupt" });
      } catch (err) {
        if (err && err.code === "DISTILL_CANCELED") throw err;
        if (attempt === 3) send({ phase: "chunk-error", index: i + 1, message: err.message });
        else send({ phase: "chunk-retry", index: i + 1, attempt: attempt + 1, reason: err.message });
      }
    }
    if (parsed && !builder.distillResultEmpty(parsed)) results.push(parsed);
  }
  let agg = builder.aggregate(results);
  const likeness = builder.filterLikelyFabricated(agg, prepared.text);
  agg = likeness.agg;
  if (likeness.dropped > 0) {
    send({
      phase: "file",
      label: `像我校验：已跳过 ${likeness.dropped} 条与原文重合过低的条目`,
      materialKind: progressExtra?.materialKind || "persona",
    });
  }
  if (!progressExtra?.skipFinalDone) send({ phase: "done", agg });
  return {
    agg,
    results,
    meta: {
      chars: prepared.originalChars,
      chunks: chunks.length,
      chunksAvailable,
      truncated: prepared.truncated || chunksAvailable > maxChunks,
      truncateMode: prepared.truncated
        ? prepared.truncateMode || "head_tail"
        : chunksAvailable > maxChunks
          ? "chunk_cap"
          : "",
      usedChars: prepared.usedChars || prepared.text.length,
      skipped: false,
      likenessDropped: likeness.dropped || 0,
    },
    sourceText: prepared.text,
  };
}

async function identityFromText(e, text, ownerName, progressExtra) {
  const cfg = readConfig();
  const owner = ownerName || "本人";
  const send = (payload) => e.sender.send("builder:progress", { ...progressExtra, ...payload });
  const fileName = progressExtra?.fileName || "";
  const maxChars = progressExtra?.maxChars || 28000;
  const maxChunks = progressExtra?.maxChunks || 3;

  let workingText = String(text || "");
  if (workingText.trim()) {
    const prepared = builder.prepareTextForModel(workingText, { maxChars });
    if (prepared.skipped) {
      send({
        phase: "file",
        label: prepared.skipped + "，改用文件名线索",
        materialKind: "identity",
      });
      workingText = "";
    } else {
      workingText = prepared.text;
      if (prepared.truncated) {
        send({
          phase: "file",
          label: `正文约 ${prepared.originalChars} 字，已取头尾约 ${prepared.usedChars || maxChars} 字`,
          materialKind: "identity",
        });
      }
    }
  }

  if (!workingText.trim()) {
    const provisional = builder.provisionalIdentityFromFilename(fileName, owner);
    send({
      phase: "start",
      chunks: cfg.apiKey ? 1 : 0,
      chars: 0,
      materialKind: "identity",
      label: "正文不可用，改从文件名建立线索与推断…",
    });
    const results = [provisional];
    if (cfg.apiKey) {
      throwIfDistillCanceled();
      send({ phase: "chunk", index: 1, total: 1, materialKind: "identity" });
      try {
        const raw = await callModel(
          cfg,
          builder.buildIdentityExtractMessages(
            `（仅文件名可用，正文未下载或无法读取）\n文件名：${fileName}\n请仅基于文件名做谨慎的事件与推断；置信度用 medium/low。`,
            owner
          ),
          { temperature: 0.2 }
        );
        const parsed = builder.parseIdentityOutput(raw);
        if (parsed && !builder.identityResultEmpty(parsed)) results.push(parsed);
      } catch (err) {
        if (err && err.code === "DISTILL_CANCELED") throw err;
        send({ phase: "chunk-error", index: 1, message: err.message });
      }
    }
    const identity = builder.aggregateIdentity(results);
    if (!progressExtra?.skipFinalDone) send({ phase: "done", identity, materialKind: "identity" });
    return {
      identity,
      results,
      meta: {
        chars: 0,
        chunks: results.length,
        chunksAvailable: results.length,
        bodyUnavailable: true,
        truncated: false,
        likenessDropped: 0,
      },
      sourceText: "",
    };
  }

  if (!cfg.apiKey) throw new Error("尚未配置 API Key，请在设置中填写。");
  let chunks = builder.chunkText(workingText, 12000);
  const chunksAvailable = chunks.length;
  if (chunks.length > maxChunks) {
    send({
      phase: "file",
      label: `仅处理前 ${maxChunks} 段以加快（可切 ${chunksAvailable} 段）`,
      materialKind: "identity",
    });
    chunks = chunks.slice(0, maxChunks);
  }
  const results = [];
  send({ phase: "start", chunks: chunks.length, chars: workingText.length, materialKind: "identity" });

  for (let i = 0; i < chunks.length; i++) {
    throwIfDistillCanceled();
    send({ phase: "chunk", index: i + 1, total: chunks.length, materialKind: "identity" });
    let parsed = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      throwIfDistillCanceled();
      try {
        const raw = await callModel(cfg, builder.buildIdentityExtractMessages(chunks[i], owner));
        parsed = builder.parseIdentityOutput(raw);
        if (!builder.identityResultEmpty(parsed)) break;
        if (attempt < 3) send({ phase: "chunk-retry", index: i + 1, attempt: attempt + 1, reason: "empty_or_corrupt" });
      } catch (err) {
        if (err && err.code === "DISTILL_CANCELED") throw err;
        if (attempt === 3) send({ phase: "chunk-error", index: i + 1, message: err.message });
        else send({ phase: "chunk-retry", index: i + 1, attempt: attempt + 1, reason: err.message });
      }
    }
    if (parsed && !builder.identityResultEmpty(parsed)) results.push(parsed);
  }
  let identity = builder.aggregateIdentity(results);
  const likeness = builder.filterLikelyFabricatedIdentity(identity, workingText);
  identity = likeness.identity;
  if (likeness.dropped > 0) {
    send({
      phase: "file",
      label: `像我校验：已跳过 ${likeness.dropped} 条与原文重合过低的条目`,
      materialKind: "identity",
    });
  }
  if (!progressExtra?.skipFinalDone) send({ phase: "done", identity, materialKind: "identity" });
  return {
    identity,
    results,
    meta: {
      chars: workingText.length,
      chunks: chunks.length,
      chunksAvailable,
      truncated: chunksAvailable > maxChunks,
      truncateMode: chunksAvailable > maxChunks ? "chunk_cap" : "",
      likenessDropped: likeness.dropped || 0,
    },
    sourceText: workingText,
  };
}

ipcMain.handle("materials:kinds", () => materials.MATERIAL_KINDS);

ipcMain.handle("materials:listCustody", () => materials.listCustody(app.getPath("userData")));

ipcMain.handle("inbox:list", () => inbox.listQueue(app.getPath("userData")));

ipcMain.handle("inbox:enqueue", (_e, files) =>
  inbox.enqueueFiles(app.getPath("userData"), files || [], "manual")
);

ipcMain.handle("inbox:remove", (_e, id) => inbox.removeItem(app.getPath("userData"), id));

ipcMain.handle("inbox:setKind", (_e, { id, kind }) => {
  const meta = inbox.LABEL_META[kind];
  if (!meta) return { ok: false, error: "无效归类" };
  return inbox.updateItem(app.getPath("userData"), id, {
    suggestedKind: kind,
    materialKind: meta.materialKind,
    status: "suggested",
    reason: "你已指定用途",
    confidence: "high",
    kindConflict: false,
  });
});

ipcMain.handle("inbox:organize", async (e) => {
  const userData = app.getPath("userData");
  const data = inbox.listQueue(userData);
  const cfg = readConfig();
  const targets = (data.items || []).filter(
    (it) => it.status === "queued" || it.status === "suggested"
  );
  const send = (payload) => e.sender.send("inbox:progress", payload);
  send({ phase: "start", total: targets.length });
  let i = 0;
  for (const it of targets) {
    i++;
    send({ phase: "item", index: i, total: targets.length, name: it.name });
    let text = "";
    let readError = "";
    const extracted = await builder.tryExtractText(it.filePath);
    if (extracted.ok) {
      text = extracted.text.slice(0, 12000);
    } else {
      readError = extracted.error;
    }
    let suggestion = inbox.classifyByRules(it.name, text);
    let modelSuggestion = null;
    // Filename-only is enough to call the model when rules are undecided / low
    if (cfg.apiKey && suggestion.confidence !== "high") {
      try {
        const raw = await callModel(
          cfg,
          inbox.buildClassifyMessages(it.name, text || "（正文不可读，仅根据文件名判断）"),
          { temperature: 0.2 }
        );
        modelSuggestion = inbox.parseClassifyOutput(raw);
      } catch {
        /* keep rules */
      }
    }
    suggestion = inbox.resolveClassifySuggestion(suggestion, modelSuggestion);
    const meta = inbox.LABEL_META[suggestion.suggestedKind] || inbox.LABEL_META.undecided;
    const reason = readError
      ? `${suggestion.reason}｜${readError}`
      : suggestion.reason;
    inbox.updateItem(userData, it.id, {
      status: "suggested",
      suggestedKind: suggestion.suggestedKind,
      materialKind: meta.materialKind,
      confidence: suggestion.confidence,
      reason,
      ruleKind: suggestion.ruleKind || null,
      modelKind: suggestion.modelKind || null,
      kindConflict: !!suggestion.kindConflict,
      bodyUnavailable: !extracted.ok,
      previewChars: text ? Math.min(text.length, 500) : 0,
    });
  }
  send({ phase: "done" });
  return inbox.listQueue(userData);
});

ipcMain.handle("inbox:markStatus", (_e, payload) => {
  const { id, status, processMeta } = payload || {};
  const patch = {};
  if (status) patch.status = status;
  if (processMeta && typeof processMeta === "object") patch.processMeta = processMeta;
  return inbox.updateItem(app.getPath("userData"), id, patch);
});

ipcMain.handle("access:list", () => inbox.listScopes(app.getPath("userData")));

ipcMain.handle("access:add", async () => {
  const res = await dialog.showOpenDialog({
    title: "选择可读文件夹（授权后仅扫描你允许的类型）",
    properties: ["openDirectory"],
  });
  if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true };
  return inbox.addAccessScope(app.getPath("userData"), {
    dirPath: res.filePaths[0],
    recursive: true,
    extensions: Array.from(inbox.ALLOWED_EXT),
  });
});

ipcMain.handle("access:remove", (_e, id) =>
  inbox.removeAccessScope(app.getPath("userData"), id)
);

ipcMain.handle("access:scan", (_e, scopeId) =>
  inbox.scanAccessScopes(app.getPath("userData"), scopeId || null)
);

// Distill / identity extract / custody — routed by materialKind.
ipcMain.handle("builder:distill", async (e, { filePath, filePaths, materialKind, options }) => {
  resetDistillCancel();
  const kind = materialKind === "identity" || materialKind === "custody" ? materialKind : "persona";
  const paths = (Array.isArray(filePaths) && filePaths.length
    ? filePaths
    : filePath
      ? [filePath]
      : []
  ).filter(Boolean);
  if (!paths.length) throw new Error("请先选择要处理的素材文件。");

  const smart = !!(options && options.smart);
  const maxChars = (options && options.maxChars) || (smart ? 20000 : 28000);
  const maxChunks = (options && options.maxChunks) || (smart ? 2 : 3);
  const progressBase = { maxChars, maxChunks };

  const send = (payload) => e.sender.send("builder:progress", payload);
  const fileNames = paths.map((fp) => path.basename(fp));

  if (kind === "custody") {
    const vaultItems = [];
    for (let fi = 0; fi < paths.length; fi++) {
      throwIfDistillCanceled();
      const fp = paths[fi];
      const name = path.basename(fp);
      send({
        phase: "file",
        index: fi + 1,
        total: paths.length,
        name,
        label: `正在收入保管库 ${fi + 1}/${paths.length}：${name}`,
        materialKind: "custody",
      });
      let text = "";
      let chars = 0;
      try {
        text = await builder.extractText(fp);
        chars = text.length;
      } catch (err) {
        send({ phase: "chunk-error", index: fi + 1, message: "无法读取正文（仍登记文件路径）：" + err.message });
      }
      vaultItems.push({
        filePath: fp,
        title: name,
        chars,
        excerpt: text.slice(0, 800),
      });
    }
    const stored = materials.addCustodyItems(app.getPath("userData"), vaultItems);
    send({ phase: "done", materialKind: "custody", custody: stored });
    return {
      materialKind: "custody",
      custody: stored,
      meta: { fileCount: paths.length, fileNames, fileName: fileNames.join("、") },
    };
  }

  if (kind === "identity") {
    const allResults = [];
    const fileNotes = [];
    let totalChars = 0;
    let totalChunks = 0;
    let likenessDropped = 0;
    for (let fi = 0; fi < paths.length; fi++) {
      throwIfDistillCanceled();
      const fp = paths[fi];
      const name = path.basename(fp);
      send({
        phase: "file",
        index: fi + 1,
        total: paths.length,
        name,
        label: `正在登记社会事实 ${fi + 1}/${paths.length}：${name}`,
        materialKind: "identity",
      });
      const extracted = await builder.tryExtractText(fp);
      const text = extracted.ok ? extracted.text : "";
      if (!extracted.ok) {
        send({
          phase: "file",
          index: fi + 1,
          total: paths.length,
          name,
          label: `正文不可读，改用文件名线索：${extracted.error}`,
          materialKind: "identity",
        });
      }
      totalChars += text.length;
      const res = await identityFromText(e, text, null, {
        ...progressBase,
        fileIndex: fi + 1,
        fileTotal: paths.length,
        fileName: name,
        skipFinalDone: true,
        materialKind: "identity",
      });
      totalChunks += res.meta.chunks || 0;
      likenessDropped += res.meta.likenessDropped || 0;
      fileNotes.push({
        filePath: fp,
        name,
        truncated: !!res.meta.truncated || !!res.meta.bodyUnavailable,
        truncateMode: res.meta.truncateMode || (res.meta.bodyUnavailable ? "body_unavailable" : ""),
        originalChars: res.meta.chars || text.length,
        chunksUsed: res.meta.chunks || 0,
        chunksAvailable: res.meta.chunksAvailable || res.meta.chunks || 0,
        likenessDropped: res.meta.likenessDropped || 0,
        skipped: !!res.meta.bodyUnavailable,
      });
      if (res.identity && !builder.identityResultEmpty(res.identity)) allResults.push(res.identity);
    }
    const identity = builder.aggregateIdentity(allResults);
    send({ phase: "done", identity, materialKind: "identity" });
    return {
      materialKind: "identity",
      identity,
      meta: {
        chars: totalChars,
        chunks: totalChunks,
        fileCount: paths.length,
        fileNames,
        fileName: fileNames.join("、"),
        likenessDropped,
        fileNotes,
        truncated: fileNotes.some((n) => n.truncated),
      },
    };
  }

  const allResults = [];
  const fileNotes = [];
  let totalChars = 0;
  let totalChunks = 0;
  let likenessDropped = 0;

  for (let fi = 0; fi < paths.length; fi++) {
    throwIfDistillCanceled();
    const fp = paths[fi];
    const name = path.basename(fp);
    send({
      phase: "file",
      index: fi + 1,
      total: paths.length,
      name,
      label: `正在处理第 ${fi + 1}/${paths.length} 个文件：${name}`,
      materialKind: "persona",
    });
    let text = "";
    try {
      text = await builder.extractText(fp);
    } catch (err) {
      send({ phase: "chunk-error", index: fi + 1, message: err.message });
      fileNotes.push({
        filePath: fp,
        name,
        truncated: true,
        truncateMode: "read_error",
        originalChars: 0,
        chunksUsed: 0,
        chunksAvailable: 0,
        likenessDropped: 0,
        skipped: true,
        error: err.message,
      });
      continue;
    }
    totalChars += text.length;
    const res = await distillFromText(e, text, null, {
      ...progressBase,
      fileIndex: fi + 1,
      fileTotal: paths.length,
      fileName: name,
      skipFinalDone: true,
      materialKind: "persona",
    });
    totalChunks += res.meta.chunks || 0;
    likenessDropped += res.meta.likenessDropped || 0;
    fileNotes.push({
      filePath: fp,
      name,
      truncated: !!res.meta.truncated || !!res.meta.skipped,
      truncateMode: res.meta.truncateMode || "",
      originalChars: res.meta.chars || text.length,
      chunksUsed: res.meta.chunks || 0,
      chunksAvailable: res.meta.chunksAvailable || res.meta.chunks || 0,
      likenessDropped: res.meta.likenessDropped || 0,
      skipped: !!res.meta.skipped,
    });
    if (res.agg && !builder.distillResultEmpty(res.agg)) allResults.push(res.agg);
  }

  const agg = builder.aggregate(allResults);
  send({ phase: "done", agg, materialKind: "persona" });
  return {
    materialKind: "persona",
    agg,
    meta: {
      chars: totalChars,
      chunks: totalChunks,
      fileCount: paths.length,
      fileNames,
      fileName: fileNames.join("、"),
      likenessDropped,
      fileNotes,
      truncated: fileNotes.some((n) => n.truncated),
    },
  };
});

// Return the intake questionnaire bank.
ipcMain.handle("intake:questions", () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, "intake-questions.json"), "utf8"));
  } catch (err) {
    throw new Error("读取问卷题库失败：" + err.message);
  }
});

// Distill from questionnaire answers: format Q&A -> shared pipeline.
ipcMain.handle("intake:distill", async (e, { answers }) => {
  const bank = JSON.parse(fs.readFileSync(path.join(__dirname, "intake-questions.json"), "utf8"));
  const lines = [
    "以下是本人填写的自我评测（含性格倾向、价值排序、情境判断、经历概要与表达边界）。",
    "请据此整理人格倾向、价值观、决策框架、表达风格与可核对记忆；经历概要请同时抽成可写入时间线的事件线索。",
    "优先保留带理由的判断，不要编造问卷未提及的机构与人名。\n",
  ];
  for (const sec of bank.sections || []) {
    lines.push("### " + sec.title);
    for (const q of sec.questions || []) {
      const a = (answers && answers[q.id]) || "";
      if (String(a).trim()) lines.push("问：" + q.text + "\n答：" + a + "\n");
      if (q.followupId) {
        const note = (answers && answers[q.followupId]) || "";
        if (String(note).trim()) {
          lines.push("补充（" + (q.followup || q.followupId) + "）：" + note + "\n");
        }
      }
    }
  }
  const text = lines.join("\n");
  if (text.length < 80) {
    throw new Error("评测回答过少：请至少完成性格倾向、价值排序与 3 道情境判断。");
  }
  const res = await distillFromText(e, text);
  res.meta.source = "intake-questionnaire-v0.3";
  return res;
});

// ---------- Feedback loop (via PackageStore change sets) ----------
ipcMain.handle("feedback:preview", (_e, payload) => {
  const pkgDir = packageDirFromConfig();
  return feedback.previewFeedback(pkgDir, payload || {});
});

ipcMain.handle("feedback:apply", (_e, payload) => {
  const pkgDir = packageDirFromConfig();
  const body = payload && typeof payload === "object" ? payload : {};
  // Only accept changeSetId + confirmation — never raw write plans.
  return feedback.applyFeedback(pkgDir, {
    changeSetId: body.changeSetId,
    confirmed: body.confirmed,
    confirmation: body.confirmation,
    category: body.category,
  });
});

// ---------- PackageStore sandbox (tmp demos only; never auto-touch real package) ----------
ipcMain.handle("packageStore:createDemo", (_e, opts) => {
  const options = opts && typeof opts === "object" ? opts : {};
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-p102-demo-"));
  createMinimalFixture(dir, {
    schemaVersion: options.schemaVersion,
    withMemoryLine: !!options.withMemoryLine,
  });
  const store = new PackageStore({ packageDir: dir, ownerId: "sandbox:demo" });
  if (options.migrateToV02 === true) {
    store.migrateToV02({ actor: "sandbox:demo", toolVersion: "digitalme-app-sandbox" });
  }
  const inspect = store.inspect();
  return { packageDir: dir, inspect };
});

ipcMain.handle("packageStore:inspect", (_e, payload) => {
  const body = payload && typeof payload === "object" ? payload : {};
  const pkgDir = body.packageDir
    ? assertPackageStoreDirAllowed(body.packageDir)
    : path.resolve(packageDirFromConfig());
  const store = new PackageStore({ packageDir: pkgDir, ownerId: "sandbox:inspect" });
  return store.inspect();
});

ipcMain.handle("packageStore:listVersions", () => {
  const pkgDir = path.resolve(packageDirFromConfig());
  const store = new PackageStore({ packageDir: pkgDir, ownerId: "sandbox:list" });
  return buildVersionPanelInfo(store);
});

ipcMain.handle("subject:getOverview", () => {
  const pkgDir = path.resolve(packageDirFromConfig());
  const pub = readPublicConfig();
  return buildSubjectOverviewV1(pkgDir, {
    hasApiKey: !!pub.apiKeyConfigured,
  });
});

ipcMain.handle("packageStore:rollback", (_e, payload) => {
  const body = payload && typeof payload === "object" ? payload : {};
  const pkgDir = body.packageDir
    ? assertPackageStoreDirAllowed(body.packageDir)
    : path.resolve(packageDirFromConfig());
  const confirmed =
    body.confirmed === true ||
    (body.confirmation && body.confirmation.confirmed === true);
  if (!confirmed) {
    const e = new Error("需要明确确认后才能恢复到指定版本。");
    e.code = "confirmation_required";
    throw e;
  }
  const versionId = String(body.versionId || body.rollbackVersion || "").trim();
  if (!/^v\d+$/.test(versionId)) {
    const e = new Error("只能恢复主进程提供的版本编号，不能指定其他路径。");
    e.code = "version_id_invalid";
    throw e;
  }
  const store = new PackageStore({ packageDir: pkgDir, ownerId: "sandbox:rollback" });
  store.recover();
  const listed = store.listVersions();
  const allowed = listed.some((v) => v.kind === "snapshot" && v.versionId === versionId);
  if (!allowed) {
    const e = new Error("该版本已不存在或不可恢复，请刷新版本信息后重试。");
    e.code = "version_not_found";
    throw e;
  }
  return store.rollback(versionId, { confirmed: true });
});

ipcMain.handle("packageStore:recover", () => {
  const pkgDir = path.resolve(packageDirFromConfig());
  const store = new PackageStore({ packageDir: pkgDir, ownerId: "sandbox:recover" });
  return store.recover();
});

// ---------- Capability extensions IPC ----------
ipcMain.handle("extensions:getCatalog", () => enrichCatalogForUi());

ipcMain.handle("extensions:getConfig", () => getCapabilityExtensions());

ipcMain.handle("extensions:saveConfig", (_e, list) => {
  if (!Array.isArray(list)) throw new Error("扩展配置必须是数组");
  return saveCapabilityExtensions(
    list
      .map((ext) => ({
        id: String(ext.id || "").trim(),
        name: String(ext.name || ext.id || "").trim(),
        catalogId: ext.catalogId ? String(ext.catalogId) : undefined,
        command: String(ext.command || npxCommand()).trim(),
        args: Array.isArray(ext.args) ? ext.args.map(String) : [],
        cwd: ext.cwd ? String(ext.cwd) : undefined,
        env: ext.env && typeof ext.env === "object" ? ext.env : undefined,
        envKeyNames: Array.isArray(ext.envKeyNames) ? ext.envKeyNames.map(String) : undefined,
        note: ext.note ? String(ext.note) : undefined,
        params: ext.params && typeof ext.params === "object" ? ext.params : undefined,
      }))
      .filter((ext) => ext.id)
  );
});

ipcMain.handle("extensions:enable", async (_e, payload) => {
  const catalogId = payload?.catalogId || payload?.id;
  const item = catalog.getById(catalogId);
  if (!item) throw new Error("精选目录中不存在：" + catalogId);
  const envInput = payload?.env && typeof payload.env === "object" ? payload.env : {};
  const built = buildExtensionFromCatalog(item, {
    params: payload?.params || {},
    env: envInput,
  });
  const svc = getConfigSecrets();
  if (Object.keys(envInput).length) {
    svc.ingestExtensionSecrets(built.id, envInput);
  }
  const envKeyNames = (item.envKeys || []).map((ek) => ek.key).filter(Boolean);
  const publicBuilt = svc.sanitizeExtension(
    {
      ...built,
      env: undefined,
      envKeyNames,
    },
    svc.secretStore
  );
  const list = getCapabilityExtensions().filter((e) => e.id !== publicBuilt.id);
  list.push(publicBuilt);
  saveCapabilityExtensions(list);
  return publicBuilt;
});

ipcMain.handle("extensions:disable", async (_e, id) => {
  try {
    const em = await getExtensionManager();
    await em.disconnectExtension(id);
  } catch {}
  const list = getCapabilityExtensions().filter((e) => e.id !== id);
  saveCapabilityExtensions(list);
  return true;
});

ipcMain.handle("extensions:pickDirectory", async () => {
  const res = await dialog.showOpenDialog({
    title: "选择授权目录",
    properties: ["openDirectory", "createDirectory"],
    defaultPath: defaultWorkspaceRoot(),
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle("extensions:pickFile", async () => {
  const res = await dialog.showOpenDialog({
    title: "选择数据库文件",
    properties: ["openFile"],
    filters: [
      { name: "SQLite", extensions: ["db", "sqlite", "sqlite3"] },
      { name: "所有文件", extensions: ["*"] },
    ],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

ipcMain.handle("extensions:getStatus", async () => {
  const em = await getExtensionManager();
  return em.getSessionStatus();
});

ipcMain.handle("extensions:connect", async (_e, id) => {
  const ext = findExtensionById(id);
  if (ext.id === "filesystem" || (ext.args || []).includes("@modelcontextprotocol/server-filesystem")) {
    const rootArg = (ext.args || []).slice(-1)[0];
    if (rootArg && !String(rootArg).startsWith("-")) {
      try {
        fs.mkdirSync(rootArg, { recursive: true });
      } catch (e) {
        throw new Error("无法创建授权目录：" + rootArg + "（" + e.message + "）");
      }
    }
  }
  const hydrated = getConfigSecrets().hydrateExtensionEnv(ext);
  const em = await getExtensionManager();
  return em.connectExtension(hydrated);
});

ipcMain.handle("extensions:disconnect", async (_e, id) => {
  const em = await getExtensionManager();
  await em.disconnectExtension(id);
  return true;
});

ipcMain.handle("extensions:listTools", async (_e, id) => {
  const em = await getExtensionManager();
  return em.listTools(id);
});

ipcMain.handle("extensions:callTool", async (_e, { id, name, args }) => {
  if (!name) throw new Error("请指定工具名称");
  const em = await getExtensionManager();
  return em.callTool(id, name, args || {});
});

ipcMain.handle("shell:openExternal", async (_e, url) => {
  if (!url || !/^https?:\/\//i.test(String(url))) throw new Error("无效链接");
  const { shell } = require("electron");
  await shell.openExternal(String(url));
  return true;
});

ipcMain.handle("shell:openPath", async (_e, target) => {
  const { shell } = require("electron");
  const p = String(target || "").trim();
  if (!p) throw new Error("路径为空");
  const err = await shell.openPath(p);
  if (err) throw new Error(err || "无法打开该路径");
  return { ok: true, path: p };
});

// Confirm write-back to the package (persona distill or identity facts).
ipcMain.handle("builder:write", async (_e, { agg, identity, materialKind, filePath, title }) => {
  const cfg = readConfig();
  const pkgDir = cfg.packageDir || DEFAULT_PACKAGE_DIR;
  const kind = materialKind === "identity" ? "identity" : "persona";

  if (kind === "identity") {
    const idPayload = identity || {};
    let events = Array.isArray(idPayload.events) ? idPayload.events : [];
    if (!events.length && Array.isArray(idPayload.claims)) {
      events = idPayload.claims.map((c) => ({
        when: c.when || "",
        what: c.value,
        roleLabels: [],
        org: c.org || "",
        actors: [],
        outcome: "",
        facets: ["roles"],
        confidence: "medium",
      }));
    }
    const result = life.writeLifeBack(pkgDir, {
      events,
      facts: idPayload.facts || [],
      inferences: idPayload.inferences || [],
      outcomes: idPayload.outcomes || [],
      domains: idPayload.domains || [],
      org_touchpoints: idPayload.org_touchpoints || [],
      alter_candidates: idPayload.alter_candidates || [],
      mind_hooks: idPayload.mind_hooks || [],
      capability_signals: idPayload.capability_signals || [],
      filePath,
      title,
    });
    materials.archiveIdentityRun(app.getPath("userData"), {
      title: title || "社会事实",
      filePath: filePath || "",
      claims: events.map((e) => ({ type: "role", value: e.what })),
      facts: idPayload.facts || [],
      events,
      inferences: idPayload.inferences || [],
      outcomes: idPayload.outcomes || [],
    });
    return { materialKind: "identity", ...result };
  }

  const base = path.basename(filePath || "source");
  const sourceMeta = {
    id: "src_" + base.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 40) + "_" + Date.now().toString(36),
    type: "document",
    title: title || base,
    author: "",
    createdAt: new Date().toISOString(),
    location: filePath || "",
    sensitivity: "private",
    usedFor: ["style-guide", "persona", "decision-frameworks", "long-term-memory"],
    materialKind: "persona",
  };
  return { materialKind: "persona", ...builder.writeBack(pkgDir, agg, sourceMeta) };
});
