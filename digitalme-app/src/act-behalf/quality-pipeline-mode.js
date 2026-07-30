"use strict";

/**
 * TASK-QUALITY-STABILIZE-01 / MVP-RELEASE-GATE-01D — production quality pipeline mode.
 *
 * Production is locked to stable_delivery.
 * advanced_shadow is frozen experimental infrastructure — reachable ONLY when a
 * caller explicitly passes qualityPipelineMode:"advanced_shadow" (tests/harness).
 * Environment variables alone MUST NOT switch production, even when set together.
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
  if (fromDeps === QUALITY_PIPELINE_MODES.ADVANCED_SHADOW) {
    return QUALITY_PIPELINE_MODES.ADVANCED_SHADOW;
  }
  // Env / DIGITALME_ALLOW_ADVANCED_PIPELINE intentionally ignored in production path.
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
