"use strict";

/** Built-in research Skills (seeded once per install). */
const PRESET_RESEARCH_SKILLS = [
  {
    id: "psk_preset_general_research",
    title: "通用调研",
    blurb: "澄清问题 → 检索材料 → 阅读来源 → 写出成果稿",
    systemHint:
      "【预置 Skill · 通用调研】按四步推进：先澄清范围与检索词，再检索并入库，阅读来源摘录，最后写出有依据的成果稿。" +
      "有材料时结论须挂材料标题；缺证据标待核实；禁止编造数字。",
    prompt: "请按通用调研流程完成：澄清→检索→读源→成果稿。",
    sceneTags: ["research"],
    recommendedExtensions: ["fetch", "brave-search"],
    steps: ["澄清问题", "检索材料", "阅读来源", "撰写成果"],
    preset: true,
  },
  {
    id: "psk_preset_quick_brief",
    title: "快速简报",
    blurb: "少步骤、偏方向性；适合先摸清大概再深入",
    systemHint:
      "【预置 Skill · 快速简报】优先给出结构化要点与待核实项；材料不足时明确标注初步。" +
      "不展开成长报告，控制在可读篇幅内。",
    prompt: "请给出简明简报：要点、不确定处、建议下一步。",
    sceneTags: ["research"],
    recommendedExtensions: ["fetch"],
    steps: ["澄清", "要点", "待核实"],
    preset: true,
  },
  {
    id: "psk_preset_deep_dive",
    title: "深度核对",
    blurb: "材料齐全后做严格对照与结论–依据清单",
    systemHint:
      "【预置 Skill · 深度核对】假设参考材料已齐：逐条对照材料写结论，不一致与缺口必须指出。" +
      "答复须含「结论与依据」清单，每条标明支持程度。",
    prompt: "请基于全部参考材料做深度核对，输出结论与依据清单。",
    sceneTags: ["research"],
    recommendedExtensions: ["fetch", "brave-search"],
    steps: ["对照材料", "结论清单", "缺口", "成果稿"],
    preset: true,
  },
];

module.exports = { PRESET_RESEARCH_SKILLS };
