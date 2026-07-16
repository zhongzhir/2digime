"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { inflateRawSync } = require("node:zlib");
const { PDFParse } = require("pdf-parse");

// ---------- Text extraction ----------

const SUPPORTED_EXTENSIONS = [".docx", ".txt", ".md", ".markdown", ".pptx", ".pdf"];

function supportedFormatsLabel() {
  return ".docx / .txt / .md / .pptx / .pdf";
}

// Locate ZIP End of Central Directory (docx/pptx are OOXML zip archives).
function findZipEocd(buf) {
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

// List all entries in a zip buffer (pure Node; handles non-ASCII paths).
function listZipEntries(buf) {
  const eocd = findZipEocd(buf);
  if (eocd < 0) throw new Error("不是有效的 zip 文件");
  const cdCount = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const entries = [];
  let p = cdOffset;
  for (let n = 0; n < cdCount; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const fname = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const method = buf.readUInt16LE(localOffset + 8);
    const raw = buf.subarray(dataStart, dataStart + compSize);
    const data = method === 0 ? raw : inflateRawSync(raw);
    entries.push({ name: fname, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipEntry(buf, targetName) {
  const entry = listZipEntries(buf).find((e) => e.name === targetName);
  if (!entry) throw new Error("zip 中未找到：" + targetName);
  return entry.data;
}

function ooxmlToText(xml, textTag) {
  const pTag = textTag.replace(":t", ":p");
  xml = xml
    .replace(new RegExp("<" + pTag + "[ >]", "g"), "\n<" + pTag + " ")
    .replace(/<a:br\s*\/>/g, "\n")
    .replace(/<w:br\s*\/>/g, "\n")
    .replace(/<a:tab\s*\/>/g, "\t")
    .replace(/<w:tab\s*\/>/g, "\t");
  const re = new RegExp("<" + textTag + "[^>]*>([\\s\\S]*?)<\\/" + textTag + ">|\\n", "g");
  let text = "";
  let m;
  while ((m = re.exec(xml)) !== null) {
    if (m[0] === "\n") text += "\n";
    else text += m[1];
  }
  return decodeXmlEntities(text)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extractDocx(buf) {
  const xml = readZipEntry(buf, "word/document.xml").toString("utf8");
  return ooxmlToText(xml, "w:t");
}

function slideNumber(name, prefix) {
  const m = new RegExp("^" + prefix + "(\\d+)\\.xml$").exec(name);
  return m ? parseInt(m[1], 10) : 0;
}

function extractPptx(buf) {
  const entries = listZipEntries(buf);
  const slides = entries
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name))
    .sort((a, b) => slideNumber(a.name, "ppt/slides/slide") - slideNumber(b.name, "ppt/slides/slide"));
  if (!slides.length) throw new Error("pptx 中未找到幻灯片内容");

  const notesByNum = new Map();
  for (const e of entries) {
    const m = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/.exec(e.name);
    if (m) notesByNum.set(parseInt(m[1], 10), e);
  }

  const parts = [];
  for (const slide of slides) {
    const num = slideNumber(slide.name, "ppt/slides/slide");
    const slideText = ooxmlToText(slide.data.toString("utf8"), "a:t");
    const notesEntry = notesByNum.get(num);
    const notesText = notesEntry ? ooxmlToText(notesEntry.data.toString("utf8"), "a:t") : "";
    const block = [`--- 幻灯片 ${num} ---`];
    if (slideText) block.push(slideText);
    if (notesText) block.push("[演讲备注] " + notesText);
    if (block.length > 1) parts.push(block.join("\n"));
  }
  const text = parts.join("\n\n").trim();
  if (!text) throw new Error("pptx 中未提取到可读文本");
  return text;
}

async function extractPdf(buf) {
  const parser = new PDFParse({ data: buf });
  try {
    const result = await parser.getText();
    const text = (result.text || "").trim();
    if (!text) throw new Error("pdf 中未提取到可读文本（可能是扫描件，需 OCR）");
    return text;
  } finally {
    await parser.destroy();
  }
}

async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  let buf;
  try {
    if (ext === ".txt" || ext === ".md" || ext === ".markdown") {
      return fs.readFileSync(filePath, "utf8");
    }
    buf = fs.readFileSync(filePath);
  } catch (err) {
    throw new Error(humanizeReadError(err, filePath));
  }
  try {
    if (ext === ".docx") return extractDocx(buf);
    if (ext === ".pptx") return extractPptx(buf);
    if (ext === ".pdf") return extractPdf(buf);
  } catch (err) {
    throw new Error(humanizeReadError(err, filePath));
  }
  throw new Error("暂不支持的格式：" + ext + "（当前支持 " + supportedFormatsLabel() + "）");
}

/** Map OS/cloud placeholder errors to actionable Chinese guidance. */
function humanizeReadError(err, filePath) {
  const code = err && err.code ? String(err.code) : "";
  const msg = String((err && err.message) || err || "");
  const name = path.basename(filePath || "");
  if (
    code === "UNKNOWN" ||
    /文件提供程序|provider.*not|not running|offline|recall|cloud|EIO|EBUSY/i.test(msg)
  ) {
    return (
      `「${name}」正文读不到：文件很可能在云盘里尚未下载到本机（常见于 WPS「仅联机」）。` +
      `请在资源管理器中打开该文件一次，或右键设为「始终保留在此设备上」后再点整理；` +
      `也可把副本放到本机非云盘目录后重新投入。`
    );
  }
  if (code === "ENOENT") return `「${name}」找不到文件，可能已移动或删除。`;
  if (code === "EPERM" || code === "EACCES") return `「${name}」无读取权限。`;
  return msg || "读取失败";
}

/** Cap / sanitize extracted text before model calls (防止百万字拖垮). */
function prepareTextForModel(text, opts = {}) {
  const maxChars = Number(opts.maxChars) > 0 ? Number(opts.maxChars) : 28000;
  const raw = String(text || "");
  const originalChars = raw.length;
  if (!originalChars) {
    return {
      text: "",
      originalChars: 0,
      truncated: false,
      skipped: "",
      truncateMode: "",
      usedChars: 0,
    };
  }
  const sample = raw.slice(0, 8000);
  const bad = (sample.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFD]/g) || []).length;
  if (sample.length > 400 && bad / sample.length > 0.06) {
    return {
      text: "",
      originalChars,
      truncated: true,
      skipped: `疑似乱码或提取失败（约 ${originalChars} 字），已跳过正文`,
      truncateMode: "skipped_garbled",
      usedChars: 0,
    };
  }
  // Extremely large extracts (e.g. bad PDF) — treat as unusable body
  if (originalChars > 400000) {
    return {
      text: "",
      originalChars,
      truncated: true,
      skipped: `正文异常过大（约 ${originalChars} 字），已跳过以免拖垮处理；可改用文件名线索或拆成小文件`,
      truncateMode: "skipped_huge",
      usedChars: 0,
    };
  }
  if (originalChars > maxChars) {
    // Head + tail keeps resume endings / conclusions that pure head-cut loses
    const markerBudget = 80;
    const bodyBudget = Math.max(1000, maxChars - markerBudget);
    const head = Math.floor(bodyBudget * 0.72);
    const tail = bodyBudget - head;
    const omitted = Math.max(0, originalChars - head - tail);
    const textOut =
      raw.slice(0, head) +
      `\n\n…（中间省略约 ${omitted} 字；原约 ${originalChars} 字，智能构建取头尾）…\n\n` +
      raw.slice(-tail);
    return {
      text: textOut,
      originalChars,
      truncated: true,
      skipped: "",
      truncateMode: "head_tail",
      usedChars: textOut.length,
    };
  }
  return {
    text: raw,
    originalChars,
    truncated: false,
    skipped: "",
    truncateMode: "",
    usedChars: originalChars,
  };
}

/**
 * Lightweight likeness gate: drop / downgrade items with almost no lexical overlap
 * against source text (catches obvious fabrication; not a full Reviewer Agent).
 */
function filterLikelyFabricated(agg, sourceText) {
  const src = String(sourceText || "");
  if (src.length < 40 || !agg || typeof agg !== "object") {
    return { agg, dropped: 0, notes: [] };
  }
  const notes = [];
  let dropped = 0;
  const srcLower = src.toLowerCase();

  function tokens(s) {
    const raw = String(s || "").toLowerCase();
    const out = [];
    const parts = raw.replace(/[^\u4e00-\u9fff\w]+/g, " ").split(/\s+/).filter((t) => t.length >= 2);
    for (const t of parts) {
      if (/[\u4e00-\u9fff]/.test(t) && t.length > 2) {
        for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
      } else {
        out.push(t);
      }
    }
    return out;
  }

  function overlapRatio(claim) {
    const ts = tokens(claim);
    if (!ts.length) return 0;
    let hit = 0;
    for (const t of ts) {
      if (srcLower.includes(t)) hit++;
    }
    return hit / ts.length;
  }

  function keepList(list, label) {
    const arr = Array.isArray(list) ? list : [];
    const kept = [];
    for (const item of arr) {
      const claim =
        typeof item === "string"
          ? item
          : item && (item.text || item.statement || item.claim || item.title || item.what || "");
      const ratio = overlapRatio(claim);
      if (String(claim).trim().length >= 12 && ratio < 0.12) {
        dropped++;
        notes.push(`疑似编造已跳过（${label}）：${String(claim).slice(0, 40)}`);
        continue;
      }
      kept.push(item);
    }
    return kept;
  }

  const out = {
    ...agg,
    memories: keepList(agg.memories, "记忆"),
    decisionFrameworks: keepList(agg.decisionFrameworks, "框架"),
    personaNotes: keepList(agg.personaNotes, "人格观察"),
    styleObservations: keepList(agg.styleObservations, "风格"),
  };
  return { agg: out, dropped, notes };
}

function filterLikelyFabricatedIdentity(identity, sourceText) {
  const src = String(sourceText || "");
  if (!identity || typeof identity !== "object") {
    return { identity, dropped: 0, notes: [] };
  }
  // Filename-only path: skip gate (no body to compare)
  if (src.length < 40) {
    return { identity, dropped: 0, notes: [] };
  }
  const notes = [];
  let dropped = 0;
  const srcLower = src.toLowerCase();

  function tokens(s) {
    const raw = String(s || "").toLowerCase();
    const out = [];
    const parts = raw.replace(/[^\u4e00-\u9fff\w]+/g, " ").split(/\s+/).filter((t) => t.length >= 2);
    for (const t of parts) {
      if (/[\u4e00-\u9fff]/.test(t) && t.length > 2) {
        for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
      } else {
        out.push(t);
      }
    }
    return out;
  }

  function overlapRatio(claim) {
    const ts = tokens(claim);
    if (!ts.length) return 0;
    let hit = 0;
    for (const t of ts) {
      if (srcLower.includes(t)) hit++;
    }
    return hit / ts.length;
  }

  const events = [];
  for (const ev of identity.events || []) {
    const claim = (ev && (ev.what || ev.outcome || "")) || "";
    if (String(claim).trim().length >= 12 && overlapRatio(claim) < 0.12) {
      dropped++;
      notes.push(`疑似编造事件已跳过：${String(claim).slice(0, 40)}`);
      continue;
    }
    events.push(ev);
  }
  const inferences = [];
  for (const inf of identity.inferences || []) {
    const claim = (inf && inf.claim) || "";
    if (String(claim).trim().length >= 12 && overlapRatio(claim) < 0.12) {
      dropped++;
      notes.push(`疑似编造推断已跳过：${String(claim).slice(0, 40)}`);
      continue;
    }
    inferences.push(inf);
  }
  return {
    identity: { ...identity, events, inferences },
    dropped,
    notes,
  };
}

/** Try extract; on failure return { ok:false, error, text:"" }. */
async function tryExtractText(filePath) {
  try {
    const text = await extractText(filePath);
    return { ok: true, text, error: "" };
  } catch (err) {
    return { ok: false, text: "", error: String(err.message || err) };
  }
}

// ---------- Chunking ----------

function chunkText(text, size = 12000) {
  const chunks = [];
  const paras = text.split(/\n+/);
  let cur = "";
  for (const para of paras) {
    if (cur.length + para.length > size && cur) {
      chunks.push(cur);
      cur = "";
    }
    cur += para + "\n";
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

// ---------- Distillation prompt ----------

const DISTILL_INSTRUCTION = `你是"数字之我"蒸馏引擎。你的任务是从某个人撰写的素材片段中，提取能刻画"这个人"的结构化信息，用于构建其数字之我。

请只输出一个 JSON 对象（不要任何解释文字、不要 markdown 代码块围栏），结构如下：
{
  "styleObservations": ["对其表达/写作风格的观察，具体可操作，如句式、结构、修辞、用词偏好、禁忌"],
  "personaNotes": ["对其身份、价值观、立场、关注点、思维方式的观察"],
  "decisionFrameworks": [{"name":"框架名","domain":"领域","principles":["原则"],"positiveSignals":["其看重/认可的信号"],"negativeSignals":["其反对/警惕的信号"],"typicalQuestions":["其分析问题时会问的典型问题"]}],
  "memories": [{"content":"其明确表达的观点、判断或立场（用第三人称陈述）","confidence":"high|medium|low"}]
}

要求：
- 只提取有实质信息、能区分"这个人"与他人的内容，不要泛泛而谈；
- 忠实于素材，不要编造素材中没有的信息；
- 每类可以为空数组；宁缺毋滥；
- 全部使用中文。`;

function buildDistillMessages(chunkText, ownerName) {
  return [
    { role: "system", content: DISTILL_INSTRUCTION },
    {
      role: "user",
      content:
        `以下是${ownerName || "此人"}撰写的素材片段，请据此蒸馏：\n\n"""\n` +
        chunkText +
        `\n"""`,
    },
  ];
}

const IDENTITY_EXTRACT_INSTRUCTION = `你是 Digital Me 的「人模型富化」助手（PersonEnrichment）。
材料可为履历、任职证明、嘉宾/会议资料、项目成果、方案报告、专家信息等——请举一反三，不要只认某一种模板。

目标：把材料变成**可调用的自我模型切片**（事实与推断分仓），供时间轴、认知面板与对话注入使用。

产出桶（均可空）：
1) events：带时间的社会事实（角色+机构/活动）
2) outcomes：成就与结果（获奖、出版、落地里程碑等）
3) domains：议题/专长信号（短词）
4) org_touchpoints：机构触点（雇主、主办方、协会等；**不是**人际关系）
5) alter_candidates：自然人关系候选（**必须有具体人名**才填；禁止把机构当人）
6) mind_hooks：观念/原则线索短句（勿当写作风格全文蒸馏）
7) capability_signals：能力边界线索（擅长 / 不负责 / 仅咨询等）
8) inferences：开放推断（非硬事实），type 用：role|domain|activity|org_link|acquaintance|outcome|capability|mind
9) facts：无法升成事件但仍值得记的短句

只输出一个 JSON 对象，不要 markdown 包裹：
{
  "events": [{"when":"","what":"","roleLabels":[],"org":"","actors":[],"outcome":"","facets":["roles"],"confidence":"high|medium|low"}],
  "outcomes": [{"title":"","when":"","note":"","confidence":"medium"}],
  "domains": ["短词"],
  "org_touchpoints": [{"org":"","kind":"employer|host|association|client|other","note":"","confidence":"medium"}],
  "alter_candidates": [{"name":"","relationType":"同事|合作|师徒|好友|其他","context":"","confidence":"low"}],
  "mind_hooks": ["观念线索短句"],
  "capability_signals": [{"signal":"","polarity":"strength|limit|scope","confidence":"low"}],
  "inferences": [{"type":"role|domain|activity|org_link|acquaintance|outcome|capability|mind","claim":"","confidence":"medium|low","basedOn":""}],
  "facts": []
}

规则：宁缺毋滥；忠实材料；不编造人名/机构；机构进 org_touchpoints；无明确人名勿填 alter_candidates；推断勿写成已证实事实；全部中文。`;

function buildIdentityExtractMessages(chunkText, ownerName) {
  return [
    { role: "system", content: IDENTITY_EXTRACT_INSTRUCTION },
    {
      role: "user",
      content:
        `以下是关于${ownerName || "此人"}的材料片段，请做 PersonEnrichment（社会事实 + 围绕本人的可调用切片）：\n\n"""\n` +
        chunkText +
        `\n"""`,
    },
  ];
}

function emptyEnrichment() {
  return {
    events: [],
    facts: [],
    inferences: [],
    outcomes: [],
    domains: [],
    org_touchpoints: [],
    alter_candidates: [],
    mind_hooks: [],
    capability_signals: [],
    claims: [],
  };
}

function pushUniqueStr(arr, seen, value) {
  const v = String(value || "").trim();
  if (!v || hasReplacementChar(v)) return;
  const k = norm(v);
  if (seen.has(k)) return;
  seen.add(k);
  arr.push(v);
}

/** Filename / text signal dictionary — activity/resume/outcome/discourse/custody (not guest-only). */
const MATERIAL_SIGNAL_RULES = [
  {
    id: "custody",
    kind: "custody",
    test: (n, t) =>
      /密码|口令|password|身份证|证件号|银行卡|信用卡|cvv|私钥|secret[_\s-]?key/i.test(n + t),
  },
  {
    id: "activity",
    kind: "identity",
    test: (n, t) => /嘉宾|演讲|论坛|峰会|议程|出席|参会|邀请函|通稿|沙龙|研讨会/.test(n + t),
  },
  {
    id: "resume",
    kind: "identity",
    test: (n, t) =>
      /简历|履历|任职|聘书|职务|董事|理事|顾问|工作证明|参与证明|curriculum\s*vitae|\bcv\b|resume|专家信息|导师/i.test(
        n + "\n" + t
      ),
  },
  {
    id: "outcome",
    kind: "identity",
    test: (n, t) => /获奖|奖项|证书|成果发布|里程碑|出版|出书|专利|落地验收/.test(n + t),
  },
  {
    id: "discourse",
    kind: "persona",
    test: (n, t) => /方案|白皮书|研究报告|评论|随笔|讲稿|文章|观点/.test(n) || /我认为|我们应当/.test(t),
  },
];

const DOMAIN_LEXICON = [
  [/区块链/, "区块链"],
  [/金融|投资|资本/, "金融投资"],
  [/产业|园区|招商/, "产业观察"],
  [/数字经济|数字化/, "数字经济"],
  [/人工智能|AI|大模型/, "人工智能"],
  [/能源|双碳|碳中和/, "能源与双碳"],
];

function detectMaterialSignals(fileName, text) {
  const n = String(fileName || "");
  const t = String(text || "").slice(0, 8000);
  const hits = [];
  for (const rule of MATERIAL_SIGNAL_RULES) {
    if (rule.test(n, t)) hits.push(rule.id);
  }
  const domains = [];
  const blob = n + "\n" + t;
  for (const [re, label] of DOMAIN_LEXICON) {
    if (re.test(blob)) domains.push(label);
  }
  return { hits, domains, nameOnly: !t.trim() };
}

function parseIdentityOutput(raw) {
  let s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  const obj = JSON.parse(s);
  const out = emptyEnrichment();
  const seenE = new Set();
  const seenInf = new Set();
  const seenDom = new Set();
  const seenOut = new Set();
  const seenOrg = new Set();
  const seenAlt = new Set();
  const seenMind = new Set();
  const seenCap = new Set();

  const pushEv = (ev) => {
    if (!ev || !ev.what) return;
    const k = norm(ev.what + "|" + (ev.when || "") + "|" + (ev.org || ""));
    if (seenE.has(k)) return;
    seenE.add(k);
    out.events.push(ev);
  };

  for (const e of Array.isArray(obj.events) ? obj.events : []) {
    const what = e && (e.what || e.value);
    if (!what || hasReplacementChar(what)) continue;
    pushEv({
      when: typeof e.when === "string" ? e.when.trim() : "",
      what: String(what).trim(),
      roleLabels: Array.isArray(e.roleLabels)
        ? e.roleLabels.map((x) => String(x).trim()).filter(Boolean)
        : Array.isArray(e.roles)
          ? e.roles.map((x) => String(x).trim()).filter(Boolean)
          : [],
      org: typeof e.org === "string" ? e.org.trim() : "",
      actors: Array.isArray(e.actors) ? e.actors.map((x) => String(x).trim()).filter(Boolean) : [],
      outcome: typeof e.outcome === "string" ? e.outcome.trim() : "",
      facets: Array.isArray(e.facets) ? e.facets.map(String) : ["roles"],
      confidence: e.confidence === "high" || e.confidence === "low" ? e.confidence : "medium",
    });
  }

  for (const c of Array.isArray(obj.claims) ? obj.claims : []) {
    if (!c || typeof c.value !== "string" || !c.value.trim() || hasReplacementChar(c.value)) continue;
    pushEv({
      when: typeof c.when === "string" ? c.when.trim() : "",
      what: c.value.trim(),
      roleLabels: c.type === "role" || c.type === "profession" ? [c.value.trim().slice(0, 40)] : [],
      org: typeof c.org === "string" ? c.org.trim() : "",
      actors: [],
      outcome: "",
      facets:
        c.type === "interest"
          ? ["interests"]
          : c.type === "project"
            ? ["outcomes", "roles"]
            : c.type === "affiliation"
              ? ["roles"]
              : ["roles"],
      confidence: "medium",
    });
  }

  out.facts = (Array.isArray(obj.facts) ? obj.facts : []).filter(
    (f) => typeof f === "string" && f.trim() && !hasReplacementChar(f)
  );

  for (const inf of Array.isArray(obj.inferences) ? obj.inferences : []) {
    if (!inf || !inf.claim || hasReplacementChar(inf.claim)) continue;
    const claim = String(inf.claim).trim();
    const k = norm(claim);
    if (seenInf.has(k)) continue;
    seenInf.add(k);
    out.inferences.push({
      type: String(inf.type || "activity"),
      claim,
      confidence: inf.confidence === "high" || inf.confidence === "low" ? inf.confidence : "medium",
      basedOn: typeof inf.basedOn === "string" ? inf.basedOn.trim() : "",
    });
  }

  for (const o of Array.isArray(obj.outcomes) ? obj.outcomes : []) {
    if (!o) continue;
    const title = String(o.title || o.what || "").trim();
    if (!title || hasReplacementChar(title)) continue;
    const k = norm(title);
    if (seenOut.has(k)) continue;
    seenOut.add(k);
    out.outcomes.push({
      title,
      when: typeof o.when === "string" ? o.when.trim() : "",
      note: typeof o.note === "string" ? o.note.trim() : "",
      confidence: o.confidence === "high" || o.confidence === "low" ? o.confidence : "medium",
    });
  }

  for (const d of Array.isArray(obj.domains) ? obj.domains : []) {
    pushUniqueStr(out.domains, seenDom, d);
  }

  for (const tp of Array.isArray(obj.org_touchpoints) ? obj.org_touchpoints : []) {
    if (!tp || !tp.org || hasReplacementChar(tp.org)) continue;
    const org = String(tp.org).trim();
    const k = norm(org);
    if (seenOrg.has(k)) continue;
    seenOrg.add(k);
    out.org_touchpoints.push({
      org,
      kind: String(tp.kind || "other"),
      note: typeof tp.note === "string" ? tp.note.trim() : "",
      confidence: tp.confidence === "high" || tp.confidence === "low" ? tp.confidence : "medium",
    });
  }

  for (const a of Array.isArray(obj.alter_candidates) ? obj.alter_candidates : []) {
    if (!a || !a.name || hasReplacementChar(a.name)) continue;
    const name = String(a.name).trim();
    if (/公司|集团|有限|协会|研究院|大学|政府|委员会|基金会|银行|证券|论坛|峰会/.test(name)) continue;
    const k = norm(name);
    if (seenAlt.has(k)) continue;
    seenAlt.add(k);
    out.alter_candidates.push({
      name,
      relationType: String(a.relationType || "其他"),
      context: typeof a.context === "string" ? a.context.trim() : "",
      confidence: a.confidence === "high" || a.confidence === "medium" ? a.confidence : "low",
    });
  }

  for (const m of Array.isArray(obj.mind_hooks) ? obj.mind_hooks : []) {
    pushUniqueStr(out.mind_hooks, seenMind, m);
  }

  for (const c of Array.isArray(obj.capability_signals) ? obj.capability_signals : []) {
    if (!c || !c.signal || hasReplacementChar(c.signal)) continue;
    const signal = String(c.signal).trim();
    const k = norm(signal);
    if (seenCap.has(k)) continue;
    seenCap.add(k);
    out.capability_signals.push({
      signal,
      polarity: ["strength", "limit", "scope"].includes(c.polarity) ? c.polarity : "scope",
      confidence: c.confidence === "high" || c.confidence === "medium" ? c.confidence : "low",
    });
  }

  out.claims = out.events.map((e) => ({ type: "role", value: e.what, when: e.when, org: e.org }));
  return out;
}

function identityResultEmpty(result) {
  if (!result) return true;
  return !(
    (result.events && result.events.length) ||
    (result.claims && result.claims.length) ||
    (result.facts && result.facts.length) ||
    (result.inferences && result.inferences.length) ||
    (result.outcomes && result.outcomes.length) ||
    (result.domains && result.domains.length) ||
    (result.org_touchpoints && result.org_touchpoints.length) ||
    (result.alter_candidates && result.alter_candidates.length) ||
    (result.mind_hooks && result.mind_hooks.length) ||
    (result.capability_signals && result.capability_signals.length)
  );
}

function aggregateIdentity(results) {
  const merged = emptyEnrichment();
  const seenE = new Set();
  const seenF = new Set();
  const seenI = new Set();
  const seenOut = new Set();
  const seenDom = new Set();
  const seenOrg = new Set();
  const seenAlt = new Set();
  const seenMind = new Set();
  const seenCap = new Set();

  for (const r of results || []) {
    const list =
      r.events && r.events.length
        ? r.events
        : (r.claims || []).map((c) => ({
            when: c.when || "",
            what: c.value,
            roleLabels: [],
            org: c.org || "",
            actors: [],
            outcome: "",
            facets: ["roles"],
            confidence: "medium",
          }));
    for (const e of list) {
      if (!e || !e.what) continue;
      const k = norm(e.what + "|" + (e.when || "") + "|" + (e.org || ""));
      if (seenE.has(k)) continue;
      seenE.add(k);
      merged.events.push(e);
    }
    for (const f of r.facts || []) pushUniqueStr(merged.facts, seenF, f);
    for (const inf of r.inferences || []) {
      if (!inf || !inf.claim) continue;
      const k = norm(inf.claim);
      if (seenI.has(k)) continue;
      seenI.add(k);
      merged.inferences.push(inf);
    }
    for (const o of r.outcomes || []) {
      if (!o || !o.title) continue;
      const k = norm(o.title);
      if (seenOut.has(k)) continue;
      seenOut.add(k);
      merged.outcomes.push(o);
    }
    for (const d of r.domains || []) pushUniqueStr(merged.domains, seenDom, d);
    for (const tp of r.org_touchpoints || []) {
      if (!tp || !tp.org) continue;
      const k = norm(tp.org);
      if (seenOrg.has(k)) continue;
      seenOrg.add(k);
      merged.org_touchpoints.push(tp);
    }
    for (const a of r.alter_candidates || []) {
      if (!a || !a.name) continue;
      const k = norm(a.name);
      if (seenAlt.has(k)) continue;
      seenAlt.add(k);
      merged.alter_candidates.push(a);
    }
    for (const m of r.mind_hooks || []) pushUniqueStr(merged.mind_hooks, seenMind, m);
    for (const c of r.capability_signals || []) {
      if (!c || !c.signal) continue;
      const k = norm(c.signal);
      if (seenCap.has(k)) continue;
      seenCap.add(k);
      merged.capability_signals.push(c);
    }
  }
  merged.claims = merged.events.map((e) => ({ type: "role", value: e.what, when: e.when, org: e.org }));
  return merged;
}

/**
 * Signal-dictionary enrichment when body is missing or as a seed.
 * Generalizes beyond any single material type (activity/resume/outcome/discourse).
 */
function provisionalIdentityFromFilename(fileName, ownerName) {
  const base = path.basename(String(fileName || ""), path.extname(String(fileName || "")));
  const owner = ownerName || "本人";
  const out = emptyEnrichment();
  if (!base) return out;

  const { hits, domains } = detectMaterialSignals(base, "");
  out.domains = domains.slice();

  if (hits.includes("activity")) {
    out.events.push({
      when: "",
      what: `${owner}可能以活动相关身份参与一场公开场合（依据文件名信号：活动类）`,
      roleLabels: /嘉宾/.test(base) ? ["嘉宾"] : ["参与者"],
      org: "",
      actors: [],
      outcome: "",
      facets: ["roles"],
      confidence: "low",
    });
    out.inferences.push({
      type: "activity",
      claim: `${owner}可能出席或参与与「${base}」相关的活动`,
      confidence: "medium",
      basedOn: `文件名信号·活动：${base}`,
    });
    out.org_touchpoints.push({
      org: "（待从正文识别主办方）",
      kind: "host",
      note: `线索来自「${base}」`,
      confidence: "low",
    });
    out.inferences.push({
      type: "org_link",
      claim: "材料主办方或整理方可能与本人存在合作/业务往来（待证实）",
      confidence: "low",
      basedOn: `文件名：${base}`,
    });
    out.inferences.push({
      type: "acquaintance",
      claim: "活动中出现的其他人可能是本人认知对象（待证实；须有人名后才登记关系）",
      confidence: "low",
      basedOn: `文件名：${base}`,
    });
  } else if (hits.includes("resume")) {
    out.events.push({
      when: "",
      what: `存在与「${base}」相关的履历/任职材料（正文未读到，仅登记线索）`,
      roleLabels: [],
      org: "",
      actors: [],
      outcome: "",
      facets: ["roles"],
      confidence: "low",
    });
    out.inferences.push({
      type: "role",
      claim: "该材料可能补充本人社会角色或任职线索（需打开正文后核实）",
      confidence: "low",
      basedOn: `文件名信号·履历：${base}`,
    });
  } else if (hits.includes("outcome")) {
    out.outcomes.push({
      title: `与「${base}」相关的成果线索`,
      when: "",
      note: "正文未读到，待核实",
      confidence: "low",
    });
    out.inferences.push({
      type: "outcome",
      claim: `${owner}可能有与「${base}」相关的公开成果或里程碑（待证实）`,
      confidence: "low",
      basedOn: `文件名信号·成果：${base}`,
    });
  } else if (hits.includes("discourse")) {
    out.mind_hooks.push(`文件「${base}」可能含观念/论述线索，建议确认后走观念与表达蒸馏`);
    out.inferences.push({
      type: "mind",
      claim: "该材料更像论述文，适合丰富观念与表达（而非仅存档）",
      confidence: "low",
      basedOn: `文件名信号·论述：${base}`,
    });
  } else {
    out.facts.push(`材料线索：「${base}」（正文暂不可读）`);
  }

  for (const d of domains) {
    out.inferences.push({
      type: "domain",
      claim: `${owner}可能在「${d}」相关议题上有表达或专长（文件名信号）`,
      confidence: "low",
      basedOn: `文件名：${base}`,
    });
  }

  out.claims = out.events.map((e) => ({ type: "role", value: e.what, when: e.when, org: e.org }));
  return out;
}

function parseDistillOutput(raw) {
  // Strip possible code fences.
  let s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  const obj = JSON.parse(s);
  return sanitizeDistillResult({
    styleObservations: Array.isArray(obj.styleObservations) ? obj.styleObservations : [],
    personaNotes: Array.isArray(obj.personaNotes) ? obj.personaNotes : [],
    decisionFrameworks: Array.isArray(obj.decisionFrameworks) ? obj.decisionFrameworks : [],
    memories: Array.isArray(obj.memories) ? obj.memories : [],
  });
}

// ---------- Corruption guard (U+FFFD from bad API/encoding) ----------

const REPLACEMENT_CHAR = "\uFFFD";

function hasReplacementChar(value) {
  if (typeof value === "string") return value.includes(REPLACEMENT_CHAR);
  if (Array.isArray(value)) return value.some(hasReplacementChar);
  if (value && typeof value === "object") return Object.values(value).some(hasReplacementChar);
  return false;
}

function sanitizeDistillResult(result) {
  const keepStr = (x) => typeof x === "string" && x.trim() && !hasReplacementChar(x);
  const cleanFw = (f) => {
    if (!f || !f.name || hasReplacementChar(f)) return null;
    return f;
  };
  return {
    styleObservations: (result.styleObservations || []).filter(keepStr),
    personaNotes: (result.personaNotes || []).filter(keepStr),
    decisionFrameworks: (result.decisionFrameworks || []).map(cleanFw).filter(Boolean),
    memories: (result.memories || []).filter((m) => m && m.content && keepStr(m.content)),
  };
}

function distillResultEmpty(result) {
  return (
    !result.styleObservations.length &&
    !result.personaNotes.length &&
    !result.decisionFrameworks.length &&
    !result.memories.length
  );
}

// ---------- Aggregation (simple client-side dedupe) ----------

function norm(s) {
  return String(s || "").replace(/\s+/g, "").toLowerCase();
}

function aggregate(results) {
  const agg = { styleObservations: [], personaNotes: [], decisionFrameworks: [], memories: [] };
  const seen = { s: new Set(), p: new Set(), m: new Set() };
  for (const r of results) {
    for (const x of r.styleObservations || []) {
      if (!seen.s.has(norm(x))) { seen.s.add(norm(x)); agg.styleObservations.push(x); }
    }
    for (const x of r.personaNotes || []) {
      if (!seen.p.has(norm(x))) { seen.p.add(norm(x)); agg.personaNotes.push(x); }
    }
    for (const x of r.memories || []) {
      const c = x && x.content;
      if (c && !hasReplacementChar(c) && !seen.m.has(norm(c))) { seen.m.add(norm(c)); agg.memories.push(x); }
    }
    for (const f of r.decisionFrameworks || []) {
      if (f && f.name && !hasReplacementChar(f)) agg.decisionFrameworks.push(f);
    }
  }
  return agg;
}

// ---------- Package write-back ----------

function isoNow() {
  return new Date().toISOString();
}

function appendMemories(pkgDir, memories, sourceId) {
  if (!memories.length) return 0;
  const clean = memories.filter((m) => m && m.content && !hasReplacementChar(m.content));
  if (!clean.length) return 0;
  const file = path.join(pkgDir, "memory", "long-term-memory.jsonl");
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim() : "";
  let maxId = 0;
  existing.split("\n").forEach((l) => {
    const mm = /"id"\s*:\s*"mem_(\d+)"/.exec(l);
    if (mm) maxId = Math.max(maxId, parseInt(mm[1], 10));
  });
  const lines = clean.map((m, i) =>
    JSON.stringify({
      id: "mem_" + String(maxId + i + 1).padStart(3, "0"),
      type: "long_term",
      content: m.content,
      confidence: m.confidence || "medium",
      sensitivity: "private",
      createdAt: isoNow(),
      sourceRefs: [sourceId],
      expiresAt: null,
    })
  );
  // Ensure single newline separation (existing file already ends with "\n").
  const raw = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  const needsNL = raw.length > 0 && !raw.endsWith("\n");
  fs.appendFileSync(file, (needsNL ? "\n" : "") + lines.join("\n") + "\n", "utf8");
  return lines.length;
}

function appendFrameworks(pkgDir, frameworks, sourceId) {
  if (!frameworks.length) return 0;
  const file = path.join(pkgDir, "decision-frameworks.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const existingNames = new Set((data.frameworks || []).map((f) => norm(f.name)));
  let added = 0;
  for (const f of frameworks) {
    if (hasReplacementChar(f)) continue;
    if (existingNames.has(norm(f.name))) continue;
    data.frameworks.push({
      id: "framework_" + Date.now() + "_" + added,
      name: f.name,
      domain: f.domain || "general",
      principles: f.principles || [],
      positiveSignals: f.positiveSignals || [],
      negativeSignals: f.negativeSignals || [],
      typicalQuestions: f.typicalQuestions || [],
      sourceRefs: [sourceId],
    });
    added++;
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  return added;
}

function appendObservations(pkgDir, fileName, title, observations, sourceId, sourceTitle) {
  const clean = (observations || []).filter((o) => typeof o === "string" && o.trim() && !hasReplacementChar(o));
  if (!clean.length) return 0;
  const file = path.join(pkgDir, fileName);
  const block =
    `\n\n## 增量蒸馏观察：${sourceTitle}\n` +
    `> 来源：${sourceId} · 蒸馏时间：${isoNow()}\n\n` +
    clean.map((o) => "- " + o).join("\n") +
    "\n";
  fs.appendFileSync(file, block, "utf8");
  return observations.length;
}

function registerSource(pkgDir, source) {
  const file = path.join(pkgDir, "sources", "source-index.json");
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!data.sources.some((s) => s.id === source.id)) {
    data.sources.push(source);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
  }
}

function writeBack(pkgDir, agg, sourceMeta) {
  registerSource(pkgDir, sourceMeta);
  return {
    memories: appendMemories(pkgDir, agg.memories, sourceMeta.id),
    frameworks: appendFrameworks(pkgDir, agg.decisionFrameworks, sourceMeta.id),
    styleObservations: appendObservations(
      pkgDir, "style-guide.md", "风格", agg.styleObservations, sourceMeta.id, sourceMeta.title
    ),
    personaNotes: appendObservations(
      pkgDir, "persona.md", "人格", agg.personaNotes, sourceMeta.id, sourceMeta.title
    ),
  };
}

module.exports = {
  SUPPORTED_EXTENSIONS,
  supportedFormatsLabel,
  extractText,
  tryExtractText,
  humanizeReadError,
  prepareTextForModel,
  filterLikelyFabricated,
  filterLikelyFabricatedIdentity,
  chunkText,
  buildDistillMessages,
  buildIdentityExtractMessages,
  parseDistillOutput,
  parseIdentityOutput,
  sanitizeDistillResult,
  hasReplacementChar,
  distillResultEmpty,
  identityResultEmpty,
  aggregate,
  aggregateIdentity,
  provisionalIdentityFromFilename,
  detectMaterialSignals,
  emptyEnrichment,
  writeBack,
};
