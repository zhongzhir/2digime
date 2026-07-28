"use strict";

/**
 * TASK-QUALITY-LOOP-01.1 — AuthorityMap.
 *
 * Minimal map of the system's authoritative data objects. Used by the
 * grounding review to detect when a new document redefines or duplicates
 * an existing authority source instead of referencing it.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

/**
 * referenceMarkers: phrases that explicitly relate a mention to the existing
 * authority object (exempt from duplication blocking).
 */
const REFERENCE_MARKERS = Object.freeze([
  "引用已有",
  "引用现有",
  "复用现有",
  "复用已有",
  "关联现有",
  "关联已有",
  "沿用现有",
  "沿用已有",
  "基于现有",
  "基于已有",
  "不新建",
  "不另建",
  "不重复建设",
  "不复制",
  "权威存储",
  "权威来源",
  "authoritative",
]);

const AUTHORITY_OBJECTS = Object.freeze([
  {
    entity: "PlanRecord",
    authoritativeStore: "deliverable-plans.json",
    authoritativeType: "json_store",
    storeFile: "src/act-behalf/deliverable-plan-store.js",
    referencedBy: ["Task.deliverablePlanning", "DeliverablePackage.executionSnapshot"],
    aliases: [
      /\bexecutionPlans?\b/i,
      /执行计划(列表|存储|对象|数据模型)/,
      /新建(一套)?计划(对象|存储)/,
    ],
    duplicationRisk: "以新计划对象替代 PlanRecord 会形成第二套计划权威",
    notes: "成果计划唯一权威；引用应使用 planId / planVersionId",
  },
  {
    entity: "Task",
    authoritativeStore: "act-behalf-tasks.json",
    authoritativeType: "json_store",
    storeFile: "src/act-behalf/task-store.js",
    referencedBy: ["PlanRecord.taskId", "DeliverablePackage.taskId"],
    aliases: [/\btaskStates?\b/i, /任务状态(存储|表|对象)/, /新建(一套)?任务(存储|系统)/],
    duplicationRisk: "复制 Task 状态会形成第二套任务权威",
    notes: "做事任务唯一权威；生命周期见 task-lifecycle.js",
  },
  {
    entity: "ArtifactRef",
    authoritativeStore: "deliverable-packages.json#artifacts",
    authoritativeType: "json_store",
    storeFile: "src/act-behalf/deliverable-generation.js",
    referencedBy: ["DeliverableVersion.artifactRef", "DeliverableVersion.artifactRefs"],
    aliases: [
      /\bkeyOutcomes?\b/i,
      /关键成果(列表|存储|对象)/,
      /成果物(引用)?(列表|存储|数据模型)/,
      /新建(一套)?成果(引用|存储)(机制|系统)?/,
    ],
    duplicationRisk: "以新成果对象替代 ArtifactRef 会形成第二套成果引用权威",
    notes: "成果文件引用唯一权威；含 contentHash 与本地相对路径",
  },
  {
    entity: "ProjectKnowledge",
    authoritativeStore: "packageDir/project/context-sets.json + knowledge-claims.json",
    authoritativeType: "json_store",
    storeFile: "src/act-behalf/project-knowledge-store.js",
    referencedBy: ["Knowledge Resolver（对话/做事/研究/写作统一解析）"],
    aliases: [
      /项目知识(库|空间)(的)?(数据模型|存储设计|表)/,
      /新建(一套|独立的)?项目知识(库|系统|存储)/,
      /项目事实(列表|存储|对象|数据模型)/,
      /\bfacts\s*列表/,
    ],
    duplicationRisk: "重设项目知识模型会形成第二套项目知识权威",
    notes: "项目知识唯一权威为 ProjectContextSet + ProjectKnowledgeClaim（含权威等级与 supersede）",
  },
  {
    entity: "KnowledgeItem",
    authoritativeStore: "packageDir/project/knowledge-claims.json",
    authoritativeType: "json_store",
    storeFile: "src/act-behalf/project-knowledge-schema.js",
    referencedBy: ["Knowledge Resolver", "learning-adoption-policy"],
    aliases: [/新建(一套)?知识(条目|项)(存储|模型)/, /\bknowledgeItems?\b/i],
    duplicationRisk: "重设知识条目模型会绕过现有 claim 权威与 supersede 机制",
    notes: "知识项唯一权威为 ProjectKnowledgeClaim",
  },
  {
    entity: "Authorization",
    authoritativeStore: "authorizations.json",
    authoritativeType: "json_store",
    storeFile: "src/act-behalf/authorization-store.js",
    referencedBy: ["generation/prepare/accept/learn fail-closed 校验"],
    aliases: [/新建(一套)?授权(记录|表|系统)/, /\bauthorizationRecords?\b(?!.*(现有|已有|沿用))/i],
    duplicationRisk: "重设授权记录会形成第二套授权权威",
    notes: "本地授权主表；撤销即时生效（IDCOLLAB-MIN-01.1）",
  },
  {
    entity: "LearningRecord",
    authoritativeStore: "deliverable-learn-jobs.json",
    authoritativeType: "json_store",
    storeFile: "src/act-behalf/deliverable-learn-store.js",
    referencedBy: ["接受后学习管线"],
    aliases: [/新建(一套)?学习(记录|任务)(存储|系统)/, /\blearnJobs?\b/i],
    duplicationRisk: "重设学习记录会绕过现有学习作业权威",
    notes: "学习作业按 versionId 幂等",
  },
  {
    entity: "Provenance",
    authoritativeStore: "DeliverableVersion.provenance",
    authoritativeType: "embedded_record",
    storeFile: "src/act-behalf/deliverable-generation.js",
    referencedBy: ["来源展示", "学习证据语料"],
    aliases: [/新建(一套)?来源(记录|追踪)(系统|模块)/, /\bprovenance\s*(store|table)\b/i],
    duplicationRisk: "重设来源记录会形成第二套 provenance 权威",
    notes: "来源内嵌于成果版本，随版本持久化",
  },
]);

function appRoot() {
  return path.join(__dirname, "..", "..");
}

/**
 * Build the AuthorityMap, verifying each store implementation file exists.
 */
function buildAuthorityMap({ appRootOverride } = {}) {
  const root = appRootOverride || appRoot();
  const entries = AUTHORITY_OBJECTS.map((o) => {
    let present = false;
    try {
      present = fs.existsSync(path.join(root, o.storeFile));
    } catch {
      present = false;
    }
    return {
      entity: o.entity,
      authoritativeStore: o.authoritativeStore,
      authoritativeType: o.authoritativeType,
      referencedBy: o.referencedBy.slice(),
      duplicationRisk: o.duplicationRisk,
      notes: o.notes,
      status: present ? "present" : "unknown",
      sourceRef: o.storeFile,
    };
  });
  return {
    schemaVersion: 1,
    entries,
    mapDigest:
      "sha256:" +
      crypto
        .createHash("sha256")
        .update(JSON.stringify(entries.map((e) => e.entity + ":" + e.status)))
        .digest("hex"),
  };
}

module.exports = {
  AUTHORITY_OBJECTS,
  REFERENCE_MARKERS,
  buildAuthorityMap,
};
