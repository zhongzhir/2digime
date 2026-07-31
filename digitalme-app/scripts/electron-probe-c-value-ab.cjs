"use strict";

/**
 * Probe C — value A/B (gated).
 * Only runs after Probe A + Probe B passed (probe-*-latest.json).
 * Uses text-only goal wording to avoid introPackage→image.
 * Full Task A revise/accept/Task B A/B; classifies VALUE_COMPARISON_INCOMPLETE on failure.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const http = require("node:http");

if (!process.versions.electron) {
  console.error("Must run under Electron");
  process.exit(1);
}

const ERROR = {
  MODEL_CONNECTIVITY_ERROR: "MODEL_CONNECTIVITY_ERROR",
  PRODUCT_TEXT_GENERATION_ERROR: "PRODUCT_TEXT_GENERATION_ERROR",
  UNEXPECTED_IMAGE_CAPABILITY_REQUEST: "UNEXPECTED_IMAGE_CAPABILITY_REQUEST",
  VALUE_COMPARISON_INCOMPLETE: "VALUE_COMPARISON_INCOMPLETE",
};

const evidenceRoot = path.join(__dirname, "_mvp-value-validation-real-model-01-evidence");
const recoveryRoot = path.join(__dirname, "_mvp-value-validation-harness-recovery-01-evidence");
function readLatest(name) {
  for (const root of [evidenceRoot, recoveryRoot]) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      /* continue */
    }
  }
  return null;
}

const probeA = readLatest("probe-a-latest.json");
const probeB = readLatest("probe-b-latest.json");
if (!probeA || !probeA.ok) {
  console.error(
    JSON.stringify({
      ok: false,
      errorClass: ERROR.MODEL_CONNECTIVITY_ERROR,
      reason: "probe_a_not_passed",
      probeA,
    })
  );
  process.exit(2);
}
if (!probeB || !probeB.ok || probeB.unexpectedImageRequirement) {
  console.error(
    JSON.stringify({
      ok: false,
      errorClass: probeB && probeB.unexpectedImageRequirement
        ? ERROR.UNEXPECTED_IMAGE_CAPABILITY_REQUEST
        : ERROR.PRODUCT_TEXT_GENERATION_ERROR,
      reason: "probe_b_not_passed",
      probeB,
    })
  );
  process.exit(3);
}

const deepseekKey = process.env.DEEPSEEK_API_KEY || "";
const useReal = !!deepseekKey;
if (!useReal) {
  console.error(
    JSON.stringify({
      ok: false,
      errorClass: "MODEL_CREDENTIAL_MISSING",
      reason: "DEEPSEEK_API_KEY missing; OpenAI fallback disabled",
    })
  );
  process.exit(2);
}
delete process.env.DIGITALME_ACT_BEHALF_FAKE;
delete process.env.DIGITALME_DVL2_03_MOCK_MODEL;
delete process.env.DIGITALME_FORCE_FAKE;
process.env.DIGITALME_PLANNER_FORCE_RULE = "1";

const provider = "deepseek";
const apiKey = deepseekKey;
const modelName = String(process.env.DIGITALME_VALUE_MODEL || "deepseek-chat");
const baseUrl = "https://api.deepseek.com/v1";
const modelId = `${provider}/${modelName}`;

if (probeA.provider && probeA.provider !== "deepseek") {
  console.error(JSON.stringify({ ok: false, errorClass: "MODEL_CONNECTIVITY_ERROR", reason: "probe_a_provider_mismatch" }));
  process.exit(2);
}

// Avoid introPackage image triggers (no 介绍/对外/宣传材料/成果包…)
const TASK_A_PROMPT =
  "写一份约 1500–2000 字的 Markdown 公众号文字稿，讨论一个本地优先个人 AI 项目的行业判断。" +
  "面向非技术背景读者；事实准确；不要写成产品说明书。" +
  "仅生成 Markdown 文字稿，不生成图片、封面、幻灯片、网页或其他媒体。";

const TASK_A_REVISION =
  "请按以下明确修改重写：\n" +
  "1. 标题更有观点和冲突感；\n" +
  "2. 开头减少铺垫，直接进入问题；\n" +
  "3. 减少机械分点；\n" +
  "4. 事实新闻与趋势判断保持平衡；\n" +
  "5. 未完成或未验证的能力不得写成已经实现。";

const TASK_B_PROMPT =
  "写一份约 1500 字的 Markdown 公众号文字稿，解释为什么个人 AI 的核心不是一次性回答能力，而是持续积累和延续工作。" +
  "面向普通读者；事实准确。" +
  "仅生成 Markdown 文字稿，不生成图片、封面或其他媒体。";

const MATERIAL_A = [
  {
    id: "f1",
    name: "定位.md",
    text:
      "Digital Me 是本地优先的个人数字主体应用。目标不是一次性聊天回答，而是持续积累偏好、事实与边界。" +
      "外部协作网络、支付结算、DID/VC 尚未进入正式验证，不得写成已上线能力。",
    ok: true,
    isFolder: false,
  },
];
const MATERIAL_B = [
  {
    id: "f3",
    name: "判断.md",
    text:
      "个人 AI 的核心不是单次回答是否聪明，而是跨任务记住已确认偏好、事实与边界。" +
      "外部协作网络仍未进入正式验证。",
    ok: true,
    isFolder: false,
  },
];

const { app, BrowserWindow } = require("electron");
const EVIDENCE = path.join(evidenceRoot, "probe-c-" + new Date().toISOString().replace(/[:.]/g, "-"));
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dm-probe-c-"));
app.setPath("userData", userData);
fs.mkdirSync(EVIDENCE, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RESULT_TIMEOUT = 480000;

function writeJson(name, obj) {
  fs.writeFileSync(path.join(EVIDENCE, name), JSON.stringify(obj, null, 2), "utf8");
}
function writeText(name, text) {
  fs.writeFileSync(path.join(EVIDENCE, name), String(text || ""), "utf8");
}

async function dumpState(win, name) {
  try {
    const state = await win.webContents.executeJavaScript(`(() => ({
      phase: typeof actBehalfState !== "undefined" ? actBehalfState.workspacePhase : null,
      busy: typeof actBehalfState !== "undefined" ? !!actBehalfState.startDoBusy : null,
      presented: typeof actBehalfState !== "undefined" ? actBehalfState.presentedResultKey : null,
      taskId: typeof actBehalfState !== "undefined" ? actBehalfState.taskId : null,
      packageId: typeof actBehalfState !== "undefined" ? actBehalfState.activePackageId : null,
      resultVisible: !!(document.getElementById("act-workspace-result") &&
        !document.getElementById("act-workspace-result").classList.contains("hidden")),
      bodyLen: ((document.getElementById("act-result-body") || {}).innerText || "").trim().length,
    }))()`);
    writeJson(`${name}.json`, state);
    return state;
  } catch (err) {
    writeJson(`${name}.json`, { dumpError: String(err && err.message ? err.message : err) });
    return null;
  }
}

async function waitFor(win, predicate, label, timeoutMs = RESULT_TIMEOUT) {
  const started = Date.now();
  let ticks = 0;
  while (Date.now() - started < timeoutMs) {
    const ok = await win.webContents.executeJavaScript(
      `(async()=>Boolean(await (${predicate})()))()`
    );
    if (ok) return;
    ticks += 1;
    if (ticks % 40 === 0) await dumpState(win, `wait-${label}-${ticks}`);
    await sleep(250);
  }
  await dumpState(win, `timeout-${label}`);
  throw new Error("timeout: " + label);
}

async function clickSel(win, selector) {
  const box = await win.webContents.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  assert.ok(box, "missing " + selector);
  win.webContents.sendInputEvent({ type: "mouseDown", x: box.x, y: box.y, button: "left", clickCount: 1 });
  win.webContents.sendInputEvent({ type: "mouseUp", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await sleep(220);
}

async function ensureStarted(win) {
  await sleep(700);
  const mid = await dumpState(win, "after-start-click");
  if (mid && !mid.taskId && !mid.resultVisible && !mid.busy) {
    await win.webContents.executeJavaScript(`(async () => {
      if (typeof startDo === "function") await startDo();
      else if (typeof handleStartDoWork === "function") await handleStartDoWork();
    })()`);
  }
}

function httpJson(urlStr, bodyObj, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === "https:" ? https : http;
    const payload = Buffer.from(JSON.stringify(bodyObj), "utf8");
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": payload.length,
          ...headers,
        },
        timeout: 180000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let parsed = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = { raw };
          }
          if (res.statusCode >= 400) reject(new Error("HTTP " + res.statusCode));
          else resolve(parsed);
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.write(payload);
    req.end();
  });
}

async function plainGenerate(prompt, materials) {
  const materialBlock = materials.map((m) => `【${m.name}】\n${m.text}`).join("\n\n");
  const resp = await httpJson(
    `${baseUrl}/chat/completions`,
    {
      model: modelName,
      temperature: 0.4,
      messages: [
        { role: "system", content: "只根据材料写作。不要声称未验证能力已上线。" },
        { role: "user", content: `${prompt}\n\n材料：\n${materialBlock}` },
      ],
    },
    { Authorization: `Bearer ${apiKey}` }
  );
  const text =
    (((resp || {}).choices || [])[0] || {}).message &&
    (((resp || {}).choices || [])[0] || {}).message.content;
  if (!text || !String(text).trim()) throw new Error("empty_plain_response");
  return String(text).trim();
}

function scanImageRequest(userDataDir) {
  const hits = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p);
      else if (name === "deliverable-packages.json" || name === "deliverable-plans.json") {
        const raw = fs.readFileSync(p, "utf8");
        if (/image_capability_unavailable|"kind"\s*:\s*"image"|封面图片/.test(raw)) {
          hits.push(p);
        }
      }
    }
  }
  walk(userDataDir);
  return hits;
}

async function runHarness() {
  writeJson("meta.json", {
    probe: "C",
    gatedOn: { probeA, probeB },
    provider,
    modelName,
    taskAPrompt: TASK_A_PROMPT,
    taskBPrompt: TASK_B_PROMPT,
  });

  let win = null;
  for (let i = 0; i < 120; i++) {
    win = BrowserWindow.getAllWindows()[0];
    if (win) break;
    await sleep(100);
  }
  assert.ok(win, "BrowserWindow");
  await waitFor(win, `() => document.readyState === "complete"`, "ready", 60000);

  await win.webContents.executeJavaScript(`(async () => {
    await window.digitalMe.createDigitalMePackage({
      displayName: "PROBE-C-VALUE",
      roleSummary: "价值对照探针",
    });
    pkg = await window.digitalMe.loadPackage();
    firstRunSnapshot = await window.digitalMe.getFirstRunState();
    const provider = ${JSON.stringify(provider)};
    const key = ${JSON.stringify(apiKey)};
    const modelName = ${JSON.stringify(modelName)};
    const baseUrl = ${JSON.stringify(baseUrl)};
    const modelId = ${JSON.stringify(modelId)};
    const routing = {
      version: 1,
      providers: [{
        id: provider,
        name: provider,
        type: "openai-compatible",
        baseUrl,
        enabled: true,
        models: [{ id: modelId, providerId: provider, model: modelName, displayName: modelName, enabled: true }],
      }],
      routes: {
        chat: { primary: modelId, fallbacks: [] },
        artifact: { primary: modelId, fallbacks: [] },
        review: { primary: modelId, fallbacks: [] },
      },
    };
    await window.digitalMe.saveModelRouting({ routing, providerKeys: [{ providerId: provider, apiKey: key }] });
    await window.digitalMe.setConfig({ baseURL: baseUrl, model: modelName, apiKey: "", packageDir: (pkg && pkg.dir) || "" });
    lastModelConfigured = true;
    firstRunSnapshot = firstRunSnapshot || {};
    firstRunSnapshot.modelConfigured = true;
    firstRunSnapshot.needsFirstRunUi = false;
    const overlay = document.getElementById("first-run-overlay");
    if (overlay) overlay.classList.add("hidden");
    if (typeof switchView === "function") switchView("do", document.querySelector('.nav-item[data-view="do"]'));
    if (typeof renderDoWorkspaceNow === "function") renderDoWorkspaceNow();
  })()`);
  await sleep(500);

  // Task A
  await clickSel(win, "#btn-do-new-task");
  await waitFor(win, `() => document.getElementById("act-request")`, "task-a-input", 30000);
  await win.webContents.executeJavaScript(`(() => {
    lastModelConfigured = true;
    const req = document.getElementById("act-request");
    req.value = ${JSON.stringify(TASK_A_PROMPT)};
    req.dispatchEvent(new Event("input", { bubbles: true }));
    actBehalfState.attachedFiles = ${JSON.stringify(MATERIAL_A)};
    renderActFileList();
    renderStartDoAvailability();
  })()`);
  await clickSel(win, "#btn-act-start-do");
  await ensureStarted(win);
  await waitFor(
    win,
    `() => {
      const result = document.getElementById("act-workspace-result");
      return !!(result && !result.classList.contains("hidden") && actBehalfState.presentedResultKey);
    }`,
    "task-a-result"
  );
  const draftA = await win.webContents.executeJavaScript(
    `(() => (document.getElementById("act-result-body").innerText || "").trim())()`
  );
  writeText("task-a-draft.md", draftA);

  await win.webContents.executeJavaScript(
    `(() => { document.getElementById("act-revision-request").value = ${JSON.stringify(TASK_A_REVISION)}; })()`
  );
  await clickSel(win, "#btn-act-send-revision");
  await sleep(500);
  await win.webContents.executeJavaScript(`(async () => {
    if (typeof reviseCurrentResult === "function") await reviseCurrentResult();
    else if (typeof handleSendRevision === "function") await handleSendRevision();
  })()`);
  await waitFor(
    win,
    `() => {
      const body = document.getElementById("act-result-body");
      return !!(body && (body.innerText || "").trim().length > 80 && actBehalfState.presentedResultKey);
    }`,
    "task-a-revised"
  );
  const acceptedA = await win.webContents.executeJavaScript(
    `(() => (document.getElementById("act-result-body").innerText || "").trim())()`
  );
  writeText("task-a-accepted.md", acceptedA);
  await clickSel(win, "#btn-act-accept-result");
  await sleep(2000);
  await win.webContents.executeJavaScript(`(async () => {
    if (typeof acceptCurrentResult === "function") await acceptCurrentResult();
    else if (typeof handleAcceptResult === "function") await handleAcceptResult();
  })()`);
  await sleep(2000);
  const acceptMeta = await win.webContents.executeJavaScript(`(() => ({
    taskId: actBehalfState.taskId,
    packageId: actBehalfState.activePackageId,
    accepted: !document.getElementById("act-accept-status").classList.contains("hidden") ||
      (actBehalfState._lastPackageView &&
        Object.values(actBehalfState._lastPackageView.versions || {}).some((v) => v && v.reviewStatus === "accepted")),
    packageDir: (pkg && (pkg.dir || pkg.packageDir)) || "",
  }))()`);
  writeJson("task-a-accept-meta.json", acceptMeta);
  await sleep(2000);

  // Wait for Learn Job to leave pending_conflict / running → committed|skipped|failed
  let learnWait = { status: null, polls: 0 };
  for (let i = 0; i < 30; i += 1) {
    learnWait.polls = i + 1;
    const st = await win.webContents.executeJavaScript(`(() => {
      try {
        const p = require("path");
        const fs = require("fs");
        const ud = require("electron").app.getPath("userData");
        const candidates = [];
        function walk(dir, depth) {
          if (!dir || depth > 4 || !fs.existsSync(dir)) return;
          for (const name of fs.readdirSync(dir)) {
            const fp = p.join(dir, name);
            let s; try { s = fs.statSync(fp); } catch { continue; }
            if (s.isDirectory()) walk(fp, depth + 1);
            else if (name === "deliverable-learn-jobs.json") candidates.push(fp);
          }
        }
        walk(ud, 0);
        let latest = null;
        for (const fp of candidates) {
          try {
            const data = JSON.parse(fs.readFileSync(fp, "utf8"));
            const jobs = data.jobs || data;
            for (const j of Object.values(jobs || {})) {
              if (!j || !j.id) continue;
              if (!latest || String(j.updatedAt || j.createdAt || "") > String(latest.updatedAt || latest.createdAt || "")) latest = j;
            }
          } catch {}
        }
        return latest ? { id: latest.id, status: latest.status, conflictReason: latest.conflict && latest.conflict.reason } : null;
      } catch (e) { return { error: String(e && e.message || e) }; }
    })()`);
    learnWait = { ...learnWait, ...(st || {}) };
    if (st && ["committed", "skipped", "failed", "resolved_keep", "resolved_session_only"].includes(st.status)) break;
    // If stuck on conflict, production bug — record and continue (FIX-01 should prevent this)
    if (st && st.status === "pending_conflict") {
      writeJson("learn-job-pending-conflict.json", st);
      break;
    }
    await sleep(500);
  }
  writeJson("learn-job-wait.json", learnWait);

  // Learning audit
  const memoryPaths = [];
  function walkMem(dir) {
    if (!dir || !fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      let st;
      try {
        st = fs.statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walkMem(p);
      else if (
        name === "long-term-memory.jsonl" ||
        name === "knowledge-claims.json" ||
        name === "boundaries.json" ||
        name === "deliverable-learn-jobs.json"
      ) {
        memoryPaths.push(p);
      }
    }
  }
  walkMem(userData);
  if (acceptMeta.packageDir) walkMem(acceptMeta.packageDir);
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(userData, "config.json"), "utf8"));
    if (cfg.packageDir) walkMem(cfg.packageDir);
  } catch {
    /* ignore */
  }
  const learned = { expression: [], facts: [], boundaries: [], jobs: [], overlearnRisks: [] };
  for (const p of [...new Set(memoryPaths)]) {
    const raw = fs.readFileSync(p, "utf8");
    const base = path.basename(p);
    fs.writeFileSync(path.join(EVIDENCE, "learn-" + base.replace(/\W+/g, "_")), raw.slice(0, 200000), "utf8");
    if (base.endsWith(".jsonl")) {
      for (const line of raw.split(/\r?\n/).filter(Boolean)) {
        try {
          const row = JSON.parse(line);
          const statement = String(
            row.statement || row.content || row.text || (row.payload && row.payload.statement) || JSON.stringify(row)
          ).slice(0, 500);
          const item = {
            statement,
            sourceVersionId: row.sourceVersionId || (row.learnProvenance && row.learnProvenance.deliverableVersionId) || row.versionId || null,
            sourceTaskId: row.sourceTaskId || (row.learnProvenance && row.learnProvenance.taskId) || row.taskId || null,
            sourceLearnJobId: row.sourceLearnJobId || (row.learnProvenance && row.learnProvenance.learnJobId) || null,
            type: row.learnKind || row.type || "memory",
            confidence: row.confidence != null ? row.confidence : null,
            revoked: !!(row.revoked || row.rejected || row.status === "revoked"),
            resolverEligible: row.resolverEligible != null ? !!row.resolverEligible : true,
            overlearnRisk: !!row.overlearnRisk,
            sourceType: row.sourceType || null,
          };
          if (row.overlearnRisk || item.resolverEligible === false) {
            learned.overlearnRisks.push({
              reason: row.overlearnRisk ? "overlearn_flag" : "resolver_ineligible",
              statement: statement.slice(0, 160),
            });
          } else if (statement.length > 280) {
            learned.overlearnRisks.push({ reason: "long_statement", statement: statement.slice(0, 160) });
          }
          // Count only authoritative learnKinds — do not treat first-run identity as expression.
          if (row.learnKind === "boundary" || /^边界[：:]/.test(statement)) learned.boundaries.push(item);
          else if (row.learnKind === "current_fact" || row.learnKind === "new_fact") learned.facts.push(item);
          else if (row.learnKind === "expression_preference") learned.expression.push(item);
          else if (row.learnKind === "artifact_history" || row.status === "session_only") {
            /* audit only */
          }
        } catch {
          /* ignore */
        }
      }
    } else if (base === "knowledge-claims.json") {
      try {
        const data = JSON.parse(raw);
        const claims = data.claims || data.items || data;
        const list = Array.isArray(claims) ? claims : Object.values(claims || {});
        for (const c of list) {
          if (!c || typeof c !== "object") continue;
          learned.facts.push({
            statement: String(c.statement || c.text || c.claim || "").slice(0, 500),
            sourceVersionId: c.sourceVersionId || null,
            sourceTaskId: c.sourceTaskId || null,
            type: c.type || "project_fact",
            confidence: c.confidence != null ? c.confidence : null,
            revoked: !!(c.revoked || c.status === "rejected" || c.supersededBy),
            resolverEligible: !(c.status === "rejected" || c.supersededBy),
          });
        }
      } catch {
        /* ignore */
      }
    } else if (base === "deliverable-learn-jobs.json") {
      try {
        learned.jobs.push(JSON.parse(raw));
      } catch {
        /* ignore */
      }
    }
  }
  writeJson("learning-audit.json", learned);

  const imageHitsAfterA = scanImageRequest(userData);
  if (imageHitsAfterA.length) {
    const summary = {
      probe: "C",
      ok: false,
      errorClass: ERROR.UNEXPECTED_IMAGE_CAPABILITY_REQUEST,
      imageHitsAfterA,
      evidenceDir: EVIDENCE,
    };
    writeJson("summary.json", summary);
    console.log(JSON.stringify(summary));
    app.exit(4);
    return;
  }

  // Task B Digital Me
  await win.webContents.executeJavaScript(`(async () => {
    pkg = await window.digitalMe.loadPackage();
    if (typeof resetActBehalfForm === "function") resetActBehalfForm();
    if (typeof refreshActTaskList === "function") await refreshActTaskList();
  })()`);
  await sleep(400);
  const sel = await win.webContents.executeJavaScript(
    `document.getElementById("btn-act-new") ? "#btn-act-new" : "#btn-do-new-task"`
  );
  await clickSel(win, sel);
  await win.webContents.executeJavaScript(`(() => {
    lastModelConfigured = true;
    const req = document.getElementById("act-request");
    req.value = ${JSON.stringify(TASK_B_PROMPT)};
    req.dispatchEvent(new Event("input", { bubbles: true }));
    actBehalfState.attachedFiles = ${JSON.stringify(MATERIAL_B)};
    renderActFileList();
    renderStartDoAvailability();
  })()`);
  await clickSel(win, "#btn-act-start-do");
  await ensureStarted(win);
  await waitFor(
    win,
    `() => {
      const result = document.getElementById("act-workspace-result");
      return !!(result && !result.classList.contains("hidden") && actBehalfState.presentedResultKey);
    }`,
    "task-b-result"
  );
  const groupB = await win.webContents.executeJavaScript(
    `(() => (document.getElementById("act-result-body").innerText || "").trim())()`
  );
  writeText("group-b-digitalme.md", groupB);

  let groupA = null;
  let groupAError = null;
  try {
    groupA = await plainGenerate(TASK_B_PROMPT, MATERIAL_B);
    writeText("group-a-plain.md", groupA);
  } catch (err) {
    groupAError = String(err && err.message ? err.message : err);
  }

  function analyze(text, label) {
    const t = String(text || "");
    const lines = t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
    const title = lines[0] || "";
    const head = lines.slice(0, 6).join("\n");
    const mechanicalPoints =
      (t.match(/^\s*(?:[-*•]|\d+[.)、])\s+/gm) || []).length +
      (t.match(new RegExp("^[一二三四五六七八九十]+[、．.]\\s+", "gm")) || []).length;
    const firstPara = t.split(/\n\s*\n/)[0] || t.slice(0, 400);
    const unverifiedAsDone =
      /(外部协作|支付结算|DID|VC).{0,12}(已经|已上线|已实现)/.test(t) ||
      /已经.{0,8}(外部协作|支付结算)/.test(t);
    return {
      label,
      title,
      titleHasConflictCue: /不是|而是|别再|真正|陷阱|误区|核心|为什么|别把/.test(title),
      openingPreambleChars: firstPara.length,
      openingDirectCue: /问题|核心|真正|为什么|不是/.test(head),
      mechanicalPoints,
      unverifiedAsDone,
      charCount: t.replace(/\s/g, "").length,
      factMarkers: (t.match(/当前|尚未|仍在|验证阶段|本地优先|已完成/g) || []).length,
      trendMarkers: (t.match(/趋势|未来|将会|可能|判断|意味着/g) || []).length,
    };
  }

  const aMeta = analyze(groupA || "", "A");
  const bMeta = analyze(groupB || "", "B");
  writeJson("article-metrics.json", { a: aMeta, b: bMeta });

  const dim = [];
  function addDim(name, better) {
    dim.push({ name, better });
  }
  addDim("标题冲突/观点感", bMeta.titleHasConflictCue && !aMeta.titleHasConflictCue ? "B" : aMeta.titleHasConflictCue && !bMeta.titleHasConflictCue ? "A" : bMeta.titleHasConflictCue ? "tie_both" : "tie_neither");
  addDim("开头更直接", bMeta.openingDirectCue && (!aMeta.openingDirectCue || bMeta.openingPreambleChars < aMeta.openingPreambleChars) ? "B" : aMeta.openingDirectCue && !bMeta.openingDirectCue ? "A" : "tie");
  addDim("更少机械分点", bMeta.mechanicalPoints < aMeta.mechanicalPoints ? "B" : aMeta.mechanicalPoints < bMeta.mechanicalPoints ? "A" : "tie");
  addDim("事实与趋势平衡", bMeta.factMarkers > 0 && bMeta.trendMarkers > 0 && !(aMeta.factMarkers > 0 && aMeta.trendMarkers > 0) ? "B" : aMeta.factMarkers > 0 && aMeta.trendMarkers > 0 && !(bMeta.factMarkers > 0 && bMeta.trendMarkers > 0) ? "A" : bMeta.factMarkers > 0 && bMeta.trendMarkers > 0 ? "tie_both" : "tie");
  addDim("未误写未验证能力", !bMeta.unverifiedAsDone && aMeta.unverifiedAsDone ? "B" : bMeta.unverifiedAsDone && !aMeta.unverifiedAsDone ? "A" : !bMeta.unverifiedAsDone && !aMeta.unverifiedAsDone ? "tie_both_ok" : "tie_both_bad");
  addDim("篇幅更接近1500", Math.abs(bMeta.charCount - 1500) < Math.abs(aMeta.charCount - 1500) ? "B" : Math.abs(aMeta.charCount - 1500) < Math.abs(bMeta.charCount - 1500) ? "A" : "tie");

  const bWins = dim.filter((d) => d.better === "B" || d.better === "tie_both_ok").length;
  const observableImprove = dim.filter((d) => d.better === "B").length;

  const prefSignals = [
    { id: "标题观点/冲突", hit: bMeta.titleHasConflictCue },
    { id: "开头直接", hit: bMeta.openingDirectCue || bMeta.openingPreambleChars < aMeta.openingPreambleChars },
    { id: "少机械分点", hit: bMeta.mechanicalPoints <= aMeta.mechanicalPoints },
    { id: "事实趋势平衡", hit: bMeta.factMarkers > 0 && bMeta.trendMarkers > 0 },
    { id: "未验证不作已实现", hit: !bMeta.unverifiedAsDone },
  ];
  const reducedRepeat = prefSignals.filter((p) => p.hit).length;

  const copiedTaskA =
    groupB.slice(0, 120) === acceptedA.slice(0, 120) || groupB.slice(0, 120) === draftA.slice(0, 120);
  const badOldFact = bMeta.unverifiedAsDone;

  // Blind
  const swap = Math.random() < 0.5;
  const resultX = swap ? groupB : groupA || "";
  const resultY = swap ? groupA || "" : groupB;
  const blindKey = { ResultX: swap ? "B_digitalme" : "A_plain", ResultY: swap ? "A_plain" : "B_digitalme" };
  writeText("blind-result-x.md", resultX);
  writeText("blind-result-y.md", resultY);
  writeJson("blind-key.json", blindKey);
  const xMeta = analyze(resultX, "X");
  const yMeta = analyze(resultY, "Y");
  const scoreSide = (m) =>
    (m.titleHasConflictCue ? 1 : 0) +
    (m.openingDirectCue ? 1 : 0) +
    (m.unverifiedAsDone ? -2 : 1) +
    (m.mechanicalPoints <= 3 ? 1 : 0);
  const prefer = scoreSide(xMeta) >= scoreSide(yMeta) ? "X" : "Y";
  const blindEval = {
    evaluator: "developer_self_evaluation",
    notIndependentUserValidation: true,
    preferLabel: prefer,
    preferMapsTo: blindKey["Result" + prefer],
    reasons: [
      "developer_self_evaluation using structural cues only (title conflict, opening, mechanical points, unverified-as-done); mapping via blind-key after scoring",
    ],
  };
  writeJson("blind-eval-developer-self.json", blindEval);

  const imageHits = scanImageRequest(userData);
  const pairedOk = !!(groupA && groupB && groupB.length > 80 && !imageHits.length);
  const valuePass =
    pairedOk &&
    reducedRepeat >= 3 &&
    observableImprove >= 3 &&
    !copiedTaskA &&
    !badOldFact &&
    blindEval.preferMapsTo === "B_digitalme";

  const summary = {
    probe: "C",
    ok: pairedOk,
    valueHypothesisSupported: valuePass,
    errorClass: pairedOk
      ? null
      : imageHits.length
        ? ERROR.UNEXPECTED_IMAGE_CAPABILITY_REQUEST
        : ERROR.VALUE_COMPARISON_INCOMPLETE,
    provider,
    modelName,
    taskA: {
      draftGenerated: draftA.length > 80,
      draftChars: draftA.length,
      revisedGenerated: acceptedA.length > 80,
      revisedChars: acceptedA.length,
      accepted: !!acceptMeta.accepted,
      taskId: acceptMeta.taskId,
    },
    learning: {
      expressionCount: learned.expression.length,
      factCount: learned.facts.length,
      boundaryCount: learned.boundaries.length,
      overlearnRiskCount: learned.overlearnRisks.length,
      expression: learned.expression.slice(0, 20),
      facts: learned.facts.slice(0, 20),
      boundaries: learned.boundaries.slice(0, 20),
    },
    groupA: groupA ? { chars: groupA.length } : { error: groupAError },
    groupB: { chars: groupB.length },
    dimensions: dim,
    reducedRepeatInstructionCount: reducedRepeat,
    reducedRepeatDetails: prefSignals,
    observableImproveDimensions: observableImprove,
    copiedTaskA,
    badOldFact,
    blindEval,
    imageHits,
    evidenceDir: EVIDENCE,
  };
  writeJson("summary.json", summary);
  fs.mkdirSync(evidenceRoot, { recursive: true });
  fs.writeFileSync(
    path.join(evidenceRoot, "probe-c-latest.json"),
    JSON.stringify(
      {
        ok: pairedOk,
        valueHypothesisSupported: valuePass,
        errorClass: summary.errorClass,
        evidenceDir: EVIDENCE,
        at: new Date().toISOString(),
      },
      null,
      2
    )
  );
  console.log(JSON.stringify({ ...summary, evidenceDir: EVIDENCE, learning: { expressionCount: learned.expression.length, factCount: learned.facts.length, boundaryCount: learned.boundaries.length } }));
  app.exit(pairedOk ? 0 : 5);
}

require("../src/main.js");
app.whenReady().then(() => {
  setTimeout(() => {
    runHarness().catch((err) => {
      const summary = {
        probe: "C",
        ok: false,
        errorClass: ERROR.VALUE_COMPARISON_INCOMPLETE,
        error: String(err && err.message ? err.message : err),
        evidenceDir: EVIDENCE,
      };
      writeJson("summary.json", summary);
      console.error(JSON.stringify(summary));
      app.exit(1);
    });
  }, 1400);
});
