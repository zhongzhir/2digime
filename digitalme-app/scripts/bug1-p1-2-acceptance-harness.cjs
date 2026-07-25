"use strict";

/** BUG1-P1-2: 身份与协作独立侧栏入口验收 */
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

async function runBug1P12AcceptanceHarness({ BrowserWindow }) {
  const win = BrowserWindow.getAllWindows()[0];
  await waitFor(() => !win.webContents.isLoading(), "page load");
  await sleep(700);
  const out = process.env.DIGITALME_VISUAL_OUTPUT;
  fs.mkdirSync(out, { recursive: true });

  const nav = await win.webContents.executeJavaScript(`(() => {
    const btn = document.querySelector('.nav-item[data-view="identity"]');
    return { present: !!btn, label: btn && btn.textContent.trim() };
  })()`);
  assert.equal(nav.present, true, "sidebar identity nav");
  assert.equal(nav.label, "身份与协作");

  await win.webContents.executeJavaScript(
    `document.querySelector('.nav-item[data-view="identity"]').click()`
  );
  await waitFor(
    () =>
      win.webContents.executeJavaScript(`(() => {
        const v = document.getElementById('view-identity');
        const me = document.getElementById('view-me');
        return v && !v.classList.contains('hidden') && me && me.classList.contains('hidden');
      })()`),
    "identity view open"
  );
  await sleep(400);

  const state = await win.webContents.executeJavaScript(`(() => {
    const v = document.getElementById('view-identity');
    const meTab = document.querySelector('#me-tabs [data-me-tab="collaboration"]');
    const id = document.getElementById('me-identity-display');
    const role = document.getElementById('me-role-selector');
    const cred = document.getElementById('me-credential-manager');
    const collab = document.getElementById('me-collaboration-manager');
    const navActive = document.querySelector('.nav-item.active');
    return {
      identityVisible: v && !v.classList.contains('hidden'),
      noMeCollabTab: !meTab,
      hasIdentityMount: !!(id && role && cred && collab),
      mountsInsideIdentity: !!(id && id.closest('#view-identity')),
      navView: navActive && navActive.dataset.view,
    };
  })()`);
  assert.equal(state.identityVisible, true);
  assert.equal(state.noMeCollabTab, true);
  assert.equal(state.hasIdentityMount, true);
  assert.equal(state.mountsInsideIdentity, true);
  assert.equal(state.navView, "identity");

  const png = path.join(out, "identity-independent.png");
  fs.writeFileSync(png, (await win.webContents.capturePage()).toPNG());
  const acceptancePath = path.join(out, "acceptance.json");
  fs.writeFileSync(
    acceptancePath,
    JSON.stringify({ name: "bug1-p1-2-identity", nav, state, png, pass: true }, null, 2)
  );
  console.log("PASS bug1-p1-2 identity", acceptancePath);
  return 0;
}

module.exports = { runBug1P12AcceptanceHarness };
