"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { resolveInsidePackage, normalizeRel } = require("./paths");

function ensureSectionText(text, section) {
  if (text.includes(section)) return text;
  return text.trimEnd() + '\n\n' + section + '\n\n> 由对话反馈确认后沉淀，供后续输出参考。\n';
}

function applyOps(packageDir, ops) {
  const affected = [];
  for (const op of ops || []) {
    const rel = normalizeRel(op.path);
    const abs = resolveInsidePackage(packageDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (op.type === 'append_jsonl') {
      let maxId = 0;
      if (fs.existsSync(abs)) {
        for (const l of fs.readFileSync(abs, "utf8").split("\n")) {
          const mm = /"id"\s*:\s*"(?:core|mem|fb)_(\d+)"/.exec(l);
          if (mm) maxId = Math.max(maxId, parseInt(mm[1], 10));
        }
      }
      const row = { ...op.row };
      if (!row.id) row.id = 'fb_' + String(maxId + 1).padStart(3, '0');
      if (!row.createdAt) row.createdAt = new Date().toISOString();
      const raw = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
      const needsNL = raw.length > 0 && !raw.endsWith('\n');
      fs.appendFileSync(abs, (needsNL ? "\n" : "") + JSON.stringify(row) + "\n", "utf8");
      affected.push(rel);
    } else if (op.type === 'ensure_section_append') {
      let text = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
      text = ensureSectionText(text, op.section);
      text = text.endsWith('\n') ? text : text + '\n';
      text += String(op.line) + '\n';
      fs.writeFileSync(abs, text, "utf8");
      affected.push(rel);
    } else if (op.type === 'write_text') {
      fs.writeFileSync(abs, String(op.content ?? ""), "utf8");
      affected.push(rel);
    } else {
      const err = new Error('unknown_op');
      err.code = 'unknown_op';
      throw err;
    }
  }
  return [...new Set(affected)];
}

module.exports = { applyOps, ensureSectionText };
