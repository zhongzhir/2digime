"use strict";

/**
 * DVL2-01 Electron acceptance harness — phase A (create) / phase B (restart restore).
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(webContents, predicate, label, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await webContents.executeJavaScript(`(async()=>Boolean(await (${predicate})()))()`);
    if (ok) return;
    await sleep(80);
  }
  throw new Error(`等待超时：${label}`);
}

function listFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) out.push(...listFilesRecursive(p));
    else out.push(p);
  }
  return out;
}

async function openDoingForm(win) {
  await waitFor(
    win.webContents,
    `() => Boolean(document.querySelector('.nav-item[data-view="do"]') && document.querySelector('#btn-do-new-task'))`,
    "做事入口就绪"
  );
  await win.webContents.executeJavaScript(`document.querySelector('.nav-item[data-view="do"]').click()`);
  await waitFor(
    win.webContents,
    `() => { const view=document.querySelector('#view-do'); const hub=document.querySelector('#do-hub'); return !!(view && hub && !view.classList.contains('hidden') && !hub.classList.contains('hidden')); }`,
    "做事首页"
  );
  await win.webContents.executeJavaScript(`document.querySelector('#btn-do-new-task').click()`);
  await waitFor(
    win.webContents,
    `() => { const el=document.querySelector('#do-act-behalf'); return !!(el && !el.classList.contains('hidden')); }`,
    "做事表单"
  );
}

async function runPhaseA({ BrowserWindow }) {
  const win = BrowserWindow.getAllWindows()[0];
  const outputDir = process.env.DIGITALME_DVL2_01_OUTPUT;
  const markerPath = process.env.DIGITALME_DVL2_01_MARKER;
  const userData = app.getPath("userData");
  fs.mkdirSync(outputDir, { recursive: true });

  while (win.webContents.isLoading()) await sleep(50);
  await waitFor(
    win.webContents,
    `() => document.readyState === 'complete' && !!document.querySelector('.nav-item[data-view="do"]')`,
    "DOM 就绪"
  );
  await sleep(400);

  await openDoingForm(win);
  const goal = "请为投资人准备一份项目介绍材料，并规划宣传视频。";
  await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('#act-request');
    input.value = ${JSON.stringify(goal)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await win.webContents.executeJavaScript(`document.querySelector('#btn-act-form-plan').click()`);
  await waitFor(
    win.webContents,
    `() => { const panel=document.querySelector('#act-deliverable-plan-panel'); return !!(panel && !panel.classList.contains('hidden') && document.querySelectorAll('#act-plan-items [data-plan-item-id]').length > 0); }`,
    "预计交付已显示"
  );

  await win.webContents.executeJavaScript(`document.querySelector('#btn-act-plan-save-draft').click()`);
  await sleep(500);

  const list = await win.webContents.executeJavaScript(`window.digitalMe.actBehalfList()`);
  assert.ok(list.tasks && list.tasks.length >= 1);
  const taskId = list.tasks[0].taskId;
  const view = await win.webContents.executeJavaScript(
    `window.digitalMe.actBehalfPlanGet(${JSON.stringify({ taskId })})`
  );
  assert.equal(view.ok, true);
  assert.ok(view.plan && view.plan.planId);
  assert.ok(view.version && view.version.versionId);

  const confirmed = await win.webContents.executeJavaScript(`(async () => {
    const taskId = ${JSON.stringify(taskId)};
    const cur = await window.digitalMe.actBehalfPlanGet({ taskId });
    return window.digitalMe.actBehalfPlanConfirm({
      taskId,
      ...(cur.revision || {}),
    });
  })()`);
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.readiness.status, "not_executable");
  assert.match(confirmed.statusBanner || "", /尚未开始执行/);

  const marker = {
    phase: "A",
    taskId,
    planId: confirmed.plan.planId,
    versionId: confirmed.plan.activeConfirmedVersionId,
    revision: confirmed.revision,
    userData,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2));
  fs.writeFileSync(
    path.join(outputDir, "phase-a.json"),
    JSON.stringify({ ...marker, pass: true }, null, 2)
  );
  fs.writeFileSync(
    path.join(outputDir, "01-phase-a.png"),
    (await win.webContents.capturePage()).toPNG()
  );

  const banned = listFilesRecursive(userData).filter((f) =>
    /\.(docx|pptx|html|png|jpg|jpeg|mp4|mp3)$/i.test(f)
  );
  assert.equal(banned.length, 0, "phase A must not create deliverable files");

  console.log("PASS dvl2-01 phase A", JSON.stringify({ taskId, planId: marker.planId }));
  return 0;
}

async function runPhaseB({ BrowserWindow }) {
  const win = BrowserWindow.getAllWindows()[0];
  const outputDir = process.env.DIGITALME_DVL2_01_OUTPUT;
  const markerPath = process.env.DIGITALME_DVL2_01_MARKER;
  const userData = app.getPath("userData");
  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));

  while (win.webContents.isLoading()) await sleep(50);
  await waitFor(
    win.webContents,
    `() => document.readyState === 'complete' && !!document.querySelector('.nav-item[data-view="do"]')`,
    "DOM 就绪"
  );
  await sleep(400);

  await openDoingForm(win);

  const restored = await win.webContents.executeJavaScript(`(async () => {
    const taskId = ${JSON.stringify(marker.taskId)};
    const got = await window.digitalMe.actBehalfGet(taskId);
    const plan = await window.digitalMe.actBehalfPlanGet({ taskId });
    if (window.DeliverablePlannerUi) window.DeliverablePlannerUi.renderPlanView(plan);
    const task = got.task || {};
    document.querySelector('#act-request').value = (task.taskIntent && task.taskIntent.goal) || task.goal || '';
    return { got, plan };
  })()`);

  assert.equal(restored.got.ok, true);
  assert.equal(restored.plan.ok, true);
  assert.equal(restored.plan.plan.planId, marker.planId);
  assert.equal(restored.plan.plan.activeConfirmedVersionId, marker.versionId);
  assert.equal(restored.plan.readiness.status, "not_executable");
  assert.match(restored.plan.statusBanner || "", /尚未开始执行/);

  // Audit: planning invocation ref should exist if generate wrote one
  const taskFull = restored.got.task;
  const inv = (((taskFull.audit || {}).planningInvocations) || []).slice(-1)[0];
  if (inv) {
    assert.ok(String(inv.id || "").startsWith("plaudit_"));
    assert.equal(inv.purpose, "deliverable_planning");
  }

  await waitFor(
    win.webContents,
    `() => { const panel=document.querySelector('#act-deliverable-plan-panel'); return !!(panel && !panel.classList.contains('hidden')); }`,
    "重启后计划面板可见"
  );

  const banned = listFilesRecursive(userData).filter((f) =>
    /\.(docx|pptx|html|png|jpg|jpeg|mp4|mp3)$/i.test(f)
  );
  assert.equal(banned.length, 0, "phase B must not create deliverable files");

  fs.writeFileSync(
    path.join(outputDir, "phase-b.json"),
    JSON.stringify(
      {
        pass: true,
        restoredPlanId: restored.plan.plan.planId,
        restoredVersionId: restored.plan.plan.activeConfirmedVersionId,
        readiness: restored.plan.readiness.status,
        banned,
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(outputDir, "02-phase-b.png"),
    (await win.webContents.capturePage()).toPNG()
  );
  fs.writeFileSync(
    path.join(outputDir, "acceptance.json"),
    JSON.stringify(
      [
        { step: "phase-a-create-confirm", pass: true, marker },
        {
          step: "phase-b-process-restart-restore",
          pass: true,
          planId: restored.plan.plan.planId,
          versionId: restored.plan.plan.activeConfirmedVersionId,
          readiness: restored.plan.readiness.status,
        },
        { step: "no-artifact-files", pass: true, banned },
      ],
      null,
      2
    )
  );

  console.log("PASS dvl2-01 phase B", JSON.stringify({ planId: marker.planId }));
  return 0;
}

async function runDvl201PlannerAcceptanceHarness(ctx) {
  const phase = String(process.env.DIGITALME_DVL2_01_ACCEPT_PHASE || "A").toUpperCase();
  if (phase === "B") return runPhaseB(ctx);
  return runPhaseA(ctx);
}

module.exports = { runDvl201PlannerAcceptanceHarness };
