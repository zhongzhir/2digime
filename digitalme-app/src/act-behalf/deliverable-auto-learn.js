"use strict";

/**
 * DVL2: accepted DeliverableVersion → background auto-learn.
 * Pipeline: extract → classify → consolidate → conflict detect → commit → audit
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { PackageStore, readManifest } = require("../package-store");
const packageStore = require("./deliverable-package-store");
const artifactFs = require("./deliverable-artifact-fs");
const learnStore = require("./deliverable-learn-store");
const projectKnowledgeStore = require("./project-knowledge-store");
const policies = require("../policies");
const { detectProjectFromGoal } = require("./project-context-registry");
const { newClaimId, nowIso, PROJECT_IDS } = require("./project-knowledge-schema");

function sha256Short(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex").slice(0, 16);
}

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

/** Revision instruction headers — not reusable preferences. */
const REVISION_HEADER_RE =
  /^(请按以下明确修改重写|请按以下修改|请修改如下|修改要求|修订要求|如下修改)[：:：]?\s*$/i;

/** Boundary-first patterns (must not land in expression_preference). */
const BOUNDARY_RE =
  /不得|不能|不要把|未经.{0,12}不得|尚未.{0,24}(?:不得|不能|不要)|必须避免|需要严格区分|禁止|严禁/;

/** Current-fact patterns. */
const CURRENT_FACT_RE =
  /尚未(?:正式)?验证|尚未完成|尚未进入|当前已完成|当前未开始|仍处于|已进入|未进入正式|已经完成|产品路线|支付结算尚未|协作网络尚未/;

const PREFERENCE_CUE_RE =
  /标题|开篇|开头|篇幅|结构|分点|语气|观点|冲突|铺垫|偏好|以后|习惯|减少|增加|保留|连贯叙述|精炼/;

function normalizePreferenceKey(text) {
  return String(text || "")
    .replace(/^表达与成果偏好[：:]/, "")
    .replace(/^结构偏好[：:]/, "")
    .replace(/^标题偏好[：:]/, "")
    .replace(/^篇幅偏好[：:]/, "")
    .replace(/^用户确认的修正[：:]/, "")
    .replace(/^边界[：:]/, "")
    .replace(/^\d+[\.、．)]\s*/, "")
    .replace(/\s+/g, "")
    .toLowerCase()
    .slice(0, 64);
}

function isRevisionGuidanceHeader(line) {
  const t = String(line || "").trim();
  if (!t) return true;
  if (REVISION_HEADER_RE.test(t)) return true;
  if (/^请按以下/.test(t) && t.length <= 24) return true;
  return false;
}

function isBoundaryText(text) {
  const t = String(text || "");
  return BOUNDARY_RE.test(t);
}

function isCurrentFactText(text) {
  const t = String(text || "");
  return CURRENT_FACT_RE.test(t) && !isBoundaryText(t);
}

function stripGuidancePrefix(text) {
  return String(text || "")
    .replace(/^表达与成果偏好[：:]\s*/, "")
    .replace(/^用户确认的修正[：:]\s*/, "")
    .replace(/^边界[：:]\s*/, "")
    .replace(/^\d+[\.、．)]\s*/, "")
    .trim();
}

/**
 * Overlearn risk: body paragraphs / one-off content must not be long-term prefs.
 */
function assessOverlearnRisk(item) {
  const text = String((item && item.text) || "").trim();
  const clean = stripGuidancePrefix(text);
  const risks = [];
  if (clean.length > 120) risks.push("length_gt_120");
  if (/[。！？]/.test(clean) && clean.length > 80) risks.push("multi_sentence_body");
  if (/最近一段时间|目前主流|很多人已经习惯/.test(clean)) risks.push("article_opening_pattern");
  if (/\d{4}[-年/]\d{1,2}/.test(clean)) risks.push("dated_content");
  if (!item.fromRevisionGuidance && !item.fromRevisionDiff && !item.explicitUserStatement) {
    if (clean.length > 80) risks.push("body_without_user_source");
  }
  if (item.fromBodyHarvest) risks.push("from_accepted_body_harvest");
  const overlearnRisk = risks.length > 0;
  const blockLongTermPref =
    overlearnRisk &&
    !item.fromRevisionGuidance &&
    !item.fromRevisionDiff &&
    !item.explicitUserStatement;
  return {
    overlearnRisk,
    overlearnReasons: risks,
    blockLongTermPref,
  };
}

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
  const clean = stripGuidancePrefix(text);
  const over = assessOverlearnRisk(item);

  if (item.layer === "artifact_history" || item.artifactOnly || item.learnHint === "artifact_history") {
    return {
      learnKind: "artifact_history",
      logicalState: "session_only",
      write: true,
      resolverEligible: false,
      ownership: "subject_owned",
      writeTargetHint: "session_only_audit",
      sourceType: "accepted_version",
    };
  }
  if (item.layer === "episodic") {
    return {
      learnKind: null,
      logicalState: "active_low",
      write: false,
      resolverEligible: false,
      ownership: "subject_owned",
      rejectReason: "episodic_accept_notice_not_reusable",
    };
  }
  if (item.skipLongTerm || item.revisionHeader) {
    return {
      learnKind: null,
      logicalState: "session_only",
      write: false,
      resolverEligible: false,
      rejectReason: item.rejectReason || "revision_header_not_reusable",
      ownership: "subject_owned",
      overlearnRisk: false,
    };
  }

  // Body harvest / overlearn: may record as session_only audit rows, never resolver-eligible.
  if (item.fromBodyHarvest || over.blockLongTermPref) {
    return {
      learnKind: "artifact_history",
      logicalState: "session_only",
      write: true,
      resolverEligible: false,
      overlearnRisk: true,
      overlearnReasons: over.overlearnReasons.length
        ? over.overlearnReasons
        : ["from_accepted_body_harvest"],
      rejectReason: "artifact_body_overlearn_blocked",
      ownership: "ai_generated",
      writeTargetHint: "session_only_audit",
    };
  }

  // Priority 1: explicit boundary
  if (
    item.learnHint === "boundary" ||
    item.learnKind === "boundary" ||
    isBoundaryText(clean)
  ) {
    return {
      learnKind: "boundary",
      logicalState: "active",
      write: true,
      writeTargetHint: "boundary_and_memory",
      resolverEligible: true,
      ownership: "subject_owned",
      sourceType: item.sourceType || "revision_guidance",
      overlearnRisk: false,
      confidenceBoost: "high",
    };
  }

  // Priority 2: current_fact / correction
  const looksFact =
    item.learnHint === "current_fact" ||
    item.learnHint === "project_or_fact" ||
    item.learnKind === "current_fact" ||
    isCurrentFactText(clean) ||
    /用户确认的修正/.test(text) ||
    /UNIQUE_CONFIRMED_FACT|UNIQUE_UNVERIFIED_FACT|UNIQUE_FAKE_FACT|UNIQUE_FACT/.test(text) ||
    FABRICATED_LEARN_RE.test(text) ||
    /本人|我曾|毕业于|创办|担任|公司是|尚未进入|已经完成|产品路线/.test(clean);

  if (looksFact || /UNIQUE_/.test(text)) {
    if (/UNIQUE_JUDGMENT/.test(text)) {
      return {
        learnKind: "new_judgment",
        logicalState: "judgment_candidate",
        write: true,
        resolverEligible: true,
        ownership: "subject_owned",
      };
    }
    if (HYPOTHETICAL_LEARN_RE.test(clean) && !JUDGMENT_RE.test(clean)) {
      return {
        learnKind: null,
        logicalState: "session_only",
        write: false,
        resolverEligible: false,
        rejectReason: "hypothetical_not_fact",
        ownership: "ai_generated",
      };
    }
    const supported =
      item.fromRevisionGuidance ||
      textSupportedByEvidence(text, evidenceCorpus) ||
      /用户确认的修正/.test(text);
    if (!supported) {
      return {
        learnKind: "current_fact",
        logicalState: "session_only",
        write: false,
        resolverEligible: false,
        rejectReason: "unverified_fact_no_evidence",
        ownership: "ai_generated",
      };
    }
    return {
      learnKind: "current_fact",
      logicalState: "active_low",
      write: true,
      writeTargetHint: "project_claims",
      resolverEligible: true,
      ownership: "subject_owned",
      factEvidence: "revision_or_materials",
      sourceType: item.sourceType || "project_fact_correction",
    };
  }

  // Overlearn without explicit user source → session_only audit, never long-term preference recall
  if (over.overlearnRisk && !item.fromRevisionGuidance && !item.fromRevisionDiff && !item.explicitUserStatement) {
    return {
      learnKind: "artifact_history",
      logicalState: "session_only",
      write: true,
      resolverEligible: false,
      overlearnRisk: true,
      overlearnReasons: over.overlearnReasons,
      rejectReason: "artifact_body_overlearn_blocked",
      ownership: "ai_generated",
      writeTargetHint: "session_only_audit",
    };
  }

  // Hypothetical / open proposals must not become fact.
  if (HYPOTHETICAL_LEARN_RE.test(clean) && !JUDGMENT_RE.test(clean)) {
    return {
      learnKind: null,
      logicalState: "session_only",
      write: false,
      resolverEligible: false,
      rejectReason: "hypothetical_not_fact",
      ownership: "ai_generated",
    };
  }

  if (JUDGMENT_RE.test(clean)) {
    return {
      learnKind: /多次|一贯|总是/.test(clean) ? "decision_pattern" : "new_judgment",
      logicalState: "judgment_candidate",
      write: true,
      resolverEligible: true,
      ownership: "subject_owned",
    };
  }

  // Priority 3: expression_preference
  if (
    item.learnHint === "expression_preference" ||
    item.fromRevisionDiff ||
    item.fromRevisionGuidance ||
    PREFERENCE_RE.test(clean) ||
    PREFERENCE_CUE_RE.test(clean)
  ) {
    return {
      learnKind: "expression_preference",
      logicalState: "active_low",
      write: true,
      resolverEligible: true,
      ownership: "subject_owned",
      sourceType:
        item.sourceType ||
        (item.fromRevisionDiff
          ? "revision_diff"
          : item.fromRevisionGuidance
            ? "revision_guidance"
            : "explicit_user_statement"),
      overlearnRisk: over.overlearnRisk,
      overlearnReasons: over.overlearnReasons,
    };
  }

  // Default: do not treat unknown body as preference
  return {
    learnKind: "expression_preference",
    logicalState: "session_only",
    write: false,
    resolverEligible: false,
    overlearnRisk: true,
    overlearnReasons: ["unknown_body_default_blocked"],
    rejectReason: "unclassified_body_not_preference",
    ownership: "ai_generated",
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

  // MVP-RELEASE-GATE-01E: revision guidance from generation attempt; baseline = superseded draft.
  let revisionGuidance = "";
  let baselineExcerpt = "";
  try {
    const attemptId = version.generationAttemptId;
    const attempt =
      attemptId && store.generationAttempts ? store.generationAttempts[String(attemptId)] : null;
    if (attempt && attempt.revisionGuidance) {
      revisionGuidance = String(attempt.revisionGuidance);
    }
  } catch {
    revisionGuidance = "";
  }
  try {
    const prevId = version.supersedesVersionId;
    if (prevId && store.versions && store.versions[String(prevId)]) {
      const prev = store.versions[String(prevId)];
      const prevArts = [];
      if (prev.artifactRef) prevArts.push(prev.artifactRef);
      if (Array.isArray(prev.artifactRefs)) prevArts.push(...prev.artifactRefs);
      baselineExcerpt = prevArts.map((a) => readTextArtifact(userData, a)).filter(Boolean).join("\n\n");
    }
  } catch {
    baselineExcerpt = "";
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
      baselineVersionId: version.supersedesVersionId || null,
      revisionGuidance: revisionGuidance || null,
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
        revisionGuidance: revisionGuidance || null,
        learningSource: "accepted_current_version",
      },
    },
    excerpt: truncate(textParts.join("\n\n"), 8000),
    baselineExcerpt: truncate(baselineExcerpt, 8000),
    revisionGuidance,
    title: (deliverable && deliverable.title) || version.title || "成果",
    kind: (deliverable && deliverable.kind) || "document",
    taskMaterialText,
    subjectEvidenceText,
  };
}

/**
 * Rule-based extract prioritized for accepted revisions (MVP-RELEASE-GATE-01E).
 * Priority: user revisionGuidance > final accepted body cues > baseline diff > model draft lines.
 * Never elevates the entire draft; episodic "accepted version X" is audit-only.
 * @param {object} args
 * @param {string} [args.evidenceCorpus]
 * @param {string} [args.revisionGuidance]
 * @param {string} [args.baselineExcerpt]
 */
function extractLearningItems(
  { title, kind, excerpt, source, evidenceCorpus, revisionGuidance, baselineExcerpt },
  callModel
) {
  const base = [];
  // Audit trail only — not a reusable preference or fact.
  base.push({
    id: "ex_episodic_1",
    layer: "semantic",
    text: `本人接受了「${title}」（${kind}）这一成果版本。`,
    confidence: "low",
    oneOffLikely: false,
    artifactOnly: true,
    learnHint: "artifact_history",
    learnKind: "artifact_history",
    sourceType: "accepted_version",
  });
  base.push({
    id: "ex_artifact_1",
    layer: "semantic",
    text: `成果证据：版本 ${source && source.deliverableVersionId}`,
    confidence: "high",
    oneOffLikely: false,
    artifactOnly: true,
    learnHint: "artifact_history",
    learnKind: "artifact_history",
    sourceType: "accepted_version",
  });

  const guidance = String(revisionGuidance || "").trim();
  const guidanceHash = guidance ? sha256Short(guidance) : null;
  if (guidance) {
    const gLines = guidance
      .split(/\n+|；|;/)
      .map((l) => l.replace(/^\s*\d+[\.、．)]\s*/, "").replace(/\s+/g, " ").trim())
      .filter((l) => l.length >= 2);
    let gi = 0;
    for (const line of gLines) {
      if (gi >= 8) break;
      if (isRevisionGuidanceHeader(line)) {
        base.push({
          id: "ex_rev_header_skip",
          layer: "semantic",
          text: line,
          confidence: "low",
          revisionHeader: true,
          skipLongTerm: true,
          fromRevisionGuidance: true,
          rejectReason: "revision_header_not_reusable",
          sourceRevisionGuidanceHash: guidanceHash,
        });
        continue;
      }
      // Prefer sentence splits only for long compound lines.
      const parts =
        line.length > 80 && /[。！？]/.test(line)
          ? line
              .split(/[。！？]/)
              .map((p) => p.trim())
              .filter((p) => p.length >= 4)
          : [line];
      for (const part of parts) {
        if (gi >= 8) break;
        if (isRevisionGuidanceHeader(part)) continue;
        const clean = part.trim();
        if (clean.length < 4 || clean.length > 200) continue;

        if (isBoundaryText(clean)) {
          gi += 1;
          base.push({
            id: "ex_rev_" + gi,
            layer: "semantic",
            text: truncate(`边界：${clean}`, 200),
            confidence: "high",
            oneOffLikely: false,
            fromRevisionGuidance: true,
            learnHint: "boundary",
            sourceType: "revision_guidance",
            sourceRevisionGuidanceHash: guidanceHash,
            canonicalStatement: clean,
          });
          continue;
        }

        if (isCurrentFactText(clean)) {
          gi += 1;
          base.push({
            id: "ex_rev_" + gi,
            layer: "semantic",
            text: truncate(`用户确认的修正：${clean}`, 200),
            confidence: "medium",
            oneOffLikely: false,
            fromRevisionGuidance: true,
            learnHint: "current_fact",
            sourceType: "project_fact_correction",
            sourceRevisionGuidanceHash: guidanceHash,
            canonicalStatement: clean,
          });
          continue;
        }

        const isPreference =
          PREFERENCE_CUE_RE.test(clean) ||
          PREFERENCE_RE.test(clean) ||
          /减少|增加|保留|精炼|连贯|平衡|直接|观点|冲突/.test(clean);
        if (!isPreference && clean.length < 8) continue;
        if (!isPreference) continue;

        gi += 1;
        base.push({
          id: "ex_rev_" + gi,
          layer: "semantic",
          text: truncate(`表达与成果偏好：${clean}`, 200),
          confidence: "medium",
          oneOffLikely: ONE_OFF_RE.test(clean),
          fromRevisionGuidance: true,
          learnHint: "expression_preference",
          sourceType: "revision_guidance",
          sourceRevisionGuidanceHash: guidanceHash,
          canonicalStatement: clean,
          preferenceKey: normalizePreferenceKey(clean),
        });
      }
    }
  }

  // Bounded diff cues — abstract only, never copy full titles/body.
  const finalText = String(excerpt || "");
  const baseText = String(baselineExcerpt || "");
  if (baseText && finalText && baseText !== finalText) {
    const baseTitle = (baseText.match(/^#\s+(.+)$/m) || [])[1] || "";
    const finalTitle = (finalText.match(/^#\s+(.+)$/m) || [])[1] || "";
    if (baseTitle && finalTitle && baseTitle !== finalTitle) {
      base.push({
        id: "ex_diff_title",
        layer: "semantic",
        text: "标题偏好：标题更有观点和冲突感，避免纯描述性标题。",
        confidence: "medium",
        oneOffLikely: false,
        fromRevisionDiff: true,
        learnHint: "expression_preference",
        sourceType: "revision_diff",
        canonicalStatement: "标题更有观点和冲突感",
        preferenceKey: normalizePreferenceKey("标题更有观点和冲突感"),
      });
    }
    const baseLen = baseText.replace(/\s+/g, "").length;
    const finalLen = finalText.replace(/\s+/g, "").length;
    if (baseLen > 80 && finalLen > 80) {
      const ratio = finalLen / baseLen;
      if (ratio < 0.75) {
        base.push({
          id: "ex_diff_len_short",
          layer: "semantic",
          text: "篇幅偏好：同类成果宜更精炼，避免过长铺垫。",
          confidence: "low",
          oneOffLikely: false,
          fromRevisionDiff: true,
          learnHint: "expression_preference",
          sourceType: "revision_diff",
          canonicalStatement: "开头减少铺垫，直接进入问题",
          preferenceKey: normalizePreferenceKey("开头减少铺垫直接进入问题"),
        });
      } else if (ratio > 1.35) {
        base.push({
          id: "ex_diff_len_long",
          layer: "semantic",
          text: "篇幅偏好：同类成果可保留更充分的事实与展开。",
          confidence: "low",
          oneOffLikely: false,
          fromRevisionDiff: true,
          learnHint: "expression_preference",
          sourceType: "revision_diff",
          preferenceKey: normalizePreferenceKey("篇幅保留充分展开"),
        });
      }
    }
    const baseOpening = baseText
      .split(/\n+/)
      .map((l) => l.trim())
      .find((l) => l && !/^#/.test(l));
    const finalOpening = finalText
      .split(/\n+/)
      .map((l) => l.trim())
      .find((l) => l && !/^#/.test(l));
    if (
      baseOpening &&
      finalOpening &&
      baseOpening.length > 40 &&
      finalOpening.length + 20 < baseOpening.length
    ) {
      base.push({
        id: "ex_diff_opening",
        layer: "semantic",
        text: "开篇偏好：开头减少铺垫，直接进入问题。",
        confidence: "medium",
        oneOffLikely: false,
        fromRevisionDiff: true,
        learnHint: "expression_preference",
        sourceType: "revision_diff",
        canonicalStatement: "开头减少铺垫，直接进入问题",
        preferenceKey: normalizePreferenceKey("开头减少铺垫直接进入问题"),
      });
    }
    const baseBullets = (baseText.match(/^\s*[-*•]\s+/gm) || []).length;
    const finalBullets = (finalText.match(/^\s*[-*•]\s+/gm) || []).length;
    if (baseBullets >= 4 && finalBullets <= Math.max(1, baseBullets - 3)) {
      base.push({
        id: "ex_diff_bullets",
        layer: "semantic",
        text: "结构偏好：减少机械分点，更多连贯叙述。",
        confidence: "medium",
        oneOffLikely: false,
        fromRevisionDiff: true,
        learnHint: "expression_preference",
        sourceType: "revision_diff",
        canonicalStatement: "减少机械分点，优先使用连贯叙述",
        preferenceKey: normalizePreferenceKey("减少机械分点"),
      });
    }
  }

  // Accepted body lines: audit / overlearn detection only — never long-term prefs.
  const lines = finalText
    .split(/\n+/)
    .map((l) => l.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
    .filter((l) => l.length >= 40 && l.length <= 400)
    .slice(0, 6);

  for (let i = 0; i < lines.length && i < 2; i += 1) {
    const line = lines[i];
    if (/^(#{1,6}|<!DOCTYPE|html|head|body|script)/i.test(line)) continue;
    base.push({
      id: "ex_sem_" + (i + 1),
      layer: "semantic",
      text: truncate(line, 200),
      confidence: "low",
      oneOffLikely: true,
      fromBodyHarvest: true,
      learnHint: "artifact_body",
      sourceType: "accepted_version",
    });
  }

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
  // Optional model call must not block: failures fall back to rule base.
  if (typeof callModel === "function") {
    return Promise.resolve()
      .then(() => callModel)
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
    if (inferred.write === false || inferred.writeTargetHint === "audit_only") {
      writeTarget = "audit_only";
    }
    if (inferred.writeTargetHint === "session_only_audit") writeTarget = "session_only_audit";
    if (inferred.learnKind === "boundary") writeTarget = "boundary_and_memory";
    if (inferred.learnKind === "current_fact" && inferred.write) writeTarget = "project_claims";
    const confidence =
      inferred.confidenceBoost ||
      item.confidence ||
      (inferred.learnKind === "boundary" ? "high" : "low");
    return {
      ...item,
      layer,
      writeTarget,
      sensitive,
      packageCategory: inferred.learnKind === "boundary" ? "boundary" : "memory",
      learnKind: inferred.learnKind,
      logicalState: inferred.logicalState,
      ownership: inferred.ownership || "subject_owned",
      rejectReason: inferred.rejectReason || null,
      factEvidence: inferred.factEvidence || null,
      resolverEligible:
        inferred.resolverEligible === true &&
        inferred.write !== false &&
        inferred.logicalState !== "session_only",
      overlearnRisk: !!inferred.overlearnRisk || !!item.overlearnRisk,
      overlearnReasons: inferred.overlearnReasons || item.overlearnReasons || [],
      sourceType: inferred.sourceType || item.sourceType || null,
      confidence,
    };
  });
}

function consolidate(classified) {
  const kept = [];
  const skipped = [];
  const seen = new Map(); // preferenceKey → kept index
  for (const item of classified || []) {
    if (item.rejectReason === "unverified_fact_no_evidence") {
      skipped.push({ ...item, action: "skip_unverified_fact" });
      continue;
    }
    if (item.rejectReason === "hypothetical_not_fact") {
      skipped.push({ ...item, action: "skip_hypothetical" });
      continue;
    }
    if (item.rejectReason === "revision_header_not_reusable") {
      skipped.push({ ...item, action: "skip_revision_header" });
      continue;
    }
    if (
      item.rejectReason === "artifact_body_overlearn_blocked" ||
      item.rejectReason === "unclassified_body_not_preference"
    ) {
      // Keep as session_only audit row (not resolver-eligible), do not elevate to preference.
      if (item.writeTarget === "session_only_audit") {
        kept.push({
          ...item,
          action: "append_session_only",
          learnKind: "artifact_history",
          logicalState: "session_only",
          resolverEligible: false,
          overlearnRisk: true,
        });
        continue;
      }
      skipped.push({
        ...item,
        action: "skip_overlearn",
        overlearnRisk: true,
      });
      continue;
    }
    if (item.logicalState === "session_only" && item.writeTarget === "audit_only") {
      skipped.push({ ...item, action: "skip_session_only" });
      continue;
    }
    if (item.writeTarget === "session_only_audit") {
      kept.push({
        ...item,
        action: "append_session_only",
        resolverEligible: false,
      });
      continue;
    }
    if (item.artifactOnly || item.writeTarget === "audit_only") {
      if (item.writeTarget === "session_only_audit" || item.learnKind === "artifact_history") {
        kept.push({
          ...item,
          action: "append_session_only",
          resolverEligible: false,
          logicalState: "session_only",
        });
        continue;
      }
      kept.push({ ...item, action: "audit_only", resolverEligible: false });
      continue;
    }
    if (item.oneOffLikely && !item.fromRevisionGuidance && !item.fromRevisionDiff) {
      skipped.push({ ...item, action: "skip_one_off" });
      continue;
    }

    const prefKey =
      item.preferenceKey ||
      (item.learnKind === "expression_preference" || item.learnKind === "boundary"
        ? normalizePreferenceKey(item.canonicalStatement || item.text)
        : null);
    const exactKey = String(item.text || "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .slice(0, 80);
    const mergeKey = prefKey || exactKey;

    if (seen.has(mergeKey)) {
      const idx = seen.get(mergeKey);
      const prev = kept[idx];
      const refs = Array.isArray(prev.sourceRefsAccum) ? prev.sourceRefsAccum.slice() : [];
      refs.push({
        id: item.id,
        sourceType: item.sourceType || null,
        text: item.text,
      });
      const canonical =
        prev.canonicalStatement ||
        item.canonicalStatement ||
        stripGuidancePrefix(prev.text);
      // Prefer shorter normalized preference wording from revision guidance.
      const preferGuidance =
        item.fromRevisionGuidance && !prev.fromRevisionGuidance
          ? item
          : prev.fromRevisionGuidance
            ? prev
            : String(item.canonicalStatement || item.text || "").length <
                String(prev.canonicalStatement || prev.text || "").length
              ? item
              : prev;
      kept[idx] = {
        ...prev,
        ...preferGuidance,
        id: prev.id,
        text: preferGuidance.text,
        canonicalStatement: preferGuidance.canonicalStatement || canonical,
        confidence:
          prev.confidence === "high" || item.confidence === "high"
            ? "high"
            : prev.confidence === "medium" || item.confidence === "medium"
              ? "medium"
              : prev.confidence,
        sourceRefsAccum: refs,
        action: "merge_duplicate_keep",
        lastConfirmedAt: learnStore.nowIso(),
        learnKind: prev.learnKind || preferGuidance.learnKind,
        resolverEligible: prev.resolverEligible !== false && preferGuidance.resolverEligible !== false,
      };
      skipped.push({ ...item, action: "merge_duplicate", mergedInto: prev.id });
      continue;
    }
    seen.set(mergeKey, kept.length);
    kept.push({
      ...item,
      action:
        item.layer === "episodic"
          ? "append_episodic"
          : item.learnKind === "boundary"
            ? "append_boundary"
            : item.learnKind === "current_fact"
              ? "append_fact"
              : "append_semantic",
      canonicalStatement: item.canonicalStatement || stripGuidancePrefix(item.text),
      sourceRefsAccum: [
        {
          id: item.id,
          sourceType: item.sourceType || null,
          text: item.text,
        },
      ],
      lastConfirmedAt: learnStore.nowIso(),
    });
  }
  return {
    kept,
    skipped,
    diff: {
      keptCount: kept.length,
      skippedCount: skipped.length,
      reasons: skipped.map((s) => ({
        id: s.id,
        action: s.action,
        rejectReason: s.rejectReason || null,
        overlearnRisk: !!s.overlearnRisk,
      })),
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
  const createdAt = learnStore.nowIso();
  const learnJobId = (source && (source.learnJobId || source.jobId)) || null;
  for (const item of kept) {
    if (item.action === "audit_only" || item.writeTarget === "audit_only") continue;
    if (item.action === "skip_one_off" || item.action === "merge_duplicate") continue;
    // current_fact → project claims path only (not expression memory)
    if (item.learnKind === "current_fact" || item.writeTarget === "project_claims") continue;
    // boundary rows still get a memory row for provenance/resolver; policies write is separate.
    const memoryType =
      item.layer === "procedural"
        ? "procedural"
        : item.layer === "semantic"
          ? "semantic"
          : "episodic";
    const logicalState = item.logicalState || "active_low";
    const activationState =
      item.learnKind === "boundary"
        ? "active"
        : logicalState === "judgment_candidate"
          ? "active_low_confidence"
          : logicalState === "session_only"
            ? "session_only"
            : "active_low_confidence";
    const sourceType =
      item.sourceType ||
      (item.fromRevisionDiff
        ? "revision_diff"
        : item.fromRevisionGuidance
          ? "revision_guidance"
          : item.learnKind === "boundary"
            ? "revision_guidance"
            : "accepted_version");
    const content =
      item.learnKind === "boundary"
        ? `边界：${item.canonicalStatement || stripGuidancePrefix(item.text)}`
        : item.canonicalStatement && item.learnKind === "expression_preference"
          ? `表达与成果偏好：${item.canonicalStatement}`
          : item.text;
    const status =
      logicalState === "session_only" || item.writeTarget === "session_only_audit"
        ? "session_only"
        : "active";
    const resolverEligible =
      item.resolverEligible === true &&
      status !== "session_only" &&
      !item.overlearnRisk &&
      item.learnKind !== "artifact_history";
    const sourceRefs = [
      "deliverable_auto_learn",
      `deliverableVersion:${source.deliverableVersionId}`,
      source.packageId ? `package:${source.packageId}` : null,
      source.taskId ? `task:${source.taskId}` : null,
      learnJobId ? `learnJob:${learnJobId}` : null,
    ].filter(Boolean);
    if (Array.isArray(item.sourceRefsAccum)) {
      for (const r of item.sourceRefsAccum) {
        if (r && r.id) sourceRefs.push(`extract:${r.id}`);
        if (r && r.sourceType) sourceRefs.push(`sourceType:${r.sourceType}`);
      }
    }
    ops.push({
      type: "append_jsonl",
      path: "memory/long-term-memory.jsonl",
      row: {
        type: memoryType,
        content,
        canonicalStatement: item.canonicalStatement || stripGuidancePrefix(content),
        theme: item.learnKind === "boundary" ? "使用边界" : "成果学习",
        confidence: item.confidence || "low",
        activationState,
        logicalState: item.learnKind === "boundary" ? "active" : logicalState,
        learnKind: item.learnKind || null,
        ownership: item.ownership || "subject_owned",
        status,
        usageCount: 0,
        reinforcement: 0,
        sensitivity: item.sensitive ? "sensitive" : "private",
        sourceRefs,
        sourceTaskId: source.taskId || null,
        sourceVersionId: source.deliverableVersionId || null,
        sourceLearnJobId: learnJobId,
        sourceType,
        sourceRevisionGuidanceHash: item.sourceRevisionGuidanceHash || null,
        createdAt,
        lastConfirmedAt: item.lastConfirmedAt || createdAt,
        revoked: false,
        resolverEligible,
        overlearnRisk: !!item.overlearnRisk,
        overlearnReasons: item.overlearnReasons || [],
        supersedes: item.supersedes || null,
        expiresAt: null,
        contextClassAtLearn: (source.provenance && source.provenance.contextClass) || null,
        learnProvenance: {
          taskId: source.taskId,
          planVersionId: source.planVersionId,
          packageId: source.packageId,
          deliverableId: source.deliverableId,
          deliverableVersionId: source.deliverableVersionId,
          learnJobId,
          contentHashes: source.contentHashes || [],
          acceptedAt: source.acceptedAt,
          factEvidence: item.factEvidence || null,
          sourceType,
        },
      },
    });
  }
  return ops;
}

function commitBoundaries(packageDir, kept, source) {
  if (!packageDir || !Array.isArray(kept)) return { ok: true, count: 0 };
  let count = 0;
  for (const item of kept) {
    if (!item || item.learnKind !== "boundary") continue;
    if (item.writeTarget === "audit_only") continue;
    const text = stripGuidancePrefix(item.canonicalStatement || item.text || "");
    if (!text) continue;
    try {
      const res = policies.addBoundary(packageDir, {
        text,
        scope: "never_speak_for_me",
        sourceRefs: [
          `deliverableVersion:${source.deliverableVersionId}`,
          source.taskId ? `task:${source.taskId}` : null,
          source.learnJobId ? `learnJob:${source.learnJobId}` : null,
          "deliverable_auto_learn",
        ].filter(Boolean),
      });
      if (res && res.ok) count += 1;
    } catch {
      /* ignore duplicate / write errors */
    }
  }
  return { ok: true, count };
}

function commitLearning(packageDir, kept, source) {
  const ops = buildOpsFromKept(kept, source);
  const boundaryResult = commitBoundaries(packageDir, kept, source);
  if (!ops.length) {
    return {
      ok: true,
      skipped: !boundaryResult.count,
      message: boundaryResult.count
        ? "已写入边界，无可追加的记忆行。"
        : "无可自动写入的学习项。",
      changeSetId: null,
      rollbackVersion: null,
      revision: null,
      boundariesWritten: boundaryResult.count || 0,
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
      source.learnJobId ? `learnJob:${source.learnJobId}` : null,
    ].filter(Boolean),
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
    boundariesWritten: boundaryResult.count || 0,
  };
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
    // Expression preferences stay in subject memory, not project claims.
    if (item.learnKind === "expression_preference") continue;
    if (item.learnKind === "boundary") continue;
    if (item.learnKind === "artifact_history") continue;
    const allowFact =
      item.learnKind === "current_fact" ||
      item.learnKind === "new_fact" ||
      /用户确认的修正|项目|路线|尚未|已经/.test(item.text || "");
    if (!allowFact) continue;
    const text = String(item.text || "").trim();
    if (!text || text.length < 16) continue;
    if (/本人接受了「/.test(text)) continue;
    if (/表达与成果偏好/.test(text) && !/Digital Me|项目/.test(text)) continue;

    const isCorrection =
      /用户确认的修正|纠正|尚未进入|不再/.test(text) || item.learnKind === "current_fact";
    const claimId = newClaimId();
    const claim = {
      claimId,
      projectId: PROJECT_IDS.DIGITAL_ME,
      claimText: text.replace(/^用户确认的修正：/, "").trim(),
      claimType: isCorrection || item.learnKind === "current_fact" || item.learnKind === "new_fact" ? "current_fact" : "proposal",
      sourceRefs: [
        `deliverableVersion:${source.deliverableVersionId}`,
        source.taskId ? `task:${source.taskId}` : null,
        source.learnJobId ? `learnJob:${source.learnJobId}` : null,
      ].filter(Boolean),
      authorityLevel: isCorrection ? "owner_confirmed" : "accepted_artifact",
      confirmationStatus: isCorrection ? "owner_confirmed" : "candidate",
      effectiveFrom: nowIso(),
      supersededBy: null,
      contradictedBy: null,
      scope: "digital_me_project",
      freshness: nowIso(),
      confidence: item.confidence || (isCorrection ? "high" : "low"),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      schemaVersion: 1,
      sourceDeliverableVersionId: source.deliverableVersionId,
      sourceTaskId: source.taskId || null,
      sourceLearnJobId: source.learnJobId || null,
      sourceVersionId: source.deliverableVersionId || null,
      learnCategory: isCorrection ? "accepted_revision_correction" : "project_knowledge_candidate",
    };
    projectKnowledgeStore.upsertClaim(packageDir, claim);

    if (isCorrection) {
      // Supersede older conflicting active claims with overlapping keywords.
      const existing = projectKnowledgeStore.getClaimsForProject(packageDir, PROJECT_IDS.DIGITAL_ME) || [];
      const keywords = claim.claimText
        .replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length >= 2)
        .slice(0, 6);
      for (const old of existing) {
        if (!old || old.claimId === claimId) continue;
        if (old.confirmationStatus === "rejected" || old.supersededBy) continue;
        const oldText = String(old.claimText || "");
        const overlap = keywords.filter((k) => oldText.includes(k)).length;
        if (overlap >= 2 && oldText !== claim.claimText) {
          projectKnowledgeStore.supersedeClaim(packageDir, old.claimId, claimId, {
            reason: "accepted_revision_correction",
            sourceRef: `deliverableVersion:${source.deliverableVersionId}`,
          });
        }
      }
    }
    count += 1;
  }
  return { ok: true, count };
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
      source: { ...job.source, ...collected.source, learnJobId: job.id, jobId: job.id },
    };

    const evidenceCorpus = buildFactEvidenceCorpus(collected);
    const extracted = await extractLearningItems(
      {
        title: collected.title,
        kind: collected.kind,
        excerpt: collected.excerpt,
        source: job.source,
        evidenceCorpus,
        revisionGuidance: collected.revisionGuidance || (job.source && job.source.revisionGuidance) || "",
        baselineExcerpt: collected.baselineExcerpt || "",
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
    let pkResult = { ok: true, count: 0 };
    if (commitResult.ok) {
      pkResult = commitProjectKnowledgeCandidates(packageDir, consolidated.kept, {
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

  // Never learn from a rejected version (safety if called incorrectly).
  if (collected.version && collected.version.reviewStatus === "rejected") {
    return {
      ok: false,
      code: "rejected_version_not_learned",
      message: "已否定的成果不会写入长期学习。",
      acceptPreserved: true,
    };
  }

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

/**
 * On reject: revoke memories/claims sourced from this version; do not treat as satisfaction sample.
 * Uses existing status/confirmationStatus fields — no new Store.
 */
function suppressRejectedVersion(userData, versionId, packageDir) {
  const vid = String(versionId || "");
  if (!vid) return { ok: false, code: "version_required" };
  const result = { ok: true, memoryRevoked: 0, claimsRejected: 0 };

  if (packageDir) {
    try {
      const memPath = path.join(packageDir, "memory", "long-term-memory.jsonl");
      if (fs.existsSync(memPath)) {
        const lines = fs.readFileSync(memPath, "utf8").split(/\n/);
        let changed = false;
        const next = lines.map((line) => {
          if (!line.trim()) return line;
          let row;
          try {
            row = JSON.parse(line);
          } catch {
            return line;
          }
          const lp = row && row.learnProvenance;
          const refs = (row && row.sourceRefs) || [];
          const hit =
            String(row.sourceVersionId || "") === vid ||
            (lp && String(lp.deliverableVersionId) === vid) ||
            refs.some((r) => String(r) === `deliverableVersion:${vid}`);
          if (!hit) return line;
          if (row.status === "revoked" || row.status === "deprecated" || row.revoked) return line;
          changed = true;
          result.memoryRevoked += 1;
          return JSON.stringify({
            ...row,
            status: "revoked",
            revoked: true,
            activationState: "revoked",
            logicalState: "session_only",
            resolverEligible: false,
            revokedReason: "deliverable_version_rejected",
            updatedAt: learnStore.nowIso(),
          });
        });
        if (changed) fs.writeFileSync(memPath, next.join("\n"), "utf8");
      }
    } catch (err) {
      result.memoryError = err && err.message;
    }

    try {
      const claims = projectKnowledgeStore.listAllClaims
        ? projectKnowledgeStore.listAllClaims(packageDir)
        : projectKnowledgeStore.getClaimsForProject(packageDir, PROJECT_IDS.DIGITAL_ME);
      for (const c of claims || []) {
        if (!c) continue;
        const fromVersion =
          String(c.sourceDeliverableVersionId || "") === vid ||
          (Array.isArray(c.sourceRefs) &&
            c.sourceRefs.some((r) => String(r) === `deliverableVersion:${vid}`));
        if (!fromVersion) continue;
        if (c.confirmationStatus === "rejected") continue;
        projectKnowledgeStore.revokeClaim(packageDir, c.claimId, {
          reason: "deliverable_version_rejected",
        });
        result.claimsRejected += 1;
      }
    } catch (err) {
      result.claimError = err && err.message;
    }
  }

  return result;
}

module.exports = {
  collectSourceFromVersion,
  extractLearningItems,
  classifyItems,
  consolidate,
  detectConflict,
  commitLearning,
  commitProjectKnowledgeCandidates,
  commitBoundaries,
  enqueueAfterAccept,
  runLearnJob,
  resolveConflict,
  retryJob,
  suppressRejectedVersion,
  getJobByVersionId,
  JOB_STATUS,
  buildFactEvidenceCorpus,
  textSupportedByEvidence,
  inferLearnKind,
  assessOverlearnRisk,
  isBoundaryText,
  isCurrentFactText,
  isRevisionGuidanceHeader,
  normalizePreferenceKey,
  stripGuidancePrefix,
  buildOpsFromKept,
};
