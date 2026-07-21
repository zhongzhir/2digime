"use strict";

const chatMessages = require("../chat-message-model");
const { codePointCount, sliceCodePoints } = require("./code-points");

const ARTIFACT_PREVIEW_MAX = 8000;

function safeAttachmentRefs(refs) {
  if (!Array.isArray(refs)) return [];
  return refs.map((r, i) => {
    const out = {
      id: String((r && r.id) || "att_" + i),
      name: String((r && r.name) || "未命名材料"),
    };
    if (r && r.type) out.type = String(r.type).slice(0, 80);
    if (r && typeof r.size === "number" && Number.isFinite(r.size)) out.size = r.size;
    return out;
  });
}

function linkedArtifactCard(session) {
  const artifacts = Array.isArray(session && session.artifacts) ? session.artifacts : [];
  const first = artifacts.find((a) => a && (a.libraryId || a.title || a.id));
  if (!first && !(session && session.linkedLibraryId)) {
    return null;
  }
  const libraryId =
    (first && (first.libraryId || first.id)) || session.linkedLibraryId || null;
  const title =
    (first && typeof first.title === "string" && first.title.trim()) ||
    (session && session.linkedArtifactTitle) ||
    "已关联文稿";
  return {
    libraryId: libraryId ? String(libraryId) : null,
    title: String(title).slice(0, 120),
    label: "已关联文稿",
  };
}

/**
 * Controlled artifact preview for UI: at most 8000 code points + frozen notice.
 * Never returns the overflow body.
 */
function buildArtifactPreviewDisplay(fullText) {
  const notice = chatMessages.ARTIFACT_PREVIEW_TRUNCATE_NOTICE;
  const s = String(fullText || "");
  const count = codePointCount(s);
  if (count <= ARTIFACT_PREVIEW_MAX) {
    return { text: s, truncated: false, notice: null };
  }
  return {
    text: sliceCodePoints(s, ARTIFACT_PREVIEW_MAX),
    truncated: true,
    notice,
  };
}

function messageToViewDto(raw) {
  try {
    const n = chatMessages.normalizeLoadedMessage(raw);
    if (!n) {
      return {
        id: "m_bad_" + Date.now().toString(36),
        role: "user",
        displayText: "这条历史消息无法显示。",
        attachmentRefs: [],
        createdAt: new Date().toISOString(),
        _broken: true,
      };
    }
    return {
      id: n.id,
      role: n.role,
      displayText: n.displayText,
      attachmentRefs: safeAttachmentRefs(n.attachmentRefs),
      createdAt: n.createdAt,
      forbidExpand: !!n._legacyForbidExpand,
    };
  } catch {
    return {
      id: "m_bad_" + Date.now().toString(36),
      role: "user",
      displayText: "这条历史消息无法显示。",
      attachmentRefs: [],
      createdAt: new Date().toISOString(),
      _broken: true,
    };
  }
}

/**
 * Strip modelText, paths, bodies — SessionViewDTO only.
 */
function toSessionViewDto(session) {
  if (!session || typeof session !== "object") return null;
  const messages = [];
  for (const m of session.messages || []) {
    try {
      messages.push(messageToViewDto(m));
    } catch {
      messages.push({
        id: "m_bad_" + Date.now().toString(36),
        role: "user",
        displayText: "这条历史消息无法显示。",
        attachmentRefs: [],
        createdAt: new Date().toISOString(),
        _broken: true,
      });
    }
  }
  return {
    id: String(session.id),
    title: String(session.title || "未命名"),
    createdAt: session.createdAt || null,
    updatedAt: session.updatedAt || null,
    messages,
    linkedArtifact: linkedArtifactCard(session),
  };
}

function toSessionListItem(session) {
  if (!session || typeof session !== "object") return null;
  const firstUser = (session.messages || []).find((m) => m && m.role === "user");
  let preview = "";
  try {
    preview = firstUser ? chatMessages.safePreviewText(firstUser, 40) : "";
  } catch {
    preview = "";
  }
  return {
    id: String(session.id),
    title: String(session.title || "未命名"),
    updatedAt: session.updatedAt || null,
    createdAt: session.createdAt || null,
    preview,
    broken: session._broken === true,
  };
}

module.exports = {
  ARTIFACT_PREVIEW_MAX,
  safeAttachmentRefs,
  linkedArtifactCard,
  buildArtifactPreviewDisplay,
  messageToViewDto,
  toSessionViewDto,
  toSessionListItem,
};
