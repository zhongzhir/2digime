"use strict";

const PptxGenJS = require("pptxgenjs");

// Build a .pptx from structured slide plan. Returns buffer for Electron save dialog.
async function buildPptx(plan) {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = plan.author || "Digital Me";
  pptx.title = plan.title || "演讲";

  // Title slide
  const s0 = pptx.addSlide();
  s0.addText(plan.title || "演讲", {
    x: 0.6, y: 1.6, w: 8.8, h: 1.2,
    fontSize: 32, bold: true, color: "1a1a2e", fontFace: "Microsoft YaHei",
  });
  if (plan.subtitle) {
    s0.addText(plan.subtitle, {
      x: 0.6, y: 2.9, w: 8.8, h: 0.8,
      fontSize: 18, color: "4a5568", fontFace: "Microsoft YaHei",
    });
  }
  if (plan.meta) {
    s0.addText(plan.meta, {
      x: 0.6, y: 4.5, w: 8.8, h: 0.5,
      fontSize: 12, color: "718096", fontFace: "Microsoft YaHei",
    });
  }

  for (const slide of plan.slides || []) {
    const s = pptx.addSlide();
    s.addText(slide.title || "", {
      x: 0.5, y: 0.4, w: 9, h: 0.9,
      fontSize: 24, bold: true, color: "1a1a2e", fontFace: "Microsoft YaHei",
    });
    const bullets = (slide.bullets || []).filter(Boolean);
    if (bullets.length) {
      s.addText(
        bullets.map((b) => ({ text: b, options: { bullet: true, breakLine: true } })),
        {
          x: 0.6, y: 1.5, w: 8.8, h: 4.5,
          fontSize: 16, color: "2d3748", fontFace: "Microsoft YaHei",
          valign: "top",
        }
      );
    }
    if (slide.notes) s.addNotes(slide.notes);
  }

  // Closing slide
  if (plan.closing) {
    const sc = pptx.addSlide();
    sc.addText(plan.closing, {
      x: 0.6, y: 2.2, w: 8.8, h: 1.5,
      fontSize: 28, bold: true, align: "center", color: "1a1a2e", fontFace: "Microsoft YaHei",
    });
  }

  return pptx.write({ outputType: "nodebuffer" });
}

function parsePlanJson(raw) {
  let s = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  const obj = JSON.parse(s);
  if (!obj.slides || !Array.isArray(obj.slides)) throw new Error("模型未返回有效的 slides 结构");
  return {
    title: obj.title || "演讲",
    subtitle: obj.subtitle || "",
    meta: obj.meta || "",
    closing: obj.closing || "谢谢",
    slides: obj.slides.map((sl) => ({
      title: sl.title || "",
      bullets: Array.isArray(sl.bullets) ? sl.bullets : [],
      notes: sl.notes || "",
    })),
  };
}

function buildPptPlanMessages(pkg, brief) {
  const system = (pkg.systemPrompt || "") +
    "\n\n你是本人的 Digital Me，请按本人人格、风格与判断框架规划演讲 PPT。" +
    "只输出 JSON，不要 markdown 包裹外的解释。结构：\n" +
    `{"title":"演讲标题","subtitle":"副标题","meta":"场合/时长等","closing":"结束语",` +
    `"slides":[{"title":"页标题","bullets":["要点1","要点2"],"notes":"演讲者备注"}]}\n` +
    "要求：8-14 页内容页；要点精炼、有判断、像本人说话；notes 写演讲时可展开的口语化提示。";

  const parts = [
    `请为以下演讲需求生成完整 PPT 结构（JSON）：`,
    `主题：${brief.topic}`,
    brief.occasion ? `场合：${brief.occasion}` : "",
    brief.duration ? `时长：${brief.duration}` : "",
    brief.audience ? `听众：${brief.audience}` : "",
    brief.keyPoints ? `必须覆盖的要点：${brief.keyPoints}` : "",
    brief.context
      ? `下列成稿/背景是主要依据，请据此提炼幻灯片（不要另起炉灶编造无关主题）：\n${String(brief.context).slice(0, 12000)}`
      : "",
  ].filter(Boolean);

  return [
    { role: "system", content: system },
    { role: "user", content: parts.join("\n") },
  ];
}

module.exports = { buildPptx, parsePlanJson, buildPptPlanMessages };
