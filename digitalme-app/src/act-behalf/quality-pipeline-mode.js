"use strict";

/**
 * TASK-QUALITY-STABILIZE-01 — production quality pipeline mode.
 *
 * MVP-RELEASE-GATE-01B: production is locked to stable_delivery.
 * advanced_shadow is frozen experimental infrastructure — reachable only when a
 * caller explicitly passes qualityPipelineMode (tests) or sets BOTH
 * DIGITALME_QUALITY_PIPELINE_MODE=advanced_shadow and
 * DIGITALME_ALLOW_ADVANCED_PIPELINE=1. Ordinary env alone must not switch production.
 *
 * Not a user-facing setting / not a new persistent store.
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
  const fromEnv = String(process.env.DIGITALME_QUALITY_PIPELINE_MODE || "").trim();
  const allowAdvanced = process.env.DIGITALME_ALLOW_ADVANCED_PIPELINE === "1";
  if (fromEnv === QUALITY_PIPELINE_MODES.ADVANCED_SHADOW && allowAdvanced) {
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
