#!/usr/bin/env node
/**
 * P1-00 Package baseline (read-only).
 * - Does not modify digital-me-package
 * - Default output is redacted (no body text, secrets, or full private absolute paths)
 *
 * Usage:
 *   node scripts/p1-00-package-baseline.mjs
 *   node scripts/p1-00-package-baseline.mjs --out build/reports/p1-00-package-baseline.json
 *   node scripts/p1-00-package-baseline.mjs --quiet
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const PACKAGE_DIR = path.join(ROOT, "digital-me-package");

const args = process.argv.slice(2);
const quiet = args.includes("--quiet");
const outIdx = args.indexOf("--out");
const outPath =
  outIdx >= 0 && args[outIdx + 1]
    ? path.resolve(ROOT, args[outIdx + 1])
    : path.join(ROOT, "build", "reports", "p1-00-package-baseline.json");

function sha256Buffer(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return { sha256: sha256Buffer(buf), size: buf.length, buffer: buf };
}

function relPosix(from, to) {
  return path.relative(from, to).split(path.sep).join("/");
}

function walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    const entries = fs.readdirSync(cur, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name === ".git") continue;
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile()) out.push(full);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function redactPathHint(absPath) {
  // Never emit full absolute private paths; keep leaf + parent only.
  const parts = absPath.split(/[/\\]/).filter(Boolean);
  if (parts.length <= 2) return parts.join("/");
  return `…/${parts.slice(-2).join("/")}`;
}

function tryParseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

function parseJsonl(text) {
  const lines = text.split(/\r?\n/);
  let records = 0;
  let empty = 0;
  const errors = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      empty += 1;
      continue;
    }
    try {
      JSON.parse(line);
      records += 1;
    } catch (err) {
      errors.push({ line: i + 1, error: String(err && err.message ? err.message : err) });
    }
  }
  return { records, emptyLines: empty, errors };
}

function isPlaceholderSignature(sigDoc) {
  if (!sigDoc || typeof sigDoc !== "object") return true;
  const key = sigDoc.signingKey || {};
  const hasKey = Boolean(key.publicKey || key.did);
  const sigs = Array.isArray(sigDoc.signatures) ? sigDoc.signatures : [];
  const anyReal = sigs.some((s) => s && typeof s.value === "string" && s.value.trim());
  return !(hasKey && anyReal);
}

function collectFieldStats(obj, stats, depth = 0) {
  if (depth > 8 || obj == null) return;
  if (Array.isArray(obj)) {
    for (const item of obj) collectFieldStats(item, stats, depth + 1);
    return;
  }
  if (typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj)) {
    const key = k.toLowerCase();
    if (key === "status") {
      const s = String(v);
      stats.status[s] = (stats.status[s] || 0) + 1;
    }
    if (key === "confidence") {
      const s = String(v);
      stats.confidence[s] = (stats.confidence[s] || 0) + 1;
    }
    if (key === "kind" || key === "type" || key === "layer") {
      const s = String(v);
      stats.kind[s] = (stats.kind[s] || 0) + 1;
    }
    if (key === "sourcerefs" && Array.isArray(v)) {
      stats.sourceRefsArrays += 1;
      stats.sourceRefsEntries += v.length;
    }
    if (
      key.includes("fact") ||
      key.includes("assertion") ||
      key.includes("inference") ||
      key.includes("claim") ||
      key === "ownerassertion" ||
      key === "currentstate" ||
      key === "developmentintent"
    ) {
      stats.layerHints[key] = (stats.layerHints[key] || 0) + 1;
    }
    if (v && typeof v === "object") collectFieldStats(v, stats, depth + 1);
  }
}

function loadJsonSafe(filePath) {
  try {
    const text = fs.readFileSync(filePath, "utf8");
    const parsed = tryParseJson(text);
    return parsed.ok ? parsed.value : null;
  } catch {
    return null;
  }
}

function analyzeSources(packageDir, filesMeta) {
  const sourceIndexPath = path.join(packageDir, "sources", "source-index.json");
  const sourceIndex = loadJsonSafe(sourceIndexPath);
  const sources = Array.isArray(sourceIndex?.sources)
    ? sourceIndex.sources
    : Array.isArray(sourceIndex)
      ? sourceIndex
      : [];

  const byId = new Map();
  let hashFilled = 0;
  let hashEmpty = 0;
  const unresolvable = [];

  for (const src of sources) {
    if (!src || typeof src !== "object") continue;
    const id = src.id || src.sourceId || src.source_id;
    if (id) byId.set(String(id), src);
    const hash = src.hash || src.contentHash || src.sha256 || "";
    if (typeof hash === "string" && hash.trim()) hashFilled += 1;
    else hashEmpty += 1;

    const loc =
      src.path ||
      src.uri ||
      src.localPath ||
      src.filePath ||
      src.location ||
      src.sourcePath ||
      "";
    if (loc && typeof loc === "string") {
      const absCandidate = path.isAbsolute(loc)
        ? loc
        : path.resolve(packageDir, loc);
      const alt = path.resolve(ROOT, loc);
      const exists = fs.existsSync(absCandidate) || fs.existsSync(alt);
      if (!exists) {
        unresolvable.push({
          sourceId: id || "(missing-id)",
          locationHint: redactPathHint(loc),
        });
      }
    }
  }

  // Collect sourceRefs from JSON/JSONL without printing bodies.
  const referenced = new Map(); // id -> count
  const dangling = [];
  const jsonLike = filesMeta.filter((f) => f.ext === ".json" || f.ext === ".jsonl");

  for (const f of jsonLike) {
    const full = path.join(packageDir, f.relativePath);
    let text;
    try {
      text = fs.readFileSync(full, "utf8");
    } catch {
      continue;
    }
    if (f.ext === ".json") {
      const parsed = tryParseJson(text);
      if (!parsed.ok) continue;
      walkSourceRefs(parsed.value, f.relativePath, referenced, byId, dangling);
    } else {
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        try {
          walkSourceRefs(JSON.parse(t), f.relativePath, referenced, byId, dangling);
        } catch {
          /* counted in parse section */
        }
      }
    }
  }

  const unusedSources = [];
  for (const id of byId.keys()) {
    if (!referenced.has(id)) unusedSources.push(id);
  }

  return {
    sourceIndexCount: sources.length,
    hashCoverage: {
      filled: hashFilled,
      empty: hashEmpty,
      coverageRatio:
        sources.length === 0 ? null : Number((hashFilled / sources.length).toFixed(4)),
    },
    danglingSourceRefs: {
      count: dangling.length,
      samples: dangling.slice(0, 20),
    },
    unresolvableLocations: {
      count: unresolvable.length,
      samples: unresolvable.slice(0, 20),
    },
    unusedSourceIds: {
      count: unusedSources.length,
      samples: unusedSources.slice(0, 20),
    },
    referencedSourceIds: referenced.size,
  };
}

function walkSourceRefs(node, fileRel, referenced, byId, dangling, depth = 0) {
  if (node == null || depth > 10) return;
  if (Array.isArray(node)) {
    for (const item of node) walkSourceRefs(item, fileRel, referenced, byId, dangling, depth + 1);
    return;
  }
  if (typeof node !== "object") return;

  if (Array.isArray(node.sourceRefs)) {
    for (const ref of node.sourceRefs) {
      const id =
        typeof ref === "string"
          ? ref
          : ref && (ref.sourceId || ref.id || ref.source_id || ref.ref);
      if (!id) continue;
      const sid = String(id);
      referenced.set(sid, (referenced.get(sid) || 0) + 1);
      if (!byId.has(sid)) {
        dangling.push({ sourceId: sid, fromFile: fileRel });
      }
    }
  }

  for (const v of Object.values(node)) {
    if (v && typeof v === "object") {
      walkSourceRefs(v, fileRel, referenced, byId, dangling, depth + 1);
    }
  }
}

function analyzeLayerDistribution(packageDir) {
  const stats = {
    status: {},
    confidence: {},
    kind: {},
    layerHints: {},
    sourceRefsArrays: 0,
    sourceRefsEntries: 0,
    jsonlRecordCounts: {},
  };

  const targets = [
    "memory/long-term-memory.jsonl",
    "memory/raw-memory.jsonl",
    "life/events.jsonl",
    "life/inferences.jsonl",
    "decision-frameworks.json",
    "decision-frameworks-raw.json",
    "life/roles.json",
    "life/relations.json",
    "life/outcomes.json",
    "policies/boundaries.json",
    "identity.json",
  ];

  for (const rel of targets) {
    const full = path.join(packageDir, rel);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, "utf8");
    if (rel.endsWith(".jsonl")) {
      let n = 0;
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (!t) continue;
        try {
          const obj = JSON.parse(t);
          n += 1;
          collectFieldStats(obj, stats);
        } catch {
          /* ignore */
        }
      }
      stats.jsonlRecordCounts[rel] = n;
    } else {
      const parsed = tryParseJson(text);
      if (parsed.ok) collectFieldStats(parsed.value, stats);
    }
  }

  return stats;
}

function buildManifestDigest(filesMeta) {
  const lines = filesMeta.map((f) => `${f.sha256}  ${f.size}  ${f.relativePath}`);
  const joined = lines.join("\n");
  return {
    fileCount: filesMeta.length,
    totalBytes: filesMeta.reduce((a, f) => a + f.size, 0),
    manifestSha256: sha256Buffer(Buffer.from(joined, "utf8")),
  };
}

function main() {
  if (!fs.existsSync(PACKAGE_DIR)) {
    console.error("Package directory not found: digital-me-package/");
    process.exit(2);
  }

  const allFiles = walkFiles(PACKAGE_DIR);
  const filesMeta = [];
  const parseReport = { json: [], jsonl: [], other: 0 };
  let jsonOk = 0;
  let jsonFail = 0;
  let jsonlOkFiles = 0;
  let jsonlFailFiles = 0;
  let jsonlRecords = 0;
  let jsonlLineErrors = 0;

  for (const full of allFiles) {
    const relativePath = relPosix(PACKAGE_DIR, full);
    const ext = path.extname(full).toLowerCase();
    const { sha256, size, buffer } = sha256File(full);
    const entry = { relativePath, size, sha256, ext, parse: null };
    filesMeta.push(entry);

    if (ext === ".json") {
      const text = buffer.toString("utf8");
      const parsed = tryParseJson(text);
      entry.parse = parsed.ok ? { ok: true } : { ok: false, error: parsed.error };
      parseReport.json.push({ relativePath, ok: parsed.ok, error: parsed.ok ? undefined : parsed.error });
      if (parsed.ok) jsonOk += 1;
      else jsonFail += 1;
    } else if (ext === ".jsonl") {
      const text = buffer.toString("utf8");
      const r = parseJsonl(text);
      const ok = r.errors.length === 0;
      entry.parse = {
        ok,
        records: r.records,
        emptyLines: r.emptyLines,
        errorCount: r.errors.length,
      };
      parseReport.jsonl.push({
        relativePath,
        ok,
        records: r.records,
        emptyLines: r.emptyLines,
        errorCount: r.errors.length,
        sampleErrors: r.errors.slice(0, 3),
      });
      jsonlRecords += r.records;
      jsonlLineErrors += r.errors.length;
      if (ok) jsonlOkFiles += 1;
      else jsonlFailFiles += 1;
    } else {
      parseReport.other += 1;
    }
  }

  const digest = buildManifestDigest(filesMeta);
  const manifest = loadJsonSafe(path.join(PACKAGE_DIR, "manifest.json")) || {};
  const signature = loadJsonSafe(path.join(PACKAGE_DIR, "trust", "signature.json"));
  const sourceAnalysis = analyzeSources(PACKAGE_DIR, filesMeta);
  const layerDistribution = analyzeLayerDistribution(PACKAGE_DIR);

  const report = {
    task: "P1-00",
    generatedAtUtc: new Date().toISOString(),
    redacted: true,
    packageRootHint: "digital-me-package/",
    packageDigest: digest,
    manifest: {
      packageVersion: manifest.packageVersion ?? null,
      updatedAt: manifest.updatedAt ?? null,
      packageType: manifest.packageType ?? null,
      interopEnabled:
        manifest.interop && typeof manifest.interop === "object"
          ? Object.fromEntries(
              Object.entries(manifest.interop).map(([k, v]) => [
                k,
                v && typeof v === "object" ? Boolean(v.enabled) : v,
              ])
            )
          : null,
    },
    parseSummary: {
      jsonFiles: { ok: jsonOk, fail: jsonFail },
      jsonlFiles: { ok: jsonlOkFiles, fail: jsonlFailFiles },
      jsonlRecords,
      jsonlLineErrors,
      otherFiles: parseReport.other,
    },
    sourceAnalysis,
    layerDistribution: {
      status: layerDistribution.status,
      confidence: layerDistribution.confidence,
      kind: layerDistribution.kind,
      layerHints: layerDistribution.layerHints,
      sourceRefsArrays: layerDistribution.sourceRefsArrays,
      sourceRefsEntries: layerDistribution.sourceRefsEntries,
      jsonlRecordCounts: layerDistribution.jsonlRecordCounts,
    },
    trust: {
      signatureFilePresent: Boolean(signature),
      signatureUsable: signature ? !isPlaceholderSignature(signature) : false,
      signatureMode: signature
        ? isPlaceholderSignature(signature)
          ? "placeholder"
          : "populated"
        : "missing",
    },
    files: filesMeta.map((f) => ({
      relativePath: f.relativePath,
      size: f.size,
      sha256: f.sha256,
      parse: f.parse,
    })),
    tree: filesMeta.map((f) => f.relativePath),
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  const summaryPath = outPath.replace(/\.json$/i, ".summary.md");
  const summary = [
    "# P1-00 Package 基线摘要（脱敏）",
    "",
    `- 生成时间（UTC）：${report.generatedAtUtc}`,
    `- Package version：${report.manifest.packageVersion}`,
    `- manifest.updatedAt：${report.manifest.updatedAt}`,
    `- 文件数：${digest.fileCount}`,
    `- 总字节：${digest.totalBytes}`,
    `- 清单 SHA-256：\`${digest.manifestSha256}\``,
    `- JSON：ok=${jsonOk}, fail=${jsonFail}`,
    `- JSONL 文件：ok=${jsonlOkFiles}, fail=${jsonlFailFiles}; records=${jsonlRecords}; lineErrors=${jsonlLineErrors}`,
    `- source index 数量：${sourceAnalysis.sourceIndexCount}`,
    `- source hash 覆盖：filled=${sourceAnalysis.hashCoverage.filled}, empty=${sourceAnalysis.hashCoverage.empty}`,
    `- 悬空 sourceRefs：${sourceAnalysis.danglingSourceRefs.count}`,
    `- 无法解析来源位置：${sourceAnalysis.unresolvableLocations.count}`,
    `- 未被引用的 source id：${sourceAnalysis.unusedSourceIds.count}`,
    `- 签名状态：${report.trust.signatureMode}`,
    "",
    "本报告默认脱敏：不含正文、密钥/Token、完整本机绝对路径。",
    "",
  ].join("\n");
  fs.writeFileSync(summaryPath, summary, "utf8");

  if (!quiet) {
    console.log(summary);
    console.log(`report: ${relPosix(ROOT, outPath)}`);
    console.log(`summary: ${relPosix(ROOT, summaryPath)}`);
  } else {
    console.log(
      JSON.stringify({
        ok: jsonFail === 0 && jsonlFailFiles === 0 && jsonlLineErrors === 0,
        fileCount: digest.fileCount,
        totalBytes: digest.totalBytes,
        manifestSha256: digest.manifestSha256,
        report: relPosix(ROOT, outPath),
      })
    );
  }

  if (jsonFail > 0 || jsonlFailFiles > 0 || jsonlLineErrors > 0) process.exitCode = 1;
}

main();
