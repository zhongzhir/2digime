"use strict";

/** BUG1-P1-1: 「我」三块 tab 切换验收（temp userData） */
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

async function runBug1P11AcceptanceHarness({ BrowserWindow }) {
  const win = BrowserWindow.getAllWindows()[0];
  await waitFor(() => !win.webContents.isLoading(), "page load");
  await sleep(700);
  const out = process.env.DIGITALME_VISUAL_OUTPUT;
  fs.mkdirSync(out, { recursive: true });

  await win.webContents.executeJavaScript(`document.querySelector('[data-view="me"]').click()`);
  await waitFor(
    () =>
      win.webContents.executeJavaScript(
        `!document.getElementById('view-me').classList.contains('hidden')`
      ),
    "me view"
  );

  const tabs = ["cognition", "distill", "collaboration"];
  const records = [];
  for (const tab of tabs) {
    await win.webContents.executeJavaScript(
      `document.querySelector('#me-tabs [data-me-tab="${tab}"]').click()`
    );
    await sleep(250);
    const state = await win.webContents.executeJavaScript(`(() => {
      const active = document.querySelector('#me-tabs .mode-tab.active');
      const panels = ['cognition','distill','collaboration'].map((name) => {
        const el = document.getElementById('me-panel-' + name);
        return {
          name,
          hidden: !el || el.classList.contains('hidden'),
          aria: el && el.getAttribute('aria-hidden'),
        };
      });
      const visible = panels.filter((p) => !p.hidden).map((p) => p.name);
      return {
        activeTab: active && active.dataset.meTab,
        ariaSelected: active && active.getAttribute('aria-selected'),
        visible,
        panels,
        primaryCount: document.querySelectorAll('#me-tabs .me-tab-primary').length,
      };
    })()`);
    assert.equal(state.activeTab, tab, tab + " active");
    assert.equal(state.ariaSelected, "true");
    assert.deepEqual(state.visible, [tab], tab + " alone visible");
    assert.equal(state.primaryCount, 3, "three primary tabs");
    const png = path.join(out, "me-tab-" + tab + ".png");
    fs.writeFileSync(png, (await win.webContents.capturePage()).toPNG());
    records.push({ tab, ...state, png, pass: true });
  }

  const acceptancePath = path.join(out, "acceptance.json");
  fs.writeFileSync(acceptancePath, JSON.stringify(records, null, 2));
  console.log("PASS bug1-p1-1 me tabs", acceptancePath);
  return 0;
}

module.exports = { runBug1P11AcceptanceHarness };
