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

/* ---------------- Email drafting (taskType = "email") ---------------- */

const MAX_EMAIL_FIELD_CHARS = 4000;
const MAX_EMAIL_BODY_CHARS = 20000;

function truncateEmailField(text, max) {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

function extractJsonCandidate(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    /* continue */
  }
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      /* continue */
    }
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeEmailAttachments(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[,，;；\n]/)
        .map((s) => s.trim());
  return list
    .map((a) => String(a || "").trim())
    .filter(Boolean)
    .slice(0, 10);
}

function normalizeEmailDraftShape(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const to = truncateEmailField(parsed.to || parsed.recipient || parsed["收件人"], MAX_EMAIL_FIELD_CHARS);
  const subject = truncateEmailField(
    parsed.subject || parsed["主题"] || parsed["标题"],
    MAX_EMAIL_FIELD_CHARS
  );
  const body = truncateEmailField(
    parsed.body || parsed["正文"] || parsed.content,
    MAX_EMAIL_BODY_CHARS
  );
  const attachments = normalizeEmailAttachments(parsed.attachments || parsed["附件"]);
  const needsConfirmation = Array.isArray(parsed.needsConfirmation)
    ? parsed.needsConfirmation.map((s) => truncateEmailField(s, 240)).filter(Boolean).slice(0, 10)
    : [];
  if (!to && !subject && !body) return null;
  return { to, subject, body, attachments, needsConfirmation };
}

/**
 * Compose a human-readable plain-text view of an email draft
 * (used for the generic draft textarea / result field).
 */
function composeEmailPlainText(draft) {
  const d = draft || {};
  const lines = [];
  lines.push("收件人：" + (d.to || "（待填写）"));
  lines.push("主题：" + (d.subject || "（待填写）"));
  if (Array.isArray(d.attachments) && d.attachments.length) {
    lines.push("附件：" + d.attachments.join("、"));
  }
  lines.push("");
  lines.push(d.body || "");
  return lines.join("\n").trim();
}

/**
 * Parse model output into a structured email draft.
 * Accepts a single JSON object ({to,subject,body,attachments,needsConfirmation})
 * or Markdown sections（## 收件人 / ## 主题 / ## 正文 / ## 附件）.
 *
 * @param {string} raw
 * @returns {{to:string,subject:string,body:string,attachments:string[],needsConfirmation:string[],plainText:string,parseOk:boolean}}
 */
function parseEmailOutput(raw) {
  const text = String(raw || "").trim();
  let draft = normalizeEmailDraftShape(extractJsonCandidate(text));

  if (!draft) {
    const to = extractSection(text, ["收件人", "收信人", "To"]);
    const subject = extractSection(text, ["主题", "邮件主题", "Subject"]);
    const body = extractSection(text, ["正文", "邮件正文", "Body"]);
    const attachmentsRaw = extractSection(text, ["附件", "Attachments"]);
    if (to || subject || body) {
      draft = {
        to: truncateEmailField(to.replace(/\n+/g, " "), MAX_EMAIL_FIELD_CHARS),
        subject: truncateEmailField(subject.replace(/\n+/g, " "), MAX_EMAIL_FIELD_CHARS),
        body: truncateEmailField(body, MAX_EMAIL_BODY_CHARS),
        attachments: normalizeEmailAttachments(attachmentsRaw),
        needsConfirmation: [],
      };
    }
  }

  if (!draft) {
    return {
      to: "",
      subject: "",
      body: "",
      attachments: [],
      needsConfirmation: [],
      plainText: text,
      parseOk: false,
    };
  }

  const needsConfirmation = draft.needsConfirmation.slice();
  if (!draft.to && !needsConfirmation.some((n) => n.includes("收件人"))) {
    needsConfirmation.push("收件人地址缺失，需要用户填写确认。");
  }
  return {
    to: draft.to,
    subject: draft.subject,
    body: draft.body,
    attachments: draft.attachments,
    needsConfirmation,
    plainText: composeEmailPlainText(draft),
    parseOk: !!(draft.subject || draft.body),
  };
}

/**
 * Email-specific generation messages: structured email output,
 * user style/boundaries from self context, explicit confirmation marks.
 */
function buildEmailMessages({ request, selectedSelfContextText, title }) {
  const selfBlock =
    String(selectedSelfContextText || "").trim() || "（用户未提供可用的本人信息摘录。）";
  const system =
    "你是 Digital Me：在本地代表用户本人起草一封邮件。\n" +
    "必须严格依据「本次使用的本人信息」作答；禁止编造用户未提供的私人事实。\n" +
    "语气、措辞与格式必须符合本人信息中体现的表达风格；不得越过本人信息中声明的边界。\n" +
    "输出必须是单个 JSON 对象，不要 Markdown 代码围栏，字段为：\n" +
    "{\n" +
    '  "to": "收件人（人名或地址；不确定则留空）",\n' +
    '  "subject": "邮件主题",\n' +
    '  "body": "邮件正文（纯文本，可直接发送）",\n' +
    '  "attachments": ["附件说明，没有则为空数组"],\n' +
    '  "needsConfirmation": ["需要用户确认或补充的部分，例如不确定的收件人、时间、数字"]\n' +
    "}\n" +
    "规则：\n" +
    "1. 收件人、时间、金额、承诺等关键事实若本人信息中没有依据，必须留空或写入 needsConfirmation，禁止虚构。\n" +
    "2. 正文署名使用本人信息中的称呼；没有则省略署名。\n" +
    "3. 本任务只是起草，邮件不会自动发送，发送前用户会再次确认。";

  const user =
    "任务标题：" +
    String(title || "未命名任务") +
    "\n\n邮件起草需求：\n" +
    String(request || "").trim() +
    "\n\n---\n\n## 本次使用的本人信息（唯一允许引用的本人资料）\n\n" +
    selfBlock;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/* ---------------- Video/Audio scripting (taskType = "video_audio") ---------------- */

const MAX_VIDEO_AUDIO_FIELD_CHARS = 4000;
const MAX_VIDEO_AUDIO_SCENES = 60;
const MAX_VIDEO_AUDIO_SCENE_CHARS = 4000;
const MAX_VIDEO_AUDIO_LIST_ITEMS = 20;

function truncateVideoAudioField(text, max) {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

function normalizeVideoAudioList(value) {
  const list = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/\r?\n/)
        .map((s) => s.replace(/^[-*•\d.、\s]+/, ""));
  return list
    .map((s) => truncateVideoAudioField(s, 500))
    .filter(Boolean)
    .slice(0, MAX_VIDEO_AUDIO_LIST_ITEMS);
}

function normalizeVideoAudioScene(value, idx) {
  const src = value && typeof value === "object" ? value : {};
  const scene = truncateVideoAudioField(
    src.scene || src["场景"] || src["镜头"] || src.name || "场景 " + (idx + 1),
    200
  );
  const visuals = truncateVideoAudioField(
    src.visuals || src["画面"] || src.shot || "",
    MAX_VIDEO_AUDIO_SCENE_CHARS
  );
  const narration = truncateVideoAudioField(
    src.narration || src["旁白"] || src["台词"] || src.voiceover || "",
    MAX_VIDEO_AUDIO_SCENE_CHARS
  );
  const duration = truncateVideoAudioField(src.duration || src["时长"] || "", 60);
  if (!visuals && !narration) return null;
  return { scene, visuals, narration, duration };
}

function normalizeVideoAudioScenes(value) {
  if (Array.isArray(value)) {
    return value
      .map((s, i) => normalizeVideoAudioScene(s, i))
      .filter(Boolean)
      .slice(0, MAX_VIDEO_AUDIO_SCENES);
  }
  return parseStoryboardScenes(value);
}

/** Parse a free-text storyboard section (Markdown) into structured scenes. */
function parseStoryboardScenes(text) {
  const lines = String(text || "").split(/\r?\n/);
  const scenes = [];
  let cur = null;
  const push = () => {
    if (cur && (String(cur.visuals).trim() || String(cur.narration).trim())) {
      cur.visuals = truncateVideoAudioField(cur.visuals, MAX_VIDEO_AUDIO_SCENE_CHARS);
      cur.narration = truncateVideoAudioField(cur.narration, MAX_VIDEO_AUDIO_SCENE_CHARS);
      scenes.push(cur);
    }
    cur = null;
  };
  for (const rawLine of lines) {
    const l = String(rawLine || "").trim();
    if (!l || scenes.length >= MAX_VIDEO_AUDIO_SCENES) continue;
    const head = l.match(
      /^(?:[-*]\s*)?(?:#{1,4}\s*)?(场景|镜头|scene|shot)\s*([0-9一二三四五六七八九十]+)?\s*[：:.\-]?\s*(.*)$/i
    );
    if (head) {
      push();
      cur = {
        scene: truncateVideoAudioField(
          (head[1] + (head[2] ? " " + head[2] : "")).replace(/^(scene|shot)$/i, "场景"),
          200
        ),
        visuals: head[3] || "",
        narration: "",
        duration: "",
      };
      continue;
    }
    if (!cur) continue;
    const v = l.match(/^(?:[-*]\s*)?(画面|visuals?)\s*[：:]\s*(.*)$/i);
    if (v) {
      cur.visuals = (cur.visuals ? cur.visuals + "\n" : "") + v[2];
      continue;
    }
    const n = l.match(/^(?:[-*]\s*)?(旁白|台词|narration|voiceover)\s*[：:]\s*(.*)$/i);
    if (n) {
      cur.narration = (cur.narration ? cur.narration + "\n" : "") + n[2];
      continue;
    }
    const d = l.match(/^(?:[-*]\s*)?(时长|duration)\s*[：:]\s*(.*)$/i);
    if (d) {
      cur.duration = truncateVideoAudioField(d[2], 60);
      continue;
    }
    cur.visuals = (cur.visuals ? cur.visuals + "\n" : "") + l;
  }
  push();
  return scenes;
}

function normalizeVideoAudioScriptShape(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const title = truncateVideoAudioField(parsed.title || parsed["标题"] || "", 240);
  const duration = truncateVideoAudioField(
    parsed.duration || parsed["时长"] || parsed.totalDuration || "",
    60
  );
  const scenes = normalizeVideoAudioScenes(
    parsed.scenes || parsed["分镜脚本"] || parsed["分镜"] || parsed.storyboard
  );
  const creativeDirection = truncateVideoAudioField(
    parsed.creativeDirection || parsed["创意方向"] || "",
    MAX_VIDEO_AUDIO_FIELD_CHARS
  );
  const productionTips = normalizeVideoAudioList(
    parsed.productionTips || parsed["制作建议"] || parsed.productionAdvice
  );
  const needsConfirmation = normalizeVideoAudioList(
    parsed.needsConfirmation || parsed["待确认"]
  );
  if (!title && !scenes.length && !creativeDirection) return null;
  return { title, duration, scenes, creativeDirection, productionTips, needsConfirmation };
}

/** Compose a human-readable plain-text view of a video/audio script. */
function composeVideoAudioPlainText(script) {
  const s = script || {};
  const lines = [];
  lines.push("标题：" + (s.title || "（待填写）"));
  lines.push("预估时长：" + (s.duration || "（待确认）"));
  lines.push("");
  lines.push("【分镜脚本】");
  const scenes = Array.isArray(s.scenes) ? s.scenes : [];
  if (!scenes.length) {
    lines.push("（暂无分镜，需要补充。）");
  }
  for (const sc of scenes) {
    lines.push("");
    lines.push(sc.scene + (sc.duration ? "（时长：" + sc.duration + "）" : ""));
    if (sc.visuals) lines.push("画面：" + sc.visuals);
    if (sc.narration) lines.push("旁白：" + sc.narration);
  }
  if (s.creativeDirection) {
    lines.push("");
    lines.push("【创意方向】");
    lines.push(s.creativeDirection);
  }
  if (Array.isArray(s.productionTips) && s.productionTips.length) {
    lines.push("");
    lines.push("【制作建议】");
    for (const t of s.productionTips) lines.push("- " + t);
  }
  if (Array.isArray(s.needsConfirmation) && s.needsConfirmation.length) {
    lines.push("");
    lines.push("【待确认】");
    for (const n of s.needsConfirmation) lines.push("- " + n);
  }
  return lines.join("\n").trim();
}

function escapeMarkdownTableCell(text) {
  return String(text || "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n+/g, "<br>");
}

/** Compose a Markdown view of a video/audio script, suitable for 剪映/Descript 等外部工具。 */
function composeVideoAudioMarkdown(script) {
  const s = script || {};
  const lines = [];
  lines.push("# " + (s.title || "视频/音频脚本"));
  lines.push("");
  lines.push("**预估时长**：" + (s.duration || "（待确认）"));
  lines.push("");
  lines.push("## 分镜脚本");
  lines.push("");
  const scenes = Array.isArray(s.scenes) ? s.scenes : [];
  if (scenes.length) {
    lines.push("| 场景 | 画面 | 旁白 | 时长 |");
    lines.push("| --- | --- | --- | --- |");
    for (const sc of scenes) {
      lines.push(
        "| " +
          escapeMarkdownTableCell(sc.scene) +
          " | " +
          escapeMarkdownTableCell(sc.visuals) +
          " | " +
          escapeMarkdownTableCell(sc.narration) +
          " | " +
          escapeMarkdownTableCell(sc.duration) +
          " |"
      );
    }
  } else {
    lines.push("（暂无分镜，需要补充。）");
  }
  if (s.creativeDirection) {
    lines.push("");
    lines.push("## 创意方向");
    lines.push("");
    lines.push(s.creativeDirection);
  }
  if (Array.isArray(s.productionTips) && s.productionTips.length) {
    lines.push("");
    lines.push("## 制作建议");
    lines.push("");
    for (const t of s.productionTips) lines.push("- " + t);
  }
  if (Array.isArray(s.needsConfirmation) && s.needsConfirmation.length) {
    lines.push("");
    lines.push("## 待确认");
    lines.push("");
    for (const n of s.needsConfirmation) lines.push("- " + n);
  }
  return lines.join("\n").trim() + "\n";
}

/**
 * Build an exportable artifact for a video/audio script.
 * Formats: markdown (.md) / text (.txt) / json (.json) — 适配剪映/Descript 等外部工具。
 */
function buildVideoAudioExport(script, format) {
  const f = String(format || "markdown").trim().toLowerCase();
  const s = normalizeVideoAudioScriptShape(script) || {
    title: "",
    duration: "",
    scenes: [],
    creativeDirection: "",
    productionTips: [],
    needsConfirmation: [],
  };
  if (f === "markdown" || f === "md") {
    return { ok: true, format: "markdown", ext: "md", filterName: "Markdown", content: composeVideoAudioMarkdown(s) };
  }
  if (f === "text" || f === "txt" || f === "plain") {
    return { ok: true, format: "text", ext: "txt", filterName: "纯文本", content: composeVideoAudioPlainText(s) + "\n" };
  }
  if (f === "json") {
    return { ok: true, format: "json", ext: "json", filterName: "JSON", content: JSON.stringify(s, null, 2) + "\n" };
  }
  return { ok: false, code: "unsupported_format", message: "不支持的导出格式：" + f };
}

/**
 * Parse model output into a structured video/audio script.
 * Accepts a single JSON object ({title,duration,scenes,creativeDirection,productionTips,needsConfirmation})
 * or Markdown sections（## 标题 / ## 时长 / ## 分镜脚本 / ## 创意方向 / ## 制作建议）.
 */
function parseVideoAudioOutput(raw) {
  const text = String(raw || "").trim();
  let script = normalizeVideoAudioScriptShape(extractJsonCandidate(text));

  if (!script) {
    const title = extractSection(text, ["标题", "Title"]);
    const duration = extractSection(text, ["时长", "预估时长", "Duration"]);
    const storyboardRaw = extractSection(text, ["分镜脚本", "分镜", "Storyboard", "Scenes"]);
    const creativeDirection = extractSection(text, ["创意方向", "Creative Direction"]);
    const productionTipsRaw = extractSection(text, ["制作建议", "Production Tips"]);
    if (title || storyboardRaw || creativeDirection) {
      script = {
        title: truncateVideoAudioField(title.replace(/\n+/g, " "), 240),
        duration: truncateVideoAudioField(duration.replace(/\n+/g, " "), 60),
        scenes: parseStoryboardScenes(storyboardRaw),
        creativeDirection: truncateVideoAudioField(creativeDirection, MAX_VIDEO_AUDIO_FIELD_CHARS),
        productionTips: normalizeVideoAudioList(productionTipsRaw),
        needsConfirmation: [],
      };
    }
  }

  if (!script) {
    return {
      title: "",
      duration: "",
      scenes: [],
      creativeDirection: "",
      productionTips: [],
      needsConfirmation: [],
      plainText: text,
      parseOk: false,
    };
  }

  const needsConfirmation = script.needsConfirmation.slice();
  if (!script.scenes.length && !needsConfirmation.some((n) => n.includes("分镜"))) {
    needsConfirmation.push("分镜脚本为空，需要用户确认或补充。");
  }
  const normalized = { ...script, needsConfirmation };
  return {
    ...normalized,
    plainText: composeVideoAudioPlainText(normalized),
    parseOk: !!(script.scenes.length || script.creativeDirection),
  };
}

/**
 * Video/audio-specific generation messages: structured storyboard output,
 * owner expression style & creative direction from self context,
 * explicit confirmation marks. Production happens in external tools (剪映/Descript).
 */
function buildVideoAudioMessages({ request, selectedSelfContextText, title }) {
  const selfBlock =
    String(selectedSelfContextText || "").trim() || "（用户未提供可用的本人信息摘录。）";
  const system =
    "你是 Digital Me：在本地代表用户本人策划一支视频/音频作品，产出可直接用于剪映、Descript 等外部制作工具的脚本。\n" +
    "必须严格依据「本次使用的本人信息」作答；禁止编造用户未提供的私人事实。\n" +
    "叙事口吻、表达风格与创意偏好必须符合本人信息中体现的特点；不得越过本人信息中声明的边界。\n" +
    "输出必须是单个 JSON 对象，不要 Markdown 代码围栏，字段为：\n" +
    "{\n" +
    '  "title": "作品标题",\n' +
    '  "duration": "预估总时长（如 60s / 3min）",\n' +
    '  "scenes": [{"scene":"场景 1","visuals":"画面描述","narration":"旁白/台词","duration":"该场景时长"}],\n' +
    '  "creativeDirection": "创意方向与风格基调",\n' +
    '  "productionTips": ["制作建议（适配剪映/Descript 等外部工具），没有则为空数组"],\n' +
    '  "needsConfirmation": ["需要用户确认或补充的部分，例如不确定的事实、时长、素材"]\n' +
    "}\n" +
    "规则：\n" +
    "1. 分镜脚本必须结构化：每个场景都包含画面、旁白与时长。\n" +
    "2. 人名、数据、承诺等关键事实若本人信息中没有依据，必须写入 needsConfirmation，禁止虚构。\n" +
    "3. Digital Me 只负责脚本与创意方向；实际制作由用户在剪映/Descript 等外部工具中完成，不要声称已生成视频或音频文件。";

  const user =
    "任务标题：" +
    String(title || "未命名任务") +
    "\n\n视频/音频创作需求：\n" +
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
  parseEmailOutput,
  buildEmailMessages,
  composeEmailPlainText,
  extractJsonCandidate,
  emailDraftFromParsed: normalizeEmailDraftShape,
  parseVideoAudioOutput,
  buildVideoAudioMessages,
  composeVideoAudioPlainText,
  composeVideoAudioMarkdown,
  buildVideoAudioExport,
  parseStoryboardScenes,
  videoAudioScriptFromParsed: normalizeVideoAudioScriptShape,
};
