"use strict";

/**
 * BUG1-P0-1 window layout harness (temp userData only).
 * Asserts input visible/clickable; stamp & boot-log never cover composer;
 * main has no core horizontal overflow across 7 size/zoom combos.
 */

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

async function runBug1P01AcceptanceHarness({ BrowserWindow }) {
  const win = BrowserWindow.getAllWindows()[0];
  await waitFor(() => !win.webContents.isLoading(), "page load");
  await sleep(800);

  const out = process.env.DIGITALME_VISUAL_OUTPUT;
  assert.ok(out, "DIGITALME_VISUAL_OUTPUT required");
  fs.mkdirSync(out, { recursive: true });

  // Ensure stamp is visible for overlap geometry checks.
  await win.webContents.executeJavaScript(`(() => {
    const el = document.getElementById('ui-runtime-stamp');
    if (el) { el.classList.remove('hidden'); el.textContent = el.textContent || '版本 test'; }
    return true;
  })()`);

  const cases = [
    { name: "1280x720-100", size: [1280, 720], zoom: 1 },
    { name: "1280x720-125", size: [1280, 720], zoom: 1.25 },
    { name: "1280x720-150", size: [1280, 720], zoom: 1.5 },
    { name: "1920x1080-100", size: [1920, 1080], zoom: 1 },
    { name: "1920x1080-125", size: [1920, 1080], zoom: 1.25 },
    { name: "1920x1080-150", size: [1920, 1080], zoom: 1.5 },
  ];
  const records = [];

  for (const c of cases) {
    win.unmaximize();
    win.setSize(...c.size);
    win.webContents.setZoomFactor(c.zoom);
    await sleep(350);
    const r = await win.webContents.executeJavaScript(`(() => {
      const i = document.getElementById('input');
      const composer = document.getElementById('composer');
      const stamp = document.getElementById('ui-runtime-stamp');
      const log = document.getElementById('ui-boot-log');
      const main = document.getElementById('main');
      const ir = i.getBoundingClientRect();
      const cr = composer.getBoundingClientRect();
      const overlap = (x) => {
        if (!x || x.classList.contains('hidden')) return false;
        const r = x.getBoundingClientRect();
        return r.bottom > cr.top && r.top < cr.bottom && r.right > cr.left && r.left < cr.right;
      };
      const stampInSidebar = !!(stamp && stamp.closest('#sidebar'));
      return {
        inputVisible: !!(ir.width && ir.height && ir.bottom <= innerHeight),
        inputClickable: document.elementFromPoint(ir.left + 10, ir.top + 10) === i,
        noOverlay: !overlap(stamp) && !overlap(log),
        noCoreOverflow: main.scrollWidth <= main.clientWidth + 1,
        stampInSidebar,
        stampFixed: stamp ? getComputedStyle(stamp).position === 'fixed' : null,
      };
    })()`);
    assert.equal(r.inputVisible, true, c.name + " input visible");
    assert.equal(r.inputClickable, true, c.name + " input clickable");
    assert.equal(r.noOverlay, true, c.name + " no overlay");
    assert.equal(r.noCoreOverflow, true, c.name + " no overflow");
    assert.equal(r.stampInSidebar, true, c.name + " stamp in sidebar");
    assert.equal(r.stampFixed, false, c.name + " stamp not fixed overlay");
    const png = path.join(out, c.name + ".png");
    fs.writeFileSync(png, (await win.webContents.capturePage()).toPNG());
    records.push({ ...c, ...r, png, pass: true });
  }

  win.maximize();
  win.webContents.setZoomFactor(1);
  await sleep(350);
  const maxPng = path.join(out, "maximized-1920x1080-100.png");
  fs.writeFileSync(maxPng, (await win.webContents.capturePage()).toPNG());
  const maxR = await win.webContents.executeJavaScript(`(() => {
    const i = document.getElementById('input');
    const composer = document.getElementById('composer');
    const stamp = document.getElementById('ui-runtime-stamp');
    const log = document.getElementById('ui-boot-log');
    const ir = i.getBoundingClientRect();
    const cr = composer.getBoundingClientRect();
    const overlap = (x) => {
      if (!x || x.classList.contains('hidden')) return false;
      const r = x.getBoundingClientRect();
      return r.bottom > cr.top && r.top < cr.bottom && r.right > cr.left && r.left < cr.right;
    };
    return {
      inputVisible: !!(ir.width && ir.height && ir.bottom <= innerHeight),
      inputClickable: document.elementFromPoint(ir.left + 10, ir.top + 10) === i,
      noOverlay: !overlap(stamp) && !overlap(log),
    };
  })()`);
  assert.equal(maxR.inputVisible, true, "maximized input visible");
  assert.equal(maxR.inputClickable, true, "maximized input clickable");
  assert.equal(maxR.noOverlay, true, "maximized no overlay");
  records.push({ name: "maximized-1920x1080-100", ...maxR, png: maxPng, pass: true });

  const acceptancePath = path.join(out, "acceptance.json");
  fs.writeFileSync(acceptancePath, JSON.stringify(records, null, 2));
  console.log("PASS bug1-p0-1 window acceptance", acceptancePath);
  return 0;
}

module.exports = { runBug1P01AcceptanceHarness };
