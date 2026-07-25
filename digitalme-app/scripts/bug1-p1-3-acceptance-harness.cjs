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

async function runBug1P13AcceptanceHarness({ BrowserWindow }) {
  const win = BrowserWindow.getAllWindows()[0];
  await waitFor(() => !win.webContents.isLoading(), "load");
  await sleep(600);
  const out = process.env.DIGITALME_VISUAL_OUTPUT;
  fs.mkdirSync(out, { recursive: true });

  await win.webContents.executeJavaScript(
    `document.querySelector('.nav-item[data-view="extensions"]').click()`
  );
  await waitFor(
    () =>
      win.webContents.executeJavaScript(
        `!document.getElementById('view-extensions').classList.contains('hidden')`
      ),
    "extensions view"
  );
  await sleep(300);

  const state = await win.webContents.executeJavaScript(`(() => {
    const titles = [
      document.getElementById('capability-now-title')?.textContent.trim(),
      document.getElementById('capability-store-title')?.childNodes[0]?.textContent?.trim() || document.getElementById('capability-store-title')?.textContent.trim(),
      document.getElementById('skill-zone-title')?.textContent.trim(),
      document.getElementById('capability-artifacts-title')?.textContent.trim(),
    ];
    const advanced = document.getElementById('extensions-developer-tools');
    const empty = document.getElementById('capability-empty-actions');
    return {
      titles,
      advancedPresent: !!advanced,
      advancedOpen: advanced && advanced.open,
      emptyNextSteps: !!(empty && empty.querySelector('#btn-capability-go-do')),
    };
  })()`);

  assert.equal(state.titles[0], "能做什么");
  assert.ok(state.titles[1].startsWith("公共能力"), "公共能力 title");
  assert.equal(state.titles[2], "我的技能");
  assert.equal(state.titles[3], "我的成果");
  assert.equal(state.advancedPresent, true);
  assert.equal(state.advancedOpen, false, "MCP/命令 default collapsed");
  assert.equal(state.emptyNextSteps, true);

  const normalPng = path.join(out, "normal-mode.png");
  fs.writeFileSync(normalPng, (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(
    `document.querySelector('#extensions-developer-tools > summary')?.click()`
  );
  await sleep(200);
  const advancedPng = path.join(out, "advanced-mode.png");
  fs.writeFileSync(advancedPng, (await win.webContents.capturePage()).toPNG());

  const acceptancePath = path.join(out, "acceptance.json");
  fs.writeFileSync(
    acceptancePath,
    JSON.stringify({ name: "bug1-p1-3-capability", state, normalPng, advancedPng, pass: true }, null, 2)
  );
  console.log("PASS bug1-p1-3 capability", acceptancePath);
  return 0;
}
module.exports = { runBug1P13AcceptanceHarness };
