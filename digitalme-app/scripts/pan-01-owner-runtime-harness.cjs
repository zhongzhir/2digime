"use strict";

/**
 * PAN-01 Owner runtime harness (updated for PAN-01S minimal surface).
 * Hermetic package + real inbox queue so subject:getOverview sees P2 confirm label.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { app } = require("electron");
const {
  createHermeticPackageFixture,
  cleanupHermeticPackageFixture,
} = require("./hermetic-package-fixture.cjs");
const inbox = require("../src/inbox");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(fn, { timeoutMs = 25000, intervalMs = 50, label = "condition" } = {}) {
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

/**
 * Point config at a hermetic readable package and seed real inbox queue data.
 * subject:getOverview calls inbox.listQueue(userData) directly — IPC mocks alone are insufficient.
 */
function setupHermeticOwnerRuntime() {
  const { packageDir } = createHermeticPackageFixture("pan01-owner");
  const userData = app.getPath("userData");
  const cfgPath = path.join(userData, "config.json");
  fs.writeFileSync(
    cfgPath,
    JSON.stringify(
      {
        packageDir,
        provider: "openai-compatible",
        model: "stub-model",
      },
      null,
      2
    ),
    "utf8"
  );

  // Seed REAL queue so overview inboxSummary has awaiting_review (+ suggested for conflict case).
  inbox.saveQueue(userData, {
    version: 1,
    items: [
      {
        id: "inbox_pending_1",
        name: "pending.txt",
        status: "awaiting_review",
        suggestedKind: "persona",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "inbox_suggested_1",
        name: "suggested.txt",
        status: "suggested",
        suggestedKind: "persona",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });

  return { packageDir, userData };
}

async function clickSidebarMe(win) {
  await evalIn(
    win,
    `(() => {
      const btn = document.querySelector('.nav-item[data-view="me"]');
      if (!btn) throw new Error("sidebar 我 missing");
      btn.click();
      return true;
    })()`
  );
}

async function waitMinimalHome(win) {
  return waitFor(
    async () => {
      const s = await evalIn(
        win,
        `({
          meVisible: !document.getElementById("view-me")?.classList.contains("hidden"),
          selfVisible: !document.getElementById("me-lane-self")?.classList.contains("hidden"),
          buildHidden: document.getElementById("me-lane-build")?.classList.contains("hidden"),
          overviewActive: document.querySelector('#me-tabs .mode-tab[data-me-tab="overview"]')?.classList.contains("active"),
          primary: (document.getElementById("subject-minimal-primary")?.textContent || "").trim(),
          bodyText: document.getElementById("subject-home")?.innerText || "",
          promises: document.getElementById("panorama-promises-card"),
          journey: document.getElementById("panorama-journey-card"),
          cta: document.getElementById("panorama-sovereign-cta"),
          pkgStatus: document.getElementById("pkg-status"),
          modelStatus: document.getElementById("model-status"),
          capStatus: document.getElementById("capabilities-status"),
          footnote: document.querySelector("#sidebar .footnote"),
        })`
      );
      return s.meVisible && s.selfVisible && s.overviewActive && s.primary ? s : null;
    },
    { label: "minimal me home", timeoutMs: 15000 }
  );
}

async function openMinimalViaSidebarOnly(win) {
  await evalIn(
    win,
    `(() => {
      const chat = document.querySelector('.nav-item[data-view="chat"]');
      if (chat) chat.click();
      return true;
    })()`
  );
  await waitFor(
    async () => {
      const s = await evalIn(
        win,
        `({ chatVisible: !document.getElementById("view-chat")?.classList.contains("hidden") })`
      );
      return s.chatVisible ? s : null;
    },
    { label: "chat view", timeoutMs: 8000 }
  );
  await clickSidebarMe(win);
  return waitMinimalHome(win);
}

async function runPan01OwnerRuntimeHarness({ BrowserWindow }) {
  const results = [];
  const pass = (name) => {
    results.push({ name, ok: true });
    console.log("PASS", name);
  };
  const fail = (name, err) => {
    results.push({ name, ok: false, err: String(err && err.stack ? err.stack : err) });
    console.error("FAIL", name, err && err.stack ? err.stack : err);
  };

  const { packageDir } = setupHermeticOwnerRuntime();

  const win =
    BrowserWindow.getAllWindows()[0] ||
    (await waitFor(() => BrowserWindow.getAllWindows()[0], { label: "BrowserWindow" }));

  await waitFor(() => !win.webContents.isLoading(), { label: "load complete", timeoutMs: 30000 });
  await sleep(1500);

  // 1) Default entry: inbox pending must not hijack; minimal surface only; P2「继续了解我」
  try {
    const state = await openMinimalViaSidebarOnly(win);
    assert.equal(state.buildHidden, true, "inbox pending must not open build lane");
    assert.match(state.primary, /继续了解我/);
    assert.equal(!!state.promises, false);
    assert.equal(!!state.journey, false);
    assert.equal(!!state.cta, false);
    assert.ok(!/四个承诺|成长路线|体验一次/.test(state.bodyText));
    pass("default entry is minimal despite pending inbox");
  } catch (err) {
    fail("panorama default entry / content", err);
  }

  // 2) No production PAN-01R CTA; walls gone
  try {
    await openMinimalViaSidebarOnly(win);
    const gate = await evalIn(
      win,
      `({
        cta: document.getElementById("panorama-sovereign-cta"),
        promises: document.getElementById("panorama-promises-card"),
        experienceOpen: !document.getElementById("panorama-experience-panel")?.classList.contains("hidden") && !document.getElementById("panorama-experience-panel")?.hidden,
        harnessApi: typeof window.digitalMe.getPanoramaSubjectBrief,
      })`
    );
    assert.equal(!!gate.cta, false);
    assert.equal(!!gate.promises, false);
    assert.equal(gate.experienceOpen, false);
    assert.equal(gate.harnessApi, "undefined");
    pass("no production PAN-01R entry");
  } catch (err) {
    fail("authorize/collaborate CTAs", err);
  }

  // 3) Primary 继续了解我 → build lane (real navigation, not CSS-only)
  try {
    await openMinimalViaSidebarOnly(win);
    const before = await evalIn(
      win,
      `({
        primary: (document.getElementById("subject-minimal-primary")?.textContent || "").trim(),
        primaryNav: document.getElementById("subject-minimal-primary")?.dataset?.navTarget || "",
        continueExtra: document.getElementById("subject-minimal-continue-build"),
        labels: [...document.querySelectorAll("#subject-minimal-actions button")].map((b) => (b.textContent || "").trim()),
      })`
    );
    assert.match(before.primary, /继续了解我/);
    assert.equal(before.primaryNav, "me-build");
    // P2 primary already me-build → no duplicate continue button
    assert.equal(!!before.continueExtra, false);
    assert.equal(before.labels.filter((t) => t === "继续了解我").length, 1);
    await evalIn(win, `document.getElementById("subject-minimal-primary").click()`);
    const afterBuild = await waitFor(
      async () => {
        const s = await evalIn(
          win,
          `({
            buildVisible: !document.getElementById("me-lane-build")?.classList.contains("hidden"),
            selfHidden: document.getElementById("me-lane-self")?.classList.contains("hidden"),
            wizard: document.getElementById("build-wizard-step") || document.getElementById("build-step-b0"),
          })`
        );
        return s.buildVisible ? s : null;
      },
      { label: "build lane visible", timeoutMs: 8000 }
    );
    assert.equal(afterBuild.buildVisible, true);
    assert.equal(afterBuild.selfHidden, true);
    assert.ok(afterBuild.wizard, "build wizard present after navigate");
    pass("继续了解我 enters build lane");
  } catch (err) {
    fail("继续了解我", err);
  }

  // 3b) Session overflow menu: ⋯ opens menu; click ⋯ does not switch session; Escape closes
  try {
    await evalIn(
      win,
      `(() => {
        const chat = document.querySelector('.nav-item[data-view="chat"]');
        if (chat) chat.click();
        return true;
      })()`
    );
    await waitFor(
      async () => {
        const s = await evalIn(
          win,
          `({ chatVisible: !document.getElementById("view-chat")?.classList.contains("hidden") })`
        );
        return s.chatVisible ? s : null;
      },
      { label: "chat view for sessions", timeoutMs: 8000 }
    );
    // Ensure at least two sessions
    await evalIn(
      win,
      `(() => {
        const btn = document.getElementById("btn-new-session");
        if (btn) btn.click();
        return true;
      })()`
    );
    await sleep(400);
    await evalIn(
      win,
      `(() => {
        const btn = document.getElementById("btn-new-session");
        if (btn) btn.click();
        return true;
      })()`
    );
    await sleep(600);

    const menuProbe = await evalIn(
      win,
      `(() => {
        const rows = [...document.querySelectorAll("#session-list .session-item")];
        if (rows.length < 1) return { ok: false, reason: "no sessions" };
        const residentRename = [...document.querySelectorAll("#session-list .session-item-main")].some((b) =>
          /改名|删除/.test(b.textContent || "")
        );
        const overflowBtns = [...document.querySelectorAll(".session-overflow-btn")];
        if (!overflowBtns.length) return { ok: false, reason: "no overflow buttons" };
        const first = rows[0];
        const second = rows[1] || rows[0];
        const activeBefore = document.querySelector("#session-list .session-item.active")?.dataset?.sessionId || "";
        const more = first.querySelector(".session-overflow-btn");
        const menu = first.querySelector(".session-overflow-menu");
        more.click();
        const open1 = more.getAttribute("aria-expanded") === "true" && menu && !menu.classList.contains("hidden");
        const items = menu ? [...menu.querySelectorAll('[role="menuitem"]')].map((b) => (b.textContent || "").trim()) : [];
        // Click overflow on another row — previous should close
        const more2 = second.querySelector(".session-overflow-btn");
        const menu2 = second.querySelector(".session-overflow-menu");
        if (more2 && more2 !== more) more2.click();
        const prevClosed = menu.classList.contains("hidden");
        const secondOpen = more2 && more2.getAttribute("aria-expanded") === "true" && menu2 && !menu2.classList.contains("hidden");
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        const escClosed = !secondOpen || menu2.classList.contains("hidden");
        // Re-open and outside click
        more.click();
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        const outsideClosed = menu.classList.contains("hidden");
        const activeAfter = document.querySelector("#session-list .session-item.active")?.dataset?.sessionId || "";
        return {
          ok: true,
          residentRename,
          overflowCount: overflowBtns.length,
          open1,
          items,
          prevClosed: more2 && more2 !== more ? prevClosed : true,
          escClosed,
          outsideClosed,
          activeBefore,
          activeAfter,
          switchChanged: activeBefore !== activeAfter,
        };
      })()`
    );
    assert.equal(menuProbe.ok, true, menuProbe.reason || "menu probe failed");
    assert.equal(menuProbe.residentRename, false, "titles must not contain resident 改名/删除");
    assert.ok(menuProbe.overflowCount >= 1);
    assert.equal(menuProbe.open1, true);
    assert.ok(menuProbe.items.includes("改名"));
    assert.ok(menuProbe.items.includes("删除"));
    assert.equal(menuProbe.prevClosed, true);
    assert.equal(menuProbe.escClosed, true);
    assert.equal(menuProbe.outsideClosed, true);
    assert.equal(menuProbe.switchChanged, false, "clicking ⋯ must not switch session");
    pass("session overflow menu open/close without switch");
  } catch (err) {
    fail("session overflow menu", err);
  }

  // 3c) Delete while request in flight is blocked by navigation guard (no native confirm)
  try {
    const blocked = await evalIn(
      win,
      `(() => {
        if (!window.__dmTestHooks || typeof window.__dmTestHooks.setActiveChatRequest !== "function") {
          return { ok: false, reason: "test hooks missing" };
        }
        window.__dmTestHooks.setActiveChatRequest({
          requestId: "req_test_block",
          originSessionId: "s_test",
          originMessageId: "m_test",
          bubbleEl: null,
        });
        const row = document.querySelector("#session-list .session-item");
        if (!row) {
          window.__dmTestHooks.setActiveChatRequest(null);
          return { ok: false, reason: "no session row" };
        }
        const more = row.querySelector(".session-overflow-btn");
        more.click();
        const del = [...row.querySelectorAll(".session-overflow-item")].find((b) =>
          /^删除$/.test((b.textContent || "").trim())
        );
        if (!del) {
          window.__dmTestHooks.setActiveChatRequest(null);
          return { ok: false, reason: "delete menuitem missing" };
        }
        del.click();
        const hasConfirm = !!row.querySelector(".session-overflow-confirm-delete");
        const note = [...document.querySelectorAll(".msg.system-note, .system-note")]
          .map((n) => n.textContent || "")
          .join("\\n");
        window.__dmTestHooks.setActiveChatRequest(null);
        return {
          ok: true,
          hasConfirm,
          note,
          blocked: /请先停止当前回复/.test(note),
        };
      })()`
    );
    assert.equal(blocked.ok, true, blocked.reason || "guard probe failed");
    assert.equal(blocked.hasConfirm, false, "guard must block before custom confirm");
    assert.equal(blocked.blocked, true);
    pass("session delete blocked while request active");
  } catch (err) {
    fail("session delete guard", err);
  }

  // 3d) Inline rename + custom delete confirm (no prompt/confirm)
  try {
    const inline = await evalIn(
      win,
      `(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const row = document.querySelector("#session-list .session-item");
        if (!row) return { ok: false, reason: "no row" };
        const sessionId = row.dataset.sessionId;
        const more = row.querySelector(".session-overflow-btn");
        more.click();
        const ren = [...row.querySelectorAll(".session-overflow-item")].find((b) =>
          /^改名$/.test((b.textContent || "").trim())
        );
        if (!ren) return { ok: false, reason: "rename missing" };
        ren.click();
        await sleep(50);
        let input = document.querySelector(".session-rename-input");
        if (!input) return { ok: false, reason: "inline input missing" };
        const hasSave = !!document.querySelector(".session-rename-save");
        const hasCancel = !!document.querySelector(".session-rename-cancel");

        // Empty title must not save
        let renameCalls = 0;
        window.__dmTestHooks.renameSession = async () => {
          renameCalls += 1;
          return {};
        };
        input.value = "   ";
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await sleep(40);
        const emptyHint = (document.querySelector(".session-rename-hint")?.textContent || "").trim();
        const emptyBlocked = renameCalls === 0 && /请输入名称/.test(emptyHint);

        // Escape cancel must not call IPC
        input.value = "should-not-save";
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await sleep(200);
        const afterEscInput = document.querySelector(".session-rename-input");
        const escCancelled = !afterEscInput && renameCalls === 0;

        // Re-enter rename and save via Enter
        const row2 = document.querySelector('#session-list .session-item[data-session-id="' + sessionId + '"]') ||
          document.querySelector("#session-list .session-item");
        row2.querySelector(".session-overflow-btn").click();
        const ren2 = [...row2.querySelectorAll(".session-overflow-item")].find((b) =>
          /^改名$/.test((b.textContent || "").trim())
        );
        ren2.click();
        await sleep(50);
        input = document.querySelector(".session-rename-input");
        const newTitle = "验收改名-" + Date.now().toString(36).slice(-4);
        window.__dmTestHooks.renameSession = async (payload) => {
          renameCalls += 1;
          window.__dmTestHooks.renameSession = null;
          return window.digitalMe.renameSession(payload);
        };
        input.value = newTitle;
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
        await sleep(400);
        const savedTitle = (
          document.querySelector('#session-list .session-item[data-session-id="' + sessionId + '"] .s-title') ||
          document.querySelector("#session-list .session-item .s-title")
        )?.textContent || "";
        const savedOk = renameCalls >= 1 && savedTitle.includes("验收改名");

        // Save failure shows inline error
        const row3 = document.querySelector("#session-list .session-item");
        row3.querySelector(".session-overflow-btn").click();
        [...row3.querySelectorAll(".session-overflow-item")]
          .find((b) => /^改名$/.test((b.textContent || "").trim()))
          .click();
        await sleep(50);
        input = document.querySelector(".session-rename-input");
        window.__dmTestHooks.renameSession = async () => {
          throw new Error("模拟保存失败");
        };
        input.value = "失败标题";
        document.querySelector(".session-rename-save").click();
        await sleep(80);
        const failHint = (document.querySelector(".session-rename-hint")?.textContent || "").trim();
        const failOk = /模拟保存失败|保存失败/.test(failHint);
        window.__dmTestHooks.renameSession = null;
        document.querySelector(".session-rename-cancel")?.click();
        await sleep(200);

        // Custom delete confirm: cancel does not delete
        let deleteCalls = 0;
        const row4 = document.querySelector("#session-list .session-item");
        const id4 = row4.dataset.sessionId;
        row4.querySelector(".session-overflow-btn").click();
        [...row4.querySelectorAll(".session-overflow-item")]
          .find((b) => /^删除$/.test((b.textContent || "").trim()))
          .click();
        await sleep(40);
        const confirmMsg = (document.querySelector(".session-overflow-confirm-msg")?.textContent || "").trim();
        const confirmVisible = /确定删除这段对话/.test(confirmMsg);
        const cancelFocus =
          document.activeElement &&
          document.activeElement.classList.contains("session-overflow-confirm-cancel");
        window.__dmTestHooks.deleteSession = async (id) => {
          deleteCalls += 1;
          window.__dmTestHooks.deleteSession = null;
          return window.digitalMe.deleteSession(id);
        };
        document.querySelector(".session-overflow-confirm-cancel").click();
        await sleep(120);
        const stillThere = !!document.querySelector(
          '#session-list .session-item[data-session-id="' + id4 + '"]'
        );
        const cancelOk = deleteCalls === 0 && stillThere;

        // Final confirm deletes
        const row5 = document.querySelector('#session-list .session-item[data-session-id="' + id4 + '"]');
        row5.querySelector(".session-overflow-btn").click();
        [...row5.querySelectorAll(".session-overflow-item")]
          .find((b) => /^删除$/.test((b.textContent || "").trim()))
          .click();
        await sleep(40);
        document.querySelector(".session-overflow-confirm-delete").click();
        await sleep(400);
        const deletedGone = !document.querySelector(
          '#session-list .session-item[data-session-id="' + id4 + '"]'
        );
        window.__dmTestHooks.deleteSession = null;

        const src = String(document.querySelector("script[src*='app.js']") ? "ok" : "ok");
        return {
          ok: true,
          hasSave,
          hasCancel,
          emptyBlocked,
          escCancelled,
          savedOk,
          failOk,
          confirmVisible,
          cancelFocus,
          cancelOk,
          deletedGone,
          deleteCalls,
          src,
        };
      })()`
    );
    assert.equal(inline.ok, true, inline.reason || "inline probe failed");
    assert.equal(inline.hasSave, true);
    assert.equal(inline.hasCancel, true);
    assert.equal(inline.emptyBlocked, true);
    assert.equal(inline.escCancelled, true);
    assert.equal(inline.savedOk, true);
    assert.equal(inline.failOk, true);
    assert.equal(inline.confirmVisible, true);
    assert.equal(inline.cancelFocus, true);
    assert.equal(inline.cancelOk, true);
    assert.equal(inline.deletedGone, true);
    assert.ok(inline.deleteCalls >= 1);
    pass("inline rename and custom delete confirm");
  } catch (err) {
    fail("inline rename / delete confirm", err);
  }

  // 4) Sidebar cleaned
  try {
    const side = await openMinimalViaSidebarOnly(win);
    assert.equal(!!side.pkgStatus, false);
    assert.equal(!!side.modelStatus, false);
    assert.equal(!!side.capStatus, false);
    assert.equal(!!side.footnote, false);
    pass("sidebar cleaned");
  } catch (err) {
    fail("查看能力", err);
  }

  // 5) Help contains promises + journey
  try {
    await openMinimalViaSidebarOnly(win);
    const help = await evalIn(
      win,
      `(() => {
        const btn = document.querySelector('#view-me .btn-help[data-help-topic="me"]') ||
          document.querySelector('.btn-help[data-help-topic="me"]');
        if (!btn) return { ok: false, reason: "help button missing" };
        btn.click();
        const modal = document.getElementById("help-modal") || document.getElementById("help-dialog");
        const tab = [...document.querySelectorAll("#help-tabs button, .help-tabs button, [data-help-tab]")].find(
          (b) => /认识 Digital Me|理念/.test(b.textContent || "")
        );
        if (tab) tab.click();
        const body =
          document.getElementById("help-body")?.innerText ||
          document.getElementById("help-content")?.innerText ||
          document.querySelector(".help-body")?.innerText ||
          document.querySelector("#help-modal")?.innerText ||
          "";
        return {
          ok: true,
          body,
          hasThisIsMe: /这是我/.test(body),
          hasJourney: /构建我/.test(body) && /看见我/.test(body),
          hasPan01rCta: /体验一次 Digital Me 如何代表我/.test(body),
        };
      })()`
    );
    assert.equal(help.ok, true, help.reason || "help open failed");
    assert.equal(help.hasThisIsMe, true);
    assert.equal(help.hasJourney, true);
    assert.equal(help.hasPan01rCta, false);
    await evalIn(
      win,
      `(() => {
        const close = document.getElementById("btn-help-close");
        if (close) close.click();
        const modal = document.getElementById("help-modal");
        if (modal) modal.classList.add("hidden");
        return true;
      })()`
    );
    pass("help has promises and journey");
  } catch (err) {
    fail("查看边界", err);
  }

  // 6) Return to me stays minimal
  try {
    await openMinimalViaSidebarOnly(win);
    const again = await waitMinimalHome(win);
    assert.equal(again.buildHidden, true);
    assert.ok(again.primary);
    pass("return to me stays minimal");
  } catch (err) {
    fail("refresh 全貌", err);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nPAN-01 owner-runtime: ${results.length - failed.length} passed, ${failed.length} failed`);

  cleanupHermeticPackageFixture(packageDir);

  // Must return numeric code — main.js uses app.exit(code); process.exitCode alone is ignored.
  return failed.length ? 1 : 0;
}

module.exports = { runPan01OwnerRuntimeHarness };
