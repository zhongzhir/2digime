"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readJson } = require("../package-store/fs-util");

function warn(warnings, code, message, extra) {
  warnings.push({ code, message, ...(extra && typeof extra === "object" ? extra : {}) });
}

function safeReadText(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch (e) {
    return { error: e };
  }
}

function countJsonlLines(filePath, warnings, label) {
  const raw = safeReadText(filePath);
  if (raw && typeof raw === "object" && raw.error) {
    if (raw.error.code === "ENOENT") return { count: null, countStatus: "unknown", provenance: label };
    warn(warnings, "file_unreadable", `${label} 无法读取`, { path: path.basename(filePath) });
    return { count: null, countStatus: "unknown", provenance: label };
  }
  const lines = String(raw)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let valid = 0;
  for (const line of lines) {
    try {
      JSON.parse(line);
      valid += 1;
    } catch {
      warn(warnings, "jsonl_parse_error", `${label} 存在无法解析的行`, {
        path: path.basename(filePath),
      });
      return { count: null, countStatus: "unknown", provenance: label };
    }
  }
  return { count: valid, countStatus: "known", provenance: label };
}

function countJsonArray(filePath, key, warnings, label) {
  if (!fs.existsSync(filePath)) {
    return { count: null, countStatus: "unknown", provenance: label };
  }
  let data;
  try {
    data = readJson(filePath, null);
  } catch (e) {
    warn(warnings, "json_parse_error", `${label} 无法解析`, { path: path.basename(filePath) });
    return { count: null, countStatus: "unknown", provenance: label };
  }
  if (!data) {
    warn(warnings, "json_parse_error", `${label} 无法解析`, { path: path.basename(filePath) });
    return { count: null, countStatus: "unknown", provenance: label };
  }
  const arr = key ? data[key] : data;
  if (!Array.isArray(arr)) {
    return { count: null, countStatus: "unknown", provenance: label };
  }
  return { count: arr.length, countStatus: "known", provenance: label };
}

function countOwnerFeedbackLines(stylePath, warnings) {
  if (!fs.existsSync(stylePath)) {
    return { count: null, countStatus: "unknown", provenance: "style-guide.md" };
  }
  const raw = safeReadText(stylePath);
  if (raw && typeof raw === "object" && raw.error) {
    warn(warnings, "file_unreadable", "风格指南无法读取", { path: "style-guide.md" });
    return { count: null, countStatus: "unknown", provenance: "style-guide.md" };
  }
  const section = "## 用户反馈（风格纠正）";
  const idx = String(raw).indexOf(section);
  if (idx < 0) return { count: 0, countStatus: "known", provenance: "style-guide.md#用户反馈" };
  const tail = String(raw).slice(idx + section.length);
  const lines = tail
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("- "));
  return { count: lines.length, countStatus: "known", provenance: "style-guide.md#用户反馈" };
}

function countDefinitionProfiles(defDir, warnings) {
  if (!fs.existsSync(defDir)) {
    return { count: null, countStatus: "unknown", provenance: "definitions/*.json" };
  }
  let names;
  try {
    names = fs.readdirSync(defDir);
  } catch (e) {
    warn(warnings, "readdir_failed", "定义目录无法读取", { path: "definitions" });
    return { count: null, countStatus: "unknown", provenance: "definitions/*.json" };
  }
  const jsonFiles = names.filter((n) => n.endsWith(".json") && n !== "README.json");
  return { count: jsonFiles.length, countStatus: "known", provenance: "definitions/*.json" };
}

function sumCounts(parts) {
  const known = parts.filter((p) => p.countStatus === "known" && typeof p.count === "number");
  if (!known.length) {
    return { count: null, countStatus: "unknown", provenance: parts.map((p) => p.provenance).join(" + ") };
  }
  if (known.length !== parts.length) {
    return {
      count: known.reduce((n, p) => n + p.count, 0),
      countStatus: "partial",
      provenance: parts.map((p) => p.provenance).join(" + "),
    };
  }
  return {
    count: known.reduce((n, p) => n + p.count, 0),
    countStatus: "known",
    provenance: parts.map((p) => p.provenance).join(" + "),
  };
}

/**
 * Count layer items from explicit package paths (read-only).
 * @param {string} pkgDir
 * @param {{ warnings: object[] }} ctx
 */
function countLayerData(pkgDir, ctx) {
  const warnings = ctx.warnings;
  const root = path.resolve(pkgDir);

  const evidence = sumCounts([
    countJsonArray(path.join(root, "sources", "source-index.json"), "sources", warnings, "来源索引"),
    countJsonlLines(path.join(root, "memory", "raw-memory.jsonl"), warnings, "原始记忆"),
  ]);

  const fact = sumCounts([
    countJsonArray(path.join(root, "identity.json"), "identityClaims", warnings, "身份事实"),
    fs.existsSync(path.join(root, "identity-facts.md"))
      ? { count: 1, countStatus: "known", provenance: "identity-facts.md" }
      : { count: null, countStatus: "unknown", provenance: "identity-facts.md" },
  ]);

  const ownerAssertion = sumCounts([
    countOwnerFeedbackLines(path.join(root, "style-guide.md"), warnings),
    countJsonlLines(path.join(root, "memory", "long-term-memory.jsonl"), warnings, "长期记忆"),
    fs.existsSync(path.join(root, "preferences.json"))
      ? { count: 1, countStatus: "known", provenance: "preferences.json" }
      : { count: null, countStatus: "unknown", provenance: "preferences.json" },
  ]);

  const inference = countJsonlLines(path.join(root, "life", "inferences.jsonl"), warnings, "人生推断");

  const currentState = sumCounts([
    countJsonlLines(path.join(root, "life", "events.jsonl"), warnings, "人生事件"),
    countJsonArray(path.join(root, "life", "roles.json"), "items", warnings, "角色"),
    countJsonArray(path.join(root, "life", "outcomes.json"), "items", warnings, "成就"),
    countJsonArray(path.join(root, "life", "people.json"), "items", warnings, "关系人"),
    countDefinitionProfiles(path.join(root, "definitions"), warnings),
  ]);

  const developmentIntent = sumCounts([
    countJsonArray(path.join(root, "life", "mind_hooks.json"), "items", warnings, "观念线索"),
    countJsonArray(path.join(root, "life", "interests.json"), "items", warnings, "兴趣方向"),
    countJsonArray(path.join(root, "life", "capability_signals.json"), "items", warnings, "能力信号"),
  ]);

  const boundaries = countJsonArray(
    path.join(root, "policies", "boundaries.json"),
    "items",
    warnings,
    "边界条目"
  );
  const skills = countJsonArray(path.join(root, "skills", "skill-index.json"), "skills", warnings, "技能索引");
  const capabilityPolicy = sumCounts([
    boundaries,
    fs.existsSync(path.join(root, "policies", "usage-policy.json"))
      ? { count: 1, countStatus: "known", provenance: "usage-policy.json" }
      : { count: null, countStatus: "unknown", provenance: "usage-policy.json" },
    fs.existsSync(path.join(root, "policies", "authorization-policy.json"))
      ? { count: 1, countStatus: "known", provenance: "authorization-policy.json" }
      : { count: null, countStatus: "unknown", provenance: "authorization-policy.json" },
    skills,
  ]);

  return {
    evidence,
    fact,
    owner_assertion: ownerAssertion,
    inference,
    current_state: currentState,
    development_intent: developmentIntent,
    capability_policy: capabilityPolicy,
  };
}

module.exports = { countLayerData, sumCounts };
