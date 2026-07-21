"use strict";

/**
 * Parse model output into visible sections for act-behalf results.
 */

function extractSection(text, headings) {
  const src = String(text || "");
  for (const h of headings) {
    const re = new RegExp(
      "(?:^|\\n)##\\s*" + h + "\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|$)",
      "i"
    );
    const m = src.match(re);
    if (m && m[1] && m[1].trim()) return m[1].trim();
  }
  return "";
}

/**
 * @param {string} raw
 * @returns {{
 *   usedSelfInfo: string,
 *   existingUserPositions: string,
 *   digitalMeInferences: string,
 *   result: string,
 *   parseOk: boolean
 * }}
 */
function parseActBehalfOutput(raw) {
  const text = String(raw || "").trim();
  const usedSelfInfo = extractSection(text, [
    "使用的本人信息",
    "本次使用的本人信息",
    "本人信息",
  ]);
  const existingUserPositions = extractSection(text, [
    "本人已有事实或观点",
    "本人已有内容",
    "已有事实或观点",
  ]);
  const digitalMeInferences = extractSection(text, [
    "Digital Me 的新分析或建议",
    "新分析或建议",
    "新推断",
  ]);
  const result = extractSection(text, ["完整结果", "最终结果", "结果"]);

  const parseOk = !!(existingUserPositions || digitalMeInferences || result);
  return {
    usedSelfInfo,
    existingUserPositions: existingUserPositions || (parseOk ? "" : "（模型未按要求分栏；请参见完整结果。）"),
    digitalMeInferences: digitalMeInferences || (parseOk ? "" : "（模型未按要求分栏；请参见完整结果。）"),
    result: result || text,
    parseOk,
  };
}

function buildActBehalfMessages({ request, selectedSelfContextText, title }) {
  const selfBlock = String(selectedSelfContextText || "").trim() || "（用户未提供可用的本人信息摘录。）";
  const system =
    "你是 Digital Me：在本地代表用户本人完成一项任务。\n" +
    "必须严格依据「本次使用的本人信息」作答；禁止编造用户未提供的私人事实。\n" +
    "若信息不足，在「Digital Me 的新分析或建议」中明确说明缺口，并给出可验证的建议。\n" +
    "输出必须使用以下 Markdown 二级标题（标题文字必须一致，便于界面解析）：\n\n" +
    "## 使用的本人信息\n" +
    "（列出你实际用到的本人信息要点）\n\n" +
    "## 本人已有事实或观点\n" +
    "（仅整理本人信息中已有的事实或立场，不要混入新推断）\n\n" +
    "## Digital Me 的新分析或建议\n" +
    "（本轮任务下的新分析、推理或建议，需与上一栏区分）\n\n" +
    "## 完整结果\n" +
    "（可直接使用或修改的完整产出）";

  const user =
    "任务标题：" +
    String(title || "未命名任务") +
    "\n\n任务说明：\n" +
    String(request || "").trim() +
    "\n\n---\n\n## 本次使用的本人信息（唯一允许引用的本人资料）\n\n" +
    selfBlock;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

module.exports = {
  extractSection,
  parseActBehalfOutput,
  buildActBehalfMessages,
};
