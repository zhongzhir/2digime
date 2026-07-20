"use strict";

/**
 * Chat message schema v2 — visible text vs model context vs attachment refs.
 * UMD: CommonJS (sessions/tests/main) and browser (renderer script).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DigitalMeChatMessages = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const SCHEMA_VERSION = 2;
  const MODEL_TEXT_MAX = 4000;
  const DISPLAY_TEXT_MAX = 2000;
  const LEGACY_QUESTION_MAX = 500;
  const FOLD_PREVIEW_CHARS = 1600;
  const FOLD_EXPAND_MAX = 8000;
  const LEGACY_ATTACH_SEP = "\n\n---\n以下是我附上的材料正文";
  const SESSION_NAV_BLOCK_MESSAGE = "请先停止当前回复，再切换对话。";

  function newMessageId() {
    return "m_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1e6).toString(36);
  }

  function truncateMarked(text, max) {
    const s = String(text || "");
    if (s.length <= max) return { text: s, truncated: false };
    return {
      text: s.slice(0, max) + "\n…（已截断，未保存完整材料正文）",
      truncated: true,
    };
  }

  function clampDisplayText(text) {
    const s = String(text || "");
    if (s.length <= DISPLAY_TEXT_MAX) return s;
    return s.slice(0, DISPLAY_TEXT_MAX) + "…";
  }

  /**
   * Try to recover a short user question from untrusted legacy payloads.
   * Never returns attachment bodies.
   */
  function extractUserQuestionFromRaw(raw) {
    const s = String(raw || "");
    if (!s) return null;
    const sepIdx = s.indexOf(LEGACY_ATTACH_SEP);
    if (sepIdx >= 0) {
      let q = s.slice(0, sepIdx).trim();
      if (q.length > LEGACY_QUESTION_MAX) q = q.slice(0, LEGACY_QUESTION_MAX) + "…";
      return q || null;
    }
    const mark = s.search(/\n(?:［附件：|已附上：)/);
    if (mark >= 0) {
      let q = s.slice(0, mark).trim();
      if (q.length > LEGACY_QUESTION_MAX) q = q.slice(0, LEGACY_QUESTION_MAX) + "…";
      return q || null;
    }
    if (s.length <= LEGACY_QUESTION_MAX) return s.trim() || null;
    return null;
  }

  function safeUserLegacyResult(raw, source) {
    const q = extractUserQuestionFromRaw(raw);
    if (q) {
      return {
        text: q + "\n此历史消息曾包含材料，材料正文已隐藏。",
        forbidExpand: true,
        source,
      };
    }
    return {
      text: "这条历史消息包含较长材料，正文已隐藏。",
      forbidExpand: true,
      source: source + "-opaque",
    };
  }

  function buildUserDisplayText(userInput, attachmentNames) {
    const text = String(userInput || "").trim();
    const names = Array.isArray(attachmentNames) ? attachmentNames.filter(Boolean) : [];
    const attachLine = names.length
      ? (text ? "\n" : "") + names.map((n) => "已附上：" + String(n)).join("\n")
      : "";
    return clampDisplayText(text + attachLine);
  }

  function buildUserModelText(userInput, attachmentNames) {
    const text = String(userInput || "").trim() || "请结合我附上的材料给出帮助。";
    const names = Array.isArray(attachmentNames) ? attachmentNames.filter(Boolean) : [];
    let model = text;
    if (names.length) {
      model +=
        "\n\n（本轮附上材料：" +
        names.map((n) => String(n)).join("、") +
        "。正文仅在当轮请求中提供，未写入对话历史。）";
    }
    return truncateMarked(model, MODEL_TEXT_MAX).text;
  }

  function buildAttachmentRefs(attachments) {
    const list = Array.isArray(attachments) ? attachments : [];
    return list.map((a, i) => {
      const name = String((a && (a.name || a.fileName)) || "未命名材料");
      const ref = {
        id: String((a && a.id) || "att_" + i + "_" + Date.now().toString(36)),
        name,
      };
      if (a && a.type) ref.type = String(a.type).slice(0, 80);
      if (a && typeof a.size === "number" && Number.isFinite(a.size)) ref.size = a.size;
      return ref;
    });
  }

  /**
   * Legacy / mixed message → safe UI text.
   * Only schemaVersion===2 displayText is trusted (still length-clamped).
   * KIMI experiment `display` is NEVER trusted as UI text.
   */
  function legacyDisplayText(message) {
    try {
      if (!message || typeof message !== "object") {
        return {
          text: "这条历史消息无法显示。",
          forbidExpand: true,
          source: "invalid",
        };
      }

      const role = message.role;

      // Trusted path: explicit schema v2 displayText only
      if (
        message.schemaVersion === SCHEMA_VERSION &&
        typeof message.displayText === "string" &&
        message.displayText.length
      ) {
        return {
          text: clampDisplayText(message.displayText),
          forbidExpand: role === "user",
          source: "displayText-v2",
        };
      }

      const contentRaw = String(
        message.content != null ? message.content : message.modelText || ""
      );
      // Untrusted KIMI field — may hold ~4000 chars of resume/PII; never show as-is
      const untrustedDisplay =
        typeof message.display === "string" ? message.display : "";

      if (role === "assistant") {
        return {
          text: contentRaw || untrustedDisplay,
          forbidExpand: false,
          foldable: true,
          source: "assistant",
        };
      }

      if (role === "user") {
        if (contentRaw) {
          const fromContent = extractUserQuestionFromRaw(contentRaw);
          if (contentRaw.indexOf(LEGACY_ATTACH_SEP) >= 0) {
            return safeUserLegacyResult(contentRaw, "legacy-sep");
          }
          if (fromContent != null && contentRaw.length <= LEGACY_QUESTION_MAX) {
            return { text: fromContent, forbidExpand: false, source: "legacy-short" };
          }
          if (contentRaw.length > LEGACY_QUESTION_MAX) {
            return safeUserLegacyResult(contentRaw, "legacy-content");
          }
          if (fromContent != null) {
            return { text: fromContent, forbidExpand: false, source: "legacy-short" };
          }
        }
        if (untrustedDisplay) {
          return safeUserLegacyResult(untrustedDisplay, "legacy-untrusted-display");
        }
        return {
          text: "这条历史消息无法显示。",
          forbidExpand: true,
          source: "legacy-empty",
        };
      }

      return {
        text: "这条历史消息无法显示。",
        forbidExpand: true,
        source: "unknown-role",
      };
    } catch {
      return {
        text: "这条历史消息无法显示。",
        forbidExpand: true,
        source: "error",
      };
    }
  }

  function safePreviewText(message, maxLen) {
    const n = typeof maxLen === "number" ? maxLen : 40;
    const d = legacyDisplayText(message);
    return String(d.text || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, n);
  }

  function normalizeLoadedMessage(raw) {
    if (!raw || typeof raw !== "object") return null;
    const role = raw.role === "assistant" ? "assistant" : raw.role === "user" ? "user" : null;
    if (!role) return null;

    if (raw.schemaVersion === SCHEMA_VERSION && typeof raw.displayText === "string") {
      const displayText = clampDisplayText(raw.displayText);
      const modelText = truncateMarked(
        String(raw.modelText != null ? raw.modelText : displayText),
        MODEL_TEXT_MAX
      ).text;
      return {
        schemaVersion: SCHEMA_VERSION,
        id: String(raw.id || newMessageId()),
        role,
        displayText,
        modelText,
        attachmentRefs: Array.isArray(raw.attachmentRefs) ? raw.attachmentRefs : [],
        createdAt: String(raw.createdAt || new Date().toISOString()),
        content: modelText,
        _legacyForbidExpand: role === "user",
      };
    }

    // Do not promote untrusted `display` into trusted displayText without scrubbing
    const shown = legacyDisplayText(raw);
    const modelText = truncateMarked(
      String(
        raw.modelText != null
          ? raw.modelText
          : shown.forbidExpand
            ? shown.text
            : raw.content != null
              ? raw.content
              : shown.text
      ),
      MODEL_TEXT_MAX
    ).text;
    return {
      schemaVersion: SCHEMA_VERSION,
      id: String(raw.id || newMessageId()),
      role,
      displayText: shown.text,
      modelText,
      attachmentRefs: Array.isArray(raw.attachmentRefs) ? raw.attachmentRefs : [],
      createdAt: String(raw.createdAt || new Date().toISOString()),
      content: modelText,
      _legacyForbidExpand: !!shown.forbidExpand,
    };
  }

  function toPersistableMessage(m) {
    const role = m.role === "assistant" ? "assistant" : "user";
    const displayText = clampDisplayText(
      typeof m.displayText === "string" ? m.displayText : legacyDisplayText(m).text
    );
    const modelText = truncateMarked(
      String(m.modelText != null ? m.modelText : displayText),
      MODEL_TEXT_MAX
    ).text;
    return {
      schemaVersion: SCHEMA_VERSION,
      id: String(m.id || newMessageId()),
      role,
      displayText,
      modelText,
      attachmentRefs: Array.isArray(m.attachmentRefs) ? m.attachmentRefs : [],
      createdAt: String(m.createdAt || new Date().toISOString()),
    };
  }

  /** Gateway-safe history: only role + content (modelText). */
  function toModelGatewayHistory(messages) {
    const out = [];
    for (const m of messages || []) {
      if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
      const content = String(
        m.modelText != null ? m.modelText : m.content != null ? m.content : ""
      ).slice(0, MODEL_TEXT_MAX);
      out.push({ role: m.role, content });
    }
    return out;
  }

  function foldPlan(text, opts) {
    const forbidExpand = !!(opts && opts.forbidExpand);
    const raw = String(text || "");
    if (forbidExpand) {
      return {
        preview: raw,
        expanded: raw,
        needsFold: false,
        forbidExpand: true,
      };
    }
    if (raw.length <= FOLD_PREVIEW_CHARS) {
      return {
        preview: raw,
        expanded: raw,
        needsFold: false,
        forbidExpand: false,
      };
    }
    const expanded =
      raw.length > FOLD_EXPAND_MAX
        ? raw.slice(0, FOLD_EXPAND_MAX) + "\n\n…（已达展开上限）"
        : raw;
    return {
      preview: raw.slice(0, FOLD_PREVIEW_CHARS) + "\n\n…",
      expanded,
      needsFold: true,
      forbidExpand: false,
    };
  }

  /**
   * Real session-nav guard used by renderer handlers.
   * While a chat request is in flight, switch/new/delete must be blocked.
   */
  function sessionNavGuard(activeChatRequest) {
    if (activeChatRequest && activeChatRequest.requestId) {
      return { allowed: false, message: SESSION_NAV_BLOCK_MESSAGE };
    }
    return { allowed: true, message: null };
  }

  /** Detect forbidden spill markers in persisted JSON text (tests). */
  function persistedJsonLooksClean(jsonText, forbiddenSnippets) {
    const s = String(jsonText || "");
    for (const snip of forbiddenSnippets || []) {
      if (snip && s.includes(snip)) return false;
    }
    return true;
  }

  return {
    SCHEMA_VERSION,
    MODEL_TEXT_MAX,
    DISPLAY_TEXT_MAX,
    LEGACY_QUESTION_MAX,
    FOLD_PREVIEW_CHARS,
    FOLD_EXPAND_MAX,
    LEGACY_ATTACH_SEP,
    SESSION_NAV_BLOCK_MESSAGE,
    newMessageId,
    truncateMarked,
    clampDisplayText,
    extractUserQuestionFromRaw,
    buildUserDisplayText,
    buildUserModelText,
    buildAttachmentRefs,
    legacyDisplayText,
    safePreviewText,
    normalizeLoadedMessage,
    toPersistableMessage,
    toModelGatewayHistory,
    foldPlan,
    sessionNavGuard,
    persistedJsonLooksClean,
  };
});
