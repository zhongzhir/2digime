"use strict";

const { deflateRawSync } = require("node:zlib");

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : c >>> 1;
  }
  return ~c >>> 0;
}

function zipStore(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    const compressed = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    const cd = Buffer.alloc(46 + nameBuf.length);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(compressed.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    nameBuf.copy(cd, 46);
    locals.push(Buffer.concat([local, compressed]));
    central.push(cd);
    offset += local.length + compressed.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, end]);
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Resume-friendly fonts: 微软雅黑 headings, 宋体 body — works in WPS. */
function rFonts(eastAsia, ascii) {
  const ea = eastAsia || "宋体";
  const west = ascii || "Times New Roman";
  return `<w:rFonts w:ascii="${west}" w:hAnsi="${west}" w:eastAsia="${ea}" w:cs="${ea}"/>`;
}

function runXml(text, { size = 21, bold = false, eastAsia = "宋体", ascii = "Times New Roman" } = {}) {
  return `<w:r><w:rPr>${rFonts(eastAsia, ascii)}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>${
    bold ? "<w:b/><w:bCs/>" : ""
  }</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function paraXml(runsInner, { after = 80, before = 0, align } = {}) {
  const jc = align ? `<w:jc w:val="${align}"/>` : "";
  return `<w:p><w:pPr><w:spacing w:before="${before}" w:after="${after}"/>${jc}</w:pPr>${runsInner}</w:p>`;
}

function markdownToDocxParagraphs(md) {
  const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
  const paras = [];
  for (const line of lines) {
    if (!line.trim()) {
      paras.push(paraXml(runXml(""), { after: 40 }));
      continue;
    }
    if (/^\|?\s*:?-{3,}/.test(line)) continue;

    let text = line;
    let size = 21;
    let bold = false;
    let eastAsia = "宋体";
    let before = 0;
    let after = 80;
    let align;

    if (/^###\s+/.test(text)) {
      text = text.replace(/^###\s+/, "");
      size = 22;
      bold = true;
      eastAsia = "微软雅黑";
      before = 160;
    } else if (/^##\s+/.test(text)) {
      text = text.replace(/^##\s+/, "");
      size = 24;
      bold = true;
      eastAsia = "微软雅黑";
      before = 200;
      after = 100;
    } else if (/^#\s+/.test(text)) {
      text = text.replace(/^#\s+/, "");
      size = 32;
      bold = true;
      eastAsia = "微软雅黑";
      before = 0;
      after = 160;
      align = "center";
    } else if (/^[-*]\s+/.test(text)) {
      text = "• " + text.replace(/^[-*]\s+/, "");
    } else if (/^\|.+\|/.test(text)) {
      text = text
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean)
        .join("  ·  ");
      size = 20;
    }

    if (/^\*\*.+\*\*$/.test(text)) {
      text = text.replace(/^\*\*|\*\*$/g, "");
      bold = true;
    } else {
      text = text.replace(/\*\*(.+?)\*\*/g, "$1");
    }

    paras.push(paraXml(runXml(text, { size, bold, eastAsia }), { before, after, align }));
  }
  return paras.join("");
}

function buildDocxFromMarkdown(md, title) {
  const body = markdownToDocxParagraphs(md);
  // Avoid duplicating title if md already starts with same heading
  const firstLine = String(md || "")
    .trim()
    .split("\n")[0]
    .replace(/^#\s+/, "");
  const titlePara =
    title && firstLine !== title
      ? paraXml(runXml(title, { size: 36, bold: true, eastAsia: "微软雅黑" }), {
          after: 200,
          align: "center",
        })
      : "";

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${titlePara}
    ${body}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/>
</Relationships>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        ${rFonts("宋体", "Times New Roman")}
        <w:sz w:val="21"/><w:szCs w:val="21"/>
        <w:lang w:val="en-US" w:eastAsia="zh-CN"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:qFormat/>
    <w:rPr>${rFonts("宋体", "Times New Roman")}<w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr>
  </w:style>
</w:styles>`;

  const fontTable = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:font w:name="宋体"><w:charset w:val="86"/><w:family w:val="auto"/><w:pitch w:val="variable"/></w:font>
  <w:font w:name="微软雅黑"><w:charset w:val="86"/><w:family w:val="swiss"/><w:pitch w:val="variable"/></w:font>
  <w:font w:name="Times New Roman"><w:charset w:val="00"/><w:family w:val="roman"/><w:pitch w:val="variable"/></w:font>
</w:fonts>`;

  return zipStore([
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rels },
    { name: "word/document.xml", data: documentXml },
    { name: "word/_rels/document.xml.rels", data: docRels },
    { name: "word/styles.xml", data: stylesXml },
    { name: "word/fontTable.xml", data: fontTable },
  ]);
}

function isMetaNoise(text) {
  const t = String(text || "");
  const signals = [
    /打开方式|下载方式|如何打开|用 Word 打开|用WPS|Markdown 文件/,
    /已保存到|两个版本已|文件列表|~\d+\s*KB/,
    /导出 Word|成稿预览|请到右侧/,
    /\|?\s*文件\s*\|?\s*大小/,
    /方法[一二三123]|方式[一二三123]/,
  ];
  const hits = signals.filter((re) => re.test(t)).length;
  if (hits >= 2) return true;
  if (hits >= 1 && !looksLikeResumeBody(t)) return true;
  return false;
}

function looksLikeResumeBody(text) {
  const t = String(text || "");
  const keys = ["工作经历", "项目经验", "教育背景", "专业概述", "基本信息", "联系方式", "简历"];
  const hit = keys.filter((k) => t.includes(k)).length;
  return hit >= 2 || (hit >= 1 && /#{1,3}\s*.*简历/.test(t) && t.length > 400);
}

function looksLikeDeliverable(text) {
  const t = String(text || "");
  if (isMetaNoise(t)) return false;
  if (/^(你说得对|抱歉|这是|关于你问|更新日期|原因是)/m.test(t) && t.length < 1200) {
    return false;
  }
  return (
    looksLikeResumeBody(t) ||
    /^#{1,3}\s.+(报告|请示|方案|版本)/m.test(t) ||
    (t.length > 800 && /^#{1,3}\s/m.test(t) && /版本[一二]|详细版|精简版/.test(t) && !isMetaNoise(t))
  );
}

function extractFencedBlocks(text) {
  const re = /```(?:markdown|md)?\s*([\s\S]*?)```/gi;
  const out = [];
  let m;
  while ((m = re.exec(text))) {
    const content = (m[1] || "").trim();
    if (content) out.push(content);
  }
  return out;
}

function pickBestDeliverable(blocks) {
  const scored = blocks
    .filter((b) => !isMetaNoise(b))
    .map((b) => ({
      b,
      score:
        (looksLikeResumeBody(b) ? 100 : 0) +
        (looksLikeDeliverable(b) ? 40 : 0) +
        Math.min(b.length / 50, 80),
    }))
    .sort((a, b) => b.score - a.score);
  return scored[0] && scored[0].score >= 40 ? scored[0].b : null;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeArtifact(content, titleMatch) {
  return {
    id: "art_" + Date.now().toString(36),
    type: "markdown",
    title: (titleMatch && titleMatch[1].slice(0, 48)) || "成稿草稿",
    content,
    createdAt: new Date().toISOString(),
  };
}

function splitReplyForCanvas(reply, opts = {}) {
  const text = String(reply || "").trim();
  if (!text) return { chat: "", artifact: null };

  const userQ = String(opts.userQuestion || "").trim();
  const userWantsDoc = isDocumentRequest(userQ);
  const isFollowUpQa = isConversationalQuestion(userQ);

  if (isFollowUpQa && !userWantsDoc) {
    return { chat: text, artifact: null };
  }

  const fences = extractFencedBlocks(text);
  const bestFence = pickBestDeliverable(fences);
  if (bestFence && (userWantsDoc || looksLikeDeliverable(bestFence))) {
    let chat = text;
    for (const f of fences) {
      chat = chat.replace(new RegExp("```(?:markdown|md)?\\s*" + escapeRegExp(f) + "\\s*```", "i"), "");
    }
    chat = chat.replace(/\n{3,}/g, "\n\n").trim();
    const titleMatch = /^(?:#\s+)?(.+)$/m.exec(bestFence);
    return {
      chat:
        chat ||
        "成稿已写好。完整内容在右侧「成稿预览」。请点「导出 Word」用 WPS 打开（宋体/雅黑排版）。",
      artifact: makeArtifact(bestFence, titleMatch),
    };
  }

  if (userWantsDoc && looksLikeDeliverable(text) && !isMetaNoise(text) && text.length >= 400) {
    const titleMatch = /^(?:#\s+)?(.+)$/m.exec(text);
    return {
      chat: "成稿已写好。完整内容在右侧「成稿预览」。请点「导出 Word」用 WPS 打开（宋体/雅黑排版）。",
      artifact: makeArtifact(text, titleMatch),
    };
  }

  return { chat: text, artifact: null };
}

function isConversationalQuestion(q) {
  if (!q) return false;
  if (/[？?]\s*$/.test(q)) return true;
  if (
    /^(为什么|为何|怎么|如何|是不是|是否|对吗|对不对|什么意思|啥意思|解释|说明一下|你说的|刚才|那句|更新日期|幻觉)/.test(
      q
    )
  ) {
    return true;
  }
  if (/(为什么|是不是幻觉|对吗|什么意思)/.test(q) && q.length < 80) return true;
  return false;
}

function isDocumentRequest(q) {
  if (!q) return false;
  return /(写|生成|起草|更新|改一?版|整理|保存).{0,24}(简历|报告|请示|方案|备忘录|提纲|大纲|文稿|文章)|两版|详细版|一页纸|1-2页/.test(
    q
  );
}

function suggestArtifact(reply, opts) {
  return splitReplyForCanvas(reply, opts).artifact;
}

module.exports = {
  buildDocxFromMarkdown,
  suggestArtifact,
  splitReplyForCanvas,
  isDocumentRequest,
  isConversationalQuestion,
  isMetaNoise,
  looksLikeResumeBody,
  looksLikeDeliverable,
};
