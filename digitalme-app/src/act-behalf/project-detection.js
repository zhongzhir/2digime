"use strict";

/**
 * LEARN-LOOP-FIX-02: unified project scope detection.
 */

const { PROJECT_IDS } = require("./project-knowledge-schema");

const DIGITAL_ME_ALIASES = Object.freeze([
  /digital\s*me/i,
  /digitalme/i,
  /数字之我/i,
  /数字主体/i,
  /\bdm\b.*项目/i,
  /dvl2/i,
  /idcollab/i,
]);

const DIGITAL_ME_INTENT = Object.freeze([
  /开发计划/,
  /项目计划/,
  /做到哪/,
  /当前.*进度/,
  /是什么/,
  /定位/,
  /主线/,
  /下一步/,
  /任务详情/,
  /界面设计/,
  /产品原则/,
]);

const NON_DIGITAL_ME_BLOCK = Object.freeze([
  /餐饮企业/,
  /开业宣传/,
  /餐厅/,
  /火锅/,
  /奶茶店/,
]);

function detectProjectScope(input) {
  const blob = [
    input && input.query,
    input && input.goal,
    input && input.projectHint,
    input && input.task && input.task.goal,
    input && input.task && input.task.request,
    input && input.task && input.task.projectId,
    input && input.conversationProjectId,
    input && input.boundProjectId,
  ]
    .filter(Boolean)
    .map((x) => String(x))
    .join("\n");

  if (!blob.trim()) {
    return { projectId: null, confidence: "none", reason: "empty_query" };
  }

  for (const re of NON_DIGITAL_ME_BLOCK) {
    if (re.test(blob)) {
      return { projectId: null, confidence: "high", reason: "non_digital_me_topic" };
    }
  }

  if (input && input.boundProjectId) {
    return {
      projectId: String(input.boundProjectId),
      projectContextId: input.boundProjectId === PROJECT_IDS.DIGITAL_ME ? "pctx_digital_me_default" : null,
      confidence: "high",
      reason: "bound_project_id",
    };
  }

  if (input && input.task && input.task.projectId) {
    return {
      projectId: String(input.task.projectId),
      projectContextId:
        input.task.projectId === PROJECT_IDS.DIGITAL_ME ? "pctx_digital_me_default" : null,
      confidence: "high",
      reason: "task_bound_project",
    };
  }

  const aliasHit = DIGITAL_ME_ALIASES.some((re) => re.test(blob));
  const intentHit = DIGITAL_ME_INTENT.some((re) => re.test(blob));
  if (aliasHit) {
    return {
      projectId: PROJECT_IDS.DIGITAL_ME,
      projectContextId: "pctx_digital_me_default",
      confidence: intentHit ? "high" : "medium",
      reason: intentHit ? "alias_and_intent" : "alias_only",
    };
  }

  if (intentHit && /digital|数字|主体|开发计划|项目计划/i.test(blob)) {
    return {
      projectId: PROJECT_IDS.DIGITAL_ME,
      projectContextId: "pctx_digital_me_default",
      confidence: "medium",
      reason: "intent_soft",
    };
  }

  return { projectId: null, confidence: "low", reason: "unresolved" };
}

module.exports = {
  detectProjectScope,
  DIGITAL_ME_ALIASES,
  NON_DIGITAL_ME_BLOCK,
};
