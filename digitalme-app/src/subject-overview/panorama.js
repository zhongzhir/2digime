"use strict";

const {
  USER_STATUS,
  USER_STATUS_LABEL,
  PANORAMA_STATUS_CONTRACT_VERSION,
  PANORAMA_NAV_TARGETS,
  MINIMAL_SURFACE_ACTIONS,
  SUBJECT_IDENTITY_LINE,
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
  return `可体验能力：可用 ${available} 项，实验 ${experiment} 项`;
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
      userStatus: USER_STATUS.LOCAL_SIM,
      userStatusLabel: statusLabel(USER_STATUS.LOCAL_SIM),
      evidence:
        "可体验一次受控研究协作（本地模拟协作关系）。结果仅返回给你本人审阅，不会发送给模拟协作伙伴。",
      currentCondition: "",
      ctaLabel: null,
      // PAN-01S: no production entry for collaboration experience
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
      userStatus: USER_STATUS.LOCAL_SIM,
      userStatusLabel: statusLabel(USER_STATUS.LOCAL_SIM),
      evidence: "可体验受控研究协作闭环（本地模拟协作关系）；完整协作沙盘仍待后续。",
      currentCondition: "",
      ctaLabel: null,
      // PAN-01S: no production entry for collaboration experience
      navTarget: null,
    },
  ];
}

/**
 * Sanitize inbox queue into a summary safe for overview (no paths / bodies).
 * pending_confirmation maps to the same bucket as awaiting_review (P2).
 */
function summarizeInboxForOverview(queue) {
  const items = queue && Array.isArray(queue.items) ? queue.items : [];
  const KNOWN = new Set([
    "queued",
    "suggested",
    "processing",
    "awaiting_review",
    "pending_confirmation",
    "written",
    "skipped",
    "failed",
    "failed-retryable",
  ]);
  let awaitingReviewCount = 0;
  let pendingConfirmationCount = 0;
  let suggestedCount = 0;
  let failedRetryableCount = 0;
  let processingCount = 0;
  let queuedCount = 0;
  let unknownStatusCount = 0;
  for (const it of items) {
    const st = it && typeof it.status === "string" ? it.status : "";
    if (!st || !KNOWN.has(st)) {
      unknownStatusCount += 1;
      continue;
    }
    if (st === "awaiting_review") awaitingReviewCount += 1;
    else if (st === "pending_confirmation") pendingConfirmationCount += 1;
    else if (st === "suggested") suggestedCount += 1;
    else if (st === "failed" || st === "failed-retryable") failedRetryableCount += 1;
    else if (st === "processing") processingCount += 1;
    else if (st === "queued") queuedCount += 1;
  }
  return {
    awaitingReviewCount,
    pendingConfirmationCount,
    suggestedCount,
    failedRetryableCount,
    processingCount,
    queuedCount,
    unknownStatusCount,
    hasAwaitingReview: awaitingReviewCount + pendingConfirmationCount > 0,
    hasActionableTodo: suggestedCount + failedRetryableCount + queuedCount > 0,
    hasProcessing: processingCount > 0,
  };
}

/**
 * uninitialized mapping (PAN-01S §2.2 P1):
 * - package missing → missing (P1 via missing)
 * - package exists but neither usable manifest nor usable identity → uninitialized (P1)
 * - present files that fail to parse → read_error (P0), not uninitialized
 * - layer / health content damage → content_degraded (P0), not uninitialized
 */
function isPackageUninitialized(overview, state) {
  if (!state || state.missing || state.readError || state.contentDegraded) return false;
  const sr = (overview.package && overview.package.subjectRead) || {};
  const usableManifest = !!(sr.manifestPresent && sr.manifestParseOk);
  const usableIdentity = !!(sr.identityPresent && sr.identityParseOk);
  return !usableManifest && !usableIdentity;
}

function twoLineSummary(line2) {
  const second = typeof line2 === "string" && line2.trim() ? line2.trim() : "";
  if (!second) return SUBJECT_IDENTITY_LINE;
  return `${SUBJECT_IDENTITY_LINE}\n${second}`;
}

function failClosedMinimalSurface(subjectName, summary) {
  return {
    subjectName: subjectName || "我的 Digital Me",
    summary: summary || twoLineSummary("当前状态无法确认。"),
    primaryAction: null,
    primaryActionLabel: null,
    primaryNavTarget: null,
    secondaryAction: null,
    reminder: null,
    priority: null,
    failClosed: true,
  };
}

function buildSecondary(action, label, navTarget) {
  const target = sanitizeNavTarget(navTarget);
  if (!action || !label || !target) return null;
  return { action, label, navTarget: target };
}

/**
 * Prefer rich P4 claim only when package layers support experiences,
 * interests/domains, and judgment signals. Otherwise use the safer fallback.
 */
function canClaimFamiliarSubject(overview) {
  const layers = (overview && overview.layers) || [];
  const fact = layerCountKnown(layers, "fact");
  const current = layerCountKnown(layers, "current_state");
  const intent = layerCountKnown(layers, "development_intent");
  const owner = layerCountKnown(layers, "owner_assertion");
  const inference = layerCountKnown(layers, "inference");
  const hasExperience =
    (fact.known && fact.count > 0) || (current.known && current.count > 0);
  const hasInterest = intent.known && intent.count > 0;
  const hasJudgment =
    (owner.known && owner.count > 0) || (inference.known && inference.count > 0);
  return !!(hasExperience && hasInterest && hasJudgment);
}

/**
 * Trusted build-flow step for progressive wizard (B0–B4 from package/inbox).
 * B1/B5 may be session-overlaid in renderer after user action / successful write.
 */
function buildBuildFlow(overview, inboxSummary, meta = {}) {
  const state = resolveSubjectIntegrity(overview || {});
  const inbox =
    inboxSummary && typeof inboxSummary === "object"
      ? inboxSummary
      : summarizeInboxForOverview(null);
  const pendingCount =
    (inbox.queuedCount || 0) +
    (inbox.suggestedCount || 0) +
    (inbox.failedRetryableCount || 0);
  const awaitingCount =
    (inbox.awaitingReviewCount || 0) + (inbox.pendingConfirmationCount || 0);
  const processingCount = inbox.processingCount || 0;
  const subjectReadable =
    !state.missing &&
    !state.readError &&
    !state.contentDegraded &&
    !isPackageUninitialized(overview, state);
  const hasIntakeEvidence = meta.hasIntakeEvidence === true;

  let step = "B0";
  if (inbox.hasAwaitingReview) step = "B4";
  else if (inbox.hasProcessing && !inbox.hasActionableTodo) step = "B3";
  else if (inbox.hasActionableTodo) step = "B2";
  else step = "B0";

  return {
    step,
    pendingCount,
    awaitingCount,
    processingCount,
    subjectReadable,
    hasIntakeEvidence,
  };
}

/**
 * P0→P4 exclusive primary action for the default 「我」 entry.
 * Renderer must only render this contract; never recompute priority.
 */
function buildMinimalSurface(overview, inboxSummary) {
  const id = (overview && overview.identity) || {};
  const subjectName = id.displayName
    ? `${id.displayName}的 Digital Me`
    : "我的 Digital Me";
  const state = resolveSubjectIntegrity(overview || {});
  const inbox =
    inboxSummary && typeof inboxSummary === "object"
      ? inboxSummary
      : summarizeInboxForOverview(null);

  // P0 — read damage / cannot safely conclude
  if (state.readError || state.contentDegraded) {
    const nav = sanitizeNavTarget("settings-package-versions");
    // Subject is not safely readable under P0 → no 「查看目前的我」.
    return {
      subjectName,
      summary: twoLineSummary(
        "我已经形成了部分认识，但目前有些信息无法读取。"
      ),
      primaryAction: "view_problems",
      primaryActionLabel: MINIMAL_SURFACE_ACTIONS.view_problems,
      primaryNavTarget: nav,
      secondaryAction: null,
      reminder: null,
      priority: "P0",
      failClosed: !nav,
    };
  }

  // P1 — missing or uninitialized (not read damage)
  if (state.missing || isPackageUninitialized(overview, state)) {
    const nav = sanitizeNavTarget("me-build");
    return {
      subjectName,
      summary: twoLineSummary(
        "我还不够了解你，可以从已有资料或一次简短对话开始。"
      ),
      primaryAction: "continue_build",
      primaryActionLabel: MINIMAL_SURFACE_ACTIONS.continue_build,
      primaryNavTarget: nav,
      secondaryAction: null,
      reminder: null,
      priority: "P1",
      failClosed: !nav,
    };
  }

  // Unknown inbox statuses → fail-closed (do not invent success)
  if (inbox.unknownStatusCount > 0) {
    return failClosedMinimalSurface(
      subjectName,
      twoLineSummary("当前状态无法确认。")
    );
  }

  const viewMeSecondary = buildSecondary(
    "view_subject",
    MINIMAL_SURFACE_ACTIONS.view_subject,
    "me-cognition"
  );

  // P2 — awaiting confirmation / review
  if (inbox.hasAwaitingReview) {
    const nav = sanitizeNavTarget("me-build");
    return {
      subjectName,
      summary: twoLineSummary(
        "我形成了一些新的认识，需要你确认后才会成为“我”的一部分。"
      ),
      primaryAction: "continue_confirm",
      primaryActionLabel: MINIMAL_SURFACE_ACTIONS.continue_confirm,
      primaryNavTarget: nav,
      secondaryAction: viewMeSecondary,
      reminder: null,
      priority: "P2",
      failClosed: !nav,
    };
  }

  // P3 — actionable inbox (not processing alone)
  if (inbox.hasActionableTodo) {
    const nav = sanitizeNavTarget("me-build");
    let reminder = null;
    if (inbox.hasProcessing) reminder = "有内容正在处理中";
    return {
      subjectName,
      summary: twoLineSummary(
        "我已经有了基本轮廓，还有一项内容可以继续完善。"
      ),
      primaryAction: "continue_refine",
      primaryActionLabel: MINIMAL_SURFACE_ACTIONS.continue_refine,
      primaryNavTarget: nav,
      secondaryAction: viewMeSecondary,
      reminder,
      priority: "P3",
      failClosed: !nav,
    };
  }

  // P4 — readable subject, no P0–P3；主操作进入对话
  const chatNav = sanitizeNavTarget("chat");
  let reminder = null;
  if (inbox.hasProcessing) reminder = "有内容正在处理中";
  else if ((overview.package && overview.package.privacyStatus) === "unknown") {
    reminder = "隐私状态尚无法确认";
  }
  const line2 = canClaimFamiliarSubject(overview)
    ? "我已经了解你的部分经历、关注领域和判断方式，并会在使用中继续成长。"
    : "我已经形成了初步认识，并会在对话和做事中继续了解你。";
  return {
    subjectName,
    summary: twoLineSummary(line2),
    primaryAction: "start_work",
    primaryActionLabel: MINIMAL_SURFACE_ACTIONS.start_work,
    primaryNavTarget: chatNav,
    secondaryAction: viewMeSecondary,
    reminder,
    priority: "P4",
    failClosed: !chatNav,
  };
}

function buildNextAction(overview, inboxSummary) {
  const ms = buildMinimalSurface(overview, inboxSummary);
  if (!ms || ms.failClosed || !ms.primaryActionLabel || !ms.primaryNavTarget) {
    return {
      label: null,
      reason: (ms && ms.summary) || "当前状态无法确认。",
      navTarget: null,
    };
  }
  return {
    label: ms.primaryActionLabel,
    reason: ms.summary || "",
    navTarget: ms.primaryNavTarget,
  };
}

/**
 * @param {object} overview - SubjectOverview v1 base object (mutates nothing external)
 * @param {{ packageExists?: boolean, inboxSummary?: object }} meta
 */
function buildPanoramaSection(overview, meta = {}) {
  const enriched = {
    ...overview,
    _packageExists: meta.packageExists !== false,
  };
  const inboxSummary = meta.inboxSummary || summarizeInboxForOverview(null);
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

  const minimalSurface = buildMinimalSurface(enriched, inboxSummary);
  const buildFlow = buildBuildFlow(enriched, inboxSummary, {
    hasIntakeEvidence: meta.hasIntakeEvidence === true,
  });

  return {
    statusContractVersion: PANORAMA_STATUS_CONTRACT_VERSION,
    hero: buildHero(enriched),
    promises,
    journey,
    direction: buildDirection(overview.layers),
    nextAction: buildNextAction(enriched, inboxSummary),
    minimalSurface,
    buildFlow,
  };
}

module.exports = {
  buildPanoramaSection,
  buildDirection,
  buildMinimalSurface,
  buildBuildFlow,
  buildNextAction,
  canClaimFamiliarSubject,
  summarizeInboxForOverview,
  isPackageUninitialized,
  resolveSubjectIntegrity,
  mapInternalCapabilityToUser,
  sanitizeNavTarget,
  isUserStatus,
  statusLabel,
  LAYER_DEGRADED_CONDITION,
  CONTENT_DEGRADE_CODES,
};
