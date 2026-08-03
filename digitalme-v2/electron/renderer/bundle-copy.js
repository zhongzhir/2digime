/**
 * Bundle / 文档成果「复制」载荷解析 — 纯函数，供渲染层与 Node 测试共用。
 * 不写入 quality.grade 原始字段；不混入 manifest/evidence。
 */

/**
 * @param {{
 *   kind?: 'document' | 'bundle',
 *   reportText?: string,
 *   editorText?: string,
 *   qualityGrade?: string | null,
 *   qualityBannerText?: string,
 *   failed?: boolean,
 * }} input
 * @returns {{
 *   ok: boolean,
 *   text?: string,
 *   error?: string,
 *   copyEnabled: boolean,
 * }}
 */
function resolveCopyPayload(input) {
  const failed = !!(input && input.failed);
  if (failed) {
    return {
      ok: false,
      copyEnabled: false,
      error: "当前没有可复制的成果",
    };
  }

  const kind = (input && input.kind) || "document";
  let body = "";

  if (kind === "bundle") {
    body = String((input && input.reportText) || "").trimEnd();
  } else {
    body = String((input && input.editorText) || "").trimEnd();
  }

  if (!body.trim()) {
    return {
      ok: false,
      copyEnabled: true,
      error: "没有可复制的内容",
    };
  }

  let text = body;
  const grade = input && input.qualityGrade ? String(input.qualityGrade) : "";
  if (kind === "bundle" && grade === "degraded_scan_only") {
    const notice =
      (input && input.qualityBannerText && String(input.qualityBannerText).trim()) ||
      "需要处理：本次仅完成结构扫描，未完成深度分析";
    // 去掉可能泄漏的协议字段名
    const safeNotice = notice
      .replace(/\bdegraded_scan_only\b/gi, "")
      .replace(/\bneeds_attention\b/gi, "")
      .replace(/\bquality\.grade\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
    if (safeNotice && !body.includes("本次仅完成结构扫描，未完成深度分析")) {
      text = `${safeNotice}\n\n${body}`;
    } else if (!body.includes("本次仅完成结构扫描") && safeNotice) {
      text = `${safeNotice}\n\n${body}`;
    }
  }

  if (/\bdegraded_scan_only\b/i.test(text) || /\bneeds_attention\b/i.test(text)) {
    text = text
      .replace(/\bdegraded_scan_only\b/gi, "")
      .replace(/\bneeds_attention\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  return {
    ok: true,
    copyEnabled: true,
    text,
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { resolveCopyPayload };
}
if (typeof window !== "undefined") {
  window.DigitalMeBundleCopy = { resolveCopyPayload };
}
