"use strict";

/**
 * Material routing: persona distill / identity facts / custody vault.
 * User-facing 3 kinds; internal store under userData.
 */

const fs = require("node:fs");
const path = require("node:path");

const MATERIAL_KINDS = [
  {
    id: "persona",
    label: "人格蒸馏",
    blurb: "文章、方案、带你判断的笔记——用来学习你怎么想、怎么说。",
    actionLabel: "开始蒸馏",
    writeLabel: "写入已勾选内容",
  },
  {
    id: "identity",
    label: "社会事实",
    blurb: "工作履历、社会任职、项目参与——记下角色、机构与时间，而不是整份表格再抄一遍。",
    actionLabel: "登记社会事实",
    writeLabel: "写入已勾选事实",
  },
  {
    id: "custody",
    label: "仅保管",
    blurb: "只在本机留存，不进入会对话的数字之我；不会用来学习文风。",
    actionLabel: "收入保管库",
    writeLabel: "确认保管",
  },
];

function kindMeta(id) {
  return MATERIAL_KINDS.find((k) => k.id === id) || MATERIAL_KINDS[0];
}

function materialsRoot(userData) {
  const dir = path.join(userData, "materials");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function vaultIndexPath(userData) {
  return path.join(materialsRoot(userData), "custody-index.json");
}

function identityArchivePath(userData) {
  return path.join(materialsRoot(userData), "identity-archive.json");
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

function isoNow() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return prefix + "_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
}

/** Register files in local custody vault (no Package persona write). */
function addCustodyItems(userData, items) {
  const file = vaultIndexPath(userData);
  const data = readJson(file, { version: 1, items: [] });
  const added = [];
  for (const it of items || []) {
    const entry = {
      id: makeId("custody"),
      title: it.title || path.basename(it.filePath || "material"),
      filePath: it.filePath || "",
      chars: it.chars || 0,
      excerpt: String(it.excerpt || "").slice(0, 800),
      sensitivity: it.sensitivity || "private",
      injectIntoPersona: false,
      injectIntoChat: false,
      createdAt: isoNow(),
      note: it.note || "仅保管：不进入人格蒸馏与对话注入",
    };
    data.items.unshift(entry);
    added.push(entry);
  }
  writeJson(file, data);
  return { count: added.length, items: added };
}

function listCustody(userData) {
  return readJson(vaultIndexPath(userData), { version: 1, items: [] });
}

/** Archive identity extraction run (local) + optional Package claims write. */
function archiveIdentityRun(userData, record) {
  const file = identityArchivePath(userData);
  const data = readJson(file, { version: 1, runs: [] });
  const entry = {
    id: makeId("idrun"),
    title: record.title || "身份材料",
    filePath: record.filePath || "",
    claims: record.claims || [],
    facts: record.facts || [],
    createdAt: isoNow(),
  };
  data.runs.unshift(entry);
  writeJson(file, data);
  return entry;
}

const CLAIM_TYPES = new Set([
  "background",
  "profession",
  "role",
  "education",
  "affiliation",
  "interest",
  "project",
  "skill",
  "other",
]);

function normalizeClaim(c) {
  if (!c || typeof c.value !== "string" || !c.value.trim()) return null;
  const type = CLAIM_TYPES.has(c.type) ? c.type : "other";
  return { type, value: c.value.trim() };
}

/** Append selected claims into package identity.json */
function writeIdentityClaims(pkgDir, claims, sourceId) {
  const file = path.join(pkgDir, "identity.json");
  if (!fs.existsSync(file)) throw new Error("Package 中找不到 identity.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(data.identityClaims)) data.identityClaims = [];
  const existing = new Set(data.identityClaims.map((c) => String(c.value || "").trim()));
  let added = 0;
  for (const raw of claims || []) {
    const c = normalizeClaim(raw);
    if (!c || existing.has(c.value)) continue;
    data.identityClaims.push({
      type: c.type,
      value: c.value,
      sourceRefs: sourceId ? [sourceId] : [],
      recordedAt: isoNow(),
    });
    existing.add(c.value);
    added++;
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  return added;
}

/** Append plain facts as a dated block in identity-facts.md (Package). */
function appendIdentityFacts(pkgDir, facts, sourceTitle, sourceId) {
  const clean = (facts || []).filter((f) => typeof f === "string" && f.trim());
  if (!clean.length) return 0;
  const file = path.join(pkgDir, "identity-facts.md");
  const block =
    `\n\n## ${sourceTitle || "身份事实"}\n` +
    `> 来源：${sourceId || "local"} · ${isoNow()}\n\n` +
    clean.map((f) => "- " + f.trim()).join("\n") +
    "\n";
  if (!fs.existsSync(file)) {
    fs.writeFileSync(
      file,
      "# 身份与履历事实\n\n> 由「身份事实」材料提取；不当作写作风格或价值观蒸馏结果。\n",
      "utf8"
    );
  }
  fs.appendFileSync(file, block, "utf8");
  return clean.length;
}

function registerIdentitySource(pkgDir, sourceMeta) {
  const file = path.join(pkgDir, "sources", "source-index.json");
  if (!fs.existsSync(file)) return;
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!data.sources) data.sources = [];
  if (!data.sources.some((s) => s.id === sourceMeta.id)) {
    data.sources.push(sourceMeta);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  }
}

/**
 * Legacy identity write — blocked (P1-07).
 * Must not bypass PackageStore; use life/package-write preview + commit.
 */
function writeIdentityBack() {
  const e = new Error(
    "身份事实不得再直接写入 Package；请经 PackageStore 预览并确认后提交。"
  );
  e.code = "materials_identity_direct_write_blocked";
  throw e;
}

module.exports = {
  MATERIAL_KINDS,
  kindMeta,
  addCustodyItems,
  listCustody,
  archiveIdentityRun,
  writeIdentityClaims,
  appendIdentityFacts,
  writeIdentityBack,
};
