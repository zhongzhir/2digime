"use strict";

/**
 * Structured placeholder analysis for deliverable drafts.
 * Only blocking_placeholder issues should prevent artifact write.
 */

const crypto = require("node:crypto");

const ISSUE_BLOCKING = "blocking_placeholder";
const ISSUE_WARNING = "warning_placeholder";
const ISSUE_EXPLANATORY = "explanatory_occurrence";

const EMPTY_VALUE_RES = [
  /^[_\s…\.·\-—–]+$/,
  /^x{2,}$/i,
  /^tbc$/i,
  /^待定$/,
  /^待填写$/,
  /^待补充$/,
  /^待完善$/,
  /^待输入$/,
  /^请填写$/,
  /^\[请填写[^\]]*\]$/,
  /^\{\{[^}]+\}\}$/,
  /^xxx+$/i,
  /^n\/a$/i,
  /^none$/i,
  /^null$/i,
];

const FIELD_LABELS = [
  "项目名称",
  "项目名",
  "CEO姓名",
  "CEO 姓名",
  "负责人",
  "日期",
  "联系人",
  "客户名称",
  "公司名称",
];

function sha256Text(text) {
  return "sha256:" + crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function lineNumberAt(text, index) {
  return text.slice(0, Math.max(0, index)).split("\n").length;
}

function contextSnippet(text, index, len) {
  const half = Math.floor((len || 48) / 2);
  const start = Math.max(0, index - half);
  const end = Math.min(text.length, index + half);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}

function isEmptyFieldValue(value) {
  const v = String(value || "").trim();
  if (!v) return true;
  return EMPTY_VALUE_RES.some((re) => re.test(v));
}

function isNegationOrExplanatoryContext(line, matchStart) {
  const before = line.slice(0, Math.max(0, matchStart));
  return /(?:不得|禁止|不使用|不应|不能|勿|避免|无|没有|不含|不含任何|不含未|不含.*占位|反例|例如说明|规则|检测|说明|当前无|暂无)/.test(
    before
  );
}

function isInCodeFence(lines, lineIndex) {
  let open = false;
  for (let i = 0; i <= lineIndex; i++) {
    const t = String(lines[i] || "").trim();
    if (t.startsWith("```")) open = !open;
  }
  return open;
}

function pushIssue(issues, issue) {
  const key = [
    issue.ruleId,
    issue.lineNumber,
    issue.matchedText,
    issue.issueType,
  ].join("|");
  if (issues.some((x) => [x.ruleId, x.lineNumber, x.matchedText, x.issueType].join("|") === key)) {
    return;
  }
  issues.push(issue);
}

function stripMarkdownInline(s) {
  return String(s || "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .trim();
}

function analyzeFieldLine(line, lineNo, issues) {
  const m = line.match(/^(.{0,60}?[:：]\s*)(.*)$/);
  if (!m) return;
  const labelText = stripMarkdownInline(m[1].replace(/[:：]\s*$/, ""));
  const valuePart = m[2];
  const compactLabel = labelText.replace(/\s+/g, "");
  const isKnownLabel = FIELD_LABELS.some(
    (lbl) => compactLabel.includes(lbl.replace(/\s+/g, "")) || labelText.includes(lbl)
  );
  if (!isKnownLabel && !/^(?:字段|项|属性)/.test(labelText)) return;

  if (isEmptyFieldValue(valuePart)) {
    pushIssue(issues, {
      issueType: ISSUE_BLOCKING,
      matchedText: line.trim().slice(0, 80),
      lineNumber: lineNo,
      contextSnippet: line.trim().slice(0, 80),
      severity: "high",
      ruleId: "unfilled_field_label",
    });
    return;
  }

  if (isKnownLabel && !isEmptyFieldValue(valuePart) && valuePart.trim().length >= 2) {
    return;
  }
}

function analyzeTemplateFeatureList(line, lineNo, issues) {
  if (isNegationOrExplanatoryContext(line, 0)) return;
  const trimmed = line.trim();
  if (/^功能[一二三四五六七八九十][:：]?\s*$/.test(trimmed)) {
    pushIssue(issues, {
      issueType: ISSUE_BLOCKING,
      matchedText: trimmed,
      lineNumber: lineNo,
      contextSnippet: trimmed,
      severity: "high",
      ruleId: "template_feature_slot",
    });
    return;
  }
  if (/^[-*•]\s*功能[一二三四五六七八九十]\s*$/.test(trimmed)) {
    pushIssue(issues, {
      issueType: ISSUE_BLOCKING,
      matchedText: trimmed,
      lineNumber: lineNo,
      contextSnippet: trimmed,
      severity: "high",
      ruleId: "template_feature_slot",
    });
  }
}

function analyzeGlobalPatterns(text, issues) {
  const checks = [
    {
      ruleId: "lorem_ipsum",
      re: /lorem\s+ipsum/i,
      blocking: true,
    },
    {
      ruleId: "object_object",
      re: /\[object Object\]/i,
      blocking: true,
    },
    {
      ruleId: "mustache_placeholder",
      re: /\{\{[a-zA-Z0-9_.-]+\}\}/,
      blocking: true,
    },
    {
      ruleId: "bracket_fill_me",
      re: /\[请填写[^\]]*\]/,
      blocking: true,
    },
    {
      ruleId: "xx_percent_template",
      re: /XX\s*%/i,
      blocking: (line) => !isNegationOrExplanatoryContext(line, line.search(/XX\s*%/i)),
    },
    {
      ruleId: "standalone_todo_tbc",
      re: /(?:^|\s)(?:TODO|TBC)(?:\s|$)/i,
      blocking: (line, lineIndex, allLines) => {
        if (isInCodeFence(allLines, lineIndex)) return false;
        const idx = line.search(/(?:TODO|TBC)/i);
        return idx >= 0 && !isNegationOrExplanatoryContext(line, idx);
      },
    },
  ];

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isInCodeFence(lines, i)) continue;

    for (const chk of checks) {
      const m = chk.re.exec(line);
      if (!m) continue;
      const block =
        typeof chk.blocking === "function" ? chk.blocking(line, i, lines) : chk.blocking;
      if (!block) continue;
      pushIssue(issues, {
        issueType: ISSUE_BLOCKING,
        matchedText: m[0],
        lineNumber: i + 1,
        contextSnippet: contextSnippet(line, m.index, 60),
        severity: "high",
        ruleId: chk.ruleId,
      });
    }

    analyzeFieldLine(line, i + 1, issues);
    analyzeTemplateFeatureList(line, i + 1, issues);

    for (const token of ["待填写", "待补充"]) {
      const idx = line.indexOf(token);
      if (idx < 0) continue;
      if (isNegationOrExplanatoryContext(line, idx)) {
        pushIssue(issues, {
          issueType: ISSUE_EXPLANATORY,
          matchedText: token,
          lineNumber: i + 1,
          contextSnippet: line.trim().slice(0, 80),
          severity: "low",
          ruleId: "explanatory_pending_token",
        });
        continue;
      }
      if (/[:：]\s*待填写/.test(line) || /[:：]\s*待补充/.test(line) || /^待填写[:：]/.test(line.trim())) {
        pushIssue(issues, {
          issueType: ISSUE_BLOCKING,
          matchedText: token,
          lineNumber: i + 1,
          contextSnippet: line.trim().slice(0, 80),
          severity: "high",
          ruleId: "pending_field_token",
        });
      }
    }

    const zhanweiIdx = line.indexOf("占位");
    if (zhanweiIdx >= 0) {
      const explanatory = isNegationOrExplanatoryContext(line, zhanweiIdx) || /占位(?:符|规则|检测|内容说明)/.test(line);
      pushIssue(issues, {
        issueType: explanatory ? ISSUE_EXPLANATORY : ISSUE_WARNING,
        matchedText: "占位",
        lineNumber: i + 1,
        contextSnippet: line.trim().slice(0, 80),
        severity: explanatory ? "low" : "medium",
        ruleId: explanatory ? "explanatory_placeholder_mention" : "placeholder_word",
      });
    }
  }
}

function analyzeTemplateShell(text, issues) {
  const body = String(text || "").trim();
  if (body.length < 12) return;

  const normalized = body.replace(/^#\s+[^\n]+\n+/, "");
  const sections = normalized.split(/^#{2,3}\s+/m).filter(Boolean);
  if (sections.length < 3) return;

  let emptySections = 0;
  for (const sec of sections) {
    const content = sec.replace(/^[^\n]+\n?/, "").trim();
    if (!content || content.length < 20) emptySections += 1;
  }
  const ratio = emptySections / sections.length;
  if (ratio >= 0.75 && body.length < 600) {
    pushIssue(issues, {
      issueType: ISSUE_BLOCKING,
      matchedText: "template sections without body",
      lineNumber: 1,
      contextSnippet: "多个章节缺少实质正文",
      severity: "high",
      ruleId: "template_shell_only",
    });
  }
}

function analyzePlaceholderIssues(text) {
  const issues = [];
  analyzeGlobalPatterns(String(text || ""), issues);
  analyzeTemplateShell(String(text || ""), issues);
  return issues;
}

function getBlockingPlaceholderIssues(text) {
  return analyzePlaceholderIssues(text).filter((i) => i.issueType === ISSUE_BLOCKING);
}

function findPlaceholderIssues(text) {
  return getBlockingPlaceholderIssues(text).map((i) => i.ruleId);
}

function validatePlaceholderContent(text) {
  const issues = analyzePlaceholderIssues(text);
  const blockingIssues = issues.filter((i) => i.issueType === ISSUE_BLOCKING);
  const warningIssues = issues.filter((i) => i.issueType === ISSUE_WARNING);
  const body = String(text || "");
  return {
    issues,
    blockingIssues,
    warningIssues,
    hasBlocking: blockingIssues.length > 0,
    outputLength: body.length,
    modelOutputDigest: sha256Text(body),
  };
}

function userFacingIssueSummary(issues) {
  const blocking = (issues || []).filter((i) => i.issueType === ISSUE_BLOCKING);
  if (!blocking.length) return null;
  const ruleIds = new Set(blocking.map((i) => i.ruleId));
  if (ruleIds.has("template_shell_only") || ruleIds.has("insufficient_body")) {
    return "正文内容不足";
  }
  if (ruleIds.has("unfilled_field_label") || ruleIds.has("pending_field_token") || ruleIds.has("bracket_fill_me")) {
    return "有字段尚未填写";
  }
  if (ruleIds.has("template_feature_slot") || ruleIds.has("mustache_placeholder")) {
    return "部分章节仍是模板";
  }
  return "部分章节仍是模板";
}

function buildRepairIssueLines(issues) {
  return (issues || [])
    .filter((i) => i.issueType === ISSUE_BLOCKING)
    .slice(0, 10)
    .map((i) => {
      // Reviewer-originated issues carry a plain message; render it directly.
      if (i.message) {
        const where = Number.isInteger(i.lineNumber) && i.lineNumber > 0 ? `（约第 ${i.lineNumber} 行）` : "";
        return `· ${String(i.message).slice(0, 120)}${where}`;
      }
      const hint =
        i.ruleId === "unfilled_field_label"
          ? "未填写字段"
          : i.ruleId === "template_feature_slot"
            ? "模板项"
            : i.ruleId === "template_shell_only"
              ? "章节缺少正文"
              : "占位内容";
      return `第 ${i.lineNumber} 行仍含${hint}：${String(i.contextSnippet || i.matchedText || "").slice(0, 60)}`;
    });
}

function buildFailureEvidence({ attemptId, deliverableId, draft, issues, failureCode, failureStage }) {
  const validation = validatePlaceholderContent(draft || "");
  return {
    attemptId: String(attemptId || ""),
    deliverableId: String(deliverableId || ""),
    modelOutputDigest: validation.modelOutputDigest,
    outputLength: validation.outputLength,
    placeholderIssues: (issues || validation.blockingIssues).map((i) => ({
      issueType: i.issueType,
      matchedText: String(i.matchedText || "").slice(0, 80),
      lineNumber: i.lineNumber,
      contextSnippet: String(i.contextSnippet || "").slice(0, 80),
      severity: i.severity,
      ruleId: i.ruleId,
    })),
    failureCode: failureCode || "placeholder_content_rejected",
    failureStage: failureStage || "prewrite_validation",
    createdAt: new Date().toISOString(),
  };
}

module.exports = {
  ISSUE_BLOCKING,
  ISSUE_WARNING,
  ISSUE_EXPLANATORY,
  analyzePlaceholderIssues,
  getBlockingPlaceholderIssues,
  findPlaceholderIssues,
  validatePlaceholderContent,
  userFacingIssueSummary,
  buildRepairIssueLines,
  buildFailureEvidence,
  sha256Text,
};
