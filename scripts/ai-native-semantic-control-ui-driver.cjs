/**
 * DIGITALME-AI-NATIVE-SEMANTIC-CONTROL-01 / REAL-TRIAL-OBSERVABILITY-FIX-01
 * 真实 Electron UI 驱动用户操作；结果判定只读 Job / Subject derived / freeze 落盘产物。
 * 使用当前源码 electron/main.cjs（不是旧 packaged EXE）。
 */
"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const evidence = require("./lib/trial-authoritative-evidence.cjs");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.resolve(
  process.env.DIGITALME_TRIAL_EVIDENCE_DIR || path.join(ROOT, "build", "evidence", "ai-native-semantic-control-01"),
);
const DIALOG_FILE = path.join(OUT, "next-dialog.json");

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

function findPackagedExe() {
  const staging = path.join(ROOT, "release-staging");
  if (!fs.existsSync(staging)) return null;
  const stack = [staging];
  let best = null;
  while (stack.length) {
    const dir = stack.pop();
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        if (name !== "node_modules") stack.push(full);
      } else if (/DigitalMeV2\.exe$/i.test(name) && /win-unpacked/i.test(full)) {
        best = full;
      }
    }
  }
  return best;
}

function setDialogPaths(paths) {
  writeJson(DIALOG_FILE, Array.isArray(paths) ? paths : [paths]);
}

async function dumpUi(page) {
  return page.evaluate(() => {
    const g = (id) => {
      const el = document.getElementById(id);
      if (!el) return { missing: true };
      const cs = window.getComputedStyle(el);
      return {
        text: String(el.value != null && el.tagName !== "BUTTON" ? el.value : el.innerText || el.textContent || "").slice(0, 6000),
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
      chatContext: g("chat-context"),
      plan: g("task-workspace-plan"),
      startDev: g("btn-start-development"),
      goalSend: g("btn-goal-send"),
      panelWork: g("panel-work"),
      panelChat: g("panel-chat"),
      materials: g("material-list-summary"),
      modelGate: g("model-gate"),
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
    await page.screenshot({ path: file, fullPage: true });
  } catch {
    /* ignore */
  }
  return file;
}

async function waitVisible(page, selector, timeout = 60000) {
  await page.waitForSelector(selector, { state: "visible", timeout });
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

async function waitComposeReady(page, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const ui = await dumpUi(page);
    if (ui.panelWork && ui.panelWork.hidden === false && ui.goalSend && ui.goalSend.disabled === false) {
      return true;
    }
    await sleep(400);
  }
  await shot(page, "debug-compose-not-ready");
  writeJson(path.join(OUT, "debug-compose.json"), await dumpUi(page));
  return false;
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
  await shot(page, "debug-compose-not-ready");
  writeJson(path.join(OUT, "debug-compose.json"), await dumpUi(page));
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

async function waitJobSettled(page, timeoutMs, label) {
  const start = Date.now();
  let last = null;
  let confirmTries = 0;
  while (Date.now() - start < timeoutMs) {
    const ui = await dumpUi(page);
    last = ui;
    const artifact = String((ui.artifact && ui.artifact.text) || "").trim();
    const status = String((ui.jobStatus && ui.jobStatus.text) || "");
    const timeline = String((ui.timeline && ui.timeline.text) || "");
    if (artifact.length >= 80 && !/正在思考|正在发送|已确认，正在开始|正在按|正在开发|正在处理/.test(status)) {
      return { ok: true, ui, elapsedMs: Date.now() - start };
    }
    if (/模型连接不可用|请先连接模型/.test(status + timeline) && confirmTries < 3) {
      confirmTries += 1;
      await sleep(3000);
      await page.evaluate(() => {
        const startBtn = document.getElementById("btn-start-development");
        if (startBtn && !startBtn.hidden) startBtn.click();
        const nl = document.getElementById("work-nl-input");
        const send = document.getElementById("btn-work-nl-send");
        if (nl && send && !send.disabled) {
          nl.value = "开始";
          send.click();
        }
      });
    }
    if (confirmTries < 2 && ui.startDev && !ui.startDev.hidden && !ui.startDev.disabled && artifact.length < 40) {
      confirmTries += 1;
      await page.evaluate(() => document.getElementById("btn-start-development")?.click());
    }
    if (/失败|无法可靠/.test(status) && artifact.length < 40) {
      await sleep(2500);
      const ui2 = await dumpUi(page);
      const a2 = String((ui2.artifact && ui2.artifact.text) || "").trim();
      if (a2.length >= 80) return { ok: true, ui: ui2, elapsedMs: Date.now() - start };
      if (/失败|无法可靠/.test(String((ui2.jobStatus && ui2.jobStatus.text) || ""))) {
        return { ok: false, failed: true, ui: ui2, elapsedMs: Date.now() - start };
      }
    }
    await sleep(2000);
  }
  return { ok: false, timeout: true, ui: last, elapsedMs: Date.now() - start, label };
}

async function maybeConfirmPlan(page, record) {
  await sleep(1500);
  const ui = await dumpUi(page);
  const start = page.locator("#btn-start-development");
  if (await visible(start)) {
    const hidden = ui.startDev && ui.startDev.hidden;
    const disabled = ui.startDev && ui.startDev.disabled;
    if (!hidden && !disabled) {
      record.user_confirmation_count += 1;
      record.diagnostics.confirm_clicked = true;
      await start.click();
      await sleep(800);
      return true;
    }
  }
  return false;
}

function scanJobs(pkgDir) {
  return evidence.loadJobs(pkgDir);
}

function latestTaskIdFromList(listed) {
  const tasks = (listed && listed.tasks) || [];
  return tasks[0] && tasks[0].taskId ? tasks[0].taskId : null;
}

async function attachAuthoritativeEvidence(page, record, pkgDir) {
  const listed = await invokeRead(page, "work.listTasks", { limit: 20 });
  record.diagnostics.tasks = listed;
  const taskId = latestTaskIdFromList(listed);
  record.diagnostics.taskId = taskId;
  const job = taskId ? await evidence.waitForTaskJob(pkgDir, taskId, 20000) : evidence.latestJobForTask(pkgDir, taskId);
  record.diagnostics.authoritative_job = job
    ? {
        id: job.id,
        taskId: job.taskId,
        status: job.status,
        capabilityId: job.capabilityId,
        snapshotId: job.snapshotId,
        artifactId: job.artifactId,
        materialUse: job.materialUse,
        confirmedPlanSnapshot: job.confirmedPlanSnapshot,
        createdAt: job.createdAt,
        finishedAt: job.finishedAt,
      }
    : null;
  if (job) {
    record.diagnostics.search = evidence.judgeSearchFromJob(job);
    record.diagnostics.historical = evidence.judgeHistoricalContext(pkgDir, job);
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
  }
  try {
    if (taskId) {
      const detail = await invokeRead(page, "work.getTask", { taskId });
      record.diagnostics.taskDetail = {
        label: detail && detail.userFacingLabel,
        state: detail && detail.state,
        jobStatus: detail && detail.latestJob && detail.latestJob.status,
        artifactIds: detail && detail.artifactIds,
        appliedUnderstanding: detail && detail.appliedUnderstanding,
      };
      const artId = (job && job.artifactId) || (detail && detail.latestJob && detail.latestJob.artifactId);
      if (artId) {
        const content = await invokeRead(page, "artifact.getContent", { artifactId: artId });
        const text = String((content && content.text) || "");
        record.diagnostics.artifactExcerpt = text.slice(0, 1200);
        record.diagnostics.artifactLength = text.length;
        record.final_result = { status: job && job.status, artifactId: artId, textLength: text.length };
      }
    }
  } catch (err) {
    record.diagnostics.readError = String(err.message || err).slice(0, 200);
  }
  return job;
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
    diagnostics: {},
  };
}

async function attachReadOnlyEvidence(page, record, pkgDir) {
  return attachAuthoritativeEvidence(page, record, pkgDir);
}

async function main() {
  const electronPath = require("electron");
  if (typeof electronPath !== "string" || !fs.existsSync(electronPath)) {
    console.error(JSON.stringify({ ok: false, error: "local_electron_missing" }));
    process.exit(1);
  }

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "dmv2-semctl-ud-"));
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "dmv2-semctl-work-"));
  const credFile = path.join(OUT, "credential-import.json");
  let apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey && fs.existsSync(credFile)) {
    try {
      const existing = JSON.parse(fs.readFileSync(credFile, "utf8"));
      apiKey = String((existing && existing.apiKey) || "").trim();
    } catch {
      /* ignore */
    }
  }
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

  const relatedNotes = path.join(workDir, "northstar-notes.md");
  fs.writeFileSync(
    relatedNotes,
    [
      "# NORTHSTAR_OKR_ALPHA 项目纪要",
      "",
      "下一阶段只做权限收敛：默认最小披露、授权范围可审计、禁止把外部报道写成本人事实。",
      "已完成：主体真值边界与文件写入确认。",
      "未完成：跨任务上下文由模型选择相关性。",
    ].join("\n"),
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
  await newWorkTask(page);
  const results = [];
  const candidate = {
    gitHead: gitHead(),
    electronPath,
    userData,
    actualUserData,
    workDir,
    model: "gemini-3.6-flash",
    packed: false,
  };

  function searchUsed(record) {
    const judged = record.diagnostics.search;
    if (judged && typeof judged.search_used === "boolean") return judged.search_used;
    return false;
  }

  const only = String(process.env.SEMCTL_ONLY || "ALL").toUpperCase();
  const run = (id) => only === "ALL" || only === id || (id === "T2B" && (only === "T2" || only === "ALL"));

  async function runT4() {
    const r = rec("T4", "Continuity", "我看这种周报时，最有效的是先看到结论，依据放后面。");
    const t0 = Date.now();
    await goChat(page);
    await waitVisible(page, "#chat-input", 20000);
    await page.locator("#chat-input").fill(r.initial_user_input);
    await page.locator("#btn-chat-send").click();
    const chatDeadline = Date.now() + 180000;
    while (Date.now() < chatDeadline) {
      const ui = await dumpUi(page);
      const status = String((ui.chatStatus && ui.chatStatus.text) || "");
      const turns = String((ui.chatTurns && ui.chatTurns.text) || "");
      if (turns.length > 20 && !/正在发送|正在回复/.test(status)) break;
      await sleep(2000);
    }
    await shot(page, "t4-chat");
    let learned = await evidence.waitForAdoptedPreference(pkgDir, /结论|依据放后面/, 90000);
    r.diagnostics.preference = {
      preference_adopted: !!(learned && learned.preference_adopted),
      knowledge_gap_rewrite: !!(learned && learned.knowledge_gap_rewrite),
      matchingDerived: (learned && learned.matchingDerived) || [],
      matchingConfirmed: ((learned && learned.matchingConfirmed) || []).map((e) => ({
        id: e.id,
        type: e.type,
        confidence: e.confidence,
        title: e.payload && e.payload.title,
      })),
    };
    r.diagnostics.preference_captured = r.diagnostics.preference.preference_adopted;
    r.diagnostics.not_knowledge_gap = !r.diagnostics.preference.knowledge_gap_rewrite;

    await newWorkTask(page);
    const second = "和上次一样写一份周报。";
    r.diagnostics.second_input = second;
    await fillAndSendGoal(page, second);
    await maybeConfirmPlan(page, r);
    const settled = await waitJobSettled(page, 240000, "T4");
    r.time_to_result_ms = Date.now() - t0;
    r.diagnostics.settled = { ok: settled.ok, failed: !!settled.failed, timeout: !!settled.timeout };
    await shot(page, "t4-result");
    await attachReadOnlyEvidence(page, r, pkgDir);
    learned = evidence.judgePreferenceLearned(pkgDir, /结论|依据放后面/);
    r.diagnostics.preference = {
      preference_adopted: !!(learned && learned.preference_adopted),
      knowledge_gap_rewrite: !!(learned && learned.knowledge_gap_rewrite),
      matchingDerived: (learned && learned.matchingDerived) || [],
      matchingConfirmed: ((learned && learned.matchingConfirmed) || []).map((e) => ({
        id: e.id,
        type: e.type,
        confidence: e.confidence,
        title: e.payload && e.payload.title,
      })),
    };
    r.diagnostics.preference_captured = r.diagnostics.preference.preference_adopted;
    const ctx = evidence.judgePreferenceInJobContext(pkgDir, r.diagnostics.authoritative_job, learned);
    r.diagnostics.preference_in_context = ctx.preference_in_context;
    r.diagnostics.freeze_selected = ctx.selectedEventIds;
    r.diagnostics.freeze_entries = ctx.freezeEntries;
    r.final_result_usable =
      !!(r.diagnostics.authoritative_job && r.diagnostics.authoritative_job.status === "succeeded") &&
      r.diagnostics.preference_captured === true &&
      r.diagnostics.preference_in_context === true;
    r.major_manual_rework = !r.final_result_usable;
    results.push(r);
    writeJson(path.join(OUT, "t4.json"), r);
  }

  // T4 first: distill before long research jobs (rate-limit / capture:noop).
  if (run("T4")) {
    await runT4();
  }

  // Seed related project context for T5
  if (run("T5")) {
    const r = rec("T5-SEED", "相关项目成果", "根据这份 NORTHSTAR 纪要，写一份给团队看的阶段说明，必须保留 NORTHSTAR_OKR_ALPHA 和权限收敛。");
    const t0 = Date.now();
    await newWorkTask(page);
    await addMaterials(app, page, [relatedNotes], "file");
    await fillAndSendGoal(page, r.initial_user_input);
    await maybeConfirmPlan(page, r);
    const settled = await waitJobSettled(page, 240000, "T5-SEED");
    r.time_to_result_ms = Date.now() - t0;
    r.diagnostics.settled = { ok: settled.ok };
    await attachReadOnlyEvidence(page, r, pkgDir);
    const seedJob = r.diagnostics.authoritative_job;
    r.final_result_usable =
      !!(seedJob && seedJob.status === "succeeded") &&
      (/NORTHSTAR_OKR_ALPHA/.test(String(r.diagnostics.artifactExcerpt || "")) ||
        /NORTHSTAR/.test(JSON.stringify(seedJob.materialUse || {})));
    if (!r.final_result_usable) {
      await sleep(4000);
      await newWorkTask(page);
      await addMaterials(app, page, [relatedNotes], "file");
      await fillAndSendGoal(page, r.initial_user_input);
      await maybeConfirmPlan(page, r);
      const settled2 = await waitJobSettled(page, 240000, "T5-SEED-retry");
      r.diagnostics.seed_retry = { ok: settled2.ok };
      await attachReadOnlyEvidence(page, r, pkgDir);
      const seedJob2 = r.diagnostics.authoritative_job;
      r.final_result_usable =
        !!(seedJob2 && seedJob2.status === "succeeded") &&
        (/NORTHSTAR_OKR_ALPHA/.test(String(r.diagnostics.artifactExcerpt || "")) ||
          /NORTHSTAR/.test(JSON.stringify(seedJob2.materialUse || {})));
    }
    results.push(r);
    writeJson(path.join(OUT, "t5-seed.json"), r);
  }

  // T2 original
  if (run("T2")) {
    const r = rec(
      "T2",
      "当前现实研究",
      "调研 2026 年企业采用 AI Agent 辅助软件开发的实际收益与风险，给出带来源依据的摘要，不要编造链接。",
    );
    const t0 = Date.now();
    await newWorkTask(page);
    await fillAndSendGoal(page, r.initial_user_input);
    await maybeConfirmPlan(page, r);
    const settled = await waitJobSettled(page, 360000, "T2");
    r.time_to_result_ms = Date.now() - t0;
    r.diagnostics.settled = { ok: settled.ok, failed: !!settled.failed, timeout: !!settled.timeout };
    await shot(page, "t2-result");
    await attachReadOnlyEvidence(page, r, pkgDir);
    r.diagnostics.search_used = searchUsed(r);
    r.diagnostics.actual_capability = r.diagnostics.search && r.diagnostics.search.capabilityId;
    r.final_result_usable =
      !!(r.diagnostics.authoritative_job && r.diagnostics.authoritative_job.status === "succeeded") &&
      r.diagnostics.search_used === true;
    r.major_manual_rework = !r.final_result_usable;
    results.push(r);
    writeJson(path.join(OUT, "t2.json"), r);
  }

  // T2 variant (no 搜索/调研/研究)
  if (run("T2B")) {
    const r = rec(
      "T2B",
      "现实信息不同措辞",
      "请对照 2026 年企业把 AI Agent 用于软件工程的真实收益与风险，整理一份带来源依据的摘要，不要编造链接。",
    );
    const t0 = Date.now();
    await newWorkTask(page);
    await fillAndSendGoal(page, r.initial_user_input);
    await maybeConfirmPlan(page, r);
    const settled = await waitJobSettled(page, 360000, "T2B");
    r.time_to_result_ms = Date.now() - t0;
    r.diagnostics.settled = { ok: settled.ok, failed: !!settled.failed, timeout: !!settled.timeout };
    await shot(page, "t2b-result");
    await attachReadOnlyEvidence(page, r, pkgDir);
    r.diagnostics.search_used = searchUsed(r);
    r.diagnostics.actual_capability = r.diagnostics.search && r.diagnostics.search.capabilityId;
    r.final_result_usable =
      !!(r.diagnostics.authoritative_job && r.diagnostics.authoritative_job.status === "succeeded") &&
      r.diagnostics.search_used === true;
    r.major_manual_rework = !r.final_result_usable;
    results.push(r);
    writeJson(path.join(OUT, "t2b.json"), r);
  }

  // T5 open goal — should use NORTHSTAR seed
  if (run("T5")) {
    const r = rec("T5", "Open Goal", "帮我把这个项目下一阶段推进方案整理出来。");
    const t0 = Date.now();
    await newWorkTask(page);
    await fillAndSendGoal(page, r.initial_user_input);
    await maybeConfirmPlan(page, r);
    const settled = await waitJobSettled(page, 240000, "T5");
    r.time_to_result_ms = Date.now() - t0;
    r.diagnostics.settled = { ok: settled.ok, failed: !!settled.failed, timeout: !!settled.timeout };
    await shot(page, "t5-result");
    await attachReadOnlyEvidence(page, r, pkgDir);
    r.diagnostics.used_northstar = !!(r.diagnostics.historical && r.diagnostics.historical.historical_context_used);
    r.final_result_usable =
      !!(r.diagnostics.authoritative_job && r.diagnostics.authoritative_job.status === "succeeded") &&
      r.diagnostics.used_northstar === true;
    r.major_manual_rework = !r.final_result_usable;
    results.push(r);
    writeJson(path.join(OUT, "t5.json"), r);
  }

  const events = await page.evaluate(() => (window.__trialEvents || []).slice(-80));
  writeJson(path.join(OUT, "events.json"), events);
  const overviewFinal = await invokeRead(page, "subject.getOverview", {});
  writeJson(path.join(OUT, "overview-final.json"), overviewFinal);
  await shot(page, "99-end");
  const summary = {
    ok: results.filter((x) => /^(T2|T2B|T4|T5)$/.test(x.id)).every((x) => x.final_result_usable),
    candidate: { ...candidate, pkgDir },
    capabilities: caps,
    results,
  };
  writeJson(path.join(OUT, "summary.json"), summary);
  console.log(
    JSON.stringify(
      {
        ok: summary.ok,
        out: OUT,
        tasks: results.map((x) => ({
          id: x.id,
          usable: x.final_result_usable,
          ms: x.time_to_result_ms,
          search: x.diagnostics && x.diagnostics.search_used,
          capabilityId: x.diagnostics && x.diagnostics.actual_capability,
          northstar: x.diagnostics && x.diagnostics.used_northstar,
          preferenceAdopted: x.diagnostics && x.diagnostics.preference_captured,
          preferenceInContext: x.diagnostics && x.diagnostics.preference_in_context,
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
  console.error(err);
  writeJson(path.join(OUT, "driver-error.json"), { error: String(err && err.stack ? err.stack : err) });
  process.exit(1);
});
