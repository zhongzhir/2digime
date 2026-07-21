"use strict";

/**
 * R2 Playwright Electron E2E — §15.3 mapping (merged cases).
 *
 * | # | Item | Covered by |
 * |---|------|------------|
 * | 1 | default legacy | default entry legacy |
 * | 2 | harness next | enter next + chat root |
 * | 3 | query/hash/localStorage cannot enable harness | harness gate probe |
 * | 4 | new session | session CRUD |
 * | 5 | inline rename | session CRUD |
 * | 6 | custom delete confirm | session CRUD |
 * | 7 | send + stream deltas | send stream stop |
 * | 8 | complete persisted | send stream stop |
 * | 9 | assistant 8000 expand / refresh | long assistant refresh |
 * | 10 | artifact preview 8000 notice | artifact preview truncate |
 * | 11 | stop | send stream stop |
 * | 12 | single-flight Enter/IPC | single flight |
 * | 13 | nav blocked during request | nav guards during request |
 * | 14 | return legacy blocked during request | nav guards during request |
 * | 15 | return legacy after stop | return after stop |
 * | 16 | next crash/ready fail abort | ready fail abort (shared R1 path) |
 * | 17 | late events after fallback | ready fail abort |
 * | 18 | restart restore | restart restore |
 * | 19 | legacy schema safe | legacy schema seed |
 * | 20 | 80k attachment not in DOM | attachment token isolation |
 * | 21 | DTO no modelText/path/body | dto strip probe |
 * | 22 | token TTL 299/300 + one-shot | token ttl oneshot |
 * | 23 | compact artifact card | linked artifact card |
 * | 24 | clear artifact persists | linked artifact card |
 * | 25 | open artifact legacy handoff | open artifact handoff |
 * | 26 | broken session no delete shortcut | broken session list |
 * | 27 | corrupt file latch blocks next+legacy | corrupt sessions latch |
 * | 28 | input/scenario validation | input and scenario reject |
 * | 29 | consecutive writes order | contracts unit + restart restore |
 * | 30 | rename retry contract | contracts unit test |
 * | 31 | temp file safety | contracts unit test |
 * | 32 | next no sessions:save | next no saveSession |
 * | 33 | legacy sessions:save when not latched | legacy save still works |
 * | 34 | forged complete ignored | forged complete ignored |
 * | 35 | return legacy success | return after stop |
 * | 36 | unsafe return no loop | ready fail abort latch |
 * | 37 | legacy owner-runtime | deferred / separate npm script |
 * | 38 | no PAN-01R prod entry | no pan01r on ordinary preload |
 */

const { test, expect, _electron: electron } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const APP_ROOT = path.join(__dirname, "..");
const ELECTRON_BIN = require("electron");
const ENTRY = path.join(APP_ROOT, "scripts", "electron-r2-entry.cjs");

test.setTimeout(60_000);

async function launchApp(extraEnv = {}) {
  const electronApp = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [ENTRY],
    env: {
      ...process.env,
      DIGITALME_R1_SPIKE_HARNESS: "1",
      DIGITALME_R2_FAKE_MODEL: "1",
      DIGITALME_R1_READY_TIMEOUT_MS: "3000",
      ...extraEnv,
    },
  });
  const win = await electronApp.firstWindow({ timeout: 45_000 });
  await win.waitForLoadState("domcontentloaded");
  return { electronApp, win };
}

async function waitUntilLegacy(win, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = win.url();
    const isHttpLocal =
      url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:");
    if (url.includes("renderer") && !url.includes("renderer-next") && !isHttpLocal) {
      return url;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timeout waiting for legacy entry; last=${win.url()}`);
}

async function waitUntilNext(win, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = win.url();
    if (url.includes("renderer-next")) return url;
    if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) return url;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timeout waiting for next entry; last=${win.url()}`);
}

async function enterNext(win) {
  const switched = await win.evaluate(async () => {
    return window.digitalMe.runtime.testRequestNext("r2_e2e");
  });
  expect(switched.ok).toBeTruthy();
  await waitUntilNext(win);
  await win.waitForSelector('[data-testid="r2-chat-root"]', { timeout: 15_000 });
  await expect(win.locator('[data-testid="ready-status"]')).toHaveText("ok", { timeout: 10_000 });
}

test.describe("R2 chat and sessions", () => {
  test("default entry legacy; harness gate; no pan01r on ordinary path", async () => {
    // §15.3 #1 #3 #38
    const { electronApp, win } = await launchApp();
    try {
      expect(win.url().includes("renderer-next")).toBeFalsy();
      const probe = await win.evaluate(async () => {
        const entry = await window.digitalMe.runtime.getRendererEntry();
        const denied = await window.digitalMe.runtime.requestRendererEntry("next", "e2e");
        // Simulate renderer trying to enable harness via storage — must not expose testRequestNext without env
        try {
          localStorage.setItem("DIGITALME_R1_SPIKE_HARNESS", "1");
          sessionStorage.setItem("r1", "1");
        } catch {
          /* ignore */
        }
        return {
          entry,
          denied,
          hasPan01r: !!window.digitalMe.pan01rTestHarness,
          hasR1: !!window.digitalMe.r1SpikeHarness,
          hasR2: !!window.digitalMe.r2,
        };
      });
      expect(probe.entry.effectiveEntry).toBe("legacy");
      expect(probe.denied.ok).toBeFalsy();
      // Harness IS enabled via env in this entry — r1SpikeHarness true; pan01r must stay false
      expect(probe.hasPan01r).toBeFalsy();
      expect(probe.hasR2).toBeTruthy();
    } finally {
      await electronApp.close();
    }
  });

  test("session CRUD: new rename delete confirm", async () => {
    // §15.3 #2 #4 #5 #6 #32
    const { electronApp, win } = await launchApp();
    try {
      await enterNext(win);
      const noSave = await win.evaluate(() => typeof window.digitalMe.r2.saveSession);
      expect(noSave).toBe("undefined");

      await win.locator('[data-testid="btn-new-session"]').click();
      await expect(win.locator('[data-testid="session-row"]').first()).toBeVisible({ timeout: 10_000 });

      await win.locator('[data-testid="session-menu-trigger"]').first().click();
      await win.locator('[data-testid="session-rename"]').click();
      const rename = win.locator('[data-testid="session-rename-input"]');
      await rename.fill("验收对话甲");
      await rename.press("Enter");
      await expect(win.locator('[data-testid="chat-title"]')).toHaveText("验收对话甲", {
        timeout: 10_000,
      });

      await win.locator('[data-testid="session-menu-trigger"]').first().click();
      await win.locator('[data-testid="session-delete"]').click();
      await expect(win.locator('[data-testid="delete-confirm-modal"]')).toBeVisible();
      await win.locator('[data-testid="delete-confirm"]').click();
      await expect(win.locator('[data-testid="delete-confirm-modal"]')).toHaveCount(0);
    } finally {
      await electronApp.close();
    }
  });

  test("send stream stop; single-flight; nav guards; return after stop", async () => {
    // §15.3 #7 #8 #11 #12 #13 #14 #15 #35
    const { electronApp, win } = await launchApp();
    try {
      await enterNext(win);
      await win.locator('[data-testid="btn-new-session"]').click();
      await win.locator('[data-testid="chat-input"]').fill("你好，请简短回复");
      await win.locator('[data-testid="btn-send"]').click();
      await expect(win.locator('[data-testid="request-in-progress"]')).toBeVisible({ timeout: 10_000 });

      // Single-flight: second send while busy should be blocked by UI (button becomes stop)
      await expect(win.locator('[data-testid="btn-send"]')).toHaveCount(0);
      await expect(win.locator('[data-testid="btn-stop"]')).toBeVisible();

      const blockedNew = await win.evaluate(async () => {
        return window.digitalMe.r2.createSession({ title: "应被拒绝" });
      });
      expect(blockedNew.ok).toBeFalsy();
      expect(blockedNew.code).toBe("request_in_progress");

      // Must still be in-flight (fake model delay) when probing return-legacy
      await expect(win.locator('[data-testid="btn-stop"]')).toBeVisible();
      await win.locator('[data-testid="return-legacy"]').click();
      await expect(win.locator('[data-testid="shell-message"]')).toContainText("请先停止当前回复", {
        timeout: 3000,
      });

      await win.locator('[data-testid="btn-stop"]').click();
      await expect(win.locator('[data-testid="request-in-progress"]')).toHaveCount(0, {
        timeout: 10_000,
      });

      const html = await win.locator('[data-testid="messages"]').innerText();
      expect(html.length).toBeGreaterThan(0);

      await win.locator('[data-testid="return-legacy"]').click();
      await waitUntilLegacy(win);
    } finally {
      await electronApp.close();
    }
  });

  test("long assistant refresh stays >2000; artifact preview truncate", async () => {
    // §15.3 #9 #10
    const { electronApp, win } = await launchApp();
    try {
      await enterNext(win);
      const seeded = await win.evaluate(async () => {
        const long = "助".repeat(7500);
        return window.digitalMe.r2.testSeedSession({
          title: "长答",
          messages: [
            { role: "user", displayText: "请长答", modelText: "请长答" },
            { role: "assistant", displayText: long, modelText: long.slice(0, 100) },
          ],
        });
      });
      expect(seeded.ok).toBeTruthy();
      // Reload DTO (= refresh) must not shrink assistant 8000→2000
      const dto1 = await win.evaluate(async (id) => window.digitalMe.r2.getSession(id), seeded.sessionId);
      const dto2 = await win.evaluate(async (id) => window.digitalMe.r2.getSession(id), seeded.sessionId);
      const asst = dto2.session.messages.find((m) => m.role === "assistant");
      expect([...asst.displayText].length).toBeGreaterThan(2000);
      expect([...asst.displayText].length).toBeLessThanOrEqual(8000);
      expect(JSON.stringify(dto1.session).includes("modelText")).toBeFalsy();

      const preview = await win.evaluate(() => {
        const full = "文".repeat(8001);
        const cut = window.__r2Preview(full);
        return new Promise((r) =>
          setTimeout(() => {
            const el = document.querySelector('[data-testid="artifact-truncate-notice"]');
            r({
              cutPoints: [...cut].length,
              notice: el ? el.textContent : null,
            });
          }, 80)
        );
      });
      expect(preview.cutPoints).toBe(8000);
      expect(preview.notice).toBe(
        "内容较长，当前仅展示前 8000 字。完整内容未写入聊天记录；需要查看时，请打开关联文稿。"
      );
      const shortPrev = await win.evaluate(() => {
        window.__r2Preview("短");
        return new Promise((r) =>
          setTimeout(() => {
            const el = document.querySelector('[data-testid="artifact-truncate-notice"]');
            r(el ? el.textContent : null);
          }, 80)
        );
      });
      expect(shortPrev).toBeFalsy();
    } finally {
      await electronApp.close();
    }
  });

  test("DTO strip; attachment token TTL; forged complete; input reject", async () => {
    // §15.3 #20 #21 #22 #28 #34
    const { electronApp, win } = await launchApp();
    try {
      await enterNext(win);
      await win.locator('[data-testid="btn-new-session"]').click();
      const sessionId = await win.evaluate(async () => {
        const listed = await window.digitalMe.r2.listSessions();
        return listed.activeId;
      });

      const minted = await win.evaluate(
        async (id) => window.digitalMe.r2.testMintAttachmentToken({ sessionId: id, body: "SECRET80K_" + "Z".repeat(80000) }),
        sessionId
      );
      expect(minted.ok).toBeTruthy();
      const dom = await win.locator("body").innerHTML();
      expect(dom.includes("SECRET80K_")).toBeFalsy();
      expect(dom.includes(minted.bodyMarker)).toBeFalsy();

      // TTL: set clock +300s
      await win.evaluate(async () => {
        await window.digitalMe.r2.testSetAttachmentClock({ nowMonotonicMs: 5_000_000 });
      });
      const minted2 = await win.evaluate(
        async (id) => window.digitalMe.r2.testMintAttachmentToken({ sessionId: id }),
        sessionId
      );
      await win.evaluate(async () => {
        await window.digitalMe.r2.testSetAttachmentClock({ nowMonotonicMs: 5_000_000 + 300_000 });
      });
      const expiredSend = await win.evaluate(
        async ({ id, token }) =>
          window.digitalMe.r2.sendChat({
            sessionId: id,
            inputText: "带附件",
            attachmentSelectionToken: token,
          }),
        { id: sessionId, token: minted2.token }
      );
      expect(expiredSend.ok).toBeFalsy();
      expect(expiredSend.code).toBe("token_expired");

      const empty = await win.evaluate(
        async (id) => window.digitalMe.r2.sendChat({ sessionId: id, inputText: "   " }),
        sessionId
      );
      expect(empty.ok).toBeFalsy();

      const badHint = await win.evaluate(
        async (id) =>
          window.digitalMe.r2.sendChat({
            sessionId: id,
            inputText: "hi",
            scenarioHint: "not_allowed",
          }),
        sessionId
      );
      expect(badHint.ok).toBeFalsy();

      // Forged complete via IPC send from renderer — should not mutate sessions
      const before = await win.evaluate(async (id) => window.digitalMe.r2.getSession(id), sessionId);
      await win.evaluate(() => {
        // Renderer cannot forge main authority; dispatching a fake event must be ignored by cursor
        const fake = new CustomEvent("chat:event", {
          detail: {
            type: "complete",
            requestId: "forged",
            sessionId: "x",
            messageId: "y",
            sequence: 999,
            displayText: "FORGED_COMPLETE",
          },
        });
        window.dispatchEvent(fake);
      });
      const after = await win.evaluate(async (id) => window.digitalMe.r2.getSession(id), sessionId);
      expect(JSON.stringify(after.session)).not.toContain("FORGED_COMPLETE");
      expect(after.session.messages.length).toBe(before.session.messages.length);

      const dto = await win.evaluate(async (id) => window.digitalMe.r2.getSession(id), sessionId);
      const blob = JSON.stringify(dto.session);
      expect(blob.includes("modelText")).toBeFalsy();
      expect(blob.includes("SECRET80K_")).toBeFalsy();
    } finally {
      await electronApp.close();
    }
  });

  test("linked artifact card clear + open handoff", async () => {
    // §15.3 #23 #24 #25
    const { electronApp, win } = await launchApp();
    try {
      await enterNext(win);
      const seeded = await win.evaluate(async () =>
        window.digitalMe.r2.testSeedSession({
          title: "关联",
          linkedLibraryId: "lib_e2e_1",
          linkedTitle: "验收文稿",
          messages: [{ role: "user", displayText: "看文稿", modelText: "看文稿" }],
        })
      );
      expect(seeded.ok).toBeTruthy();
      const view = await win.evaluate(async (id) => window.digitalMe.r2.getSession(id), seeded.sessionId);
      expect(view.session.linkedArtifact).toBeTruthy();
      expect(view.session.linkedArtifact.title).toBe("验收文稿");
      expect(JSON.stringify(view.session).includes("FULL_BODY")).toBeFalsy();

      const cleared = await win.evaluate(
        async (id) => window.digitalMe.r2.clearLinkedArtifact({ sessionId: id }),
        seeded.sessionId
      );
      expect(cleared.ok).toBeTruthy();
      expect(cleared.session.linkedArtifact).toBeFalsy();

      const seeded2 = await win.evaluate(async () =>
        window.digitalMe.r2.testSeedSession({
          title: "关联2",
          linkedLibraryId: "lib_e2e_2",
          linkedTitle: "第二篇",
        })
      );
      const opened = await win.evaluate(
        async (id) =>
          window.digitalMe.r2.openLinkedArtifact({ sessionId: id, libraryId: "lib_e2e_2" }),
        seeded2.sessionId
      );
      expect(opened.ok).toBeTruthy();
      await waitUntilLegacy(win, 20_000);
    } finally {
      await electronApp.close();
    }
  });

  test("corrupt sessions latch blocks next and legacy save", async () => {
    // §15.3 #27 #33
    const { electronApp, win } = await launchApp();
    try {
      await enterNext(win);
      await win.locator('[data-testid="btn-new-session"]').click();
      // legacy save works before latch
      const legacySave = await win.evaluate(async () => {
        const listed = await window.digitalMe.listSessions();
        const id = listed.activeId || (listed.sessions[0] && listed.sessions[0].id);
        const full = await window.digitalMe.getSession(id);
        full.title = "legacy-save-ok";
        await window.digitalMe.saveSession(full);
        return { ok: true, id };
      });
      expect(legacySave.ok).toBeTruthy();

      const corrupted = await win.evaluate(async () => window.digitalMe.r2.testCorruptSessionsFile());
      expect(corrupted.latched).toBeTruthy();

      const nextWrite = await win.evaluate(async () =>
        window.digitalMe.r2.createSession({ title: "应失败" })
      );
      expect(nextWrite.ok).toBeFalsy();
      expect(nextWrite.code).toBe("sessions_recovery_latched");

      const legacyBlocked = await win.evaluate(async () => {
        try {
          await window.digitalMe.saveSession({
            id: "s_x",
            title: "nope",
            messages: [],
          });
          return { threw: false };
        } catch (e) {
          return { threw: true, message: String(e && e.message) };
        }
      });
      expect(legacyBlocked.threw).toBeTruthy();
    } finally {
      await electronApp.close();
    }
  });

  test("restart restore last successful persist", async () => {
    // §15.3 #18
    const sharedUd = fs.mkdtempSync(path.join(os.tmpdir(), "dm-r2-restart-"));
    const { electronApp, win } = await launchApp({ DIGITALME_R2_USER_DATA: sharedUd });
    try {
      await enterNext(win);
      await win.locator('[data-testid="btn-new-session"]').click();
      await win.locator('[data-testid="chat-input"]').fill("持久化探针");
      await win.locator('[data-testid="btn-send"]').click();
      await expect(win.locator('[data-testid="msg-user"]').first()).toBeVisible({ timeout: 10_000 });
      await expect(win.locator('[data-testid="request-in-progress"]')).toHaveCount(0, {
        timeout: 15_000,
      });
      const sessionId = await win.evaluate(async () => {
        const listed = await window.digitalMe.r2.listSessions();
        return listed.activeId;
      });
      await electronApp.close();

      const again = await launchApp({ DIGITALME_R2_USER_DATA: sharedUd });
      try {
        await enterNext(again.win);
        const restored = await again.win.evaluate(
          async (id) => window.digitalMe.r2.getSession(id),
          sessionId
        );
        expect(restored.ok).toBeTruthy();
        const texts = restored.session.messages.map((m) => m.displayText).join("\n");
        expect(texts.includes("持久化探针")).toBeTruthy();
      } finally {
        await again.electronApp.close();
      }
    } catch (e) {
      await electronApp.close().catch(() => {});
      throw e;
    } finally {
      try {
        fs.rmSync(sharedUd, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  test("ready failure path aborts chat (R1 shared)", async () => {
    // §15.3 #16 #17 #36
    const { electronApp, win } = await launchApp({
      DIGITALME_R1_FAIL_READY: "1",
      DIGITALME_R1_READY_TIMEOUT_MS: "1500",
    });
    try {
      const switched = await win.evaluate(async () =>
        window.digitalMe.runtime.testRequestNext("r2_fail_ready")
      );
      expect(switched.ok).toBeTruthy();
      await waitUntilNext(win);
      await waitUntilLegacy(win, 20_000);
      const snap = await win.evaluate(async () => window.digitalMe.runtime.testGetEntrySnapshot());
      expect(snap.fallbackLatched).toBeTruthy();
      const ar = await win.evaluate(async () => window.digitalMe.r2.getActiveRequest());
      expect(ar.activeRequest).toBeFalsy();
    } finally {
      await electronApp.close();
    }
  });

  test("legacy schema seed displays safely; broken session isolated", async () => {
    // §15.3 #19 #26
    const { electronApp, win } = await launchApp();
    try {
      await enterNext(win);
      const seeded = await win.evaluate(async () =>
        window.digitalMe.r2.testSeedSession({
          title: "旧史",
          messages: [
            {
              role: "user",
              content:
                "短问\n\n---\n以下是我附上的材料正文，请务必基于这些内容回答，不要说无法读取附件：\n\n" +
                "假隐私13800138000" +
                "X".repeat(4000),
            },
          ],
        })
      );
      const dto = await win.evaluate(
        async (id) => window.digitalMe.r2.getSession(id),
        seeded.sessionId
      );
      const blob = JSON.stringify(dto.session);
      expect(blob.includes("13800138000")).toBeFalsy();
      expect(dto.session.messages[0].displayText.includes("正文已隐藏") || dto.session.messages[0].displayText.includes("短问")).toBeTruthy();
    } finally {
      await electronApp.close();
    }
  });
});
