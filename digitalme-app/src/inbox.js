"use strict";

/**
 * Material inbox + authorized folder scopes.
 * See digitalme_inbox_access_plan_v0.1.md
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const builder = require("./builder");

const ALLOWED_EXT = new Set([".docx", ".txt", ".md", ".markdown", ".pptx", ".pdf"]);

const LABEL_META = {
  persona: { label: "想法与表达", materialKind: "persona" },
  identity: { label: "履历与经历", materialKind: "identity" },
  custody: { label: "只存不写入", materialKind: "custody" },
  undecided: { label: "待指定", materialKind: null },
};

function isoNow() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
}

function materialsRoot(userData) {
  const dir = path.join(userData, "materials");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function queuePath(userData) {
  return path.join(materialsRoot(userData), "inbox-queue.json");
}

function scopesPath(userData) {
  return path.join(materialsRoot(userData), "access-scopes.json");
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function fileFingerprint(filePath) {
  try {
    const st = fs.statSync(filePath);
    const head = Buffer.alloc(0);
    let sample = "";
    try {
      const fd = fs.openSync(filePath, "r");
      const buf = Buffer.alloc(Math.min(4096, st.size));
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      sample = buf.slice(0, n).toString("binary");
    } catch {
      /* ignore */
    }
    return crypto
      .createHash("sha1")
      .update(String(st.size) + "|" + String(st.mtimeMs) + "|" + sample)
      .digest("hex");
  } catch {
    return "";
  }
}

function listQueue(userData) {
  const data = readJson(queuePath(userData), { version: 1, items: [] });
  return data;
}

function saveQueue(userData, data) {
  data.updatedAt = isoNow();
  data.version = data.version || 1;
  writeJson(queuePath(userData), data);
  return data;
}

function listScopes(userData) {
  return readJson(scopesPath(userData), { version: 1, scopes: [] });
}

function saveScopes(userData, data) {
  data.updatedAt = isoNow();
  data.version = data.version || 1;
  writeJson(scopesPath(userData), data);
  return data;
}

function enqueueFiles(userData, files, source) {
  const data = listQueue(userData);
  const existingPaths = new Set((data.items || []).map((it) => it.filePath));
  const existingFp = new Set((data.items || []).map((it) => it.fingerprint).filter(Boolean));
  const added = [];
  for (const f of files || []) {
    const filePath = f.filePath || f;
    if (!filePath || !fs.existsSync(filePath)) continue;
    const ext = path.extname(filePath).toLowerCase();
    if (!ALLOWED_EXT.has(ext)) continue;
    const fp = fileFingerprint(filePath);
    if (existingPaths.has(filePath)) continue;
    if (fp && existingFp.has(fp)) continue;
    let size = 0;
    try {
      size = fs.statSync(filePath).size;
    } catch {
      /* */
    }
    const item = {
      id: makeId("inbox"),
      filePath,
      name: path.basename(filePath),
      size,
      fingerprint: fp,
      source: source || "manual",
      status: "queued",
      suggestedKind: null,
      confidence: null,
      reason: "",
      materialKind: null,
      createdAt: isoNow(),
      updatedAt: isoNow(),
    };
    data.items.unshift(item);
    existingPaths.add(filePath);
    if (fp) existingFp.add(fp);
    added.push(item);
  }
  saveQueue(userData, data);
  return { added, queue: data };
}

function updateItem(userData, id, patch) {
  const data = listQueue(userData);
  const item = (data.items || []).find((it) => it.id === id);
  if (!item) return { ok: false, error: "未找到该材料" };
  Object.assign(item, patch || {}, { updatedAt: isoNow() });
  saveQueue(userData, data);
  return { ok: true, item, queue: data };
}

function removeItem(userData, id) {
  const data = listQueue(userData);
  const before = data.items.length;
  data.items = (data.items || []).filter((it) => it.id !== id);
  if (data.items.length === before) return { ok: false, error: "未找到该材料" };
  saveQueue(userData, data);
  return { ok: true, queue: data };
}

/** Rule-based classify via shared material signal dictionary. */
function classifyByRules(name, text) {
  const n = String(name || "");
  const t = String(text || "").slice(0, 8000);
  const { hits, nameOnly } = builder.detectMaterialSignals(n, t);

  if (hits.includes("custody")) {
    return {
      suggestedKind: "custody",
      confidence: "high",
      reason: "检测到凭证或敏感标识，建议只存不写入",
    };
  }
  if (hits.includes("activity") || hits.includes("resume") || hits.includes("outcome")) {
    const label = hits.includes("activity")
      ? "活动/会议类"
      : hits.includes("resume")
        ? "履历/任职类"
        : "成果/里程碑类";
    return {
      suggestedKind: "identity",
      confidence: nameOnly ? "medium" : "high",
      reason: nameOnly
        ? `文件名像${label}，建议记入履历与经历（可打开正文后再补充）`
        : `材料像${label}，建议记入履历与经历并更新可用画像`,
    };
  }
  if (hits.includes("discourse")) {
    return {
      suggestedKind: "persona",
      confidence: nameOnly ? "low" : t.length > 2000 ? "medium" : "low",
      reason: nameOnly
        ? "文件名像论述文，建议归入想法与表达（正文未读取时把握较低）"
        : "偏论述或长文，建议归入想法与表达",
    };
  }
  if (!nameOnly && (t.match(/任|职务|职位|就职|加入/g) || []).length >= 3) {
    return {
      suggestedKind: "identity",
      confidence: "medium",
      reason: "正文含较多任职时间线索",
    };
  }
  if (!nameOnly && t.length > 800) {
    return {
      suggestedKind: "persona",
      confidence: "low",
      reason: "长文材料，暂建议归入想法与表达",
    };
  }
  return {
    suggestedKind: "undecided",
    confidence: "low",
    reason: nameOnly
      ? "正文未下载且文件名信号不足；请先在本机打开文件，或手动指定用途"
      : "信号不足，请你指定用途",
  };
}

function kindLabel(kind) {
  return (LABEL_META[kind] && LABEL_META[kind].label) || kind || "待指定";
}

/**
 * Merge rule vs model classify. Prefer conservative outcome on conflict
 * so smart-build won't silently write the wrong pipeline.
 */
function resolveClassifySuggestion(ruleSuggestion, modelSuggestion) {
  const rule = ruleSuggestion || {
    suggestedKind: "undecided",
    confidence: "low",
    reason: "",
  };
  if (!modelSuggestion) {
    return {
      ...rule,
      ruleKind: rule.suggestedKind,
      modelKind: null,
      kindConflict: false,
    };
  }
  const ruleKind = rule.suggestedKind || "undecided";
  const modelKind = modelSuggestion.suggestedKind || "undecided";
  if (ruleKind === modelKind || ruleKind === "undecided") {
    const pick = ruleKind === "undecided" ? modelSuggestion : rule.confidence === "high" ? rule : modelSuggestion;
    return {
      ...pick,
      ruleKind,
      modelKind,
      kindConflict: false,
    };
  }
  // Conflict: custody always wins; otherwise force user pick (undecided)
  if (ruleKind === "custody" || modelKind === "custody") {
    return {
      suggestedKind: "custody",
      confidence: "medium",
      reason: `用途建议不一致（${kindLabel(ruleKind)} 与 ${kindLabel(modelKind)}），暂按只存不写入`,
      ruleKind,
      modelKind,
      kindConflict: true,
    };
  }
  if (rule.confidence === "high") {
    return {
      ...rule,
      reason: `${rule.reason || kindLabel(ruleKind)}（模型另建议${kindLabel(modelKind)}，已保留规则）`,
      ruleKind,
      modelKind,
      kindConflict: true,
    };
  }
  return {
    suggestedKind: "undecided",
    confidence: "low",
    reason: `规则建议「${kindLabel(ruleKind)}」，模型建议「${kindLabel(modelKind)}」，请指定用途`,
    ruleKind,
    modelKind,
    kindConflict: true,
  };
}

function buildClassifyMessages(name, snippet) {
  return [
    {
      role: "system",
      content:
        "你是 Digital Me 材料分流助手。根据文件名与正文片段，建议归类。" +
        "只输出 JSON：{\"kind\":\"persona|identity|custody|undecided\",\"confidence\":\"high|medium|low\",\"reason\":\"不超过30字中文理由\"}。" +
        "persona=观念与表达；identity=人生事实/履历任职/嘉宾演讲议程；custody=高敏仅保管；undecided=吃不准。" +
        "嘉宾资料、会议议程、出席证明标 identity；履历表不要标 persona；证件密码标 custody。" +
        "若正文不可读，仍可仅凭文件名判断。不要 markdown。",
    },
    {
      role: "user",
      content: `文件名：${name}\n\n正文片段：\n"""\n${String(snippet || "").slice(0, 3500)}\n"""`,
    },
  ];
}

function parseClassifyOutput(raw) {
  let s = String(raw || "").trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const m = s.match(/\{[\s\S]*\}/);
  if (m) s = m[0];
  try {
    const obj = JSON.parse(s);
    const kind = ["persona", "identity", "custody", "undecided"].includes(obj.kind)
      ? obj.kind
      : "undecided";
    const confidence = ["high", "medium", "low"].includes(obj.confidence)
      ? obj.confidence
      : "low";
    return {
      suggestedKind: kind,
      confidence,
      reason: String(obj.reason || "").slice(0, 80) || "模型建议",
    };
  } catch {
    return null;
  }
}

function addAccessScope(userData, { dirPath, recursive, extensions }) {
  const abs = path.resolve(dirPath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    return { ok: false, error: "目录无效" };
  }
  const data = listScopes(userData);
  if ((data.scopes || []).some((s) => s.dirPath === abs)) {
    return { ok: false, error: "该目录已在可读范围中" };
  }
  const exts = Array.isArray(extensions) && extensions.length
    ? extensions.map((e) => (e.startsWith(".") ? e.toLowerCase() : "." + e.toLowerCase()))
    : Array.from(ALLOWED_EXT);
  const scope = {
    id: makeId("scope"),
    dirPath: abs,
    recursive: recursive !== false,
    extensions: exts,
    createdAt: isoNow(),
  };
  data.scopes = data.scopes || [];
  data.scopes.push(scope);
  saveScopes(userData, data);
  return { ok: true, scope, scopes: data };
}

function removeAccessScope(userData, id) {
  const data = listScopes(userData);
  const before = (data.scopes || []).length;
  data.scopes = (data.scopes || []).filter((s) => s.id !== id);
  if (data.scopes.length === before) return { ok: false, error: "未找到该范围" };
  saveScopes(userData, data);
  return { ok: true, scopes: data };
}

function walkDir(dir, recursive, exts, out, depth) {
  if (depth > 12) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.name.startsWith(".")) continue;
    if (ent.isDirectory()) {
      if (recursive) walkDir(full, recursive, exts, out, depth + 1);
      continue;
    }
    if (!ent.isFile()) continue;
    const ext = path.extname(ent.name).toLowerCase();
    if (!exts.has(ext)) continue;
    out.push(full);
    if (out.length >= 200) return;
  }
}

function scanAccessScopes(userData, scopeId) {
  const data = listScopes(userData);
  const scopes = scopeId
    ? (data.scopes || []).filter((s) => s.id === scopeId)
    : data.scopes || [];
  const found = [];
  for (const sc of scopes) {
    const exts = new Set(sc.extensions || Array.from(ALLOWED_EXT));
    walkDir(sc.dirPath, sc.recursive !== false, exts, found, 0);
  }
  const files = found.map((filePath) => {
    let size = 0;
    try {
      size = fs.statSync(filePath).size;
    } catch {
      /* */
    }
    return { filePath, name: path.basename(filePath), size };
  });
  return enqueueFiles(userData, files, "access_scan");
}

module.exports = {
  ALLOWED_EXT,
  LABEL_META,
  listQueue,
  saveQueue,
  enqueueFiles,
  updateItem,
  removeItem,
  classifyByRules,
  resolveClassifySuggestion,
  buildClassifyMessages,
  parseClassifyOutput,
  listScopes,
  addAccessScope,
  removeAccessScope,
  scanAccessScopes,
  fileFingerprint,
};
