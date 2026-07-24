"use strict";

/**
 * dm review —— 代码审查。
 *
 * 读取代码文件，结合 Digital Me Package 中的本人资料、表达风格与边界，
 * 调用模型输出「问题 / 建议 / 改进方案」三栏审查结果。
 * 数据加载与模型调用逻辑由 ../index.js 以 deps 注入（复用现有实现）。
 * 本模块同时导出 loadCodeFile / buildCodeReviewMessages 等工具，供 dm run 复用。
 */

const fs = require("node:fs");
const path = require("node:path");
const { extractSection } = require("../../act-behalf/parse-output");

/** 送入模型的代码最大字符数，超出部分截断并提示。 */
const MAX_CODE_CHARS = 30000;

const LANGUAGE_BY_EXT = {
  ".js": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".jsx": "JavaScript (JSX)",
  ".ts": "TypeScript",
  ".tsx": "TypeScript (TSX)",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".c": "C",
  ".h": "C/C++ 头文件",
  ".cc": "C++",
  ".cpp": "C++",
  ".hpp": "C++",
  ".cs": "C#",
  ".rb": "Ruby",
  ".php": "PHP",
  ".sh": "Shell",
  ".sql": "SQL",
  ".html": "HTML",
  ".css": "CSS",
  ".vue": "Vue",
  ".json": "JSON",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".md": "Markdown",
};

function languageOf(ext) {
  return LANGUAGE_BY_EXT[String(ext || "").toLowerCase()] || "未知";
}

/**
 * 读取代码文件；相对路径以当前工作目录为基准。
 * @returns {{ ok: boolean, error?: string, hint?: string, absPath?: string,
 *   baseName?: string, ext?: string, language?: string, lineCount?: number,
 *   codeForPrompt?: string, truncated?: boolean }}
 */
function loadCodeFile(target) {
  const absPath = path.resolve(String(target || "").trim());
  let st;
  try {
    st = fs.statSync(absPath);
  } catch {
    return {
      ok: false,
      error: "文件不存在：" + absPath,
      hint: "确认路径后重试；相对路径以当前目录为基准。",
    };
  }
  if (!st.isFile()) {
    return { ok: false, error: "不是文件：" + absPath, hint: "请提供代码文件路径。" };
  }
  let code;
  try {
    code = fs.readFileSync(absPath, "utf8");
  } catch (e) {
    return {
      ok: false,
      error: "无法读取文件：" + absPath + "（" + (e && e.message ? e.message : e) + "）",
    };
  }
  if (!code.trim()) {
    return { ok: false, error: "文件为空：" + absPath, hint: "请提供包含代码的文件。" };
  }
  const ext = path.extname(absPath).toLowerCase();
  const truncated = code.length > MAX_CODE_CHARS;
  return {
    ok: true,
    absPath,
    baseName: path.basename(absPath),
    ext,
    language: languageOf(ext),
    lineCount: code.split(/\r?\n/).length,
    codeForPrompt: truncated ? code.slice(0, MAX_CODE_CHARS) : code,
    truncated,
  };
}

/**
 * 构建代码审查消息：系统提示固定三栏输出，用户消息携带代码、
 * 用户表达风格、用户边界与本人信息摘录。
 */
function buildCodeReviewMessages({
  fileName,
  language,
  code,
  selfContextText,
  styleGuide,
  boundariesSummary,
  note,
}) {
  const styleBlock =
    String(styleGuide || "").trim() || "（未提供表达风格指南，使用清晰、直接的工程表达。）";
  const boundaryBlock = String(boundariesSummary || "").trim() || "（未设置额外边界。）";
  const selfBlock = String(selfContextText || "").trim() || "（无可用本人信息摘录。）";

  const system = [
    "你是 Digital Me：代表用户本人做代码审查，输出应像用户本人写的审查意见。",
    "审查必须：",
    "1. 严格基于提供的代码，禁止臆测未展示的实现；",
    "2. 语气与措辞符合「用户表达风格」；",
    "3. 遵守「用户边界」，不越界、不杜撰用户立场；",
    "4. 不确定之处明确标注。",
    "",
    "输出必须使用以下 Markdown 二级标题（标题文字必须一致，便于终端解析）：",
    "",
    "## 问题",
    "（按严重程度列出具体问题，附位置线索；无问题则写「未发现明显问题」）",
    "",
    "## 建议",
    "（逐条给出可执行的修改建议）",
    "",
    "## 改进方案",
    "（给出改写思路或改进后的关键代码片段）",
  ].join("\n");

  const user = [
    String(note || "请审查以下代码文件。"),
    "",
    "文件：" + String(fileName || "（未命名）"),
    "语言：" + String(language || "未知"),
    "",
    "```",
    String(code || ""),
    "```",
    "",
    "---",
    "",
    "## 用户表达风格（审查意见须符合）",
    styleBlock,
    "",
    "## 用户边界（审查不得越界）",
    boundaryBlock,
    "",
    "## 本人信息摘录（唯一允许引用的本人资料）",
    selfBlock,
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** 解析模型审查输出为三栏；无法分栏时返回原文。 */
function parseReviewOutput(raw) {
  const text = String(raw || "").trim();
  const issues = extractSection(text, ["问题", "发现的问题", "存在的问题"]);
  const suggestions = extractSection(text, ["建议", "修改建议"]);
  const improvements = extractSection(text, ["改进方案", "改进建议", "改进代码"]);
  const parseOk = !!(issues || suggestions || improvements);
  return { issues, suggestions, improvements, result: parseOk ? "" : text, parseOk };
}

/** 以终端友好的三栏格式打印审查结果。 */
function printReview(out, parsed) {
  if (!parsed || !parsed.parseOk) {
    out("## 审查结果");
    out((parsed && parsed.result) || "（空响应）");
    return;
  }
  out("## 问题");
  out(parsed.issues || "（模型未给出本栏内容。）");
  out("");
  out("## 建议");
  out(parsed.suggestions || "（模型未给出本栏内容。）");
  out("");
  out("## 改进方案");
  out(parsed.improvements || "（模型未给出本栏内容。）");
}

/** fake 模式下的审查输出（含三栏标题，供无 API 的测试使用）。 */
function fakeReviewOutput(fileName) {
  const name = String(fileName || "（未命名文件）");
  return (
    "## 问题\n\n- （测试）" +
    name +
    "：未发现明显问题，结构清晰。\n\n" +
    "## 建议\n\n- （测试）建议补充必要的错误处理与注释。\n\n" +
    "## 改进方案\n\n（测试）按上述建议逐条修改；此处为占位改进说明。"
  );
}

/**
 * dm review <文件> [--fake]
 */
async function cmdReview(deps, opts, fileArg) {
  const target = String(fileArg || "").trim();
  if (!target) {
    return deps.fail("缺少代码文件。", "用法：dm review <文件> [--fake]");
  }
  const loaded = loadCodeFile(target);
  if (!loaded.ok) return deps.fail(loaded.error, loaded.hint);

  const pkg = deps.loadPackage(opts);
  if (!pkg.exists) {
    deps.errOut("警告：未找到 Package（" + pkg.dir + "），将按默认风格审查。");
  }
  const model = deps.resolveModel(opts);
  if (model.errorHint) {
    return deps.fail("未配置模型，无法审查。", model.errorHint);
  }

  const assembled = deps.assembleSubjectContextCandidates(pkg, {
    goal: "代码审查 " + loaded.baseName,
  });
  const contextText =
    (assembled && assembled.selectedSelfContext && assembled.selectedSelfContext.combinedText) || "";
  const messages = buildCodeReviewMessages({
    fileName: loaded.baseName,
    language: loaded.language,
    code: loaded.codeForPrompt,
    selfContextText: contextText,
    styleGuide: pkg.styleGuide,
    boundariesSummary: pkg.boundariesSummary,
    note: "请审查以下代码文件。",
  });

  deps.errOut("正在审查（" + (model.fake ? "fake 模式" : model.cfg.model) + "）…");
  let raw;
  try {
    raw = await deps.callModel(model.cfg, messages, {
      forceFake: model.fake,
      fakeOutput: fakeReviewOutput(loaded.baseName),
      temperature: 0.2,
    });
  } catch (e) {
    return deps.fail("模型调用失败：" + (e && e.message ? e.message : e));
  }

  const parsed = parseReviewOutput(raw);
  deps.out("== 代码审查 ==");
  deps.out("文件：" + loaded.absPath + "（" + loaded.language + "，" + loaded.lineCount + " 行）");
  if (loaded.truncated) {
    deps.out("提示：文件较长，仅前 " + MAX_CODE_CHARS + " 字符参与审查。");
  }
  deps.out("");
  printReview(deps.out, parsed);
  return 0;
}

module.exports = {
  MAX_CODE_CHARS,
  LANGUAGE_BY_EXT,
  languageOf,
  loadCodeFile,
  buildCodeReviewMessages,
  parseReviewOutput,
  printReview,
  fakeReviewOutput,
  cmdReview,
};
