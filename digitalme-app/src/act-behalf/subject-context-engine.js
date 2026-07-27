"use strict";

/**
 * CRT-MVP-02 Subject Context Engine — thin policy layer.
 * Classify task context → assembly policy → evidence/ownership tagging.
 * Does not read Package directly; Assembler remains the retrieval authority.
 */

const crypto = require("node:crypto");

const CONTEXT_CLASSES = Object.freeze([
  "representation",
  "decision_support",
  "exploration",
  "creation",
  "execution",
]);

/** Explicit-signal conflict priority (highest first). Default fallthrough = execution. */
const CLASS_PRIORITY = Object.freeze([
  "decision_support",
  "representation",
  "exploration",
  "creation",
  "execution",
]);

const EVIDENCE_KINDS = Object.freeze([
  "subject_fact",
  "subject_judgment",
  "ai_inference",
  "ai_exploration",
  "task_material",
]);

const OWNERSHIPS = Object.freeze([
  "subject_owned",
  "task_owned",
  "external_owned",
  "ai_generated",
]);

function sha256Text(text) {
  return "sha256:" + crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function blobOf(taskContext) {
  const t = taskContext || {};
  return [
    t.goal,
    t.audience,
    t.usage,
    t.constraints,
    t.deliverableKind,
    t.deliverableTitle || t.title,
    t.deliverablePurpose || t.purpose,
  ]
    .map((x) => String(x || ""))
    .join("\n");
}

function classifyTaskContext(taskContext) {
  const raw = blobOf(taskContext);
  const text = raw.toLowerCase();
  const signals = [];
  const scores = {
    representation: 0,
    decision_support: 0,
    exploration: 0,
    creation: 0,
    execution: 0,
  };

  const hit = (re, className, signal, weight) => {
    if (re.test(raw) || re.test(text)) {
      scores[className] += weight;
      if (!signals.includes(signal)) signals.push(signal);
      return true;
    }
    return false;
  };

  hit(/投资人|对外|官网|简介|介绍材料|答辩|路演|宣传/, "representation", "goal:representation", 3);
  hit(/投资人|对外|公众|客户/, "representation", "audience:external", 2);
  hit(/对外发布|对外介绍|公开介绍/, "representation", "usage:external", 2);

  hit(/对比|是否该|该不该|取舍|权衡|风险|决策|方案选择|怎么选/, "decision_support", "goal:decision", 4);
  hit(/建议选|优先考虑哪/, "decision_support", "goal:decision_soft", 2);

  hit(/探索|假设|可能性|推演|如果|商业模式|未来场景|开放讨论/, "exploration", "goal:exploration", 4);
  hit(/what if|hypothesis/i, "exploration", "goal:exploration_en", 2);

  hit(/创作|文案|叙事风格|润色表达|创意写作/, "creation", "goal:creation", 3);

  hit(/执行|按计划|完成清单|落地产出|照目标完成/, "execution", "goal:execution", 3);

  const ranked = CLASS_PRIORITY.map((c) => ({ c, s: scores[c] }));
  const anySignal = ranked.some((r) => r.s > 0);

  let contextClass = "execution";
  let confidence = "low";
  if (!anySignal) {
    signals.push("default:execution");
    contextClass = "execution";
    confidence = "low";
  } else {
    const topScore = Math.max(...ranked.map((r) => r.s));
    const tied = CLASS_PRIORITY.filter((c) => scores[c] === topScore);
    contextClass = tied[0];
    confidence = topScore >= 4 ? "high" : topScore >= 2 ? "medium" : "low";
  }

  return {
    schemaVersion: 1,
    contextClass,
    confidence,
    signals,
    scores,
  };
}

function resolveAssemblyPolicy(classification) {
  const contextClass = (classification && classification.contextClass) || "execution";
  const base = {
    contextClass,
    enabledLayers: ["identity", "knowledge", "experience", "memory", "preference"],
    priorityLayers: ["identity", "knowledge"],
    layerTopK: {
      identity: 12,
      preference: 6,
      knowledge: 10,
      experience: 8,
      judgment: 0,
      skill: 0,
      memory: 8,
      artifactHistory: 0,
    },
    forbidExplorationAsSubject: true,
    allowAiExplorationBlock: false,
    maxSubjectChars: 8000,
    sensitivity: "normal",
    includeTaskMaterials: true,
    allowJudgmentCandidateSoft: false,
  };

  const byClass = {
    representation: {
      enabledLayers: ["identity", "experience", "preference", "knowledge", "memory"],
      priorityLayers: ["identity", "experience", "preference"],
      layerTopK: {
        identity: 12,
        preference: 8,
        knowledge: 8,
        experience: 10,
        judgment: 0,
        skill: 0,
        memory: 4,
        artifactHistory: 0,
      },
      allowAiExplorationBlock: false,
      sensitivity: "strict",
      maxSubjectChars: 7000,
    },
    decision_support: {
      enabledLayers: ["judgment", "experience", "knowledge", "preference", "identity", "memory"],
      priorityLayers: ["judgment", "experience", "knowledge"],
      layerTopK: {
        identity: 6,
        preference: 6,
        knowledge: 10,
        experience: 10,
        judgment: 6,
        skill: 0,
        memory: 8,
        artifactHistory: 0,
      },
      allowAiExplorationBlock: true,
      allowJudgmentCandidateSoft: true,
      maxSubjectChars: 8000,
    },
    exploration: {
      enabledLayers: ["identity", "knowledge", "judgment", "memory", "preference"],
      priorityLayers: ["knowledge", "identity"],
      layerTopK: {
        identity: 4,
        preference: 4,
        knowledge: 8,
        experience: 4,
        judgment: 4,
        skill: 0,
        memory: 4,
        artifactHistory: 0,
      },
      allowAiExplorationBlock: true,
      allowJudgmentCandidateSoft: true,
      maxSubjectChars: 6000,
    },
    creation: {
      enabledLayers: ["preference", "identity", "experience", "memory"],
      priorityLayers: ["preference", "identity"],
      layerTopK: {
        identity: 8,
        preference: 10,
        knowledge: 4,
        experience: 6,
        judgment: 0,
        skill: 0,
        memory: 4,
        artifactHistory: 0,
      },
      allowAiExplorationBlock: true,
      maxSubjectChars: 7000,
    },
    execution: {
      enabledLayers: ["knowledge", "memory", "preference", "identity"],
      priorityLayers: ["knowledge", "memory"],
      layerTopK: {
        identity: 4,
        preference: 4,
        knowledge: 8,
        experience: 4,
        judgment: 0,
        skill: 0,
        memory: 6,
        artifactHistory: 0,
      },
      allowAiExplorationBlock: false,
      sensitivity: "normal",
      maxSubjectChars: 6000,
    },
  };

  return {
    ...base,
    ...(byClass[contextClass] || byClass.execution),
    contextClass,
  };
}

function assemblyPolicyDigest(policy) {
  const p = policy || {};
  return sha256Text(
    JSON.stringify({
      contextClass: p.contextClass,
      enabledLayers: p.enabledLayers,
      layerTopK: p.layerTopK,
      allowAiExplorationBlock: !!p.allowAiExplorationBlock,
      maxSubjectChars: p.maxSubjectChars,
      sensitivity: p.sensitivity,
    })
  );
}

function mapAssetEvidenceOwnership(asset) {
  const learnKind = String((asset && asset.learnKind) || "");
  const logicalState = String((asset && asset.logicalState) || asset.activationState || "");
  const isCandidate =
    logicalState === "judgment_candidate" ||
    learnKind === "new_judgment" ||
    learnKind === "decision_pattern";

  if (isCandidate) {
    return {
      evidenceKind: "subject_judgment",
      ownership: "subject_owned",
      logicalState: "judgment_candidate",
      hardJudgment: false,
    };
  }

  const layer = String((asset && asset.layer) || "");
  if (layer === "identity" || layer === "knowledge" || layer === "experience") {
    return {
      evidenceKind: "subject_fact",
      ownership: "subject_owned",
      logicalState: logicalState === "active_low_confidence" ? "active_low" : "active",
      hardJudgment: false,
    };
  }
  if (layer === "judgment") {
    return {
      evidenceKind: "subject_judgment",
      ownership: "subject_owned",
      logicalState: "active",
      hardJudgment: true,
    };
  }
  if (layer === "preference") {
    const asJudgmentPref = /优先|取舍|应该|不要|禁忌/.test(String((asset && asset.statement) || ""));
    return {
      evidenceKind: asJudgmentPref ? "subject_judgment" : "subject_fact",
      ownership: "subject_owned",
      logicalState: learnKind === "expression_preference" ? "active_low" : "active",
      hardJudgment: false,
    };
  }
  if (layer === "memory") {
    if (learnKind === "expression_preference") {
      return {
        evidenceKind: "subject_fact",
        ownership: "subject_owned",
        logicalState: "active_low",
        hardJudgment: false,
      };
    }
    if (learnKind === "new_fact") {
      return {
        evidenceKind: "subject_fact",
        ownership: "subject_owned",
        logicalState: "active_low",
        hardJudgment: false,
      };
    }
    return {
      evidenceKind: "subject_fact",
      ownership: "subject_owned",
      logicalState: logicalState === "session_only" ? "session_only" : "active_low",
      hardJudgment: false,
    };
  }
  return {
    evidenceKind: "subject_fact",
    ownership: "subject_owned",
    logicalState: "active_low",
    hardJudgment: false,
  };
}

function tagAttachmentRefs(attachmentRefs) {
  return (Array.isArray(attachmentRefs) ? attachmentRefs : []).map((r) => ({
    ...r,
    evidenceKind: "task_material",
    ownership: "task_owned",
    logicalState: null,
  }));
}

function summarizeEvidence(refs, attachmentRefs, policy) {
  const all = []
    .concat(Array.isArray(refs) ? refs : [])
    .concat(Array.isArray(attachmentRefs) ? attachmentRefs : []);
  let subjectFactCount = 0;
  let subjectJudgmentCount = 0;
  let judgmentCandidateCount = 0;
  let taskMaterialCount = 0;
  for (const r of all) {
    if (!r) continue;
    if (r.logicalState === "judgment_candidate") judgmentCandidateCount += 1;
    else if (r.evidenceKind === "subject_judgment") subjectJudgmentCount += 1;
    if (r.evidenceKind === "subject_fact") subjectFactCount += 1;
    if (r.evidenceKind === "task_material") taskMaterialCount += 1;
  }
  return {
    subjectFactCount,
    subjectJudgmentCount,
    judgmentCandidateCount,
    taskMaterialCount,
    aiBlockEnabled: !!(policy && policy.allowAiExplorationBlock),
  };
}

function summarizeOwnership(refs, attachmentRefs) {
  const all = []
    .concat(Array.isArray(refs) ? refs : [])
    .concat(Array.isArray(attachmentRefs) ? attachmentRefs : []);
  const counts = {
    subjectOwnedCount: 0,
    taskOwnedCount: 0,
    externalOwnedCount: 0,
    aiGeneratedCount: 0,
  };
  for (const r of all) {
    if (!r) continue;
    if (r.ownership === "subject_owned") counts.subjectOwnedCount += 1;
    else if (r.ownership === "task_owned") counts.taskOwnedCount += 1;
    else if (r.ownership === "external_owned") counts.externalOwnedCount += 1;
    else if (r.ownership === "ai_generated") counts.aiGeneratedCount += 1;
  }
  return counts;
}

function renderBoundedSubjectText(assembly, taggedRefs, policy) {
  const included = (taggedRefs || []).filter((r) => r && r.included !== false);
  const facts = included.filter(
    (r) => r.evidenceKind === "subject_fact" && r.logicalState !== "judgment_candidate"
  );
  const hardJudgments = included.filter((r) => r.hardJudgment === true);
  const softJudgments = included.filter((r) => r.logicalState === "judgment_candidate");
  const prefs = included.filter(
    (r) => r.layer === "preference" || r.learnKind === "expression_preference"
  );

  const linesFrom = (list) => {
    const out = [];
    const layersObj = (assembly && assembly.layers) || {};
    for (const r of list) {
      let stmt = r.statement || "";
      if (!stmt && layersObj[r.layer]) {
        const hitLayer = layersObj[r.layer].find((a) => a.assetId === r.assetId);
        if (hitLayer) stmt = hitLayer.statement || "";
      }
      if (stmt) out.push(`- ${stmt}`);
    }
    return out;
  };

  const parts = [];
  const factLines = linesFrom(facts);
  if (factLines.length) {
    parts.push("【已确认主体事实 · subject_fact / subject_owned】");
    parts.push(...factLines);
  }
  if (hardJudgments.length) {
    parts.push("【本人判断框架（须遵守）· subject_judgment / Active】");
    parts.push(...linesFrom(hardJudgments));
  }
  if (softJudgments.length && policy && policy.allowJudgmentCandidateSoft) {
    parts.push("【待确认的取舍线索 · Judgment Candidate（非 Active，不可硬约束）】");
    parts.push(...linesFrom(softJudgments));
  }
  const softIds = new Set(softJudgments.map((s) => s.assetId));
  const factIds = new Set(facts.map((f) => f.assetId));
  const prefLines = linesFrom(prefs.filter((p) => !softIds.has(p.assetId) && !factIds.has(p.assetId)));
  if (prefLines.length) {
    parts.push("【表达偏好 · 低权】");
    parts.push(...prefLines);
  }
  if (!parts.length && assembly && assembly.renderedText) {
    return String(assembly.renderedText);
  }
  return parts.join("\n").trim();
}

/**
 * Finalize assembly with evidence/ownership tags and context metadata.
 */
function finalizeSubjectAssembly(assembly, opts) {
  const classification = (opts && opts.classification) || null;
  const policy = (opts && opts.policy) || resolveAssemblyPolicy(classification || {});
  const attachmentRefs = tagAttachmentRefs((opts && opts.attachmentRefs) || []);
  const allowSoft = !!(policy && policy.allowJudgmentCandidateSoft);

  const base = assembly && typeof assembly === "object" ? { ...assembly } : {};
  const refsIn = Array.isArray(base.refs) ? base.refs : [];
  const taggedRefs = [];
  const skippedByContext = [];

  for (const ref of refsIn) {
    const meta = mapAssetEvidenceOwnership(ref);
    if (meta.logicalState === "judgment_candidate" && !allowSoft && !meta.hardJudgment) {
      skippedByContext.push({
        assetId: ref.assetId,
        reason: "judgment_candidate_not_hard",
        layer: ref.layer,
      });
      taggedRefs.push({
        ...ref,
        ...meta,
        included: false,
        hardJudgment: false,
      });
      continue;
    }
    taggedRefs.push({
      ...ref,
      evidenceKind: meta.evidenceKind,
      ownership: meta.ownership,
      logicalState: meta.logicalState,
      hardJudgment: !!meta.hardJudgment,
      included: ref.included !== false,
    });
  }

  const renderedText = renderBoundedSubjectText(base, taggedRefs, policy);
  const policyMeta = {
    ...(base.policy || {}),
    contextClass: policy.contextClass,
    skippedByContext: skippedByContext.slice(0, 40),
    excludedSample: [
      ...((base.policy && base.policy.excludedSample) || []),
      ...skippedByContext,
    ].slice(0, 40),
  };

  return {
    ...base,
    contextClass: policy.contextClass,
    contextClassification: classification
      ? {
          contextClass: classification.contextClass,
          confidence: classification.confidence,
          signals: classification.signals || [],
        }
      : null,
    assemblyPolicyDigest: assemblyPolicyDigest(policy),
    assemblyPolicy: {
      enabledLayers: policy.enabledLayers,
      allowAiExplorationBlock: !!policy.allowAiExplorationBlock,
      sensitivity: policy.sensitivity,
      includeTaskMaterials: !!policy.includeTaskMaterials,
    },
    renderedText,
    refs: taggedRefs,
    attachmentRefs,
    evidenceSummary: summarizeEvidence(
      taggedRefs.filter((r) => r.included !== false),
      attachmentRefs,
      policy
    ),
    ownershipSummary: summarizeOwnership(
      taggedRefs.filter((r) => r.included !== false),
      attachmentRefs
    ),
    policy: policyMeta,
  };
}

function promptGuidanceForClass(contextClass, policy) {
  const c = contextClass || "execution";
  const allowExplore = !!(policy && policy.allowAiExplorationBlock);
  const posture =
    "主张姿态（Claim Posture）：confirmed=已确认事实/已确认判断（须有 subject_owned 或 task_material 明确证据）；" +
    "attributed=来自本次材料/外部资料（可引用，不自动代表本人终身事实）；" +
    "inferred=AI 分析推断（用「分析认为/可能/意味着」）；" +
    "hypothetical=开放假设/方案（用「可考虑/假设/可能/待验证」）。" +
    "没有来源的内容不得写成 confirmed，但允许作为 inferred 或 hypothetical。不要追求「每句话必须有出处」。";

  const byClass = {
    representation:
      "情境=代表表达。confirmed/attributed 可用；inferred 少量且标明分析；hypothetical 仅作建议/待验证，不能写成现状。" +
      "禁止无依据内容以 confirmed 方式描述团队、融资、用户量、收入、客户、已实现能力与里程碑。" +
      "缺事实时写「尚未提供 / 待确认」，不得补造为已发生事实。" +
      posture,
    decision_support:
      "情境=辅助决策。confirmed 作锚点；inferred 与 hypothetical 均允许。" +
      "AI 建议必须标明为建议，不得冒充本人既有判断。Judgment Candidate 仅作低权线索。" +
      posture,
    exploration:
      "情境=开放探索。以 inferred / hypothetical 为主要输出；事实只作锚点。" +
      "不要求字字来自记忆；允许大胆提出 memory 中不存在的新方案，但不得把假设写回 subject_fact / confirmed。" +
      posture,
    creation:
      "情境=创作生成。创意表达自由（多为 ai_generated / hypothetical 语气）。" +
      "不得创造 Owner 的身份事实与项目经营事实。" +
      posture,
    execution:
      "情境=保守执行。按目标与约束完成，可做必要推理（inferred）。" +
      "不主动创造代表 Owner 的事实或长期立场。" +
      posture,
  };

  let extra = byClass[c] || byClass.execution;
  if (allowExplore && c !== "representation") {
    extra += "允许单独给出「本次分析/推演」段落，并标明非本人既有结论。";
  } else if (c === "representation") {
    extra += "禁止把开放探索伪装成已确认主体观点。";
  }
  return extra;
}

const FABRICATED_FACT_PATTERNS = Object.freeze([
  {
    id: "team",
    re: /(?:联合创始人|CTO|CPO|团队成员|核心团队|核心成员).{0,16}(?:涵盖|加入|负责|带领|包括)|(?:我们有|现有|已有)\s*\d+\s*名?(?:工程师|成员|员工)/,
  },
  {
    id: "funding",
    re: /(?:融资|获得)\s*[\d.,]+\s*(?:万|亿|million|billion)|(?:天使轮|A轮|B轮).{0,8}(?:融资|完成)|(?:1|一)\s*个月(?:内)?完成融资/i,
  },
  {
    id: "users",
    re: /(?:DAU|MAU|日活|月活|用户量|注册用户)\s*[\d.,]+万?|(?:已拥有|已有)\s*\d+\s*名?(?:用户|客户|成员)|\d+\s*万\+?\s*用户/i,
  },
  { id: "revenue", re: /(?:年收入|营收|ARR|MRR)\s*[\d.,]+|收入达到\s*[\d.,]+/i },
  {
    id: "customers",
    re: /(?:签约客户|标杆客户|付费客户).{0,20}(?:包括|有)|已服务\s*\d+\s*家/,
  },
  {
    id: "milestone",
    re: /已完成(?:融资|上线|认证)|获得(?:ISO|专利|牌照)认证|\d+\s*个月盈亏平衡|已有白皮书/,
  },
  { id: "nps", re: /NPS\s*[≥>=]?\s*\d+/i },
  {
    id: "capability_done",
    re: /已具备(?:联邦学习|TEE|本地推理)|现成技术能力[^。]{0,20}(?:联邦学习|TEE)/,
  },
]);

const HEDGE_RE =
  /可考虑|假设|建议|待验证|可能方案|规划目标|试点|探索|未来可|初步按|不妨|一种情景|若将来|可作为未来/;

function isHedgedClaim(text, matchIndex, matchLength) {
  const body = String(text || "");
  const start = Math.max(0, matchIndex - 40);
  const end = Math.min(body.length, matchIndex + matchLength + 40);
  return HEDGE_RE.test(body.slice(start, end));
}

function findUnsupportedFabricatedFacts(text, evidenceCorpus) {
  const body = String(text || "");
  const corpus = String(evidenceCorpus || "");
  const hits = [];
  for (const p of FABRICATED_FACT_PATTERNS) {
    const re = new RegExp(p.re.source, p.re.flags.includes("g") ? p.re.flags : p.re.flags + "g");
    let m;
    while ((m = re.exec(body)) !== null) {
      const snippet = m[0];
      if (isHedgedClaim(body, m.index, snippet.length)) continue;
      const key = snippet.replace(/\s+/g, "").slice(0, 24);
      const corpusKey = corpus.replace(/\s+/g, "");
      if (key && corpusKey.includes(key)) continue;
      if (corpus.includes(snippet)) continue;
      hits.push({ id: p.id, snippet });
      break;
    }
  }
  return hits;
}

function assertRepresentationFactsGrounded(text, evidenceCorpus, contextClass) {
  if (contextClass !== "representation") return true;
  const hits = findUnsupportedFabricatedFacts(text, evidenceCorpus);
  if (!hits.length) return true;
  const e = new Error(
    "代表表达模式下出现无来源的高风险事实断言（团队/融资/用户/收入/客户/里程碑等），未保存为成果。若为假设或建议，请使用「可考虑/假设/待验证」等表述。"
  );
  e.code = "ungrounded_representation_facts";
  e.hits = hits;
  throw e;
}

function isExplorationHedged(text) {
  return HEDGE_RE.test(String(text || ""));
}

const CLAIM_POSTURES = Object.freeze([
  "confirmed",
  "attributed",
  "inferred",
  "hypothetical",
]);

module.exports = {
  CONTEXT_CLASSES,
  CLASS_PRIORITY,
  EVIDENCE_KINDS,
  OWNERSHIPS,
  classifyTaskContext,
  resolveAssemblyPolicy,
  assemblyPolicyDigest,
  mapAssetEvidenceOwnership,
  tagAttachmentRefs,
  finalizeSubjectAssembly,
  promptGuidanceForClass,
  findUnsupportedFabricatedFacts,
  assertRepresentationFactsGrounded,
  isExplorationHedged,
  isHedgedClaim,
  sha256Text,
  FABRICATED_FACT_PATTERNS,
  CLAIM_POSTURES,
  HEDGE_RE,
};
