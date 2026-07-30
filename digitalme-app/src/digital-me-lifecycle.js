"use strict";

/**
 * MVP-RELEASE-GATE-01C — Digital Me first-run lifecycle.
 *
 * Single place for: FirstRunState derivation, minimal Package creation,
 * import inspect, and activate-with-rollback. No second Package Store.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { inspectPackageReadOnly } = require("./package-store/read-only");
const { SCHEMA_VERSION, PACKAGE_VERSION_DEFAULT } = require("./package-store/schema");
const { generateIdentity } = require("./identity");
const distillMe = require("./distill-me");
const life = require("./life");
const policies = require("./policies");

const FIRST_RUN_STATES = Object.freeze({
  NO_CURRENT_PACKAGE: "no_current_package",
  PACKAGE_INITIALIZING: "package_initializing",
  PACKAGE_READY: "package_ready",
  PACKAGE_REPAIRABLE: "package_repairable",
  PACKAGE_INVALID: "package_invalid",
});

const BLOCKING_IMPORT_CODES = new Set([
  "package_missing",
  "manifest_missing",
  "manifest_parse_error",
  "manifest_invalid",
  "not_a_directory",
  "ordinary_folder",
]);

const REPAIRABLE_IMPORT_CODES = new Set([
  "schema_unversioned_or_v01",
  "schema_not_v02",
  "identity_missing",
  "identity_incomplete",
  "persona_missing",
  "memory_dir_missing",
]);

function nowIso() {
  return new Date().toISOString();
}

function safeName(input, fallback) {
  const raw = String(input || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 48);
  return raw || fallback || "我的 Digital Me";
}

function folderSlug(displayName) {
  const base = safeName(displayName, "Digital-Me")
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fff\-]+/g, "")
    .slice(0, 40);
  return base || "Digital-Me";
}

function readJsonIfPresent(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(filePath, obj) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
}

/**
 * Default location for newly created Packages (not repo, not install dir).
 * @param {string} documentsRoot from app.getPath("documents")
 * @param {string} displayName
 */
function resolveDefaultCreateDir(documentsRoot, displayName) {
  const root = path.join(path.resolve(documentsRoot), "Digital Me");
  let candidate = path.join(root, folderSlug(displayName));
  if (!fs.existsSync(candidate)) return candidate;
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  candidate = path.join(root, `${folderSlug(displayName)}-${stamp}`);
  if (!fs.existsSync(candidate)) return candidate;
  return path.join(root, `${folderSlug(displayName)}-${crypto.randomBytes(3).toString("hex")}`);
}

/**
 * @param {{ packageDir?: string|null, configHasPackageDir?: boolean }} input
 * @returns {{ state: string, packageDir: string|null, displayName: string|null, issues: object[], identityPresent: boolean, manifestPresent: boolean }}
 */
function computeFirstRunState(input = {}) {
  const configured = String(input.packageDir || "").trim();
  if (!configured) {
    return {
      state: FIRST_RUN_STATES.NO_CURRENT_PACKAGE,
      packageDir: null,
      displayName: null,
      issues: [],
      identityPresent: false,
      manifestPresent: false,
    };
  }

  const dir = path.resolve(configured);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    return {
      state: FIRST_RUN_STATES.PACKAGE_INVALID,
      packageDir: dir,
      displayName: null,
      issues: [{ code: "package_missing", message: "资料目录不存在。" }],
      identityPresent: false,
      manifestPresent: false,
    };
  }

  const inspection = inspectPackageReadOnly(dir);
  const identity = readJsonIfPresent(path.join(dir, "identity.json"));
  const identityPresent = !!(identity && (identity.did || identity.displayName || identity.digitalMeId));
  const manifest = readJsonIfPresent(path.join(dir, "manifest.json"));
  const manifestPresent = !!manifest;
  const displayName =
    (manifest && (manifest.ownerDisplayName || manifest.name)) ||
    (identity && identity.displayName) ||
    null;

  const codes = new Set((inspection.issues || []).map((i) => i.code));
  if (!manifest) {
    return {
      state: FIRST_RUN_STATES.PACKAGE_INVALID,
      packageDir: dir,
      displayName,
      issues: inspection.issues,
      identityPresent,
      manifestPresent: false,
    };
  }

  const blocking = [...codes].filter((c) => BLOCKING_IMPORT_CODES.has(c));
  if (blocking.length) {
    return {
      state: FIRST_RUN_STATES.PACKAGE_INVALID,
      packageDir: dir,
      displayName,
      issues: inspection.issues,
      identityPresent,
      manifestPresent: true,
    };
  }

  const needsIdentity = !identityPresent;
  const needsPersona = !fs.existsSync(path.join(dir, "persona.md"));
  const needsMemory = !fs.existsSync(path.join(dir, "memory"));
  const repairableCodes = [...codes].filter((c) => REPAIRABLE_IMPORT_CODES.has(c));
  if (needsIdentity) repairableCodes.push("identity_missing");
  if (needsPersona) repairableCodes.push("persona_missing");
  if (needsMemory) repairableCodes.push("memory_dir_missing");

  if (repairableCodes.length) {
    return {
      state: FIRST_RUN_STATES.PACKAGE_REPAIRABLE,
      packageDir: dir,
      displayName,
      issues: [
        ...inspection.issues,
        ...repairableCodes
          .filter((c) => !codes.has(c))
          .map((c) => ({ code: c, message: c })),
      ],
      identityPresent,
      manifestPresent: true,
    };
  }

  return {
    state: FIRST_RUN_STATES.PACKAGE_READY,
    packageDir: dir,
    displayName,
    issues: inspection.issues,
    identityPresent,
    manifestPresent: true,
  };
}

/**
 * Read-only import candidate inspection for UI summary.
 * Never scaffolds or mutates the candidate.
 */
function inspectImportCandidate(candidateDir) {
  const dir = path.resolve(String(candidateDir || ""));
  if (!dir || !fs.existsSync(dir)) {
    return {
      ok: false,
      status: "invalid",
      packageDir: dir || null,
      displayName: null,
      blockingIssues: [{ code: "package_missing", userMessage: "找不到所选文件夹。" }],
      recoverableIssues: [],
      identityPresent: false,
      manifestVersion: null,
      updatedAt: null,
      fileCount: 0,
    };
  }
  if (!fs.statSync(dir).isDirectory()) {
    return {
      ok: false,
      status: "invalid",
      packageDir: dir,
      displayName: null,
      blockingIssues: [{ code: "not_a_directory", userMessage: "请选择一个文件夹。" }],
      recoverableIssues: [],
      identityPresent: false,
      manifestVersion: null,
      updatedAt: null,
      fileCount: 0,
    };
  }

  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    return {
      ok: false,
      status: "ordinary_folder",
      packageDir: dir,
      displayName: null,
      blockingIssues: [
        {
          code: "ordinary_folder",
          userMessage:
            "这个文件夹不是可识别的 Digital Me。请选择包含 Digital Me 配置的文件夹，或创建一个新的 Digital Me。",
        },
      ],
      recoverableIssues: [],
      identityPresent: false,
      manifestVersion: null,
      updatedAt: null,
      fileCount: 0,
    };
  }

  const inspection = inspectPackageReadOnly(dir);
  const manifest = readJsonIfPresent(manifestPath);
  if (!manifest) {
    return {
      ok: false,
      status: "invalid",
      packageDir: dir,
      displayName: null,
      blockingIssues: [
        {
          code: "manifest_parse_error",
          userMessage: "暂时无法导入这个 Digital Me。原有 Digital Me 和文件没有被修改。",
        },
      ],
      recoverableIssues: [],
      identityPresent: false,
      manifestVersion: null,
      updatedAt: null,
      fileCount: inspection.fileCount || 0,
    };
  }

  const identity = readJsonIfPresent(path.join(dir, "identity.json"));
  const identityPresent = !!(identity && (identity.did || identity.displayName));
  const displayName =
    manifest.ownerDisplayName || manifest.name || (identity && identity.displayName) || "未命名 Digital Me";

  const codes = (inspection.issues || []).map((i) => i.code);
  const blocking = codes
    .filter((c) => BLOCKING_IMPORT_CODES.has(c) && c !== "manifest_missing")
    .map((c) => ({
      code: c,
      userMessage: "暂时无法导入这个 Digital Me。原有 Digital Me 和文件没有被修改。",
    }));

  const recoverable = [];
  if (!identityPresent) {
    recoverable.push({
      code: "identity_missing",
      userMessage: "缺少身份信息，导入后可自动补全设备身份密钥。",
    });
  }
  for (const c of codes) {
    if (REPAIRABLE_IMPORT_CODES.has(c)) {
      recoverable.push({
        code: c,
        userMessage: "这个 Digital Me 缺少部分可重新生成的文件。可以修复后继续使用。",
      });
    }
  }

  if (blocking.length) {
    return {
      ok: false,
      status: "invalid",
      packageDir: dir,
      displayName,
      blockingIssues: blocking,
      recoverableIssues: recoverable,
      identityPresent,
      manifestVersion: manifest.schemaVersion || manifest.packageVersion || null,
      updatedAt: manifest.updatedAt || null,
      fileCount: inspection.fileCount || 0,
    };
  }

  const status = recoverable.length ? "repairable" : "valid";
  return {
    ok: true,
    status,
    packageDir: dir,
    displayName,
    blockingIssues: [],
    recoverableIssues: recoverable,
    identityPresent,
    manifestVersion: manifest.schemaVersion || manifest.packageVersion || null,
    updatedAt: manifest.updatedAt || null,
    fileCount: inspection.fileCount || 0,
    digitalMeId: manifest.digitalMeId || null,
  };
}

/**
 * Ensure DID identity without wiping displayName / profile fields.
 */
function ensureProfileIdentity(packageDir, profile = {}) {
  const identityPath = path.join(packageDir, "identity.json");
  const privateKeyPath = path.join(packageDir, ".identity-private-key.pem");
  const existing = readJsonIfPresent(identityPath) || {};
  const displayName = safeName(profile.displayName || existing.displayName, "我");
  const roleSummary = String(profile.roleSummary || existing.roleSummary || "").trim().slice(0, 500);
  const digitalMeId =
    existing.digitalMeId ||
    profile.digitalMeId ||
    `dm_${crypto.randomBytes(6).toString("hex")}`;

  let did = existing.did;
  let publicKey = existing.publicKey;
  if (!did || !publicKey || !fs.existsSync(privateKeyPath)) {
    const generated = generateIdentity();
    did = generated.did;
    publicKey = generated.publicKey;
    fs.writeFileSync(privateKeyPath, generated.privateKey, "utf8");
  }

  const now = nowIso();
  const identity = {
    ...existing,
    did,
    publicKey,
    displayName,
    digitalMeId,
    roleSummary: roleSummary || undefined,
    createdAt: existing.createdAt || now,
    updatedAt: now,
    version: existing.version || 1,
  };
  writeJson(identityPath, identity);
  return identity;
}

function seedSubjectReadableFacts(packageDir, { displayName, roleSummary }) {
  const statementParts = [`称呼：${displayName}`];
  if (roleSummary) statementParts.push(`主要工作：${roleSummary}`);
  const statement = statementParts.join("。") + "。";
  const data = distillMe.read(packageDir);
  const existing = (data.items || []).find(
    (x) => x.category === "identity" && String(x.statement || "").includes(displayName)
  );
  if (existing) return;
  const item = {
    id: `distill_firstrun_${crypto.randomBytes(4).toString("hex")}`,
    category: "identity",
    statement: statement.slice(0, 1000),
    status: "confirmed",
    sourceRefs: ["first_run_create"],
    evidenceRefs: [{ sourceName: "首次创建", sourceKind: "direct", excerpt: statement.slice(0, 240), direct: true }],
    confidence: "high",
    conflict: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    confirmedAt: nowIso(),
    version: 1,
    audit: { createdBy: "owner_first_run" },
  };
  data.items = data.items || [];
  data.items.push(item);
  data.audit = data.audit || [];
  data.audit.unshift({ id: `audit_${crypto.randomBytes(3).toString("hex")}`, action: "confirm", itemId: item.id, at: nowIso() });
  fs.mkdirSync(path.join(packageDir, "life"), { recursive: true });
  writeJson(path.join(packageDir, "life", "distill-me-identity-facts.json"), data);

  const memDir = path.join(packageDir, "memory");
  fs.mkdirSync(memDir, { recursive: true });
  const memPath = path.join(memDir, "long-term-memory.jsonl");
  const row = {
    id: `core_firstrun_${crypto.randomBytes(3).toString("hex")}`,
    type: "semantic",
    content: statement,
    theme: "身份",
    confidence: "high",
    sensitivity: "private",
    createdAt: nowIso(),
    sourceRefs: ["first_run_create"],
    expiresAt: null,
    logicalState: "active",
    activationState: "active",
    ownership: "subject_owned",
  };
  fs.appendFileSync(memPath, JSON.stringify(row) + "\n", "utf8");
}

/**
 * Create a minimal Digital Me Package and return summary.
 * Does NOT require model / API key.
 *
 * @param {{
 *   documentsRoot: string,
 *   displayName: string,
 *   roleSummary?: string,
 *   packageDir?: string,
 * }} input
 */
function createDigitalMePackage(input) {
  const displayName = safeName(input && input.displayName, "我");
  const roleSummary = String((input && input.roleSummary) || "").trim().slice(0, 500);
  const targetDir = input && input.packageDir
    ? path.resolve(String(input.packageDir))
    : resolveDefaultCreateDir(input.documentsRoot, displayName);

  if (fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0) {
    const err = new Error("目标文件夹不是空的，请换一个位置。");
    err.code = "target_not_empty";
    throw err;
  }

  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(path.join(targetDir, "memory"), { recursive: true });
  fs.mkdirSync(path.join(targetDir, "sources"), { recursive: true });
  fs.mkdirSync(path.join(targetDir, "life"), { recursive: true });
  fs.mkdirSync(path.join(targetDir, "policies"), { recursive: true });

  const identity = ensureProfileIdentity(targetDir, { displayName, roleSummary });
  const digitalMeId = identity.digitalMeId;
  const now = nowIso();

  const manifest = {
    name: displayName,
    ownerDisplayName: displayName,
    digitalMeId,
    packageVersion: PACKAGE_VERSION_DEFAULT,
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    packageType: "personal",
    updatedAt: now,
    createdAt: now,
  };
  writeJson(path.join(targetDir, "manifest.json"), manifest);

  const personaLines = [
    `# ${displayName}`,
    "",
    roleSummary ? `当前主要工作：${roleSummary}` : "（尚未补充主要工作说明）",
    "",
    "## 不应代表本人做出的事项",
    "",
    "- 未经确认的对外承诺",
    "- 未经确认的资金或隐私披露",
    "",
  ];
  fs.writeFileSync(path.join(targetDir, "persona.md"), personaLines.join("\n"), "utf8");
  fs.writeFileSync(
    path.join(targetDir, "style-guide.md"),
    "# 表达风格\n\n默认使用严谨、明白、中性的中文。\n",
    "utf8"
  );
  writeJson(path.join(targetDir, "sources", "source-index.json"), { version: 1, items: [], updatedAt: now });
  writeJson(path.join(targetDir, "preferences.json"), { version: 1, updatedAt: now });
  if (!fs.existsSync(path.join(targetDir, "memory", "long-term-memory.jsonl"))) {
    fs.writeFileSync(path.join(targetDir, "memory", "long-term-memory.jsonl"), "", "utf8");
  }

  seedSubjectReadableFacts(targetDir, { displayName, roleSummary });

  // Match what package:load would ensure — keep first load idempotent (reference import safe).
  life.ensureLifeScaffold(targetDir);
  policies.ensureBoundariesScaffold(targetDir);

  const state = computeFirstRunState({ packageDir: targetDir });
  return {
    ok: true,
    packageDir: targetDir,
    displayName,
    digitalMeId,
    identityDid: identity.did,
    firstRunState: state.state,
    modelRequired: false,
  };
}

/**
 * Apply light repairs that are safe without Owner confirmation.
 */
function applySafeRepairs(packageDir) {
  const dir = path.resolve(packageDir);
  const identity = readJsonIfPresent(path.join(dir, "identity.json")) || {};
  const displayName = identity.displayName || "我";
  ensureProfileIdentity(dir, { displayName, roleSummary: identity.roleSummary || "" });
  fs.mkdirSync(path.join(dir, "memory"), { recursive: true });
  const memPath = path.join(dir, "memory", "long-term-memory.jsonl");
  if (!fs.existsSync(memPath)) fs.writeFileSync(memPath, "", "utf8");
  if (!fs.existsSync(path.join(dir, "persona.md"))) {
    fs.writeFileSync(
      path.join(dir, "persona.md"),
      `# ${displayName}\n\n（导入后自动补全的最小人格说明）\n`,
      "utf8"
    );
  }
  life.ensureLifeScaffold(dir);
  policies.ensureBoundariesScaffold(dir);
  return computeFirstRunState({ packageDir: dir });
}

module.exports = {
  FIRST_RUN_STATES,
  computeFirstRunState,
  inspectImportCandidate,
  createDigitalMePackage,
  ensureProfileIdentity,
  resolveDefaultCreateDir,
  applySafeRepairs,
  safeName,
};
