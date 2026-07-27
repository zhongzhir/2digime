"use strict";

const path = require("node:path");
const chatMessages = require("../chat-message-model");
const sessions = require("../sessions");
const { normalizeScenarioHint } = require("./scenario-hint");
const { codePointCount } = require("./code-points");
const { toSessionViewDto, toSessionListItem } = require("./session-view-dto");

const USER_RETURN_BLOCK_MESSAGE = "请先停止当前回复，再返回经典界面。";
const INPUT_MAX = 2000;

const SCENARIO_STRATEGY = Object.freeze({
  general_chat: null,
  continue_chat:
    "延续当前会话已有上下文作答；不要假设用户更换了话题，除非用户明确换题。",
  artifact_discussion:
    "用户正在讨论当前会话已关联的文稿；仅依据会话内已验证的关联信息与用户问题作答，不要编造文稿正文。",
});

function createR2ChatLifecycle(deps) {
  const {
    activeRequest,
    attachmentTokens,
    getUserData,
    readConfig,
    buildSystemPrompt,
    loadPackageForChat,
    callModelStream,
    runChatWithConnectedTools,
    getExtensionManager,
    stripToolLeakage,
    hasBadChars,
    hasDsmlToolMarkup,
    retrieval,
    defaultPackageDir,
    sendToSender,
  } = deps;

  /** @type {Map<string, { armed: boolean, buffer: object[] }>} */
  const armState = new Map();
  /** @type {Map<string, string>} live accumulated reply text for controlled stop snapshot */
  const livePartials = new Map();
  /** @type {Map<string, Promise<unknown>>} per-request serial persist queue */
  const persistQueues = new Map();
  /** Test seam: delay background (non-stop) persists to simulate in-flight updateStore. */
  let persistDelayMsForTests = 0;
  // Harness-only failure seam. Production never enables it and still uses the
  // real model path; it lets Electron exercise the UI's recoverable retry.
  let fakeFailuresRemaining = process.env.DIGITALME_R2_FAKE_MODEL_FAIL_ONCE === "1" ? 1 : 0;
  /** @type {null | ((info: { requestId: string, phase: string, stopOwned: boolean }) => Promise<void>|void)} */
  let persistHookForTests = null;

  function userData() {
    return getUserData();
  }

  function noteLivePartial(requestId, chunk) {
    if (!requestId || !activeRequest.isCurrentWritable(requestId)) return;
    const prev = livePartials.get(requestId) || "";
    livePartials.set(requestId, prev + String(chunk || ""));
  }

  function clearLivePartial(requestId) {
    if (requestId) livePartials.delete(requestId);
  }

  function waitPersistDrain(requestId) {
    const id = String(requestId || "");
    return Promise.resolve(persistQueues.get(id) || null).then(() => undefined, () => undefined);
  }

  function enqueuePersist(requestId, work) {
    const id = String(requestId || "");
    const prev = persistQueues.get(id) || Promise.resolve();
    const next = prev.then(
      () => work(),
      () => work()
    );
    // Keep queue settled so drain always progresses
    persistQueues.set(
      id,
      next.then(
        () => undefined,
        () => undefined
      )
    );
    return next;
  }

  function _setPersistDelayForTests(ms) {
    persistDelayMsForTests = typeof ms === "number" && ms > 0 ? ms : 0;
  }

  function _setPersistHookForTests(fn) {
    persistHookForTests = typeof fn === "function" ? fn : null;
  }

  function ensureArm(requestId) {
    let st = armState.get(requestId);
    if (!st) {
      st = { armed: false, buffer: [] };
      armState.set(requestId, st);
    }
    return st;
  }

  function flushArm(requestId, sender) {
    const st = armState.get(requestId);
    if (!st) return;
    st.armed = true;
    const pending = st.buffer.splice(0, st.buffer.length);
    for (const event of pending) {
      try {
        sendToSender(sender, "chat:event", event);
      } catch {
        /* ignore */
      }
    }
  }

  function emitChatEvent(sender, partial, opts = {}) {
    const requestId = partial.requestId;
    const stopToken = opts && opts.stopToken;
    const stopOwned = !!(stopToken && activeRequest.isStopOwner(requestId, stopToken));

    // Background path requires writable; stop owner may emit the stopped terminal only.
    if (!stopOwned && !activeRequest.isCurrentWritable(requestId)) return null;
    if (stopOwned && partial.type !== "stopped") return null;

    const seq = stopOwned
      ? activeRequest.nextSequenceForStop(requestId, stopToken)
      : activeRequest.nextSequence(requestId);
    if (seq == null) return null;

    const event = {
      requestId,
      sessionId: partial.sessionId,
      messageId: partial.messageId,
      sequence: seq,
      type: partial.type,
    };
    if (partial.type === "delta") event.textDelta = String(partial.textDelta || "");
    if (partial.type === "error") {
      event.message = String(partial.message || "暂时没办成，请稍后再试。");
      event.displayText = String(partial.displayText || "");
    }
    if (partial.type === "complete" || partial.type === "stopped") {
      event.displayText = String(partial.displayText || "");
    }

    // Stop terminal always delivers immediately (bypass arm buffer) so UI can settle.
    if (stopOwned) {
      try {
        sendToSender(sender, "chat:event", event);
      } catch {
        /* ignore */
      }
      return event;
    }

    const st = ensureArm(requestId);
    if (!st.armed) {
      st.buffer.push(event);
      return event;
    }
    try {
      sendToSender(sender, "chat:event", event);
    } catch {
      /* ignore */
    }
    return event;
  }

  function acknowledgeChat(sender, payload) {
    const requestId = String((payload && payload.requestId) || "");
    if (!requestId) return { ok: false, code: "missing_request" };
    if (!activeRequest.isCurrent(requestId) && !armState.has(requestId)) {
      return { ok: false, code: "request_mismatch" };
    }
    flushArm(requestId, sender);
    return { ok: true, requestId };
  }

  async function fakeModelStream(onDelta, signal) {
    if (fakeFailuresRemaining > 0) {
      fakeFailuresRemaining -= 1;
      // Match a real provider failure arriving after the renderer has received
      // and acknowledged the request, rather than failing inside the same IPC
      // turn before the event channel can be armed.
      await new Promise((resolve) => setTimeout(resolve, 25));
      throw new Error("测试模型暂时不可用，请重试。");
    }
    const chunks = ["这是", "一段", "测试回复。"];
    const delayMs = Number(process.env.DIGITALME_R2_FAKE_MODEL_DELAY_MS || 120);
    let full = "";
    for (const c of chunks) {
      if (signal && signal.aborted) {
        const err = new Error("已停止");
        err.aborted = true;
        throw err;
      }
      full += c;
      onDelta(c, full);
      await new Promise((r) => setTimeout(r, Number.isFinite(delayMs) ? delayMs : 120));
    }
    await new Promise((r) => setTimeout(r, Number.isFinite(delayMs) ? delayMs : 120));
    if (signal && signal.aborted) {
      const err = new Error("已停止");
      err.aborted = true;
      throw err;
    }
    return full;
  }

  function validateInputText(inputText) {
    if (typeof inputText !== "string") {
      return { ok: false, code: "invalid_input", message: "请输入要发送的内容。" };
    }
    const trimmed = inputText.trim();
    if (!trimmed) {
      return { ok: false, code: "empty_input", message: "请输入要发送的内容。" };
    }
    if (codePointCount(trimmed) > INPUT_MAX) {
      return {
        ok: false,
        code: "input_too_long",
        message: "内容过长，请将输入控制在 2000 字以内。",
      };
    }
    return { ok: true, text: trimmed };
  }

  async function listSessionsDto() {
    const listed = sessions.listSessions(userData());
    return {
      ok: !listed.error,
      activeId: listed.activeId,
      sessions: (listed.sessions || []).map((s) => ({
        id: s.id,
        title: s.title,
        updatedAt: s.updatedAt,
        createdAt: s.createdAt,
        preview: s.preview,
        broken: !!s.broken,
      })),
      error: listed.error || null,
      recovery: listed.recovery || sessions.getRecoveryState(),
    };
  }

  async function getSessionDto(id) {
    try {
      const session = sessions.getSession(userData(), id);
      if (!session) return { ok: false, code: "not_found", message: "找不到该对话。" };
      return { ok: true, session: toSessionViewDto(session) };
    } catch (err) {
      return {
        ok: false,
        code: err && err.code ? err.code : "sessions_load_failed",
        message: err && err.message ? err.message : "会话无法读取。",
        recovery: sessions.getRecoveryState(),
      };
    }
  }

  function gateBusy() {
    const idle = activeRequest.assertIdle();
    if (!idle.ok) {
      return {
        ok: false,
        code: idle.code,
        message: idle.message,
        activeRequest: idle.activeRequest,
      };
    }
    return null;
  }

  function gateWritable() {
    if (sessions.isRecoveryLatched()) {
      return {
        ok: false,
        code: "sessions_recovery_latched",
        message: "会话存档当前无法安全写入。",
        recovery: sessions.getRecoveryState(),
      };
    }
    return null;
  }

  async function createSession(opts) {
    const busy = gateBusy();
    if (busy) return busy;
    const writ = gateWritable();
    if (writ) return writ;
    try {
      const cfg = readConfig();
      const s = await sessions.createSession(userData(), {
        title: opts && opts.title,
        packagePath: cfg.packageDir || defaultPackageDir,
      });
      return { ok: true, session: toSessionViewDto(s), listItem: toSessionListItem(s) };
    } catch (err) {
      return {
        ok: false,
        code: err && err.code ? err.code : "create_failed",
        message: err && err.message ? err.message : "无法新建对话。",
      };
    }
  }

  async function renameSession(id, title) {
    const busy = gateBusy();
    if (busy) return busy;
    const writ = gateWritable();
    if (writ) return writ;
    try {
      const s = await sessions.renameSession(userData(), id, title);
      return { ok: true, session: toSessionViewDto(s) };
    } catch (err) {
      return {
        ok: false,
        code: err && err.code ? err.code : "rename_failed",
        message: err && err.message ? err.message : "无法改名。",
      };
    }
  }

  async function deleteSession(id) {
    const busy = gateBusy();
    if (busy) return busy;
    const writ = gateWritable();
    if (writ) return writ;
    try {
      const result = await sessions.deleteSession(userData(), id);
      return { ok: true, ...result };
    } catch (err) {
      return {
        ok: false,
        code: err && err.code ? err.code : "delete_failed",
        message: err && err.message ? err.message : "无法删除对话。",
      };
    }
  }

  async function setCurrentSession(id) {
    const busy = gateBusy();
    if (busy) return busy;
    const writ = gateWritable();
    if (writ) return writ;
    try {
      const s = await sessions.setActive(userData(), id);
      return { ok: true, session: toSessionViewDto(s) };
    } catch (err) {
      return {
        ok: false,
        code: err && err.code ? err.code : "switch_failed",
        message: err && err.message ? err.message : "无法切换对话。",
      };
    }
  }

  async function clearLinkedArtifact(sessionId) {
    const busy = gateBusy();
    if (busy) return busy;
    const writ = gateWritable();
    if (writ) return writ;
    try {
      const session = await sessions.updateStore(userData(), (store) => {
        const s = store.sessions.find((x) => x.id === sessionId);
        if (!s) {
          const e = new Error("找不到该对话");
          e.code = "not_found";
          throw e;
        }
        s.artifacts = [];
        s.linkedLibraryId = null;
        s.linkedArtifactTitle = null;
        s.updatedAt = new Date().toISOString();
        return s;
      });
      return { ok: true, session: toSessionViewDto(session) };
    } catch (err) {
      return {
        ok: false,
        code: err && err.code ? err.code : "clear_failed",
        message: err && err.message ? err.message : "未能清除关联文稿。",
      };
    }
  }

  async function sendChat(sender, payload, webContentsId) {
    const busy = gateBusy();
    if (busy) return busy;
    const writ = gateWritable();
    if (writ) return writ;

    const sessionId = String((payload && payload.sessionId) || "");
    if (!sessionId) {
      return { ok: false, code: "missing_session", message: "请先选择对话。" };
    }

    const input = validateInputText(payload && payload.inputText);
    if (!input.ok) return input;

    const hint = normalizeScenarioHint(payload && payload.scenarioHint);
    if (!hint.ok) return hint;

    let session;
    try {
      session = sessions.getSession(userData(), sessionId);
    } catch (err) {
      return {
        ok: false,
        code: err && err.code ? err.code : "sessions_load_failed",
        message: err && err.message ? err.message : "会话无法读取。",
        recovery: sessions.getRecoveryState(),
      };
    }
    if (!session) {
      return { ok: false, code: "not_found", message: "找不到该对话。" };
    }

    const linkedArtifactId =
      payload && payload.linkedArtifactId != null
        ? String(payload.linkedArtifactId)
        : null;

    if (hint.value === "artifact_discussion") {
      const card = (session.artifacts || []).find(
        (a) => a && (String(a.libraryId) === linkedArtifactId || String(a.id) === linkedArtifactId)
      );
      const linkedOk =
        linkedArtifactId &&
        (card ||
          String(session.linkedLibraryId || "") === linkedArtifactId ||
          (session.artifacts || []).some((a) => a && (a.libraryId || a.id)));
      if (!linkedOk && !(session.artifacts || []).length && !session.linkedLibraryId) {
        return {
          ok: false,
          code: "artifact_not_linked",
          message: "当前对话没有可讨论的关联文稿。",
        };
      }
    }

    let selection = null;
    const token = payload && payload.attachmentSelectionToken;
    if (token) {
      const v = attachmentTokens.validate(token, { webContentsId, sessionId });
      if (!v.ok) return v;
      selection = v.record.selection;
    }

    const cfg = readConfig();
    const useFake = process.env.DIGITALME_R2_FAKE_MODEL === "1";
    if (!useFake && !cfg.apiKey) {
      return {
        ok: false,
        code: "missing_api_key",
        message: "还没有连接智能引擎。请打开设置，填好密钥后再试。",
      };
    }

    const reg = activeRequest.register({ originSessionId: sessionId, status: "running" });
    if (!reg.ok) return reg;

    const { requestId, assistantMessageId } = reg.activeRequest;
    const abortController = reg.abortController;

    // Consume token only after activeRequest registered
    if (token) {
      const consumed = attachmentTokens.consume(token, { webContentsId, sessionId });
      if (!consumed.ok) {
        activeRequest.clear(requestId);
        return consumed;
      }
      selection = consumed.selection;
    }

    const attachNames = (selection || []).filter((a) => a && a.ok !== false).map((a) => a.name);
    const attachmentRefs = chatMessages.buildAttachmentRefs(selection || []);
    const userDisplay = chatMessages.buildUserDisplayText(input.text, attachNames);
    const userModel = chatMessages.buildUserModelText(input.text, attachNames);
    const userMsg = chatMessages.toPersistableMessage({
      role: "user",
      displayText: userDisplay,
      modelText: userModel,
      attachmentRefs,
    });
    const assistantPlaceholder = chatMessages.toPersistableMessage({
      id: assistantMessageId,
      role: "assistant",
      displayText: "",
      modelText: "",
      attachmentRefs: [],
    });

    try {
      await sessions.updateStore(userData(), (store) => {
        const s = store.sessions.find((x) => x.id === sessionId);
        if (!s) {
          const e = new Error("找不到该对话");
          e.code = "not_found";
          throw e;
        }
        if (!Array.isArray(s.messages)) s.messages = [];
        s.messages.push(userMsg, assistantPlaceholder);
        s.updatedAt = new Date().toISOString();
        store.activeId = sessionId;
        return s;
      });
    } catch (err) {
      activeRequest.clear(requestId);
      if (token) attachmentTokens.clear(token);
      return {
        ok: false,
        code: err && err.code ? err.code : "persist_failed",
        message: err && err.message ? err.message : "消息未能保存。",
      };
    }

    // Arm buffer before any events; start model only on next macrotask so
    // renderer can set triple + acknowledgeChat after this IPC returns.
    ensureArm(requestId);
    const runCtx = {
      sender,
      requestId,
      sessionId,
      assistantMessageId,
      abortController,
      generation: reg.generation,
      token,
      selection,
      hintValue: hint.value,
      cfg,
      useFake,
    };
    setImmediate(() => {
      void runModelAndFinish(runCtx);
    });

    return {
      ok: true,
      accepted: true,
      requestId,
      sessionId,
      assistantMessageId,
      sequence: 0,
      status: "running",
      generation: reg.generation,
    };
  }

  function mayWrite(requestId) {
    return activeRequest.isCurrentWritable(requestId);
  }

  async function persistAssistantText(
    requestId,
    sessionId,
    assistantMessageId,
    displayText,
    modelText,
    opts = {}
  ) {
    const stopToken = opts && opts.stopToken;
    const stopOwned = !!(stopToken && activeRequest.isStopOwner(requestId, stopToken));
    if (!mayWrite(requestId) && !stopOwned) return false;
    if (sessions.isRecoveryLatched()) return false;

    return enqueuePersist(requestId, async () => {
      const stillStop = !!(stopToken && activeRequest.isStopOwner(requestId, stopToken));
      const stillWrite = mayWrite(requestId);
      if (!stillWrite && !stillStop) return false;
      if (sessions.isRecoveryLatched()) return false;

      if (persistHookForTests) {
        await persistHookForTests({
          requestId,
          phase: "before",
          stopOwned: stillStop,
        });
      }
      if (!stillStop && persistDelayMsForTests > 0) {
        await new Promise((r) => setTimeout(r, persistDelayMsForTests));
      }
      // Re-check after delay / hook — stop may have claimed ownership.
      const stopNow = !!(stopToken && activeRequest.isStopOwner(requestId, stopToken));
      const writeNow = mayWrite(requestId);
      if (!writeNow && !stopNow) return false;

      await sessions.updateStore(userData(), (store) => {
        const stopInner = !!(stopToken && activeRequest.isStopOwner(requestId, stopToken));
        const writeInner = mayWrite(requestId);
        if (!writeInner && !stopInner) return null;
        const s = store.sessions.find((x) => x.id === sessionId);
        if (!s) return null;
        const msg = (s.messages || []).find((m) => m.id === assistantMessageId);
        if (msg) {
          msg.displayText = displayText;
          msg.modelText = modelText;
          msg.content = modelText;
        }
        s.updatedAt = new Date().toISOString();
        return s;
      });

      if (persistHookForTests) {
        await persistHookForTests({
          requestId,
          phase: "after",
          stopOwned: !!(stopToken && activeRequest.isStopOwner(requestId, stopToken)),
        });
      }
      return true;
    });
  }

  async function runModelAndFinish(ctx) {
    const {
      sender,
      requestId,
      sessionId,
      assistantMessageId,
      abortController,
      token,
      selection,
      hintValue,
      cfg,
      useFake,
    } = ctx;

    let reply = "";
    try {
      if (!activeRequest.isCurrentWritable(requestId)) {
        const err = new Error("已停止");
        err.aborted = true;
        throw err;
      }

      let pkg = null;
      try {
        pkg = typeof loadPackageForChat === "function" ? loadPackageForChat() : null;
      } catch {
        pkg = null;
      }

      let system = buildSystemPrompt(pkg);
      system +=
        "\n\n---\n\n## 产出方式（必须遵守）\n\n" +
        "1）普通问答、解释、澄清、追问：把完整回答写在对话里。\n" +
        "2）若用户附上了材料正文，必须基于材料作答。\n" +
        "3）禁止声称「已保存到某目录 / 已写入文件」。";

      const strategy = SCENARIO_STRATEGY[hintValue];
      if (strategy) {
        system += "\n\n---\n\n## 当前请求策略\n\n" + strategy;
      }

      if (selection && selection.length) {
        const bodies = selection
          .filter((a) => a && a.ok !== false && a.text)
          .map((a) => "### " + a.name + "\n" + String(a.text).slice(0, 40000));
        if (bodies.length) {
          system +=
            "\n\n---\n\n## 用户本轮附带的材料（正文已提取，请直接使用）\n\n" +
            bodies.join("\n\n").slice(0, 80000);
        }
      }

      const fresh = sessions.getSession(userData(), sessionId);
      const historyMsgs = (fresh && fresh.messages) || [];
      const forModel = historyMsgs.filter((m) => m.id !== assistantMessageId);
      const modelHistory = chatMessages.toModelGatewayHistory(forModel);

      const dir = (cfg && cfg.packageDir) || defaultPackageDir;
      const lastUser = [...modelHistory].reverse().find((m) => m.role === "user");
      if (lastUser && lastUser.content) {
        try {
          const { resolveKnowledgeContext } = require("../act-behalf/knowledge-resolver");
          const userQuestion = String(lastUser.content).split("\n---\n")[0].trim();
          const resolved = resolveKnowledgeContext({
            query: userQuestion,
            packageDir: dir,
            surface: "chat",
            tokenBudget: 12000,
          });
          if (resolved.promptText) system += "\n\n---\n\n" + resolved.promptText;
        } catch {
          /* ignore */
        }
      }

      let streamMessages = [{ role: "system", content: system }, ...modelHistory];
      const signal = abortController.signal;

      if (useFake) {
        reply = await fakeModelStream((delta) => {
          if (!activeRequest.isCurrentWritable(requestId)) return;
          noteLivePartial(requestId, delta);
          emitChatEvent(sender, {
            type: "delta",
            requestId,
            sessionId,
            messageId: assistantMessageId,
            textDelta: delta,
          });
        }, signal);
      } else {
        try {
          if (signal.aborted || !activeRequest.isCurrentWritable(requestId)) {
            const err = new Error("已停止");
            err.aborted = true;
            throw err;
          }
          const em = await getExtensionManager();
          const toolRun = await runChatWithConnectedTools(
            cfg,
            system,
            modelHistory,
            em,
            () => {}
          );
          // Tools may not honor abort; reject stale work after return.
          if (!activeRequest.isCurrentWritable(requestId) || signal.aborted) {
            const err = new Error("已停止");
            err.aborted = true;
            throw err;
          }
          if (toolRun.needsStream && toolRun.finalMessages) {
            streamMessages = toolRun.finalMessages;
            reply = await callModelStream(
              cfg,
              streamMessages,
              (delta) => {
                if (!activeRequest.isCurrentWritable(requestId)) return;
                const cleanedDelta = stripToolLeakage(delta);
                noteLivePartial(requestId, cleanedDelta);
                emitChatEvent(sender, {
                  type: "delta",
                  requestId,
                  sessionId,
                  messageId: assistantMessageId,
                  textDelta: cleanedDelta,
                });
              },
              { signal }
            );
          } else if (toolRun.reply != null) {
            reply = stripToolLeakage(toolRun.reply);
            if (activeRequest.isCurrentWritable(requestId)) {
              noteLivePartial(requestId, reply);
              emitChatEvent(sender, {
                type: "delta",
                requestId,
                sessionId,
                messageId: assistantMessageId,
                textDelta: reply,
              });
            }
          }
        } catch (toolErr) {
          if (toolErr && toolErr.aborted) throw toolErr;
          if (!activeRequest.isCurrentWritable(requestId) || signal.aborted) {
            const err = new Error("已停止");
            err.aborted = true;
            throw err;
          }
        }

        if (!reply) {
          if (!activeRequest.isCurrentWritable(requestId) || signal.aborted) {
            const err = new Error("已停止");
            err.aborted = true;
            throw err;
          }
          reply = await callModelStream(
            cfg,
            streamMessages,
            (delta) => {
              if (!activeRequest.isCurrentWritable(requestId)) return;
              const cleanedDelta = stripToolLeakage(delta);
              noteLivePartial(requestId, cleanedDelta);
              emitChatEvent(sender, {
                type: "delta",
                requestId,
                sessionId,
                messageId: assistantMessageId,
                textDelta: cleanedDelta,
              });
            },
            { signal }
          );
        }
      }

      if (!activeRequest.isCurrentWritable(requestId)) {
        const err = new Error("已停止");
        err.aborted = true;
        throw err;
      }

      let cleaned = stripToolLeakage ? stripToolLeakage(reply) : reply;
      if (!cleaned && hasDsmlToolMarkup && hasDsmlToolMarkup(reply)) {
        cleaned = "刚才没有整理成可读说明，请再试一次。";
      }
      if (hasBadChars && hasBadChars(cleaned)) {
        throw new Error("回复里出现乱码，请再试一次。");
      }

      const displayText = chatMessages.clampDisplayText(cleaned, "assistant");
      const modelText = chatMessages.truncateMarked(cleaned, chatMessages.MODEL_TEXT_MAX).text;

      await persistAssistantText(requestId, sessionId, assistantMessageId, displayText, modelText);

      if (!activeRequest.isCurrentWritable(requestId)) return;

      activeRequest.setStatus(requestId, "complete");
      emitChatEvent(sender, {
        type: "complete",
        requestId,
        sessionId,
        messageId: assistantMessageId,
        displayText,
      });
    } catch (err) {
      const aborted = !!(err && err.aborted) || !activeRequest.isCurrentWritable(requestId);
      // Stale / aborted / fallback-invalidated: no session write, no terminal emit.
      if (!activeRequest.isCurrentWritable(requestId)) {
        return;
      }

      const partial = chatMessages.clampDisplayText(
        stripToolLeakage ? stripToolLeakage(reply || "") : reply || "",
        "assistant"
      );
      const modelText = chatMessages.truncateMarked(partial, chatMessages.MODEL_TEXT_MAX).text;

      try {
        await persistAssistantText(requestId, sessionId, assistantMessageId, partial, modelText);
      } catch {
        /* ignore */
      }

      if (!activeRequest.isCurrentWritable(requestId)) return;

      activeRequest.setStatus(requestId, aborted ? "stopped" : "failed");
      emitChatEvent(sender, {
        type: aborted ? "stopped" : "error",
        requestId,
        sessionId,
        messageId: assistantMessageId,
        displayText: partial,
        message: aborted ? "已停止" : err && err.message ? err.message : "暂时没办成，请稍后再试。",
      });
    } finally {
      if (token) attachmentTokens.clear(token);
      // User stop owns clear + arm/partial cleanup after claimStop.
      if (activeRequest.hasStopClaim(requestId)) {
        return;
      }
      armState.delete(requestId);
      clearLivePartial(requestId);
      persistQueues.delete(requestId);
      activeRequest.clear(requestId);
    }
  }

  /**
   * User stop: claim ownership synchronously first (writable=false), then drain
   * in-flight persists, write one controlled snapshot, emit stopped, clear.
   * Fallback must use invalidate — never claimStop.
   */
  async function stopChat(sender, requestId) {
    const cur = activeRequest.get();
    if (!cur) {
      return { ok: true, stopped: false, code: "already_completed" };
    }
    if (requestId && cur.requestId !== requestId) {
      return { ok: false, code: "request_mismatch", message: "当前没有匹配的回复可停止。", stopped: false };
    }

    const claimed = activeRequest.claimStop(requestId || cur.requestId);
    if (!claimed.ok) {
      return {
        ok: true,
        stopped: false,
        code: claimed.code || "already_completed",
      };
    }

    const { requestId: id, originSessionId: sessionId, assistantMessageId, stopToken } =
      claimed.claim;

    // Wait for any in-flight background persist to finish (or abandon) before final snapshot.
    await waitPersistDrain(id);

    const raw = livePartials.get(id) || "";
    const cleaned = stripToolLeakage ? stripToolLeakage(raw) : raw;
    const displayText = chatMessages.clampDisplayText(cleaned, "assistant");
    const modelText = chatMessages.truncateMarked(cleaned, chatMessages.MODEL_TEXT_MAX).text;

    try {
      await persistAssistantText(id, sessionId, assistantMessageId, displayText, modelText, {
        stopToken,
      });
    } catch {
      /* ignore */
    }

    if (activeRequest.isStopOwner(id, stopToken)) {
      activeRequest.setStatus(id, "stopped");
      emitChatEvent(
        sender,
        {
          type: "stopped",
          requestId: id,
          sessionId,
          messageId: assistantMessageId,
          displayText,
        },
        { stopToken }
      );
    }

    armState.delete(id);
    clearLivePartial(id);
    persistQueues.delete(id);
    if (activeRequest.isCurrent(id)) {
      activeRequest.clear(id);
    }

    return { ok: true, stopped: true, requestId: id };
  }

  function getActiveRequest() {
    return { ok: true, activeRequest: activeRequest.get() };
  }

  function checkUserReturnLegacy() {
    const cur = activeRequest.get();
    if (cur) {
      return {
        ok: false,
        code: "request_in_progress",
        message: USER_RETURN_BLOCK_MESSAGE,
        activeRequest: cur,
      };
    }
    return { ok: true };
  }

  async function abortActiveForFallback() {
    const cur = activeRequest.get();
    if (!cur) return { ok: true, aborted: false };
    const requestId = cur.requestId;
    // Fallback: invalidate only — no partial snapshot, no terminal write.
    activeRequest.invalidate(requestId);
    await waitPersistDrain(requestId);
    // Wait until runModelAndFinish finally clears — do not pretend clear via setTimeout(0).
    const cleared = await activeRequest.waitUntilCleared(requestId, 8000);
    if (!cleared && activeRequest.isCurrent(requestId)) {
      activeRequest.clear(requestId);
    }
    armState.delete(requestId);
    clearLivePartial(requestId);
    return { ok: true, aborted: true, requestId, cleared };
  }

  return {
    USER_RETURN_BLOCK_MESSAGE,
    listSessionsDto,
    getSessionDto,
    createSession,
    renameSession,
    deleteSession,
    setCurrentSession,
    clearLinkedArtifact,
    sendChat,
    stopChat,
    getActiveRequest,
    acknowledgeChat,
    checkUserReturnLegacy,
    abortActiveForFallback,
    validateInputText,
    _setPersistDelayForTests,
    _setPersistHookForTests,
  };
}

module.exports = {
  createR2ChatLifecycle,
  USER_RETURN_BLOCK_MESSAGE: "请先停止当前回复，再返回经典界面。",
  INPUT_MAX,
};
