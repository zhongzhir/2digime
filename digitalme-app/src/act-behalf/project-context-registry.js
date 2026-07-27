"use strict";

/**
 * LEARN-LOOP-FIX-01: detect project from task goal; resolve ProjectContextSet.
 */

const { PROJECT_IDS } = require("./project-knowledge-schema");
const projectStore = require("./project-knowledge-store");

const DIGITAL_ME_GOAL_RE =
  /digital\s*me|数字之我|数字主体|dvl2|起草.*开发计划|项目开发计划|digitalme/i;

function detectProjectFromGoal(goal) {
  const g = String(goal || "");
  if (DIGITAL_ME_GOAL_RE.test(g)) {
    return {
      projectId: PROJECT_IDS.DIGITAL_ME,
      projectContextId: "pctx_digital_me_default",
      confidence: "high",
      reason: "goal_matches_digital_me",
    };
  }
  return null;
}

function resolveProjectContext(packageDir, { goal, task } = {}) {
  const g = goal || (task && (task.goal || task.request)) || "";
  const detected = detectProjectFromGoal(g);
  if (!detected) {
    return { ok: false, code: "project_unresolved", message: "未能识别项目；请选择或确认项目后再生成。" };
  }

  let contextSet = null;
  let claims = [];
  if (packageDir) {
    const ensured = projectStore.ensureDigitalMeProjectKnowledge(packageDir);
    if (!ensured.ok) return ensured;
    contextSet = projectStore.getContextSet(packageDir, detected.projectContextId);
    claims = projectStore.getClaimsForProject(packageDir, detected.projectId);
  } else {
    claims = projectStore.buildDigitalMeSeedClaims();
    const sourceRefs = [];
    for (const spec of projectStore.DIGITAL_ME_AUTHORITATIVE_FILES) {
      const got = projectStore.readRepoFile(spec.ref);
      if (!got) continue;
      sourceRefs.push({
        ref: spec.ref,
        contentHash: got.contentHash,
        role: spec.role,
        registeredAt: new Date().toISOString(),
      });
    }
    contextSet = {
      projectContextId: detected.projectContextId,
      projectId: detected.projectId,
      title: "Digital Me 项目",
      sourceRefs,
      authoritativeSourceRefs: sourceRefs.filter((s) => s.role === "authoritative" || s.role === "frozen_spec"),
      currentStatusRefs: sourceRefs.filter((s) => s.role === "current_status" || s.role === "accepted_runtime"),
      confirmedDecisionRefs: [],
      supersededRefs: [],
      rejectedRefs: [],
    };
  }

  const materials = [];
  for (const ref of contextSet.sourceRefs || []) {
    const got = projectStore.readRepoFile(ref.ref);
    if (!got || !got.text) continue;
    const limit = 24000;
    const truncated = got.text.length > limit;
    materials.push({
      id: "pctxmat_" + projectStore.sha256Text(ref.ref).slice(7, 19),
      name: ref.ref,
      path: got.absolutePath,
      charCount: got.text.length,
      truncated,
      contentHash: got.contentHash,
      text: truncated ? got.text.slice(0, limit) : got.text,
      note: "project_authoritative_source",
      ok: true,
      projectScope: detected.projectId,
      authorityLevel: ref.role === "authoritative" ? "owner_confirmed" : "current_project_record",
      evidenceKind: "project_material",
      ownership: "project_owned",
    });
  }

  if (!materials.length) {
    return {
      ok: false,
      code: "project_context_empty",
      message: "Digital Me 项目权威资料未注册；请确认仓库规格文件可访问。",
    };
  }

  return {
    ok: true,
    projectId: detected.projectId,
    projectContextId: detected.projectContextId,
    contextSet,
    claims,
    materials,
    displayLabel: "已使用 Digital Me 项目资料",
  };
}

function mergeProjectMaterials(taskMaterials, projectMaterials) {
  const task = Array.isArray(taskMaterials) ? taskMaterials : [];
  const proj = Array.isArray(projectMaterials) ? projectMaterials : [];
  const seen = new Set();
  const out = [];
  // User-attached task materials first (budget priority); project authoritative sources follow.
  for (const m of [...task, ...proj]) {
    if (!m || m.ok === false) continue;
    const key = String(m.contentHash || m.id || m.name || "");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

module.exports = {
  detectProjectFromGoal,
  resolveProjectContext,
  mergeProjectMaterials,
  DIGITAL_ME_GOAL_RE,
};
