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

test("2. persist session JSON has no attachment body; reload shows short bubble", () => {
  const ud = tempUserData();
  try {
    const s = sessions.createSession(ud, { title: "测" });
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
    sessions.saveSession(ud, s);
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

test("6. corrupt history normalize skips bad rows; createSession still works", () => {
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
    const s = sessions.createSession(ud, { title: "恢复" });
    assert.ok(s.id);
    assert.equal(Array.isArray(s.messages), true);
  } finally {
    cleanup(ud);
  }
});

test("7. listSessions preview uses safe text not attachment body", () => {
  const ud = tempUserData();
  try {
    const s = sessions.createSession(ud, { title: "预览" });
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

console.log("");
console.log(`chat-history-display: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
