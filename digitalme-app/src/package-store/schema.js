"use strict";

/**
 * Package schema v0.2 constants and light validation.
 * Content digest is integrity only — never called a signature.
 */

const DATA_KINDS = Object.freeze([
  "evidence",
  "fact",
  "owner_assertion",
  "inference",
  "current_state",
  "development_intent",
  "capability_policy",
]);

const SCHEMA_VERSION = "0.2";
const PACKAGE_VERSION_DEFAULT = "0.2";

/** Paths / dir names excluded from current content root digest. */
const DIGEST_EXCLUSIONS = Object.freeze([
  ".digitalme-pkgstore",
  ".git",
  "node_modules",
  "cache",
  "caches",
  "embeddings",
  "embedding",
  "tmp",
  "temp",
  ".tmp",
  "__dm_staging__",
  "swap-backup",
]);

const ALLOWED_PACKAGE_REL_PREFIXES = Object.freeze([
  "manifest.json",
  "identity.json",
  "identity-facts.md",
  "persona.md",
  "style-guide.md",
  "preferences.json",
  "decision-frameworks.json",
  "memory/",
  "sources/",
  "policies/",
  "prompts/",
  "life/",
  "skills/",
  "definitions/",
  "contracts/",
  "commerce/",
  "trust/",
  "audit/",
  "README.md",
]);

const MAX_REASON_LEN = 2000;
const MAX_CONTENT_LEN = 100_000;
const MAX_CHANGESET_OPS = 64;
const MAX_PATH_LEN = 240;

function isDataKind(k) {
  return DATA_KINDS.includes(k);
}

function assertManifestShape(m, { requireV02 = false } = {}) {
  if (!m || typeof m !== "object" || Array.isArray(m)) {
    const err = new Error("manifest_invalid");
    err.code = "manifest_invalid";
    throw err;
  }
  if (requireV02) {
    if (m.schemaVersion !== SCHEMA_VERSION) {
      const err = new Error("schema_version_required");
      err.code = "schema_version_required";
      throw err;
    }
    if (typeof m.revision !== "number" || !Number.isInteger(m.revision) || m.revision < 0) {
      const err = new Error("revision_invalid");
      err.code = "revision_invalid";
      throw err;
    }
    if (!m.contentDigest || typeof m.contentDigest !== "object") {
      const err = new Error("content_digest_missing");
      err.code = "content_digest_missing";
      throw err;
    }
  }
  return true;
}

module.exports = {
  DATA_KINDS,
  SCHEMA_VERSION,
  PACKAGE_VERSION_DEFAULT,
  DIGEST_EXCLUSIONS,
  ALLOWED_PACKAGE_REL_PREFIXES,
  MAX_REASON_LEN,
  MAX_CONTENT_LEN,
  MAX_CHANGESET_OPS,
  MAX_PATH_LEN,
  isDataKind,
  assertManifestShape,
};
