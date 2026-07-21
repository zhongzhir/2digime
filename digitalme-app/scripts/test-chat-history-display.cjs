"use strict";

/**
 * Chat history display / spillover hermetic tests (temp userData only).
 * Run: npm run test:chat-history-display
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const sessions = require("../src/sessions");
const cm = require("../src/chat-message-model");

let passed = 0;
let failed = 0;
const pending = [];

function test(name, fn) {
  pending.push(
    Promise.resolve()
      .then(() => fn())
      .then(() => {
        passed += 1;
        console.log("PASS", name);
      })
      .catch((err) => {
        failed += 1;
        console.error("FAIL", name, err && err.stack ? err.stack : err);
      })
  );
}

function tempUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dm-chat-hist-"));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

const FAKE_PHONE = "13800138000";
const FAKE_EMAIL = "resume-test@example.com";
const FAKE_RESUME_BODY =
  "假履历正文：张三，手机 " +
  FAKE_PHONE +
  "，邮箱 " +
  FAKE_EMAIL +
  "。" +
  "工作经历：".padEnd(3500, "X");
const FAKE_ABS_PATH = "D:\\Secrets\\个人简历-完整版.pdf";

test("1. new user message fields: display/model/refs; requestContent separate", () => {
  const names = ["简历摘要.txt"];
  const displayText = cm.buildUserDisplayText("请总结这份材料", names);
  const modelText = cm.buildUserModelText("请总结这份材料", names);
  const refs = cm.buildAttachmentRefs([
    { name: "简历摘要.txt", id: "att1", type: "text/plain", size: 12, path: FAKE_ABS_PATH },
  ]);
  const requestContent = "### 附件：简历摘要.txt\n" + FAKE_RESUME_BODY;

  assert.ok(!displayText.includes(FAKE_RESUME_BODY.slice(0, 40)));
  assert.ok(!displayText.includes(FAKE_PHONE));
  assert.ok(displayText.includes("请总结这份材料"));
  assert.ok(displayText.includes("已附上：简历摘要.txt"));
  assert.ok(!modelText.includes(FAKE_RESUME_BODY.slice(0, 40)));
  assert.ok(!modelText.includes(FAKE_PHONE));
  assert.ok(modelText.length <= cm.MODEL_TEXT_MAX + 40);
  assert.equal(refs[0].name, "简历摘要.txt");
  assert.equal(refs[0].path, undefined);
  assert.ok(requestContent.includes(FAKE_RESUME_BODY.slice(0, 40)));
  const persisted = cm.toPersistableMessage({
    role: "user",
    displayText,
    modelText,
    attachmentRefs: refs,
  });
  const blob = JSON.stringify(persisted);
  assert.ok(!blob.includes(FAKE_RESUME_BODY.slice(0, 40)));
  assert.ok(!blob.includes(FAKE_ABS_PATH));
});

test("2. persist session JSON has no attachment body; reload shows short bubble", async () => {
  const ud = tempUserData();
  try {
    const s = await sessions.createSession(ud, { title: "测" });
    const displayText = cm.buildUserDisplayText("请总结", ["材料A.txt"]);
    const modelText = cm.buildUserModelText("请总结", ["材料A.txt"]);
    s.messages = [
      cm.toPersistableMessage({
        role: "user",
        displayText,
        modelText,
        attachmentRefs: [{ id: "a1", name: "材料A.txt" }],
      }),
    ];
    await sessions.saveSession(ud, s);
    const raw = fs.readFileSync(sessions.sessionsPath(ud), "utf8");
    assert.ok(!raw.includes(FAKE_RESUME_BODY.slice(0, 30)));
    assert.ok(!raw.includes("以下是我附上的材料正文"));
    const loaded = sessions.getSession(ud, s.id);
    const n = cm.normalizeLoadedMessage(loaded.messages[0]);
    assert.equal(n.displayText.includes("请总结"), true);
    assert.ok(!n.displayText.includes(FAKE_PHONE));
    const shown = cm.legacyDisplayText(n);
    assert.ok(shown.text.includes("请总结") || shown.text.includes("已附上"));
  } finally {
    cleanup(ud);
  }
});

test("3. legacy user without displayText: no 4000-char dump / no PII", () => {
  const legacy = {
    role: "user",
    content:
      "帮我改简历\n\n---\n以下是我附上的材料正文，请务必基于这些内容回答，不要说无法读取附件：\n\n" +
      FAKE_RESUME_BODY,
  };
  const shown = cm.legacyDisplayText(legacy);
  assert.ok(!shown.text.includes(FAKE_PHONE));
  assert.ok(!shown.text.includes(FAKE_EMAIL));
  assert.ok(!shown.text.includes("假履历正文"));
  assert.ok(!shown.text.includes("XXXX"));
  assert.ok(shown.text.includes("材料正文已隐藏") || shown.text.includes("正文已隐藏"));
  assert.equal(shown.forbidExpand, true);
  assert.ok(shown.text.length < 600);

  const opaque = {
    role: "user",
    content: ("长材料" + FAKE_PHONE + FAKE_EMAIL).padEnd(5000, "Y"),
  };
  const shown2 = cm.legacyDisplayText(opaque);
  assert.ok(!shown2.text.includes(FAKE_PHONE));
  assert.ok(!shown2.text.includes("YYYY"));
  assert.ok(shown2.text.includes("正文已隐藏"));
});

test("4. assistant long message fold plan", () => {
  const long = "助手长回复：".padEnd(5000, "A");
  const plan = cm.foldPlan(long, { forbidExpand: false });
  assert.equal(plan.needsFold, true);
  assert.ok(plan.preview.length < long.length);
  assert.ok(plan.expanded.length <= cm.FOLD_EXPAND_MAX + 40);
  const forbidden = cm.foldPlan("用户隐藏材料说明", { forbidExpand: true });
  assert.equal(forbidden.needsFold, false);
  assert.equal(forbidden.forbidExpand, true);
});

test("5. concurrency helpers: single flight + gateway history strip", () => {
  let active = null;
  function tryStart(id) {
    if (active) return false;
    active = { requestId: id };
    return true;
  }
  function finish(id) {
    if (active && active.requestId === id) active = null;
  }
  assert.equal(tryStart("r1"), true);
  assert.equal(tryStart("r2"), false);
  finish("r2");
  assert.ok(active);
  finish("r1");
  assert.equal(active, null);

  const hist = [
    {
      role: "user",
      displayText: "短问",
      modelText: "短问",
      attachmentRefs: [{ id: "1", name: "a.txt" }],
      extraDom: { node: true },
    },
  ];
  const gw = cm.toModelGatewayHistory(hist);
  assert.deepEqual(gw, [{ role: "user", content: "短问" }]);
  assert.equal(gw[0].displayText, undefined);
  assert.equal(gw[0].attachmentRefs, undefined);
});

test("6. corrupt history normalize skips bad rows; createSession still works", async () => {
  const ud = tempUserData();
  try {
    const rows = [null, { role: "tool" }, { role: "user", content: "hi" }, "bad"];
    const out = [];
    for (const r of rows) {
      const n = cm.normalizeLoadedMessage(r);
      if (n) out.push(n);
    }
    assert.equal(out.length, 1);
    assert.equal(out[0].role, "user");
    const s = await sessions.createSession(ud, { title: "恢复" });
    assert.ok(s.id);
    assert.equal(Array.isArray(s.messages), true);
  } finally {
    cleanup(ud);
  }
});

test("7. listSessions preview uses safe text not attachment body", async () => {
  const ud = tempUserData();
  try {
    const s = await sessions.createSession(ud, { title: "预览" });
    s.messages = [
      {
        role: "user",
        content:
          "短问题\n\n---\n以下是我附上的材料正文，请务必基于这些内容回答，不要说无法读取附件：\n\n" +
          FAKE_RESUME_BODY,
      },
    ];
    // Save via raw store write to simulate legacy disk (bypass toPersistable on purpose)
    const store = sessions.loadStore(ud);
    const i = store.sessions.findIndex((x) => x.id === s.id);
    store.sessions[i] = s;
    fs.writeFileSync(sessions.sessionsPath(ud), JSON.stringify(store, null, 2), "utf8");

    const listed = sessions.listSessions(ud);
    const row = listed.sessions.find((x) => x.id === s.id);
    assert.ok(row);
    assert.ok(!String(row.preview).includes(FAKE_PHONE));
    assert.ok(!String(row.preview).includes("假履历"));
    assert.ok(!String(row.preview).includes("XXXX"));
  } finally {
    cleanup(ud);
  }
});

test("8. untrusted legacy display with fake phone/email/4000-char body must not render", () => {
  const kimiDisplay =
    "请帮我润色简历\n［附件：简历.pdf］\n" + FAKE_RESUME_BODY.slice(0, 4000);
  assert.ok(kimiDisplay.length >= 3500);

  const msg = {
    role: "user",
    // No schemaVersion / displayText — only KIMI experiment field
    display: kimiDisplay,
    content:
      "请帮我润色简历\n\n---\n以下是我附上的材料正文，请务必基于这些内容回答，不要说无法读取附件：\n\n" +
      FAKE_RESUME_BODY,
  };
  const shown = cm.legacyDisplayText(msg);
  assert.ok(!shown.text.includes(FAKE_PHONE), "must not show phone from display");
  assert.ok(!shown.text.includes(FAKE_EMAIL), "must not show email from display");
  assert.ok(!shown.text.includes("假履历正文"), "must not show resume body");
  assert.ok(!shown.text.includes("XXXX"));
  assert.ok(shown.text.includes("请帮我润色简历") || shown.text.includes("正文已隐藏"));
  assert.equal(shown.forbidExpand, true);
  assert.notEqual(shown.source, "display");

  const displayOnly = {
    role: "user",
    display: ("无分隔长文" + FAKE_PHONE + FAKE_EMAIL).padEnd(4000, "Z"),
  };
  const shown2 = cm.legacyDisplayText(displayOnly);
  assert.ok(!shown2.text.includes(FAKE_PHONE));
  assert.ok(!shown2.text.includes(FAKE_EMAIL));
  assert.ok(!shown2.text.includes("ZZZZ"));
  assert.ok(shown2.text.includes("正文已隐藏"));
  assert.equal(shown2.forbidExpand, true);

  const normalized = cm.normalizeLoadedMessage(msg);
  assert.ok(normalized);
  assert.ok(!normalized.displayText.includes(FAKE_PHONE));
  const fold = cm.foldPlan(normalized.displayText, { forbidExpand: true });
  assert.equal(fold.forbidExpand, true);
  assert.equal(fold.needsFold, false);
  assert.equal(fold.expanded, fold.preview);
});

test("9. sessionNavGuard blocks switch/new/delete while request active", () => {
  const idle = cm.sessionNavGuard(null);
  assert.equal(idle.allowed, true);
  assert.equal(cm.sessionNavGuard({}).allowed, true);

  const busy = cm.sessionNavGuard({
    requestId: "req_abc",
    originSessionId: "s1",
    originMessageId: "m1",
    bubbleEl: null,
  });
  assert.equal(busy.allowed, false);
  assert.equal(busy.message, cm.SESSION_NAV_BLOCK_MESSAGE);
  assert.match(busy.message, /请先停止当前回复/);
});

test("10. app.js wires sessionNavGuard into new/switch/delete handlers", () => {
  const appJs = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "app.js"),
    "utf8"
  );
  assert.match(appJs, /function guardChatSessionNavigation\s*\(/);
  assert.match(appJs, /sessionNavGuard\(activeChatRequest\)/);
  assert.match(appJs, /请先停止当前回复，再切换对话/);

  const newIdx = appJs.indexOf('$("btn-new-session")');
  assert.ok(newIdx > 0);
  const newRegion = appJs.slice(newIdx, newIdx + 500);
  assert.match(newRegion, /guardChatSessionNavigation\(\)/);

  const delIdx = appJs.indexOf('del.textContent = "删除"');
  assert.ok(delIdx > 0);
  const delRegion = appJs.slice(delIdx, delIdx + 450);
  assert.match(delRegion, /guardChatSessionNavigation\(\)/);

  // Session switch click handler (setActiveSession path)
  const switchIdx = appJs.indexOf("setActiveSession(s.id)");
  assert.ok(switchIdx > 0);
  const switchRegion = appJs.slice(Math.max(0, switchIdx - 350), switchIdx);
  assert.match(switchRegion, /guardChatSessionNavigation\(\)/);
  // Switch is on session-item-main, not overflow
  assert.match(appJs, /session-item-main/);
  assert.match(appJs, /session-overflow-btn/);

  // Stop remains available without nav guard (bindChatCoreControls handler)
  const stopBindIdx = appJs.indexOf('$("btn-stop")?.addEventListener');
  assert.ok(stopBindIdx > 0, "btn-stop listener must exist");
  const stopRegion = appJs.slice(stopBindIdx, stopBindIdx + 350);
  assert.doesNotMatch(stopRegion, /guardChatSessionNavigation/);
  assert.match(stopRegion, /digitalMe\.stopChat|stopChat\(/);

  // Clear linked draft must persist (via clearLinkedArtifactAssociation)
  const clearIdx = appJs.indexOf('$("btn-clear-linked-draft")?.addEventListener');
  assert.ok(clearIdx > 0, "clear-linked-draft listener must exist");
  const clearRegion = appJs.slice(clearIdx, clearIdx + 400);
  assert.match(clearRegion, /clearLinkedArtifactAssociation\(\)/);
  assert.match(appJs, /async function clearLinkedArtifactAssociation/);
  const clearFnIdx = appJs.indexOf("async function clearLinkedArtifactAssociation");
  const clearFnRegion = appJs.slice(clearFnIdx, clearFnIdx + 550);
  assert.match(clearFnRegion, /persistCurrentSession\(\)/);
  assert.match(clearFnRegion, /保存失败/);
  assert.match(clearFnRegion, /currentSession\.artifacts = \[\]/);

  // renderArtifact must not write artifact.content into chat DOM
  const renderIdx = appJs.indexOf("function renderArtifact()");
  assert.ok(renderIdx > 0);
  const renderRegion = appJs.slice(renderIdx, renderIdx + 1200);
  assert.doesNotMatch(renderRegion, /contentEl\.textContent\s*=\s*currentArtifact\.content/);
  assert.match(renderRegion, /buildLinkCardState|applyLinkCardToDom|chat-artifact-link/);
});

test("11. linked artifact card: 80k body never enters chat DOM", () => {
  const al = require("../src/chat-artifact-link");
  const FAKE_BODY =
    "关联文稿正文开始。手机 " +
    FAKE_PHONE +
    " 邮箱 " +
    FAKE_EMAIL +
    "。" +
    "履历段落：".padEnd(80000, "W");
  assert.ok(FAKE_BODY.length >= 80000);

  // Minimal hermetic DOM harness
  function makeEl(id) {
    const classes = new Set();
    const el = {
      id,
      textContent: "",
      classList: {
        add: (c) => classes.add(c),
        remove: (c) => classes.delete(c),
        contains: (c) => classes.has(c),
        toggle: (c, force) => {
          if (force === true) classes.add(c);
          else if (force === false) classes.delete(c);
          else if (classes.has(c)) classes.delete(c);
          else classes.add(c);
        },
        _set: classes,
      },
      setAttribute: () => {},
      getAttribute: () => null,
    };
    // seed hidden for panel
    if (id === "artifact-panel" || id === "chat-artifact-link") classes.add("hidden");
    return el;
  }

  const els = {};
  for (const id of [
    "view-chat",
    "chat-artifact-link",
    "chat-artifact-link-label",
    "chat-artifact-link-title",
    "btn-open-linked-draft",
    "btn-close-linked-draft-card",
    "messages",
    "composer",
    "input",
    "btn-send",
    "artifact-panel",
    "artifact-content",
    "artifact-title",
    "artifact-link-hint",
    "artifact-empty",
    "artifact-body",
  ]) {
    els[id] = makeEl(id);
  }
  // Simulate pre-bug state: panel had body dumped
  els["artifact-content"].textContent = FAKE_BODY;
  els["artifact-panel"].classList.remove("hidden");
  els["artifact-link-hint"].textContent = "已关联文稿。可继续修改后再次「更新到文稿并打开」。";
  els["artifact-link-hint"].classList.remove("hidden");

  const doc = {
    getElementById: (id) => els[id] || null,
  };

  const artifact = {
    title: "我的履历草稿",
    content: FAKE_BODY,
    libraryId: "lib_test_1",
  };
  const state = al.buildLinkCardState(artifact, "lib_test_1");
  assert.equal(state.visible, true);
  assert.equal(state.title, "我的履历草稿");
  assert.ok(!JSON.stringify(state).includes(FAKE_PHONE));
  assert.ok(!JSON.stringify(state).includes("WWWW"));

  const applied = al.applyLinkCardToDom(doc, state);
  assert.equal(applied.applied, true);
  assert.equal(applied.visible, true);
  assert.equal(els["artifact-content"].textContent, "", "legacy content node cleared");
  assert.ok(els["artifact-panel"].classList.contains("hidden"), "panel stays hidden");
  assert.ok(!els["chat-artifact-link"].classList.contains("hidden"), "card visible");
  assert.equal(els["chat-artifact-link-title"].textContent, "我的履历草稿");
  assert.ok(els["btn-open-linked-draft"]);
  assert.ok(els["btn-close-linked-draft-card"]);

  const surface = al.chatSurfaceText(doc);
  const hits = al.assertNoForbiddenSnippets(surface, [
    FAKE_PHONE,
    FAKE_EMAIL,
    "WWWW",
    FAKE_BODY.slice(0, 80),
  ]);
  assert.deepEqual(hits, [], "chat surface must not contain body/PII: " + hits.join(","));

  // Close association model
  const cleared = al.buildLinkCardState(null, null);
  al.applyLinkCardToDom(doc, cleared);
  assert.ok(els["chat-artifact-link"].classList.contains("hidden"));
  assert.equal(els["chat-artifact-link-title"].textContent, "");

  // Empty session: no card
  const none = al.buildLinkCardState(null, null);
  assert.equal(none.visible, false);

  // Title-only recovery (old session without showing body)
  const titleOnly = al.buildLinkCardState({ title: "旧会话文稿", libraryId: "x" }, "x");
  assert.equal(titleOnly.visible, true);
  assert.equal(titleOnly.title, "旧会话文稿");
});

test("12. composer controls remain present in chat markup", () => {
  const html = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "index.html"),
    "utf8"
  );
  assert.match(html, /id="chat-artifact-link"/);
  assert.match(html, /id="btn-open-linked-draft"/);
  assert.match(html, /id="btn-close-linked-draft-card"/);
  assert.match(html, /id="input"/);
  assert.match(html, /id="btn-send"/);
  // Card sits before messages; composer still exists
  const cardIdx = html.indexOf('id="chat-artifact-link"');
  const messagesIdx = html.indexOf('id="messages"');
  const composerIdx = html.indexOf('id="composer"');
  assert.ok(cardIdx > 0 && messagesIdx > cardIdx, "card before messages");
  assert.ok(composerIdx > messagesIdx, "composer after messages");
});

test("13. all renderArtifact call sites avoid writing content to chat DOM", () => {
  const appJs = fs.readFileSync(
    path.join(__dirname, "..", "src", "renderer", "app.js"),
    "utf8"
  );
  // No assignment of currentArtifact.content into a DOM textContent/innerText in chat path
  assert.doesNotMatch(
    appJs,
    /artifact-content[\s\S]{0,80}currentArtifact\.content|currentArtifact\.content[\s\S]{0,80}artifact-content/
  );
  const calls = [];
  const re = /renderArtifact\s*\(/g;
  let m;
  while ((m = re.exec(appJs))) calls.push(m.index);
  assert.ok(calls.length >= 4, "expected multiple renderArtifact call sites, got " + calls.length);
});

Promise.all(pending).then(() => {
  console.log("");
  console.log(`chat-history-display: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
});
