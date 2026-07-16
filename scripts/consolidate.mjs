// Consolidation: turn the high-recall / low-precision raw distillation into a
// concise high-quality core layer, while preserving raw content as retrieval backing.
//
// Steps:
//   1. Snapshot current package files into digital-me-package/_raw/
//   2. Move raw memory (914) -> memory/raw-memory.jsonl (retrieval corpus)
//      Move raw frameworks (170) -> decision-frameworks-raw.json
//   3. LLM-consolidate: frameworks -> ~15 core; memories -> core set;
//      persona.md & style-guide.md -> clean structured docs.
//   4. Write consolidated content back to the ORIGINAL filenames (what the app reads).
//
// Usage: node scripts/consolidate.mjs

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import os from "node:os";

const PKG = "digital-me-package";
const RAW = path.join(PKG, "_raw");

function loadConfig() {
  const p = path.join(os.homedir(), "AppData", "Roaming", "digitalme-app", "config.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function call(cfg, messages, maxTokens) {
  return new Promise((resolve, reject) => {
    const url = new URL(cfg.baseURL.replace(/\/$/, "") + "/chat/completions");
    const body = JSON.stringify({ model: cfg.model, messages, temperature: 0.3, max_tokens: maxTokens || 4000 });
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        port: url.port || 443,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + cfg.apiKey,
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => {
          try {
            const j = JSON.parse(d);
            if (j.error) return reject(new Error(j.error.message));
            resolve(j.choices?.[0]?.message?.content || "");
          } catch (e) {
            reject(new Error("parse fail: " + d.slice(0, 200)));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function parseJson(raw) {
  let s = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = s.indexOf("["), b = s.lastIndexOf("]");
  const o = s.indexOf("{"), c = s.lastIndexOf("}");
  if (a >= 0 && b > a && (a < o || o < 0)) s = s.slice(a, b + 1);
  else if (o >= 0 && c > o) s = s.slice(o, c + 1);
  return JSON.parse(s);
}

function backup() {
  fs.mkdirSync(RAW, { recursive: true });
  for (const f of ["persona.md", "style-guide.md", "decision-frameworks.json"]) {
    fs.copyFileSync(path.join(PKG, f), path.join(RAW, f));
  }
  fs.copyFileSync(path.join(PKG, "memory", "long-term-memory.jsonl"), path.join(RAW, "long-term-memory.jsonl"));
  console.log("已备份原始文件到 _raw/");
}

async function consolidateFrameworks(cfg) {
  const data = JSON.parse(fs.readFileSync(path.join(PKG, "decision-frameworks.json"), "utf8"));
  const raw = data.frameworks;
  fs.writeFileSync(path.join(PKG, "decision-frameworks-raw.json"), JSON.stringify(data, null, 2), "utf8");

  // Compact representation to fit context.
  const compact = raw.map((f) => ({
    name: f.name,
    domain: f.domain,
    principles: (f.principles || []).slice(0, 4),
  }));
  const sys = "你是知识整合专家。给你一个人的多个判断框架（含大量语义重复），请合并为 12-18 个核心判断框架。每个核心框架应主题清晰、原则精炼。只输出 JSON 数组，元素为 {\"name\",\"domain\",\"principles\":[..],\"positiveSignals\":[..],\"negativeSignals\":[..],\"typicalQuestions\":[..]}，全部中文，不要解释。";
  const usr = "以下是原始框架（JSON）：\n" + JSON.stringify(compact);
  console.log(`整合框架：${raw.length} 个 -> 调用模型…`);
  const out = await call(cfg, [{ role: "system", content: sys }, { role: "user", content: usr }], 6000);
  const merged = parseJson(out);
  const frameworks = merged.map((f, i) => ({
    id: "framework_core_" + String(i + 1).padStart(2, "0"),
    name: f.name,
    domain: f.domain || "general",
    principles: f.principles || [],
    positiveSignals: f.positiveSignals || [],
    negativeSignals: f.negativeSignals || [],
    typicalQuestions: f.typicalQuestions || [],
    sourceRefs: ["consolidated"],
  }));
  fs.writeFileSync(path.join(PKG, "decision-frameworks.json"), JSON.stringify({ frameworks }, null, 2), "utf8");
  console.log(`  -> 核心框架 ${frameworks.length} 个`);
}

async function consolidateMemories(cfg) {
  const file = path.join(PKG, "memory", "long-term-memory.jsonl");
  const items = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  // Preserve raw as retrieval corpus.
  fs.writeFileSync(path.join(PKG, "memory", "raw-memory.jsonl"), items.map((x) => JSON.stringify(x)).join("\n") + "\n", "utf8");

  const sys = "你是知识整合专家。给你一个人的多条记忆/观点（含重复与碎片），请去重、合并同类，输出精炼、独立、信息完整的核心观点。只输出 JSON 数组，元素为 {\"content\",\"confidence\":\"high|medium|low\",\"theme\":\"主题标签\"}，全部中文，不要解释。";

  const batchSize = 70;
  let stage1 = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize).map((m) => m.content);
    console.log(`整合记忆：批 ${Math.floor(i / batchSize) + 1}/${Math.ceil(items.length / batchSize)}（${batch.length} 条）…`);
    try {
      const out = await call(cfg, [{ role: "system", content: sys }, { role: "user", content: JSON.stringify(batch) }], 5000);
      const arr = parseJson(out);
      stage1 = stage1.concat(arr);
    } catch (e) {
      console.log("  批处理出错(跳过): " + e.message);
    }
  }
  console.log(`  一次整合后：${stage1.length} 条，进行跨批终合…`);

  // Final pass to merge across batches.
  let final = stage1;
  if (stage1.length > 40) {
    try {
      const out = await call(cfg, [
        { role: "system", content: sys },
        { role: "user", content: JSON.stringify(stage1.map((x) => x.content)) },
      ], 6000);
      final = parseJson(out);
    } catch (e) {
      console.log("  终合出错，保留一次整合结果: " + e.message);
    }
  }

  const lines = final.map((m, i) =>
    JSON.stringify({
      id: "core_" + String(i + 1).padStart(3, "0"),
      type: "long_term",
      content: m.content,
      theme: m.theme || "",
      confidence: m.confidence || "medium",
      sensitivity: "private",
      createdAt: new Date().toISOString(),
      sourceRefs: ["consolidated"],
      expiresAt: null,
    })
  );
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
  console.log(`  -> 核心记忆 ${lines.length} 条（原始 ${items.length} 条留存于 raw-memory.jsonl）`);
}

async function consolidateDoc(cfg, fileName, kind) {
  const p = path.join(PKG, fileName);
  const content = fs.readFileSync(p, "utf8");
  const sys = kind === "persona"
    ? "你是个人画像整合专家。给你一份包含原始人格卡与大量增量观察（有重复）的文档，请整合为一份结构清晰、无重复、忠实于原意的《人格卡》Markdown，保留原有章节结构（基本定位/长期目标/核心价值观/典型表达方式/行为边界/不应代表本人做出的事项），并把增量观察归并到相应章节。只输出 Markdown。"
    : "你是文风整合专家。给你一份包含原始风格指南与大量增量观察（有重复）的文档，请整合为一份结构清晰、无重复、可操作的《风格指南》Markdown，保留原有维度（总体口吻/结构习惯/句式偏好/修辞/用词/禁用避免/篇幅），把增量观察归并到相应维度。只输出 Markdown。";
  console.log(`整合 ${fileName}（${(content.length / 1024).toFixed(0)}KB）…`);
  const out = await call(cfg, [{ role: "system", content: sys }, { role: "user", content: content }], 8000);
  const md = out.trim().replace(/^```(?:markdown)?/i, "").replace(/```$/, "").trim();
  fs.writeFileSync(p, md + "\n", "utf8");
  console.log(`  -> 已整合，新体积 ${(md.length / 1024).toFixed(0)}KB`);
}

async function main() {
  const cfg = loadConfig();
  console.log("模型：", cfg.model, "\n");
  backup();
  await consolidateFrameworks(cfg);
  await consolidateMemories(cfg);
  await consolidateDoc(cfg, "persona.md", "persona");
  await consolidateDoc(cfg, "style-guide.md", "style");
  console.log("\n整合完成。");
}

main().catch((e) => {
  console.error("整合失败：", e.message);
  process.exit(1);
});
