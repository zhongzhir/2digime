import fs from "node:fs";
import path from "node:path";

const dir = "source-materials/articles";
const files = fs.readdirSync(dir);
const rows = files.map((name) => {
  const st = fs.statSync(path.join(dir, name));
  return { name, kb: Math.round(st.size / 1024), ext: path.extname(name).toLowerCase() };
});

// Group by extension category
const textExt = new Set([".docx", ".txt", ".md", ".markdown", ".pptx", ".pdf"]);
const legacyDoc = new Set([".doc"]);
const needConvert = new Set([".ppt", ".html", ".htm"]);
const media = new Set([".mp3", ".jpg", ".jpeg", ".png", ".wav", ".mp4"]);

function cat(ext) {
  if (textExt.has(ext)) return "可直接蒸馏(docx/txt/md/pptx/pdf)";
  if (legacyDoc.has(ext)) return "旧格式需转换(.doc)";
  if (needConvert.has(ext)) return "需特殊处理(pdf/ppt/html)";
  if (media.has(ext)) return "媒体需转写(音频/图片)";
  return "其他";
}

const byCat = {};
for (const r of rows) {
  const c = cat(r.ext);
  (byCat[c] ||= []).push(r);
}

let out = `# articles 目录清单（共 ${rows.length} 个文件）\n\n`;
for (const c of Object.keys(byCat)) {
  out += `## ${c}（${byCat[c].length}）\n\n`;
  for (const r of byCat[c].sort((a, b) => b.kb - a.kb)) {
    out += `- ${r.name}  —  ${r.kb} KB\n`;
  }
  out += "\n";
}
fs.writeFileSync("build/articles-inventory.md", out, "utf8");
console.log("total files:", rows.length);
for (const c of Object.keys(byCat)) console.log(c, byCat[c].length);
