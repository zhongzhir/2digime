"use strict";

/**
 * DVL2-03 deliverable generation orchestrator.
 */

const crypto = require("node:crypto");
const packageStore = require("./deliverable-package-store");
const { nowIso, newId } = require("./deliverable-package-schema");
const { commitVersionFiles } = require("./deliverable-artifact-fs");
const { generateByKind } = require("./deliverable-generators");
const actBehalfStore = require("./task-store");
const { assembleSubjectContext } = require("./subject-context-assembler");
const {
  classifyTaskContext,
  resolveAssemblyPolicy,
  finalizeSubjectAssembly,
  tagAttachmentRefs,
} = require("./subject-context-engine");
const { unwrapField, budgetAttachmentContext } = require("./deliverable-context");

function newAttemptId() {
  return newId("dgatt_");
}

function newVersionId() {
  return newId("dver_");
}

function newArtifactId() {
  return newId("aref_");
}

function assertTaskMaterialsFresh(userData, taskId) {
  if (!taskId) return { ok: true };
  try {
    const got = actBehalfStore.getTask(userData, taskId, { heal: false });
    if (!got || !got.ok || !got.task) return { ok: true };
    const ptr = got.task.deliverablePlanning || {};
    if (ptr.materialsStale) {
      return {
        ok: false,
        code: "plan_materials_stale",
        message: "参考材料已变化，请重新形成预计交付后再生成。",
        materialsStale: true,
      };
    }
  } catch {
    /* ignore */
  }
  return { ok: true };
}

function mimeForName(name) {
  if (name.endsWith(".md")) return "text/markdown";
  if (name.endsWith(".html")) return "text/html";
  if (name.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (name.endsWith(".pptx"))
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

function topoSortDeliverables(deliverables) {
  const byId = new Map(deliverables.map((d) => [String(d.id), d]));
  const visited = new Set();
  const stack = new Set();
  const ordered = [];
  function visit(id) {
    const key = String(id);
    if (visited.has(key)) return;
    if (stack.has(key)) return; // cycle: skip edge
    stack.add(key);
    const d = byId.get(key);
    if (d) {
      for (const dep of d.dependencies || []) {
        if (byId.has(String(dep))) visit(dep);
      }
      visited.add(key);
      ordered.push(d);
    }
    stack.delete(key);
  }
  for (const d of deliverables) visit(d.id);
  return ordered;
}

function derivePackageStatuses(deliverables) {
  const included = deliverables.filter((d) => d.planDisposition === "included");
  const gens = included.map((d) => d.generationStatus);
  let lifecycleStatus = "planned";
  let completionStatus = "none";
  if (gens.some((g) => g === "queued" || g === "generating")) {
    lifecycleStatus = "in_progress";
    completionStatus = "none";
  } else if (gens.every((g) => g === "planned")) {
    lifecycleStatus = "planned";
    completionStatus = "none";
  } else {
    const readyish = gens.filter((g) =>
      ["generated", "validating", "ready", "superseded"].includes(g)
    ).length;
    const failed = gens.filter((g) =>
      ["failed", "cancelled", "interrupted"].includes(g)
    ).length;
    if (readyish === included.length) {
      lifecycleStatus = "completed";
      completionStatus = "complete";
    } else if (readyish > 0 && failed > 0) {
      lifecycleStatus = "completed";
      completionStatus = "partial";
    } else if (readyish > 0) {
      lifecycleStatus = "completed";
      completionStatus = "partial";
    } else if (failed === included.length) {
      lifecycleStatus = "completed";
      completionStatus = "failed";
    } else {
      lifecycleStatus = "in_progress";
      completionStatus = "none";
    }
  }
  return { lifecycleStatus, completionStatus };
}

function makeArtifactRef({ versionId, relativePath, contentHash, byteSize, name }) {
  return {
    id: newArtifactId(),
    versionId,
    storageKind: "local_deliverable_relative",
    relativePath,
    externalUri: null,
    contentHash,
    mimeType: mimeForName(name),
    byteSize,
    absolutePathCache: null,
    format: name.includes(".") ? name.split(".").pop() : "",
    createdAt: nowIso(),
  };
}

/**
 * @param {object} deps
 * @param {Function} deps.callModel
 * @param {string} [deps.imageMode] 'mock' | 'real'
 */
async function generateOneDeliverable(userData, { packageId, deliverableId }, deps) {
  const store = packageStore.loadStore(userData);
  const pkg = store.packages[String(packageId)];
  if (!pkg || pkg.softDeletedAt) {
    return { ok: false, code: "package_not_found", message: "未找到成果包。" };
  }
  const deliverable = store.deliverables[String(deliverableId)];
  if (!deliverable || String(deliverable.packageId) !== String(packageId)) {
    return { ok: false, code: "deliverable_not_found", message: "未找到该项成果。" };
  }
  if (deliverable.planDisposition === "removed") {
    return { ok: false, code: "deliverable_removed", message: "该项已从计划中移除。" };
  }

  const materialsGate = assertTaskMaterialsFresh(userData, pkg.taskId);
  if (!materialsGate.ok) return materialsGate;

  const attemptId = newAttemptId();
  const startedAt = nowIso();
  const attempt = {
    schemaVersion: 1,
    id: attemptId,
    packageId: String(packageId),
    deliverableId: String(deliverableId),
    status: "generating",
    startedAt,
    finishedAt: null,
    modelAdapter: "invokeModelRoute/callModel",
    inputDigest: "sha256:" + crypto.createHash("sha256").update(String(pkg.sourcePlanVersionId || "") + "|" + deliverableId).digest("hex"),
    errorCode: null,
    errorSummary: null,
    producedVersionId: null,
    outcome: null,
  };

  await packageStore.mutateStore(userData, (s) => {
    s.generationAttempts = s.generationAttempts || {};
    s.generationAttempts[attemptId] = attempt;
    const d = s.deliverables[String(deliverableId)];
    if (d) {
      d.generationStatus = "generating";
      d.latestGenerationAttemptId = attemptId;
      d.updatedAt = nowIso();
    }
    const p = s.packages[String(packageId)];
    if (p) {
      const dels = (p.deliverableIds || []).map((id) => s.deliverables[id]).filter(Boolean);
      const derived = derivePackageStatuses(dels);
      p.lifecycleStatus = derived.lifecycleStatus;
      p.completionStatus = derived.completionStatus;
      p.updatedAt = nowIso();
    }
    return true;
  });

  let produced;
  let taskRecord = null;
  try {
    const taskGot = actBehalfStore.getTask(userData, pkg.taskId, { heal: false });
    taskRecord = taskGot && taskGot.ok ? taskGot.task : null;
  } catch {
    taskRecord = null;
  }

  const snap = (pkg && pkg.executionSnapshot) || {};
  const input = snap.inputSummary || {};
  const taskContext = {
    goal:
      unwrapField(input.goal) ||
      unwrapField(taskRecord && taskRecord.goal) ||
      unwrapField(taskRecord && taskRecord.request) ||
      "",
    audience: unwrapField(input.audience) || "",
    usage: unwrapField(input.usage) || "",
    constraints: unwrapField(input.constraints) || "",
    deliverableKind: deliverable.kind,
    deliverableTitle: deliverable.title,
    deliverablePurpose: deliverable.purpose,
  };
  const classification = classifyTaskContext(taskContext);
  const policy = resolveAssemblyPolicy(classification);
  const materials = (taskRecord && taskRecord.referenceMaterials) || [];
  const attachmentBudget = budgetAttachmentContext(materials, 18000);
  let subjectAssembly = assembleSubjectContext({
    packageDir: deps.packageDir || null,
    query: {
      ...taskContext,
      attachmentKeywords: materials.map((m) => m && m.name).filter(Boolean),
    },
    policy,
    contextClass: classification.contextClass,
  });
  subjectAssembly = finalizeSubjectAssembly(subjectAssembly, {
    classification,
    policy,
    attachmentRefs: attachmentBudget.usedRefs,
  });

  try {
    produced = await generateByKind(deliverable.kind, {
      pkg,
      deliverable,
      task: taskRecord,
      referenceMaterials: materials,
      subjectAssembly,
      callModel: deps.callModel,
      imageMode: deps.imageMode,
    });
  } catch (err) {
    const code = (err && err.code) || "generation_failed";
    const message = (err && err.message) || "生成失败。";
    await packageStore.mutateStore(userData, (s) => {
      const a = s.generationAttempts[attemptId];
      if (a) {
        a.status = "failed";
        a.finishedAt = nowIso();
        a.errorCode = code;
        a.errorSummary = message;
        a.outcome = "failed";
      }
      const d = s.deliverables[String(deliverableId)];
      if (d) {
        d.generationStatus = "failed";
        d.updatedAt = nowIso();
      }
      const p = s.packages[String(packageId)];
      if (p) {
        const dels = (p.deliverableIds || []).map((id) => s.deliverables[id]).filter(Boolean);
        Object.assign(p, derivePackageStatuses(dels));
        p.updatedAt = nowIso();
      }
      return true;
    });
    return { ok: false, code, message, attemptId };
  }

  const versionId = newVersionId();
  const prevVersionId = deliverable.currentVersionId || null;
  let committed;
  try {
    committed = await commitVersionFiles(userData, {
      packageId,
      deliverableId,
      versionId,
      files: produced.files,
      manifest: {
        attemptId,
        kind: produced.kind,
        sourcePlanVersionId: pkg.sourcePlanVersionId,
        sourceSnapshotDigest: pkg.executionSnapshot && pkg.executionSnapshot.sourcePlanDigest,
        modelProvenanceSummary: { adapter: "callModel", taskType: "artifact" },
        uiFormatLabel: produced.uiFormatLabel || null,
      },
    });
  } catch (err) {
    await packageStore.mutateStore(userData, (s) => {
      const a = s.generationAttempts[attemptId];
      if (a) {
        a.status = "failed";
        a.finishedAt = nowIso();
        a.errorCode = (err && err.code) || "write_failed";
        a.errorSummary = (err && err.message) || "写入成果文件失败。";
        a.outcome = "failed";
      }
      const d = s.deliverables[String(deliverableId)];
      if (d) {
        d.generationStatus = "failed";
        d.updatedAt = nowIso();
      }
      return true;
    });
    return {
      ok: false,
      code: (err && err.code) || "write_failed",
      message: (err && err.message) || "写入成果文件失败。",
      attemptId,
    };
  }

  const artifacts = committed.files.map((f) =>
    makeArtifactRef({
      versionId,
      relativePath: f.relativePath,
      contentHash: f.contentHash,
      byteSize: f.byteSize,
      name: f.name,
    })
  );
  const primary =
    artifacts.find((a) => a.relativePath.endsWith("/" + produced.primaryFile)) || artifacts[0];
  const preview =
    artifacts.find((a) => a.relativePath.endsWith(".html") && a !== primary) ||
    artifacts.find((a) => a.mimeType === "text/html") ||
    null;

  const version = {
    schemaVersion: 1,
    id: versionId,
    deliverableId: String(deliverableId),
    version: (Array.isArray(deliverable.versionIds) ? deliverable.versionIds.length : 0) + 1,
    generationAttemptId: attemptId,
    generationStatus: "ready",
    reviewStatus: "unreviewed",
    artifactRef: primary,
    previewRef: preview,
    artifactRefs: artifacts,
    contentHash: primary ? primary.contentHash : null,
    contentAvailable: true,
    generator: {
      executionMode: "model_plus_local_renderer",
      capabilityId: produced.kind,
      modelRoute: { taskType: "artifact" },
      fallbackUsed: false,
      uiFormatLabel: produced.uiFormatLabel || null,
    },
    provenance: {
      subjectContextSnapshotId:
        (produced.generationContext &&
          produced.generationContext.subjectAssembly &&
          produced.generationContext.subjectAssembly.assemblyId) ||
        null,
      subjectContextSnapshotVersion:
        (produced.generationContext &&
          produced.generationContext.subjectAssembly &&
          produced.generationContext.subjectAssembly.packageVersion) ||
        null,
      planVersion: pkg.sourcePlanVersionId,
      capabilityInvocationIds: [],
      modelRoute: { taskType: "artifact" },
      contextClass:
        (produced.generationContext && produced.generationContext.contextClass) ||
        (produced.generationContext &&
          produced.generationContext.subjectAssembly &&
          produced.generationContext.subjectAssembly.contextClass) ||
        null,
      contextClassification:
        (produced.generationContext && produced.generationContext.contextClassification) ||
        (produced.generationContext &&
          produced.generationContext.subjectAssembly &&
          produced.generationContext.subjectAssembly.contextClassification) ||
        null,
      assemblyPolicyDigest:
        (produced.generationContext && produced.generationContext.assemblyPolicyDigest) ||
        (produced.generationContext &&
          produced.generationContext.subjectAssembly &&
          produced.generationContext.subjectAssembly.assemblyPolicyDigest) ||
        null,
      claimPostures: ["confirmed", "attributed", "inferred", "hypothetical"],
      claimPosturePresentation: "natural",
      sourceRefs: (produced.generationContext && produced.generationContext.attachmentRefs
        ? produced.generationContext.attachmentRefs
            .filter((r) => r && r.included)
            .map((r) => ({
              kind: "reference_material",
              id: r.id,
              name: r.name,
              contentHash: r.contentHash,
              evidenceKind: "task_material",
              ownership: "task_owned",
            }))
        : []
      ).concat([
        {
          kind: "task_goal",
          taskId: pkg.taskId,
          goal:
            (produced.generationContext && produced.generationContext.goal) ||
            null,
        },
        {
          kind: "plan_version",
          planVersionId: pkg.sourcePlanVersionId,
        },
      ]),
      attachmentRefs: tagAttachmentRefs(
        (produced.generationContext && produced.generationContext.attachmentRefs) || []
      ),
      subjectRefs:
        (produced.generationContext && produced.generationContext.subjectRefs) || [],
      memoryRefs: (
        (produced.generationContext && produced.generationContext.subjectRefs) || []
      ).filter((r) => r && r.layer === "memory"),
      evidenceSummary:
        (produced.generationContext && produced.generationContext.evidenceSummary) ||
        (produced.generationContext &&
          produced.generationContext.subjectAssembly &&
          produced.generationContext.subjectAssembly.evidenceSummary) ||
        null,
      ownershipSummary:
        (produced.generationContext && produced.generationContext.ownershipSummary) ||
        (produced.generationContext &&
          produced.generationContext.subjectAssembly &&
          produced.generationContext.subjectAssembly.ownershipSummary) ||
        null,
      assembly:
        produced.generationContext && produced.generationContext.subjectAssembly
          ? {
              assemblyId: produced.generationContext.subjectAssembly.assemblyId,
              queryKeyDigest: produced.generationContext.subjectAssembly.queryKeyDigest,
              packageId: produced.generationContext.subjectAssembly.packageId,
              packageVersion: produced.generationContext.subjectAssembly.packageVersion,
              budget: produced.generationContext.subjectAssembly.budget,
              emptyReason: produced.generationContext.subjectAssembly.emptyReason,
              contextClass: produced.generationContext.subjectAssembly.contextClass || null,
              assemblyPolicyDigest:
                produced.generationContext.subjectAssembly.assemblyPolicyDigest || null,
            }
          : null,
      evidenceRefs: [],
      authorizationRefs: [],
      actor: "user",
      generatedAt: nowIso(),
    },
    quality: { verdict: "pass", checks: [] },
    supersedesVersionId: prevVersionId,
    supersededByVersionId: null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  await packageStore.mutateStore(userData, (s) => {
    s.versions = s.versions || {};
    s.artifacts = s.artifacts || {};
    s.generationAttempts = s.generationAttempts || {};
    for (const art of artifacts) {
      s.artifacts[art.id] = art;
    }
    if (prevVersionId && s.versions[prevVersionId]) {
      s.versions[prevVersionId].supersededByVersionId = versionId;
      s.versions[prevVersionId].generationStatus = "superseded";
      s.versions[prevVersionId].updatedAt = nowIso();
    }
    s.versions[versionId] = version;
    const a = s.generationAttempts[attemptId];
    if (a) {
      a.status = "succeeded";
      a.finishedAt = nowIso();
      a.producedVersionId = versionId;
      a.outcome = "created_new_version";
    }
    const d = s.deliverables[String(deliverableId)];
    if (d) {
      d.currentVersionId = versionId;
      d.versionIds = Array.isArray(d.versionIds) ? d.versionIds.concat([versionId]) : [versionId];
      d.generationStatus = "ready";
      d.reviewStatus = "unreviewed";
      d.latestGenerationAttemptId = attemptId;
      d.updatedAt = nowIso();
    }
    const p = s.packages[String(packageId)];
    if (p) {
      const dels = (p.deliverableIds || []).map((id) => s.deliverables[id]).filter(Boolean);
      Object.assign(p, derivePackageStatuses(dels));
      p.updatedAt = nowIso();
    }
    return true;
  });

  return {
    ok: true,
    packageId,
    deliverableId,
    attemptId,
    version,
    artifacts,
    uiFormatLabel: produced.uiFormatLabel || null,
    message: "成果已生成。",
  };
}

async function generateDeliverablePackage(userData, { packageId }, deps) {
  const store = packageStore.loadStore(userData);
  const pkg = store.packages[String(packageId)];
  if (!pkg || pkg.softDeletedAt) {
    return { ok: false, code: "package_not_found", message: "未找到成果包。" };
  }
  const materialsGate = assertTaskMaterialsFresh(userData, pkg.taskId);
  if (!materialsGate.ok) return materialsGate;
  const deliverables = (pkg.deliverableIds || [])
    .map((id) => store.deliverables[id])
    .filter((d) => d && d.planDisposition === "included");
  const ordered = topoSortDeliverables(deliverables);
  const results = [];
  const failedIds = new Set();
  for (const d of ordered) {
    const depsBlocked = (d.dependencies || []).some((dep) => failedIds.has(String(dep)));
    if (depsBlocked) {
      await packageStore.mutateStore(userData, (s) => {
        const cur = s.deliverables[d.id];
        if (cur) {
          cur.generationStatus = "failed";
          cur.updatedAt = nowIso();
        }
        return true;
      });
      results.push({
        ok: false,
        deliverableId: d.id,
        code: "dependency_failed",
        message: "依赖的成果未成功生成，已跳过。",
      });
      failedIds.add(String(d.id));
      continue;
    }
    const one = await generateOneDeliverable(
      userData,
      { packageId, deliverableId: d.id },
      deps
    );
    results.push({ ...one, deliverableId: d.id, kind: d.kind });
    if (!one.ok) failedIds.add(String(d.id));
  }
  const view = packageStore.getPackageView(userData, packageId);
  const okCount = results.filter((r) => r.ok).length;
  return {
    ok: okCount > 0,
    packageId,
    results,
    package: view.package,
    deliverables: view.deliverables,
    message:
      okCount === results.length
        ? "成果包已全部生成。"
        : okCount > 0
          ? "部分成果已生成，其余未完成。"
          : "未能生成成果。",
  };
}

async function reviewDeliverableVersion(userData, { versionId, decision }) {
  const id = String(versionId || "");
  const dec = String(decision || "");
  if (!id) return { ok: false, code: "version_required", message: "缺少版本。" };
  if (dec !== "accepted" && dec !== "rejected") {
    return { ok: false, code: "invalid_decision", message: "审阅决定无效。" };
  }
  const store = packageStore.loadStore(userData);
  const version = store.versions && store.versions[id];
  if (!version) return { ok: false, code: "version_not_found", message: "未找到该版本。" };
  await packageStore.mutateStore(userData, (s) => {
    const v = s.versions[id];
    if (!v) return false;
    v.reviewStatus = dec;
    v.updatedAt = nowIso();
    const d = s.deliverables[v.deliverableId];
    if (d && d.currentVersionId === id) {
      d.reviewStatus = dec;
      d.updatedAt = nowIso();
    }
    return true;
  });
  return {
    ok: true,
    versionId: id,
    reviewStatus: dec,
    message: dec === "accepted" ? "已接受此版本。" : "已否定此版本。",
  };
}

module.exports = {
  generateOneDeliverable,
  generateDeliverablePackage,
  reviewDeliverableVersion,
  topoSortDeliverables,
  derivePackageStatuses,
};
