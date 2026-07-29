"use strict";

/**
 * TASK-QUALITY-STABILIZE-01 — production quality pipeline mode.
 *
 * Not a user-facing setting / not a new persistent store.
 * Prefer deps override, then env, then stable_delivery default.
 */

const QUALITY_PIPELINE_MODES = Object.freeze({
  STABLE_DELIVERY: "stable_delivery",
  ADVANCED_SHADOW: "advanced_shadow",
});

/**
 * @param {object} [deps]
 * @returns {"stable_delivery"|"advanced_shadow"}
 */
function resolveQualityPipelineMode(deps) {
  const fromDeps =
    deps && deps.qualityPipelineMode != null ? String(deps.qualityPipelineMode).trim() : "";
  const fromEnv = String(process.env.DIGITALME_QUALITY_PIPELINE_MODE || "").trim();
  const raw = fromDeps || fromEnv || QUALITY_PIPELINE_MODES.STABLE_DELIVERY;
  if (raw === QUALITY_PIPELINE_MODES.ADVANCED_SHADOW) {
    return QUALITY_PIPELINE_MODES.ADVANCED_SHADOW;
  }
  return QUALITY_PIPELINE_MODES.STABLE_DELIVERY;
}

function isStableDeliveryMode(deps) {
  return resolveQualityPipelineMode(deps) === QUALITY_PIPELINE_MODES.STABLE_DELIVERY;
}

module.exports = {
  QUALITY_PIPELINE_MODES,
  resolveQualityPipelineMode,
  isStableDeliveryMode,
};
