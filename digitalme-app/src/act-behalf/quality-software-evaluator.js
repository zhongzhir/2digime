"use strict";

/**
 * Software quality evaluator for MVP-QUALITY-EVALUATION-01.
 * Deterministic checks + real execute. Model subjective scores never override test results.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { makeCheck, SCHEMA_VERSION } = require("./quality-evaluation-helpers");

const SECURITY_PATTERNS = Object.freeze([
  {
    id: "eval_usage",
    re: /\beval\s*\(/,
    message: "检测到 eval()，存在明显安全风险",
  },
  {
    id: "child_process_shell",
    re: /child_process[\s\S]{0,80}shell\s*:\s*true/,
    message: "检测到 shell:true 子进程调用",
  },
  {
    id: "rm_rf",
    re: /rmSync\s*\([^)]*recursive\s*:\s*true|rimraf|rm\s+-rf/,
    message: "检测到危险删除模式",
  },
]);

function listArtifactFiles(input) {
  if (input && input.files && typeof input.files === "object") {
    return Object.keys(input.files).filter((k) => input.files[k] != null);
  }
  if (input && input.workDir && fs.existsSync(input.workDir)) {
    return walkFiles(input.workDir).map((p) => path.relative(input.workDir, p).replace(/\\/g, "/"));
  }
  return [];
}

function walkFiles(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}

function primarySource(input, files) {
  const preferred = ["main.js", "index.js", "artifact.js", "app.js", "src/main.js"];
  for (const p of preferred) {
    if (input.files && typeof input.files[p] === "string") {
      return { relativePath: p, source: input.files[p] };
    }
  }
  const js = (files || []).find((f) => /\.(cjs|mjs|js)$/i.test(f));
  if (js && input.files && typeof input.files[js] === "string") {
    return { relativePath: js, source: input.files[js] };
  }
  if (typeof input.source === "string") {
    return { relativePath: "main.js", source: input.source };
  }
  if (typeof input.content === "string") {
    return { relativePath: "main.js", source: input.content };
  }
  return null;
}

function materializeWorkDir(input, primary) {
  if (input.workDir && fs.existsSync(input.workDir)) {
    return { workDir: input.workDir, primaryPath: path.join(input.workDir, primary.relativePath), cleanup: false };
  }
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "dm-qeval-sw-"));
  const files = input.files || { [primary.relativePath]: primary.source };
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(workDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (Buffer.isBuffer(body)) fs.writeFileSync(abs, body);
    else fs.writeFileSync(abs, String(body), "utf8");
  }
  return {
    workDir,
    primaryPath: path.join(workDir, primary.relativePath),
    cleanup: true,
  };
}

function runNodeCheck(filePath) {
  const res = spawnSync(process.execPath, ["--check", filePath], {
    encoding: "utf8",
    timeout: 10000,
    windowsHide: true,
  });
  return {
    ok: res.status === 0,
    status: res.status,
    stderr: String(res.stderr || "").slice(0, 1500),
    stdout: String(res.stdout || "").slice(0, 500),
  };
}

function runExecute(filePath, timeoutMs) {
  const res = spawnSync(process.execPath, [filePath], {
    cwd: path.dirname(filePath),
    encoding: "utf8",
    timeout: timeoutMs || 15000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  const timedOut =
    !!(res.error && res.error.code === "ETIMEDOUT") || (res.status == null && !!res.signal);
  return {
    ok: !timedOut && res.status === 0,
    timedOut,
    status: typeof res.status === "number" ? res.status : null,
    stdout: String(res.stdout || "").slice(0, 2000),
    stderr: String(res.stderr || "").slice(0, 2000),
    spawnError: res.error && !timedOut ? String(res.error.message || res.error) : null,
  };
}

function runSpecialTest(input, workDir) {
  if (typeof input.runTests === "function") {
    return Promise.resolve(input.runTests({ workDir, files: input.files })).then((r) => ({
      ok: !!(r && r.ok),
      detail: r,
    }));
  }
  const testFile =
    (input.files && (input.files["test.js"] || input.files["tests/smoke.js"])) || null;
  if (!testFile) {
    return Promise.resolve({ ok: true, skipped: true, detail: { reason: "no_special_test" } });
  }
  const abs = path.join(workDir, input.files["test.js"] ? "test.js" : "tests/smoke.js");
  if (!fs.existsSync(abs)) {
    fs.writeFileSync(abs, String(testFile), "utf8");
  }
  const exec = runExecute(abs, 20000);
  return Promise.resolve({ ok: exec.ok, detail: exec });
}

function complexityScore(source) {
  const s = String(source || "");
  const lines = s.split(/\n/).length;
  const fns = (s.match(/\bfunction\b|\b=>\b/g) || []).length;
  return { lines, fns, score: lines + fns * 3 };
}

async function evaluateSoftwareArtifact(input) {
  const opts = input || {};
  const files = listArtifactFiles(opts);
  const checks = [];
  const evidence = [];
  let cleanupDir = null;

  try {
    checks.push(
      makeCheck({
        id: "real_output_files",
        passed: files.length > 0 || !!(opts.source || opts.content),
        severity: "blocking",
        message: files.length ? `存在输出文件 ${files.length} 个` : "缺少真实输出文件",
        category: "output",
        evidence: { files: files.slice(0, 20) },
      })
    );

    const primary = primarySource(opts, files);
    checks.push(
      makeCheck({
        id: "primary_source_present",
        passed: !!(primary && primary.source && String(primary.source).trim()),
        severity: "blocking",
        message: primary ? `主源文件 ${primary.relativePath}` : "未找到可解析的主源文件",
        category: "output",
      })
    );

    if (!primary || !String(primary.source || "").trim()) {
      return {
        scope: { artifactKind: "software" },
        artifactType: "software",
        checks,
        evidence,
        evaluatorProvenance: {
          evaluatorId: "software_quality_evaluator",
          version: SCHEMA_VERSION,
          sources: ["deterministic_software_checks"],
        },
      };
    }

    const mat = materializeWorkDir(opts, primary);
    if (mat.cleanup) cleanupDir = mat.workDir;
    evidence.push({ type: "work_dir", workDir: mat.workDir, cleanup: mat.cleanup });

    const syntax = runNodeCheck(mat.primaryPath);
    evidence.push({ type: "syntax_check", ...syntax });
    checks.push(
      makeCheck({
        id: "parse_or_build",
        passed: syntax.ok,
        severity: "blocking",
        message: syntax.ok ? "语法检查通过（node --check）" : `语法检查失败：${syntax.stderr.slice(0, 120)}`,
        category: "build",
        evidence: syntax,
      })
    );

    // Product-path authenticity: require that generation went through declared product markers when provided.
    const productPathOk =
      opts.viaProductPipeline === true ||
      opts.viaProductPipeline === undefined; // harness may omit; generation wiring sets true
    checks.push(
      makeCheck({
        id: "real_product_pipeline",
        passed: productPathOk,
        severity: opts.requireProductPipeline ? "blocking" : "warning",
        message: productPathOk
          ? "走产品软件成果链路（或未强制要求标记）"
          : "未走真实产品生成链路",
        category: "pipeline",
        actionable: false,
      })
    );

    let exec = null;
    if (syntax.ok) {
      exec = runExecute(mat.primaryPath, opts.execTimeoutMs || 15000);
      evidence.push({ type: "execute", ...exec });
      checks.push(
        makeCheck({
          id: "runnable",
          passed: exec.ok,
          severity: "blocking",
          message: exec.ok
            ? "可运行（进程退出码 0）"
            : exec.timedOut
              ? "运行超时"
              : `运行失败（status=${exec.status}）`,
          category: "runtime",
          evidence: {
            status: exec.status,
            stdout: exec.stdout.slice(0, 400),
            stderr: exec.stderr.slice(0, 400),
          },
        })
      );
    } else {
      checks.push(
        makeCheck({
          id: "runnable",
          passed: false,
          severity: "blocking",
          message: "因语法失败跳过运行",
          category: "runtime",
        })
      );
    }

    const testResult = await runSpecialTest(opts, mat.workDir);
    evidence.push({ type: "special_test", ...testResult });
    checks.push(
      makeCheck({
        id: "special_tests",
        passed: !!testResult.ok,
        severity: testResult.skipped ? "info" : "blocking",
        message: testResult.skipped
          ? "无专项测试（跳过）"
          : testResult.ok
            ? "专项测试通过"
            : "专项测试失败",
        category: "tests",
        actionable: !testResult.skipped,
      })
    );

    const cx = complexityScore(primary.source);
    const baseline = opts.complexityBaseline || null;
    let complexityOk = true;
    if (baseline && typeof baseline.score === "number") {
      // Obvious complexity regression: more than 3x lines with fewer functions solving same task — soft unless extreme.
      complexityOk = cx.score <= baseline.score * 3 + 40;
    }
    checks.push(
      makeCheck({
        id: "complexity_regression",
        passed: complexityOk,
        severity: complexityOk ? "info" : "warning",
        message: complexityOk
          ? `复杂度可接受（lines=${cx.lines}, fns=${cx.fns}）`
          : `相对基线出现明显复杂度膨胀（${cx.score} vs ${baseline.score}）`,
        category: "complexity",
        evidence: { current: cx, baseline },
      })
    );

    for (const pat of SECURITY_PATTERNS) {
      const hit = pat.re.test(primary.source);
      checks.push(
        makeCheck({
          id: `security_${pat.id}`,
          passed: !hit,
          severity: "blocking",
          message: hit ? pat.message : `安全检查通过：${pat.id}`,
          category: "security",
        })
      );
    }

    const allowed = new Set(
      Array.isArray(opts.allowedFiles) && opts.allowedFiles.length
        ? opts.allowedFiles
        : files.length
          ? files
          : [primary.relativePath]
    );
    const unrelated = files.filter((f) => !allowed.has(f));
    checks.push(
      makeCheck({
        id: "unrelated_modifications",
        passed: unrelated.length === 0,
        severity: unrelated.length ? "blocking" : "info",
        message: unrelated.length
          ? `出现无关文件：${unrelated.slice(0, 5).join(", ")}`
          : "未见无关修改文件",
        category: "diff_scope",
        evidence: { unrelated, allowed: [...allowed] },
      })
    );

    return {
      scope: { artifactKind: "software" },
      artifactType: "software",
      checks,
      evidence,
      evaluatorProvenance: {
        evaluatorId: "software_quality_evaluator",
        version: SCHEMA_VERSION,
        sources: ["node_syntax_check", "node_execute", "security_heuristics", "special_tests"],
      },
    };
  } finally {
    if (cleanupDir) {
      try {
        fs.rmSync(cleanupDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
}

module.exports = {
  evaluateSoftwareArtifact,
  primarySource,
  runNodeCheck,
  runExecute,
  SECURITY_PATTERNS,
};
