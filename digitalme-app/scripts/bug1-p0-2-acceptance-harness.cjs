"use strict";

/**
 * BUG1-P0-2: long-reply fold/expand acceptance (temp userData only).
 * Output: .codex-qa/bug1-fix/p0-2-fold/
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

async function runBug1P02AcceptanceHarness({ BrowserWindow }) {
  const win = BrowserWindow.getAllWindows()[0];
  await waitFor(() => !win.webContents.isLoading(), "page load");
  await sleep(800);

  const out = process.env.DIGITALME_VISUAL_OUTPUT;
  assert.ok(out, "DIGITALME_VISUAL_OUTPUT required");
  fs.mkdirSync(out, { recursive: true });

  win.unmaximize();
  win.setSize(1280, 720);
  win.webContents.setZoomFactor(1);
  await sleep(200);

  const sessionId = await win.webContents.executeJavaScript(`(async () => {
    const long = Array.from({ length: 90 }, (_, i) =>
      '第 ' + (i + 1) + ' 段：这是用于真实视觉验收的长回复内容，确保折叠与展开有可见高度差。'
    ).join('\\n\\n');
    const s = await window.digitalMe.createSession({ title: 'BUG1-P0-2 折叠验收' });
    s.messages = [
      {
        id: 'u-fold',
        role: 'user',
        displayText: '请给出长回复',
        modelText: '请给出长回复',
        createdAt: new Date().toISOString(),
      },
      {
        id: 'a-fold',
        role: 'assistant',
        displayText: long,
        modelText: long,
        createdAt: new Date().toISOString(),
      },
    ];
    await window.digitalMe.saveSession(s);
    await window.digitalMe.setActiveSession(s.id);
    return s.id;
  })()`);

  await win.webContents.reload();
  await waitFor(() => !win.webContents.isLoading(), "fold session reload");
  await sleep(800);

  const folded = await win.webContents.executeJavaScript(`(() => {
    const b = document.querySelector('.msg-fold-toggle');
    const m = document.querySelector('.msg.assistant');
    return {
      button: !!b,
      text: b && b.textContent,
      aria: b && b.getAttribute('aria-expanded'),
      height: m && m.getBoundingClientRect().height,
      foldedClass: m && m.classList.contains('msg-folded'),
      maxHeight: m && getComputedStyle(m).maxHeight,
    };
  })()`);
  assert.equal(folded.button, true, "fold button present");
  assert.equal(folded.text, "展开");
  assert.equal(folded.aria, "false");
  assert.equal(folded.foldedClass, true);
  assert.ok(folded.height > 0 && folded.height < 220, "folded height stays compact, got " + folded.height);
  const foldPng = path.join(out, "folded-before-expand.png");
  fs.writeFileSync(foldPng, (await win.webContents.capturePage()).toPNG());

  const expanded = await win.webContents.executeJavaScript(`(() => {
    const b = document.querySelector('.msg-fold-toggle');
    const m = document.querySelector('.msg.assistant');
    b.click();
    return {
      text: b.textContent,
      aria: b.getAttribute('aria-expanded'),
      height: m.getBoundingClientRect().height,
      folded: m.classList.contains('msg-folded'),
      maxHeight: getComputedStyle(m).maxHeight,
    };
  })()`);
  assert.equal(expanded.text, "收起");
  assert.equal(expanded.aria, "true");
  assert.equal(expanded.folded, false);
  assert.ok(expanded.height > folded.height * 2, "expanded height visibly increases");
  const expandPng = path.join(out, "expanded.png");
  fs.writeFileSync(expandPng, (await win.webContents.capturePage()).toPNG());

  const collapsed = await win.webContents.executeJavaScript(`(() => {
    const b = document.querySelector('.msg-fold-toggle');
    const m = document.querySelector('.msg.assistant');
    b.click();
    return {
      text: b.textContent,
      aria: b.getAttribute('aria-expanded'),
      height: m.getBoundingClientRect().height,
      folded: m.classList.contains('msg-folded'),
    };
  })()`);
  assert.equal(collapsed.text, "展开");
  assert.equal(collapsed.aria, "false");
  assert.equal(collapsed.folded, true);
  assert.ok(collapsed.height < expanded.height, "collapsed height restores");
  const collapsePng = path.join(out, "collapsed-after-expand.png");
  fs.writeFileSync(collapsePng, (await win.webContents.capturePage()).toPNG());

  await win.webContents.reload();
  await waitFor(() => !win.webContents.isLoading(), "fold reopen reload");
  await sleep(800);
  const reopened = await win.webContents.executeJavaScript(`(() => {
    const b = document.querySelector('.msg-fold-toggle');
    const m = document.querySelector('.msg.assistant');
    const before = m.getBoundingClientRect().height;
    b.click();
    return {
      text: b.textContent,
      aria: b.getAttribute('aria-expanded'),
      grew: m.getBoundingClientRect().height > before,
    };
  })()`);
  assert.deepEqual(reopened, { text: "收起", aria: "true", grew: true });
  const reopenPng = path.join(out, "reopened-expanded.png");
  fs.writeFileSync(reopenPng, (await win.webContents.capturePage()).toPNG());

  const record = {
    name: "bug1-p0-2-fold-expand-reopen",
    sessionId,
    folded: { ...folded, png: foldPng },
    expanded: { ...expanded, png: expandPng },
    collapsed: { ...collapsed, png: collapsePng },
    reopened: { ...reopened, png: reopenPng },
    pass: true,
  };
  const acceptancePath = path.join(out, "acceptance.json");
  fs.writeFileSync(acceptancePath, JSON.stringify(record, null, 2));
  console.log("PASS bug1-p0-2 fold acceptance", acceptancePath);
  return 0;
}

module.exports = { runBug1P02AcceptanceHarness };
