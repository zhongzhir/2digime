// Re-run style-guide consolidation only, with empty-output guard + retry.
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import os from "node:os";

const PKG = "digital-me-package";
function loadConfig() {
  return JSON.parse(fs.readFileSync(path.join(os.homedir(), "AppData", "Roaming", "digitalme-app", "config.json"), "utf8"));
}
function call(cfg, messages, maxTokens) {
  return new Promise((resolve, reject) => {
    const url = new URL(cfg.baseURL.replace(/\/$/, "") + "/chat/completions");
    const body = JSON.stringify({ model: cfg.model, messages, temperature: 0.3, max_tokens: maxTokens || 8000 });
    const req = https.request({ hostname: url.hostname, path: url.pathname + url.search, port: url.port || 443, method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.apiKey, "Content-Length": Buffer.byteLength(body) } }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => { try { const j = JSON.parse(d); if (j.error) return reject(new Error(j.error.message)); resolve(j.choices?.[0]?.message?.content || ""); } catch (e) { reject(new Error("parse fail: " + d.slice(0, 200))); } });
    });
    req.on("error", reject); req.write(body); req.end();
  });
}

async function main() {
  const cfg = loadConfig();
  const p = path.join(PKG, "style-guide.md");
  const content = fs.readFileSync(p, "utf8");
  const sys = "你是文风整合专家。给你一份包含原始风格指南与大量增量观察（有重复）的文档，请整合为一份结构清晰、无重复、可操作的《风格指南》Markdown，保留原有维度（总体口吻/结构习惯/句式偏好/修辞/用词/禁用避免/篇幅），把增量观察归并到相应维度。只输出 Markdown，务必给出完整内容，不要返回空白。";
  console.log(`输入 ${(content.length / 1024).toFixed(0)}KB，调用模型…`);
  let md = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const out = await call(cfg, [{ role: "system", content: sys }, { role: "user", content }], 8000);
    md = out.trim().replace(/^```(?:markdown)?/i, "").replace(/```$/, "").trim();
    console.log(`  第 ${attempt} 次返回 ${(md.length / 1024).toFixed(1)}KB`);
    if (md.length > 500) break;
  }
  if (md.length < 500) { console.error("多次返回仍过短，放弃写入（保留原文件）。"); process.exit(1); }
  fs.writeFileSync(p, md + "\n", "utf8");
  console.log(`已写入 style-guide.md，新体积 ${(md.length / 1024).toFixed(1)}KB`);
}
main().catch((e) => { console.error("失败：", e.message); process.exit(1); });
