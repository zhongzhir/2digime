"use strict";

/**
 * R2-A contract tests — hermetic temp dirs only.
 * Run: npm run test:r2-contracts
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

const { codePointCount, sliceCodePoints } = require("../src/r2/code-points");
const { normalizeScenarioHint } = require("../src/r2/scenario-hint");
const { createAttachmentTokenVault } = require("../src/r2/attachment-tokens");
const { createActiveRequestRegistry } = require("../src/r2/active-request");
const {
  toSessionViewDto,
  buildArtifactPreviewDisplay,
} = require("../src/r2/session-view-dto");
const sessions = require("../src/sessions");
const cm = require("../src/chat-message-model");
const { createR2ChatLifecycle } = require("../src/r2/chat-lifecycle");

let passed = 0;
let failed = 0;

function test(name, fn) {
  const run = Promise.resolve()
    .then(() => fn())
    .then(() => {
      passed += 1;
      console.log("PASS", name);
    })
    .catch((err) => {
      failed += 1;
      console.error("FAIL", name, err && err.stack ? err.stack : err);
    });
  return run;
}

function tempUserData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dm-r2-contracts-"));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

async function main() {
  sessions._resetRecoveryLatchForTests();
  sessions._setFsForTests(null);

  // Sequential — sessions tests share process-level latch / fs mock.
  await test("code-points: emoji / surrogate pair safe", () => {
    const s = "你好😀世界";
    assert.equal(codePointCount(s), 5);
    assert.equal(sliceCodePoints(s, 3), "你好😀");
    assert.equal(codePointCount(sliceCodePoints(s, 3)), 3);
  });

  await test("scenarioHint whitelist / omit / reject", () => {
    assert.equal(normalizeScenarioHint(undefined).value, "general_chat");
    assert.equal(normalizeScenarioHint(null).value, "general_chat");
    assert.equal(normalizeScenarioHint("continue_chat").value, "continue_chat");
    assert.equal(normalizeScenarioHint("artifact_discussion").ok, true);
    assert.equal(normalizeScenarioHint("").ok, false);
    assert.equal(normalizeScenarioHint("General_Chat").ok, false);
    assert.equal(normalizeScenarioHint("hack").ok, false);
    assert.equal(normalizeScenarioHint(1).ok, false);
  });

  await test("role display limits: user 2000 / assistant 8000; refresh stable", () => {
    const userLong = "用".repeat(2500);
    const asstLong = "助".repeat(7500);
    const u = cm.toPersistableMessage({ role: "user", displayText: userLong, modelText: "x" });
    const a = cm.toPersistableMessage({
      role: "assistant",
      displayText: asstLong,
      modelText: asstLong.slice(0, 100),
    });
    assert.ok(codePointCount(u.displayText) <= 2000);
    assert.ok(codePointCount(a.displayText) <= 8000);
    assert.ok(codePointCount(a.displayText) > 2000);
    const a2 = cm.normalizeLoadedMessage(a);
    assert.ok(codePointCount(a2.displayText) > 2000);
    assert.ok(codePointCount(a2.displayText) <= 8000);
    const shown = cm.legacyDisplayText(a);
    assert.ok(codePointCount(shown.text) > 2000);
  });

  await test("ARTIFACT_PREVIEW_TRUNCATE_NOTICE frozen + preview slice", () => {
    const notice =
      "内容较长，当前仅展示前 8000 字。完整内容未写入聊天记录；需要查看时，请打开关联文稿。";
    assert.equal(cm.ARTIFACT_PREVIEW_TRUNCATE_NOTICE, notice);
    const short = buildArtifactPreviewDisplay("短文");
    assert.equal(short.truncated, false);
    assert.equal(short.notice, null);
    const body = "文".repeat(8001);
    const prev = buildArtifactPreviewDisplay(body);
    assert.equal(prev.truncated, true);
    assert.equal(prev.notice, notice);
    assert.equal(codePointCount(prev.text), 8000);
    const emoji = "😀".repeat(8001);
    const ep = buildArtifactPreviewDisplay(emoji);
    assert.equal(codePointCount(ep.text), 8000);
    assert.equal(ep.text.length, 16000);
  });

  await test("DTO strips modelText / paths / bodies", () => {
    const dto = toSessionViewDto({
      id: "s1",
      title: "t",
      packagePath: "D:\\Secrets\\pkg",
      messages: [
        {
          schemaVersion: 2,
          id: "m1",
          role: "user",
          displayText: "问",
          modelText: "SECRET_MODEL",
          attachmentRefs: [{ id: "a", name: "a.txt", path: "D:\\Secrets\\a.txt" }],
          createdAt: new Date().toISOString(),
        },
      ],
      artifacts: [{ libraryId: "lib1", title: "稿", body: "FULL_BODY_SECRET" }],
    });
    const blob = JSON.stringify(dto);
    assert.ok(!blob.includes("SECRET_MODEL"));
    assert.ok(!blob.includes("FULL_BODY_SECRET"));
    assert.ok(!blob.includes("packagePath"));
    assert.ok(!("modelText" in dto.messages[0]));
    assert.equal(dto.linkedArtifact.libraryId, "lib1");
    assert.equal(dto.messages[0].attachmentRefs[0].path, undefined);
  });

  await test("attachment token one-shot + TTL 299/300 with fake clock", () => {
    let now = 1_000_000;
    const vault = createAttachmentTokenVault({ nowMonotonicMs: () => now });
    const minted = vault.create({
      webContentsId: 1,
      sessionId: "s1",
      selection: [{ id: "a1", name: "a.txt", text: "BODY_SECRET", ok: true }],
    });
    assert.ok(minted.token);
    assert.ok(!JSON.stringify(minted.attachments).includes("BODY_SECRET"));

    now += 299_000;
    assert.equal(vault.validate(minted.token, { webContentsId: 1, sessionId: "s1" }).ok, true);
    assert.equal(vault.consume(minted.token, { webContentsId: 1, sessionId: "s1" }).ok, true);
    assert.equal(vault.consume(minted.token, { webContentsId: 1, sessionId: "s1" }).code, "token_consumed");

    const minted2 = vault.create({
      webContentsId: 1,
      sessionId: "s1",
      selection: [{ id: "a2", name: "b.txt", text: "X", ok: true }],
    });
    now += 300_000;
    assert.equal(vault.validate(minted2.token, { webContentsId: 1, sessionId: "s1" }).code, "token_expired");
    assert.equal(vault.size(), 0);
    assert.equal(vault.debugBodyChars(minted2.token), 0);
    // Second check after wipe: record gone
    assert.equal(vault.validate(minted2.token, { webContentsId: 1, sessionId: "s1" }).code, "token_not_found");

    const minted3 = vault.create({
      webContentsId: 1,
      sessionId: "s1",
      selection: [{ id: "a3", name: "c.txt", text: "Y", ok: true }],
    });
    assert.equal(vault.validate(minted3.token, { webContentsId: 99, sessionId: "s1" }).ok, false);
    assert.equal(vault.validate(minted3.token, { webContentsId: 1, sessionId: "other" }).ok, false);
  });

  await test("activeRequest single-flight", () => {
    const reg = createActiveRequestRegistry();
    const a = reg.register({ originSessionId: "s1" });
    assert.equal(a.ok, true);
    assert.equal(reg.register({ originSessionId: "s2" }).ok, false);
    reg.clear(a.activeRequest.requestId);
    assert.equal(reg.register({ originSessionId: "s2" }).ok, true);
  });

  await test("sessions atomic write + ordered consecutive writes", async () => {
    sessions._resetRecoveryLatchForTests();
    const ud = tempUserData();
    try {
      const s1 = await sessions.createSession(ud, { title: "A" });
      const s2 = await sessions.createSession(ud, { title: "B" });
      const listed = sessions.listSessions(ud);
      assert.equal(listed.sessions.length, 2);
      assert.equal(listed.activeId, s2.id);
      const raw = fs.readFileSync(sessions.sessionsPath(ud), "utf8");
      assert.ok(raw.includes(s1.id));
      assert.ok(raw.includes(s2.id));
    } finally {
      cleanup(ud);
    }
  });

  await test("rename retries EBUSY then success; counts attempts", async () => {
    sessions._resetRecoveryLatchForTests();
    const ud = tempUserData();
    const realFs = fs;
    let attempts = 0;
    sessions._setFsForTests({
      ...realFs,
      existsSync: (...a) => realFs.existsSync(...a),
      mkdirSync: (...a) => realFs.mkdirSync(...a),
      openSync: (...a) => realFs.openSync(...a),
      writeSync: (...a) => realFs.writeSync(...a),
      fsyncSync: (...a) => realFs.fsyncSync(...a),
      closeSync: (...a) => realFs.closeSync(...a),
      unlinkSync: (...a) => realFs.unlinkSync(...a),
      readFileSync: (...a) => realFs.readFileSync(...a),
      renameSync: (tmp, final) => {
        attempts += 1;
        if (attempts < 3) {
          const err = new Error("busy");
          err.code = "EBUSY";
          throw err;
        }
        return realFs.renameSync(tmp, final);
      },
    });
    try {
      await sessions.createSession(ud, { title: "retry" });
      assert.equal(attempts, 3);
      assert.ok(fs.existsSync(sessions.sessionsPath(ud)));
    } finally {
      sessions._setFsForTests(null);
      cleanup(ud);
    }
  });

  await test("rename non-whitelist error does not retry; old file kept", async () => {
    sessions._resetRecoveryLatchForTests();
    const ud = tempUserData();
    await sessions.createSession(ud, { title: "keep" });
    const before = fs.readFileSync(sessions.sessionsPath(ud), "utf8");
    const realFs = fs;
    let attempts = 0;
    sessions._setFsForTests({
      ...realFs,
      existsSync: (...a) => realFs.existsSync(...a),
      mkdirSync: (...a) => realFs.mkdirSync(...a),
      openSync: (...a) => realFs.openSync(...a),
      writeSync: (...a) => realFs.writeSync(...a),
      fsyncSync: (...a) => realFs.fsyncSync(...a),
      closeSync: (...a) => realFs.closeSync(...a),
      unlinkSync: (...a) => realFs.unlinkSync(...a),
      readFileSync: (...a) => realFs.readFileSync(...a),
      renameSync: () => {
        attempts += 1;
        const err = new Error("noent");
        err.code = "ENOENT";
        throw err;
      },
    });
    try {
      await assert.rejects(() => sessions.createSession(ud, { title: "fail" }));
      assert.equal(attempts, 1);
      assert.equal(fs.readFileSync(sessions.sessionsPath(ud), "utf8"), before);
    } finally {
      sessions._setFsForTests(null);
      cleanup(ud);
    }
  });

  await test("parse failure sets latch; never empty overwrite; blocks writes", async () => {
    sessions._resetRecoveryLatchForTests();
    const ud = tempUserData();
    const p = sessions.sessionsPath(ud);
    fs.writeFileSync(p, "{not-json", "utf8");
    const before = fs.readFileSync(p, "utf8");
    assert.throws(() => sessions.loadStore(ud));
    assert.equal(sessions.isRecoveryLatched(), true);
    await assert.rejects(() => sessions.createSession(ud, { title: "x" }), (err) => {
      assert.equal(err.code, "sessions_recovery_latched");
      return true;
    });
    await assert.rejects(() => sessions.saveSession(ud, { id: "s", messages: [] }), (err) => {
      assert.equal(err.code, "sessions_recovery_latched");
      return true;
    });
    assert.equal(fs.readFileSync(p, "utf8"), before);
    sessions._resetRecoveryLatchForTests();
    cleanup(ud);
  });

  await test("inputText validation helpers", () => {
    const { createR2ChatLifecycle } = require("../src/r2/chat-lifecycle");
    const life = createR2ChatLifecycle({
      activeRequest: createActiveRequestRegistry(),
      attachmentTokens: createAttachmentTokenVault(),
      getUserData: () => tempUserData(),
      readConfig: () => ({}),
      buildSystemPrompt: () => "",
      loadPackageForChat: () => null,
      callModelStream: async () => "",
      runChatWithConnectedTools: async () => ({ reply: null }),
      getExtensionManager: async () => ({}),
      stripToolLeakage: (t) => t,
      hasBadChars: () => false,
      hasDsmlToolMarkup: () => false,
      retrieval: null,
      defaultPackageDir: os.tmpdir(),
      sendToSender: () => {},
    });
    assert.equal(life.validateInputText("").ok, false);
    assert.equal(life.validateInputText("   ").ok, false);
    assert.equal(life.validateInputText("hi").ok, true);
    assert.equal(life.validateInputText("字".repeat(2001)).ok, false);
    assert.equal(life.validateInputText("字".repeat(2000)).ok, true);
  });

  await test("activeRequest: abort invalidates writable; tombstone after clear", () => {
    const reg = createActiveRequestRegistry();
    const r = reg.register({ originSessionId: "s1" });
    assert.equal(r.ok, true);
    const id = r.activeRequest.requestId;
    assert.equal(reg.isCurrentWritable(id), true);
    reg.abort(id);
    assert.equal(reg.isCurrent(id), true);
    assert.equal(reg.isCurrentWritable(id), false);
    assert.equal(reg.nextSequence(id), null);
    reg.clear(id);
    assert.equal(reg.isCurrent(id), false);
    assert.equal(reg.isTombstoned(id), true);
  });

  await test("tombstones are bounded", () => {
    const reg = createActiveRequestRegistry({ tombstoneLimit: 3 });
    const ids = [];
    for (let i = 0; i < 5; i += 1) {
      const r = reg.register({ originSessionId: "s" + i });
      assert.equal(r.ok, true);
      ids.push(r.activeRequest.requestId);
      reg.clear(r.activeRequest.requestId);
    }
    assert.equal(reg.tombstoneSize(), 3);
    assert.equal(reg.isTombstoned(ids[0]), false);
    assert.equal(reg.isTombstoned(ids[1]), false);
    assert.equal(reg.isTombstoned(ids[2]), true);
    assert.equal(reg.isTombstoned(ids[4]), true);
  });

  await test("invalidate then finish: sessions file unchanged", async () => {
    sessions._resetRecoveryLatchForTests();
    const ud = tempUserData();
    const prevFake = process.env.DIGITALME_R2_FAKE_MODEL;
    const prevDelay = process.env.DIGITALME_R2_FAKE_MODEL_DELAY_MS;
    process.env.DIGITALME_R2_FAKE_MODEL = "1";
    process.env.DIGITALME_R2_FAKE_MODEL_DELAY_MS = "80";
    try {
      const reg = createActiveRequestRegistry();
      const vault = createAttachmentTokenVault();
      const fakeSender = { id: 1 };
      const life = createR2ChatLifecycle({
        activeRequest: reg,
        attachmentTokens: vault,
        getUserData: () => ud,
        readConfig: () => ({}),
        buildSystemPrompt: () => "",
        loadPackageForChat: () => null,
        callModelStream: async () => "",
        runChatWithConnectedTools: async () => ({ reply: null }),
        getExtensionManager: async () => ({}),
        stripToolLeakage: (t) => t,
        hasBadChars: () => false,
        hasDsmlToolMarkup: () => false,
        retrieval: null,
        defaultPackageDir: os.tmpdir(),
        sendToSender: () => {},
      });
      const created = await life.createSession({ title: "inv" });
      assert.equal(created.ok, true);
      const sessionId = created.session.id;
      const send = await life.sendChat(
        fakeSender,
        { sessionId, inputText: "invalidate探针" },
        1
      );
      assert.equal(send.ok, true);
      life.acknowledgeChat(fakeSender, { requestId: send.requestId });
      const before = fs.readFileSync(sessions.sessionsPath(ud), "utf8");
      reg.invalidate(send.requestId);
      await reg.waitUntilCleared(send.requestId, 5000);
      await new Promise((r) => setTimeout(r, 250));
      const after = fs.readFileSync(sessions.sessionsPath(ud), "utf8");
      assert.equal(after, before);
      assert.equal(reg.get(), null);
    } finally {
      if (prevFake === undefined) delete process.env.DIGITALME_R2_FAKE_MODEL;
      else process.env.DIGITALME_R2_FAKE_MODEL = prevFake;
      if (prevDelay === undefined) delete process.env.DIGITALME_R2_FAKE_MODEL_DELAY_MS;
      else process.env.DIGITALME_R2_FAKE_MODEL_DELAY_MS = prevDelay;
      cleanup(ud);
    }
  });

  await test("attachment token TTL expire clears vault body without sendChat", () => {
    let now = 1000;
    const vault = createAttachmentTokenVault({ nowMonotonicMs: () => now });
    const minted = vault.create({
      webContentsId: 1,
      sessionId: "s1",
      selection: [{ id: "a1", name: "t.txt", text: "SECRET_BODY_XYZ", ok: true }],
    });
    assert.equal(vault.size(), 1);
    assert.ok(vault.debugBodyChars(minted.token) > 0);
    now = 1000 + 300_000;
    vault.expireStale();
    assert.equal(vault.size(), 0);
    assert.equal(vault.peek(minted.token), null);
    assert.equal(vault.debugBodyChars(minted.token), 0);
    const again = vault.validate(minted.token, { webContentsId: 1, sessionId: "s1" });
    assert.equal(again.ok, false);
    assert.equal(again.code, "token_not_found");
  });

  await test("acceptChatEvent: triple / sequence / terminal partial", () => {
    const { acceptChatEvent } = require("../src/r2/chat-event-accept");
    let st = {
      triple: { requestId: "r1", sessionId: "s1", messageId: "m1" },
      seqCursor: 0,
      streamByMessageId: {},
      messages: [{ id: "m1", role: "assistant", displayText: "" }],
      active: true,
      error: null,
    };
    const badTriple = acceptChatEvent(st, {
      requestId: "forged",
      sessionId: "s1",
      messageId: "m1",
      sequence: 1,
      type: "complete",
      displayText: "FORGED",
    });
    assert.equal(badTriple.accepted, false);
    assert.equal(badTriple.reason, "triple_mismatch");

    const dup = acceptChatEvent(st, {
      requestId: "r1",
      sessionId: "s1",
      messageId: "m1",
      sequence: 0,
      type: "delta",
      textDelta: "x",
    });
    assert.equal(dup.accepted, false);
    assert.equal(dup.reason, "sequence_stale");

    st = acceptChatEvent(st, {
      requestId: "r1",
      sessionId: "s1",
      messageId: "m1",
      sequence: 1,
      type: "delta",
      textDelta: "部",
    });
    assert.equal(st.accepted, true);
    const term = acceptChatEvent(st, {
      requestId: "r1",
      sessionId: "s1",
      messageId: "m1",
      sequence: 2,
      type: "error",
      displayText: "部分回复",
      message: "失败说明",
    });
    assert.equal(term.accepted, true);
    assert.equal(term.active, false);
    assert.equal(term.finalDisplayText, "部分回复");
    assert.equal(term.error, "失败说明");
    assert.equal(term.messages[0].displayText, "部分回复");
  });

  console.log("\nR2 contracts:", passed, "passed,", failed, "failed");
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
