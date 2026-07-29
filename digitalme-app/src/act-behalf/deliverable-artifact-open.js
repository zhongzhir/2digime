"use strict";

/**
 * TASK-QUALITY-STABILIZE-01-FIX-01 — authoritative artifact open/reveal.
 *
 * Renderer passes stable IDs only. Main resolves path from the package store.
 * No new permanent top-level fields; no second artifact store.
 */

const fs = require("node:fs");
const path = require("node:path");

const packageStore = require("./deliverable-package-store");
const artifactFs = require("./deliverable-artifact-fs");

const ALLOWED_OPEN_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".html",
  ".htm",
  ".docx",
  ".pptx",
  ".pdf",
  ".txt",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
]);

function userMessageForOpenCode(code) {
  switch (code) {
    case "file_missing":
      return "成果文件已移动或删除。";
    case "artifact_not_found":
    case "invalid_artifact_reference":
      return "成果文件不存在。";
    case "path_not_allowed":
    case "unsafe_artifact_path":
    case "path_traversal_rejected":
      return "暂时无法打开成果。";
    case "open_failed":
    default:
      return "暂时无法打开成果。";
  }
}

function fail(code, technicalMessage) {
  return {
    ok: false,
    code,
    message: userMessageForOpenCode(code),
    detail: technicalMessage ? String(technicalMessage).slice(0, 240) : undefined,
  };
}

/**
 * Resolve a safe absolute path for an ArtifactRef under userData.
 * @returns {{ ok: true, abs: string, artifact: object, version: object, deliverable: object, package: object } | { ok: false, code: string, message: string, detail?: string }}
 */
function resolveOpenableArtifact(userData, payload) {
  let artifactId = String(
    (payload && (payload.artifactId || payload.artifactRefId)) || ""
  ).trim();

  // Reject renderer-supplied absolute/relative path injection.
  if (payload && (payload.path || payload.localPath || payload.absolutePath || payload.relativePath)) {
    return fail("path_not_allowed", "renderer must not supply filesystem paths");
  }

  const store = packageStore.loadStore(userData);

  // Historical buttons may only carry versionId — pick a preferred openable ArtifactRef.
  if (!artifactId) {
    const versionIdOnly = String((payload && payload.versionId) || "").trim();
    const versionOnly = versionIdOnly ? store.versions && store.versions[versionIdOnly] : null;
    if (!versionOnly) {
      return fail("invalid_artifact_reference", "missing artifactId");
    }
    const refs = [];
    if (Array.isArray(versionOnly.artifactRefs)) refs.push(...versionOnly.artifactRefs);
    if (versionOnly.artifactRef) refs.push(versionOnly.artifactRef);
    if (versionOnly.previewRef) refs.push(versionOnly.previewRef);
    const prefer = ["md", "markdown", "docx", "html", "htm"];
    let chosen = null;
    for (const fmt of prefer) {
      chosen = refs.find((r) => r && String(r.format || "").toLowerCase() === fmt);
      if (chosen) break;
    }
    if (!chosen) chosen = refs.find((r) => r && r.id);
    if (!chosen || !chosen.id) {
      return fail("invalid_artifact_reference", "version has no openable artifact");
    }
    artifactId = String(chosen.id);
  }

  const artifact = store.artifacts && store.artifacts[artifactId];
  if (!artifact) {
    return fail("artifact_not_found", "artifact id not in store");
  }

  const versionId = String((payload && payload.versionId) || artifact.versionId || "").trim();
  const version = versionId ? store.versions && store.versions[versionId] : null;
  if (!version) {
    return fail("invalid_artifact_reference", "version missing");
  }

  if (String(artifact.versionId) !== String(version.id)) {
    return fail("invalid_artifact_reference", "artifact does not belong to version");
  }

  const refs = [];
  if (Array.isArray(version.artifactRefs)) refs.push(...version.artifactRefs);
  if (version.artifactRef) refs.push(version.artifactRef);
  if (version.previewRef) refs.push(version.previewRef);
  const belongs = refs.some((r) => r && String(r.id) === artifactId);
  if (!belongs) {
    return fail("invalid_artifact_reference", "artifact not listed on version");
  }

  const deliverable = store.deliverables && store.deliverables[String(version.deliverableId || "")];
  if (!deliverable) {
    return fail("invalid_artifact_reference", "deliverable missing");
  }

  if (payload && payload.deliverableId && String(payload.deliverableId) !== String(deliverable.id)) {
    return fail("invalid_artifact_reference", "deliverableId mismatch");
  }

  const pkg = store.packages && store.packages[String(deliverable.packageId || version.packageId || "")];
  if (!pkg) {
    return fail("invalid_artifact_reference", "package missing");
  }

  if (payload && payload.taskId && String(payload.taskId) !== String(pkg.taskId || "")) {
    return fail("invalid_artifact_reference", "version/package does not belong to task");
  }

  let abs;
  try {
    abs = artifactFs.resolveAbsolute(userData, artifact.relativePath);
  } catch (err) {
    return fail(err && err.code ? err.code : "path_not_allowed", err && err.message);
  }

  const root = path.resolve(artifactFs.artifactsRoot(userData));
  const absNorm = path.resolve(abs);
  if (!absNorm.toLowerCase().startsWith((root + path.sep).toLowerCase()) && absNorm.toLowerCase() !== root.toLowerCase()) {
    return fail("path_not_allowed", "resolved path outside artifacts root");
  }

  let st;
  try {
    st = fs.statSync(absNorm);
  } catch {
    return fail("file_missing", absNorm);
  }
  if (!st.isFile()) {
    return fail("invalid_artifact_reference", "artifact path is not a file");
  }

  const ext = path.extname(absNorm).toLowerCase();
  if (ext && !ALLOWED_OPEN_EXTENSIONS.has(ext)) {
    return fail("path_not_allowed", "extension not allowed: " + ext);
  }

  return {
    ok: true,
    abs: absNorm,
    artifact,
    version,
    deliverable,
    package: pkg,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.userData
 * @param {object} opts.payload
 * @param {{ openPath: (p: string) => Promise<string> }} opts.shell
 */
async function openArtifactSecure(opts) {
  const payload = opts.payload || {};
  if (payload.intent === "copyPath") {
    const resolved = resolveOpenableArtifact(opts.userData, payload);
    if (!resolved.ok) return resolved;
    try {
      const { clipboard } = require("electron");
      if (!clipboard || typeof clipboard.writeText !== "function") {
        return fail("open_failed", "clipboard unavailable");
      }
      clipboard.writeText(resolved.abs);
    } catch (e) {
      return fail("open_failed", (e && e.message) || "clipboard write failed");
    }
    return {
      ok: true,
      code: "path_copied",
      artifactId: resolved.artifact.id,
      versionId: resolved.version.id,
      deliverableId: resolved.deliverable.id,
    };
  }

  const resolved = resolveOpenableArtifact(opts.userData, payload);
  if (!resolved.ok) return resolved;

  const shell = opts.shell;
  if (!shell || typeof shell.openPath !== "function") {
    return fail("open_failed", "shell.openPath unavailable");
  }

  let err = "";
  try {
    err = await shell.openPath(resolved.abs);
  } catch (e) {
    return fail("open_failed", (e && e.message) || "openPath threw");
  }
  if (err) {
    return fail("open_failed", err);
  }
  return {
    ok: true,
    code: "opened",
    artifactId: resolved.artifact.id,
    versionId: resolved.version.id,
    deliverableId: resolved.deliverable.id,
  };
}

/**
 * @param {object} opts
 * @param {string} opts.userData
 * @param {object} opts.payload
 * @param {{ showItemInFolder: (p: string) => void }} opts.shell
 */
function revealArtifactSecure(opts) {
  const resolved = resolveOpenableArtifact(opts.userData, opts.payload || {});
  if (!resolved.ok) return resolved;
  const shell = opts.shell;
  if (!shell || typeof shell.showItemInFolder !== "function") {
    return fail("open_failed", "shell.showItemInFolder unavailable");
  }
  try {
    shell.showItemInFolder(resolved.abs);
  } catch (e) {
    return fail("open_failed", (e && e.message) || "showItemInFolder threw");
  }
  return {
    ok: true,
    code: "revealed",
    artifactId: resolved.artifact.id,
    versionId: resolved.version.id,
    deliverableId: resolved.deliverable.id,
  };
}

module.exports = {
  ALLOWED_OPEN_EXTENSIONS,
  userMessageForOpenCode,
  resolveOpenableArtifact,
  openArtifactSecure,
  revealArtifactSecure,
};
