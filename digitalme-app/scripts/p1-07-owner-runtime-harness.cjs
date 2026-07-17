"use strict";

/**
 * P1-07 Owner acceptance: review placement + inbox status bound to Package commit.
 * Run: npm run test:p1-07-owner-runtime
 */

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { ipcMain } = require("electron");

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

function removeHandler(channel) {
  try {
    ipcMain.removeHandler(channel);
  } catch {
    /* ignore */
  }
}

function installP107Mocks(userData) {
  const work = path.join(userData, "p107-work");
  fs.mkdirSync(work, { recursive: true });
  const personaFile = path.join(work, "persona.txt");
  const identityFile = path.join(work, "identity.txt");
  fs.writeFileSync(personaFile, "persona fixture\n", "utf8");
  fs.writeFileSync(identityFile, "identity fixture\n", "utf8");

  const state = {
    packageRevision: 1,
    previousVersionId: null,
    previousRevision: null,
    statusLog: [],
    inboxItems: [
      {
        id: "inb_persona",
        name: "persona.txt",
        filePath: personaFile,
        size: 20,
        status: "suggested",
        suggestedKind: "persona",
        materialKind: "persona",
        confidence: "high",
      },
      {
        id: "inb_identity",
        name: "identity.txt",
        filePath: identityFile,
        size: 20,
        status: "suggested",
        suggestedKind: "identity",
        materialKind: "identity",
        confidence: "high",
      },
    ],
  };

  removeHandler("inbox:list");
  ipcMain.handle("inbox:list", () => ({ items: state.inboxItems.map((it) => ({ ...it })) }));

  removeHandler("inbox:markStatus");
  ipcMain.handle("inbox:markStatus", (_e, payload) => {
    state.statusLog.push({ ...payload });
    const it = state.inboxItems.find((x) => x.id === payload.id);
    if (it) {
      if (payload.status) it.status = payload.status;
      if (payload.processMeta) it.processMeta = payload.processMeta;
    }
    return it ? { ...it } : null;
  });

  removeHandler("inbox:organize");
  ipcMain.handle("inbox:organize", () => ({ items: state.inboxItems.map((it) => ({ ...it })) }));

  removeHandler("builder:distill");
  ipcMain.handle("builder:distill", (_e, payload) => {
    const kind = payload && payload.materialKind;
    if (kind === "identity") {
      return {
        materialKind: "identity",
        identity: {
          events: [{ when: "2020", what: "测试职务", org: "测试机构", facets: ["roles"] }],
          facts: [],
          inferences: [{ claim: "测试推断", type: "activity", confidence: "low" }],
          outcomes: [],
          domains: [],
          org_touchpoints: [],
          alter_candidates: [],
          mind_hooks: [],
          capability_signals: [],
        },
        meta: { fileNotes: [] },
      };
    }
    return {
      materialKind: "persona",
      agg: {
        memories: [{ content: "测试记忆", confidence: "high" }],
        decisionFrameworks: [],
        styleObservations: [],
        personaNotes: [],
      },
      meta: { fileNotes: [] },
    };
  });

  removeHandler("builder:previewWrite");
  ipcMain.handle("builder:previewWrite", (_e, payload) => {
    const kind = payload && payload.materialKind === "identity" ? "identity" : "persona";
    return {
      materialKind: kind,
      changeSetId: "cs_p107_test",
      baseRevision: state.packageRevision,
      affectedPaths: kind === "identity" ? ["life/events.jsonl"] : ["memory/long-term-memory.jsonl"],
      dataKinds: ["inference"],
      pathDataKinds: {},
      fieldKinds: {},
      factConfirmedFields: payload.factConfirmedFields || [],
      events: kind === "identity" ? 1 : 0,
      facts: 0,
      inferences: kind === "identity" ? 1 : 0,
      outcomes: 0,
      memories: kind === "persona" ? 1 : 0,
      frameworks: 0,
      actor: "owner:life",
      reason: "p107 test",
      sourceRefs: ["src_test"],
    };
  });

  removeHandler("builder:write");
  ipcMain.handle("builder:write", (_e, payload) => {
    if (!payload || !payload.confirmed) {
      const err = new Error("confirmation_required");
      err.code = "confirmation_required";
      throw err;
    }
    state.previousRevision = state.packageRevision;
    state.previousVersionId = "v" + state.packageRevision;
    state.packageRevision += 1;
    return {
      ok: true,
      materialKind: payload.materialKind || "persona",
      changeSetId: payload.changeSetId || "cs_p107_test",
      revision: state.packageRevision,
      rollbackVersion: state.previousVersionId,
      affectedPaths: ["memory/long-term-memory.jsonl"],
      dataKinds: ["inference"],
    };
  });

  removeHandler("packageStore:listVersions");
  ipcMain.handle("packageStore:listVersions", () => ({
    statusCode: state.previousVersionId ? "ok" : "ok",
    currentRevision: state.packageRevision,
    previousVersionId: state.previousVersionId,
    previousRevision: state.previousRevision,
    recoverable: !!state.previousVersionId,
    statusMessage: "",
  }));

  return state;
}

async function goBuildLane(win) {
  await evalIn(
    win,
    `(() => {
      document.querySelector('[data-view="me"]')?.click();
      document.getElementById("me-lane-btn-build")?.click();
    })()`
  );
  await sleep(250);
}

async function setConfirm(win, value) {
  await evalIn(
    win,
    `(() => {
      window.__p107TestConfirm = ${value ? "true" : "false"};
      window.confirm = () => window.__p107TestConfirm;
    })()`
  );
}

async function runP107OwnerRuntimeHarness({ BrowserWindow, app }) {
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
  await sleep(800);

  const state = installP107Mocks(app.getPath("userData"));
  await goBuildLane(win);
  await setConfirm(win, false);

  // 1. Review button in primary CTA row
  try {
    const btnInfo = await evalIn(
      win,
      `(() => {
        const btn = document.getElementById("btn-inbox-review");
        if (!btn) return { ok: false, reason: "missing" };
        const inMore = !!btn.closest("details.inbox-more-actions");
        const inCta = !!btn.closest(".inbox-cta-row");
        return { ok: !inMore && inCta, text: btn.textContent || "" };
      })()`
    );
    assert.equal(btnInfo.ok, true, JSON.stringify(btnInfo));
    assert.match(btnInfo.text, /审阅后写入/);
    pass("1. review button visible in primary actions");
  } catch (err) {
    fail("1. review button visible in primary actions", err);
  }

  // 2. Review DOM before self-assessment card
  try {
    const order = await evalIn(
      win,
      `(() => {
        const review = document.getElementById("builder-review");
        const intake = document.getElementById("intake-card");
        const bootstrap = document.getElementById("bootstrap-guide");
        if (!review || !intake) return { ok: false };
        const beforeIntake = !!(review.compareDocumentPosition(intake) & Node.DOCUMENT_POSITION_FOLLOWING);
        const beforeBootstrap = bootstrap
          ? !!(review.compareDocumentPosition(bootstrap) & Node.DOCUMENT_POSITION_FOLLOWING)
          : true;
        return { ok: beforeIntake && beforeBootstrap };
      })()`
    );
    assert.equal(order.ok, true);
    pass("2. review panel before self-assessment section");
  } catch (err) {
    fail("2. review panel before self-assessment section", err);
  }

  // 3. Review click shows visible review panel
  try {
    state.inboxItems.forEach((it) => {
      it.status = "suggested";
    });
    state.statusLog = [];
    await evalIn(win, `document.getElementById("btn-inbox-review").click()`);
    await waitFor(
      async () =>
        evalIn(
          win,
          `(() => {
            const r = document.getElementById("builder-review");
            return r && !r.classList.contains("hidden");
          })()`
        ),
      { label: "review visible", timeoutMs: 30000 }
    );
    const headline = await evalIn(
      win,
      `document.getElementById("inbox-progress-current")?.textContent || ""`
    );
    assert.match(headline, /等待你审阅|尚未写入/);
    pass("3. review mode shows panel and waiting headline");
  } catch (err) {
    fail("3. review mode shows panel and waiting headline", err);
  }

  // 4. Extract only → awaiting_review, not written
  try {
    const st = state.inboxItems.find((x) => x.id === "inb_identity");
    assert.ok(st);
    assert.equal(st.status, "awaiting_review");
    assert.notEqual(st.status, "written");
    pass("4. extract-only inbox status is awaiting_review");
  } catch (err) {
    fail("4. extract-only inbox status is awaiting_review", err);
  }

  // 5. Smart build cancel → not written, no done banner
  try {
    state.inboxItems.forEach((it) => {
      it.status = "suggested";
    });
    state.statusLog = [];
    const revBefore = state.packageRevision;
    await setConfirm(win, false);
    await evalIn(win, `document.getElementById("btn-inbox-smart").click()`);
    await waitFor(
      async () => {
        const h = await evalIn(
          win,
          `document.getElementById("inbox-progress-headline")?.textContent || ""`
        );
        return /已取消|未写入|失败/.test(h);
      },
      { label: "smart cancel headline", timeoutMs: 45000 }
    );
    assert.equal(state.packageRevision, revBefore);
    const anyWritten = state.inboxItems.some((it) => it.status === "written");
    assert.equal(anyWritten, false);
    const bannerHidden = await evalIn(
      win,
      `document.getElementById("build-done-banner")?.classList.contains("hidden")`
    );
    assert.equal(bannerHidden, true);
    pass("5. smart build cancel keeps revision and avoids written");
  } catch (err) {
    fail("5. smart build cancel keeps revision and avoids written", err);
  }

  // 6. Review discard → suggested, can re-enter
  try {
    state.inboxItems.forEach((it) => {
      it.status = "suggested";
    });
    await evalIn(win, `document.getElementById("btn-inbox-review").click()`);
    await waitFor(
      async () =>
        evalIn(
          win,
          `!document.getElementById("builder-review")?.classList.contains("hidden")`
        ),
      { label: "review open", timeoutMs: 30000 }
    );
    await evalIn(win, `document.getElementById("btn-discard").click()`);
    await sleep(300);
    const st = state.inboxItems.find((x) => x.id === "inb_identity");
    assert.equal(st.status, "suggested");
    pass("6. review discard restores suggested status");
  } catch (err) {
    fail("6. review discard restores suggested status", err);
  }

  // 7. Review commit → written + revision bump + recoverable version
  try {
    state.inboxItems = [state.inboxItems.find((x) => x.id === "inb_persona")];
    state.statusLog = [];
    state.previousVersionId = null;
    state.previousRevision = null;
    const revBefore = state.packageRevision;
    await setConfirm(win, true);
    await evalIn(win, `document.getElementById("btn-inbox-review").click()`);
    await waitFor(
      async () =>
        evalIn(
          win,
          `!document.getElementById("builder-review")?.classList.contains("hidden")`
        ),
      { label: "review for commit", timeoutMs: 30000 }
    );
    await evalIn(win, `document.getElementById("btn-write").click()`);
    await waitFor(
      async () => state.inboxItems.some((it) => it.status === "written"),
      { label: "written status", timeoutMs: 30000 }
    );
    assert.ok(state.packageRevision > revBefore);
    await sleep(300);
    const prevText = await evalIn(
      win,
      `document.getElementById("pkg-version-previous")?.textContent || ""`
    );
    assert.match(prevText, /最近可恢复|第 \d+ 版/);
    pass("7. review commit marks written and exposes recoverable version");
  } catch (err) {
    fail("7. review commit marks written and exposes recoverable version", err);
  }

  // 8. Multi-kind queue: second group stays suggested until first completes
  try {
    state.inboxItems = [
      {
        id: "inb_persona",
        name: "persona.txt",
        filePath: path.join(path.dirname(state.inboxItems[0].filePath), "persona.txt"),
        size: 20,
        status: "suggested",
        suggestedKind: "persona",
        materialKind: "persona",
        confidence: "high",
      },
      {
        id: "inb_identity",
        name: "identity.txt",
        filePath: path.join(path.dirname(state.inboxItems[0].filePath), "identity.txt"),
        size: 20,
        status: "suggested",
        suggestedKind: "identity",
        materialKind: "identity",
        confidence: "high",
      },
    ];
    state.statusLog = [];
    await setConfirm(win, false);
    await evalIn(win, `document.getElementById("btn-inbox-review").click()`);
    await waitFor(
      async () => state.inboxItems.find((x) => x.id === "inb_identity")?.status === "awaiting_review",
      { label: "identity awaiting", timeoutMs: 30000 }
    );
    const persona = state.inboxItems.find((x) => x.id === "inb_persona");
    assert.equal(persona.status, "suggested");
    pass("8. multi-kind review leaves later groups in suggested");
  } catch (err) {
    fail("8. multi-kind review leaves later groups in suggested", err);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    failed.length
      ? `FAIL p1-07-owner-runtime ${failed.length}/${results.length}`
      : `PASS p1-07-owner-runtime ${results.length}/${results.length}`
  );
  return failed.length ? 1 : 0;
}

module.exports = { runP107OwnerRuntimeHarness };
