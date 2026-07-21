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

  function userData() {
    return getUserData();
  }

  function emitChatEvent(sender, partial) {
    const seq = activeRequest.nextSequence(partial.requestId);
    if (seq == null) return null;
    const event = {
      requestId: partial.requestId,
      sessionId: partial.sessionId,
      messageId: partial.messageId,
      sequence: seq,
      type: partial.type,
    };
    if (partial.type === "delta") event.textDelta = String(partial.textDelta || "");
    if (partial.type === "error") event.message = String(partial.message || "暂时没办成，请稍后再试。");
    if (partial.type === "complete" || partial.type === "stopped") {
      event.displayText = String(partial.displayText || "");
    }
    try {
      sendToSender(sender, "chat:event", event);
    } catch {
      /* ignore */
    }
    return event;
  }

  async function fakeModelStream(onDelta, signal) {
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
    // Hold active briefly so E2E can exercise nav/return guards.
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

    // Return immediately so renderer can arm sequence cursor; stream in background.
    void runModelAndFinish({
      sender,
      requestId,
      sessionId,
      assistantMessageId,
      abortController,
      token,
      selection,
      hintValue: hint.value,
      cfg,
      useFake,
    });

    return {
      ok: true,
      accepted: true,
      requestId,
      sessionId,
      assistantMessageId,
    };
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
      if (lastUser && lastUser.content && retrieval) {
        try {
          const result = retrieval.retrieve(dir, lastUser.content);
          const ctxR = retrieval.renderContext(result);
          if (ctxR) system += "\n\n---\n\n" + ctxR;
        } catch {
          /* ignore */
        }
      }

      let streamMessages = [{ role: "system", content: system }, ...modelHistory];

      if (useFake) {
        reply = await fakeModelStream((delta) => {
          emitChatEvent(sender, {
            type: "delta",
            requestId,
            sessionId,
            messageId: assistantMessageId,
            textDelta: delta,
          });
        }, abortController.signal);
      } else {
        try {
          const em = await getExtensionManager();
          const toolRun = await runChatWithConnectedTools(
            cfg,
            system,
            modelHistory,
            em,
            () => {}
          );
          if (toolRun.needsStream && toolRun.finalMessages) {
            streamMessages = toolRun.finalMessages;
            reply = await callModelStream(
              cfg,
              streamMessages,
              (delta) => {
                emitChatEvent(sender, {
                  type: "delta",
                  requestId,
                  sessionId,
                  messageId: assistantMessageId,
                  textDelta: stripToolLeakage(delta),
                });
              },
              { signal: abortController.signal }
            );
          } else if (toolRun.reply != null) {
            reply = stripToolLeakage(toolRun.reply);
            emitChatEvent(sender, {
              type: "delta",
              requestId,
              sessionId,
              messageId: assistantMessageId,
              textDelta: reply,
            });
          }
        } catch (toolErr) {
          if (toolErr && toolErr.aborted) throw toolErr;
        }

        if (!reply) {
          reply = await callModelStream(
            cfg,
            streamMessages,
            (delta) => {
              emitChatEvent(sender, {
                type: "delta",
                requestId,
                sessionId,
                messageId: assistantMessageId,
                textDelta: stripToolLeakage(delta),
              });
            },
            { signal: abortController.signal }
          );
        }
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

      if (!sessions.isRecoveryLatched()) {
        await sessions.updateStore(userData(), (store) => {
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
      }

      activeRequest.setStatus(requestId, "complete");
      emitChatEvent(sender, {
        type: "complete",
        requestId,
        sessionId,
        messageId: assistantMessageId,
        displayText,
      });
    } catch (err) {
      const aborted = !!(err && err.aborted);
      const partial = chatMessages.clampDisplayText(
        stripToolLeakage ? stripToolLeakage(reply || "") : reply || "",
        "assistant"
      );
      const modelText = chatMessages.truncateMarked(partial, chatMessages.MODEL_TEXT_MAX).text;

      try {
        if (!sessions.isRecoveryLatched()) {
          await sessions.updateStore(userData(), (store) => {
            const s = store.sessions.find((x) => x.id === sessionId);
            if (!s) return null;
            const msg = (s.messages || []).find((m) => m.id === assistantMessageId);
            if (msg) {
              msg.displayText = partial;
              msg.modelText = modelText;
              msg.content = modelText;
            }
            s.updatedAt = new Date().toISOString();
            return s;
          });
        }
      } catch {
        /* ignore */
      }

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
      activeRequest.clear(requestId);
    }
  }

  function stopChat(requestId) {
    const cur = activeRequest.get();
    if (!cur) return { ok: true, stopped: false };
    if (requestId && cur.requestId !== requestId) {
      return { ok: false, code: "request_mismatch", message: "当前没有匹配的回复可停止。" };
    }
    return activeRequest.abort(requestId || cur.requestId);
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
    activeRequest.abort(cur.requestId);
    // Give in-flight finally a tick; mark failed if still present
    activeRequest.setStatus(cur.requestId, "stopped");
    // Persist partial if possible is handled by sendChat catch; force clear zombie
    setTimeout(() => {
      activeRequest.clear(cur.requestId);
    }, 0);
    return { ok: true, aborted: true, requestId: cur.requestId };
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
    checkUserReturnLegacy,
    abortActiveForFallback,
    validateInputText,
  };
}

module.exports = {
  createR2ChatLifecycle,
  USER_RETURN_BLOCK_MESSAGE: "请先停止当前回复，再返回经典界面。",
  INPUT_MAX,
};
