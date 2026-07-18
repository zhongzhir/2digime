"use strict";

const {
  USER_STATUS,
  USER_STATUS_LABEL,
  PANORAMA_STATUS_CONTRACT_VERSION,
  PANORAMA_NAV_TARGETS,
} = require("./constants");

function isUserStatus(value) {
  return Object.prototype.hasOwnProperty.call(USER_STATUS_LABEL, value);
}

function statusLabel(status) {
  return USER_STATUS_LABEL[status] || USER_STATUS_LABEL[USER_STATUS.NOT_OPEN];
}

function sanitizeNavTarget(target) {
  if (typeof target !== "string") return null;
  return PANORAMA_NAV_TARGETS.has(target) ? target : null;
}

/**
 * Map legacy internal capability status → user-facing five-state maturity.
 * Runtime conditions (e.g. missing API key) stay in currentCondition.
 */
function mapInternalCapabilityToUser(internalStatus, runtime = {}) {
  const internal = typeof internalStatus === "string" ? internalStatus : "unknown";
  let userStatus = USER_STATUS.NOT_OPEN;
  if (internal === "available") userStatus = USER_STATUS.AVAILABLE;
  else if (internal === "limited" || internal === "experimental") userStatus = USER_STATUS.EXPERIMENT;
  else if (internal === "unavailable" || internal === "unknown") userStatus = USER_STATUS.NOT_OPEN;
  else userStatus = USER_STATUS.NOT_OPEN; // fail-closed

  let currentCondition = "";
  if (runtime.missingApiKey) {
    currentCondition = "尚未配置智能引擎";
    // Do not invent a sixth maturity; keep mapped maturity.
  }
  return {
    userStatus,
    userStatusLabel: statusLabel(userStatus),
    currentCondition,
  };
}

function layerCountKnown(layers, kind) {
  const layer = (layers || []).find((l) => l.kind === kind);
  if (!layer) return { known: false, count: null };
  if (layer.countStatus === "known" && typeof layer.count === "number") {
    return { known: true, count: layer.count };
  }
  if (layer.countStatus === "partial" && typeof layer.count === "number") {
    return { known: true, count: layer.count, partial: true };
  }
  return { known: false, count: null };
}

function buildDirection(layers, identity) {
  const intent = layerCountKnown(layers, "development_intent");
  const owner = layerCountKnown(layers, "owner_assertion");
  const inference = layerCountKnown(layers, "inference");

  // Only treat owner_assertion as confirmed intent when count > 0; otherwise clues or none.
  if (owner.known && owner.count > 0) {
    return {
      kind: "confirmed_intent",
      title: "我的发展意图",
      summary: `已有 ${owner.count} 条本人声明相关记录。详细内容请在「认知」或「观念与表达」中查看。`,
      navTarget: sanitizeNavTarget("me-cognition"),
    };
  }
  if ((intent.known && intent.count > 0) || (inference.known && inference.count > 0)) {
    const n = (intent.count || 0) + (inference.count || 0);
    return {
      kind: "direction_clue",
      title: "发展方向线索",
      summary: `系统整理出 ${n} 条方向线索，尚未确认为本人发展意图。`,
      navTarget: sanitizeNavTarget("me-cognition"),
    };
  }
  return {
    kind: "none",
    title: "我的发展意图",
    summary: "尚未建立本人确认的发展意图",
    navTarget: sanitizeNavTarget("me-cognition"),
  };
}

function buildHero(overview) {
  const id = overview.identity || {};
  const pkg = overview.package || {};
  const recent = overview.recentChange || {};
  const collab = overview.collaboration || {};
  const missing = pkg.healthStatus === "missing" || !overview._packageExists;

  const displayName = id.displayName || null;
  const title = displayName
    ? `${displayName}的 Digital Me`
    : "尚未命名的 Digital Me";

  const ownerLabel =
    id.ownerDisplayName ||
    (id.ownershipStatus === "self" ? "本人" : "未知");

  const accessLabel =
    pkg.privacyStatus === "local_private"
      ? "当前仅本人可访问"
      : "隐私状态尚无法确认";

  const revisionLabel =
    typeof pkg.revision === "number" ? `当前第 ${pkg.revision} 版` : "版本尚无法确认";

  const authLabel = collab.autoAuthorization
    ? "存在外部授权"
    : "无自动外部授权";

  const statusLine = missing
    ? "本机资料尚未就绪 · 请先构建或检查设置"
    : `本机私有 · 资料由你保管 · ${revisionLabel} · ${authLabel}`;

  return {
    title,
    displayName,
    ownerLabel,
    accessLabel,
    revision: typeof pkg.revision === "number" ? pkg.revision : null,
    revisionLabel,
    recentSummary: recent.summary || "最近变化尚无法确认",
    statusLine,
    tagline: "属于本人、持续理解本人、只在本人授权范围内行动。",
    packageMissing: missing,
  };
}

function buildPromises(overview) {
  const pkg = overview.package || {};
  const layers = overview.layers || {};
  const missing = pkg.healthStatus === "missing" || overview._packageExists === false;
  const readFailed = (overview.warnings || []).some(
    (w) => w.code === "manifest_parse_error" || w.code === "identity_parse_error"
  );

  let thisIsMe = USER_STATUS.AVAILABLE;
  let thisIsMeEvidence = "主体首页只读聚合已通过运行验收；可查看分层构成。";
  let thisIsMeNav = sanitizeNavTarget("me-overview");
  if (missing || readFailed) {
    thisIsMe = USER_STATUS.PREVIEW;
    thisIsMeEvidence = missing
      ? "主体资料尚未就绪，无法确认为可用。"
      : "主体资料读取异常，状态已降级。";
  }

  return [
    {
      id: "this_is_me",
      title: "这是我",
      userStatus: thisIsMe,
      userStatusLabel: statusLabel(thisIsMe),
      evidence: thisIsMeEvidence,
      ctaLabel: "依据什么理解我",
      navTarget: thisIsMeNav,
    },
    {
      id: "belongs_to_me",
      title: "属于我",
      userStatus: USER_STATUS.EXPERIMENT,
      userStatusLabel: statusLabel(USER_STATUS.EXPERIMENT),
      evidence: "本机资料与版本路径真实存在；完整导出与跨端迁移仍未完成。",
      ctaLabel: "查看资料版本",
      navTarget: sanitizeNavTarget("settings-package-versions"),
    },
    {
      id: "controlled_by_me",
      title: "由我管",
      userStatus: USER_STATUS.EXPERIMENT,
      userStatusLabel: statusLabel(USER_STATUS.EXPERIMENT),
      evidence: "边界与策略底座已存在；完整控制权面板将在后续提供。",
      ctaLabel: "查看边界",
      navTarget: sanitizeNavTarget("me-boundaries"),
    },
    {
      id: "acts_for_me",
      title: "代表我协作",
      userStatus: USER_STATUS.NOT_OPEN,
      userStatusLabel: statusLabel(USER_STATUS.NOT_OPEN),
      evidence: "当前默认私有，无自动外部授权。本地协作沙盘尚未开放。",
      ctaLabel: null,
      navTarget: null,
    },
  ];
}

function buildJourney(overview) {
  const pkg = overview.package || {};
  const missing = pkg.healthStatus === "missing";

  return [
    {
      id: "build",
      title: "构建我",
      userStatus: USER_STATUS.EXPERIMENT,
      userStatusLabel: statusLabel(USER_STATUS.EXPERIMENT),
      evidence: "材料构建主路径真实存在；部分审阅路径仍有已知缺口。",
      currentCondition: missing ? "资料目录尚未就绪" : "",
      ctaLabel: "继续构建",
      navTarget: sanitizeNavTarget("me-build"),
    },
    {
      id: "see",
      title: "看见我",
      userStatus: missing ? USER_STATUS.PREVIEW : USER_STATUS.AVAILABLE,
      userStatusLabel: statusLabel(missing ? USER_STATUS.PREVIEW : USER_STATUS.AVAILABLE),
      evidence: "可查看主体构成与分层摘要。",
      currentCondition: "",
      ctaLabel: "查看我的构成",
      navTarget: sanitizeNavTarget("me-overview"),
    },
    {
      id: "arm",
      title: "武装我",
      userStatus: USER_STATUS.EXPERIMENT,
      userStatusLabel: statusLabel(USER_STATUS.EXPERIMENT),
      evidence: "写作、研究与受控执行已有真实切片，验证范围有限。",
      currentCondition: "",
      ctaLabel: "查看能力",
      navTarget: sanitizeNavTarget("capabilities"),
    },
    {
      id: "authorize",
      title: "授权我",
      userStatus: USER_STATUS.PREVIEW,
      userStatusLabel: statusLabel(USER_STATUS.PREVIEW),
      evidence: "策略底座已存在；控制权产品面尚未完成。",
      currentCondition: "",
      ctaLabel: null,
      navTarget: null,
    },
    {
      id: "collaborate",
      title: "代表我协作",
      userStatus: USER_STATUS.NOT_OPEN,
      userStatusLabel: statusLabel(USER_STATUS.NOT_OPEN),
      evidence: "尚无用户面协作闭环。",
      currentCondition: "",
      ctaLabel: null,
      navTarget: null,
    },
  ];
}

function buildNextAction(overview) {
  const pkg = overview.package || {};
  if (pkg.healthStatus === "missing") {
    return {
      label: "继续构建",
      reason: "主体资料尚未就绪，先从构建开始。",
      navTarget: sanitizeNavTarget("me-build"),
    };
  }
  return {
    label: "查看我的构成",
    reason: "先看清它依据什么理解你，再决定下一步。",
    navTarget: sanitizeNavTarget("me-overview"),
  };
}

/**
 * @param {object} overview - SubjectOverview v1 base object (mutates nothing external)
 * @param {{ packageExists?: boolean }} meta
 */
function buildPanoramaSection(overview, meta = {}) {
  const enriched = {
    ...overview,
    _packageExists: meta.packageExists !== false,
  };
  const promises = buildPromises(enriched);
  const journey = buildJourney(enriched);
  // Validate all user statuses are five-state
  for (const item of [...promises, ...journey]) {
    if (!isUserStatus(item.userStatus)) {
      item.userStatus = USER_STATUS.NOT_OPEN;
      item.userStatusLabel = statusLabel(USER_STATUS.NOT_OPEN);
    }
    item.navTarget = sanitizeNavTarget(item.navTarget);
    if (!item.navTarget) item.ctaLabel = null;
  }

  return {
    statusContractVersion: PANORAMA_STATUS_CONTRACT_VERSION,
    hero: buildHero(enriched),
    promises,
    journey,
    direction: buildDirection(overview.layers, overview.identity),
    nextAction: buildNextAction(enriched),
  };
}

module.exports = {
  buildPanoramaSection,
  mapInternalCapabilityToUser,
  sanitizeNavTarget,
  isUserStatus,
  statusLabel,
};
