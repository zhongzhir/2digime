"use strict";

const { CAPABILITY_CATALOG } = require("./constants");

/**
 * @param {{ hasApiKey?: boolean, readyExtensionCount?: number }} runtime
 */
function buildCapabilityStatuses(runtime = {}) {
  return CAPABILITY_CATALOG.map((cap) => {
    let status = cap.status;
    let limitation = cap.limitation;
    if (cap.id === "dialogue") {
      status = runtime.hasApiKey ? "limited" : "unavailable";
      limitation = runtime.hasApiKey
        ? "已配置智能引擎；当前连通性需在实际对话中确认。"
        : "尚未配置智能引擎密钥，请前往设置。";
    }
    if (cap.id === "mcp_extensions" && runtime.readyExtensionCount > 0) {
      status = "limited";
      limitation = `已有 ${runtime.readyExtensionCount} 个扩展工具就绪；策略与审计尚未硬化。`;
    }
    return {
      id: cap.id,
      label: cap.label,
      status,
      limitation,
      navTarget: cap.navTarget,
    };
  });
}

module.exports = { buildCapabilityStatuses };
