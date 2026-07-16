// Clean U+FFFD replacement characters from Digital Me Package text fields.
// Strategy: apply high-confidence context fixes, then drop unfixable memory lines
// and prune corrupted strings from framework JSON.
//
// Usage: node scripts/clean-corruption.mjs

import fs from "node:fs";
import path from "node:path";

const PKG = "digital-me-package";
const R = "\uFFFD";
const BACKUP = path.join(PKG, "_raw", "corruption-backup-" + new Date().toISOString().slice(0, 10));

// Context-aware fixes (distillation API often dropped one CJK char → U+FFFD).
const FIXES = [
  [/两分\uFFFD+/g, "二分"],
  [/粗放发展\uFFFD+结束/g, "粗放发展期结束"],
  [/投资策略\uFFFD+/g, "投资策略"],
  [/型媒\uFFFD+/g, "型媒体"],
  [/DeFi总\uFFFD+仓/g, "DeFi总锁仓"],
  [/分享者，\uFFFD+现/g, "分享者，实现"],
  [/传统\uFFFD+融/g, "传统金融"],
  [/市场\uFFFD+体/g, "市场主体"],
  [/因为\uFFFD+新生态/g, "因为创新生态"],
  [/新加\uFFFD+坡/g, "新加坡"],
  [/公司\uFFFD+长性/g, "公司成长性"],
  [/追溯\uFFFD+发现/g, "追溯并发现"],
  [/推动力\uFFFD+。/g, "推动力源。"],
  [/妖魔\uFFFD+'/g, "妖魔化'"],
  [/出版\uFFFD+的品牌/g, "出版社的品牌"],
  [/企业家\uFFFD+体大量/g, "企业家群体大量"],
  [/逐底\uFFFD+争/g, "逐底竞争"],
  [/双重误\uFFFD+。/g, "双重误判。"],
  [/张元\uFFFD+林/g, "张元林"],
  [/张元\uFFFD+主张/g, "张元林主张"],
  [/张元\uFFFD+指出/g, "张元林指出"],
  [/重\uFFFD+平台/g, "重要平台"],
  [/很\uFFFD+可能/g, "很可能"],
  [/违法\uFFFD+罪/g, "违法犯罪"],
  [/企业应\uFFFD+主流/g, "企业应以主流"],
  [/技术\uFFFD+为共同/g, "技术认为可为共同"],
  [/举例\uFFFD+蚁/g, "举例蚂蚁金服"],
  [/指出\uFFFD+白质/g, "指出蛋白质"],
  [/不可篡\uFFFD+性和/g, "不可篡改性和"],
  [/文件\uFFFD+发的加密/g, "文件颁发的加密"],
  [/市场\uFFFD+期不看好/g, "市场长期不看好"],
  [/社会\uFFFD+象/g, "社会现象"],
  [/畸形，\uFFFD+版权/g, "畸形，即版权"],
  [/应从\uFFFD+体、赛事/g, "应从整体、赛事"],
  [/现阶\uFFFD+段的/g, "现阶段的"],
  [/让\uFFFD+相信/g, "让投资者相信"],
  [/用\uFFFD+非法/g, "用于非法"],
  [/优化\uFFFD+输路线/g, "优化运输路线"],
  [/壁\uFFFD+，增加/g, "壁垒，增加"],
  [/合约能\uFFFD+动/g, "合约能够"],
  [/丢包，\uFFFD+化运输/g, "丢包，优化运输"],
  [/内部\uFFFD+施路径/g, "内部实施路径"],
  [/依\uFFFD+Internet/g, "依赖Internet"],
  [/存在持续创造的现金流或\uFFFD+用价值/g, "存在持续创造的现金流或效用价值"],
  [/有效\uFFFD+径/g, "有效路径"],
  [/数字治理\uFFFD+台/g, "数字治理平台"],
  [/\uFFFD+本配置能否/g, "资本配置能否"],
  [/\uFFFD+台是否真正/g, "平台是否真正"],
];

function fixText(s) {
  let t = String(s || "");
  for (const [re, rep] of FIXES) t = t.replace(re, rep);
  return t;
}

function hasR(s) {
  return String(s || "").includes(R);
}

function deepCleanStrings(obj) {
  if (typeof obj === "string") return fixText(obj);
  if (Array.isArray(obj)) return obj.map(deepCleanStrings).filter((x) => typeof x !== "string" || !hasR(x));
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      const cleaned = deepCleanStrings(v);
      if (cleaned === undefined) continue;
      if (Array.isArray(cleaned) && cleaned.length === 0 && Array.isArray(v) && v.length > 0) continue;
      out[k] = cleaned;
    }
    return out;
  }
  return obj;
}

function backup(file) {
  const src = path.join(PKG, file);
  if (!fs.existsSync(src)) return;
  const dest = path.join(BACKUP, file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function cleanJsonl(rel) {
  const p = path.join(PKG, rel);
  if (!fs.existsSync(p)) return { kept: 0, dropped: 0 };
  backup(rel);
  const lines = fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim());
  const kept = [];
  let dropped = 0;
  for (const line of lines) {
    try {
      const o = JSON.parse(line);
      o.content = fixText(o.content);
      if (hasR(o.content)) { dropped++; continue; }
      kept.push(JSON.stringify(o));
    } catch {
      dropped++;
    }
  }
  fs.writeFileSync(p, kept.join("\n") + (kept.length ? "\n" : ""), "utf8");
  return { kept: kept.length, dropped };
}

function cleanJson(rel) {
  const p = path.join(PKG, rel);
  if (!fs.existsSync(p)) return { frameworks: 0, droppedFw: 0 };
  backup(rel);
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  const before = (data.frameworks || []).length;
  data.frameworks = (data.frameworks || [])
    .map((f) => deepCleanStrings(f))
    .filter((f) => {
      const blob = JSON.stringify(f);
      return !hasR(blob) && f.name;
    });
  fs.writeFileSync(p, JSON.stringify(data, null, 2), "utf8");
  return { frameworks: data.frameworks.length, droppedFw: before - data.frameworks.length };
}

function countR(files) {
  let n = 0;
  for (const f of files) {
    const t = fs.readFileSync(path.join(PKG, f), "utf8");
    for (const c of t) if (c === R) n++;
  }
  return n;
}

const targets = [
  "memory/raw-memory.jsonl",
  "memory/long-term-memory.jsonl",
  "decision-frameworks.json",
  "decision-frameworks-raw.json",
];

console.log("备份目录:", BACKUP);
console.log("清洗前替换符:", countR(targets));

const m1 = cleanJsonl("memory/raw-memory.jsonl");
const m2 = cleanJsonl("memory/long-term-memory.jsonl");
const f1 = cleanJson("decision-frameworks.json");
const f2 = cleanJson("decision-frameworks-raw.json");

console.log("raw-memory:", m1);
console.log("core-memory:", m2);
console.log("frameworks:", f1);
console.log("frameworks-raw:", f2);
console.log("清洗后替换符:", countR(targets));
console.log("完成。");
