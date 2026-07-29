"use strict";

/**
 * TASK-QUALITY-LOOP-01.2 — Attempt recovery consolidation (compat layer).
 *
 * Prefer recoveryActions[] as the writable structure. Legacy boolean fields
 * remain readable. No high-risk store migration.
 */

const RECOVERY_ACTIONS = Object.freeze({
  LOCAL_REPAIR: "local_repair",
  GROUNDED_REBUILD: "grounded_rebuild",
  CLEAN_REGENERATION: "clean_regeneration",
  SEMANTIC_GAP_FILL: "semantic_gap_fill",
  OUTLINE_REPAIR: "outline_repair",
  BLOCK_REPAIR: "block_repair",
});

function normalizeRecoveryActions(attemptOrAudit) {
  const src = attemptOrAudit || {};
  if (Array.isArray(src.recoveryActions) && src.recoveryActions.length) {
    return src.recoveryActions.map(normalizeOne).filter(Boolean);
  }
  const audit = src.groundingAudit || src;
  const out = [];
  const modes = Array.isArray(audit.repairModes) ? audit.repairModes : [];
  for (const m of modes) {
    const n = normalizeOne(m);
    if (n) out.push(n);
  }
  if (src.groundedRebuildUsed || audit.groundedRebuildUsed) {
    if (!out.some((a) => a.action === RECOVERY_ACTIONS.GROUNDED_REBUILD)) {
      out.push({ action: RECOVERY_ACTIONS.GROUNDED_REBUILD, at: null });
    }
  }
  if (src.cleanRegenerationUsed || audit.cleanRegenerationUsed) {
    if (!out.some((a) => a.action === RECOVERY_ACTIONS.CLEAN_REGENERATION)) {
      out.push({ action: RECOVERY_ACTIONS.CLEAN_REGENERATION, at: null });
    }
  }
  if (src.repairMode) {
    const n = normalizeOne(src.repairMode);
    if (n && !out.some((a) => a.action === n.action)) out.push(n);
  }
  return out;
}

function normalizeOne(raw) {
  if (!raw) return null;
  if (typeof raw === "string") {
    return { action: String(raw), at: null };
  }
  if (typeof raw === "object" && raw.action) {
    return { action: String(raw.action), at: raw.at || null, note: raw.note || undefined };
  }
  return null;
}

function appendRecoveryAction(list, action, note) {
  const arr = Array.isArray(list) ? list.slice() : [];
  arr.push({
    action: String(action),
    at: new Date().toISOString(),
    note: note || undefined,
  });
  return arr;
}

function hasRecoveryAction(listOrAttempt, action) {
  return normalizeRecoveryActions(listOrAttempt).some((a) => a.action === action);
}

/** Compat projection: derive legacy booleans from recoveryActions. */
function legacyFlagsFromRecovery(listOrAttempt) {
  const actions = normalizeRecoveryActions(listOrAttempt);
  return {
    groundedRebuildUsed: actions.some((a) => a.action === RECOVERY_ACTIONS.GROUNDED_REBUILD),
    cleanRegenerationUsed: actions.some((a) => a.action === RECOVERY_ACTIONS.CLEAN_REGENERATION),
    repairModes: actions.map((a) => a.action),
  };
}

function buildAttemptAuditWrite({ recoveryActions, modelCallCount, demotedMaterialCount, gapStatementValid }) {
  const actions = Array.isArray(recoveryActions) ? recoveryActions : [];
  const flags = legacyFlagsFromRecovery({ recoveryActions: actions });
  return {
    recoveryActions: actions,
    // Legacy mirrors for old readers — derived, not a second authority.
    groundedRebuildUsed: flags.groundedRebuildUsed,
    cleanRegenerationUsed: flags.cleanRegenerationUsed,
    groundingAudit: {
      groundedRebuildUsed: flags.groundedRebuildUsed,
      groundedRebuildCount: actions.filter((a) => a.action === RECOVERY_ACTIONS.GROUNDED_REBUILD)
        .length,
      cleanRegenerationUsed: flags.cleanRegenerationUsed,
      repairModes: flags.repairModes,
      modelCallCount: modelCallCount || 0,
      demotedMaterialCount: demotedMaterialCount || 0,
      gapStatementValid: gapStatementValid !== false,
      recoveryActions: actions,
    },
  };
}

module.exports = {
  RECOVERY_ACTIONS,
  normalizeRecoveryActions,
  appendRecoveryAction,
  hasRecoveryAction,
  legacyFlagsFromRecovery,
  buildAttemptAuditWrite,
};
