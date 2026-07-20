"use strict";

/**
 * Session overflow menu controller + wiring smoke tests (hermetic, no Electron).
 * Behavioral Electron coverage lives in pan-01-owner-runtime-harness.
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  createSessionOverflowMenuController,
  normalizeSessionTitle,
  SESSION_TITLE_MAX,
} = require("../src/session-overflow-menu.js");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, err && err.stack ? err.stack : err);
  }
}

function mockEl(id) {
  const children = [];
  const el = {
    id,
    classList: {
      _set: new Set(["hidden"]),
      add(c) {
        this._set.add(c);
      },
      remove(c) {
        this._set.delete(c);
      },
      contains(c) {
        return this._set.has(c);
      },
    },
    attrs: { "aria-expanded": "false" },
    style: {},
    offsetWidth: 120,
    getBoundingClientRect() {
      return { top: 10, bottom: 40, left: 100, right: 128, width: 28, height: 30 };
    },
    contains(node) {
      return node === el || children.includes(node);
    },
    setAttribute(k, v) {
      this.attrs[k] = String(v);
    },
    getAttribute(k) {
      return this.attrs[k];
    },
    _children: children,
  };
  return el;
}

test("overflow controller: toggle open/close + aria-expanded", () => {
  const ctl = createSessionOverflowMenuController();
  const btn = mockEl("more");
  const menu = mockEl("menu");
  assert.equal(ctl.isOpen(), false);
  ctl.toggle(btn, menu, "s1");
  assert.equal(ctl.isOpen(), true);
  assert.equal(ctl.openSessionId(), "s1");
  assert.equal(btn.getAttribute("aria-expanded"), "true");
  assert.equal(menu.classList.contains("hidden"), false);
  ctl.toggle(btn, menu, "s1");
  assert.equal(ctl.isOpen(), false);
  assert.equal(btn.getAttribute("aria-expanded"), "false");
  assert.equal(menu.classList.contains("hidden"), true);
});

test("overflow controller: opening another closes previous", () => {
  const ctl = createSessionOverflowMenuController();
  const b1 = mockEl("b1");
  const m1 = mockEl("m1");
  const b2 = mockEl("b2");
  const m2 = mockEl("m2");
  ctl.open(b1, m1, "a");
  ctl.open(b2, m2, "b");
  assert.equal(ctl.openSessionId(), "b");
  assert.equal(m1.classList.contains("hidden"), true);
  assert.equal(b1.getAttribute("aria-expanded"), "false");
  assert.equal(m2.classList.contains("hidden"), false);
});

test("overflow controller: outside pointer + Escape close", () => {
  const ctl = createSessionOverflowMenuController();
  const btn = mockEl("more");
  const menu = mockEl("menu");
  const outside = mockEl("out");
  ctl.open(btn, menu, "s1");
  ctl.handleDocumentPointerDown(outside);
  assert.equal(ctl.isOpen(), false);
  ctl.open(btn, menu, "s1");
  ctl.handleKeydown({ key: "Escape" });
  assert.equal(ctl.isOpen(), false);
});

test("overflow controller: click inside menu does not close", () => {
  const ctl = createSessionOverflowMenuController();
  const btn = mockEl("more");
  const menu = mockEl("menu");
  const item = mockEl("item");
  menu._children.push(item);
  ctl.open(btn, menu, "s1");
  ctl.handleDocumentPointerDown(item);
  assert.equal(ctl.isOpen(), true);
});

test("normalizeSessionTitle: trim, empty reject, max length", () => {
  assert.equal(SESSION_TITLE_MAX, 60);
  assert.equal(normalizeSessionTitle("  hello  ").ok, true);
  assert.equal(normalizeSessionTitle("  hello  ").title, "hello");
  assert.equal(normalizeSessionTitle("   ").ok, false);
  assert.match(normalizeSessionTitle("").error, /请输入名称/);
  const long = "字".repeat(80);
  const n = normalizeSessionTitle(long);
  assert.equal(n.ok, true);
  assert.equal(n.title.length, 60);
});

test("overflow onClose fires when menu closes", () => {
  let closed = 0;
  const ctl = createSessionOverflowMenuController({
    onClose() {
      closed += 1;
    },
  });
  const btn = mockEl("more");
  const menu = mockEl("menu");
  ctl.open(btn, menu, "s1");
  ctl.close();
  assert.equal(closed, 1);
  ctl.handleKeydown({ key: "Escape" });
  assert.equal(closed, 1);
});

test("app.js: session list uses overflow menu, not resident 改名/删除", () => {
  const appJs = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "app.js"),
    "utf8"
  );
  assert.match(appJs, /session-overflow-btn/);
  assert.match(appJs, /更多会话操作/);
  assert.match(appJs, /aria-expanded/);
  assert.match(appJs, /sessionOverflow\.toggle/);
  assert.match(appJs, /closeSessionOverflowMenus/);
  assert.doesNotMatch(appJs, /\.s-actions/);
  const refreshIdx = appJs.indexOf("async function refreshSessionList");
  assert.ok(refreshIdx > 0);
  const region = appJs.slice(refreshIdx, refreshIdx + 12000);
  assert.match(region, /session-overflow-menu/);
  assert.match(region, /textContent = "改名"/);
  assert.match(region, /textContent = "删除"/);
  assert.match(region, /guardChatSessionNavigation\(\)/);
  assert.match(region, /beginSessionInlineRename/);
  assert.match(region, /showSessionDeleteConfirm/);
  assert.match(region, /session-rename-input/);
  assert.match(region, /确定删除这段对话/);
  // Session menu path must not use native dialogs
  assert.doesNotMatch(region, /\bprompt\s*\(/);
  assert.doesNotMatch(region, /\bconfirm\s*\(/);
  assert.doesNotMatch(region, /\balert\s*\(/);
  // 改名/删除 live under menu items, not as always-visible s-actions
  assert.doesNotMatch(region, /className = "s-actions"/);
  // Overflow click must not call setActiveSession
  const moreClickIdx = region.indexOf("sessionOverflow.toggle");
  assert.ok(moreClickIdx > 0);
  const moreHandler = region.slice(moreClickIdx - 200, moreClickIdx + 120);
  assert.doesNotMatch(moreHandler, /setActiveSession/);
});

test("app.js session menu path has zero prompt/confirm/alert", () => {
  const appJs = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "app.js"),
    "utf8"
  );
  const start = appJs.indexOf("async function refreshSessionList");
  const end = appJs.indexOf("async function persistCurrentSession");
  assert.ok(start > 0 && end > start);
  const sessionUi = appJs.slice(start, end);
  assert.doesNotMatch(sessionUi, /\bprompt\s*\(/);
  assert.doesNotMatch(sessionUi, /\bconfirm\s*\(/);
  assert.doesNotMatch(sessionUi, /\balert\s*\(/);
  assert.match(sessionUi, /beginSessionInlineRename/);
  assert.match(sessionUi, /showSessionDeleteConfirm/);
});

test("index.html loads session-overflow-menu.js before app.js", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "index.html"),
    "utf8"
  );
  const overflowIdx = html.indexOf("session-overflow-menu.js");
  const appIdx = html.indexOf('src="app.js"');
  assert.ok(overflowIdx > 0 && appIdx > overflowIdx);
});

test("app.js: me-build secondary id + navigatePanoramaTarget(goBuildView)", () => {
  const appJs = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "app.js"),
    "utf8"
  );
  assert.match(appJs, /subject-minimal-continue-build/);
  assert.match(appJs, /listMinimalSecondaryActions/);
  const goIdx = appJs.indexOf("function goBuildView");
  assert.ok(goIdx > 0);
  const goRegion = appJs.slice(goIdx, goIdx + 350);
  assert.match(goRegion, /meLane:\s*"build"|switchMeLane\("build"\)/);
  const navIdx = appJs.indexOf("function navigatePanoramaTarget");
  const navRegion = appJs.slice(navIdx, navIdx + 500);
  assert.match(navRegion, /me-build/);
  assert.match(navRegion, /goBuildView\(\)/);
  assert.doesNotMatch(appJs, /panorama-sovereign-cta/);
});

console.log(`\nsession-overflow + build-access smoke: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
