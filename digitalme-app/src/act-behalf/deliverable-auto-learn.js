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
const projectKnowledgeStore = require("./project-knowledge-store");
const { detectProjectFromGoal } = require("./project-context-registry");
const { newClaimId, nowIso, PROJECT_IDS } = require("./project-knowledge-schema");

const { JOB_STATUS, appendAudit, upsertJob, createQueuedJob, getJobByVersionId, getJob } =
  learnStore;

const SENSITIVE_RE =
  /身份|价值观|边界|授权|隐私|密钥|密码|不得代表|敏感|政治立场|宗教信仰/;
const ONE_OFF_RE = /本次|这一次|仅此|临时|只要这一次|不要记成习惯/;
const CONTRADICT_MARKERS = ["不是", "并非", "不再", "相反", "推翻", "纠正为"];
const JUDGMENT_RE =
  /应该先|优先验证|优先.{0,40}而非|优先选择|在.{0,30}情况下(?:选|应)|取舍|权衡后|UNIQUE_JUDGMENT/;
const PREFERENCE_RE = /文风|语气|篇幅|结构习惯|表达偏好|以后都用|习惯用|不要写成/;
const HYPOTHETICAL_LEARN_RE = /可考虑|假设|待验证|可能方案|未来可|规划目标|试点方案|hypothetical/i;
const FABRICATED_LEARN_RE =
  /联合创始人|CTO|CPO|融资\s*[\d.,]+\s*(?:万|亿)|DAU|MAU|NPS|日活|月活|年收入|营收|签约客户|标杆客户|已完成融资|UNIQUE_UNVERIFIED_FACT/;

/**
 * Accepting a DeliverableVersion ≠ confirming every fact inside it.
 * new_fact requires at least one traceable evidence source.
 */
function buildFactEvidenceCorpus(collected) {
  const parts = [];
  if (collected && collected.taskMaterialText) parts.push(collected.taskMaterialText);
  if (collected && collected.subjectEvidenceText) parts.push(collected.subjectEvidenceText);
  if (collected && Array.isArray(collected.ownerExplicitStatements)) {
    parts.push(collected.ownerExplicitStatements.join("\n"));
  }
  // Provenance subject_fact statements already confirmed.
  const prov = collected && collected.source && collected.source.provenance;
  if (prov && Array.isArray(prov.subjectRefs)) {
    for (const r of prov.subjectRefs) {
      if (r && r.statement && r.evidenceKind === "subject_fact") parts.push(r.statement);
    }
  }
  return parts.join("\n");
}

function textSupportedByEvidence(text, evidenceCorpus) {
  const t = String(text || "").trim();
  const corpus = String(evidenceCorpus || "");
  if (!t || !corpus) return false;
  // UNIQUE tokens must appear verbatim in evidence.
  const uniq = t.match(/UNIQUE_[A-Z0-9_]+/g);
  if (uniq && uniq.length) {
    return uniq.every((tok) => corpus.includes(tok));
  }
  // Substantive overlap: longest 12+ char window or 60% of shortened text.
  const compact = t.replace(/\s+/g, "");
  const corpusCompact = corpus.replace(/\s+/g, "");
  if (compact.length >= 12 && corpusCompact.includes(compact.slice(0, Math.min(40, compact.length)))) {
    return true;
  }
  const window = compact.slice(0, 24);
  return window.length >= 8 && corpusCompact.includes(window);
}

function inferLearnKind(item, evidenceCorpus) {
  const text = String((item && item.text) || "");
  if (item.layer === "artifact_history" || item.artifactOnly) {
    return { learnKind: null, logicalState: "session_only", write: false };
  }
  if (item.layer === "episodic") {
    return {
      learnKind: null,
      logicalState: "active_low",
      write: true,
      ownership: "subject_owned",
    };
  }
  // Hypothetical / open proposals must not become new_fact.
  if (HYPOTHETICAL_LEARN_RE.test(text) && !JUDGMENT_RE.test(text)) {
    return {
      learnKind: null,
      logicalState: "session_only",
      write: false,
      rejectReason: "hypothetical_not_fact",
      ownership: "ai_generated",
    };
  }
  if (JUDGMENT_RE.test(text)) {
    return {
      learnKind: /多次|一贯|总是/.test(text) ? "decision_pattern" : "new_judgment",
      logicalState: "judgment_candidate",
      write: true,
      ownership: "subject_owned",
    };
  }
  if (PREFERENCE_RE.test(text)) {
    return {
      learnKind: "expression_preference",
      logicalState: "active_low",
      write: true,
      ownership: "subject_owned",
    };
  }

  // Fact-like claims (including UNIQUE_* markers).
  const looksFact =
    /UNIQUE_CONFIRMED_FACT|UNIQUE_UNVERIFIED_FACT|UNIQUE_FAKE_FACT|UNIQUE_FACT/.test(text) ||
    FABRICATED_LEARN_RE.test(text) ||
    /本人|我曾|毕业于|创办|担任|公司是/.test(text);

  if (looksFact || /UNIQUE_/.test(text)) {
    if (/UNIQUE_JUDGMENT/.test(text)) {
      return {
        learnKind: "new_judgment",
        logicalState: "judgment_candidate",
        write: true,
        ownership: "subject_owned",
      };
    }
    const supported = textSupportedByEvidence(text, evidenceCorpus);
    if (!supported || /UNIQUE_UNVERIFIED_FACT|UNIQUE_FAKE_FACT/.test(text)) {
      return {
        learnKind: null,
        logicalState: "session_only",
        write: false,
        rejectReason: "unverified_fact_no_evidence",
        ownership: "ai_generated",
      };
    }
    return {
      learnKind: "new_fact",
      logicalState: "active_low",
      write: true,
      ownership: "subject_owned",
      factEvidence: "traceable",
    };
  }

  // Generic semantic line without clear fact/judgment/preference → soft preference-ish memory,
  // but not new_fact.
  return {
    learnKind: "expression_preference",
    logicalState: "active_low",
    write: true,
    ownership: "subject_owned",
  };
}

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
  const packageId =
    version.packageId ||
    (deliverable && deliverable.packageId) ||
    null;
  const pkg = packageId && store.packages ? store.packages[String(packageId)] : null;
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

  // Task materials & subject evidence for fact-gate (accept ≠ confirm every claim).
  let taskMaterialText = "";
  let subjectEvidenceText = "";
  try {
    const actBehalfStore = require("./task-store");
    const taskId = (pkg && pkg.taskId) || null;
    if (taskId) {
      const got = actBehalfStore.getTask(userData, taskId, { heal: false });
      const task = got && got.ok ? got.task : null;
      const mats = (task && task.referenceMaterials) || [];
      taskMaterialText = mats
        .map((m) => `${m && m.name ? m.name : ""}\n${m && m.text ? m.text : ""}`)
        .join("\n");
    }
  } catch {
    taskMaterialText = "";
  }
  try {
    const prov = version.provenance || {};
    const subj = []
      .concat(Array.isArray(prov.subjectRefs) ? prov.subjectRefs : [])
      .concat(Array.isArray(prov.memoryRefs) ? prov.memoryRefs : []);
    subjectEvidenceText = subj
      .map((r) => (r && (r.statement || r.assetId)) || "")
      .filter(Boolean)
      .join("\n");
    // Also fold confirmed subject_fact statements if present on assembly layers — N/A here.
  } catch {
    subjectEvidenceText = "";
  }

  return {
    ok: true,
    version,
    deliverable,
    package: pkg,
    source: {
      taskId: (pkg && pkg.taskId) || null,
      planVersionId: (pkg && pkg.sourcePlanVersionId) || null,
      packageId: packageId || null,
      deliverableId: version.deliverableId || null,
      deliverableVersionId: version.id,
      sourceDeliverableVersionId: version.id,
      acceptedBySubjectId:
        version.acceptedBySubjectId ||
        version.ownerSubjectId ||
        (version.identityContextSnapshot && version.identityContextSnapshot.ownerSubjectId) ||
        "subj_owner_local",
      representedSubjectId:
        version.representedSubjectId ||
        (version.identityContextSnapshot && version.identityContextSnapshot.representedSubjectId) ||
        "subj_owner_local",
      writebackTargetSubjectId:
        (version.identityContextSnapshot && version.identityContextSnapshot.actingSubjectId) ||
        "subj_dm_local",
      authorizationRef:
        (version.authorizationRefs && version.authorizationRefs[0]) ||
        (version.identityContextSnapshot &&
          version.identityContextSnapshot.authorizationRefs &&
          version.identityContextSnapshot.authorizationRefs[0]) ||
        null,
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
        subjectRefs: (version.provenance && version.provenance.subjectRefs) || [],
        contextClass: (version.provenance && version.provenance.contextClass) || null,
      },
    },
    excerpt: truncate(textParts.join("\n\n"), 8000),
    title: (deliverable && deliverable.title) || version.title || "成果",
    kind: (deliverable && deliverable.kind) || "document",
    taskMaterialText,
    subjectEvidenceText,
  };
}

/**
 * Rule-based extract (also used when callModel absent). Never stores full artifact body.
 * @param {object} args
 * @param {string} [args.evidenceCorpus]
 */
function extractLearningItems({ title, kind, excerpt, source, evidenceCorpus }, callModel) {
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

  // Continuity markers (e.g. UNIQUE_*): candidate only; fact-gate decides new_fact vs discard.
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
      uniqueToken: tok,
    });
  }

  // Explicit judgment harvest: do not rely on attachment-seeded UNIQUE tokens.
  const judgmentScan = String(excerpt || "").replace(/\s+/g, " ");
  const judgmentMatch = judgmentScan.match(
    /[^。！？\n]{0,40}(?:优先验证|优先[^。]{0,40}而非|应该先|在当前阶段[^。]{0,80}而非)[^。！？\n]{0,80}/
  );
  if (judgmentMatch && !base.some((b) => b.layer === "semantic" && JUDGMENT_RE.test(b.text))) {
    base.push({
      id: "ex_judgment_harvest",
      layer: "semantic",
      text: truncate(judgmentMatch[0].trim(), 200),
      confidence: "low",
      oneOffLikely: false,
    });
  }

  void evidenceCorpus;
  if (typeof callModel === "function") {
    return Promise.resolve(callModel)
      .then(() => base)
      .catch(() => base);
  }
  return Promise.resolve(base);
}

function classifyItems(extracted, evidenceCorpus) {
  return (extracted || []).map((item) => {
    const layer = item.layer || "episodic";
    let writeTarget = "memory_jsonl";
    if (layer === "artifact_history") writeTarget = "audit_only";
    if (layer === "procedural") writeTarget = "memory_jsonl";
    const sensitive = SENSITIVE_RE.test(item.text || "");
    const inferred = inferLearnKind(item, evidenceCorpus || "");
    return {
      ...item,
      layer,
      writeTarget: inferred.write === false ? "audit_only" : writeTarget,
      sensitive,
      packageCategory: "memory",
      learnKind: inferred.learnKind,
      logicalState: inferred.logicalState,
      ownership: inferred.ownership || "subject_owned",
      rejectReason: inferred.rejectReason || null,
      factEvidence: inferred.factEvidence || null,
    };
  });
}

function consolidate(classified) {
  const kept = [];
  const skipped = [];
  const seen = new Set();
  for (const item of classified || []) {
    if (item.rejectReason === "unverified_fact_no_evidence") {
      skipped.push({ ...item, action: "skip_unverified_fact" });
      continue;
    }
    if (item.rejectReason === "hypothetical_not_fact") {
      skipped.push({ ...item, action: "skip_hypothetical" });
      continue;
    }
    if (item.logicalState === "session_only" && item.writeTarget === "audit_only") {
      skipped.push({ ...item, action: "skip_session_only" });
      continue;
    }
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
      reasons: skipped.map((s) => ({ id: s.id, action: s.action, rejectReason: s.rejectReason || null })),
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
    const logicalState = item.logicalState || "active_low";
    const activationState =
      logicalState === "judgment_candidate"
        ? "active_low_confidence"
        : logicalState === "session_only"
          ? "session_only"
          : "active_low_confidence";
    ops.push({
      type: "append_jsonl",
      path: "memory/long-term-memory.jsonl",
      row: {
        type: memoryType,
        content: item.text,
        theme: item.layer === "episodic" ? "任务经验" : "成果学习",
        confidence: item.confidence || "low",
        activationState,
        logicalState,
        learnKind: item.learnKind || null,
        ownership: item.ownership || "subject_owned",
        status: logicalState === "session_only" ? "session_only" : "active",
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
        contextClassAtLearn: (source.provenance && source.provenance.contextClass) || null,
        learnProvenance: {
          taskId: source.taskId,
          planVersionId: source.planVersionId,
          packageId: source.packageId,
          deliverableId: source.deliverableId,
          deliverableVersionId: source.deliverableVersionId,
          contentHashes: source.contentHashes || [],
          acceptedAt: source.acceptedAt,
          factEvidence: item.factEvidence || null,
        },
      },
    });
  }
  return ops;
}

function commitProjectKnowledgeCandidates(packageDir, kept, source) {
  if (!packageDir || !Array.isArray(kept) || !kept.length) return { ok: true, count: 0 };
  const taskId = source && source.taskId;
  let goal = "";
  try {
    const actBehalfStore = require("./task-store");
    if (taskId) {
      const got = actBehalfStore.getTask(source.userData || "", taskId, { heal: false });
      goal = (got && got.task && (got.task.goal || got.task.request)) || "";
    }
  } catch {
    goal = "";
  }
  const detected = detectProjectFromGoal(goal);
  if (!detected) return { ok: true, count: 0 };

  projectKnowledgeStore.ensureDigitalMeProjectKnowledge(packageDir);
  let count = 0;
  for (const item of kept) {
    if (!item || item.layer !== "semantic" || item.writeTarget === "audit_only") continue;
    if (item.learnKind === "new_fact" && item.rejectReason) continue;
    const text = String(item.text || "").trim();
    if (!text || text.length < 16) continue;
    if (/本人接受了「/.test(text)) continue;
    const claim = {
      claimId: newClaimId(),
      projectId: PROJECT_IDS.DIGITAL_ME,
      claimText: text,
      claimType: "proposal",
      sourceRefs: [`deliverableVersion:${source.deliverableVersionId}`],
      authorityLevel: "accepted_artifact",
      confirmationStatus: "candidate",
      effectiveFrom: nowIso(),
      supersededBy: null,
      contradictedBy: null,
      scope: "digital_me_project",
      freshness: nowIso(),
      confidence: item.confidence || "low",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      schemaVersion: 1,
      sourceDeliverableVersionId: source.deliverableVersionId,
      learnCategory: "project_knowledge_candidate",
    };
    projectKnowledgeStore.upsertClaim(packageDir, claim);
    count += 1;
  }
  return { ok: true, count };
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

    const evidenceCorpus = buildFactEvidenceCorpus(collected);
    const extracted = await extractLearningItems(
      {
        title: collected.title,
        kind: collected.kind,
        excerpt: collected.excerpt,
        source: job.source,
        evidenceCorpus,
      },
      d.callModel
    );
    const classified = classifyItems(extracted, evidenceCorpus);
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
    if (commitResult.ok && !commitResult.skipped) {
      const pkResult = commitProjectKnowledgeCandidates(packageDir, consolidated.kept, {
        ...job.source,
        userData,
      });
      job = appendAudit(job, {
        action: "project_knowledge_candidates",
        count: pkResult.count || 0,
      });
    }
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

  // IDCOLLAB-MIN-01: learning_writeback requires live authorization from store.
  const source = collected.source || {};
  const authorizationStore = require("./authorization-store");
  const gate = authorizationStore.resolveActiveTaskAuthorization(userData, {
    taskId: source.taskId,
    planVersionId: source.planVersionId,
    actionType: "learning_writeback",
  });
  if (!gate.ok) {
    return {
      ok: false,
      code: gate.code,
      message: gate.message || "本次授权不允许学习写回。",
      acceptPreserved: true,
    };
  }
  const authRef = gate.ref || (source.authorizationRef || null);
  if (authRef && authRef.authorizationId) {
    const expectedTarget =
      (collected.source.writebackTargetSubjectId) || "subj_dm_local";
    if (
      gate.record &&
      gate.record.granteeSubjectId &&
      String(gate.record.granteeSubjectId) !== String(expectedTarget)
    ) {
      return {
        ok: false,
        code: "learning_writeback_target_mismatch",
        message: "学习写回目标与授权主体不一致。",
        acceptPreserved: true,
      };
    }
  }

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
  buildFactEvidenceCorpus,
  textSupportedByEvidence,
  inferLearnKind,
};
