"use strict";

/** 预置编程 Skill（方法，非课题） */
const PRESET_CODE_SKILLS = [
  {
    id: "preset_code_review",
    title: "代码审阅",
    blurb: "只读审阅：风险、可读性、测试缺口；默认不改文件。",
    preset: true,
    sceneTags: ["code"],
    recommendedExtensions: ["filesystem"],
    systemHint:
      "【Skill · 代码审阅】优先阅读与指出问题；给出分级建议。未经用户允许写入授权时不要改文件。",
    steps: ["确认范围", "阅读相关文件", "列出问题与建议", "给出可选补丁说明"],
  },
  {
    id: "preset_code_fix",
    title: "小步改码",
    blurb: "在授权目录内做小范围修改说明或补丁。",
    preset: true,
    sceneTags: ["code"],
    recommendedExtensions: ["filesystem", "github"],
    systemHint:
      "【Skill · 小步改码】一次只改一小步；说明影响面；写入仅限已授权工作区；不擅自 push。",
    steps: ["确认目标与授权", "定位文件", "提出最小改动", "自测说明"],
  },
];

module.exports = { PRESET_CODE_SKILLS };
