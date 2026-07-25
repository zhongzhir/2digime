"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, label) {
  for (let i = 0; i < 100; i += 1) {
    if (await fn()) return;
    await sleep(50);
  }
  throw new Error("timeout: " + label);
}

async function runBug1P15AcceptanceHarness({ BrowserWindow }) {
  const win = BrowserWindow.getAllWindows()[0];
  await waitFor(() => !win.webContents.isLoading(), "load");
  await sleep(600);
  const out = process.env.DIGITALME_VISUAL_OUTPUT;
  fs.mkdirSync(out, { recursive: true });

  const routing = {
    providers: [
      {
        id: "fake-primary",
        name: "Fake Primary",
        type: "fake",
        enabled: true,
        models: [{ id: "fake-primary/fail", model: "fail-primary", displayName: "Fail Primary", enabled: true }],
      },
      {
        id: "fake-fallback",
        name: "Fake Fallback",
        type: "fake",
        enabled: true,
        models: [{ id: "fake-fallback/ok", model: "ok-fallback", displayName: "Ok Fallback", enabled: true }],
      },
    ],
    routes: {
      chat: { primary: "fake-primary/fail", fallbacks: ["fake-fallback/ok"] },
      artifact: { primary: "fake-fallback/ok", fallbacks: [] },
      review: { primary: "fake-fallback/ok", fallbacks: [] },
    },
  };
  await win.webContents.executeJavaScript(
    `window.digitalMe.saveModelRouting(${JSON.stringify({ routing })})`
  );
  await win.webContents.executeJavaScript(`document.getElementById('btn-settings').click()`);
  await waitFor(
    () =>
      win.webContents.executeJavaScript(
        `!document.getElementById('settings-modal').classList.contains('hidden')`
      ),
    "settings open"
  );
  await win.webContents.executeJavaScript(`window.digitalMe.getModelRouting().then(() => true)`);
  await sleep(200);
  // Force refresh UI
  await win.webContents.executeJavaScript(
    `document.getElementById('btn-model-routing-refresh')?.click()`
  );
  await sleep(400);

  const state = await win.webContents.executeJavaScript(`(() => {
    const ui = document.getElementById('model-routing-task-ui');
    const rows = Array.from(ui?.querySelectorAll('.settings-model-task-row') || []).map((row) => ({
      task: row.dataset.taskType,
      primary: row.querySelector('.model-route-primary')?.value,
      fallback: row.querySelector('.model-route-fallback')?.value,
      label: row.querySelector('strong')?.textContent || '',
    }));
    const html = document.documentElement.innerHTML;
    return {
      rowCount: rows.length,
      rows,
      hasTaskCopy: rows.every((r) => /按任务分工/.test(r.label)),
      noParallelCopy: !/同时调用多个模型/.test(html),
      keyLeak: html.includes('FAKE_MODEL_KEY_DO_NOT_LEAK'),
    };
  })()`);

  assert.equal(state.rowCount, 3);
  assert.equal(state.hasTaskCopy, true);
  assert.equal(state.noParallelCopy, true);
  assert.equal(state.keyLeak, false);
  assert.equal(state.rows.find((r) => r.task === "chat")?.fallback, "fake-fallback/ok");

  const png = path.join(out, "task-routing-ui.png");
  fs.writeFileSync(png, (await win.webContents.capturePage()).toPNG());
  const acceptancePath = path.join(out, "acceptance.json");
  fs.writeFileSync(
    acceptancePath,
    JSON.stringify({ name: "bug1-p1-5-model-routing", state, png, pass: true }, null, 2)
  );
  console.log("PASS bug1-p1-5 model routing", acceptancePath);
  return 0;
}
module.exports = { runBug1P15AcceptanceHarness };
