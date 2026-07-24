"use strict";

/**
 * dm run —— 执行代码。
 *
 * 默认行为：读取代码文件并调用模型做运行前审查（复用 review 模块的消息构建与解析）。
 * 加 --exec 后在独立子进程中实际执行：带超时保护与输出截断，
 * 目前支持 .js/.cjs/.mjs（node）与 .py（python）。
 */

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  loadCodeFile,
  buildCodeReviewMessages,
  parseReviewOutput,
  printReview,
  fakeReviewOutput,
} = require("./review");

const DEFAULT_EXEC_TIMEOUT_MS = 15000;
const MIN_EXEC_TIMEOUT_MS = 500;
const MAX_EXEC_TIMEOUT_MS = 120000;
const MAX_EXEC_OUTPUT_CHARS = 4000;

/** 按扩展名解析运行时；不支持的类型返回 null。 */
function resolveRunner(ext) {
  switch (String(ext || "").toLowerCase()) {
    case ".js":
    case ".cjs":
    case ".mjs":
      // 直接用当前 node 解释器，避免依赖 PATH 中的 node。
      return { label: "node", cmd: process.execPath, args: (f) => [f] };
    case ".py":
      return { label: "python", cmd: "python", args: (f) => [f] };
    default:
      return null;
  }
}

function clampTimeout(value) {
  const n = Number.parseInt(String(value == null ? "" : value), 10);
  if (!Number.isFinite(n)) return DEFAULT_EXEC_TIMEOUT_MS;
  return Math.min(MAX_EXEC_TIMEOUT_MS, Math.max(MIN_EXEC_TIMEOUT_MS, n));
}

function clipOutput(text) {
  const s = String(text || "");
  if (s.length <= MAX_EXEC_OUTPUT_CHARS) return { text: s, clipped: false };
  return { text: s.slice(0, MAX_EXEC_OUTPUT_CHARS), clipped: true };
}

/**
 * 在独立子进程中同步执行文件，带超时保护与输出上限。
 * 工作目录固定为文件所在目录，不经过 shell。
 */
function executeCode(absPath, runner, timeoutMs) {
  const res = spawnSync(runner.cmd, runner.args(absPath), {
    cwd: path.dirname(absPath),
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  if (res.error && res.error.code === "ENOENT") return { notFound: true };
  const timedOut =
    !!(res.error && res.error.code === "ETIMEDOUT") || (res.status == null && !!res.signal);
  if (res.error && !timedOut) {
    return { spawnError: res.error.message || String(res.error) };
  }
  return {
    timedOut,
    status: typeof res.status === "number" ? res.status : null,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
  };
}

function printExecOutput(out, result) {
  const so = clipOutput(result.stdout);
  const se = clipOutput(result.stderr);
  out("标准输出：");
  out(so.text.trimEnd() || "（无）");
  if (so.clipped) out("…（输出过长，已截断）");
  out("标准错误：");
  out(se.text.trimEnd() || "（无）");
  if (se.clipped) out("…（输出过长，已截断）");
}

/**
 * dm run <文件> [--exec] [--timeout 毫秒] [--fake]
 */
async function cmdRun(deps, opts, fileArg) {
  const target = String(fileArg || "").trim();
  if (!target) {
    return deps.fail(
      "缺少代码文件。",
      "用法：dm run <文件> [--exec] [--timeout 毫秒] [--fake]"
    );
  }
  const loaded = loadCodeFile(target);
  if (!loaded.ok) return deps.fail(loaded.error, loaded.hint);

  // 快速失败：--exec 时先确认文件类型可执行，再进入模型审查。
  let runner = null;
  if (opts.exec) {
    runner = resolveRunner(loaded.ext);
    if (!runner) {
      return deps.fail(
        "不支持执行的文件类型：" + (loaded.ext || "（无扩展名）"),
        "目前支持 .js/.cjs/.mjs（node）与 .py（python）。"
      );
    }
  }

  const pkg = deps.loadPackage(opts);
  if (!pkg.exists) {
    deps.errOut("警告：未找到 Package（" + pkg.dir + "），将按默认风格审查。");
  }
  const model = deps.resolveModel(opts);
  if (model.errorHint) {
    return deps.fail("未配置模型，无法审查。", model.errorHint);
  }

  const assembled = deps.assembleSubjectContextCandidates(pkg, {
    goal: "运行前审查 " + loaded.baseName,
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
    note: "这段代码即将被执行。请先给出运行前审查，重点关注副作用、外部依赖与潜在风险。",
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
  deps.out("== 代码执行 ==");
  deps.out("文件：" + loaded.absPath + "（" + loaded.language + "，" + loaded.lineCount + " 行）");
  if (loaded.truncated) {
    deps.out("提示：文件较长，仅前 30000 字符参与审查。");
  }
  deps.out("");
  deps.out("—— 模型审查 ——");
  printReview(deps.out, parsed);

  if (!opts.exec) {
    deps.out("");
    deps.out("提示：加 --exec 可实际执行（独立子进程，默认 15 秒超时，输出超长截断）。");
    return 0;
  }

  const timeoutMs = clampTimeout(opts.timeout);
  deps.out("");
  deps.out(
    "—— 执行结果（" + runner.label + "，超时上限 " + Math.round(timeoutMs / 1000) + " 秒）——"
  );
  deps.errOut("正在执行（" + runner.label + "）…");
  const result = executeCode(loaded.absPath, runner, timeoutMs);

  if (result.notFound) {
    return deps.fail("未找到运行时：" + runner.label + "。", "请确认 " + runner.label + " 已安装并加入 PATH。");
  }
  if (result.spawnError) {
    return deps.fail("无法启动执行：" + result.spawnError);
  }
  if (result.timedOut) {
    deps.out("执行超时：" + Math.round(timeoutMs / 1000) + " 秒内未完成，已终止进程。");
    printExecOutput(deps.out, result);
    return 1;
  }
  deps.out("退出码：" + (result.status == null ? "（未知）" : result.status));
  printExecOutput(deps.out, result);
  if (result.status !== 0) {
    deps.errOut("执行失败：退出码 " + result.status + "。");
    return 1;
  }
  return 0;
}

module.exports = {
  DEFAULT_EXEC_TIMEOUT_MS,
  MAX_EXEC_OUTPUT_CHARS,
  resolveRunner,
  clampTimeout,
  executeCode,
  cmdRun,
};
