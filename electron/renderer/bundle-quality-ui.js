/**
 * Bundle 成果质量展示映射 — 纯函数，供渲染层与 Node 测试共用。
 * 不暴露 quality.grade / Job ID / Adapter / 调试字段。
 */

/**
 * @param {{ grade?: string, reasons?: string[] } | null | undefined} quality
 * @returns {{
 *   showBanner: boolean,
 *   className: string,
 *   bannerText: string,
 *   saveStatus: string
 * }}
 */
function resolveBundleQualityUi(quality) {
  const grade = quality && quality.grade ? String(quality.grade) : "usable";

  if (grade === "usable" || !quality || !quality.grade) {
    return {
      showBanner: false,
      className: "bundle-quality usable",
      bannerText: "",
      saveStatus: "代码项目分析结果（只读）",
    };
  }

  if (grade === "degraded_scan_only") {
    return {
      showBanner: true,
      className: "bundle-quality degraded-scan",
      bannerText: "需要处理：本次仅完成结构扫描，未完成深度分析",
      saveStatus: "代码项目分析（需要处理）",
    };
  }

  if (grade === "needs_attention") {
    return {
      showBanner: true,
      className: "bundle-quality needs-attention",
      bannerText: "需要处理：结果需要关注，请谨慎采信",
      saveStatus: "代码项目分析（需要处理）",
    };
  }

  return {
    showBanner: true,
    className: "bundle-quality needs-attention",
    bannerText: "需要处理：结果需要关注，请谨慎采信",
    saveStatus: "代码项目分析（需要处理）",
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { resolveBundleQualityUi };
}
if (typeof window !== "undefined") {
  window.DigitalMeBundleQualityUi = { resolveBundleQualityUi };
}
