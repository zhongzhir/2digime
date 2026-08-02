"use strict";

/**
 * TASK-QUALITY-LOOP-01.1 — GroundingReview.
 *
 * Deterministic architecture/grounding checks for current-implementation
 * outcomes about the Digital Me project itself. Verifies that a document:
 *  - accurately describes the current system (no "capability missing" claims
 *    contradicted by the CurrentSystemSnapshot);
 *  - does not duplicate existing authority objects (PlanRecord / Task /
 *    ArtifactRef / ProjectKnowledge / Authorization / LearningRecord /
 *    Provenance);
 *  - does not assert unsupported architecture (existing SQLite, tables,
 *    cloud sync, external agent adapters);
 *  - validates user outcomes rather than CRUD only;
 *  - does not escalate ordinary technical choices to the Owner;
 *  - does not carry unsubstantiated estimates.
 */

const { REFERENCE_MARKERS } = require("./authority-map");
const { isDeniedOrAbsentClaimWindow } = require("./document-section-revise");

const ISSUE_BLOCKING = "blocking";
const ISSUE_WARNING = "warning";
const SOURCE = "grounding";

const GROUNDING_RULE_IDS = Object.freeze([
  "current_state_incorrect",
  "existing_capability_ignored",
  "duplicate_authority_source",
  "unsupported_architecture_assumption",
  "acceptance_only_tests_crud",
  "owner_decision_overreach",
  "unsubstantiated_estimate",
  "grounding_revision_guidance",
]);

function lineOf(text, index) {
  return String(text).slice(0, index).split("\n").length;
}

function issue({ ruleId, message, text, index, severity }) {
  const body = String(text || "");
  const i = Number.isInteger(index) && index >= 0 ? index : 0;
  return {
    issueType: severity === ISSUE_WARNING ? ISSUE_WARNING : ISSUE_BLOCKING,
    ruleId,
    message: String(message || ""),
    matchedText: body.slice(i, i + 60),
    lineNumber: lineOf(body, i),
    contextSnippet: body.slice(Math.max(0, i - 20), i + 40).replace(/\s+/g, " ").trim(),
    severity: severity || ISSUE_BLOCKING,
    source: SOURCE,
  };
}

function windowAround(body, index, len, radius) {
  const r = radius || 80;
  const start = Math.max(0, index - r);
  const end = Math.min(body.length, index + (len || 0) + r);
  return body.slice(start, end);
}

function hasReferenceMarker(windowText) {
  return REFERENCE_MARKERS.some((m) => windowText.includes(m));
}

// ---- 1. current state accuracy ------------------------------------------------

function checkCurrentStateAccuracy(body, snapshot) {
  const issues = [];
  const modules = (snapshot && snapshot.relevantModules) || [];
  for (const cap of modules) {
    if (cap.status !== "present") continue; // unknown must never be asserted
    for (const noun of cap.domainNouns || []) {
      const re1 = new RegExp(`(尚未|尚无|没有|缺少|缺乏|缺失|未建立|未实现|需要新建|从零开始)[^。\\n]{0,24}${escapeRe(noun)}`);
      const re2 = new RegExp(`${escapeRe(noun)}[^。\\n]{0,16}(尚处于|处于|仍是|仍处于)(初级阶段|早期阶段|空白阶段)`);
      const m1 = re1.exec(body);
      const m2 = m1 ? null : re2.exec(body);
      const m = m1 || m2;
      if (m) {
        issues.push(
          issue({
            ruleId: "current_state_incorrect",
            message: `文档宣称「${noun}」相关能力缺失或处于初级阶段，但当前系统已具备：${cap.label}（依据 ${cap.sourceRef}）。`,
            text: body,
            index: m.index,
          })
        );
        break; // one hit per capability is enough
      }
    }
  }
  return issues;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---- 2. existing capability ignored -------------------------------------------

function checkExistingCapabilityIgnored(body, snapshot) {
  const modules = (snapshot && snapshot.relevantModules) || [];
  const missing = [];
  for (const cap of modules) {
    if (cap.status !== "present") continue;
    const mentioned = (cap.mentionTokens || []).some((t) => body.includes(t));
    if (!mentioned) missing.push(cap);
  }
  if (!missing.length) return { issues: [], missing };
  const labels = missing.map((c) => c.label).join("；");
  const refs = missing.map((c) => c.sourceRef).join("、");
  return {
    issues: [
      issue({
        ruleId: "existing_capability_ignored",
        message: `文档未识别当前系统已具备的能力：${labels}。当前实施型成果必须基于现有能力设计，说明与它们的关系，而不是当作不存在（依据：${refs}）。`,
        text: body,
        index: 0,
      }),
    ],
    missing,
  };
}

// ---- 3. duplicate authority source ---------------------------------------------

function checkDuplicateAuthority(body, authorityMap) {
  const issues = [];
  const duplicated = [];
  const entries = (authorityMap && authorityMap.entries) || [];
  const registry = require("./authority-map").AUTHORITY_OBJECTS;
  for (const entry of entries) {
    if (entry.status !== "present") continue;
    const reg = registry.find((r) => r.entity === entry.entity);
    if (!reg) continue;
    for (const alias of reg.aliases) {
      const re = new RegExp(alias.source, alias.flags.includes("i") ? alias.flags : alias.flags + "i");
      const m = re.exec(body);
      if (!m) continue;
      const win = windowAround(body, m.index, m[0].length, 80);
      if (hasReferenceMarker(win)) continue;
      issues.push(
        issue({
          ruleId: "duplicate_authority_source",
          message: `文档以「${m[0]}」重新定义了与 ${entry.entity} 同类的数据对象，但未声明权威关系。${entry.entity} 的权威存储为 ${entry.authoritativeStore}（${entry.sourceRef}）；${entry.duplicationRisk}。新方案应引用/关联现有对象，而非新建第二套。`,
          text: body,
          index: m.index,
        })
      );
      duplicated.push(entry.entity);
      break; // one per entity
    }
  }
  return { issues, duplicated };
}

// ---- 4. unsupported architecture assumptions -----------------------------------

function checkUnsupportedArchitecture(body, snapshot) {
  const issues = [];
  const persistence = (snapshot && snapshot.persistenceMechanisms) || [];
  const absent = (kind) => {
    const p = persistence.find((x) => x.kind === kind);
    return p && p.status === "absent" ? p : null;
  };
  const sqlite = absent("sqlite");
  if (sqlite) {
    const patterns = [
      /(现有|已有|基于|沿用|使用|延续|推荐)[^。\n]{0,16}SQLite/i,
      /SQLite[^。\n]{0,16}(后端|持久化|数据库)/i,
      /在(现有|已有)[^。\n]{0,16}(中|内)?[^。\n]{0,8}(增加|新增)[^。\n]{0,24}表/,
    ];
    for (const re of patterns) {
      const m = re.exec(body);
      if (!m) continue;
      const win = windowAround(body, m.index, m[0].length, 72);
      // Negated / deferred statements are boundaries, not "system already has X".
      if (isDeniedOrAbsentClaimWindow(win)) continue;
      issues.push(
        issue({
          ruleId: "unsupported_architecture_assumption",
          message: `文档假设当前系统已具备 SQLite 后端或既有数据表（「${m[0].slice(0, 40)}」），但当前存储为 JSON 文件、SQLite 为 R2.5 deferred（${sqlite.sourceRef}）。不得写成既有事实；如确需引入，应列为候选方案并明确标注。`,
          text: body,
          index: m.index,
        })
      );
      break;
    }
  }
  const cloud = absent("cloud_sync");
  if (cloud) {
    const m = /已有(的)?云同步/.exec(body);
    if (m && !isDeniedOrAbsentClaimWindow(windowAround(body, m.index, m[0].length, 48))) {
      issues.push(
        issue({
          ruleId: "unsupported_architecture_assumption",
          message: "文档假设已有云同步能力，但当前系统无云同步运行时。",
          text: body,
          index: m.index,
        })
      );
    }
  }
  const adapter = absent("external_agent_adapter");
  if (adapter) {
    const m = /已有(的)?外部\s*Agent\s*适配(层|器)?/.exec(body);
    if (m && !isDeniedOrAbsentClaimWindow(windowAround(body, m.index, m[0].length, 48))) {
      issues.push(
        issue({
          ruleId: "unsupported_architecture_assumption",
          message: "文档假设已有外部 Agent 适配层，但当前仅有接口预留。",
          text: body,
          index: m.index,
        })
      );
    }
  }
  return issues;
}

// ---- 5. acceptance value alignment ---------------------------------------------

const CRUD_HIT_RE = /(创建|新增|添加|保存|查询|检索|导出|导入|按钮|可点击|文件存在|格式符合|JSON)/g;
const CROSS_FLOW_HIT_RE = /(新对话|新任务|重启|重新启动|supersede|被替代|替代后|停止生效|停止调用|不再(使用|调用)|串用|来源可见|跨对话|跨任务)/;

function extractAcceptanceSection(body) {
  const lines = String(body).split("\n");
  let start = -1;
  let level = 2;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s*[^\n]*验收/.exec(lines[i]);
    if (m) {
      start = i;
      level = m[1].length;
      break;
    }
  }
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s/.exec(lines[i]);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function checkAcceptanceValue(body) {
  const section = extractAcceptanceSection(body);
  if (!section) return { issues: [], sectionFound: false };
  const crudHits = (section.match(CRUD_HIT_RE) || []).length;
  const crossFlow = CROSS_FLOW_HIT_RE.test(section);
  if (crudHits >= 2 && !crossFlow) {
    const idx = body.indexOf(section.slice(0, 20));
    return {
      issues: [
        issue({
          ruleId: "acceptance_only_tests_crud",
          message:
            "验收标准仅覆盖数据操作（创建/查询/导出等 CRUD），未验证用户结果。本类功能的验收应至少包含一个真实跨流程结果：新对话调用更新后的事实、新任务使用正确项目知识、被 supersede 的旧知识停止生效、不同项目不串用知识、重启后行为一致。",
          text: body,
          index: idx >= 0 ? idx : 0,
        }),
      ],
      sectionFound: true,
    };
  }
  return { issues: [], sectionFound: true };
}

// ---- 6. owner decision overreach -------------------------------------------------

const OWNER_DECISION_RE = /待\s*Owner\s*(决策|决定|确定|确认)/g;
const STRATEGIC_TOPIC_RE = /(战略|主权|对外|授权边界|不可逆|方向|市场|协作网络|排期|路线|定位|叙事)/;
const ORDINARY_TOPIC_RE = /(界面|入口|配额|存储|备份|关联时机|时机|格式|字段|默认|规模|同步机制|实现方式|保留时长|分页)/;

function checkOwnerDecisionOverreach(body) {
  const issues = [];
  const overreach = [];
  let m;
  const re = new RegExp(OWNER_DECISION_RE.source, "g");
  while ((m = re.exec(body)) !== null) {
    const win = windowAround(body, m.index, m[0].length, 40);
    if (STRATEGIC_TOPIC_RE.test(win)) continue;
    if (!ORDINARY_TOPIC_RE.test(win)) continue;
    const snippet = body.slice(Math.max(0, m.index - 16), m.index + 36).replace(/\s+/g, " ").trim();
    overreach.push(snippet);
    if (issues.length < 3) {
      issues.push(
        issue({
          ruleId: "owner_decision_overreach",
          message: `「${snippet}」属于普通产品/技术选择，应给出推荐默认方案（CTO/工程默认）而非升级为 Owner 决策；Owner 决策仅用于战略方向、重大取舍、数据主权、高风险边界、不可逆架构或明显改变用户默认行为。`,
          text: body,
          index: m.index,
        })
      );
    }
  }
  return { issues, overreach };
}

// ---- 7. unsubstantiated estimates -------------------------------------------------

const ESTIMATE_RE = /(\d+\s*[-–—~至到]\s*\d+\s*人日|\d+(?:\.\d+)?\s*人(?:日|天)|(?:工时|工期|工作量)[^。\n]{0,12}\d+)/g;
const SUBSTANTIATED_RE = /(待验证假设|假设值|基准|benchmark|实测|测量|任务拆分依据|估算依据)/i;

function checkUnsubstantiatedEstimate(body) {
  const issues = [];
  let m;
  const re = new RegExp(ESTIMATE_RE.source, "g");
  while ((m = re.exec(body)) !== null) {
    const win = windowAround(body, m.index, m[0].length, 60);
    if (SUBSTANTIATED_RE.test(win)) continue;
    issues.push(
      issue({
        ruleId: "unsubstantiated_estimate",
        message: `「${m[0]}」为无依据估算。工期/容量/成本数字须来自已有基准、现有测量、明确任务拆分，或明确标注为待验证假设；当前实施型成果不得含无依据工期。`,
        text: body,
        index: m.index,
      })
    );
    if (issues.length >= 2) break;
  }
  return issues;
}

// ---- main --------------------------------------------------------------------------

/**
 * @param {string} content draft text
 * @param {object} opts { goal, snapshot, authorityMap }
 */
function groundingReview(content, { goal, snapshot, authorityMap } = {}) {
  const body = String(content || "");
  const blockingIssues = [];
  const qualityIssues = [];
  const suggestedRevisions = [];

  const stateIssues = checkCurrentStateAccuracy(body, snapshot);
  const ignored = checkExistingCapabilityIgnored(body, snapshot);
  const dup = checkDuplicateAuthority(body, authorityMap);
  const arch = checkUnsupportedArchitecture(body, snapshot);
  const acceptance = checkAcceptanceValue(body);
  const owner = checkOwnerDecisionOverreach(body);
  const estimates = checkUnsubstantiatedEstimate(body);

  blockingIssues.push(...stateIssues);
  blockingIssues.push(...ignored.issues);
  blockingIssues.push(...dup.issues);
  blockingIssues.push(...arch);
  blockingIssues.push(...acceptance.issues);
  blockingIssues.push(...owner.issues);
  blockingIssues.push(...estimates);

  if (ignored.missing.length) {
    suggestedRevisions.push(
      `在「现有基础」中明确写出当前已具备能力：${ignored.missing.map((c) => c.label).join("；")}。`
    );
  }
  if (dup.duplicated.length) {
    suggestedRevisions.push(
      `删除对 ${dup.duplicated.join("、")} 的重复定义，改为引用/关联现有权威对象并说明字段映射关系。`
    );
  }
  if (arch.length) {
    suggestedRevisions.push("移除或改写无证据的架构假设（如既有 SQLite/数据表），改为基于当前 JSON 存储的设计或明确标注为候选方案。");
  }
  if (acceptance.issues.length) {
    suggestedRevisions.push("重写验收标准：以跨对话、跨任务、supersede 生效、项目间不串用、重启一致等用户结果为中心。");
  }
  if (owner.overreach.length) {
    suggestedRevisions.push("将普通技术选择改为推荐默认方案，不再列为 Owner 决策。");
  }
  if (estimates.length) {
    suggestedRevisions.push("移除无依据工期/容量数字，或标注为待验证假设并给出依据。");
  }

  // Internal revision guidance for the repair prompt — never a content blocking defect,
  // and must not appear in remainingIssues / final user-facing body.
  if (blockingIssues.length) {
    suggestedRevisions.push(
      "修订方向：按「现有基础 → 实际缺口 → 最小新增能力 → 与现有对象的关系 → 用户结果 → 验收」重组方案，不得仅删除错误句子。"
    );
  }

  const grounding = {
    currentStateAccuracy: stateIssues.length ? "issues" : "pass",
    authorityConsistency: dup.issues.length || arch.length ? "issues" : "pass",
    duplicationRisk: dup.issues.length,
    acceptanceValueAlignment: acceptance.issues.length ? "issues" : "pass",
    unsupportedAssumptions: arch.map((i) => i.message.slice(0, 80)),
    duplicateCapabilities: [],
    duplicateAuthorityObjects: dup.duplicated,
    missingCurrentCapabilities: ignored.missing.map((c) => c.id),
    ownerDecisionOverreach: owner.overreach.slice(0, 6),
    estimateIssues: estimates.length,
  };

  return { blockingIssues, qualityIssues, suggestedRevisions, grounding };
}

module.exports = {
  GROUNDING_RULE_IDS,
  groundingReview,
  extractAcceptanceSection,
  SOURCE,
};
