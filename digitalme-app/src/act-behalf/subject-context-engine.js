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
  "project_document_generation",
]);

/** Explicit-signal conflict priority (highest first). Default fallthrough = execution. */
const CLASS_PRIORITY = Object.freeze([
  "project_document_generation",
  "decision_support",
  "representation",
  "exploration",
  "creation",
  "execution",
]);

const DIGITAL_ME_PROJECT_RE =
  /digital\s*me|数字之我|digitalme/i;

const PROJECT_DOC_GOAL_RE =
  /开发计划|计划书|需求文档|技术设计|时间表|roadmap|里程碑|项目规划|起草.*计划/i;

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

function isDigitalMeProjectContext(taskContext) {
  const raw = blobOf(taskContext);
  return DIGITAL_ME_PROJECT_RE.test(raw);
}

function classifyTaskContext(taskContext) {
  const raw = blobOf(taskContext);
  const text = raw.toLowerCase();
  const goalOnly = String(
    (taskContext && taskContext.goal) || (taskContext && taskContext.title) || ""
  );
  const signals = [];
  const scores = {
    representation: 0,
    decision_support: 0,
    exploration: 0,
    creation: 0,
    execution: 0,
    project_document_generation: 0,
  };

  const hit = (re, className, signal, weight) => {
    if (re.test(raw) || re.test(text)) {
      scores[className] += weight;
      if (!signals.includes(signal)) signals.push(signal);
      return true;
    }
    return false;
  };

  // LEARN-LOOP-FIX-01: project plan/docs — goal-driven, not purpose-template keywords like 风险管理.
  if (DIGITAL_ME_PROJECT_RE.test(goalOnly) && PROJECT_DOC_GOAL_RE.test(goalOnly)) {
    scores.project_document_generation += 8;
    signals.push("goal:project_document");
  } else if (DIGITAL_ME_PROJECT_RE.test(raw) && PROJECT_DOC_GOAL_RE.test(raw)) {
    scores.project_document_generation += 6;
    signals.push("goal:project_document_soft");
  }

  hit(/投资人|对外|官网|简介|介绍材料|答辩|路演|宣传/, "representation", "goal:representation", 3);
  hit(/投资人|对外|公众|客户/, "representation", "audience:external", 2);
  hit(/对外发布|对外介绍|公开介绍/, "representation", "usage:external", 2);

  // Decision signals from goal/title only — avoid purpose template bleed (e.g. 风险管理 in deliverable purpose).
  const decisionBlob = [
    taskContext && taskContext.goal,
    taskContext && taskContext.audience,
    taskContext && taskContext.usage,
    taskContext && taskContext.constraints,
    taskContext && taskContext.deliverableTitle,
  ]
    .map((x) => String(x || ""))
    .join("\n");
  const decisionHit = (re, signal, weight) => {
    if (re.test(decisionBlob)) {
      scores.decision_support += weight;
      if (!signals.includes(signal)) signals.push(signal);
      return true;
    }
    return false;
  };
  decisionHit(/对比|是否该|该不该|取舍|权衡|方案选择|怎么选/, "goal:decision", 4);
  decisionHit(/建议选|优先考虑哪/, "goal:decision_soft", 2);

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
    project_document_generation: {
      enabledLayers: ["identity", "knowledge", "experience", "memory"],
      priorityLayers: ["knowledge", "identity"],
      layerTopK: {
        identity: 6,
        preference: 4,
        knowledge: 12,
        experience: 4,
        judgment: 0,
        skill: 0,
        memory: 4,
        artifactHistory: 0,
      },
      allowAiExplorationBlock: false,
      allowJudgmentCandidateSoft: false,
      sensitivity: "strict",
      maxSubjectChars: 9000,
      requireProjectContext: true,
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

const CLAIM_POSTURE_PRESENTATIONS = Object.freeze(["natural", "annotated_review"]);
const DEFAULT_CLAIM_POSTURE_PRESENTATION = "natural";

const DIGITAL_ME_CORE_ANCHOR =
  "Digital Me 核心定义（必须保持，不得改写为其他品类）：个人数字主体层；主体性；用户所有；本地优先；平台中立；可迁移、可授权、可持续增强。" +
  "DID / 联邦学习 / 区块链等仅可作为待评估技术选项（hypothetical），不得未经依据重定义为区块链身份平台、DID/VC 产品、IPFS/跨链项目，或普通数字孪生/数据管理平台。";

function claimPosturePresentationMode(opts) {
  const raw =
    (opts && opts.claimPosturePresentation) ||
    (opts && opts.policy && opts.policy.claimPosturePresentation) ||
    DEFAULT_CLAIM_POSTURE_PRESENTATION;
  return CLAIM_POSTURE_PRESENTATIONS.includes(raw) ? raw : DEFAULT_CLAIM_POSTURE_PRESENTATION;
}

const PROJECT_COMPLETION_BOUNDARY =
  "项目文档补全边界：团队人数、预算、时间表、融资额、具体技术选型、商业模式、监管方案——若权威材料未给出，" +
  "必须写「待 Owner 决定」「需要进一步估算」或「建议：…」，禁止写成已确认事实。" +
  "禁止无来源写出：6–8 人团队、300–500 万元预算、15 个月开发周期、稳定币钱包、UBC 代币分配等。";

function promptGuidanceForClass(contextClass, policy, opts) {
  const c = contextClass || "execution";
  const isDigitalMeProject = !!(opts && opts.isDigitalMeProject);
  const allowExplore = !!(policy && policy.allowAiExplorationBlock);
  const presentation = claimPosturePresentationMode({ ...opts, policy });
  const natural =
    presentation === "natural"
      ? "正式成果用自然语言表达边界（如「目前尚未确认」「未来可考虑」「一种待验证的方案是」「根据本次材料」「从现有信息推断」）。" +
        "禁止在正文写入方括号元标签，例如 [已确认]、[规划目标]、[分析认为]、[AI建议/待验证]、[假设待验证]。" +
        "主张姿态仅作内部治理；不要每句机械附标签。"
      : "审阅标注模式：可用简短姿态提示，但仍避免密集方括号标签。";

  const posture =
    "内部主张姿态：confirmed=已确认事实/判断（须有 subject_owned 或 task_material 证据）；" +
    "attributed=来自本次材料/外部资料且必须有真实来源引用；" +
    "inferred=AI 分析推断；hypothetical=开放假设。" +
    "没有来源不得写成 confirmed 或 attributed，但允许 inferred / hypothetical。" +
    "禁止伪造「根据公开报告 / 数据显示 / 研究表明」等无来源套话。" +
    natural;

  const byClass = {
    representation:
      "情境=代表表达。可用已确认信息与材料依据；少量分析须用自然推断语气；假设仅作建议/待验证，不能写成现状。" +
      "禁止无依据内容以已确认口吻描述团队、融资、用户量、收入、客户、已实现能力与里程碑。" +
      "缺事实时写「尚未提供 / 待确认」，不得补造为已发生事实。" +
      posture,
    decision_support:
      "情境=辅助决策。已确认事实作锚点；分析与假设均允许。" +
      "AI 建议须用建议语气，不得冒充本人既有判断。Judgment Candidate 仅作低权线索。" +
      posture,
    exploration:
      "情境=开放探索。以分析与假设为主要输出；事实只作锚点。" +
      DIGITAL_ME_CORE_ANCHOR +
      "请给出多个不同方向的方案，并分别说明价值、风险与验证方式；不要只套融资模板。" +
      "不要求字字来自记忆；允许 memory 中不存在的新方案，但不得把假设写回 subject_fact / confirmed。" +
      posture,
    creation:
      "情境=创作生成。创意表达自由。" +
      "不得创造 Owner 的身份事实与项目经营事实。" +
      posture,
    execution:
      "情境=保守执行。按目标与约束完成，可做必要推理。" +
      "不主动创造代表 Owner 的事实或长期立场。" +
      posture,
    project_document_generation:
      "情境=项目文档生成。必须优先依据项目权威资料与已确认决策撰写。" +
      "输出须区分：已确认事实、当前状态、下一步建议、待 Owner 决策、远期方向。" +
      "不得将稳定币、UBC、代币经济、智能合约交易写成 Digital Me 当前主线。" +
      "不得把区块链基础设施写成主底座。" +
      PROJECT_COMPLETION_BOUNDARY +
      posture,
  };

  let extra = byClass[c] || byClass.execution;
  if (isDigitalMeProject) {
    extra = DIGITAL_ME_CORE_ANCHOR + extra + PROJECT_COMPLETION_BOUNDARY;
  }
  if (allowExplore && c !== "representation" && c !== "project_document_generation") {
    extra += "允许单独给出本次分析/推演段落，并用自然语言标明非本人既有结论。";
  } else if (c === "representation") {
    extra += "禁止把开放探索伪装成已确认主体观点；仍可用自然语言提出建议与待验证方案。";
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

const INTERNAL_CLAIM_TAG_RE =
  /\[(?:已确认|规划目标|分析认为|AI建议\/?待验证|假设待验证|AI建议|待验证)\]/g;

const FAKE_ATTRIBUTION_RE =
  /根据(?:公开|行业)?报告|数据显示|研究表明|据报道|引用公开报告|公开统计显示|市场报告指出/;

const PRODUCT_REDEFINITION_RE =
  /(?:Digital\s*Me|本项目|该产品).{0,40}(?:是|定位为|核心是).{0,40}(?:区块链身份|DID\s*\/?\s*VC|IPFS|跨链|数字孪生平台|数据管理平台)/i;

function findInternalClaimTags(text) {
  const body = String(text || "");
  const hits = [];
  const re = new RegExp(INTERNAL_CLAIM_TAG_RE.source, "g");
  let m;
  while ((m = re.exec(body)) !== null) hits.push(m[0]);
  return hits;
}

function findFakeAttributedClaims(text, evidenceCorpus) {
  const body = String(text || "");
  const corpus = String(evidenceCorpus || "");
  const hits = [];
  const re = new RegExp(FAKE_ATTRIBUTION_RE.source, "g");
  let m;
  while ((m = re.exec(body)) !== null) {
    const start = Math.max(0, m.index - 60);
    const end = Math.min(body.length, m.index + m[0].length + 80);
    const window = body.slice(start, end);
    const hasRealSource =
      /根据本次材料|材料记载|附件《|【参考材料/.test(window) ||
      (corpus.length > 20 &&
        (/出处|sourceRef|参考材料/.test(corpus) ||
          (m[0].length >= 4 && corpus.includes(m[0].slice(0, 4)) && /报告|研究|数据/.test(corpus))));
    // Stock phrases without concrete material grounding are fake attribution.
    if (!hasRealSource) hits.push({ snippet: m[0], window: window.slice(0, 80) });
  }
  return hits;
}

function findProductRedefinitionDrift(text, contextClass) {
  if (
    contextClass !== "exploration" &&
    contextClass !== "representation" &&
    contextClass !== "project_document_generation"
  ) {
    return [];
  }
  const body = String(text || "");
  const hits = [];
  const re = new RegExp(PRODUCT_REDEFINITION_RE.source, "gi");
  let m;
  while ((m = re.exec(body)) !== null) hits.push(m[0]);
  return hits;
}

const PROJECT_MAINLINE_CONFLICT_RE = Object.freeze([
  {
    id: "stablecoin_mainline",
    re: /(?:稳定币|UBC|通用基本资本|治理代币).{0,24}(?:核心|主线|基础设施|主要功能|内置)/,
  },
  {
    id: "blockchain_mainline",
    re: /(?:区块链|智能合约|多链).{0,20}(?:主底座|主技术|核心架构|基础设施项目)/,
  },
  {
    id: "fifteen_month_roadmap",
    re: /(?:第\s*15\s*个月|15\s*个月(?:开发|周期|计划))/,
  },
  {
    id: "team_size",
    re: /(?:至少\s*)?6[\s\-‑–—]*8\s*人|6\s*到\s*8\s*人/,
  },
  {
    id: "budget_range",
    re: /300[\s\-‑–—]*500\s*万/,
  },
]);

function findProjectAuthorityConflicts(text, evidenceCorpus, opts) {
  const body = String(text || "");
  const corpus = String(evidenceCorpus || "");
  const hits = [];
  for (const p of PROJECT_MAINLINE_CONFLICT_RE) {
    const re = new RegExp(p.re.source, p.re.flags.includes("g") ? p.re.flags : p.re.flags + "g");
    let m;
    while ((m = re.exec(body)) !== null) {
      const snippet = m[0];
      if (isHedgedClaim(body, m.index, snippet.length)) continue;
      if (corpus.includes(snippet)) continue;
      hits.push({ id: p.id, snippet });
      break;
    }
  }
  if (opts && opts.projectContextEmpty) {
    // Setup/assembly concern — do not treat as a content conflict.
    // Missing project context is gated earlier (project_unresolved) when required.
    // Emitting it here caused unrepaired terminal failures and infinite repair loops.
  }
  return hits;
}

function assertProjectAuthorityConsistency(text, evidenceCorpus, opts) {
  if (!(opts && opts.isDigitalMeProject)) return true;
  const hits = findProjectAuthorityConflicts(text, evidenceCorpus, opts);
  if (!hits.length) return true;
  const fabricated = findUnsupportedFabricatedFacts(text, evidenceCorpus);
  const allHits = hits.concat(fabricated);
  if (!allHits.length) return true;
  const e = new Error(
    "项目权威一致性检查未通过：内容与 Digital Me 当前定位冲突，或出现无来源的团队/预算/周期等具体数字。请依据项目资料修正，或将内容标为建议/待确认。"
  );
  e.code = "project_authority_conflict";
  e.hits = allHits;
  e.failureStage = "prewrite_validation";
  throw e;
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

function assertFormalArtifactPresentation(text, opts) {
  const presentation = claimPosturePresentationMode(opts || {});
  const body = String(text || "");
  if (presentation === "natural") {
    const tags = findInternalClaimTags(body);
    if (tags.length) {
      const e = new Error("正式成果含内部主张标签，未保存。请改用自然语言表述。");
      e.code = "internal_claim_tags_rejected";
      e.tags = tags;
      throw e;
    }
  }
  const fake = findFakeAttributedClaims(body, (opts && opts.evidenceCorpus) || "");
  if (fake.length) {
    const e = new Error("出现无真实来源的归因表述（如「根据公开报告」），未保存为成果。");
    e.code = "fake_attribution_rejected";
    e.hits = fake;
    throw e;
  }
  const drift = findProductRedefinitionDrift(body, opts && opts.contextClass);
  if (drift.length) {
    const e = new Error("探索/表达成果将 Digital Me 核心定位替换为其他品类，未保存为成果。");
    e.code = "product_redefinition_rejected";
    e.hits = drift;
    throw e;
  }
  return true;
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
  claimPosturePresentationMode,
  findUnsupportedFabricatedFacts,
  findInternalClaimTags,
  findFakeAttributedClaims,
  findProductRedefinitionDrift,
  assertRepresentationFactsGrounded,
  assertFormalArtifactPresentation,
  assertProjectAuthorityConsistency,
  findProjectAuthorityConflicts,
  isDigitalMeProjectContext,
  isExplorationHedged,
  isHedgedClaim,
  sha256Text,
  FABRICATED_FACT_PATTERNS,
  CLAIM_POSTURES,
  CLAIM_POSTURE_PRESENTATIONS,
  DEFAULT_CLAIM_POSTURE_PRESENTATION,
  DIGITAL_ME_CORE_ANCHOR,
  DIGITAL_ME_PROJECT_RE,
  PROJECT_COMPLETION_BOUNDARY,
  HEDGE_RE,
};
