"use strict";

/**
 * Scope stubs for image / video / podcast.
 * Extensible interface only — must not claim real quality validation.
 */

const { makeCheck, SCHEMA_VERSION } = require("./quality-evaluation-helpers");

function makeScopeStubEvaluator(kind) {
  const k = String(kind || "other");
  return async function evaluateScopeStub(input) {
    void input;
    return {
      status: "unsupported_scope",
      scope: { artifactKind: k },
      artifactType: k,
      checks: [
        makeCheck({
          id: "real_quality_validation_in_scope",
          passed: false,
          severity: "blocking",
          message: `「${k}」本轮不进行伪质量验证；仅保留可扩展评估接口与 scope 隔离。`,
          actionable: false,
          category: "scope",
        }),
      ],
      evidence: [{ type: "scope_isolation", artifactKind: k, validated: false }],
      evaluatorProvenance: {
        evaluatorId: `scope_stub_${k}`,
        version: SCHEMA_VERSION,
        sources: ["mvp-quality-evaluation-01"],
      },
      actionableRevisions: [],
    };
  };
}

module.exports = {
  makeScopeStubEvaluator,
};
