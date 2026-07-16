#!/usr/bin/env node
/**
 * List top-level paths that would be included by Git after .gitignore.
 * For Owner confirmation before first commit. Does not commit.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

function run(args) {
  return spawnSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
}

const res = run(["ls-files", "--others", "--exclude-standard"]);
if (res.status !== 0) {
  console.error(res.stderr || "git ls-files failed");
  process.exit(1);
}

const files = (res.stdout || "")
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter(Boolean);

const top = new Map();
for (const f of files) {
  const topName = f.split("/")[0];
  const rec = top.get(topName) || { name: topName, fileCount: 0, samples: [] };
  rec.fileCount += 1;
  if (rec.samples.length < 5) rec.samples.push(f);
  top.set(topName, rec);
}

const sensitivity = {
  "digital-me-package": "高：含本人人格/记忆/人生轨迹蒸馏结果；是否入库须 Owner 确认",
  "digitalme-app": "中：应用代码；注意勿纳入 node_modules 与本地配置",
  scripts: "低-中：工程脚本；基线脚本可入库",
  build: "高/可变：构建与报告；多数应被忽略，仅脱敏报告可考虑",
  "source-materials": "极高：原始私密素材；默认已忽略",
  ".cursor": "低-中：编辑器规则；可按需纳入",
  ".codex": "低-中：代理配置；检查是否含本机路径",
  ".agents": "低-中：代理状态；检查敏感性",
};

const report = {
  task: "P1-00",
  generatedAtUtc: new Date().toISOString(),
  candidateFileCount: files.length,
  topLevel: [...top.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({
      ...t,
      sensitivityNote: sensitivity[t.name] || "待 Owner 审阅",
    })),
};

const outDir = path.join(ROOT, "build", "reports");
fs.mkdirSync(outDir, { recursive: true });
const outJson = path.join(outDir, "p1-00-git-candidates.json");
fs.writeFileSync(outJson, JSON.stringify(report, null, 2), "utf8");

const md = [
  "# P1-00 拟纳入 Git 的顶层清单（待 Owner 确认）",
  "",
  `候选文件总数：${report.candidateFileCount}`,
  "",
  "| 顶层 | 文件数 | 敏感性说明 |",
  "|---|---:|---|",
  ...report.topLevel.map(
    (t) => `| \`${t.name}\` | ${t.fileCount} | ${t.sensitivityNote} |`
  ),
  "",
  "> 首次提交前须 Owner 确认：清单中不含不希望进入版本历史的私密原文。",
  "> 本任务**不执行**首次 commit，也不推送远程。",
  "",
].join("\n");

const outMd = path.join(ROOT, "build", "reports", "p1-00-git-candidates.md");
fs.writeFileSync(outMd, md, "utf8");
// Also place a committed-friendly copy at repo docs path
fs.writeFileSync(path.join(ROOT, "digitalme_p1_00_git_candidates.md"), md, "utf8");

console.log(md);
