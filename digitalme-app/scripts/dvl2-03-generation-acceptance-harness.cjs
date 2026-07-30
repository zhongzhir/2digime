"use strict";

/**
 * DVL2-03 Electron harness — Phase A generate / Phase B restore + review + regenerate.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(webContents, predicate, label, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ok = await webContents.executeJavaScript(`(async()=>Boolean(await (${predicate})()))()`);
    if (ok) return;
    await sleep(80);
  }
  throw new Error(`等待超时：${label}`);
}

async function openDoingForm(win) {
  await waitFor(
    win.webContents,
    `() => Boolean(document.querySelector('.nav-item[data-view="do"]') && document.querySelector('#btn-do-new-task'))`,
    "做事入口"
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
  const outputDir = process.env.DIGITALME_DVL2_03_OUTPUT;
  const markerPath = process.env.DIGITALME_DVL2_03_MARKER;
  const userData = app.getPath("userData");
  fs.mkdirSync(outputDir, { recursive: true });

  while (win.webContents.isLoading()) await sleep(50);
  await waitFor(
    win.webContents,
    `() => document.readyState === 'complete' && !!document.querySelector('.nav-item[data-view="do"]')`,
    "DOM"
  );
  await sleep(400);
  await openDoingForm(win);

  const goal = "请为项目准备介绍文档、演示文稿、介绍网页和封面图片。";
  await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('#act-request');
    input.value = ${JSON.stringify(goal)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await win.webContents.executeJavaScript(`document.querySelector('#btn-act-form-plan').click()`);
  await waitFor(
    win.webContents,
    `() => { const panel=document.querySelector('#act-deliverable-plan-panel'); return !!(panel && !panel.classList.contains('hidden') && document.querySelectorAll('#act-plan-items [data-plan-item-id]').length > 0); }`,
    "计划显示"
  );
  await win.webContents.executeJavaScript(`document.querySelector('#btn-act-plan-save-draft').click()`);
  await sleep(400);

  const list = await win.webContents.executeJavaScript(`window.digitalMe.actBehalfList()`);
  const taskId = list.tasks[0].taskId;
  const confirmed = await win.webContents.executeJavaScript(`(async () => {
    const taskId = ${JSON.stringify(taskId)};
    const cur = await window.digitalMe.actBehalfPlanGet({ taskId });
    return window.digitalMe.actBehalfPlanConfirm({ taskId, ...(cur.revision || {}) });
  })()`);
  assert.equal(confirmed.ok, true);

  const prepared = await win.webContents.executeJavaScript(
    `window.digitalMe.actBehalfPrepareDeliverablePackage({ taskId: ${JSON.stringify(taskId)} })`
  );
  assert.equal(prepared.ok, true);
  const packageId = prepared.package.id;

  const generated = await win.webContents.executeJavaScript(
    `window.digitalMe.actBehalfGenerateDeliverablePackage({ packageId: ${JSON.stringify(packageId)} })`
  );
  assert.equal(generated.ok, true);
  assert.ok(generated.results && generated.results.length >= 1);

  const view = await win.webContents.executeJavaScript(
    `window.digitalMe.actBehalfGetDeliverablePackageById({ packageId: ${JSON.stringify(packageId)} })`
  );
  assert.equal(view.ok, true);
  const ready = view.deliverables.filter((d) => d.currentVersionId);
  assert.ok(ready.length >= 1);
  for (const d of ready) {
    const ver = view.versions[d.currentVersionId];
    assert.ok(ver && ver.artifactRef && ver.artifactRef.relativePath);
    assert.ok(ver.artifactRef.contentHash.startsWith("sha256:"));
    const abs = require("node:path").join(userData, ver.artifactRef.relativePath);
    assert.equal(fs.existsSync(abs), true, "missing file " + abs);
  }

  const marker = {
    phase: "A",
    taskId,
    packageId,
    readyCount: ready.length,
    deliverableIds: ready.map((d) => d.id),
    versionIds: ready.map((d) => d.currentVersionId),
    userData,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(markerPath, JSON.stringify(marker, null, 2));
  fs.writeFileSync(path.join(outputDir, "phase-a.json"), JSON.stringify({ ...marker, pass: true, results: generated.results }, null, 2));
  console.log("PASS dvl2-03 phase A", JSON.stringify({ packageId, ready: ready.length }));
  return 0;
}

async function runPhaseB({ BrowserWindow }) {
  const win = BrowserWindow.getAllWindows()[0];
  const outputDir = process.env.DIGITALME_DVL2_03_OUTPUT;
  const marker = JSON.parse(fs.readFileSync(process.env.DIGITALME_DVL2_03_MARKER, "utf8"));

  while (win.webContents.isLoading()) await sleep(50);
  await waitFor(
    win.webContents,
    `() => document.readyState === 'complete' && !!document.querySelector('.nav-item[data-view="do"]')`,
    "DOM"
  );
  await sleep(300);

  const view = await win.webContents.executeJavaScript(
    `window.digitalMe.actBehalfGetDeliverablePackageById({ packageId: ${JSON.stringify(marker.packageId)} })`
  );
  assert.equal(view.ok, true);
  const first = view.deliverables.find((d) => d.currentVersionId);
  assert.ok(first);
  const v1 = first.currentVersionId;

  const opened = await (async () => {
    // MVP-RELEASE-GATE-01B: renderer open IPC removed; verify via secure core.
    const deliverableArtifactOpen = require("../src/act-behalf/deliverable-artifact-open");
    const { shell } = require("electron");
    const art =
      (first.currentVersion && first.currentVersion.artifactRef) ||
      (view.versions &&
        view.versions[v1] &&
        (view.versions[v1].artifactRef ||
          (view.versions[v1].artifactRefs && view.versions[v1].artifactRefs[0])));
    assert.ok(art && art.id, "expected artifact ref on current version");
    return deliverableArtifactOpen.openArtifactSecure({
      userData,
      payload: { artifactRefId: art.id },
      shell,
    });
  })();
  assert.equal(opened.ok, true);

  const reviewed = await win.webContents.executeJavaScript(
    `window.digitalMe.actBehalfReviewDeliverableVersion({ versionId: ${JSON.stringify(v1)}, decision: "accepted" })`
  );
  assert.equal(reviewed.ok, true);

  const regen = await win.webContents.executeJavaScript(
    `window.digitalMe.actBehalfGenerateDeliverable({ packageId: ${JSON.stringify(marker.packageId)}, deliverableId: ${JSON.stringify(first.id)} })`
  );
  assert.equal(regen.ok, true);
  assert.notEqual(regen.version.id, v1);
  assert.equal(regen.version.reviewStatus, "unreviewed");

  const listed = await win.webContents.executeJavaScript(
    `window.digitalMe.actBehalfListDeliverableVersions({ deliverableId: ${JSON.stringify(first.id)} })`
  );
  assert.ok(listed.versions.length >= 2);
  const old = listed.versions.find((v) => v.id === v1);
  assert.equal(old.reviewStatus, "accepted");

  const phaseB = {
    phase: "B",
    pass: true,
    packageId: marker.packageId,
    oldVersionId: v1,
    newVersionId: regen.version.id,
    versionCount: listed.versions.length,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(outputDir, "phase-b.json"), JSON.stringify(phaseB, null, 2));
  console.log("PASS dvl2-03 phase B", JSON.stringify(phaseB));
  return 0;
}

async function runDvl203GenerationAcceptanceHarness(ctx) {
  const phase = String(process.env.DIGITALME_DVL2_03_ACCEPT_PHASE || "").toUpperCase();
  if (phase === "A") return runPhaseA(ctx);
  if (phase === "B") return runPhaseB(ctx);
  throw new Error("DIGITALME_DVL2_03_ACCEPT_PHASE must be A or B");
}

module.exports = { runDvl203GenerationAcceptanceHarness };
