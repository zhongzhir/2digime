// Batch distiller: reuses the app's builder engine + DeepSeek config to
// distill many articles into the Digital Me Package.
//
// Selection:
//   - If build/distill-list.txt exists (one filename per line), process those.
//   - Otherwise process all supported formats in source-materials/articles,
//     skipping sources already registered, up to --limit N.
//
// Usage:
//   node scripts/distill-batch.mjs            # all not-yet-done
//   node scripts/distill-batch.mjs --limit 5  # first 5 not-yet-done
//   (or provide build/distill-list.txt for an explicit curated list)

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import os from "node:os";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const b = require("../digitalme-app/src/builder.js");

const ARTICLES = "source-materials/articles";
const PKG_DIR = "digital-me-package";
const LIST_FILE = "build/distill-list.txt";

// ---- Load DeepSeek config from Electron userData ----
function loadConfig() {
  const p = path.join(os.homedir(), "AppData", "Roaming", "digitalme-app", "config.json");
  if (!fs.existsSync(p)) throw new Error("未找到应用配置（请先在 App 设置里填好 DeepSeek）：" + p);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function callModel(cfg, messages) {
  return new Promise((resolve, reject) => {
    const url = new URL(cfg.baseURL.replace(/\/$/, "") + "/chat/completions");
    const body = JSON.stringify({ model: cfg.model, messages, temperature: 0.5 });
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
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            if (json.error) return reject(new Error(json.error.message || "model error"));
            resolve(json.choices?.[0]?.message?.content || "");
          } catch (e) {
            reject(new Error("parse fail: " + data.slice(0, 200)));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function alreadyDone() {
  const idx = path.join(PKG_DIR, "sources", "source-index.json");
  const data = JSON.parse(fs.readFileSync(idx, "utf8"));
  return new Set(data.sources.map((s) => (s.title || "").replace(/\s+/g, "")));
}

function pickFiles(limit) {
  if (fs.existsSync(LIST_FILE)) {
    return fs
      .readFileSync(LIST_FILE, "utf8")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const done = alreadyDone();
  const all = fs
    .readdirSync(ARTICLES)
    .filter((f) => [".docx", ".txt", ".md", ".markdown", ".pptx", ".pdf"].includes(path.extname(f).toLowerCase()))
    .filter((f) => !done.has(f.replace(/\s+/g, "")));
  return limit ? all.slice(0, limit) : all;
}

async function distillFile(cfg, fileName) {
  const fp = path.join(ARTICLES, fileName);
  let text;
  try {
    text = await b.extractText(fp);
  } catch (e) {
    console.log(`  跳过（提取失败）：${e.message}`);
    return null;
  }
  if (!text || text.length < 100) {
    console.log("  跳过（内容过少）");
    return null;
  }
  const chunks = b.chunkText(text, 12000);
  const results = [];
  for (let i = 0; i < chunks.length; i++) {
    process.stdout.write(`  段 ${i + 1}/${chunks.length}…`);
    try {
      const raw = await callModel(cfg, b.buildDistillMessages(chunks[i], "张元林"));
      results.push(b.parseDistillOutput(raw));
      process.stdout.write(" ok\n");
    } catch (e) {
      process.stdout.write(" 出错(跳过): " + e.message + "\n");
    }
  }
  const agg = b.aggregate(results);
  const meta = {
    id: "src_art_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1000),
    type: "article",
    title: fileName,
    author: "张元林",
    createdAt: new Date().toISOString(),
    location: fp,
    sensitivity: "private",
    usedFor: ["style-guide", "persona", "decision-frameworks", "long-term-memory"],
  };
  const r = b.writeBack(PKG_DIR, agg, meta);
  console.log(
    `  写入：记忆+${r.memories} 框架+${r.frameworks} 风格+${r.styleObservations} 人格+${r.personaNotes}`
  );
  return r;
}

async function main() {
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg >= 0 ? parseInt(process.argv[limitArg + 1], 10) : 0;
  const cfg = loadConfig();
  console.log("模型：", cfg.model, "@", cfg.baseURL);

  const files = pickFiles(limit);
  console.log(`待蒸馏 ${files.length} 个文件\n`);

  let done = 0;
  const totals = { memories: 0, frameworks: 0, styleObservations: 0, personaNotes: 0 };
  for (const f of files) {
    console.log(`[${done + 1}/${files.length}] ${f}`);
    const r = await distillFile(cfg, f);
    if (r) for (const k of Object.keys(totals)) totals[k] += r[k] || 0;
    done++;
  }
  console.log("\n完成。累计写入：", JSON.stringify(totals));
}

main().catch((e) => {
  console.error("批量蒸馏失败：", e.message);
  process.exit(1);
});
