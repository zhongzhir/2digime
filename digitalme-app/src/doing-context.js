"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const distillMe = require("./distill-me");

const SCHEMA_VERSION = 1;

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function packageIdentity(pkg) {
  const manifest = (pkg && pkg.manifest) || {};
  return {
    packageId: String(manifest.packageId || manifest.subjectId || manifest.ownerId || "local-package"),
    packageVersion: String(manifest.version || manifest.revision || "unknown"),
  };
}

function assembleDoingContext({ packageDir, pkg, taskIntent, scene, requestId }) {
  const data = distillMe.read(packageDir);
  const CONFIRMED_STATUSES = ["confirmed", "edited"];
  const all = Array.isArray(data.items) ? data.items : [];
  const confirmedContext = all
    .filter((item) => item && CONFIRMED_STATUSES.includes(item.status))
    .map((item) => ({
      id: item.id,
      category: item.category,
      statement: item.statement,
      status: item.status,
      confirmedAt: item.confirmedAt || null,
      sourceRefs: Array.isArray(item.sourceRefs) ? item.sourceRefs.slice() : [],
      evidenceRefs: Array.isArray(item.evidenceRefs)
        ? item.evidenceRefs.map(({ sourceName, sourceKind, direct }) => ({ sourceName, sourceKind, direct: !!direct }))
        : [],
      version: item.version,
    }));
  const { packageId, packageVersion } = packageIdentity(pkg);
  return {
    schemaVersion: SCHEMA_VERSION,
    requestId: requestId || newId("doing_request"),
    task: { intent: String(taskIntent || ""), scene: String(scene || "act_behalf") },
    subject: { packageId, packageVersion },
    confirmedContext,
    policy: { applied: confirmedContext.length > 0, excludedCount: Math.max(0, all.length - confirmedContext.length) },
    auditRef: newId("doing_audit"),
  };
}

function renderDoingContextForModel(context) {
  const rows = Array.isArray(context?.confirmedContext) ? context.confirmedContext : [];
  if (!rows.length) return "";
  return ["已确认的本人信息（仅作为本次任务背景；不要当作原始资料全文）：", ...rows.map((item) => `- [${item.category}] ${item.statement}`)].join("\n");
}

function auditPath(userData) {
  return path.join(userData, "doing-context-audit.json");
}

function readAudit(userData) {
  try {
    const parsed = JSON.parse(fs.readFileSync(auditPath(userData), "utf8"));
    return Array.isArray(parsed.entries) ? parsed : { version: SCHEMA_VERSION, entries: [] };
  } catch {
    return { version: SCHEMA_VERSION, entries: [] };
  }
}

function appendAudit(userData, entry) {
  const audit = readAudit(userData);
  audit.entries.unshift(entry);
  audit.entries = audit.entries.slice(0, 200);
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(auditPath(userData), JSON.stringify(audit, null, 2), "utf8");
  return entry;
}

module.exports = { assembleDoingContext, renderDoingContextForModel, appendAudit, readAudit };
