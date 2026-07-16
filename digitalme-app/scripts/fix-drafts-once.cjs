const d = require("../src/outputs/document");
const fs = require("fs");
const path = require("path");

const meta =
  "两个版本已保存\n| 文件 | 大小 |\n| 详细版.md | 12KB |\n方法一：用 Word 打开";
console.log("meta isNoise", d.isMetaNoise(meta), "deliverable", d.looksLikeDeliverable(meta));

const body =
  "# 张元林 简历\n\n## 工作经历\n\n- a\n\n## 项目经验\n\n- b\n\n" + "正文段落。".repeat(80);
const reply = meta + "\n\n```markdown\n" + body + "\n```";
const split = d.splitReplyForCanvas(reply, { userQuestion: "请更新简历生成两版" });
console.log({
  title: split.artifact && split.artifact.title,
  hasWork: split.artifact && split.artifact.content.includes("工作经历"),
  chatHasMethod: /方法/.test(split.chat),
  artIsMeta: split.artifact && d.isMetaNoise(split.artifact.content),
});

const root = path.join(process.env.USERPROFILE, "Documents", "DigitalMe");
const out = path.join(root, "成稿");
fs.mkdirSync(out, { recursive: true });
for (const name of fs.readdirSync(root)) {
  if (!name.endsWith(".md") || !name.includes("简历")) continue;
  const md = fs.readFileSync(path.join(root, name), "utf8");
  if (!d.looksLikeResumeBody(md)) {
    console.log("skip", name);
    continue;
  }
  const buf = d.buildDocxFromMarkdown(md, name.replace(/\.md$/, ""));
  const dest = path.join(out, name.replace(/\.md$/, ".docx"));
  fs.writeFileSync(dest, buf);
  console.log("wrote", dest, buf.length);
}
