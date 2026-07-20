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
  const LEGACY_QUESTION_MAX = 500;
  const FOLD_PREVIEW_CHARS = 1600;
  const FOLD_EXPAND_MAX = 8000;
  const LEGACY_ATTACH_SEP = "\n\n---\n以下是我附上的材料正文";

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

  function buildUserDisplayText(userInput, attachmentNames) {
    const text = String(userInput || "").trim();
    const names = Array.isArray(attachmentNames) ? attachmentNames.filter(Boolean) : [];
    const attachLine = names.length
      ? (text ? "\n" : "") + names.map((n) => "已附上：" + String(n)).join("\n")
      : "";
    return text + attachLine;
  }

  function buildUserModelText(userInput, attachmentNames) {
    const text = String(userInput || "").trim() || "请结合我附上的材料给出帮助。";
    const names = Array.isArray(attachmentNames) ? attachmentNames.filter(Boolean) : [];
    let model = text;
    if (names.length) {
      model += "\n\n（本轮附上材料：" + names.map((n) => String(n)).join("、") + "。正文仅在当轮请求中提供，未写入对话历史。）";
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
   * Never returns multi-kilobyte attachment bodies for user turns.
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
      if (typeof message.displayText === "string" && message.displayText.length) {
        return { text: message.displayText, forbidExpand: false, source: "displayText" };
      }
      // KIMI experiment field — usable when present, still fold later in UI
      if (typeof message.display === "string" && message.display.length) {
        return { text: message.display, forbidExpand: false, source: "display" };
      }

      const role = message.role;
      const raw = String(message.content != null ? message.content : message.modelText || "");

      if (role === "assistant") {
        return {
          text: raw,
          forbidExpand: false,
          foldable: true,
          source: "assistant",
        };
      }

      if (role === "user") {
        const sepIdx = raw.indexOf(LEGACY_ATTACH_SEP);
        if (sepIdx >= 0) {
          let q = raw.slice(0, sepIdx).trim();
          if (q.length > LEGACY_QUESTION_MAX) q = q.slice(0, LEGACY_QUESTION_MAX) + "…";
          const body =
            (q ? q + "\n" : "") + "此历史消息曾包含材料，材料正文已隐藏。";
          return { text: body, forbidExpand: true, source: "legacy-sep" };
        }
        // Long opaque legacy user payload — do not show first 4000 chars
        if (raw.length > LEGACY_QUESTION_MAX) {
          return {
            text: "这条历史消息包含较长材料，正文已隐藏。",
            forbidExpand: true,
            source: "legacy-long",
          };
        }
        return { text: raw, forbidExpand: false, source: "legacy-short" };
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
      const modelText = truncateMarked(
        String(raw.modelText != null ? raw.modelText : raw.displayText),
        MODEL_TEXT_MAX
      ).text;
      return {
        schemaVersion: SCHEMA_VERSION,
        id: String(raw.id || newMessageId()),
        role,
        displayText: raw.displayText,
        modelText,
        attachmentRefs: Array.isArray(raw.attachmentRefs) ? raw.attachmentRefs : [],
        createdAt: String(raw.createdAt || new Date().toISOString()),
        content: modelText,
      };
    }

    const shown = legacyDisplayText(raw);
    const modelText = truncateMarked(
      String(raw.modelText != null ? raw.modelText : shown.text),
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
    const displayText =
      typeof m.displayText === "string" ? m.displayText : legacyDisplayText(m).text;
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
    LEGACY_QUESTION_MAX,
    FOLD_PREVIEW_CHARS,
    FOLD_EXPAND_MAX,
    LEGACY_ATTACH_SEP,
    newMessageId,
    truncateMarked,
    buildUserDisplayText,
    buildUserModelText,
    buildAttachmentRefs,
    legacyDisplayText,
    safePreviewText,
    normalizeLoadedMessage,
    toPersistableMessage,
    toModelGatewayHistory,
    foldPlan,
    persistedJsonLooksClean,
  };
});
