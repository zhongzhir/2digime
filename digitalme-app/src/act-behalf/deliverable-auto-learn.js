"use strict";

/**
 * DVL2: accepted DeliverableVersion → background auto-learn.
 * Pipeline: extract → classify → consolidate → conflict detect → commit → audit
 */

const fs = require("node:fs");
const path = require("node:path");
const { PackageStore, readManifest } = require("../package-store");
const packageStore = require("./deliverable-package-store");
const artifactFs = require("./deliverable-artifact-fs");
const learnStore = require("./deliverable-learn-store");

const { JOB_STATUS, appendAudit, upsertJob, createQueuedJob, getJobByVersionId, getJob } =
  learnStore;

const SENSITIVE_RE =
  /身份|价值观|边界|授权|隐私|密钥|密码|不得代表|敏感|政治立场|宗教信仰/;
const ONE_OFF_RE = /本次|这一次|仅此|临时|只要这一次|不要记成习惯/;
const CONTRADICT_MARKERS = ["不是", "并非", "不再", "相反", "推翻", "纠正为"];

function truncate(s, n) {
  const t = String(s || "");
  if (t.length <= n) return t;
  return t.slice(0, Math.max(0, n - 1)) + "…";
}

function readTextArtifact(userData, ref) {
  if (!ref || !ref.relativePath) return "";
  const fmt = String(ref.format || "").toLowerCase();
  if (!["md", "html", "txt", "json"].includes(fmt) && !/\.(md|html|txt|json)$/i.test(ref.relativePath)) {
    return "";
  }
  try {
    const abs = artifactFs.resolveAbsolute(userData, ref.relativePath);
    if (!fs.existsSync(abs)) return "";
    return fs.readFileSync(abs, "utf8").slice(0, 12000);
  } catch {
    return "";
  }
}

function collectSourceFromVersion(userData, versionId) {
  const store = packageStore.loadStore(userData);
  const version = store.versions && store.versions[String(versionId)];
  if (!version) {
    return { ok: false, code: "version_not_found", message: "未找到成果版本。" };
  }
  const deliverable = store.deliverables && store.deliverables[version.deliverableId];
  const pkg = store.packages && store.packages[version.packageId];
  const arts = [];
  if (version.artifactRef) arts.push(version.artifactRef);
  if (Array.isArray(version.artifactRefs)) arts.push(...version.artifactRefs);
  if (version.previewRef) arts.push(version.previewRef);
  const seen = new Set();
  const artifactRefs = arts.filter((a) => {
    if (!a || !a.id || seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });
  const contentHashes = artifactRefs.map((a) => a.contentHash).filter(Boolean);
  const textParts = artifactRefs.map((a) => readTextArtifact(userData, a)).filter(Boolean);
  return {
    ok: true,
    version,
    deliverable,
    package: pkg,
    source: {
      taskId: (pkg && pkg.taskId) || null,
      planVersionId: (pkg && pkg.sourcePlanVersionId) || null,
      packageId: version.packageId || null,
      deliverableId: version.deliverableId || null,
      deliverableVersionId: version.id,
      artifactRefs: artifactRefs.map((a) => ({
        id: a.id,
        format: a.format,
        relativePath: a.relativePath,
        contentHash: a.contentHash,
      })),
      contentHashes,
      acceptedAt: learnStore.nowIso(),
      provenance: {
        generator: version.generator || null,
        model: (version.generator && version.generator.model) || null,
        skill: (version.generator && version.generator.skill) || null,
        tool: (version.generator && version.generator.tool) || null,
      },
    },
    excerpt: truncate(textParts.join("\n\n"), 8000),
    title: (deliverable && deliverable.title) || (version.title) || "成果",
    kind: (deliverable && deliverable.kind) || "document",
  };
}

/**
 * Rule-based extract (also used when callModel absent). Never stores full artifact body.
 */
function extractLearningItems({ title, kind, excerpt, source }, callModel) {
  const base = [];
  base.push({
    id: "ex_episodic_1",
    layer: "episodic",
    text: `本人接受了「${title}」（${kind}）这一成果版本。`,
    confidence: "low",
    oneOffLikely: false,
  });
  base.push({
    id: "ex_artifact_1",
    layer: "artifact_history",
    text: `成果证据：版本 ${source.deliverableVersionId}`,
    confidence: "high",
    oneOffLikely: false,
    artifactOnly: true,
  });

  const lines = String(excerpt || "")
    .split(/\n+/)
    .map((l) => l.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 12 && l.length <= 180)
    .slice(0, 6);

  for (let i = 0; i < lines.length && base.filter((b) => b.layer === "semantic").length < 3; i += 1) {
    const line = lines[i];
    if (/^(#{1,6}|<!DOCTYPE|html|head|body|script)/i.test(line)) continue;
    base.push({
      id: "ex_sem_" + (i + 1),
      layer: "semantic",
      text: truncate(line, 200),
      confidence: "low",
      oneOffLikely: ONE_OFF_RE.test(line),
    });
  }

  // Continuity markers (e.g. UNIQUE_*): auto-absorb as Active-Low searchable memory.
  const uniqueHits = String(excerpt || "").match(/UNIQUE_[A-Z0-9_]+/g) || [];
  const seenTok = new Set();
  for (const tok of uniqueHits) {
    if (seenTok.has(tok) || seenTok.size >= 5) continue;
    seenTok.add(tok);
    base.push({
      id: "ex_unique_" + tok.slice(0, 28),
      layer: "semantic",
      text: `从已接受成果中保留的要点标记：${tok}`,
      confidence: "low",
      oneOffLikely: false,
    });
  }

  if (typeof callModel === "function") {
    // Optional enrichment; failures fall back to rule extract.
    return Promise.resolve(callModel)
      .then(() => base)
      .catch(() => base);
  }
  return Promise.resolve(base);
}

function classifyItems(extracted) {
  return (extracted || []).map((item) => {
    const layer = item.layer || "episodic";
    let writeTarget = "memory_jsonl";
    if (layer === "artifact_history") writeTarget = "audit_only";
    if (layer === "procedural") writeTarget = "memory_jsonl";
    const sensitive = SENSITIVE_RE.test(item.text || "");
    return {
      ...item,
      layer,
      writeTarget,
      sensitive,
      packageCategory: layer === "procedural" ? "memory" : "memory",
    };
  });
}

function consolidate(classified) {
  const kept = [];
  const skipped = [];
  const seen = new Set();
  for (const item of classified || []) {
    if (item.artifactOnly || item.writeTarget === "audit_only") {
      kept.push({ ...item, action: "audit_only" });
      continue;
    }
    if (item.oneOffLikely) {
      skipped.push({ ...item, action: "skip_one_off" });
      continue;
    }
    const key = String(item.text || "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .slice(0, 80);
    if (seen.has(key)) {
      skipped.push({ ...item, action: "merge_duplicate" });
      continue;
    }
    seen.add(key);
    kept.push({
      ...item,
      action: item.layer === "episodic" ? "append_episodic" : "append_semantic",
    });
  }
  return {
    kept,
    skipped,
    diff: {
      keptCount: kept.length,
      skippedCount: skipped.length,
      reasons: skipped.map((s) => ({ id: s.id, action: s.action })),
    },
  };
}

function loadExistingMemorySnippets(packageDir) {
  const p = path.join(packageDir, "memory", "long-term-memory.jsonl");
  if (!fs.existsSync(p)) return [];
  try {
    return fs
      .readFileSync(p, "utf8")
      .split(/\n+/)
      .filter(Boolean)
      .slice(-80)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function detectConflict({ kept, packageDir, forceConflict }) {
  if (forceConflict) {
    return {
      required: true,
      reason: "forced_fixture",
      question: "新成果里的说法，似乎和你已有的长期看法不一致。要以哪边为准？",
      options: [
        { id: "keep_existing", label: "保持原来的" },
        { id: "apply_new", label: "按新的更新" },
        { id: "session_only", label: "仅本次使用" },
      ],
      recommended: "keep_existing",
      pendingItems: kept.filter((k) => k.layer === "semantic"),
    };
  }

  const existing = loadExistingMemorySnippets(packageDir);
  const high = existing.filter(
    (e) =>
      String(e.confidence || "").toLowerCase() === "high" ||
      String(e.type || "") === "long_term"
  );

  for (const item of kept) {
    if (item.sensitive || SENSITIVE_RE.test(item.text || "")) {
      return {
        required: true,
        reason: "sensitive_or_identity",
        question: "这项内容可能影响你的身份、边界或敏感设定。是否写入 Digital Me？",
        options: [
          { id: "keep_existing", label: "保持原来的" },
          { id: "apply_new", label: "按新的更新" },
          { id: "session_only", label: "仅本次使用" },
        ],
        recommended: "keep_existing",
        pendingItems: [item],
      };
    }
    if (item.layer !== "semantic") continue;
    const text = String(item.text || "");
    for (const old of high) {
      const oldText = String(old.content || "");
      if (!oldText || oldText.length < 8) continue;
      const overlap =
        text.includes(oldText.slice(0, 20)) || oldText.includes(text.slice(0, 20));
      const contradict =
        CONTRADICT_MARKERS.some((m) => text.includes(m)) && overlap;
      if (contradict) {
        return {
          required: true,
          reason: "contradicts_high_confidence",
          question: `新成果似乎与已有记忆「${truncate(oldText, 40)}」不一致。要以哪边为准？`,
          options: [
            { id: "keep_existing", label: "保持原来的" },
            { id: "apply_new", label: "按新的更新" },
            { id: "session_only", label: "仅本次使用" },
          ],
          recommended: "keep_existing",
          pendingItems: [item],
          existingContent: oldText,
        };
      }
    }
    // CRT-MVP Distillation Gate: do NOT ask Owner to confirm ordinary preferences.
    // Ambiguous one-off vs preference → auto-absorb as Active-Low (already confidence low).
    if (/总是|习惯|偏好|以后都|从今以后/.test(text) && /本次|临时/.test(text)) {
      item.confidence = "low";
      item.activationHint = "active_low_confidence";
      continue;
    }
  }

  return { required: false };
}

function buildOpsFromKept(kept, source) {
  const ops = [];
  for (const item of kept) {
    if (item.action === "audit_only" || item.writeTarget === "audit_only") continue;
    if (item.action === "skip_one_off" || item.action === "merge_duplicate") continue;
    const memoryType =
      item.layer === "procedural"
        ? "procedural"
        : item.layer === "semantic"
          ? "semantic"
          : "episodic";
    ops.push({
      type: "append_jsonl",
      path: "memory/long-term-memory.jsonl",
      row: {
        type: memoryType,
        content: item.text,
        theme: item.layer === "episodic" ? "任务经验" : "成果学习",
        // CRT-MVP: first-time learnings enter as Active-Low; reinforce later.
        confidence: item.confidence || "low",
        activationState: "active_low_confidence",
        status: "active",
        usageCount: 0,
        reinforcement: 0,
        sensitivity: item.sensitive ? "sensitive" : "private",
        sourceRefs: [
          "deliverable_auto_learn",
          `deliverableVersion:${source.deliverableVersionId}`,
          source.packageId ? `package:${source.packageId}` : null,
        ].filter(Boolean),
        supersedes: item.supersedes || null,
        expiresAt: null,
        learnProvenance: {
          taskId: source.taskId,
          planVersionId: source.planVersionId,
          packageId: source.packageId,
          deliverableId: source.deliverableId,
          deliverableVersionId: source.deliverableVersionId,
          contentHashes: source.contentHashes || [],
          acceptedAt: source.acceptedAt,
        },
      },
    });
  }
  return ops;
}

function commitLearning(packageDir, kept, source) {
  const ops = buildOpsFromKept(kept, source);
  if (!ops.length) {
    return {
      ok: true,
      skipped: true,
      message: "无可自动写入的学习项。",
      changeSetId: null,
      rollbackVersion: null,
      revision: null,
    };
  }
  if (!packageDir || !fs.existsSync(packageDir)) {
    return {
      ok: false,
      code: "package_dir_missing",
      message: "未配置主体资料包，学习已记录但未写入。",
    };
  }
  const store = new PackageStore({
    packageDir,
    ownerId: "system:deliverable-auto-learn",
  });
  store.recover();
  const cs = store.createChangeSet({
    actor: "system:deliverable-auto-learn",
    reason: truncate(
      `接受成果后自动学习：${source.deliverableVersionId}`,
      200
    ),
    sourceRefs: [
      "deliverable_auto_learn",
      `deliverableVersion:${source.deliverableVersionId}`,
    ],
    dataKinds: ["owner_assertion"],
    ops,
  });
  store.preview(cs.id);
  const committed = store.commit(cs.id, { confirmed: true });
  const manifest = readManifest(packageDir) || {};
  return {
    ok: true,
    skipped: false,
    changeSetId: committed.changeSetId || cs.id,
    rollbackVersion: committed.rollbackVersion || null,
    revision: committed.revision != null ? committed.revision : manifest.revision,
    rootSha256: committed.rootSha256 || manifest.rootSha256 || null,
    affectedPaths: committed.affectedPaths || [],
  };
}

async function runLearnJob(userData, jobId, deps) {
  const d = deps || {};
  const got = getJob(userData, jobId);
  if (!got.ok) return got;
  let job = got.job;

  if (
    job.status === JOB_STATUS.committed ||
    job.status === JOB_STATUS.resolved_keep ||
    job.status === JOB_STATUS.resolved_session_only ||
    job.status === JOB_STATUS.skipped
  ) {
    return { ok: true, job, noop: true };
  }

  job = {
    ...job,
    status: JOB_STATUS.running,
    attempts: (job.attempts || []).concat([{ at: learnStore.nowIso(), action: "run" }]),
  };
  job = appendAudit(job, { action: "run_start" });
  upsertJob(userData, job);

  try {
    const collected = collectSourceFromVersion(userData, job.source.deliverableVersionId);
    if (!collected.ok) {
      job = {
        ...appendAudit(job, { action: "failed", code: collected.code }),
        status: JOB_STATUS.failed,
        lastError: collected.message,
      };
      upsertJob(userData, job);
      return { ok: false, ...collected, job };
    }

    job = {
      ...job,
      source: { ...job.source, ...collected.source },
    };

    const extracted = await extractLearningItems(
      {
        title: collected.title,
        kind: collected.kind,
        excerpt: collected.excerpt,
        source: job.source,
      },
      d.callModel
    );
    const classified = classifyItems(extracted);
    const consolidated = consolidate(classified);
    job = {
      ...job,
      extracted,
      classified,
      consolidateDiff: consolidated.diff,
    };
    job = appendAudit(job, {
      action: "extract_classify_consolidate",
      extractedCount: extracted.length,
      keptCount: consolidated.kept.length,
    });

    const packageDir = d.packageDir || null;
    const conflict = detectConflict({
      kept: consolidated.kept,
      packageDir,
      forceConflict: !!d.forceConflict,
    });

    if (conflict.required) {
      job = {
        ...job,
        status: JOB_STATUS.pending_conflict,
        conflict: {
          question: conflict.question,
          options: conflict.options,
          recommended: conflict.recommended,
          reason: conflict.reason,
          pendingItems: conflict.pendingItems || [],
        },
        commit: null,
      };
      job = appendAudit(job, { action: "owner_attention_required", reason: conflict.reason });
      upsertJob(userData, job);
      return { ok: true, job, conflict: true };
    }

    const commitResult = commitLearning(packageDir, consolidated.kept, job.source);
    if (!commitResult.ok) {
      // Acceptance must not fail: record skipped write if package missing.
      if (commitResult.code === "package_dir_missing") {
        job = {
          ...job,
          status: JOB_STATUS.skipped,
          lastError: commitResult.message,
          commit: null,
        };
        job = appendAudit(job, { action: "skipped_no_package" });
        upsertJob(userData, job);
        return { ok: true, job, skipped: true };
      }
      job = {
        ...job,
        status: JOB_STATUS.failed,
        lastError: commitResult.message,
      };
      job = appendAudit(job, { action: "commit_failed", code: commitResult.code });
      upsertJob(userData, job);
      return { ok: false, code: commitResult.code, message: commitResult.message, job };
    }

    job = {
      ...job,
      status: commitResult.skipped ? JOB_STATUS.skipped : JOB_STATUS.committed,
      conflict: null,
      commit: commitResult.skipped
        ? null
        : {
            changeSetId: commitResult.changeSetId,
            packageRevision: commitResult.revision,
            rollbackToken: commitResult.rollbackVersion,
            rootSha256: commitResult.rootSha256,
            affectedPaths: commitResult.affectedPaths,
          },
      lastError: null,
    };
    job = appendAudit(job, {
      action: commitResult.skipped ? "skipped_empty" : "committed",
      changeSetId: commitResult.changeSetId,
    });
    upsertJob(userData, job);
    return { ok: true, job };
  } catch (err) {
    job = {
      ...job,
      status: JOB_STATUS.failed,
      lastError: err && err.message ? err.message : String(err),
    };
    try {
      job = appendAudit(job, { action: "exception", message: job.lastError });
      upsertJob(userData, job);
    } catch (persistErr) {
      console.error(
        "[deliverable-auto-learn] persist failed",
        persistErr && persistErr.message ? persistErr.message : persistErr
      );
    }
    return {
      ok: false,
      code: (err && err.code) || "learn_failed",
      message: job.lastError,
      job,
    };
  }
}

/**
 * Enqueue after accept. Returns immediately with job handle; processing is async unless sync=true.
 */
function enqueueAfterAccept(userData, versionId, deps) {
  const collected = collectSourceFromVersion(userData, versionId);
  if (!collected.ok) return collected;
  const created = createQueuedJob(userData, collected.source);
  if (!created.ok) return created;

  const run = () =>
    runLearnJob(userData, created.job.id, deps).catch((err) => {
      console.error("[deliverable-auto-learn]", err && err.message ? err.message : err);
    });

  if (deps && deps.sync) {
    return run().then((result) => ({
      ok: true,
      job: (result && result.job) || created.job,
      result,
      reused: created.reused,
    }));
  }

  setImmediate(run);
  return { ok: true, job: created.job, reused: created.reused, queued: true };
}

async function resolveConflict(userData, { jobId, choice }, deps) {
  const d = deps || {};
  const got = getJob(userData, jobId);
  if (!got.ok) return got;
  let job = got.job;
  if (job.status !== JOB_STATUS.pending_conflict) {
    return { ok: false, code: "not_pending_conflict", message: "当前没有待确认的学习冲突。" };
  }
  const ch = String(choice || "");
  if (!["keep_existing", "apply_new", "session_only"].includes(ch)) {
    return { ok: false, code: "invalid_choice", message: "请选择一项处理方式。" };
  }

  if (ch === "keep_existing") {
    job = {
      ...job,
      status: JOB_STATUS.resolved_keep,
      conflict: { ...(job.conflict || {}), resolvedChoice: ch, resolvedAt: learnStore.nowIso() },
    };
    job = appendAudit(job, { action: "resolved_keep_existing" });
    upsertJob(userData, job);
    return { ok: true, job, message: "已保持原来的设定。" };
  }

  if (ch === "session_only") {
    job = {
      ...job,
      status: JOB_STATUS.resolved_session_only,
      conflict: { ...(job.conflict || {}), resolvedChoice: ch, resolvedAt: learnStore.nowIso() },
    };
    job = appendAudit(job, { action: "resolved_session_only" });
    upsertJob(userData, job);
    return { ok: true, job, message: "已仅用于本次，未写入长期记忆。" };
  }

  // apply_new
  const pending =
    (job.conflict && job.conflict.pendingItems) ||
    (job.classified || []).filter((c) => c.layer === "semantic");
  const commitResult = commitLearning(d.packageDir, pending, job.source);
  if (!commitResult.ok) {
    return {
      ok: false,
      code: commitResult.code,
      message: commitResult.message || "无法按新的更新。",
      job,
    };
  }
  job = {
    ...job,
    status: JOB_STATUS.committed,
    conflict: { ...(job.conflict || {}), resolvedChoice: ch, resolvedAt: learnStore.nowIso() },
    commit: {
      changeSetId: commitResult.changeSetId,
      packageRevision: commitResult.revision,
      rollbackToken: commitResult.rollbackVersion,
      rootSha256: commitResult.rootSha256,
      affectedPaths: commitResult.affectedPaths,
    },
  };
  job = appendAudit(job, { action: "resolved_apply_new", changeSetId: commitResult.changeSetId });
  upsertJob(userData, job);
  return { ok: true, job, message: "已按新的更新。" };
}

async function retryJob(userData, jobId, deps) {
  const got = getJob(userData, jobId);
  if (!got.ok) return got;
  if (got.job.status !== JOB_STATUS.failed && got.job.status !== JOB_STATUS.queued) {
    return { ok: false, code: "not_retryable", message: "当前状态不可重试。", job: got.job };
  }
  let job = { ...got.job, status: JOB_STATUS.queued, lastError: null };
  job = appendAudit(job, { action: "retry_requested" });
  upsertJob(userData, job);
  return runLearnJob(userData, job.id, deps);
}

module.exports = {
  collectSourceFromVersion,
  extractLearningItems,
  classifyItems,
  consolidate,
  detectConflict,
  commitLearning,
  enqueueAfterAccept,
  runLearnJob,
  resolveConflict,
  retryJob,
  getJobByVersionId,
  JOB_STATUS,
};
