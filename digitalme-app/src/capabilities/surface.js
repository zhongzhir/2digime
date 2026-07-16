"use strict";

/**
 * Internal readable capability surface — 「我现在能做什么」
 * Aggregates MCP extensions, scenario packs, and writing templates for the owner.
 */

function buildCapabilitySurface({
  catalogItems = [],
  enabledExtensions = [],
  statusList = [],
  scenarioPacks = [],
  templates = [],
  activeScenario = null,
}) {
  const statusById = new Map((statusList || []).map((s) => [s.id, s]));
  const enabledById = new Map((enabledExtensions || []).map((e) => [e.id, e]));

  const tools = (catalogItems || [])
    .filter((c) => c.audience !== "advanced" || enabledById.has(c.id))
    .map((c) => {
      const enabled = enabledById.has(c.id);
      const st = statusById.get(c.id);
      const connected = !!(st && st.status === "connected");
      let state = "未启用";
      if (connected) state = "已就绪";
      else if (enabled) state = "已启用未连接";
      else if (c.needsKey) state = "需配置密钥";
      return {
        id: c.id,
        name: c.name,
        tagline: c.tagline || "",
        category: c.category || "",
        state,
        ready: connected,
        recommended: !!c.recommended,
      };
    });

  const readyTools = tools.filter((t) => t.ready);
  const scenarios = (scenarioPacks || []).map((p) => ({
    id: p.id,
    title: p.title,
    blurb: p.blurb || "",
    recommendedExtensions: p.recommendedExtensions || [],
    active: !!(activeScenario && activeScenario.id === p.id),
  }));

  const deliverableTypes = (templates || [])
    .filter((t) => !t.openPptForm)
    .map((t) => ({ id: t.id, title: t.title, blurb: t.blurb || "" }));

  const summaryParts = [];
  if (readyTools.length) {
    summaryParts.push("已就绪能力：" + readyTools.map((t) => t.name).join("、"));
  } else {
    summaryParts.push("尚未就绪可用工具；可在「能力」页启用，或点击开箱场景自动准备。");
  }
  if (activeScenario && activeScenario.title) {
    summaryParts.push("当前场景：" + activeScenario.title);
  }

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    summary: summaryParts.join(" "),
    activeScenario: activeScenario
      ? { id: activeScenario.id, title: activeScenario.title }
      : null,
    tools,
    scenarios,
    deliverableTypes,
    counts: {
      ready: readyTools.length,
      enabled: enabledExtensions.length,
      scenarios: scenarios.length,
      templates: deliverableTypes.length,
    },
  };
}

module.exports = {
  buildCapabilitySurface,
};
