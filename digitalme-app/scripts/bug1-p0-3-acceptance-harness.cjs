"use strict";

/**
 * BUG1-P0-3: chat→做事 handoff + save/reopen result loop (temp userData only).
 * Output: .codex-qa/bug1-fix/p0-3-result-loop/
 */

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, label, timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await fn()) return;
    await sleep(80);
  }
  throw new Error("timeout: " + label);
}

async function evalIn(win, js) {
  return win.webContents.executeJavaScript(js, true);
}

async function runBug1P03AcceptanceHarness({ BrowserWindow }) {
  const win = BrowserWindow.getAllWindows()[0];
  await waitFor(() => !win.webContents.isLoading(), "page load");
  await sleep(800);

  const out = process.env.DIGITALME_VISUAL_OUTPUT;
  assert.ok(out, "DIGITALME_VISUAL_OUTPUT required");
  fs.mkdirSync(out, { recursive: true });

  win.unmaximize();
  win.setSize(1280, 800);
  win.webContents.setZoomFactor(1);
  await sleep(200);

  // --- A. 送到做事 must open act_behalf, not prep placeholder ---
  await evalIn(
    win,
    `(async () => {
      const long = Array.from({ length: 12 }, (_, i) =>
        '段落 ' + (i + 1) + '：这是送到做事的草稿正文，用于验收成果闭环。'
      ).join('\\n\\n');
      const s = await window.digitalMe.createSession({ title: 'BUG1-P0-3 送到做事' });
      s.messages = [
        {
          id: 'u1',
          role: 'user',
          displayText: '请写一段说明',
          modelText: '请写一段说明',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'a1',
          role: 'assistant',
          displayText: long,
          modelText: long,
          createdAt: new Date().toISOString(),
        },
      ];
      await window.digitalMe.saveSession(s);
      await window.digitalMe.setActiveSession(s.id);
      return s.id;
    })()`
  );
  await win.webContents.reload();
  await waitFor(() => !win.webContents.isLoading(), "session reload");
  await sleep(800);

  const handoffBefore = await evalIn(
    win,
    `(() => {
      const btn = document.querySelector('.btn-to-workspace');
      return {
        button: !!btn,
        label: btn && btn.textContent,
      };
    })()`
  );
  assert.equal(handoffBefore.button, true, "送到做事 button present");
  assert.equal(handoffBefore.label, "送到做事");

  await evalIn(win, `document.querySelector('.btn-to-workspace').click()`);
  await waitFor(
    async () =>
      evalIn(
        win,
        `(() => {
          const da = document.getElementById('do-act-behalf');
          const ph = document.getElementById('do-placeholder');
          const req = document.getElementById('act-request');
          return (
            da &&
            !da.classList.contains('hidden') &&
            (!ph || ph.classList.contains('hidden')) &&
            req &&
            (req.value || '').length > 40
          );
        })()`
      ),
    "act_behalf opened and draft seeded after 送到做事"
  );
  const handoff = await evalIn(
    win,
    `(() => {
      const phSub = document.getElementById('do-ph-sub');
      const req = document.getElementById('act-request');
      const title = document.getElementById('act-title');
      return {
        placeholderText: phSub && phSub.textContent,
        requestLen: (req && req.value || '').length,
        title: title && title.value,
        notPrep: !(phSub && /尚未开放/.test(phSub.textContent || '')),
      };
    })()`
  );
  assert.equal(handoff.notPrep, true, "must not land on 尚未开放");
  assert.ok(handoff.requestLen > 40, "draft seeded into act-request");
  assert.ok(handoff.title, "title seeded");
  const handoffPng = path.join(out, "sent-to-doing.png");
  fs.writeFileSync(handoffPng, (await win.webContents.capturePage()).toPNG());

  // --- B. fresh task generate → save → meta → reopen (independent of handoff seed) ---
  await evalIn(win, `document.getElementById('btn-act-new')?.click()`);
  await sleep(200);
  await evalIn(
    win,
    `(() => {
      document.getElementById('act-title').value = 'BUG1-P0-3 成果闭环';
      document.getElementById('act-request').value = '起草一份可保存的简短工作说明，用于验收成果闭环';
      document.getElementById('btn-act-auto-generate').click();
    })()`
  );
  try {
    await waitFor(
      async () =>
        evalIn(
          win,
          `(() => {
            const p = document.getElementById('act-result-gen-panel');
            const t = document.getElementById('act-final-draft');
            return p && !p.classList.contains('hidden') && t && t.value.length > 20;
          })()`
        ),
      "result generated",
      60000
    );
  } catch (err) {
    const diag = await evalIn(
      win,
      `(() => ({
        progress: document.getElementById('act-progress')?.textContent || '',
        status: document.getElementById('act-result-gen-status')?.textContent || '',
        panelHidden: document.getElementById('act-result-gen-panel')?.classList.contains('hidden'),
        draftLen: (document.getElementById('act-final-draft')?.value || '').length,
      }))()`
    );
    throw new Error("result generated failed: " + err.message + " diag=" + JSON.stringify(diag));
  }
  const beforeSavePng = path.join(out, "result-before-save.png");
  fs.writeFileSync(beforeSavePng, (await win.webContents.capturePage()).toPNG());

  await evalIn(win, `document.getElementById('btn-act-save-result').click()`);
  await waitFor(
    async () =>
      evalIn(
        win,
        `/成果已保存到本机任务库/.test(document.getElementById('act-result-gen-status')?.textContent || '')`
      ),
    "result saved status"
  );
  const meta = await evalIn(
    win,
    `(() => {
      const m = document.getElementById('act-result-meta')?.textContent || '';
      const s = document.getElementById('act-result-gen-status')?.textContent || '';
      return { meta: m, status: s };
    })()`
  );
  assert.ok(/成果：/.test(meta.meta), "meta shows name");
  assert.ok(/类型：/.test(meta.meta), "meta shows type");
  assert.ok(/状态：已保存|已保存 /.test(meta.meta), "meta shows save status");
  assert.ok(/复制文本不算完成|任务列表/.test(meta.status), "status clarifies save path / not copy");
  assert.ok(!/复制即完成|已复制即完成/.test(meta.status), "copy is not completion");

  const taskId = await evalIn(
    win,
    `window.digitalMe.actBehalfList().then((r) => (r.tasks && r.tasks[0] && r.tasks[0].taskId) || '')`
  );
  assert.ok(taskId, "saved task id");
  const savedPng = path.join(out, "result-saved.png");
  fs.writeFileSync(savedPng, (await win.webContents.capturePage()).toPNG());

  await evalIn(win, `location.reload()`);
  await waitFor(() => !win.webContents.isLoading(), "reload after save", 30000);
  await sleep(800);
  await evalIn(win, `document.querySelector('[data-view="do"]')?.click()`);
  await sleep(200);
  await evalIn(win, `document.getElementById('btn-do-new-task')?.click()`);
  await waitFor(
    async () =>
      evalIn(win, `!!document.querySelector('#act-task-list [data-task-id="${taskId}"]')`),
    "saved task listed"
  );
  await evalIn(
    win,
    `document.querySelector('#act-task-list [data-task-id="${taskId}"]')?.click()`
  );
  await waitFor(
    async () =>
      evalIn(win, `(document.getElementById('act-final-draft')?.value || '').length > 20`),
    "saved result reopened"
  );
  const reopened = await evalIn(
    win,
    `(() => {
      const m = document.getElementById('act-result-meta')?.textContent || '';
      const draft = document.getElementById('act-final-draft')?.value || '';
      return { meta: m, draftLen: draft.length };
    })()`
  );
  assert.ok(reopened.draftLen > 20, "draft restored");
  assert.ok(/已保存|状态：/.test(reopened.meta), "meta still shows save state");
  const reopenPng = path.join(out, "result-reopened.png");
  fs.writeFileSync(reopenPng, (await win.webContents.capturePage()).toPNG());

  const record = {
    name: "bug1-p0-3-result-loop",
    handoff: { ...handoffBefore, ...handoff, png: handoffPng },
    save: { ...meta, taskId, beforeSavePng, savedPng },
    reopen: { ...reopened, png: reopenPng },
    pass: true,
  };
  const acceptancePath = path.join(out, "acceptance.json");
  fs.writeFileSync(acceptancePath, JSON.stringify(record, null, 2));
  console.log("PASS bug1-p0-3 result loop", acceptancePath);
  return 0;
}

module.exports = { runBug1P03AcceptanceHarness };
