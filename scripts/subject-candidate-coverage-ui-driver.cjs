/**
 * DIGITALME-SUBJECT-CANDIDATE-COVERAGE-01
 * Electron: short/medium/long session + C2 + 新组合任务 + T2/T3/T5/C1 回归。
 * 不提示内部能力。不修 research decided / T4 验收文案。
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const evidence = require("./lib/trial-authoritative-evidence.cjs");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.resolve(
  process.env.DIGITALME_TRIAL_EVIDENCE_DIR || path.join(ROOT, "build", "evidence", "subject-candidate-coverage-01"),
);
const DIALOG_FILE = path.join(OUT, "next-dialog.json");
const PREF_CUE = /风险|不确定|摊开|报喜|没把握/;
const COOK_PREF_CUE = /清单|备菜|一步一步|家常做法/;
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
    path.join(ROOT, "build", "evidence", "subject-preference-reliability-01", "credential-import.json"),
    path.join(ROOT, "build", "evidence", "research-result-quality-01", "credential-import.json"),
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
  if (!(await visible(loc))) return false;
  const enabled = await loc.isEnabled().catch(() => false);
  if (!enabled) return false;
  await loc.click({ timeout: 5000 }).catch(() => undefined);
  return true;
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

function latestTaskIdFromList(listed, goal) {
  const tasks = (listed && listed.tasks) || [];
  if (goal) {
    const exact = tasks.find((t) => String(t.goal || "") === String(goal));
    if (exact && exact.taskId) return exact.taskId;
    const prefix = String(goal).slice(0, 24);
    const soft = tasks.find((t) => String(t.goal || "").includes(prefix));
    if (soft && soft.taskId) return soft.taskId;
    return null;
  }
  return tasks[0] && tasks[0].taskId ? tasks[0].taskId : null;
}

async function waitJobSettled(page, pkgDir, timeoutMs, label, goal) {
  const start = Date.now();
  let last = null;
  let confirmTries = 0;
  while (Date.now() - start < timeoutMs) {
    const ui = await dumpUi(page);
    last = ui;
    const listed = await invokeRead(page, "work.listTasks", { limit: 12 });
    const taskId = latestTaskIdFromList(listed, goal);
    const job = taskId ? evidence.latestJobForTask(pkgDir, taskId) : null;
    const artifact = String((ui.artifact && ui.artifact.text) || "").trim();
    const status = String((ui.jobStatus && ui.jobStatus.text) || "");
    const timeline = String((ui.timeline && ui.timeline.text) || "");
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
    if (
      job &&
      artifact.length >= 80 &&
      !/正在思考|正在发送|已确认，正在开始|正在按|正在开发|正在处理|正在检索/.test(status)
    ) {
      return { ok: true, ui, elapsedMs: Date.now() - start, job };
    }
    if (/失败|无法可靠|无法完成/.test(status) && artifact.length < 40) {
      await sleep(2500);
      const ui2 = await dumpUi(page);
      const a2 = String((ui2.artifact && ui2.artifact.text) || "").trim();
      const job2 = taskId ? evidence.latestJobForTask(pkgDir, taskId) : null;
      if (a2.length >= 80 && job2 && job2.status === "succeeded") {
        return { ok: true, ui: ui2, elapsedMs: Date.now() - start, job: job2 };
      }
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
  const taskId = latestTaskIdFromList(listed, record.initial_user_input);
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
  const settled = await waitJobSettled(page, pkgDir, opts && opts.timeoutMs ? opts.timeoutMs : 300000, r.id, r.initial_user_input);
  r.time_to_result_ms = Date.now() - t0;
  r.diagnostics.settled = { ok: settled.ok, failed: !!settled.failed, timeout: !!settled.timeout };
  await shot(page, `${r.id.toLowerCase()}-result`);
  await attachAuthoritativeEvidence(page, r, pkgDir);
  return settled;
}

function jobSucceeded(r) {
  return !!(r.diagnostics.authoritative_job && r.diagnostics.authoritative_job.status === "succeeded");
}

function emptyTemplate(text) {
  return /\[[^\]]{0,16}填写/.test(text) || /\[核心项目/.test(text) || /\[待补充/.test(text);
}

function annotateCoverage(r) {
  const cc =
    (r.diagnostics.authoritative_job && r.diagnostics.authoritative_job.contextContinuity) || {};
  const ids = cc.candidateIds || [];
  r.diagnostics.candidate_coverage = {
    candidateCount: ids.length,
    preferenceInCandidates: ids.some((id) => String(id).startsWith("preference:")),
    preferenceCandidateIds: ids.filter((id) => String(id).startsWith("preference:")),
    artifactCount: ids.filter((id) => String(id).startsWith("artifact:")).length,
    conversationCount: ids.filter((id) => String(id).startsWith("conversation:")).length,
    folderCount: ids.filter((id) => String(id).startsWith("task_folder:")).length,
  };
  return r.diagnostics.candidate_coverage;
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
  const ok =
    jobSucceeded(r) &&
    search.search_used === true &&
    dump === false &&
    youtubeNav === false &&
    linkListOnly === false &&
    text.length >= 400 &&
    (selected >= 1 || search.search_used === true) &&
    cueHit;
  return { ok, dump, youtubeNav, linkListOnly, cueHit, selected, decided, length: text.length };
}

async function main() {
  const electronPath = require("electron");
  if (typeof electronPath !== "string" || !fs.existsSync(electronPath)) {
    console.error(JSON.stringify({ ok: false, error: "local_electron_missing" }));
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dmv2-subjcand-ud-"));
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmv2-subjcand-work-"));
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

  const repo = path.join(workDir, "lot-format");
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(
    path.join(repo, "lot.js"),
    "export function formatRef(prefix, n) {\n  return '';\n}\n",
    "utf8",
  );
  fs.writeFileSync(
    path.join(repo, "lot.test.js"),
    [
      "import test from 'node:test';",
      "import assert from 'node:assert/strict';",
      "import { formatRef } from './lot.js';",
      "test('pads numeric part and uppercases prefix', () => {",
      "  assert.equal(formatRef('ab', 7), 'AB-0007');",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(repo, "package.json"),
    JSON.stringify({ name: "lot-format", type: "module", scripts: { test: "node --test" } }, null, 2),
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
    String(process.env.DIGITALME_SUBJCAND_FOCUS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const SKIP_DEFAULT = new Set(["T1", "T4", "T8"]);
  const want = (id) => (FOCUS.size === 0 ? !SKIP_DEFAULT.has(id) : FOCUS.has(id));

  // T6 — 纯对话，不应建 Job（措辞微调）
  if (want("T6")) {
    const r = rec(
      "T6",
      "纯对话判断",
      "一半人想先把入口铺开，一半人想先把权限边界钉死。这种分歧我该怎么拆开看，别假装有标准答案。",
    );
    const t0 = Date.now();
    const before = await invokeRead(page, "work.listTasks", { limit: 20 });
    r.diagnostics.tasks_before = ((before && before.tasks) || []).map((t) => t.taskId);
    await goChat(page);
    await page.waitForSelector("#chat-input", { state: "visible", timeout: 20000 });
    await page.locator("#chat-input").fill(r.initial_user_input);
    await page.locator("#btn-chat-send").click();
    let chat = await waitChatSettled(page, 180000);
    const status1 = String((chat.ui && chat.ui.chatStatus && chat.ui.chatStatus.text) || "");
    if (/暂时无法回复|请稍后重试/.test(status1)) {
      await clickIfVisible(page, "#btn-chat-retry");
      chat = await waitChatSettled(page, 180000);
    }
    r.time_to_result_ms = Date.now() - t0;
    r.diagnostics.settled = { ok: chat.ok, timeout: !!chat.timeout };
    r.diagnostics.chatTurns = String((chat.ui && chat.ui.chatTurns && chat.ui.chatTurns.text) || "").slice(0, 2000);
    r.diagnostics.chatStatus = chat.ui && chat.ui.chatStatus && chat.ui.chatStatus.text;
    await shot(page, "t6-chat");
    const after = await invokeRead(page, "work.listTasks", { limit: 20 });
    r.diagnostics.tasks_after = ((after && after.tasks) || []).map((t) => t.taskId);
    const leakedToWork = r.diagnostics.tasks_after.length > r.diagnostics.tasks_before.length;
    r.diagnostics.created_work_task = leakedToWork;
    const assistantOk =
      r.diagnostics.chatTurns.length > r.initial_user_input.length + 40 &&
      !/暂时无法回复/.test(String(r.diagnostics.chatStatus || ""));
    r.final_result_usable = chat.ok && assistantOk && leakedToWork === false;
    r.major_manual_rework = !r.final_result_usable;
    r.diagnostics.leak = leakScan(r.diagnostics.chatTurns);
    results.push(r);
    writeJson(path.join(OUT, "t6.json"), r);
  }

  // T3a — 等价但不同措辞的长期偏好
  if (want("T3") || want("T3A")) {
    const r = rec(
      "T3A",
      "偏好表达",
      "跟上面同步进展时，我更习惯先把没把握和风险摊开，结论建议往后放。别一上来报喜。",
    );
    const t0 = Date.now();
    await clearChat(page);
    await page.waitForSelector("#chat-input", { state: "visible", timeout: 20000 });
    await page.locator("#chat-input").fill(r.initial_user_input);
    await page.locator("#btn-chat-send").click();
    const chat = await waitChatSettled(page, 180000);
    r.time_to_result_ms = Date.now() - t0;
    r.diagnostics.settled = { ok: chat.ok, timeout: !!chat.timeout };
    r.diagnostics.chatTurns = String((chat.ui && chat.ui.chatTurns && chat.ui.chatTurns.text) || "").slice(0, 1600);
    await shot(page, "t3a-chat");
    const learned = await evidence.waitForAdoptedPreference(pkgDir, PREF_CUE, 120000);
    r.diagnostics.preference = learned;
    r.final_result_usable = chat.ok === true;
    results.push(r);
    writeJson(path.join(OUT, "t3a.json"), r);
  }

  // P2 — 不相关 durable preference，验证 coverage 不会造成偏好污染
  if (want("P2") || want("C2") || want("C3") || FOCUS.size === 0) {
    const r = rec(
      "P2",
      "不相关偏好",
      "我记备菜和家常做法的时候，更想一步一步清单，不要写成散文。这跟工作汇报没关系。",
    );
    const t0 = Date.now();
    await clearChat(page);
    await page.waitForSelector("#chat-input", { state: "visible", timeout: 20000 });
    await page.locator("#chat-input").fill(r.initial_user_input);
    await page.locator("#btn-chat-send").click();
    const chat = await waitChatSettled(page, 180000);
    r.time_to_result_ms = Date.now() - t0;
    r.diagnostics.settled = { ok: chat.ok, timeout: !!chat.timeout };
    r.diagnostics.chatTurns = String((chat.ui && chat.ui.chatTurns && chat.ui.chatTurns.text) || "").slice(0, 1600);
    await shot(page, "p2-chat");
    const learned = await evidence.waitForAdoptedPreference(pkgDir, COOK_PREF_CUE, 90000);
    r.diagnostics.preference = learned;
    r.final_result_usable = chat.ok === true;
    results.push(r);
    writeJson(path.join(OUT, "p2.json"), r);
  }

  // T7 — 附件驱动（不说不要联网）
  if (want("T7") || want("T2") || want("T5") || want("T3") || want("C1") || want("C2") || FOCUS.size === 0) {
    const r = rec(
      "T7",
      "附件驱动",
      "根据这份碰头纪要，给财务写封说明，预算和卡住的限制写清楚。",
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

  // T3b — 短会话偏好复用（T7 之后立刻，不提偏好词）
  if (want("T3") || want("T3B")) {
    const r = rec("T3B", "偏好复用", "给管理层写一版这个阶段的进展，开会能直接看。");
    await runWorkTask(page, pkgDir, r, { app, timeoutMs: 240000 });
    const learned = evidence.judgePreferenceLearned(pkgDir, PREF_CUE);
    const ctx = evidence.judgePreferenceInJobContext(pkgDir, r.diagnostics.authoritative_job, learned);
    const freezeTextHit = (r.diagnostics.freeze && r.diagnostics.freeze.entries || []).some((e) => e.kind === "preference");
    const text = String(r.diagnostics.artifactExcerpt || "");
    const riskFirst = /风险|不确定|缺口|未决/.test(text.slice(0, 600));
    const coverage = annotateCoverage(r);
    r.diagnostics.preference = learned;
    r.diagnostics.preference_in_context = !!(ctx.preference_in_context || freezeTextHit);
    r.diagnostics.risk_first_shape = riskFirst;
    r.diagnostics.continuity = r.diagnostics.authoritative_job && r.diagnostics.authoritative_job.contextContinuity;
    r.final_result_usable =
      jobSucceeded(r) &&
      text.length >= 200 &&
      learned.preference_adopted === true &&
      r.diagnostics.preference_in_context === true &&
      coverage.preferenceInCandidates === true;
    r.major_manual_rework = !r.final_result_usable;
    results.push(r);
    writeJson(path.join(OUT, "t3b.json"), r);
  }

  // D1 — 近期无关项目，给 T2/C2 做竞争项
  if (want("D1") || want("T2") || want("C2") || FOCUS.size === 0) {
    const cook = rec("D1", "近期无关项目", "写一份番茄炒蛋家常做法，别掺项目的事。");
    await runWorkTask(page, pkgDir, cook, { app, timeoutMs: 180000 });
    cook.final_result_usable = jobSucceeded(cook);
    results.push(cook);
    writeJson(path.join(OUT, "d1.json"), cook);
  }

  // T1 — 当前外部研究（措辞微调，不说搜索）
  if (want("T1")) {
    const r = rec(
      "T1",
      "最新现实信息",
      "欧美用人用生成式模型筛简历，监管最近有没有实质变化？我们产品会碰到人事决策，接下来半年合规上该先盯哪些。",
    );
    await runWorkTask(page, pkgDir, r, { app, timeoutMs: 600000 });
    const q = judgeResearchQuality(r, [/欧盟|EU|美国|US|EEOC|AI Act|纽约|NYC|招聘|hiring|employment|筛人|人事/i]);
    r.diagnostics.research_quality = q;
    r.final_result_usable = q.ok;
    r.major_manual_rework = !r.final_result_usable;
    results.push(r);
    writeJson(path.join(OUT, "t1.json"), r);
  }

  // T2 — 已有项目连续（不重新附材料、不点名）
  if (want("T2")) {
    const r = rec("T2", "已有项目连续", "眼下这块如果只能先动一件，你觉得该先啃哪头？别再摊成一堆。");
    await runWorkTask(page, pkgDir, r, { app, timeoutMs: 360000 });
    const text = String(r.diagnostics.artifactExcerpt || "");
    const hist = r.diagnostics.historical || {};
    const projectHit = PROJECT_CUE.some((re) => re.test(text));
    const mobileFirst = /先做移动端|优先移动端/.test(text) && !/不要做移动端|先把审批/.test(text);
    const cookingLeak = /番茄炒蛋|先炒洋葱|家常/.test(text);
    const freezeHasHist = !!(
      r.diagnostics.authoritative_job &&
      r.diagnostics.authoritative_job.contextContinuity &&
      (r.diagnostics.authoritative_job.contextContinuity.attachedRefs || []).length
    );
    r.diagnostics.project_tokens_in_result = projectHit;
    r.diagnostics.contradicts_notes = mobileFirst;
    r.diagnostics.unrelated_cooking_leak = cookingLeak;
    r.diagnostics.freeze_has_historical = freezeHasHist;
    annotateCoverage(r);
    r.final_result_usable =
      jobSucceeded(r) && (hist.historical_context_used === true || projectHit) && !mobileFirst && !cookingLeak;
    r.major_manual_rework = !r.final_result_usable;
    results.push(r);
    writeJson(path.join(OUT, "t2.json"), r);
  }

  // T5 — 开放目标
  if (want("T5")) {
    const r = rec("T5", "开放目标", "收成我下周一对上能直接开口讲的一版，别让我再拼材料。");
    await runWorkTask(page, pkgDir, r, { app, timeoutMs: 240000 });
    const text = String(r.diagnostics.artifactExcerpt || "");
    const hist = r.diagnostics.historical || {};
    const specific = PROJECT_CUE.some((re) => re.test(text));
    r.diagnostics.open_used_project = specific || hist.historical_context_used;
    r.diagnostics.empty_template = emptyTemplate(text);
    annotateCoverage(r);
    r.final_result_usable =
      jobSucceeded(r) && text.length >= 250 && (specific || hist.historical_context_used) && !emptyTemplate(text);
    r.major_manual_rework = !r.final_result_usable;
    results.push(r);
    writeJson(path.join(OUT, "t5.json"), r);
  }

  // F — 拉长会话：近期无关 conversation/artifact，逼出旧的全局 16 截断
  if (want("F") || want("C2") || want("C3") || FOCUS.size === 0) {
    const fillers = [
      "用两三句话记下：会议室投影仪色偏，明天找行政。",
      "记一下：打印机缺黑墨，别写成项目汇报。",
      "提醒我周五把工位钥匙还给前台。",
      "随手记：茶水间热水壶坏了，已报修。",
      "备忘：下周二电梯保养，上午别约访客。",
      "记一笔：工牌丢了，先用临时卡。",
    ];
    for (let i = 0; i < fillers.length; i++) {
      const r = rec(`F${i + 1}`, "长会话填充", fillers[i]);
      await runWorkTask(page, pkgDir, r, { app, timeoutMs: 180000 });
      annotateCoverage(r);
      r.final_result_usable = jobSucceeded(r);
      r.major_manual_rework = !r.final_result_usable;
      results.push(r);
      writeJson(path.join(OUT, `f${i + 1}.json`), r);
    }
  }

  // T4 — Coding Agent（轻微换题，仍是小功能+已有测试）
  if (want("T4")) {
    const r = rec(
      "T4",
      "Coding Agent",
      "这个小仓库里引用号格式化的测试已经写好了，实现还是空的。按测试把功能补上，跑通就行。",
    );
    await runWorkTask(page, pkgDir, r, { app, materials: { paths: [repo], kind: "folder" }, timeoutMs: 420000 });
    const after = fs.readFileSync(path.join(repo, "lot.js"), "utf8");
    r.diagnostics.file_after = after.slice(0, 800);
    r.diagnostics.file_changed = after.includes("AB-0007") || /toUpperCase|padStart|pad/.test(after);
    const testRun = spawnSync(process.execPath, ["--test", "lot.test.js"], {
      cwd: repo,
      encoding: "utf8",
      shell: false,
      timeout: 20000,
    });
    r.diagnostics.test_exit = testRun.status;
    r.diagnostics.test_out = String(testRun.stdout || "").slice(0, 400) + String(testRun.stderr || "").slice(0, 200);
    r.diagnostics.executor_cap = r.diagnostics.authoritative_job && r.diagnostics.authoritative_job.capabilityId;
    r.final_result_usable = testRun.status === 0 && r.diagnostics.file_changed === true && jobSucceeded(r);
    r.major_manual_rework = !r.final_result_usable;
    results.push(r);
    writeJson(path.join(OUT, "t4.json"), r);
  }

  // T8 — 连续现实信息，观察自然瞬时失败/fallback（不注入产品故障）
  if (want("T8")) {
    const r = rec(
      "T8",
      "可恢复失败",
      "训练数据授权、开源模型这摊诉讼，最近有没有新动向？继续用第三方模型我们该小心什么。",
    );
    await runWorkTask(page, pkgDir, r, { app, timeoutMs: 600000 });
    const job = r.diagnostics.authoritative_job;
    const failMsg = JSON.stringify((job && job.failure) || {});
    const events = await page.evaluate(() => (window.__trialEvents || []).slice(-80));
    r.diagnostics.recent_events = events.map((e) => ({
      kind: e && e.kind,
      status: e && e.status,
      progressNote: e && e.progressNote,
      jobId: e && e.jobId,
    }));
    const notes = r.diagnostics.recent_events.map((e) => String(e.progressNote || "")).join(" | ");
    r.diagnostics.fallback_note = /切换可用能力继续/.test(notes);
    r.diagnostics.search_misreported =
      job &&
      job.status === "failed" &&
      /无法可靠获取最新外部信息/.test(failMsg) &&
      /整理|模型/.test(failMsg) === false &&
      r.diagnostics.search &&
      r.diagnostics.search.material_search_evidence;
    const leak = leakScan(failMsg + notes + String(r.diagnostics.artifactExcerpt || ""));
    r.diagnostics.leak = leak;
    const q = judgeResearchQuality(r, [/训练|诉讼|许可|版权|模型|开源|授权/i]);
    r.diagnostics.research_quality = q;
    const honestFail =
      job && job.status === "failed" && leak.provider === false && r.diagnostics.search_misreported !== true;
    r.final_result_usable = q.ok || honestFail;
    r.major_manual_rework = job && job.status === "failed" && !honestFail;
    results.push(r);
    writeJson(path.join(OUT, "t8.json"), r);
  }

  // C1 — 已有项目 + 需要外部最新信息
  if (want("C1")) {
    const r = rec(
      "C1",
      "项目+外部研究",
      "审批流试点这块，外面同类协作工具最近在采购或合规口径上有没有新说法，对我们接下来对外怎么讲有没有影响。",
    );
    await runWorkTask(page, pkgDir, r, { app, timeoutMs: 600000 });
    const text = String(r.diagnostics.artifactExcerpt || "");
    const hist = r.diagnostics.historical || {};
    const projectHit = PROJECT_CUE.some((re) => re.test(text));
    const q = judgeResearchQuality(r, [/采购|合规|协作|审批|试点|监管|标准/i]);
    r.diagnostics.project_tokens_in_result = projectHit;
    r.diagnostics.research_quality = q;
    annotateCoverage(r);
    r.final_result_usable =
      jobSucceeded(r) &&
      (hist.historical_context_used === true || projectHit) &&
      q.dump === false &&
      q.linkListOnly === false &&
      (q.selected >= 1 || (r.diagnostics.search && r.diagnostics.search.search_used)) &&
      text.length >= 400;
    r.major_manual_rework = !r.final_result_usable;
    results.push(r);
    writeJson(path.join(OUT, "c1.json"), r);
  }

  function judgeCombo(r, learned) {
    const text = String(r.diagnostics.artifactExcerpt || "");
    const hist = r.diagnostics.historical || {};
    const projectHit = PROJECT_CUE.some((re) => re.test(text));
    const cookingLeak = /番茄炒蛋|先炒洋葱|家常菜/.test(text);
    const ctx = evidence.judgePreferenceInJobContext(pkgDir, r.diagnostics.authoritative_job, learned);
    const freezeEntries = (r.diagnostics.freeze && r.diagnostics.freeze.entries) || [];
    const riskFreeze = freezeEntries.some((e) => PREF_CUE.test(`${e.title || ""} ${e.kind || ""}`));
    const cookFreeze = freezeEntries.some((e) => COOK_PREF_CUE.test(`${e.title || ""}`) && !PREF_CUE.test(`${e.title || ""}`));
    const coverage = annotateCoverage(r);
    const plan = String(
      (r.diagnostics.authoritative_job &&
        r.diagnostics.authoritative_job.confirmedPlanSnapshot &&
        r.diagnostics.authoritative_job.confirmedPlanSnapshot.content) ||
        "",
    );
    const riskShape = /风险|不确定|缺口|未决|卡点/.test(text.slice(0, 700) + plan.slice(0, 500));
    r.diagnostics.project_tokens_in_result = projectHit;
    r.diagnostics.unrelated_cooking_leak = cookingLeak;
    r.diagnostics.preference = learned;
    r.diagnostics.preference_in_context = !!(ctx.preference_in_context || riskFreeze);
    r.diagnostics.cook_preference_in_freeze = cookFreeze;
    r.diagnostics.risk_first_shape = riskShape;
    r.diagnostics.empty_template = emptyTemplate(text);
    r.final_result_usable =
      jobSucceeded(r) &&
      text.length >= 250 &&
      (hist.historical_context_used === true || projectHit) &&
      coverage.preferenceInCandidates === true &&
      r.diagnostics.preference_in_context === true &&
      cookFreeze === false &&
      cookingLeak === false &&
      !emptyTemplate(text);
    r.major_manual_rework = !r.final_result_usable;
    return r;
  }

  // C2 — 开放目标 + 历史 + 偏好（Final Gate 同题，轻微换词）
  if (want("C2")) {
    const r = rec("C2", "偏好+上下文+开放目标", "帮我收一版能直接拿去对上的进展稿，结构你定。");
    await runWorkTask(page, pkgDir, r, { app, timeoutMs: 240000 });
    judgeCombo(r, evidence.judgePreferenceLearned(pkgDir, PREF_CUE));
    results.push(r);
    writeJson(path.join(OUT, "c2.json"), r);
  }

  // C3 — 完全不同的组合任务，避免只修 C2
  if (want("C3")) {
    const r = rec(
      "C3",
      "新组合任务",
      "客户下周要听试点现在卡在哪，你直接出一版他们能看的说明，结构你定。",
    );
    await runWorkTask(page, pkgDir, r, { app, timeoutMs: 240000 });
    judgeCombo(r, evidence.judgePreferenceLearned(pkgDir, PREF_CUE));
    results.push(r);
    writeJson(path.join(OUT, "c3.json"), r);
  }

  const t3 = {
    id: "T3",
    label: "长期偏好自然复用",
    parts: ["T3A", "T3B"],
    diagnostics: {
      learned: evidence.judgePreferenceLearned(pkgDir, PREF_CUE),
      t3a: results.find((x) => x.id === "T3A"),
      t3b: results.find((x) => x.id === "T3B"),
    },
  };
  const t3b = results.find((x) => x.id === "T3B");
  t3.final_result_usable = !!(
    t3.diagnostics.learned &&
    t3.diagnostics.learned.preference_adopted &&
    t3b &&
    t3b.final_result_usable &&
    t3b.diagnostics.preference_in_context
  );
  t3.major_manual_rework = !t3.final_result_usable;
  writeJson(path.join(OUT, "t3.json"), t3);

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

  const matrixIds = FOCUS.size
    ? [...FOCUS].flatMap((id) => (id === "T3A" || id === "T3B" ? ["T3"] : [id])).filter((id, i, arr) => arr.indexOf(id) === i)
    : ["T2", "T3", "T5", "T6", "T7", "C1", "C2", "C3"];
  const byId = Object.fromEntries(results.map((x) => [x.id, x]));
  byId.T3 = t3;
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
    t3,
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
