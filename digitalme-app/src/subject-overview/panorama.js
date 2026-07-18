"use strict";

const {
  USER_STATUS,
  USER_STATUS_LABEL,
  PANORAMA_STATUS_CONTRACT_VERSION,
  PANORAMA_NAV_TARGETS,
} = require("./constants");

/** Hard integrity failures that always degrade 这是我 / 看见我. */
const CONTENT_DEGRADE_CODES = new Set([
  "json_invalid",
  "jsonl_invalid",
  "json_parse_error",
  "jsonl_parse_error",
  "file_unreadable",
  "list_files_failed",
  "readdir_failed",
]);

/**
 * json_shape_invalid on identity.json is a count edge case (no identityClaims array),
 * not subject-layer corruption. Other shape failures still degrade.
 */
function warningIndicatesContentDamage(warning) {
  if (!warning || typeof warning.code !== "string") return false;
  if (CONTENT_DEGRADE_CODES.has(warning.code)) return true;
  if (warning.code === "json_shape_invalid") {
    const p = String(warning.path || "").replace(/\\/g, "/");
    const base = p.split("/").pop();
    if (base === "identity.json") return false;
    return true;
  }
  return false;
}

const LAYER_DEGRADED_CONDITION = "部分主体资料损坏或无法读取";

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

function warningCodes(overview) {
  return new Set((overview.warnings || []).map((w) => w && w.code).filter(Boolean));
}

function packageMissing(overview) {
  const pkg = overview.package || {};
  return pkg.healthStatus === "missing" || overview._packageExists === false;
}

/**
 * Subject integrity:
 * - missing
 * - read_error (manifest / identity parse)
 * - content_degraded (layer JSON/JSONL damage or v0.2 unhealthy)
 * - readable
 *
 * Legacy limited/unversioned alone is NOT content_degraded.
 */
function resolveSubjectIntegrity(overview) {
  const pkg = overview.package || {};
  const codes = warningCodes(overview);
  const missing = packageMissing(overview);
  const manifestFail = codes.has("manifest_parse_error");
  const identityFail = codes.has("identity_parse_error");
  const readError = manifestFail || identityFail;
  const unhealthy = pkg.healthStatus === "unhealthy";
  let contentDegraded = false;
  if (!missing) {
    if (unhealthy) contentDegraded = true;
    else {
      for (const w of overview.warnings || []) {
        if (warningIndicatesContentDamage(w)) {
          contentDegraded = true;
          break;
        }
      }
    }
  }

  let subjectReadStatus = "readable";
  if (missing) subjectReadStatus = "missing";
  else if (readError) subjectReadStatus = "read_error";
  else if (contentDegraded) subjectReadStatus = "content_degraded";

  return {
    missing,
    manifestFail,
    identityFail,
    readError,
    contentDegraded,
    subjectReadStatus,
    /** 这是我 / 看见我 */
    seeMeDegraded: missing || readError || contentDegraded,
    /** 属于我：仅缺失或清单损坏；身份损坏与分层损坏不自动等同 */
    belongsDegraded: missing || manifestFail,
  };
}

/**
 * Development intent fail-closed:
 * - owner_assertion alone is NOT confirmed development intent
 * - mind_hooks / interests / capability_signals (development_intent layer) → direction clues
 * - otherwise → none
 */
function buildDirection(layers) {
  const intent = layerCountKnown(layers, "development_intent");

  if (intent.known && intent.count > 0) {
    return {
      kind: "direction_clue",
      title: "发展方向线索",
      summary: `系统整理出 ${intent.count} 条方向线索，尚未确认为本人发展意图。`,
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
  const state = resolveSubjectIntegrity(overview);
  const privacyConfiguredPrivate = pkg.privacyStatus === "local_private";

  const displayName = id.displayName || null;
  const title = displayName
    ? `${displayName}的 Digital Me`
    : "尚未命名的 Digital Me";

  let ownerLabel = "尚无法确认";
  if (!state.missing && !state.readError) {
    if (id.ownerDisplayName) ownerLabel = id.ownerDisplayName;
    else if (id.ownershipStatus === "self") ownerLabel = "本人";
  }

  // Privacy *configuration* (from readable manifest) vs verified *access* conclusion.
  let accessLabel = "隐私状态尚无法确认";
  let privacyLabel = "隐私状态尚无法确认";
  if (state.missing || state.manifestFail) {
    accessLabel = "隐私状态尚无法确认";
    privacyLabel = "隐私状态尚无法确认";
  } else if (state.identityFail) {
    accessLabel = "主体身份读取异常，访问范围尚无法确认";
    privacyLabel = privacyConfiguredPrivate
      ? "隐私配置：默认私有 · 未公开"
      : "隐私状态尚无法确认";
  } else if (privacyConfiguredPrivate) {
    accessLabel = "当前仅本人可访问";
    privacyLabel =
      typeof pkg.privacyLabel === "string" && pkg.privacyLabel
        ? pkg.privacyLabel
        : "默认私有 · 未公开";
  }

  const revisionKnown =
    !state.missing && !state.manifestFail && typeof pkg.revision === "number";
  const revisionLabel = revisionKnown
    ? `当前第 ${pkg.revision} 版`
    : "版本尚无法确认";

  const authLabel =
    collab && collab.autoAuthorization === true
      ? "存在外部授权"
      : collab && typeof collab.authorizationLabel === "string"
        ? collab.authorizationLabel
        : "无自动对外授权";

  let statusLine;
  if (state.missing) {
    statusLine = "本机资料尚未就绪 · 请先构建或检查设置";
  } else if (state.readError) {
    statusLine = `主体资料读取异常 · ${privacyLabel} · ${authLabel}`;
  } else if (privacyConfiguredPrivate) {
    statusLine = `本机私有 · 资料由你保管 · ${revisionLabel} · ${authLabel}`;
  } else {
    statusLine = `${privacyLabel} · ${revisionLabel} · ${authLabel}`;
  }

  return {
    title,
    displayName,
    ownerLabel,
    accessLabel,
    privacyLabel,
    privacyStatus: pkg.privacyStatus || "unknown",
    revision: revisionKnown ? pkg.revision : null,
    revisionLabel,
    recentSummary: recent.summary || "最近变化尚无法确认",
    statusLine,
    tagline: "属于本人、持续理解本人、只在本人授权范围内行动。",
    packageMissing: state.missing,
    subjectReadStatus: state.subjectReadStatus,
    authorizationLabel: authLabel,
  };
}

function capabilityBrief(overview) {
  const caps = overview.capabilities || [];
  if (!caps.length) return "能力状态尚无法确认";
  const available = caps.filter((c) => c.userStatus === USER_STATUS.AVAILABLE).length;
  const experiment = caps.filter((c) => c.userStatus === USER_STATUS.EXPERIMENT).length;
  return `能力摘要：可用 ${available} 项，实验 ${experiment} 项`;
}

function buildPromises(overview) {
  const pkg = overview.package || {};
  const bounds = overview.boundaries || {};
  const collab = overview.collaboration || {};
  const state = resolveSubjectIntegrity(overview);

  let thisIsMe = USER_STATUS.AVAILABLE;
  let thisIsMeEvidence = "主体首页只读聚合已通过运行验收；可查看分层构成。";
  let thisIsMeCondition = "";
  if (state.seeMeDegraded) {
    thisIsMe = USER_STATUS.PREVIEW;
    if (state.missing) {
      thisIsMeEvidence = "主体资料尚未就绪，无法确认为可用。";
      thisIsMeCondition = "本机资料目录不存在或无法访问";
    } else if (state.readError) {
      thisIsMeEvidence = "主体资料读取异常，状态已降级。";
      thisIsMeCondition = "清单或身份资料无法解析";
    } else {
      thisIsMeEvidence = "部分主体分层资料损坏或无法读取，状态已降级。";
      thisIsMeCondition = LAYER_DEGRADED_CONDITION;
    }
  }

  let belongs = USER_STATUS.EXPERIMENT;
  let belongsEvidence =
    "资料位于本机资料目录；完整导出与跨端迁移仍未完成。";
  let belongsCondition = "";
  if (state.belongsDegraded) {
    belongs = USER_STATUS.PREVIEW;
    belongsEvidence = state.missing
      ? "本机资料目录尚未就绪，所有权与版本结论暂不可用。"
      : "资料清单读取异常，无法确认版本与保管状态。";
    belongsCondition = state.missing ? "资料目录尚未就绪" : "资料清单读取异常";
  } else {
    const revKnown = typeof pkg.revision === "number";
    const recoverable = !!(pkg.recoverability && pkg.recoverability.recoverable);
    const revPart = revKnown ? `当前第 ${pkg.revision} 版` : "当前版本尚无法确认";
    const recoverPart = recoverable
      ? pkg.recoverability.previousRevision != null
        ? `可恢复到第 ${pkg.recoverability.previousRevision} 版`
        : "存在可恢复版本"
      : "尚无可恢复版本";
    belongsEvidence = `${revPart}；${recoverPart}；资料位于本机资料目录。完整导出与跨端迁移仍未完成。`;
  }

  let controlled = USER_STATUS.EXPERIMENT;
  let controlledEvidence = "";
  let controlledCondition = "";
  const authPart =
    collab && typeof collab.authorizationLabel === "string"
      ? collab.authorizationLabel
      : "无自动对外授权";
  const capPart = capabilityBrief(overview);
  if (!bounds.exists) {
    controlledEvidence = `尚未建立边界文件；策略底座可支撑实验级控制。${authPart}。${capPart}。完整控制权面板将在后续提供。`;
    controlledCondition = "边界文件尚未建立";
  } else if (!bounds.parseOk) {
    controlledEvidence = `边界文件无法解析，已启用边界尚无法确认；策略底座可支撑实验级控制。${authPart}。${capPart}。完整控制权面板将在后续提供。`;
    controlledCondition = "边界文件无法解析";
  } else if (!(bounds.enabledCount > 0)) {
    controlledEvidence = `边界文件已存在但尚未启用规则；策略底座可支撑实验级控制。${authPart}。${capPart}。完整控制权面板将在后续提供。`;
    controlledCondition = "尚未启用边界规则";
  } else {
    controlledEvidence = `已启用 ${bounds.enabledCount} 条边界；策略底座可支撑实验级控制。${authPart}。${capPart}。完整控制权面板将在后续提供。`;
  }

  return [
    {
      id: "this_is_me",
      title: "这是我",
      userStatus: thisIsMe,
      userStatusLabel: statusLabel(thisIsMe),
      evidence: thisIsMeEvidence,
      currentCondition: thisIsMeCondition,
      ctaLabel: "依据什么理解我",
      navTarget: sanitizeNavTarget("me-overview"),
    },
    {
      id: "belongs_to_me",
      title: "属于我",
      userStatus: belongs,
      userStatusLabel: statusLabel(belongs),
      evidence: belongsEvidence,
      currentCondition: belongsCondition,
      ctaLabel: "查看资料版本",
      navTarget: sanitizeNavTarget("settings-package-versions"),
    },
    {
      id: "controlled_by_me",
      title: "由我管",
      userStatus: controlled,
      userStatusLabel: statusLabel(controlled),
      evidence: controlledEvidence,
      currentCondition: controlledCondition,
      ctaLabel: "查看边界",
      navTarget: sanitizeNavTarget("me-boundaries"),
    },
    {
      id: "acts_for_me",
      title: "代表我协作",
      userStatus: USER_STATUS.NOT_OPEN,
      userStatusLabel: statusLabel(USER_STATUS.NOT_OPEN),
      evidence: "当前无自动对外授权。本地协作沙盘尚未开放。",
      currentCondition: "",
      ctaLabel: null,
      navTarget: null,
    },
  ];
}

function buildJourney(overview) {
  const state = resolveSubjectIntegrity(overview);

  return [
    {
      id: "build",
      title: "构建我",
      userStatus: USER_STATUS.EXPERIMENT,
      userStatusLabel: statusLabel(USER_STATUS.EXPERIMENT),
      evidence: "材料构建主路径真实存在；部分审阅路径仍有已知缺口。",
      currentCondition: state.missing ? "资料目录尚未就绪" : "",
      ctaLabel: "继续构建",
      navTarget: sanitizeNavTarget("me-build"),
    },
    {
      id: "see",
      title: "看见我",
      userStatus: state.seeMeDegraded ? USER_STATUS.PREVIEW : USER_STATUS.AVAILABLE,
      userStatusLabel: statusLabel(
        state.seeMeDegraded ? USER_STATUS.PREVIEW : USER_STATUS.AVAILABLE
      ),
      evidence: state.seeMeDegraded
        ? "主体资料尚不可靠展示，构成查看已降级。"
        : "可查看主体构成与分层摘要。",
      currentCondition: state.missing
        ? "资料目录尚未就绪"
        : state.readError
          ? "主体资料读取异常"
          : state.contentDegraded
            ? LAYER_DEGRADED_CONDITION
            : "",
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
  const state = resolveSubjectIntegrity(overview);
  if (state.missing || state.readError) {
    return {
      label: "继续构建",
      reason: state.missing
        ? "主体资料尚未就绪，先从构建开始。"
        : "主体资料读取异常，可先检查构建与设置。",
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
  for (const item of [...promises, ...journey]) {
    if (!isUserStatus(item.userStatus)) {
      item.userStatus = USER_STATUS.NOT_OPEN;
      item.userStatusLabel = statusLabel(USER_STATUS.NOT_OPEN);
    }
    item.navTarget = sanitizeNavTarget(item.navTarget);
    if (!item.navTarget) item.ctaLabel = null;
    if (typeof item.currentCondition !== "string") item.currentCondition = "";
  }

  return {
    statusContractVersion: PANORAMA_STATUS_CONTRACT_VERSION,
    hero: buildHero(enriched),
    promises,
    journey,
    direction: buildDirection(overview.layers),
    nextAction: buildNextAction(enriched),
  };
}

module.exports = {
  buildPanoramaSection,
  buildDirection,
  resolveSubjectIntegrity,
  mapInternalCapabilityToUser,
  sanitizeNavTarget,
  isUserStatus,
  statusLabel,
  LAYER_DEGRADED_CONDITION,
  CONTENT_DEGRADE_CODES,
};
