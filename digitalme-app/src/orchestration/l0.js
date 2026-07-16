"use strict";

/**
 * L0 主体编排（v0.3.13）
 * 编程等执行面：控制权优先（授权 · 确认 · 轨迹 · 审计 · 回流）；
 * 「像我」保留为边界约束，不要求在界面显式表演人格。
 */

function buildControlBrief({ writeAuthorized, workspaceLabel, scene }) {
  const sceneName = scene === "code" ? "编程" : scene === "write" ? "写作" : scene === "research" ? "研究" : "办事";
  const lines = [
    `【主体编排 · ${sceneName}】控制权在用户：你只能在用户授权范围内行动。`,
    "禁止声称已替用户对外发送邮件、支付、git push 或发布上线，除非用户明确确认且当前授权允许。",
    "不确定处标明待核实；把可核对的结果交还给用户采纳。",
  ];
  if (scene === "code") {
    lines.push(
      writeAuthorized
        ? `用户已允许改动授权目录（备注：${workspaceLabel || "未填写"}）。仍禁止越权路径与擅自推送。`
        : "当前为只读审阅：可给方案与补丁说明，不得声称已改文件，除非用户勾选允许改动。"
    );
  }
  return lines.join("\n");
}

function buildPersonaBrief(pkg) {
  // 轻量边界：有 Package 则带 owner，不强求风格模仿表演
  if (!pkg || !pkg.exists) {
    return "（尚未加载资料包：仍须保守、可核对，勿越权外发。）";
  }
  const m = pkg.manifest || {};
  const owner = m.ownerDisplayName || "本人";
  return `执行时以「${owner}」为主体归属；边界与禁区优先于文风模仿。`;
}

function buildCodeSceneHint({ writeAuthorized, workspaceLabel, skillHint, executorName }) {
  const control = buildControlBrief({ writeAuthorized, workspaceLabel, scene: "code" });
  const skill = skillHint ? `\n\n【当前 Skill】\n${skillHint}` : "";
  const exec = executorName ? `\n当前执行体：${executorName}。` : "";
  return (
    "## 编程 · 主体编排\n\n" +
    control +
    exec +
    "\n你是 Digital Me 调度下的代码协助面（可跟随外部执行体，非自研 IDE）。" +
    "优先使用已连接工具或用户确认的外部命令输出；成果由用户「采用为成果」回流。" +
    skill
  );
}

function formatTrail(capabilitiesUsed, executorName) {
  const ids = Array.isArray(capabilitiesUsed) ? capabilitiesUsed.filter(Boolean) : [];
  const head = executorName ? `执行体：${executorName}。` : "";
  if (!ids.length) return head + "本次未调用外部手脚。";
  return head + "本次调用：" + ids.join("、") + "。";
}

module.exports = {
  buildControlBrief,
  buildPersonaBrief,
  buildCodeSceneHint,
  formatTrail,
};
