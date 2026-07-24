"use strict";

/**
 * Driven by main.js when DIGITALME_OWNER_RUNTIME_TEST=1.
 * Exercises real BrowserWindow + preload + renderer (not source regex).
 */

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { ipcMain } = require("electron");
const { buildRuntimeStamp, stampIsPostOwnerFixes } = require("../src/runtime-stamp");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, { timeoutMs = 20000, intervalMs = 50, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for ${label}: ${String(last)}`);
}

async function evalIn(win, source) {
  return win.webContents.executeJavaScript(source, true);
}

function installPickFileMock() {
  const state = { calls: 0, mode: "cancel", files: [] };
  try {
    ipcMain.removeHandler("builder:pickFile");
  } catch {
    /* ignore */
  }
  ipcMain.handle("builder:pickFile", async () => {
    state.calls += 1;
    if (state.mode === "cancel") return [];
    return state.files;
  });
  return state;
}

async function runOwnerRuntimeHarness({ BrowserWindow, app }) {
  const results = [];
  const pass = (name) => {
    results.push({ name, ok: true });
    console.log("PASS", name);
  };
  const fail = (name, err) => {
    results.push({ name, ok: false, err: String(err && err.stack ? err.stack : err) });
    console.error("FAIL", name, err && err.stack ? err.stack : err);
  };

  const win =
    BrowserWindow.getAllWindows()[0] ||
    (await waitFor(() => BrowserWindow.getAllWindows()[0], { label: "BrowserWindow" }));

  await waitFor(() => !win.webContents.isLoading(), { label: "load complete", timeoutMs: 30000 });
  // Let renderer init / early delegates finish.
  await sleep(800);

  const pickState = installPickFileMock();
  const userData = app.getPath("userData");
  const fixturePath = path.join(userData, "owner-runtime-fixture.json");
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));

  // --- 1. Runtime stamp: loaded files match disk + post-fix markers ---
  try {
    const disk = buildRuntimeStamp();
    assert.equal(stampIsPostOwnerFixes(disk), true, "disk sources must include owner-fix markers");
    const stamp = await evalIn(
      win,
      `(async () => {
        if (!window.digitalMe || !window.digitalMe.getRuntimeStamp) return null;
        return window.digitalMe.getRuntimeStamp();
      })()`
    );
    assert.ok(stamp, "renderer must expose getRuntimeStamp");
    assert.equal(stamp.postOwnerFixes, true, "running app must be post-596c9df/b99d472 markers");
    assert.equal(stamp.files.main.sha256, disk.files.main.sha256, "main hash mismatch");
    assert.equal(stamp.files.preload.sha256, disk.files.preload.sha256, "preload hash mismatch");
    assert.equal(
      stamp.files.rendererApp.sha256,
      disk.files.rendererApp.sha256,
      "renderer app.js hash mismatch"
    );
    const flags = await evalIn(
      win,
      `({
        bootstrap: document.documentElement.dataset.dmBootstrapDelegate,
        tips: document.documentElement.dataset.dmTipDelegate,
        post: document.documentElement.dataset.dmPostOwnerFixes,
        stampVisible: !document.getElementById("ui-runtime-stamp").classList.contains("hidden"),
      })`
    );
    assert.equal(flags.bootstrap, "1", "bootstrap delegate must be registered");
    assert.equal(flags.tips, "1", "tip delegate must be registered");
    assert.equal(flags.post, "1", "postOwnerFixes dataset");
    assert.equal(flags.stampVisible, true, "runtime stamp must be visible on page");
    pass("1. runtime stamp matches disk (post owner-fix sources)");
  } catch (err) {
    fail("1. runtime stamp matches disk (post owner-fix sources)", err);
  }

  // --- 2. Bootstrap submit buttons → pickFile + cancel/success UI ---
  try {
    await evalIn(
      win,
      `(() => {
        document.querySelector('[data-view="me"]')?.click();
        document.getElementById("me-lane-btn-build")?.click();
      })()`
    );
    await sleep(200);

    pickState.mode = "cancel";
    pickState.calls = 0;
    await evalIn(win, `document.getElementById("btn-bootstrap-resume").click()`);
    await waitFor(() => pickState.calls >= 1, { label: "pickFile after resume click", timeoutMs: 5000 });
    await sleep(150);
    let headline = await evalIn(
      win,
      `document.getElementById("inbox-progress-headline")?.textContent || ""`
    );
    assert.match(headline, /未选择文件|正在打开/, "cancel path should update progress");
    // Prefer exact cancel copy once dialog mock returns.
    await waitFor(
      async () => {
        headline = await evalIn(
          win,
          `document.getElementById("inbox-progress-headline")?.textContent || ""`
        );
        return /未选择文件/.test(headline);
      },
      { label: "cancel headline", timeoutMs: 5000 }
    );

    pickState.mode = "success";
    pickState.files = [
      {
        name: "owner-resume.txt",
        filePath: path.join(fixture.work, "owner-resume.txt"),
      },
    ];
    fs.writeFileSync(pickState.files[0].filePath, "resume fixture\n", "utf8");
    const callsBefore = pickState.calls;
    await evalIn(win, `document.getElementById("btn-bootstrap-assessment-file").click()`);
    await waitFor(() => pickState.calls > callsBefore, {
      label: "pickFile after assessment click",
      timeoutMs: 5000,
    });
    await waitFor(
      async () => {
        const h = await evalIn(
          win,
          `document.getElementById("inbox-progress-headline")?.textContent || ""`
        );
        return /已选择|已投入|已提交/.test(h);
      },
      { label: "success headline", timeoutMs: 10000 }
    );
    pass("2. bootstrap buttons call pickFile and show cancel/success feedback");
  } catch (err) {
    fail("2. bootstrap buttons call pickFile and show cancel/success feedback", err);
  }

  // --- 3. Tip mark hover / click / focus ---
  try {
    const tipResult = await evalIn(
      win,
      `(async () => {
        const mark = document.querySelector('.tip-mark[data-tip-id="bootstrap-duo"]');
        const bubble = document.getElementById("tip-bubble");
        if (!mark || !bubble) return { ok: false, reason: "missing_dom" };
        const out = {};
        mark.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, composed: true }));
        await new Promise((r) => setTimeout(r, 30));
        out.hoverText = bubble.textContent || "";
        out.hoverVisible = !bubble.classList.contains("hidden");
        bubble.classList.add("hidden");
        mark.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 30));
        out.clickText = bubble.textContent || "";
        out.clickVisible = !bubble.classList.contains("hidden");
        bubble.classList.add("hidden");
        mark.focus();
        mark.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
        await new Promise((r) => setTimeout(r, 30));
        out.focusText = bubble.textContent || "";
        out.focusVisible = !bubble.classList.contains("hidden");
        out.ok = out.hoverVisible && out.clickVisible && out.focusVisible;
        return out;
      })()`
    );
    assert.equal(tipResult.ok, true, JSON.stringify(tipResult));
    assert.ok(tipResult.hoverText.length > 0, "hover tip text");
    assert.ok(tipResult.clickText.length > 0, "click tip text");
    assert.ok(tipResult.focusText.length > 0, "focus tip text");
    pass("3. tip-mark hover/click/focus shows bubble");
  } catch (err) {
    fail("3. tip-mark hover/click/focus shows bubble", err);
  }

  // --- 4. Current product task → result → save/adopt → reopen after reload ---
  try {
    await evalIn(
      win,
      `(() => {
        document.querySelector('[data-view="do"]')?.click();
      })()`
    );
    await sleep(300);
    await evalIn(win, `document.getElementById("btn-do-new-task")?.click()`);
    await waitFor(
      async () =>
        evalIn(win, `!document.getElementById("do-act-behalf")?.classList.contains("hidden")`),
      { label: "current task scene open", timeoutMs: 10000 }
    );
    await evalIn(
      win,
      `(() => { document.getElementById("act-title").value = "Owner runtime 成果"; document.getElementById("act-request").value = "起草一份可保存的简短工作说明"; document.getElementById("btn-act-auto-generate").click(); })()`
    );
    await waitFor(
      async () =>
        evalIn(
          win,
          `(() => { const p=document.getElementById("act-result-gen-panel"); const t=document.getElementById("act-final-draft"); return p && !p.classList.contains("hidden") && t && t.value.length > 20; })()`
        ),
      { label: "task result generated", timeoutMs: 20000 }
    );
    await evalIn(win, `document.getElementById("btn-act-save-result").click()`);
    await waitFor(async () => evalIn(win, `/成果已保存到本机任务库/.test(document.getElementById("act-result-gen-status")?.textContent || "")`), { label: "result saved", timeoutMs: 10000 });
    const taskId = await evalIn(win, `window.digitalMe.actBehalfList().then((r) => r.tasks[0].taskId)`);
    assert.ok(taskId, "saved task id");
    await evalIn(win, `location.reload()`);
    await waitFor(() => !win.webContents.isLoading(), { label: "renderer reload", timeoutMs: 30000 });
    await sleep(800);
    await evalIn(win, `document.querySelector('[data-view="do"]')?.click()`);
    await sleep(150);
    await evalIn(win, `document.getElementById("btn-do-new-task")?.click()`);
    await waitFor(async () => evalIn(win, `!document.getElementById("do-act-behalf")?.classList.contains("hidden")`), { label: "task scene reopened", timeoutMs: 10000 });
    await waitFor(async () => evalIn(win, `window.digitalMe.actBehalfList().then((r) => r.tasks.some((t) => t.taskId === ${JSON.stringify(taskId)}))`), { label: "saved task persisted after reload", timeoutMs: 10000 });
    await waitFor(async () => evalIn(win, `!!document.querySelector('#act-task-list [data-task-id="${taskId}"]')`), { label: "saved task listed", timeoutMs: 10000 });
    await evalIn(win, `document.querySelector('#act-task-list [data-task-id="${taskId}"]')?.click()`);
    await waitFor(async () => evalIn(win, `document.getElementById("act-final-draft")?.value.length > 20`), { label: "saved result reopened", timeoutMs: 10000 });
    pass("4. current task generates, saves, and reopens after renderer restart");
  } catch (err) {
    fail("4. stop yields execution_canceled (not execution_timed_out)", err);
  }

  // --- 5. No fatal boot log from bind phase ---
  try {
    const boot = await evalIn(
      win,
      `document.getElementById("ui-boot-log")?.textContent || ""`
    );
    assert.ok(!/界面「me」绑定失败/.test(boot), "bindMe must not abort UI: " + boot);
    assert.ok(!/bootstrap-files/.test(boot) || !/绑定失败/.test(boot), boot);
    pass("5. no binder abort in visible boot log");
  } catch (err) {
    fail("5. no binder abort in visible boot log", err);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    failed.length
      ? `FAIL owner-runtime ${failed.length}/${results.length}`
      : `PASS owner-runtime ${results.length}/${results.length}`
  );
  return failed.length ? 1 : 0;
}

module.exports = { runOwnerRuntimeHarness };
