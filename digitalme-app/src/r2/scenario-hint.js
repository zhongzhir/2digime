"use strict";

const ALLOWED = Object.freeze(["general_chat", "continue_chat", "artifact_discussion"]);

/**
 * Normalize / reject scenarioHint per frozen R2 §21.1.
 * @returns {{ ok: true, value: string } | { ok: false, code: string, message: string }}
 */
function normalizeScenarioHint(raw) {
  if (raw === undefined || raw === null) {
    return { ok: true, value: "general_chat" };
  }
  if (typeof raw !== "string") {
    return {
      ok: false,
      code: "invalid_scenario_hint",
      message: "场景参数无效，请重试。",
    };
  }
  // Empty / whitespace-only → reject (not omit). Only undefined/null omit → general_chat.
  if (!Object.is(raw, raw.trim()) || raw.length === 0) {
    return {
      ok: false,
      code: "invalid_scenario_hint",
      message: "场景参数无效，请重试。",
    };
  }
  if (!ALLOWED.includes(raw)) {
    return {
      ok: false,
      code: "invalid_scenario_hint",
      message: "场景参数无效，请重试。",
    };
  }
  return { ok: true, value: raw };
}

function isAllowedScenarioHint(value) {
  return ALLOWED.includes(value);
}

module.exports = {
  ALLOWED_SCENARIO_HINTS: ALLOWED,
  normalizeScenarioHint,
  isAllowedScenarioHint,
};
