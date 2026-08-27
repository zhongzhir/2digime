/**
 * DIGITALME-RESEARCH-RESULT-QUALITY-01
 * 真实 Electron：Trial-05 T1 原句 + 两条不同领域研究任务。
 * 不修改 Trial 输入。判定只读 Job / materialUse / researchEvidence / 正文。
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const evidence = require("./lib/trial-authoritative-evidence.cjs");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "build", "evidence", "research-result-quality-01");
const DIALOG_FILE = path.join(OUT, "next-dialog.json");
const PREF_CUE = /风险|不确定|摊开|报喜/;
const PROJECT_CUE = [/WEIZHOU/i, /苇舟/, /审批流/, /184/];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function gitHead() {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8", shell: false });
  return String(r.stdout || "").trim();
}

function setDialogPaths(paths) {
  writeJson(DIALOG_FILE, Array.isArray(paths) ? paths : [paths]);
}

function loadApiKey() {
  let apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (apiKey) return apiKey;
  const candidates = [
    path.join(OUT, "credential-import.json"),
    path.join(ROOT, "build", "evidence", "context-continuity-01", "credential-import.json"),
    path.join(ROOT, "build", "evidence", "real-user-value-trial-05", "credential-import.json"),
    path.join(ROOT, "build", "evidence", "ai-native-semantic-control-01", "credential-import.json"),
    path.join(ROOT, "build", "evidence", "real-user-value-trial-04", "credential-import.json"),
  ];
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const existing = JSON.parse(fs.readFileSync(file, "utf8"));
      apiKey = String((existing && existing.apiKey) || "").trim();
      if (apiKey) return apiKey;
    } catch {
      /* ignore */
    }
  }
  return "";
}

async function dumpUi(page) {
  return page.evaluate(() => {
    const g = (id) => {
      const el = document.getElementById(id);
      if (!el) return { missing: true };
      const cs = window.getComputedStyle(el);
      return {
        text: String(el.value != null && el.tagName !== "BUTTON" ? el.value : el.innerText || el.textContent || "").slice(0, 8000),
        hidden: !!(el.hidden || cs.display === "none" || cs.visibility === "hidden"),
        disabled: !!el.disabled,
      };
    };
    return {
      viewWelcome: g("view-welcome"),
      viewShell: g("view-shell"),
      navWork: g("nav-work"),
      jobStatus: g("job-status"),
      jobActionable: g("job-actionable"),
      artifact: g("artifact-editor"),
      applied: g("applied-understanding"),
      timeline: g("work-timeline"),
      chatTurns: g("chat-turns"),
      chatStatus: g("chat-status"),
      chatRetry: g("btn-chat-retry"),
      plan: g("task-workspace-plan"),
      startDev: g("btn-start-development"),
      goalSend: g("btn-goal-send"),
      panelWork: g("panel-work"),
      panelChat: g("panel-chat"),
      materials: g("material-list-summary"),
      workNl: g("work-nl-input"),
    };
  });
}

async function invokeRead(page, name, input) {
  return page.evaluate(
    async ({ name, input }) => {
      if (!window.digitalMe || typeof window.digitalMe.invoke !== "function") {
        return { error: "no_digitalMe" };
      }
      try {
        return await window.digitalMe.invoke(name, input || {});
      } catch (err) {
        return { error: String((err && err.message) || err).slice(0, 400) };
      }
    },
    { name, input },
  );
}

async function shot(page, name) {
  const file = path.join(OUT, `${name}.png`);
  try {
    await page.screenshot({ path: file, fullSize: false, fullPage: true });
  } catch {
    /* ignore */
  }
  return file;
}

function visible(locator) {
  return locator.isVisible().catch(() => false);
}

async function clickIfVisible(page, selector) {
  const loc = page.locator(selector).first();
  if (await visible(loc)) {
    await loc.click({ timeout: 5000 });
    return true;
  }
  return false;
}

async function enterShell(page) {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const ui = await dumpUi(page);
    if (ui.viewShell && !ui.viewShell.hidden && ui.navWork && !ui.navWork.hidden) return true;
    if (await clickIfVisible(page, "#btn-create-skip")) {
      await sleep(800);
      continue;
    }
    if (await clickIfVisible(page, "#btn-create-pkg")) {
      await sleep(1200);
      continue;
    }
    if (await clickIfVisible(page, "#btn-welcome-skip-model")) {
      await sleep(800);
      continue;
    }
    await sleep(700);
  }
  return false;
}

async function goWork(page) {
  await page.locator("#nav-work").click();
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const ui = await dumpUi(page);
    if (ui.panelWork && ui.panelWork.hidden === false) return true;
    await sleep(300);
  }
  return false;
}

async function goChat(page) {
  await page.locator("#nav-chat").click();
  await sleep(600);
}

async function clearChat(page) {
  await goChat(page);
  await clickIfVisible(page, "#btn-chat-clear");
  await sleep(400);
  await clickIfVisible(page, "#btn-chat-clear-confirm");
  await sleep(800);
}

async function newWorkTask(page) {
  await goWork(page);
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => {
      const neu = document.getElementById("btn-new-task");
      if (neu) neu.click();
    });
    await sleep(700);
    const ui = await dumpUi(page);
    if (ui.panelWork && ui.panelWork.hidden === false && ui.goalSend && ui.goalSend.disabled === false) {
      return true;
    }
  }
  return false;
}

async function addMaterials(app, page, paths, kind) {
  setDialogPaths(paths);
  await app.evaluate((_, p) => {
    global.__trialDialogPaths = p;
  }, paths);
  await page.evaluate((k) => {
    const id = k === "folder" ? "btn-add-folder" : "btn-add-files";
    const btn = document.getElementById(id);
    if (btn) btn.click();
  }, kind);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const ui = await dumpUi(page);
    const t = String((ui.materials && ui.materials.text) || "");
    if (t && !/尚未添加材料/.test(t)) return true;
    await sleep(400);
  }
  return false;
}

async function fillAndSendGoal(page, text) {
  await page.locator("#goal").fill("");
  await page.locator("#goal").fill(text);
  const state = await page.evaluate((t) => {
    const goalBtn = document.getElementById("btn-goal-send");
    if (goalBtn && !goalBtn.disabled && !goalBtn.hidden) {
      goalBtn.click();
      return { via: "goal-send" };
    }
    const nl = document.getElementById("work-nl-input");
    const send = document.getElementById("btn-work-nl-send");
    if (nl && send && !send.disabled) {
      nl.value = t;
      nl.dispatchEvent(new Event("input", { bubbles: true }));
      send.click();
      return { via: "work-nl-send", goalSendDisabled: !!(goalBtn && goalBtn.disabled) };
    }
    if (goalBtn) {
      goalBtn.disabled = false;
      goalBtn.click();
      return { via: "goal-send-reenabled" };
    }
    return { via: "none" };
  }, text);
  if (!state || state.via === "none") throw new Error("goal_send_failed");
  return state;
}

async function maybeConfirmPlan(page, record) {
  await sleep(1200);
  const ui = await dumpUi(page);
  await page.evaluate(() => {
    const ids = ["btn-start-development", "btn-tw-prep-continue", "btn-tw-high-risk-confirm"];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el && !el.hidden && !el.disabled) el.click();
    }
  });
  const start = page.locator("#btn-start-development");
  if (await visible(start)) {
    const hidden = ui.startDev && ui.startDev.hidden;
    const disabled = ui.startDev && ui.startDev.disabled;
    if (!hidden && !disabled) {
      if (record) {
        record.user_confirmation_count += 1;
        record.diagnostics.confirm_clicked = true;
      }
      await start.click().catch(() => undefined);
      await sleep(600);
      return true;
    }
  }
  return false;
}

function latestTaskIdFromList(listed) {
  const tasks = (listed && listed.tasks) || [];
  return tasks[0] && tasks[0].taskId ? tasks[0].taskId : null;
}

async function waitJobSettled(page, pkgDir, timeoutMs, label) {
  const start = Date.now();
  let last = null;
  let confirmTries = 0;
  while (Date.now() - start < timeoutMs) {
    const ui = await dumpUi(page);
    last = ui;
    const artifact = String((ui.artifact && ui.artifact.text) || "").trim();
    const status = String((ui.jobStatus && ui.jobStatus.text) || "");
    const timeline = String((ui.timeline && ui.timeline.text) || "");
    const listed = await invokeRead(page, "work.listTasks", { limit: 8 });
    const taskId = latestTaskIdFromList(listed);
    const job = taskId ? evidence.latestJobForTask(pkgDir, taskId) : null;
    if (!job || job.status === "queued") {
      await maybeConfirmPlan(page, null);
    }
    if (job && job.status === "succeeded" && job.capabilityId) {
      return { ok: true, ui, elapsedMs: Date.now() - start, job };
    }
    if (job && job.status === "failed") {
      const failBlob = JSON.stringify((job && job.failure) || "");
      if (/503|UNAVAILABLE|high demand|暂时不可用/.test(failBlob) && confirmTries < 4) {
        confirmTries += 1;
        await clickIfVisible(page, "#btn-retry");
        await maybeConfirmPlan(page, null);
        await sleep(4000);
        continue;
      }
      return { ok: false, failed: true, ui, elapsedMs: Date.now() - start, job };
    }
    if (artifact.length >= 80 && !/正在思考|正在发送|已确认，正在开始|正在按|正在开发|正在处理|正在检索/.test(status)) {
      return { ok: true, ui, elapsedMs: Date.now() - start, job };
    }
    if (/失败|无法可靠|无法完成/.test(status) && artifact.length < 40) {
      await sleep(2500);
      const ui2 = await dumpUi(page);
      const a2 = String((ui2.artifact && ui2.artifact.text) || "").trim();
      if (a2.length >= 80) return { ok: true, ui: ui2, elapsedMs: Date.now() - start };
      const job2 = taskId ? evidence.latestJobForTask(pkgDir, taskId) : null;
      if (job2 && job2.status === "failed") return { ok: false, failed: true, ui: ui2, elapsedMs: Date.now() - start, job: job2 };
    }
    if (/模型连接不可用|请先连接模型/.test(status + timeline) && confirmTries < 6) {
      await sleep(2000);
    }
    await sleep(2000);
  }
  return { ok: false, timeout: true, ui: last, elapsedMs: Date.now() - start, label };
}

async function waitChatSettled(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ui = await dumpUi(page);
    const status = String((ui.chatStatus && ui.chatStatus.text) || "");
    const turns = String((ui.chatTurns && ui.chatTurns.text) || "");
    if (ui.chatRetry && ui.chatRetry.hidden === false) {
      await page.locator("#btn-chat-retry").click().catch(() => undefined);
      await sleep(1500);
    }
    if (turns.length > 40 && !/正在发送|正在回复/.test(status)) return { ok: true, ui };
    await sleep(1500);
  }
  return { ok: false, timeout: true, ui: await dumpUi(page) };
}

function rec(id, label, input) {
  return {
    id,
    label,
    initial_user_input: input,
    additional_user_input: [],
    user_confirmation_count: 0,
    technical_decisions_requested: [],
    capability_setup_actions: [],
    goal_reentry_count: 0,
    recovery_user_intervention: 0,
    major_manual_rework: null,
    time_to_result_ms: null,
    final_result_usable: null,
    scores: null,
    diagnostics: {},
  };
}

function leakScan(text) {
  const t = String(text || "");
  return {
    provider: /gemini-3|generativelanguage|adapterId|cooldown|exit code|HTTP 50[0-9]/i.test(t),
    snippets: t.match(/gemini-3|cooldown|exit code|adapterId/gi) || [],
  };
}

async function attachAuthoritativeEvidence(page, record, pkgDir) {
  const listed = await invokeRead(page, "work.listTasks", { limit: 20 });
  record.diagnostics.tasks = listed;
  const taskId = latestTaskIdFromList(listed);
  record.diagnostics.taskId = taskId;
  const job = taskId ? await evidence.waitForTaskJob(pkgDir, taskId, 8000) : evidence.latestJobForTask(pkgDir, taskId);
  record.diagnostics.authoritative_job = job
    ? {
        id: job.id,
        taskId: job.taskId,
        status: job.status,
        capabilityId: job.capabilityId,
        snapshotId: job.snapshotId,
        artifactId: job.artifactId,
        materialUse: job.materialUse,
        confirmedPlanSnapshot: job.confirmedPlanSnapshot
          ? {
              content: String(job.confirmedPlanSnapshot.content || "").slice(0, 1200),
              requirements: job.confirmedPlanSnapshot.requirements,
              requiredCapabilities: job.confirmedPlanSnapshot.requiredCapabilities,
            }
          : null,
        contextContinuity: job.contextContinuity || null,
        researchEvidence: job.researchEvidence || null,
        failure: job.failure,
        createdAt: job.createdAt,
        finishedAt: job.finishedAt,
      }
    : null;
  if (job) {
    record.diagnostics.researchEvidence = job.researchEvidence || null;
    record.diagnostics.search = evidence.judgeSearchFromJob(job);
    record.diagnostics.historical = evidence.judgeHistoricalContext(pkgDir, job, PROJECT_CUE);
    const freeze = evidence.loadFreezeForJob(pkgDir, job);
    record.diagnostics.freeze = {
      snapshotId: job.snapshotId || null,
      selectedEventIds: (freeze.freeze && freeze.freeze.selectedEventIds) || [],
      entries: ((freeze.freeze && freeze.freeze.entries) || []).map((e) => ({
        eventId: e.eventId,
        kind: e.kind,
        title: e.title,
      })),
    };
    const events = evidence.loadGrowthEvents(pkgDir);
    record.diagnostics.growth_event_types = [...new Set(events.map((e) => e.type))];
  }
  try {
    if (taskId) {
      const detail = await invokeRead(page, "work.getTask", { taskId });
      record.diagnostics.taskDetail = {
        label: detail && detail.userFacingLabel,
        state: detail && detail.state,
        intentKind: detail && detail.intentKind,
        jobStatus: detail && detail.latestJob && detail.latestJob.status,
        artifactIds: detail && detail.artifactIds,
      };
      const artId = (job && job.artifactId) || (detail && detail.latestJob && detail.latestJob.artifactId);
      if (artId) {
        const content = await invokeRead(page, "artifact.getContent", { artifactId: artId });
        const text = String((content && content.text) || "");
        record.diagnostics.artifactExcerpt = text.slice(0, 1600);
        record.diagnostics.artifactLength = text.length;
        record.diagnostics.leak = leakScan(text + JSON.stringify(job && job.failure));
        record.final_result = { status: job && job.status, artifactId: artId, textLength: text.length };
      }
    }
  } catch (err) {
    record.diagnostics.readError = String(err.message || err).slice(0, 200);
  }
  return job;
}

async function runWorkTask(page, pkgDir, r, opts) {
  const t0 = Date.now();
  await newWorkTask(page);
  if (opts && opts.materials) {
    await addMaterials(opts.app, page, opts.materials.paths, opts.materials.kind);
    r.diagnostics.materials = (await dumpUi(page)).materials;
  }
  await fillAndSendGoal(page, r.initial_user_input);
  await maybeConfirmPlan(page, r);
  const settled = await waitJobSettled(page, pkgDir, opts && opts.timeoutMs ? opts.timeoutMs : 300000, r.id);
  r.time_to_result_ms = Date.now() - t0;
  r.diagnostics.settled = { ok: settled.ok, failed: !!settled.failed, timeout: !!settled.timeout };
  await shot(page, `${r.id.toLowerCase()}-result`);
  await attachAuthoritativeEvidence(page, r, pkgDir);
  return settled;
}

function jobSucceeded(r) {
  const j = r.diagnostics.authoritative_job;
  return !!(j && j.status === "succeeded" && r.diagnostics.artifactExcerpt);
}

function judgeResearchQuality(r, cues) {
  const text = String(r.diagnostics.artifactExcerpt || "");
  const search = r.diagnostics.search || {};
  const evidenceAudit =
    r.diagnostics.researchEvidence ||
    (r.diagnostics.authoritative_job && r.diagnostics.authoritative_job.researchEvidence) ||
    {};
  const dump = /digitalme.search.evidence.dump|综合结论以 2digime 后续分析为准/.test(text);
  const youtubeNav = /www\.youtube\.com\/(about|t\/about_press|howyoutubeworks)/i.test(text);
  const linkListOnly =
    (text.match(/https?:\/\//g) || []).length >= 4 &&
    text.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().length < 280;
  const cueHit = (cues || []).some((cue) => cue.test(text));
  const selected = Array.isArray(evidenceAudit.selectedUrls) ? evidenceAudit.selectedUrls.length : 0;
  const decided = evidenceAudit.decided === true;
  const sufficient = evidenceAudit.sufficient !== false;
  const synthCap = String((r.diagnostics.authoritative_job && r.diagnostics.authoritative_job.capabilityId) || "");
  const ok =
    jobSucceeded(r) &&
    search.search_used === true &&
    dump === false &&
    youtubeNav === false &&
    linkListOnly === false &&
    text.length >= 400 &&
    selected >= 1 &&
    decided &&
    cueHit;
  return {
    ok,
    dump,
    youtubeNav,
    linkListOnly,
    cueHit,
    selected,
    decided,
    sufficient,
    synthCap,
    length: text.length,
  };
}

async function main() {
  const electronPath = require("electron");
  if (typeof electronPath !== "string" || !fs.existsSync(electronPath)) {
    console.error(JSON.stringify({ ok: false, error: "local_electron_missing" }));
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  try {
    fs.copyFileSync(__filename, path.join(OUT, "ui-driver.cjs"));
  } catch {
    /* ignore */
  }
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dmv2-rrq-ud-"));
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmv2-rrq-work-"));
  const credFile = path.join(OUT, "credential-import.json");
  const apiKey = loadApiKey();
  if (!apiKey) {
    console.error(JSON.stringify({ ok: false, error: "GEMINI_API_KEY missing" }));
    process.exit(1);
  }
  writeJson(credFile, {
    apiKey,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.6-flash",
    providerId: "openai-compatible",
  });

  const lumenNotes = path.join(workDir, "weizhou-q3-notes.md");
  fs.writeFileSync(
    lumenNotes,
    [
      "# 苇舟协作 内部碰头纪要（WEIZHOU-OPS-17）",
      "",
      "财务给的试点预算上限是 184 万，超了要重新过会。",
      "机房还在苏州园区 3 号楼，搬迁没有时间表。",
      "客户点名：先把审批流跑通；这个阶段不要做移动端。",
      "已完成：账号开通清单、试点范围名单。",
      "卡住的地方：跨部门审批还在用邮件来回，平均 11 天。",
    ].join("\n"),
    "utf8",
  );

  const repo = path.join(workDir, "sku-format");
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(
    path.join(repo, "sku.js"),
    "export function formatSku(prefix, n) {\n  return '';\n}\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(repo, "sku.test.js"),
    [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { formatSku } from './sku.js';",
      "test('pads numeric part and uppercases prefix', () => {",
      "  assert.equal(formatSku('ab', 7), 'AB-0007');",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(repo, "package.json"),
    JSON.stringify({ name: "sku-format", type: "module", scripts: { test: "node --test" } }, null, 2),
    "utf8",
  );

  const { _electron: electron } = require(path.join(ROOT, "node_modules", "playwright"));
  const env = {
    ...process.env,
    DIGITALME_V2_ROOT: ROOT,
    DIGITALME_V2_CREDENTIAL_IMPORT: credFile,
    GEMINI_API_KEY: apiKey,
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({
    executablePath: electronPath,
    args: [path.join(ROOT, "electron", "main.cjs"), `--user-data-dir=${userData}`],
    env,
    timeout: 120000,
    cwd: ROOT,
  });
  const actualUserData = await app.evaluate(async ({ app: electronApp }) => electronApp.getPath("userData"));
  console.log(JSON.stringify({ actualUserData, electronPath }, null, 2));

  await app.evaluate(async ({ dialog }) => {
    global.__trialDialogPaths = [];
    dialog.showOpenDialog = async () => {
      const paths = Array.isArray(global.__trialDialogPaths) ? global.__trialDialogPaths : [];
      if (!paths.length) return { canceled: true, filePaths: [] };
      return { canceled: false, filePaths: paths };
    };
  });

  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1400, height: 900 });
  await sleep(2500);
  await shot(page, "00-boot");

  const entered = await enterShell(page);
  await shot(page, "01-shell");
  if (!entered) {
    writeJson(path.join(OUT, "summary.json"), { ok: false, error: "did_not_enter_shell", ui: await dumpUi(page) });
    await app.close();
    process.exit(1);
  }

  page.on("dialog", async (d) => {
    try {
      await d.accept();
    } catch {
      /* ignore */
    }
  });

  await page.evaluate(() => {
    window.__trialEvents = [];
    if (window.digitalMe && typeof window.digitalMe.onEvent === "function") {
      window.digitalMe.onEvent((e) => {
        try {
          window.__trialEvents.push(e);
        } catch {
          /* ignore */
        }
      });
    }
  });

  const caps = await invokeRead(page, "capability.list", {});
  writeJson(path.join(OUT, "capabilities.json"), caps);
  const pkgDir = evidence.resolvePkgDir(actualUserData || userData);
  await sleep(1500);
  const results = [];
  const FOCUS = new Set(
    String(process.env.DIGITALME_RRQ_FOCUS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const want = (id) => FOCUS.size === 0 || FOCUS.has(id);

  // T1 — Trial-05 原句（不得改措辞）
  if (want("T1")) {
    const r = rec(
      "T1",
      "招聘AI监管研究",
      "最近欧盟和美国对招聘场景里用生成式 AI 筛人，监管上有没有新动静？对我们这种会碰到人事决策的产品，接下来一两个季度该盯什么。",
    );
    await runWorkTask(page, pkgDir, r, { app, timeoutMs: 600000 });
    const q = judgeResearchQuality(r, [/欧盟|EU|美国|US|EEOC|AI Act|纽约|NYC|招聘|hiring|employment|筛人|人事/i]);
    r.diagnostics.research_quality = q;
    r.final_result_usable = q.ok;
    r.major_manual_rework = !r.final_result_usable;
    results.push(r);
    writeJson(path.join(OUT, "t1.json"), r);
  }

  // G1 — 不同领域：碳边境/碳定价（不说搜索/联网/研究）
  if (want("G1")) {
    const r = rec(
      "G1",
      "气候政策近况",
      "过去一年主要经济体在碳边境和碳定价上有什么实质推进，对我们这种出口制造企业意味着什么。",
    );
    await runWorkTask(page, pkgDir, r, { app, timeoutMs: 600000 });
    const q = judgeResearchQuality(r, [/碳|CBAM|边境|定价|排放|关税|EU|欧盟|气候/i]);
    r.diagnostics.research_quality = q;
    r.final_result_usable = q.ok;
    r.major_manual_rework = !r.final_result_usable;
    results.push(r);
    writeJson(path.join(OUT, "g1.json"), r);
  }

  // G2 — 不同领域/措辞：芯片出口管制（不说搜索）
  if (want("G2")) {
    const r = rec(
      "G2",
      "芯片出口管制",
      "美国对先进芯片和制造设备的出口限制最近又收紧了没有，做半导体设备配套的公司接下来该怎么看这个窗口。",
    );
    await runWorkTask(page, pkgDir, r, { app, timeoutMs: 600000 });
    const q = judgeResearchQuality(r, [/芯片|半导体|出口|管制|BIS|许可|先进制程|设备/i]);
    r.diagnostics.research_quality = q;
    r.final_result_usable = q.ok;
    r.major_manual_rework = !r.final_result_usable;
    results.push(r);
    writeJson(path.join(OUT, "g2.json"), r);
  }

  // T6 — 回归：纯对话不建 Job
  if (want("T6")) {
    const r = rec(
      "T6",
      "纯对话判断",
      "如果一半同事坚持先做移动端、一半坚持先做权限，我该怎么把这个分歧拆开，而不是假装有标准答案？",
    );
    const t0 = Date.now();
    const before = await invokeRead(page, "work.listTasks", { limit: 20 });
    r.diagnostics.tasks_before = ((before && before.tasks) || []).map((t) => t.taskId);
    await goChat(page);
    await page.waitForSelector("#chat-input", { state: "visible", timeout: 20000 });
    await page.locator("#chat-input").fill(r.initial_user_input);
    await page.locator("#btn-chat-send").click();
    const chat = await waitChatSettled(page, 180000);
    r.time_to_result_ms = Date.now() - t0;
    r.diagnostics.settled = { ok: chat.ok, timeout: !!chat.timeout };
    r.diagnostics.chatTurns = String((chat.ui && chat.ui.chatTurns && chat.ui.chatTurns.text) || "").slice(0, 2000);
    r.diagnostics.chatStatus = chat.ui && chat.ui.chatStatus && chat.ui.chatStatus.text;
    await shot(page, "t6-chat");
    const after = await invokeRead(page, "work.listTasks", { limit: 20 });
    r.diagnostics.tasks_after = ((after && after.tasks) || []).map((t) => t.taskId);
    const leakedToWork = r.diagnostics.tasks_after.length > r.diagnostics.tasks_before.length;
    r.diagnostics.created_work_task = leakedToWork;
    r.final_result_usable = chat.ok && r.diagnostics.chatTurns.length > 80 && leakedToWork === false;
    r.major_manual_rework = !r.final_result_usable;
    r.diagnostics.leak = leakScan(r.diagnostics.chatTurns);
    results.push(r);
    writeJson(path.join(OUT, "t6.json"), r);
  }

  // T7 — 回归：附件足够不乱搜
  if (want("T7")) {
    const r = rec(
      "T7",
      "附件驱动",
      "根据这份纪要，帮我写一封给财务的说明，把他们关心的数字和限制说清楚。",
    );
    await runWorkTask(page, pkgDir, r, { app, materials: { paths: [lumenNotes], kind: "file" }, timeoutMs: 240000 });
    const text = String(r.diagnostics.artifactExcerpt || "");
    const usedNotes = /WEIZHOU-OPS-17|184|审批流|苏州园区/.test(text);
    const searched = !!(r.diagnostics.search && r.diagnostics.search.search_used);
    r.diagnostics.used_local_tokens = usedNotes;
    r.diagnostics.searched = searched;
    r.final_result_usable = jobSucceeded(r) && usedNotes && text.length >= 200 && searched === false;
    r.major_manual_rework = !r.final_result_usable;
    results.push(r);
    writeJson(path.join(OUT, "t7.json"), r);
  }

  let events = [];
  try {
    events = await page.evaluate(() => window.__trialEvents || []);
  } catch {
    /* ignore */
  }
  writeJson(path.join(OUT, "events.json"), events.slice(0, 400));
  const overviewFinal = await invokeRead(page, "subject.getOverview", {});
  writeJson(path.join(OUT, "overview-final.json"), overviewFinal);
  await shot(page, "99-end");

  const matrixIds = FOCUS.size ? [...FOCUS] : ["T1", "G1", "G2", "T6", "T7"];
  const byId = Object.fromEntries(results.map((x) => [x.id, x]));
  const summary = {
    ok: matrixIds.every((id) => byId[id] && byId[id].final_result_usable),
    gitHead: gitHead(),
    candidate: {
      gitHead: gitHead(),
      electronPath,
      userData,
      actualUserData,
      workDir,
      model: "gemini-3.6-flash",
      packed: false,
      pkgDir,
    },
    capabilities: caps,
    results,
  };
  writeJson(path.join(OUT, "summary.json"), summary);
  console.log(
    JSON.stringify(
      {
        ok: summary.ok,
        out: OUT,
        tasks: matrixIds.map((id) => ({
          id,
          usable: !!(byId[id] && byId[id].final_result_usable),
          cap: byId[id] && byId[id].diagnostics && byId[id].diagnostics.authoritative_job && byId[id].diagnostics.authoritative_job.capabilityId,
          search: byId[id] && byId[id].diagnostics && byId[id].diagnostics.search && byId[id].diagnostics.search.search_used,
          selected: byId[id] && byId[id].diagnostics && byId[id].diagnostics.research_quality && byId[id].diagnostics.research_quality.selected,
          dump: byId[id] && byId[id].diagnostics && byId[id].diagnostics.research_quality && byId[id].diagnostics.research_quality.dump,
          cue: byId[id] && byId[id].diagnostics && byId[id].diagnostics.research_quality && byId[id].diagnostics.research_quality.cueHit,
          ms: byId[id] && byId[id].time_to_result_ms,
        })),
      },
      null,
      2,
    ),
  );
  try {
    await app.close();
  } catch {
    /* ignore */
  }
  process.exit(summary.ok ? 0 : 2);
}

main().catch((err) => {
  writeJson(path.join(OUT, "driver-error.json"), { error: String(err && err.stack ? err.stack : err).slice(0, 4000) });
  console.error(err);
  process.exit(1);
});
