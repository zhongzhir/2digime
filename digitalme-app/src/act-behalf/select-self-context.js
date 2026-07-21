"use strict";

/**
 * Select a bounded slice of self/package data for one act-behalf task.
 * Never dump the entire private package into the model prompt.
 */

const DEFAULT_BUDGET = 5500;

function truncateText(text, max) {
  const s = String(text || "").trim();
  if (!s) return "";
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

/**
 * @param {object} pkg package:load shaped object
 * @param {{ budget?: number }} [opts]
 */
function buildSelectedSelfContext(pkg, opts = {}) {
  const budget = typeof opts.budget === "number" && opts.budget > 500 ? opts.budget : DEFAULT_BUDGET;
  const candidates = [
    { source: "persona", label: "人格与自我描述", text: pkg && pkg.persona, share: 0.28 },
    { source: "life", label: "人生与经历摘要", text: pkg && pkg.lifeSummary, share: 0.22 },
    { source: "style", label: "表达风格", text: pkg && pkg.styleGuide, share: 0.12 },
    { source: "boundaries", label: "边界与禁忌", text: pkg && pkg.boundariesSummary, share: 0.12 },
    { source: "memory", label: "长期记忆摘录", text: pkg && pkg.longTermMemory, share: 0.16 },
    { source: "frameworks", label: "判断框架摘录", text: pkg && pkg.decisionFrameworks, share: 0.1 },
  ];

  /** @type {{ source: string, label: string, text: string }[]} */
  const items = [];
  let used = 0;
  for (const c of candidates) {
    const raw = String(c.text || "").trim();
    if (!raw) continue;
    const room = budget - used;
    if (room < 80) break;
    const cap = Math.min(room, Math.max(120, Math.floor(budget * c.share)));
    const text = truncateText(raw, cap);
    if (!text) continue;
    items.push({ source: c.source, label: c.label, text });
    used += text.length;
  }

  const combinedText = items
    .map((it) => `### ${it.label}\n${it.text}`)
    .join("\n\n");

  return {
    items,
    combinedText,
    userEdited: false,
    charCount: combinedText.length,
    budget,
    note:
      items.length > 0
        ? "以下为从主体资料中生成的有界初始摘录，须由你在任务提交前确认或编辑。这不是按目标完成的任务相关选择。"
        : "当前主体资料不足。请在下方补充本次任务需要用到的本人信息。",
  };
}

module.exports = {
  DEFAULT_BUDGET,
  truncateText,
  buildSelectedSelfContext,
};
