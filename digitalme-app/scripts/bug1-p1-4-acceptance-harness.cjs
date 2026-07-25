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

async function runBug1P14AcceptanceHarness({ BrowserWindow }) {
  const win = BrowserWindow.getAllWindows()[0];
  await waitFor(() => !win.webContents.isLoading(), "load");
  await sleep(600);
  const out = process.env.DIGITALME_VISUAL_OUTPUT;
  fs.mkdirSync(out, { recursive: true });

  await win.webContents.executeJavaScript(`document.getElementById('btn-settings').click()`);
  await waitFor(
    () =>
      win.webContents.executeJavaScript(
        `!document.getElementById('settings-modal').classList.contains('hidden')`
      ),
    "settings open"
  );

  const state = await win.webContents.executeJavaScript(`(() => {
    const body = document.querySelector('.settings-modal-body');
    const heads = Array.from(body.querySelectorAll(':scope > .settings-subhead')).map((el) => el.textContent.trim());
    const advanced = document.getElementById('settings-advanced-developer');
    const oldTest = document.getElementById('settings-advanced-tools');
    return {
      heads,
      advancedPresent: !!advanced,
      advancedOpen: advanced && advanced.open,
      oldTestGone: !oldTest,
      hasAppearance: !!document.getElementById('settings-appearance-note'),
      hasNotification: !!document.getElementById('settings-notification-note'),
      hasTestToolInside: !!(advanced && advanced.querySelector('#btn-create-temp-test-pkg')),
      hasCliInside: !!(advanced && advanced.querySelector('#cfg-cli-executable')),
    };
  })()`);

  assert.deepEqual(state.heads, ["模型与默认", "数据与隐私", "外观与界面", "通知偏好"]);
  assert.equal(state.advancedPresent, true);
  assert.equal(state.advancedOpen, false);
  assert.equal(state.oldTestGone, true);
  assert.equal(state.hasAppearance, true);
  assert.equal(state.hasNotification, true);
  assert.equal(state.hasTestToolInside, true);
  assert.equal(state.hasCliInside, true);

  const png = path.join(out, "settings-normal.png");
  fs.writeFileSync(png, (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript(
    `document.querySelector('#settings-advanced-developer > summary')?.click()`
  );
  await sleep(200);
  const advPng = path.join(out, "settings-advanced.png");
  fs.writeFileSync(advPng, (await win.webContents.capturePage()).toPNG());

  const acceptancePath = path.join(out, "acceptance.json");
  fs.writeFileSync(
    acceptancePath,
    JSON.stringify({ name: "bug1-p1-4-settings", state, png, advPng, pass: true }, null, 2)
  );
  console.log("PASS bug1-p1-4 settings", acceptancePath);
  return 0;
}
module.exports = { runBug1P14AcceptanceHarness };
