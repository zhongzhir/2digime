"use strict";

/**
 * LEARN-LOOP-FIX-01: persist ProjectContextSet + ProjectKnowledgeClaim in packageDir/project/.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  SCHEMA_VERSION,
  PROJECT_IDS,
  nowIso,
  newProjectContextId,
  newClaimId,
} = require("./project-knowledge-schema");

function sha256Text(text) {
  return "sha256:" + crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function projectDir(packageDir) {
  return path.join(String(packageDir || ""), "project");
}

function contextSetPath(packageDir) {
  return path.join(projectDir(packageDir), "context-sets.json");
}

function claimsPath(packageDir) {
  return path.join(projectDir(packageDir), "knowledge-claims.json");
}

function ensureDir(packageDir) {
  const dir = projectDir(packageDir);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
}

function loadStore(packageDir) {
  if (!packageDir || !fs.existsSync(packageDir)) {
    return { contextSets: {}, claims: {} };
  }
  const cs = readJson(contextSetPath(packageDir), { schemaVersion: SCHEMA_VERSION, contextSets: {} });
  const cl = readJson(claimsPath(packageDir), { schemaVersion: SCHEMA_VERSION, claims: {} });
  return {
    contextSets: cs.contextSets || {},
    claims: cl.claims || {},
  };
}

function saveContextSets(packageDir, contextSets) {
  ensureDir(packageDir);
  writeJson(contextSetPath(packageDir), {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: nowIso(),
    contextSets,
  });
}

function saveClaims(packageDir, claims) {
  ensureDir(packageDir);
  writeJson(claimsPath(packageDir), {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: nowIso(),
    claims,
  });
}

function resolveRepoRoot() {
  // digitalme-app/src/act-behalf -> repo root
  const candidate = path.resolve(__dirname, "..", "..", "..");
  if (fs.existsSync(path.join(candidate, "digitalme_context.md"))) return candidate;
  return null;
}

function readRepoFile(rel) {
  const root = resolveRepoRoot();
  if (!root) return null;
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) return null;
  try {
    const text = fs.readFileSync(p, "utf8");
    return { path: rel, absolutePath: p, text, contentHash: sha256Text(text) };
  } catch {
    return null;
  }
}

const DIGITAL_ME_AUTHORITATIVE_FILES = Object.freeze([
  { ref: "digitalme_context.md", role: "authoritative" },
  { ref: "digitalme_log.md", role: "current_status" },
  { ref: "digitalme_panorama_execution_index_v0.1.md", role: "current_status" },
  { ref: "digital-me-project-positioning-draft.md", role: "authoritative" },
  { ref: "digitalme_phase1_task_DVL2-03_owner_runtime_acceptance_v0.1.md", role: "accepted_runtime" },
  { ref: "digitalme_phase1_task_DVL2-00_product_and_data_contracts_v0.1.md", role: "frozen_spec" },
  { ref: "digitalme_phase1_task_IDCOLLAB-MIN-01_action_identity_and_authorization_v0.1.md", role: "accepted_runtime" },
]);

/** Core facts extracted from authoritative sources — not hardcoded prompts. */
function buildDigitalMeSeedClaims() {
  const claims = [];
  const base = {
    projectId: PROJECT_IDS.DIGITAL_ME,
    scope: "digital_me_project",
    freshness: nowIso(),
    confidence: "high",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    schemaVersion: SCHEMA_VERSION,
  };

  const entries = [
    {
      claimId: "pkc_dm_positioning",
      claimText:
        "Digital Me 是人的数字主体层：以个人数据、记忆、判断、表达、能力和授权规则为基础，本地优先、平台中立、可迁移、可授权、可审计的个人数字主体系统。",
      claimType: "current_fact",
      authorityLevel: "owner_confirmed",
      confirmationStatus: "owner_confirmed",
      sourceRefs: ["digitalme_context.md", "digital-me-project-positioning-draft.md"],
    },
    {
      claimId: "pkc_dm_no_blockchain_mainline",
      claimText: "区块链不是 Digital Me 的主技术底座；DID/VC/链上存证等仅可作为待评估技术选项，不得写成产品主线。",
      claimType: "confirmed_decision",
      authorityLevel: "frozen_spec",
      confirmationStatus: "frozen",
      sourceRefs: ["digitalme_context.md", "digitalme_subject_architecture_and_rd_principles_v0.1.md"],
    },
    {
      claimId: "pkc_dm_no_stablecoin_mainline",
      claimText: "稳定币、代币经济和数字资产交易不是 Digital Me 当前产品主线；当前不做稳定币钱包与完整代币经济。",
      claimType: "confirmed_decision",
      authorityLevel: "owner_confirmed",
      confirmationStatus: "owner_confirmed",
      sourceRefs: ["digitalme_context.md", "digital-me-project-positioning-draft.md"],
      contradictedBy: null,
      supersedesMemoryIds: ["core_008", "core_009"],
    },
    {
      claimId: "pkc_dm_product_lines",
      claimText:
        "产品双线：A 数字化构建数字之我；B 主体化做事与协作。能力层采取跟随策略，直接导入业界最好能力，不争最强最新。",
      claimType: "current_fact",
      authorityLevel: "owner_confirmed",
      confirmationStatus: "owner_confirmed",
      sourceRefs: ["digitalme_context.md"],
    },
    {
      claimId: "pkc_dm_dvl2_03_status",
      claimText: "DVL2-03 真实成果生成已完成 Owner 真机验收（accepted_as_implemented / owner_runtime_accepted，2026-07-27）。",
      claimType: "current_status",
      authorityLevel: "accepted_runtime_state",
      confirmationStatus: "accepted",
      sourceRefs: ["digitalme_log.md", "digitalme_context.md"],
    },
    {
      claimId: "pkc_dm_idcollab_status",
      claimText: "IDCOLLAB-MIN-01 最小行动身份与本地授权语义已实现并通过 Owner 真机验收（owner_runtime_accepted / accepted_as_implemented；仅限最小身份协作闭环，外部网络协作未验证）。",
      claimType: "current_status",
      authorityLevel: "accepted_runtime_state",
      confirmationStatus: "accepted",
      sourceRefs: ["digitalme_log.md"],
    },
    {
      claimId: "pkc_dm_learn_loop_p0",
      claimText: "当前 P0 是学习闭环可靠性修复（LEARN-LOOP-FIX-01）；不得将外部协作网络、Digital Org、支付结算写成已启动能力。",
      claimType: "current_status",
      authorityLevel: "current_project_record",
      confirmationStatus: "accepted",
      sourceRefs: ["digitalme_log.md", "LEARN_LOOP_FORENSIC_AUDIT_20260727.md"],
    },
    {
      claimId: "pkc_dm_hist_core006",
      claimText:
        "数字资产须具备真实场景、真实价值、真实交付——这是 Owner 的宏观判断，不是 Digital Me 当前 MVP 产品范围。",
      claimType: "historical_exploration",
      authorityLevel: "historical_record",
      confirmationStatus: "superseded",
      sourceRefs: ["memory:core_006"],
      memoryAssetId: "core_006",
      supersededBy: "pkc_dm_no_stablecoin_mainline",
    },
    {
      claimId: "pkc_dm_hist_core008",
      claimText:
        "AI 治理中的 UBC（通用基本资本）理念——属于早期探索与宏观政策讨论，不是 Digital Me 当前产品功能。",
      claimType: "historical_exploration",
      authorityLevel: "historical_record",
      confirmationStatus: "superseded",
      sourceRefs: ["memory:core_008"],
      memoryAssetId: "core_008",
      supersededBy: "pkc_dm_no_stablecoin_mainline",
    },
    {
      claimId: "pkc_dm_hist_core009",
      claimText:
        "稳定币作为数字经济基础设施——属于区块链/金融探索记忆，不是 Digital Me 当前主线。",
      claimType: "historical_exploration",
      authorityLevel: "historical_record",
      confirmationStatus: "superseded",
      sourceRefs: ["memory:core_009"],
      memoryAssetId: "core_009",
      supersededBy: "pkc_dm_no_stablecoin_mainline",
    },
  ];

  for (const e of entries) {
    claims.push({
      claimId: e.claimId,
      ...base,
      ...e,
      effectiveFrom: nowIso(),
      supersededBy: e.supersededBy || null,
      contradictedBy: e.contradictedBy || null,
    });
  }
  return claims;
}

function buildDigitalMeContextSet(repoFiles) {
  const sourceRefs = [];
  const authoritativeSourceRefs = [];
  const currentStatusRefs = [];
  const confirmedDecisionRefs = [];
  const supersededRefs = [];
  const rejectedRefs = [];

  for (const spec of DIGITAL_ME_AUTHORITATIVE_FILES) {
    const got = repoFiles[spec.ref];
    if (!got) continue;
    const entry = {
      ref: spec.ref,
      contentHash: got.contentHash,
      role: spec.role,
      registeredAt: nowIso(),
    };
    sourceRefs.push(entry);
    if (spec.role === "authoritative" || spec.role === "frozen_spec") {
      authoritativeSourceRefs.push(entry);
    } else if (spec.role === "current_status" || spec.role === "accepted_runtime") {
      currentStatusRefs.push(entry);
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    projectContextId: "pctx_digital_me_default",
    projectId: PROJECT_IDS.DIGITAL_ME,
    title: "Digital Me 项目",
    sourceRefs,
    authoritativeSourceRefs,
    confirmedDecisionRefs,
    currentStatusRefs,
    supersededRefs,
    rejectedRefs,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
}

/**
 * Ensure Digital Me project context + claims exist in packageDir.
 * Reads authoritative files from repo; registers hashes in context set.
 */
function ensureDigitalMeProjectKnowledge(packageDir) {
  if (!packageDir) return { ok: false, code: "no_package_dir" };
  ensureDir(packageDir);
  const store = loadStore(packageDir);
  const repoFiles = {};
  for (const spec of DIGITAL_ME_AUTHORITATIVE_FILES) {
    const got = readRepoFile(spec.ref);
    if (got) repoFiles[spec.ref] = got;
  }

  const contextSet = buildDigitalMeContextSet(repoFiles);
  store.contextSets[contextSet.projectContextId] = contextSet;

  const seedClaims = buildDigitalMeSeedClaims();
  const seedIds = new Set(seedClaims.map((c) => c.claimId));
  for (const c of seedClaims) {
    const existing = store.claims[c.claimId];
    if (existing && existing.confirmationStatus === "owner_confirmed") {
      store.claims[c.claimId] = { ...existing, updatedAt: nowIso() };
    } else if (!existing || seedIds.has(existing.claimId)) {
      store.claims[c.claimId] = c;
    }
  }

  saveContextSets(packageDir, store.contextSets);
  saveClaims(packageDir, store.claims);
  return {
    ok: true,
    projectContextId: contextSet.projectContextId,
    projectId: PROJECT_IDS.DIGITAL_ME,
    sourceCount: contextSet.sourceRefs.length,
    claimCount: Object.keys(store.claims).length,
    repoFiles: Object.keys(repoFiles),
  };
}

function getContextSet(packageDir, projectContextId) {
  const store = loadStore(packageDir);
  return store.contextSets[projectContextId] || null;
}

function getClaimsForProject(packageDir, projectId) {
  const store = loadStore(packageDir);
  return Object.values(store.claims).filter((c) => c && c.projectId === projectId);
}

function upsertClaim(packageDir, claim) {
  const store = loadStore(packageDir);
  store.claims[claim.claimId] = { ...claim, updatedAt: nowIso() };
  saveClaims(packageDir, store.claims);
  return store.claims[claim.claimId];
}

function supersedeClaim(packageDir, oldClaimId, newClaimId, meta) {
  const store = loadStore(packageDir);
  const old = store.claims[oldClaimId];
  if (!old) return { ok: false, code: "claim_not_found" };
  const now = nowIso();
  store.claims[oldClaimId] = {
    ...old,
    supersededBy: newClaimId,
    confirmationStatus: old.confirmationStatus === "owner_confirmed" ? "superseded" : old.confirmationStatus,
    updatedAt: now,
    supersessionMeta: {
      reason: (meta && meta.reason) || "superseded",
      sourceRef: (meta && meta.sourceRef) || null,
      at: now,
    },
  };
  saveClaims(packageDir, store.claims);
  return { ok: true, oldClaimId, newClaimId };
}

function revokeClaim(packageDir, claimId, meta) {
  const store = loadStore(packageDir);
  const old = store.claims[claimId];
  if (!old) return { ok: false, code: "claim_not_found" };
  const now = nowIso();
  store.claims[claimId] = {
    ...old,
    confirmationStatus: "rejected",
    updatedAt: now,
    revocationMeta: {
      reason: (meta && meta.reason) || "revoked",
      at: now,
    },
  };
  saveClaims(packageDir, store.claims);
  return { ok: true, claimId };
}

function loadContextMaterials(packageDir, contextSet, maxCharsPerFile) {
  const limit = Number(maxCharsPerFile) > 0 ? Number(maxCharsPerFile) : 24000;
  const materials = [];
  if (!contextSet || !Array.isArray(contextSet.sourceRefs)) return materials;

  for (const ref of contextSet.sourceRefs) {
    const got = readRepoFile(ref.ref);
    if (!got || !got.text) continue;
    const truncated = got.text.length > limit;
    materials.push({
      id: "pctxmat_" + sha256Text(ref.ref).slice(7, 19),
      name: ref.ref,
      path: got.absolutePath,
      charCount: got.text.length,
      truncated,
      contentHash: got.contentHash,
      text: truncated ? got.text.slice(0, limit) : got.text,
      note: "project_authoritative_source",
      ok: true,
      projectScope: contextSet.projectId,
      authorityLevel: ref.role === "authoritative" ? "owner_confirmed" : "current_project_record",
      evidenceKind: "project_material",
      ownership: "project_owned",
    });
  }
  return materials;
}

module.exports = {
  loadStore,
  ensureDigitalMeProjectKnowledge,
  getContextSet,
  getClaimsForProject,
  upsertClaim,
  supersedeClaim,
  revokeClaim,
  loadContextMaterials,
  readRepoFile,
  resolveRepoRoot,
  DIGITAL_ME_AUTHORITATIVE_FILES,
  buildDigitalMeSeedClaims,
  projectDir,
  sha256Text,
};
