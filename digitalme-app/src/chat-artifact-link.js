"use strict";

/**
 * Chat-page linked artifact card — never mounts artifact body into chat DOM.
 * UMD for renderer + CommonJS tests.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DigitalMeChatArtifactLink = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const DEFAULT_TITLE = "已关联文稿";

  function buildLinkCardState(artifact, linkedLibraryId) {
    const hasLink = !!(artifact || linkedLibraryId);
    if (!hasLink) {
      return {
        visible: false,
        label: DEFAULT_TITLE,
        title: "",
        libraryId: null,
      };
    }
    const title =
      artifact && typeof artifact.title === "string" && artifact.title.trim()
        ? artifact.title.trim().slice(0, 120)
        : DEFAULT_TITLE;
    const libraryId =
      (artifact && artifact.libraryId) || linkedLibraryId || null;
    return {
      visible: true,
      label: DEFAULT_TITLE,
      title,
      libraryId: libraryId ? String(libraryId) : null,
    };
  }

  function setHidden(el, hidden) {
    if (!el || !el.classList) return;
    if (hidden) el.classList.add("hidden");
    else el.classList.remove("hidden");
  }

  /**
   * Apply compact card + force-clear legacy body nodes.
   * @param {Document|object} doc - real document or harness with getElementById
   * @param {object} state - from buildLinkCardState
   */
  function applyLinkCardToDom(doc, state) {
    const get = (id) => (doc && typeof doc.getElementById === "function" ? doc.getElementById(id) : null);

    // Legacy panel must never show body on chat page
    const panel = get("artifact-panel");
    if (panel) {
      setHidden(panel, true);
      if (panel.classList) panel.classList.remove("has-artifact");
      if (panel.setAttribute) panel.setAttribute("aria-hidden", "true");
    }
    const contentEl = get("artifact-content");
    if (contentEl) contentEl.textContent = "";
    const legacyTitle = get("artifact-title");
    if (legacyTitle) legacyTitle.textContent = "";
    const hint = get("artifact-link-hint");
    if (hint) {
      hint.textContent = "";
      setHidden(hint, true);
    }
    const empty = get("artifact-empty");
    if (empty) setHidden(empty, true);
    const body = get("artifact-body");
    if (body) setHidden(body, true);

    const card = get("chat-artifact-link");
    if (!card) return { applied: false, reason: "missing-card" };

    if (!state || !state.visible) {
      setHidden(card, true);
      const t = get("chat-artifact-link-title");
      if (t) t.textContent = "";
      return { applied: true, visible: false };
    }

    setHidden(card, false);
    const label = get("chat-artifact-link-label");
    if (label) label.textContent = state.label || DEFAULT_TITLE;
    const titleEl = get("chat-artifact-link-title");
    if (titleEl) titleEl.textContent = state.title || DEFAULT_TITLE;
    return { applied: true, visible: true, title: state.title };
  }

  /** Collect text from chat surface for spill tests (excludes workspace). */
  function chatSurfaceText(doc) {
    const get = (id) => (doc && typeof doc.getElementById === "function" ? doc.getElementById(id) : null);
    const parts = [];
    for (const id of [
      "view-chat",
      "chat-artifact-link",
      "messages",
      "composer",
      "artifact-panel",
      "artifact-content",
      "artifact-link-hint",
    ]) {
      const el = get(id);
      if (el && el.textContent) parts.push(el.textContent);
    }
    return parts.join("\n");
  }

  function assertNoForbiddenSnippets(text, snippets) {
    const s = String(text || "");
    const hits = [];
    for (const snip of snippets || []) {
      if (snip && s.includes(snip)) hits.push(snip);
    }
    return hits;
  }

  return {
    DEFAULT_TITLE,
    buildLinkCardState,
    applyLinkCardToDom,
    chatSurfaceText,
    assertNoForbiddenSnippets,
  };
});
