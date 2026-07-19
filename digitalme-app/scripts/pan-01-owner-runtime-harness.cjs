"use strict";

/**
 * PAN-01 Owner runtime harness: panorama default entry + real CTAs (no internal fallbacks).
 */

const assert = require("node:assert/strict");
const { ipcMain } = require("electron");

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

function removeHandler(channel) {
  try {
    ipcMain.removeHandler(channel);
  } catch {
    /* ignore */
  }
}

function installInboxPendingMock() {
  removeHandler("inbox:list");
  ipcMain.handle("inbox:list", async () => ({
    items: [
      {
        id: "pending_1",
        name: "pending.txt",
        status: "suggested",
        suggestedKind: "persona",
        materialKind: "persona",
      },
    ],
  }));
}

async function clickSidebarMe(win) {
  await evalIn(
    win,
    `(() => {
      const nav = document.querySelector('.nav-item[data-view="me"]');
      if (!nav) throw new Error("sidebar 我 not found");
      nav.click();
      return true;
    })()`
  );
}

/** Leave「我」then click sidebar only — proves default entry and avoids refreshMeView race. */
async function openPanoramaViaSidebarOnly(win) {
  await evalIn(
    win,
    `(() => {
      const chat = document.querySelector('.nav-item[data-view="chat"]');
      if (!chat) throw new Error("chat nav missing");
      chat.click();
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
  return waitPanoramaHome(win);
}

async function waitPanoramaHome(win) {
  return waitFor(
    async () => {
      const s = await evalIn(
        win,
        `({
          meVisible: !document.getElementById("view-me")?.classList.contains("hidden"),
          selfVisible: !document.getElementById("me-lane-self")?.classList.contains("hidden"),
          buildHidden: document.getElementById("me-lane-build")?.classList.contains("hidden"),
          overviewActive: document.querySelector('#me-tabs .mode-tab[data-me-tab="overview"]')?.classList.contains("active"),
          overviewLabel: document.querySelector('#me-tabs .mode-tab[data-me-tab="overview"]')?.textContent?.trim() || "",
          promises: document.getElementById("panorama-promises")?.children.length || 0,
          journey: document.getElementById("panorama-journey")?.children.length || 0,
          bodyText: document.getElementById("subject-home")?.innerText || "",
        })`
      );
      return s.meVisible && s.selfVisible && s.overviewActive && s.promises >= 4 ? s : null;
    },
    { label: "panorama home ready", timeoutMs: 15000 }
  );
}

async function clickPanoramaButton(win, containerSelector, labelReSource) {
  const clicked = await evalIn(
    win,
    `(${function (containerSelector, labelReSource) {
      const root = document.querySelector(containerSelector);
      if (!root) throw new Error("container missing: " + containerSelector);
      const re = new RegExp(labelReSource);
      const btn = [...root.querySelectorAll("button")].find((b) => re.test(b.textContent || ""));
      if (!btn) throw new Error("button not found in " + containerSelector + ": " + labelReSource);
      btn.click();
      return true;
    }.toString()})(${JSON.stringify(containerSelector)}, ${JSON.stringify(labelReSource)})`
  );
  assert.equal(clicked, true);
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

  installInboxPendingMock();

  const win =
    BrowserWindow.getAllWindows()[0] ||
    (await waitFor(() => BrowserWindow.getAllWindows()[0], { label: "BrowserWindow" }));

  await waitFor(() => !win.webContents.isLoading(), { label: "load complete", timeoutMs: 30000 });
  await sleep(1500);

  // 1) Default entry: leave me view, then only click sidebar 我 — no goSelfView.
  try {
    const state = await openPanoramaViaSidebarOnly(win);
    assert.equal(state.buildHidden, true, "inbox pending must not open build lane");
    assert.equal(state.overviewLabel, "全貌");
    assert.ok(state.journey >= 5, "five journey steps visible");
    pass("default entry is 数字之我 → 全貌 despite pending inbox");

    const forbidden = ["受限", "实验中", "不可用", "未知"];
    for (const word of forbidden) {
      const scrubbed = state.bodyText
        .replace(/尚无法确认/g, "")
        .replace(/尚未命名/g, "")
        .replace(/尚未开放/g, "")
        .replace(/尚未建立/g, "");
      const re = new RegExp(`(^|[^\\u4e00-\\u9fff])${word}([^\\u4e00-\\u9fff]|$)`);
      assert.equal(re.test(scrubbed), false, `forbidden maturity word: ${word}`);
    }
    pass("no legacy maturity labels on panorama home");

    assert.match(state.bodyText, /这是我/);
    assert.match(state.bodyText, /属于我/);
    assert.match(state.bodyText, /由我管/);
    assert.match(state.bodyText, /代表我协作/);
    assert.match(state.bodyText, /尚未开放/);
    pass("hero promises journey content visible");
  } catch (err) {
    fail("panorama default entry / content", err);
  }

  // 2) authorize has no executable buttons; collaborate may open PAN-01R local_sim CTA
  try {
    await openPanoramaViaSidebarOnly(win);
    const gate = await evalIn(
      win,
      `(() => {
        const journey = document.getElementById("panorama-journey");
        const promises = document.getElementById("panorama-promises");
        const items = [...(journey?.querySelectorAll(".panorama-journey-item") || [])];
        const authorize = items.find((li) => /授权我/.test(li.textContent || ""));
        const collab = items.find((li) => /代表我协作/.test(li.textContent || ""));
        const actPromise = [...(promises?.querySelectorAll(".panorama-promise-card") || [])].find((c) =>
          /代表我协作/.test(c.textContent || "")
        );
        const cta = document.getElementById("panorama-sovereign-cta");
        return {
          authorizeButtons: authorize ? authorize.querySelectorAll("button").length : -1,
          collabButtons: collab ? collab.querySelectorAll("button").length : -1,
          actPromiseButtons: actPromise ? actPromise.querySelectorAll("button").length : -1,
          collabText: (collab?.innerText || "") + "\\n" + (actPromise?.innerText || ""),
          ctaText: cta ? cta.textContent.trim() : "",
        };
      })()`
    );
    assert.equal(gate.authorizeButtons, 0);
    assert.ok(gate.collabButtons >= 1 || gate.actPromiseButtons >= 1 || gate.ctaText);
    assert.match(gate.collabText + gate.ctaText, /本地模拟|体验一次/);
    pass("授权我 closed; 代表我协作 exposes local_sim CTA");
  } catch (err) {
    fail("authorize/collaborate CTAs", err);
  }

  // 3) 继续构建 — real journey button only
  try {
    await openPanoramaViaSidebarOnly(win);
    await clickPanoramaButton(win, "#panorama-journey", "继续构建");
    const afterBuild = await waitFor(
      async () => {
        const s = await evalIn(
          win,
          `({ buildVisible: !document.getElementById("me-lane-build")?.classList.contains("hidden") })`
        );
        return s.buildVisible ? s : null;
      },
      { label: "build lane visible", timeoutMs: 8000 }
    );
    assert.equal(afterBuild.buildVisible, true);
    pass("继续构建 enters build lane");
  } catch (err) {
    fail("继续构建", err);
  }

  // 4) 查看能力
  try {
    await openPanoramaViaSidebarOnly(win);
    await clickPanoramaButton(win, "#panorama-journey", "查看能力");
    const caps = await waitFor(
      async () => {
        const s = await evalIn(
          win,
          `({ extVisible: !document.getElementById("view-extensions")?.classList.contains("hidden") })`
        );
        return s.extVisible ? s : null;
      },
      { label: "capabilities visible", timeoutMs: 8000 }
    );
    assert.equal(caps.extVisible, true);
    pass("查看能力 opens capabilities");
  } catch (err) {
    fail("查看能力", err);
  }

  // 5) 查看边界 — from promises card
  try {
    await openPanoramaViaSidebarOnly(win);
    await clickPanoramaButton(win, "#panorama-promises", "查看边界");
    const bounds = await waitFor(
      async () => {
        const s = await evalIn(
          win,
          `({
            selfVisible: !document.getElementById("me-lane-self")?.classList.contains("hidden"),
            boundariesActive: document.querySelector('#me-tabs .mode-tab[data-me-tab="boundaries"]')?.classList.contains("active"),
          })`
        );
        return s.selfVisible && s.boundariesActive ? s : null;
      },
      { label: "boundaries tab", timeoutMs: 8000 }
    );
    assert.equal(bounds.boundariesActive, true);
    pass("查看边界 opens boundaries tab");
  } catch (err) {
    fail("查看边界", err);
  }

  // 6) 查看资料版本 — real CTA, section focused/visible
  try {
    await openPanoramaViaSidebarOnly(win);
    await clickPanoramaButton(win, "#panorama-promises", "查看资料版本");
    const versions = await waitFor(
      async () => {
        const s = await evalIn(
          win,
          `(() => {
            const modal = document.getElementById("settings-modal");
            const section = document.getElementById("settings-pkg-versions");
            const heading = document.getElementById("settings-pkg-versions-heading");
            if (!modal || modal.classList.contains("hidden") || !section) return null;
            const body = modal.querySelector(".settings-modal-body");
            const rect = section.getBoundingClientRect();
            const bodyRect = body ? body.getBoundingClientRect() : null;
            const inView =
              !!bodyRect &&
              rect.top < bodyRect.bottom &&
              rect.bottom > bodyRect.top;
            const focused =
              section.getAttribute("data-panorama-focus") === "1" ||
              section.classList.contains("settings-section-focused") ||
              document.activeElement === section ||
              document.activeElement === heading;
            return {
              modalVisible: true,
              inView,
              focused,
              headingText: heading?.textContent?.trim() || "",
            };
          })()`
        );
        return s && s.modalVisible && s.inView && s.focused ? s : null;
      },
      { label: "package versions focused", timeoutMs: 10000 }
    );
    assert.equal(versions.headingText, "资料版本");
    await evalIn(
      win,
      `(() => {
        const modal = document.getElementById("settings-modal");
        if (modal) modal.classList.add("hidden");
        return true;
      })()`
    );
    pass("查看资料版本 opens settings and focuses 资料版本");
  } catch (err) {
    fail("查看资料版本", err);
  }

  // 7) refresh stays on 全貌
  try {
    await openPanoramaViaSidebarOnly(win);
    await evalIn(
      win,
      `(() => {
        const refresh = document.getElementById("btn-subject-refresh");
        if (!refresh) throw new Error("refresh button missing");
        refresh.click();
        return true;
      })()`
    );
    await sleep(600);
    const afterRefresh = await waitPanoramaHome(win);
    assert.equal(afterRefresh.buildHidden, true);
    pass("refresh stays on 全貌");
  } catch (err) {
    fail("refresh 全貌", err);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nPAN-01 owner-runtime: ${results.length - failed.length} passed, ${failed.length} failed`);
  if (failed.length) {
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
  setTimeout(() => {
    const { app } = require("electron");
    app.quit();
  }, 200);
}

module.exports = { runPan01OwnerRuntimeHarness };
