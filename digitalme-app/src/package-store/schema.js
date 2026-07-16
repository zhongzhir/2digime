"use strict";

/**
 * Package schema v0.2 constants and strict validation.
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
const MAX_ACTOR_LEN = 200;
const MAX_SOURCE_REFS = 32;
const MAX_SOURCE_REF_LEN = 500;
const MAX_DATA_KINDS = 16;
const MAX_MIGRATION_JSON = 8_000;
const MAX_CHANGESET_TOTAL_BYTES = 512_000;

function fail(code, message, extra) {
  const e = new Error(message || code);
  e.code = code;
  if (extra && typeof extra === "object") Object.assign(e, extra);
  return e;
}

function isDataKind(k) {
  return DATA_KINDS.includes(k);
}

function isIsoishString(s) {
  if (typeof s !== "string" || !s.trim()) return false;
  // Accept ISO-8601-ish timestamps (strict full parse not required).
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.test(s)) {
    return false;
  }
  const t = Date.parse(s);
  return Number.isFinite(t);
}

function assertSha256Hex(s, field) {
  if (typeof s !== "string" || !/^[a-f0-9]{64}$/i.test(s)) {
    throw fail("content_digest_invalid", `${field}_invalid`);
  }
}

/**
 * Strict manifest shape validation.
 * @param {object} m
 * @param {{ requireV02?: boolean }} [opts]
 */
function assertManifestShape(m, { requireV02 = false } = {}) {
  if (!m || typeof m !== "object" || Array.isArray(m)) {
    throw fail("manifest_invalid", "manifest_invalid");
  }

  if (m.schemaVersion != null && typeof m.schemaVersion !== "string") {
    throw fail("schema_version_invalid", "schema_version_invalid");
  }
  if (m.packageVersion != null && typeof m.packageVersion !== "string") {
    throw fail("package_version_invalid", "package_version_invalid");
  }
  if (m.digitalMeId != null && typeof m.digitalMeId !== "string") {
    throw fail("digital_me_id_invalid", "digital_me_id_invalid");
  }
  if (m.updatedAt != null && typeof m.updatedAt !== "string") {
    throw fail("updated_at_invalid", "updated_at_invalid");
  }
  if (m.revision != null) {
    if (typeof m.revision !== "number" || !Number.isInteger(m.revision) || m.revision < 0) {
      throw fail("revision_invalid", "revision_invalid");
    }
  }

  if (requireV02) {
    if (m.schemaVersion !== SCHEMA_VERSION) {
      throw fail("schema_version_required", "schema_version_required");
    }
    if (typeof m.packageVersion !== "string" || !m.packageVersion.trim()) {
      throw fail("package_version_invalid", "package_version_invalid");
    }
    if (typeof m.revision !== "number" || !Number.isInteger(m.revision) || m.revision < 0) {
      throw fail("revision_invalid", "revision_invalid");
    }
    if (typeof m.digitalMeId !== "string" || !m.digitalMeId.trim()) {
      throw fail("digital_me_id_invalid", "digital_me_id_invalid");
    }
    if (!isIsoishString(m.updatedAt)) {
      throw fail("updated_at_invalid", "updated_at_invalid");
    }
    if (!m.contentDigest || typeof m.contentDigest !== "object" || Array.isArray(m.contentDigest)) {
      throw fail("content_digest_missing", "content_digest_missing");
    }
    const d = m.contentDigest;
    if (d.algorithm !== "sha256") {
      throw fail("content_digest_invalid", "content_digest_algorithm_invalid");
    }
    assertSha256Hex(d.rootSha256, "rootSha256");
    if (typeof d.fileCount !== "number" || !Number.isInteger(d.fileCount) || d.fileCount < 0) {
      throw fail("content_digest_invalid", "content_digest_fileCount_invalid");
    }
  }

  return true;
}

function assertActor(actor) {
  if (typeof actor !== "string") throw fail("actor_required", "actor_required");
  const s = actor.trim();
  if (!s) throw fail("actor_required", "actor_required");
  if (s.length > MAX_ACTOR_LEN) throw fail("actor_too_long", "actor_too_long");
  return s;
}

function assertSourceRefs(sourceRefs) {
  if (sourceRefs == null) return [];
  if (!Array.isArray(sourceRefs)) throw fail("source_refs_invalid", "source_refs_invalid");
  if (sourceRefs.length > MAX_SOURCE_REFS) throw fail("source_refs_too_many", "source_refs_too_many");

  const out = [];
  for (const ref of sourceRefs) {
    if (typeof ref === "string") {
      if (ref.length > MAX_SOURCE_REF_LEN) throw fail("source_ref_too_long", "source_ref_too_long");
      out.push(ref);
      continue;
    }
    if (ref && typeof ref === "object" && !Array.isArray(ref)) {
      const json = JSON.stringify(ref);
      if (json.length > MAX_SOURCE_REF_LEN) throw fail("source_ref_too_long", "source_ref_too_long");
      out.push(ref);
      continue;
    }
    throw fail("source_refs_invalid", "source_refs_invalid");
  }
  return out;
}

function assertDataKinds(dataKinds) {
  if (dataKinds == null) return [];
  if (!Array.isArray(dataKinds)) throw fail("data_kind_invalid", "data_kind_invalid");
  if (dataKinds.length > MAX_DATA_KINDS) throw fail("data_kinds_too_many", "data_kinds_too_many");
  for (const k of dataKinds) {
    if (!isDataKind(k)) throw fail("data_kind_invalid", "data_kind_invalid", { kind: k });
  }
  return dataKinds.slice();
}

function assertMigrationMetadata(migration) {
  if (migration == null) return null;
  if (typeof migration !== "object" || Array.isArray(migration)) {
    throw fail("migration_invalid", "migration_invalid");
  }
  const json = JSON.stringify(migration);
  if (json.length > MAX_MIGRATION_JSON) throw fail("migration_too_large", "migration_too_large");
  return migration;
}

function assertChangeSetSize(csLike) {
  const json = JSON.stringify(csLike);
  if (json.length > MAX_CHANGESET_TOTAL_BYTES) {
    throw fail("changeset_too_large", "changeset_too_large");
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
  MAX_ACTOR_LEN,
  MAX_SOURCE_REFS,
  MAX_SOURCE_REF_LEN,
  MAX_DATA_KINDS,
  MAX_MIGRATION_JSON,
  MAX_CHANGESET_TOTAL_BYTES,
  isDataKind,
  assertManifestShape,
  assertActor,
  assertSourceRefs,
  assertDataKinds,
  assertMigrationMetadata,
  assertChangeSetSize,
};
