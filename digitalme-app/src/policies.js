"use strict";

/**
 * Expression boundaries (禁区): system defaults + user overrides.
 * File: policies/boundaries.json
 */

const fs = require("node:fs");
const path = require("node:path");

const SCOPES = ["never_inject", "never_export", "never_speak_for_me"];

const SCOPE_LABELS = {
  never_inject: "不注入对话",
  never_export: "不随导出",
  never_speak_for_me: "不代你表态",
};

/** Factory defaults — universal, no owner-specific cases. */
const SYSTEM_DEFAULTS = [
  {
    key: "sys_credentials",
    text: "证件号、账号密码、支付与银行卡等凭证细节",
    scope: "never_speak_for_me",
  },
  {
    key: "sys_others_privacy",
    text: "未经同意的他人隐私与可识别信息",
    scope: "never_speak_for_me",
  },
  {
    key: "sys_medical",
    text: "详细医疗病历与未授权健康细节",
    scope: "never_inject",
  },
  {
    key: "sys_finance_raw",
    text: "未授权的具体财务数字与持仓明细",
    scope: "never_speak_for_me",
  },
  {
    key: "sys_legal_commit",
    text: "未经本人确认的对外法律意见、签约与正式承诺",
    scope: "never_speak_for_me",
  },
  {
    key: "sys_intimate",
    text: "亲密关系与家庭内部敏感细节（除非本人当次明确要求）",
    scope: "never_speak_for_me",
  },
  {
    key: "sys_location_precise",
    text: "精确住址与实时行踪（除非本人当次明确要求）",
    scope: "never_inject",
  },
];

function isoNow() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
}

function policiesDir(pkgDir) {
  return path.join(pkgDir, "policies");
}

function boundariesPath(pkgDir) {
  return path.join(policiesDir(pkgDir), "boundaries.json");
}

function systemItemFromDefault(def) {
  return {
    id: def.key,
    key: def.key,
    text: def.text,
    scope: def.scope,
    source: "system",
    enabled: true,
    createdAt: isoNow(),
    updatedAt: isoNow(),
  };
}

function emptyBoundaries() {
  return {
    version: 2,
    updatedAt: isoNow(),
    items: SYSTEM_DEFAULTS.map(systemItemFromDefault),
  };
}

function mergeSystemDefaults(data) {
  if (!data || typeof data !== "object") data = emptyBoundaries();
  if (!Array.isArray(data.items)) data.items = [];
  const byKey = new Map();
  for (const it of data.items) {
    const k = it.key || (String(it.id || "").startsWith("sys_") ? it.id : null);
    if (k) byKey.set(k, it);
  }
  for (const def of SYSTEM_DEFAULTS) {
    if (!byKey.has(def.key)) {
      data.items.unshift(systemItemFromDefault(def));
    } else {
      const existing = byKey.get(def.key);
      existing.source = "system";
      existing.key = def.key;
      if (existing.enabled === undefined) existing.enabled = true;
      // Keep user-edited text if they changed it; only fill empty
      if (!existing.text) existing.text = def.text;
      if (!existing.scope) existing.scope = def.scope;
    }
  }
  for (const it of data.items) {
    if (!it.source) it.source = String(it.id || "").startsWith("sys_") ? "system" : "user";
    if (it.enabled === undefined) it.enabled = true;
  }
  data.version = Math.max(2, data.version || 1);
  return data;
}

function ensureBoundariesScaffold(pkgDir) {
  const dir = policiesDir(pkgDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = boundariesPath(pkgDir);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(emptyBoundaries(), null, 2), "utf8");
    return file;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    const merged = mergeSystemDefaults(raw);
    const needWrite =
      !raw.version ||
      raw.version < 2 ||
      (raw.items || []).length !== merged.items.length ||
      !(raw.items || []).some((it) => it.key === "sys_credentials" || it.id === "sys_credentials");
    if (needWrite) {
      merged.updatedAt = isoNow();
      fs.writeFileSync(file, JSON.stringify(merged, null, 2), "utf8");
    }
  } catch {
    fs.writeFileSync(file, JSON.stringify(emptyBoundaries(), null, 2), "utf8");
  }
  return file;
}

function readBoundaries(pkgDir) {
  ensureBoundariesScaffold(pkgDir);
  try {
    return mergeSystemDefaults(JSON.parse(fs.readFileSync(boundariesPath(pkgDir), "utf8")));
  } catch {
    return emptyBoundaries();
  }
}

function writeBoundaries(pkgDir, data) {
  const dir = policiesDir(pkgDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  data.version = data.version || 2;
  data.updatedAt = isoNow();
  if (!Array.isArray(data.items)) data.items = [];
  fs.writeFileSync(boundariesPath(pkgDir), JSON.stringify(data, null, 2), "utf8");
  return data;
}

function normalizeScope(scope) {
  const s = String(scope || "never_speak_for_me").trim();
  return SCOPES.includes(s) ? s : "never_speak_for_me";
}

function addBoundary(pkgDir, { text, scope, sourceRefs }) {
  const clean = String(text || "").trim();
  if (!clean) return { ok: false, error: "请填写禁区说明" };
  const data = readBoundaries(pkgDir);
  const key = clean.toLowerCase().replace(/\s+/g, "");
  if (data.items.some((it) => String(it.text || "").toLowerCase().replace(/\s+/g, "") === key)) {
    return { ok: false, error: "已有相同条目" };
  }
  const item = {
    id: makeId("bnd"),
    text: clean,
    scope: normalizeScope(scope),
    source: "user",
    enabled: true,
    sourceRefs: Array.isArray(sourceRefs) ? sourceRefs : [],
    createdAt: isoNow(),
    updatedAt: isoNow(),
  };
  data.items.push(item);
  writeBoundaries(pkgDir, data);
  return { ok: true, item, data };
}

function updateBoundary(pkgDir, { id, text, scope, enabled, confirmed }) {
  if (!confirmed) return { ok: false, error: "修改禁区需要确认", needConfirm: true };
  const data = readBoundaries(pkgDir);
  const item = data.items.find((it) => it.id === id);
  if (!item) return { ok: false, error: "未找到该条目" };
  if (text != null) {
    const clean = String(text).trim();
    if (!clean) return { ok: false, error: "禁区说明不能为空" };
    item.text = clean;
  }
  if (scope != null) item.scope = normalizeScope(scope);
  if (enabled != null) item.enabled = !!enabled;
  item.updatedAt = isoNow();
  writeBoundaries(pkgDir, data);
  return { ok: true, item, data };
}

function removeBoundary(pkgDir, id, opts = {}) {
  const data = readBoundaries(pkgDir);
  const item = data.items.find((it) => it.id === id);
  if (!item) return { ok: false, error: "未找到该条目" };
  if (item.source === "system") {
    // System items: disable rather than delete, requires confirm
    if (!opts.confirmed) return { ok: false, error: "关闭系统默认禁区需要确认", needConfirm: true };
    item.enabled = false;
    item.updatedAt = isoNow();
    writeBoundaries(pkgDir, data);
    return { ok: true, data, disabled: true };
  }
  data.items = data.items.filter((it) => it.id !== id);
  writeBoundaries(pkgDir, data);
  return { ok: true, data };
}

function restoreSystemDefaults(pkgDir, opts = {}) {
  if (!opts.confirmed) return { ok: false, error: "恢复系统默认需要确认", needConfirm: true };
  const data = readBoundaries(pkgDir);
  const userItems = data.items.filter((it) => it.source === "user");
  const restored = emptyBoundaries();
  restored.items = restored.items.concat(userItems);
  writeBoundaries(pkgDir, restored);
  return { ok: true, data: restored };
}

/** Hard rules for system prompt — only enabled items. */
function summarizeBoundariesForPrompt(pkgDir) {
  try {
    const items = (readBoundaries(pkgDir).items || []).filter((it) => it.enabled !== false);
    if (!items.length) return "";
    const lines = items.map((it) => {
      const label = SCOPE_LABELS[it.scope] || it.scope;
      return `- 【${label}】${it.text}`;
    });
    return (
      "## 表达禁区（必须遵守）\n\n" +
      "以下内容不得替本人说出、不得主动引入对话，除非本人当次明确要求且仍需谨慎：\n\n" +
      lines.join("\n")
    );
  } catch {
    return "";
  }
}

module.exports = {
  SCOPES,
  SCOPE_LABELS,
  SYSTEM_DEFAULTS,
  ensureBoundariesScaffold,
  readBoundaries,
  writeBoundaries,
  addBoundary,
  updateBoundary,
  removeBoundary,
  restoreSystemDefaults,
  summarizeBoundariesForPrompt,
};
