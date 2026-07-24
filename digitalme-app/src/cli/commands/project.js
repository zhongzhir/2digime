"use strict";

/**
 * dm project —— 项目上下文。
 *
 * 分析目录的项目结构：清单文件（package.json）、README、常见配置文件、
 * 语言分布与顶层目录结构，生成确定性的项目摘要（不调用模型），
 * 可直接作为 Digital Me 的项目背景上下文。
 */

const fs = require("node:fs");
const path = require("node:path");
const { languageOf } = require("./review");

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  "test-results",
]);

const MAX_TOP_ENTRIES = 24;
const MAX_WALK_DEPTH = 3;
const MAX_WALK_VISITS = 4000;
const MAX_KEY_FILES = 14;
const MAX_SCRIPTS = 8;
const MAX_DEP_NAMES = 6;
const MAX_LANGS = 6;
const README_EXCERPT_CHARS = 160;

const KEY_FILE_NOTES = {
  "tsconfig.json": "TypeScript 配置",
  "jsconfig.json": "JS 项目配置",
  ".gitignore": "Git 忽略规则",
  ".env.example": "环境变量样例",
  "dockerfile": "容器构建文件",
  "docker-compose.yml": "容器编排",
  "requirements.txt": "Python 依赖",
  "pyproject.toml": "Python 项目配置",
  "cargo.toml": "Rust 项目配置",
  "go.mod": "Go 模块定义",
  "makefile": "构建脚本",
  "pom.xml": "Maven 配置",
  "build.gradle": "Gradle 配置",
  "composer.json": "PHP 依赖",
  "gemfile": "Ruby 依赖",
};

const KEY_FILE_PREFIXES = [
  ["vite.config.", "Vite 构建配置"],
  ["webpack.config.", "Webpack 构建配置"],
  ["rollup.config.", "Rollup 构建配置"],
  ["jest.config.", "Jest 测试配置"],
  ["vitest.config.", "Vitest 测试配置"],
  ["playwright.config.", "Playwright 测试配置"],
  ["eslint.config.", "ESLint 配置"],
  ["tailwind.config.", "Tailwind 配置"],
  ["babel.config.", "Babel 配置"],
  [".eslintrc", "ESLint 配置"],
  [".prettierrc", "Prettier 配置"],
];

function readJsonSafe(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function findReadme(root) {
  for (const name of ["README.md", "readme.md", "Readme.md", "README.txt", "README"]) {
    const p = path.join(root, name);
    try {
      if (!fs.statSync(p).isFile()) continue;
      const raw = fs.readFileSync(p, "utf8");
      const lines = raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const heading = (lines.find((l) => l.startsWith("#")) || "").replace(/^#+\s*/, "");
      const para = lines.find((l) => !l.startsWith("#")) || "";
      let excerpt = ((heading ? heading + " — " : "") + para).trim();
      if (excerpt.length > README_EXCERPT_CHARS) {
        excerpt = excerpt.slice(0, README_EXCERPT_CHARS - 1) + "…";
      }
      return { name, excerpt: excerpt || "（空 README）" };
    } catch {
      /* ignore */
    }
  }
  return null;
}

function detectKeyFiles(root) {
  const found = [];
  const seen = new Set();
  const push = (name, note) => {
    if (found.length >= MAX_KEY_FILES || seen.has(name)) return;
    seen.add(name);
    found.push({ name, note });
  };
  let names = [];
  try {
    names = fs
      .readdirSync(root)
      .filter((n) => {
        try {
          return fs.statSync(path.join(root, n)).isFile();
        } catch {
          return false;
        }
      })
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return found;
  }
  const byLower = new Map(names.map((n) => [n.toLowerCase(), n]));
  if (byLower.has("package.json")) push(byLower.get("package.json"), "Node 项目清单");
  const readme = findReadme(root);
  if (readme) push(readme.name, "项目说明：" + readme.excerpt);
  for (const n of names) {
    const ln = n.toLowerCase();
    if (seen.has(n)) continue;
    if (KEY_FILE_NOTES[ln]) {
      push(n, KEY_FILE_NOTES[ln]);
      continue;
    }
    for (const [prefix, note] of KEY_FILE_PREFIXES) {
      if (ln.startsWith(prefix)) {
        push(n, note);
        break;
      }
    }
  }
  return found;
}

/** 统计文件类型分布（限深、限量，跳过依赖/构建目录）。 */
function collectStats(root) {
  const extCounts = new Map();
  let files = 0;
  let dirs = 0;
  let visited = 0;
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    if (visited > MAX_WALK_VISITS) break;
    const { dir, depth } = stack.pop();
    let items;
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const it of items) {
      visited += 1;
      if (visited > MAX_WALK_VISITS) break;
      if (it.isDirectory()) {
        if (SKIP_DIRS.has(it.name)) continue;
        dirs += 1;
        if (depth < MAX_WALK_DEPTH) {
          stack.push({ dir: path.join(dir, it.name), depth: depth + 1 });
        }
      } else if (it.isFile()) {
        files += 1;
        const ext = path.extname(it.name).toLowerCase() || "（无扩展名）";
        extCounts.set(ext, (extCounts.get(ext) || 0) + 1);
      }
    }
  }
  return { extCounts, files, dirs };
}

function listTopLevel(root) {
  let items = [];
  try {
    items = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return { entries: [], truncated: false };
  }
  const visible = items.filter((it) => !(it.isDirectory() && SKIP_DIRS.has(it.name)));
  visible.sort((a, b) => {
    const ad = a.isDirectory() ? 0 : 1;
    const bd = b.isDirectory() ? 0 : 1;
    return ad - bd || a.name.localeCompare(b.name);
  });
  const entries = visible
    .slice(0, MAX_TOP_ENTRIES)
    .map((it) => (it.isDirectory() ? it.name + "/" : it.name));
  return { entries, truncated: visible.length > MAX_TOP_ENTRIES };
}

function extLabel(ext) {
  if (ext === "（无扩展名）") return ext;
  const lang = languageOf(ext);
  return lang === "未知" ? ext + " 文件" : lang + "（" + ext + "）";
}

function topLanguages(extCounts) {
  return [...extCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_LANGS)
    .map(([ext, count]) => ({ label: extLabel(ext), count }));
}

function depSummary(deps) {
  const names = Object.keys(deps || {});
  if (!names.length) return { count: 0, names: "" };
  const shown = names.slice(0, MAX_DEP_NAMES).join("、");
  return { count: names.length, names: names.length > MAX_DEP_NAMES ? shown + "、…" : shown };
}

/**
 * dm project [目录]
 */
function cmdProject(deps, opts, dirArg) {
  const root = path.resolve(String(dirArg || "").trim() || ".");
  let st;
  try {
    st = fs.statSync(root);
  } catch {
    return deps.fail(
      "目录不存在：" + root,
      "确认路径后重试；可用 dm project <目录> 指定目标目录。"
    );
  }
  if (!st.isDirectory()) {
    return deps.fail("不是目录：" + root, "dm project 需要目录路径。");
  }

  const pkgJson = readJsonSafe(path.join(root, "package.json"));
  const keyFiles = detectKeyFiles(root);
  const stats = collectStats(root);
  const top = listTopLevel(root);

  deps.out("== 项目上下文 ==");
  deps.out("目录：" + root);
  if (pkgJson && (pkgJson.name || pkgJson.version)) {
    deps.out(
      "项目：" +
        (pkgJson.name || "（未命名）") +
        (pkgJson.version ? "（版本 " + pkgJson.version + "）" : "")
    );
    if (pkgJson.description) deps.out("描述：" + String(pkgJson.description));
  } else {
    deps.out("项目：未检测到 package.json（可能不是 Node 项目）");
  }
  deps.out(
    "规模：" +
      stats.files +
      " 个文件、" +
      stats.dirs +
      " 个目录（扫描深度 " +
      MAX_WALK_DEPTH +
      " 层，已跳过 node_modules 等目录）"
  );

  const langs = topLanguages(stats.extCounts);
  if (langs.length) {
    deps.out("主要语言/文件类型：");
    for (const l of langs) deps.out("  - " + l.label + "：" + l.count + " 个");
  }

  deps.out("关键文件：");
  if (!keyFiles.length) {
    deps.out("  - （未检测到常见关键文件）");
  }
  for (const kf of keyFiles) deps.out("  - " + kf.name + " — " + kf.note);

  deps.out("目录结构（顶层）：");
  if (!top.entries.length) deps.out("  - （空目录）");
  for (const e of top.entries) deps.out("  - " + e);
  if (top.truncated) deps.out("  - …（其余略）");

  const scripts = pkgJson && pkgJson.scripts ? Object.entries(pkgJson.scripts) : [];
  if (scripts.length) {
    deps.out("脚本（来自 package.json）：");
    for (const [k, v] of scripts.slice(0, MAX_SCRIPTS)) {
      deps.out("  - " + k + "：" + String(v));
    }
    if (scripts.length > MAX_SCRIPTS) deps.out("  - …（其余略）");
  }

  const dep = depSummary(pkgJson && pkgJson.dependencies);
  const dev = depSummary(pkgJson && pkgJson.devDependencies);
  if (dep.count || dev.count) {
    deps.out(
      "依赖：dependencies " +
        dep.count +
        " 个" +
        (dep.names ? "（" + dep.names + "）" : "") +
        "，devDependencies " +
        dev.count +
        " 个" +
        (dev.names ? "（" + dev.names + "）" : "")
    );
  }

  deps.out("提示：可将本摘要作为项目背景，配合 dm context / dm generate 使用。");
  return 0;
}

module.exports = {
  SKIP_DIRS,
  detectKeyFiles,
  collectStats,
  listTopLevel,
  topLanguages,
  cmdProject,
};
