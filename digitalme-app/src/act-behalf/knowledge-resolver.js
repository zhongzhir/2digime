"use strict";

/**
 * LEARN-LOOP-FIX-02: unified Knowledge Resolver for all surfaces.
 */

const crypto = require("node:crypto");
const retrieval = require("../retrieval");
const { assembleSubjectContext } = require("./subject-context-assembler");
const { classifyTaskContext, resolveAssemblyPolicy } = require("./subject-context-engine");
const projectStore = require("./project-knowledge-store");
const { retrieveProjectClaims, renderProjectClaimsSection } = require("./project-knowledge-retrieval");
const { detectProjectScope } = require("./project-detection");
const { PROJECT_IDS } = require("./project-knowledge-schema");
const { budgetAttachmentContext } = require("./deliverable-context");
const { confirmationStatusLabel } = require("./learning-adoption-policy");
const { recordClaimUsage } = require("./knowledge-learning");

function ensurePrincipleClaimsIncluded(result, claims, query) {
  if (!result || !/原则|界面|按需|极简|工作界面|详情页/.test(String(query || ""))) return result;
  const selectedIds = new Set(result.retrievedClaimIds || []);
  for (const claim of claims || []) {
    if (!claim || selectedIds.has(claim.claimId)) continue;
    if (claim.supersededBy || claim.confirmationStatus === "rejected") continue;
    if (claim.claimType !== "work_principle") continue;
    if (
      !["owner_confirmed", "auto_adopted", "reinforced"].includes(claim.confirmationStatus) &&
      claim.authorityLevel !== "owner_confirmed"
    ) {
      continue;
    }
    result.claims = result.claims || [];
    result.claims.push(claim);
    result.retrievedClaimIds.push(claim.claimId);
    selectedIds.add(claim.claimId);
  }
  return result;
}

function sha256Text(text) {
  return "sha256:" + crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function pickActiveClaims(claims) {
  const list = Array.isArray(claims) ? claims : [];
  const byKey = new Map();
  for (const c of list) {
    if (!c || !c.claimText) continue;
    if (c.confirmationStatus === "rejected" || c.supersededBy) continue;
    const key = String(c.claimType || "other") + "|" + String(c.claimText).slice(0, 48);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, c);
      continue;
    }
    const prevTime = Date.parse(prev.effectiveFrom || prev.updatedAt || prev.createdAt || 0) || 0;
    const curTime = Date.parse(c.effectiveFrom || c.updatedAt || c.createdAt || 0) || 0;
    const prevRank = statusRank(prev);
    const curRank = statusRank(c);
    if (curRank > prevRank || (curRank === prevRank && curTime > prevTime)) {
      byKey.set(key, c);
    }
  }
  return Array.from(byKey.values());
}

function statusRank(claim) {
  const auth = String(claim.authorityLevel || "");
  const conf = String(claim.confirmationStatus || "");
  if (conf === "owner_confirmed" || auth === "owner_confirmed") return 6;
  if (conf === "reinforced") return 5;
  if (conf === "auto_adopted") return 4;
  if (conf === "frozen" || auth === "frozen_spec") return 4;
  if (conf === "accepted" || auth === "accepted_runtime_state") return 3;
  if (conf === "candidate") return 1;
  return 2;
}

function buildProjectMaterials(contextSet, projectId) {
  const materials = [];
  for (const ref of (contextSet && contextSet.sourceRefs) || []) {
    const got = projectStore.readRepoFile(ref.ref);
    if (!got || !got.text) continue;
    const limit = 24000;
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
      projectScope: projectId,
      authorityLevel: ref.role === "authoritative" ? "owner_confirmed" : "current_project_record",
      evidenceKind: "project_material",
      ownership: "project_owned",
    });
  }
  return materials;
}

function mergeMaterials(taskMaterials, projectMaterials) {
  const task = Array.isArray(taskMaterials) ? taskMaterials : [];
  const proj = Array.isArray(projectMaterials) ? projectMaterials : [];
  const seen = new Set();
  const out = [];
  for (const m of [...task, ...proj]) {
    if (!m || m.ok === false) continue;
    const key = String(m.contentHash || m.id || m.name || "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

function renderEvidenceRows(resolved) {
  const rows = [];
  for (const c of resolved.selectedClaims || []) {
    rows.push({
      summary: String(c.claimText || "").slice(0, 120),
      source: formatClaimSource(c),
      status: claimStatusLabel(c),
      claimId: c.claimId,
      authorityLevel: c.authorityLevel,
    });
  }
  for (const m of resolved.selectedMemories || []) {
    rows.push({
      summary: String(m.text || m.statement || "").slice(0, 120),
      source: m.source || "记忆",
      status: "参考",
      memoryId: m.id || m.assetId,
    });
  }
  return rows;
}

function formatClaimSource(c) {
  const ref = (c.sourceRefs && c.sourceRefs[0]) || "";
  if (/owner_chat_input|direct_user_statement/i.test(ref)) return "你的直接输入";
  if (/owner_chat_confirm|owner_confirmed/i.test(ref)) return "你已明确确认";
  if (c.confirmationStatus === "auto_adopted") return "你的直接输入";
  if (ref.startsWith("digitalme_") || ref.endsWith(".md")) return "项目资料";
  return ref || "项目知识";
}

function claimStatusLabel(c) {
  if (c.confirmationStatus) {
    return confirmationStatusLabel(c.confirmationStatus);
  }
  if (c.authorityLevel === "owner_confirmed") return "你已明确确认";
  if (c.claimType === "current_status") return "已验收";
  if (c.claimType === "confirmed_decision") return "当前有效";
  if (c.claimType === "historical_exploration") return "历史探索";
  return "参考";
}

/**
 * @param {object} opts
 * @param {string} opts.query
 * @param {string} [opts.packageDir]
 * @param {string} [opts.surface] chat | deliverable | research | writing | plan
 * @param {object} [opts.task]
 * @param {string} [opts.projectHint]
 * @param {string} [opts.boundProjectId]
 * @param {string} [opts.conversationProjectId]
 * @param {Array} [opts.currentMaterials]
 * @param {number} [opts.tokenBudget]
 */
function resolveKnowledgeContext(opts) {
  const query = String((opts && opts.query) || "").trim();
  const packageDir = (opts && opts.packageDir) || null;
  const surface = (opts && opts.surface) || "chat";
  const tokenBudget = Number(opts && opts.tokenBudget) > 0 ? Number(opts.tokenBudget) : 12000;
  const currentMaterials = Array.isArray(opts && opts.currentMaterials) ? opts.currentMaterials : [];

  let detected = detectProjectScope({
    query,
    goal: query,
    task: opts && opts.task,
    projectHint: opts && opts.projectHint,
    boundProjectId: opts && opts.boundProjectId,
    conversationProjectId: opts && opts.conversationProjectId,
  });

  if (
    !detected.projectId &&
    packageDir &&
    /原则|界面设计|按需展开|工作界面/.test(query)
  ) {
    const dmClaims = projectStore.getClaimsForProject(packageDir, PROJECT_IDS.DIGITAL_ME);
    const hasPrinciple = dmClaims.some(
      (c) =>
        c &&
        c.claimType === "work_principle" &&
        !c.supersededBy &&
        ["owner_confirmed", "auto_adopted", "reinforced"].includes(c.confirmationStatus)
    );
    if (hasPrinciple) {
      detected = {
        projectId: PROJECT_IDS.DIGITAL_ME,
        projectContextId: "pctx_digital_me_default",
        confidence: "medium",
        reason: "active_principle_query",
      };
    }
  }

  const excludedItems = [];
  let projectContext = null;
  let claims = [];
  let projectMaterials = [];

  if (detected.projectId === PROJECT_IDS.DIGITAL_ME && packageDir) {
    projectStore.ensureDigitalMeProjectKnowledge(packageDir);
    const contextSet = detected.projectContextId
      ? projectStore.getContextSet(packageDir, detected.projectContextId)
      : null;
    claims = pickActiveClaims(projectStore.getClaimsForProject(packageDir, detected.projectId));
    if (contextSet) {
      projectMaterials = buildProjectMaterials(contextSet, detected.projectId);
      projectContext = {
        projectId: detected.projectId,
        projectContextId: detected.projectContextId,
        displayLabel: "已使用 Digital Me 项目资料",
        confidence: detected.confidence,
      };
    }
  } else if (detected.projectId && !packageDir) {
    excludedItems.push({ reason: "no_package_dir", note: "未配置资料包，未挂载项目权威事实" });
  } else if (detected.confidence === "low" && detected.reason === "unresolved") {
    excludedItems.push({ reason: "project_unresolved", note: "未识别项目，仅使用全局主体知识" });
  }

  const projectRetrievalRaw =
    detected.projectId && claims.length
      ? retrieveProjectClaims({
          claims,
          query,
          projectId: detected.projectId,
          topK: surface === "deliverable" ? 16 : 10,
        })
      : { claims: [], retrievedClaimIds: [], excludedClaims: [], authoritySummary: null };
  const projectRetrieval = ensurePrincipleClaimsIncluded(projectRetrievalRaw, claims, query);

  if (packageDir && projectRetrieval.retrievedClaimIds) {
    for (const claimId of projectRetrieval.retrievedClaimIds) {
      try {
        recordClaimUsage(packageDir, claimId, { successful: true });
      } catch {
        /* ignore */
      }
    }
  }

  for (const ex of projectRetrieval.excludedClaims || []) {
    excludedItems.push({ claimId: ex.claimId, reason: ex.reason });
  }

  const mergedMaterials = mergeMaterials(currentMaterials, projectMaterials);
  const attachmentBudget = budgetAttachmentContext(mergedMaterials, tokenBudget);

  const taskContext = (opts && opts.taskContext) || {
    goal: query,
    deliverableKind: surface === "deliverable" ? "document" : "",
    deliverableTitle: "",
    deliverablePurpose: "",
  };
  if (!taskContext.goal) taskContext.goal = query;
  const classification = classifyTaskContext(taskContext);
  const policy = resolveAssemblyPolicy(classification);
  const projectRendered = renderProjectClaimsSection(projectRetrieval);

  let subjectAssembly = null;
  if (packageDir) {
    subjectAssembly = assembleSubjectContext({
      packageDir,
      query: taskContext,
      policy,
      contextClass: classification.contextClass,
      projectRenderedText: projectRendered,
    });
  }

  let lexical = { memories: [], frameworks: [], life: [] };
  if (packageDir && query) {
    try {
      lexical = retrieval.retrieve(packageDir, query, {
        topMemories: surface === "chat" ? 4 : 3,
        topFrameworks: 2,
        topLife: 2,
        minScore: 0.2,
      });
    } catch {
      lexical = { memories: [], frameworks: [], life: [] };
    }
  }

  const selectedMemories = [];
  if (subjectAssembly && Array.isArray(subjectAssembly.refs)) {
    for (const r of subjectAssembly.refs) {
      if (r.layer === "memory" && r.included !== false) {
        selectedMemories.push({
          id: r.assetId,
          assetId: r.assetId,
          statement: r.statement,
          source: r.source || "subject_assembly",
        });
      }
    }
  }
  for (const m of lexical.memories || []) {
    if (/稳定币|UBC|通用基本资本|治理代币/i.test(m.text || "")) {
      excludedItems.push({ memoryId: m.id, reason: "blockchain_finance_exploration_lexical" });
      continue;
    }
    selectedMemories.push({ id: m.id, text: m.text, source: "lexical_retrieval", score: m.score });
  }

  const promptSections = [];
  if (attachmentBudget.text) {
    promptSections.push("## 当前材料\n\n" + attachmentBudget.text);
  }
  if (projectRendered) {
    promptSections.push(projectRendered);
  }
  if (subjectAssembly && subjectAssembly.renderedText) {
    promptSections.push("## 主体知识\n\n" + subjectAssembly.renderedText);
  }
  if (lexical.frameworks && lexical.frameworks.length) {
    promptSections.push(
      "## 相关判断框架\n\n" + lexical.frameworks.map((f) => "- " + f.text).join("\n")
    );
  }

  const contextDigest = sha256Text(
    JSON.stringify({
      query: query.slice(0, 200),
      projectId: detected.projectId,
      claimIds: (projectRetrieval.retrievedClaimIds || []).slice(0, 20),
      memoryIds: selectedMemories.map((m) => m.id).slice(0, 20),
    })
  );

  const resolved = {
    ok: true,
    detectedScope: detected,
    projectContext,
    subjectKnowledge: subjectAssembly,
    currentMaterials: mergedMaterials,
    selectedClaims: projectRetrieval.claims || [],
    selectedMemories,
    excludedItems,
    exclusionReasons: excludedItems.map((e) => e.reason),
    authoritySummary: projectRetrieval.authoritySummary || null,
    freshnessSummary: {
      activeClaimCount: (projectRetrieval.claims || []).length,
      projectConfidence: detected.confidence,
    },
    conflictSummary: excludedItems.filter((e) => /conflict|superseded|historical/.test(e.reason || "")),
    sourceRefs: (projectRetrieval.claims || []).flatMap((c) => c.sourceRefs || []).slice(0, 20),
    contextDigest,
    promptText: promptSections.join("\n\n"),
    provenance: {
      projectId: detected.projectId,
      projectContextId: detected.projectContextId || null,
      selectedClaimIds: projectRetrieval.retrievedClaimIds || [],
      selectedMemoryIds: selectedMemories.map((m) => m.id || m.assetId).filter(Boolean),
      sourceRefs: (projectRetrieval.claims || []).flatMap((c) => c.sourceRefs || []).slice(0, 20),
      excludedItems,
      contextDigest,
      surface,
    },
    evidenceRows: [],
    attachmentBudget,
    classification,
    policy,
    subjectAssembly,
    projectRetrieval,
  };
  resolved.evidenceRows = renderEvidenceRows(resolved);
  return resolved;
}

module.exports = {
  resolveKnowledgeContext,
  pickActiveClaims,
  renderEvidenceRows,
  mergeMaterials,
};
