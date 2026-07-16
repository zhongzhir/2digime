"use strict";

const SUPPORT_MAP = {
  support: "support",
  supported: "support",
  支持: "support",
  partial: "partial",
  部分支持: "partial",
  none: "none",
  no: "none",
  不支持: "none",
  pending: "pending",
  待核实: "pending",
};

function normalizeSupport(raw) {
  const k = String(raw || "pending").trim().toLowerCase();
  return SUPPORT_MAP[k] || SUPPORT_MAP[String(raw || "").trim()] || "pending";
}

function supportLabel(support) {
  return (
    { support: "支持", partial: "部分支持", none: "不支持", pending: "待核实" }[normalizeSupport(support)] ||
    "待核实"
  );
}

/** When materials exist, content must cite them (not preliminary-only). */
function validateGroundedContent(item, text) {
  const sources = (item && item.sources) || [];
  const body = String(text || "").trim();
  if (!sources.length) {
    return { ok: !!body, mode: "preliminary", issues: body ? [] : ["成果稿为空"] };
  }
  const issues = [];
  if (!body) issues.push("成果稿为空");
  const titles = sources.map((s) => String(s.title || "").trim()).filter(Boolean);
  const matched = titles.filter((t) => {
    const needle = t.length > 16 ? t.slice(0, 16) : t;
    return body.includes(needle) || body.includes(t);
  });
  const claimCount = (item.claimNotes || []).length;
  if (!matched.length && !claimCount) {
    issues.push("答复未引用任何参考材料，请补充依据或重新生成");
  }
  if (/初步[，,、]?尚未对照|尚未对照材料/i.test(body)) {
    issues.push("已有参考材料时不应标注「尚未对照材料」");
  }
  return {
    ok: issues.length === 0,
    mode: "grounded",
    issues,
    matchedSources: matched,
  };
}

function validateGroundedExport(item, draftText) {
  const v = validateGroundedContent(item, draftText);
  if (!v.ok && v.mode === "grounded") {
    return {
      ok: false,
      message: "导出前请先核对依据：\n" + v.issues.join("\n"),
      issues: v.issues,
    };
  }
  return { ok: true, mode: v.mode, issues: [] };
}

function findSourceIdByTitle(sources, titleFragment) {
  const frag = String(titleFragment || "").trim().toLowerCase();
  if (!frag) return null;
  const hit =
    sources.find((s) => String(s.title || "").toLowerCase().includes(frag)) ||
    sources.find((s) => frag.includes(String(s.title || "").toLowerCase().slice(0, 8)));
  return hit ? hit.id : null;
}

/** Parse ## 结论与依据 section into claimNotes. */
function parseClaimNotesFromText(text, sources) {
  const body = String(text || "");
  const m = body.match(/##\s*结论与依据\s*\n([\s\S]*?)(?=\n##\s|$)/i);
  if (!m) return [];
  const block = m[1];
  const lines = block.split(/\n/).filter((l) => /^\s*[-*]/.test(l));
  const notes = [];
  for (const line of lines) {
    const cleaned = line.replace(/^\s*[-*]\s*/, "").trim();
    if (!cleaned) continue;
    const bracket = cleaned.match(/^\[([^\]]+)\]\s*(.+)$/);
    let support = "pending";
    let rest = cleaned;
    if (bracket) {
      support = normalizeSupport(bracket[1]);
      rest = bracket[2].trim();
    }
    let claim = rest;
    let note = "";
    const dash = rest.match(/^(.+?)\s*[—–-]\s*(.+)$/);
    if (dash) {
      claim = dash[1].trim();
      note = dash[2].trim();
    }
    const srcFrag = note.match(/[《「]([^》」]+)[》」]/) || note.match(/材料[：:]\s*(.+)/);
    const sourceIds = [];
    if (srcFrag) {
      const sid = findSourceIdByTitle(sources, srcFrag[1]);
      if (sid) sourceIds.push(sid);
    }
    notes.push({
      id: "cl_" + Date.now().toString(36) + "_" + notes.length,
      claim,
      support,
      note,
      sourceIds,
      edited: false,
    });
  }
  return notes.slice(0, 30);
}

function buildGroundedSystemAppend(item) {
  const n = (item.sources || []).length;
  if (!n) {
    return (
      "当前无参考材料：须在答复开头注明「初步，尚未对照材料」；" +
      "禁止编造无出处的事实与数字。"
    );
  }
  return (
    `当前有 ${n} 份参考材料：结论须挂材料标题；缺证据写「待核实」；` +
    "禁止编造未见于材料的数字；禁止标注「尚未对照材料」。答复末尾须含「## 结论与依据」小节，" +
    "每条格式：- [支持|部分支持|不支持|待核实] 结论 — 依据：材料标题"
  );
}

module.exports = {
  normalizeSupport,
  supportLabel,
  validateGroundedContent,
  validateGroundedExport,
  parseClaimNotesFromText,
  buildGroundedSystemAppend,
};
