"use strict";

const { DATA_KINDS } = require("../package-store");

/** @type {"1"} */
const SUBJECT_OVERVIEW_CONTRACT_VERSION = "1";

/** @type {"1"} */
const PANORAMA_STATUS_CONTRACT_VERSION = "1";

const USER_STATUS = Object.freeze({
  AVAILABLE: "available",
  EXPERIMENT: "experiment",
  LOCAL_SIM: "local_sim",
  PREVIEW: "preview",
  NOT_OPEN: "not_open",
});

const USER_STATUS_LABEL = Object.freeze({
  [USER_STATUS.AVAILABLE]: "可用",
  [USER_STATUS.EXPERIMENT]: "实验",
  [USER_STATUS.LOCAL_SIM]: "本地模拟",
  [USER_STATUS.PREVIEW]: "预览",
  [USER_STATUS.NOT_OPEN]: "尚未开放",
});

const PANORAMA_NAV_TARGETS = new Set([
  "me-build",
  "me-overview",
  "me-cognition",
  "me-boundaries",
  "capabilities",
  "settings-package-versions",
  "panorama-experience",
]);

const LAYER_META = Object.freeze({
  evidence: {
    userLabel: "原始材料",
    explanation: "你提交或授权引用的原始文件与出处索引，尚未整理为主体结论。",
    visualClass: "layer-evidence",
  },
  fact: {
    userLabel: "已核对事实",
    explanation: "有明确出处、可核对的主体事实，不等同于模型推断。",
    visualClass: "layer-fact",
  },
  owner_assertion: {
    userLabel: "本人声明",
    explanation: "你明确确认过的立场、偏好与风格纠正，代表你的表达而非系统猜测。",
    visualClass: "layer-owner",
  },
  inference: {
    userLabel: "系统推断",
    explanation: "系统根据材料归纳的判断；其中既可能有待校对项，也可能有已确认项，拒绝项不计入。",
    visualClass: "layer-inference",
  },
  current_state: {
    userLabel: "当前状态",
    explanation: "人生事件、角色、关系与画像等正在使用的主体状态记录。",
    visualClass: "layer-state",
  },
  development_intent: {
    userLabel: "发展意图",
    explanation: "你希望加强的方向、待写入的观念线索与能力信号。",
    visualClass: "layer-intent",
  },
  capability_policy: {
    userLabel: "边界与能力策略",
    explanation: "使用边界、授权策略与技能索引，约束数字之我能做什么。",
    visualClass: "layer-policy",
  },
});

const CAPABILITY_CATALOG = Object.freeze([
  {
    id: "dialogue",
    label: "本机对话",
    status: "unknown",
    limitation: "需在设置中配置智能引擎密钥后方可使用。",
    navTarget: "settings",
  },
  {
    id: "writing",
    label: "写作与成稿",
    status: "limited",
    limitation: "可创建、改稿与导出文稿；连续真实验收尚未完成。",
    navTarget: "do",
  },
  {
    id: "research",
    label: "研究整理",
    status: "limited",
    limitation: "研究笔记本与整理流程可用；安全与评测闭环尚未完成。",
    navTarget: "do",
  },
  {
    id: "feedback",
    label: "风格纠正写入",
    status: "available",
    limitation: "经你确认后写入资料；目前是唯一接入版本管理的写入路径。",
    navTarget: "chat",
  },
  {
    id: "builder",
    label: "材料构建",
    status: "limited",
    limitation: "可处理提交材料；写入尚未全部纳入版本管理。",
    navTarget: "me-build",
  },
  {
    id: "mcp_extensions",
    label: "扩展工具",
    status: "experimental",
    limitation: "可连接外部工具；默认高风险，尚无统一策略引擎。",
    navTarget: "extensions",
  },
  {
    id: "external_cli",
    label: "外部命令执行",
    status: "experimental",
    limitation: "需明确确认且允许改文件；应视为开发者实验能力。",
    navTarget: "settings",
  },
]);

module.exports = {
  SUBJECT_OVERVIEW_CONTRACT_VERSION,
  PANORAMA_STATUS_CONTRACT_VERSION,
  USER_STATUS,
  USER_STATUS_LABEL,
  PANORAMA_NAV_TARGETS,
  DATA_KINDS,
  LAYER_META,
  CAPABILITY_CATALOG,
};
