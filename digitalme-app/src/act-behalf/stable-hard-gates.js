"use strict";

/**
 * TASK-QUALITY-STABILIZE-01 — Channel A hard gates only.
 *
 * Soft quality / grounding / semantic coverage NEVER block baseline persistence.
 */

const OBVIOUS_PLACEHOLDER_RES = Object.freeze([
  /待填写/,
  /待补充/,
  /\bTODO\b/,
  /\bTBD\b/,
  /目标：\s*$/m,
  /范围：\s*$/m,
  /\[项目名称\]/,
  /\{\{[a-zA-Z0-9_.-]+\}\}/,
]);

/**
 * @returns {{ ok: true } | { ok: false, code: string, message: string, issues?: object[] }}
 */
function assertBaselineHardGates(text, opts) {
  const body = String(text || "").trim();
  if (!body || body.length < 20) {
    return {
      ok: false,
      code: "empty_content",
      message: "未能生成可用正文，暂未保存成果。",
    };
  }
  const issues = [];
  for (const re of OBVIOUS_PLACEHOLDER_RES) {
    const m = re.exec(body);
    if (m) {
      issues.push({
        category: "placeholder",
        severity: "blocking",
        message: "正文仍含未填写的占位内容。",
        matchedText: m[0],
        ruleId: "obvious_placeholder",
      });
      break;
    }
  }
  if (issues.length) {
    return {
      ok: false,
      code: "obvious_placeholder",
      message: "生成的内容仍包含未填写部分，暂未保存。",
      issues,
    };
  }
  void opts;
  return { ok: true };
}

function throwHardGate(result) {
  if (result && result.ok) return;
  const e = new Error((result && result.message) || "基础成果未通过硬门禁。");
  e.code = (result && result.code) || "invalid_artifact";
  e.placeholderIssues = result && result.issues;
  e.failureStage = "baseline_validation";
  throw e;
}

module.exports = {
  OBVIOUS_PLACEHOLDER_RES,
  assertBaselineHardGates,
  throwHardGate,
};
