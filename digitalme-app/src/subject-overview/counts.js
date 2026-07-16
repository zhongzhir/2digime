"use strict";

const fs = require("node:fs");
const path = require("node:path");

function warn(warnings, code, message, extra) {
  warnings.push({ code, message, ...(extra || {}) });
}

function unknown(provenance, breakdown = []) {
  return { count: null, countStatus: "unknown", provenance, breakdown };
}

function measured(count, provenance, breakdown, countStatus = "known") {
  return { count, countStatus, provenance, breakdown: breakdown || [] };
}

function readJson(filePath, warnings, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    if (e && e.code !== "ENOENT") {
      warn(warnings, "json_parse_error", `${label}无法解析`, {
        path: path.relative(path.dirname(filePath), filePath),
      });
    }
    return null;
  }
}

function readJsonl(filePath, warnings, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    if (e && e.code !== "ENOENT") {
      warn(warnings, "file_unreadable", `${label}无法读取`, { path: path.basename(filePath) });
    }
    return null;
  }
  const rows = [];
  const lines = raw.split(/\r?\n/).filter((line) => line.trim());
  for (const line of lines) {
    try {
      rows.push(JSON.parse(line));
    } catch {
      warn(warnings, "jsonl_parse_error", `${label}存在无法解析的行`, {
        path: path.basename(filePath),
      });
      return null;
    }
  }
  return rows;
}

function countJsonArray(filePath, key, warnings, label) {
  if (!fs.existsSync(filePath)) return unknown(label);
  const data = readJson(filePath, warnings, label);
  if (!data) return unknown(label);
  const rows = key ? data[key] : data;
  if (!Array.isArray(rows)) {
    warn(warnings, "json_shape_invalid", `${label}格式不符合预期`, {
      path: path.basename(filePath),
    });
    return unknown(label);
  }
  return measured(rows.length, label, [{ source: label, count: rows.length }]);
}

function countMarkdownItems(filePath, warnings, label) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    if (e && e.code !== "ENOENT") {
      warn(warnings, "file_unreadable", `${label}无法读取`, { path: path.basename(filePath) });
    }
    return unknown(label);
  }
  const count = raw.split(/\r?\n/).filter((line) => /^\s*[-*]\s+\S/.test(line)).length;
  return measured(count, label, [{ source: label, count }]);
}

function combinePartial(parts, provenance) {
  const measurable = parts.filter(
    (part) => typeof part.count === "number" && part.countStatus !== "unknown"
  );
  if (!measurable.length) {
    return unknown(provenance, parts.flatMap((part) => part.breakdown || []));
  }
  const count = measurable.reduce((sum, part) => sum + part.count, 0);
  const hasUnknown = measurable.length !== parts.length;
  const possibleOverlap = measurable.length > 1;
  return measured(
    count,
    provenance,
    parts.flatMap((part) => part.breakdown || []),
    hasUnknown || possibleOverlap ? "partial" : measurable[0].countStatus
  );
}

function countEvidence(root, warnings) {
  // source-index is canonical; raw-memory may contain duplicate excerpts.
  return countJsonArray(
    path.join(root, "sources", "source-index.json"),
    "sources",
    warnings,
    "来源索引"
  );
}

function countFacts(root, warnings) {
  const markdown = path.join(root, "identity-facts.md");
  if (fs.existsSync(markdown)) {
    // identity-facts.md is canonical when present; count actual bullet facts.
    return countMarkdownItems(markdown, warnings, "身份事实清单");
  }
  return countJsonArray(
    path.join(root, "identity.json"),
    "identityClaims",
    warnings,
    "身份事实"
  );
}

function countFeedbackSection(stylePath, warnings) {
  let raw;
  try {
    raw = fs.readFileSync(stylePath, "utf8");
  } catch (e) {
    if (e && e.code !== "ENOENT") {
      warn(warnings, "file_unreadable", "风格指南无法读取", { path: "style-guide.md" });
    }
    return unknown("风格纠正");
  }
  const heading = "## 用户反馈（风格纠正）";
  const start = raw.indexOf(heading);
  if (start < 0) return measured(0, "风格纠正", [{ source: "风格纠正", count: 0 }]);
  const rest = raw.slice(start + heading.length);
  const nextHeading = rest.search(/\n##\s+/);
  const section = nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
  const count = section.split(/\r?\n/).filter((line) => /^\s*[-*]\s+\S/.test(line)).length;
  return measured(count, "风格纠正", [{ source: "风格纠正", count }]);
}

function isConfirmedOwnerAssertion(row) {
  if (!row || typeof row !== "object") return false;
  if (row.dataKind === "owner_assertion") return true;
  if (row.ownerConfirmed === true || row.confirmedBy === "owner") return true;
  if (
    row.confirmation &&
    row.confirmation.confirmed === true &&
    (row.confirmation.actor === "owner" || row.confirmation.confirmedBy === "owner")
  ) {
    return true;
  }
  return Array.isArray(row.sourceRefs) && row.sourceRefs.some((ref) => String(ref) === "feedback");
}

function countOwnerMemory(memoryPath, warnings) {
  const rows = readJsonl(memoryPath, warnings, "长期记忆");
  if (!rows) return unknown("已确认长期记忆");
  const count = rows.filter(isConfirmedOwnerAssertion).length;
  return measured(count, "已确认长期记忆", [{ source: "已确认长期记忆", count }]);
}

function countOwnerAssertions(root, warnings) {
  const feedback = countFeedbackSection(path.join(root, "style-guide.md"), warnings);
  const memory = countOwnerMemory(
    path.join(root, "memory", "long-term-memory.jsonl"),
    warnings
  );
  // preferences.json has no per-record Owner confirmation metadata in v0.1.
  const preferences = fs.existsSync(path.join(root, "preferences.json"))
    ? unknown("偏好（确认状态未知）", [
        { source: "偏好", count: null, status: "confirmation_unknown" },
      ])
    : unknown("偏好（未建立）");
  return combinePartial([feedback, memory, preferences], "风格纠正、已确认长期记忆；偏好待确认");
}

function countInferences(root, warnings) {
  const rows = readJsonl(path.join(root, "life", "inferences.jsonl"), warnings, "系统推断");
  if (!rows) return unknown("系统推断");
  const breakdown = { open: 0, confirmed: 0, other: 0, rejected: 0 };
  for (const row of rows) {
    const status = String((row && row.status) || "open");
    if (status === "rejected") breakdown.rejected += 1;
    else if (status === "confirmed") breakdown.confirmed += 1;
    else if (status === "open") breakdown.open += 1;
    else breakdown.other += 1;
  }
  const count = breakdown.open + breakdown.confirmed + breakdown.other;
  return measured(count, "系统推断（已排除拒绝项）", [
    { source: "待校对", count: breakdown.open },
    { source: "已确认", count: breakdown.confirmed },
    { source: "其他当前状态", count: breakdown.other },
    { source: "已拒绝（未计入）", count: breakdown.rejected },
  ]);
}

function countDefinitionProfiles(defDir, warnings) {
  let names;
  try {
    names = fs.readdirSync(defDir);
  } catch (e) {
    if (e && e.code !== "ENOENT") {
      warn(warnings, "readdir_failed", "定义目录无法读取", { path: "definitions" });
    }
    return unknown("有效定义文件");
  }
  const files = names.filter((name) => name.endsWith(".json"));
  let valid = 0;
  let invalid = 0;
  for (const name of files) {
    const parsed = readJson(path.join(defDir, name), warnings, `定义文件 ${name}`);
    if (parsed && typeof parsed === "object") valid += 1;
    else invalid += 1;
  }
  return measured(
    valid,
    "有效定义文件",
    [
      { source: "有效定义文件", count: valid },
      { source: "损坏定义文件（未计入）", count: invalid },
    ],
    invalid ? "partial" : "known"
  );
}

function countLayerData(pkgDir, ctx) {
  const warnings = ctx.warnings;
  const root = path.resolve(pkgDir);
  const currentState = combinePartial(
    [
      (() => {
        const rows = readJsonl(path.join(root, "life", "events.jsonl"), warnings, "人生事件");
        return rows
          ? measured(rows.length, "人生事件", [{ source: "人生事件", count: rows.length }])
          : unknown("人生事件");
      })(),
      countJsonArray(path.join(root, "life", "roles.json"), "items", warnings, "角色"),
      countJsonArray(path.join(root, "life", "outcomes.json"), "items", warnings, "成就"),
      countJsonArray(path.join(root, "life", "people.json"), "items", warnings, "关系人"),
      countDefinitionProfiles(path.join(root, "definitions"), warnings),
    ],
    "人生事件、角色、成就、关系人和有效定义（可能重叠）"
  );
  const developmentIntent = combinePartial(
    [
      countJsonArray(path.join(root, "life", "mind_hooks.json"), "items", warnings, "观念线索"),
      countJsonArray(path.join(root, "life", "interests.json"), "items", warnings, "兴趣方向"),
      countJsonArray(
        path.join(root, "life", "capability_signals.json"),
        "items",
        warnings,
        "能力信号"
      ),
    ],
    "观念线索、兴趣方向和能力信号（可能重叠）"
  );
  const capabilityPolicy = combinePartial(
    [
      countJsonArray(
        path.join(root, "policies", "boundaries.json"),
        "items",
        warnings,
        "边界条目"
      ),
      countJsonArray(
        path.join(root, "skills", "skill-index.json"),
        "skills",
        warnings,
        "技能索引"
      ),
    ],
    "边界条目和技能索引"
  );

  return {
    evidence: countEvidence(root, warnings),
    fact: countFacts(root, warnings),
    owner_assertion: countOwnerAssertions(root, warnings),
    inference: countInferences(root, warnings),
    current_state: currentState,
    development_intent: developmentIntent,
    capability_policy: capabilityPolicy,
  };
}

module.exports = { countLayerData, isConfirmedOwnerAssertion };
