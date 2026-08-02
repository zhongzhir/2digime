"use strict";

/**
 * Tiny shared helpers to avoid circular requires between evaluation modules.
 */

const SCHEMA_VERSION = 1;

function makeCheck({ id, passed, severity, message, evidence, category, actionable }) {
  return {
    id: String(id || "check"),
    passed: !!passed,
    severity: severity || (passed ? "info" : "blocking"),
    message: String(message || ""),
    evidence: evidence == null ? null : evidence,
    category: category || null,
    actionable: actionable !== false,
  };
}

module.exports = {
  SCHEMA_VERSION,
  makeCheck,
};
