"use strict";

/**
 * DVL2-02 Electron acceptance harness — phase A (prepare) / phase B (restart restore + idempotent prepare).
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(webContents, predicate, label, timeoutMs = 25000) {
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
  const outputDir = process.env.DIGITALME_DVL2_02_OUTPUT;
  const markerPath = process.env.DIGITALME_DVL2_02_MARKER;
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
  await sleep(400);

  const list = await win.webContents.executeJavaScript(`window.digitalMe.actBehalfList()`);
  assert.ok(list.tasks && list.tasks.length >= 1);
  const taskId = list.tasks[0].taskId;

  const confirmed = await win.webContents.executeJavaScript(`(async () => {
    const taskId = ${JSON.stringify(taskId)};
    const cur = await window.digitalMe.actBehalfPlanGet({ taskId });
    return window.digitalMe.actBehalfPlanConfirm({
      taskId,
      ...(cur.revision || {}),
    });
  })()`);
  assert.equal(confirmed.ok, true);

  // Harness confirmed via IPC — refresh package prep UI from authoritative state.
  await win.webContents.executeJavaScript(`(async () => {
    const taskId = ${JSON.stringify(taskId)};
    const view = await window.digitalMe.actBehalfPlanGet({ taskId });
    if (window.DeliverablePlannerUi) window.DeliverablePlannerUi.renderPlanView(view);
    if (typeof window.__digitalMeRefreshPackagePrep === 'function') {
      await window.__digitalMeRefreshPackagePrep(view);
    }
  })()`);

  await waitFor(
    win.webContents,
    `() => { const btn=document.querySelector('#btn-act-prepare-package'); return !!(btn && !btn.classList.contains('hidden') && !btn.disabled); }`,
    "准备成果包按钮可用"
  );

  const prepared = await win.webContents.executeJavaScript(
    `window.digitalMe.actBehalfPrepareDeliverablePackage({ taskId: ${JSON.stringify(taskId)} })`
  );
  assert.equal(prepared.ok, true);
  assert.equal(prepared.outcome, "created_new");
  assert.ok(prepared.package && prepared.package.id);
  assert.equal(prepared.package.lifecycleStatus, "planned");
  assert.equal(prepared.package.completionStatus, "none");
  assert.ok(Array.isArray(prepared.deliverables));
  assert.ok(prepared.deliverables.length >= 1);
  for (const d of prepared.deliverables) {
    assert.equal(d.currentVersionId, null);
    assert.deepEqual(d.versionIds, []);
    assert.equal(d.planDisposition, "included");
    assert.equal(d.generationStatus, "planned");
    assert.equal(d.reviewStatus, "unreviewed");
  }

  const uiText = await win.webContents.executeJavaScript(`(() => {
    const body = document.body ? document.body.innerText : '';
    return {
      hasStartGenerate: body.includes('开始生成成果'),
      prepStatus: (document.querySelector('#act-package-prep-status') || {}).textContent || '',
      viewVisible: !!(document.querySelector('#btn-act-view-package-prep') && !document.querySelector('#btn-act-view-package-prep').classList.contains('hidden')),
    };
  })()`);
  assert.equal(uiText.hasStartGenerate, false, "UI must not show 开始生成成果");

  await win.webContents.executeJavaScript(
    `window.digitalMe.actBehalfGetDeliverablePackage({ taskId: ${JSON.stringify(taskId)} })`
  );
  await sleep(200);

  const marker = {
    phase: "A",
    taskId,
    packageId: prepared.package.id,
    sourcePlanId: prepared.package.sourcePlanId,
    sourcePlanVersionId: prepared.package.sourcePlanVersionId,
    deliverableCount: prepared.deliverables.length,
    userData,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2));
  fs.writeFileSync(
    path.join(outputDir, "phase-a.json"),
    JSON.stringify({ ...marker, pass: true, readiness: prepared.readiness || null }, null, 2)
  );

  const banned = listFilesRecursive(userData).filter((f) =>
    /\.(docx|pptx|html|png|jpg|jpeg|mp4|mp3)$/i.test(f)
  );
  assert.equal(banned.length, 0, "phase A must not create deliverable files");

  console.log("PASS dvl2-02 phase A", JSON.stringify({ taskId, packageId: marker.packageId }));
  return 0;
}

async function runPhaseB({ BrowserWindow }) {
  const win = BrowserWindow.getAllWindows()[0];
  const outputDir = process.env.DIGITALME_DVL2_02_OUTPUT;
  const markerPath = process.env.DIGITALME_DVL2_02_MARKER;
  const userData = app.getPath("userData");
  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));

  while (win.webContents.isLoading()) await sleep(50);
  await waitFor(
    win.webContents,
    `() => document.readyState === 'complete' && !!document.querySelector('.nav-item[data-view="do"]')`,
    "DOM 就绪"
  );
  await sleep(400);

  const got = await win.webContents.executeJavaScript(
    `window.digitalMe.actBehalfGetDeliverablePackage({ taskId: ${JSON.stringify(marker.taskId)} })`
  );
  assert.equal(got.ok, true);
  assert.ok(got.package);
  assert.equal(got.package.id, marker.packageId);
  assert.equal(got.deliverableExecution.activePackageId, marker.packageId);
  assert.ok(got.readiness && got.readiness.evaluatedAt);
  assert.match(got.readiness.userSummary || "", /成果包已准备/);

  const again = await win.webContents.executeJavaScript(
    `window.digitalMe.actBehalfPrepareDeliverablePackage({ taskId: ${JSON.stringify(marker.taskId)} })`
  );
  assert.equal(again.ok, true);
  assert.equal(again.outcome, "existing_package");
  assert.equal(again.package.id, marker.packageId);

  const listed = await win.webContents.executeJavaScript(
    `window.digitalMe.actBehalfListDeliverablePackagesForTask({ taskId: ${JSON.stringify(marker.taskId)} })`
  );
  const active = (listed.packages || []).filter(
    (p) =>
      p &&
      !p.softDeletedAt &&
      !p.archivedAt &&
      p.sourcePlanVersionId === marker.sourcePlanVersionId
  );
  assert.equal(active.length, 1);

  const banned = listFilesRecursive(userData).filter((f) =>
    /\.(docx|pptx|html|png|jpg|jpeg|mp4|mp3)$/i.test(f)
  );
  assert.equal(banned.length, 0, "phase B must not create deliverable files");

  const phaseB = {
    phase: "B",
    pass: true,
    taskId: marker.taskId,
    packageId: marker.packageId,
    activePackageId: got.deliverableExecution.activePackageId,
    outcome: again.outcome,
    activeCount: active.length,
    readiness: got.readiness,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(outputDir, "phase-b.json"), JSON.stringify(phaseB, null, 2));
  console.log("PASS dvl2-02 phase B", JSON.stringify({ packageId: marker.packageId, outcome: again.outcome }));
  return 0;
}

async function runDvl202PackageAcceptanceHarness(ctx) {
  const phase = String(process.env.DIGITALME_DVL2_02_ACCEPT_PHASE || "").toUpperCase();
  if (phase === "A") return runPhaseA(ctx);
  if (phase === "B") return runPhaseB(ctx);
  throw new Error("DIGITALME_DVL2_02_ACCEPT_PHASE must be A or B");
}

module.exports = {
  runDvl202PackageAcceptanceHarness,
};
