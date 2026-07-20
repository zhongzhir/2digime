"use strict";

/**
 * Session list overflow (⋯) menu + title helpers.
 * UMD: CommonJS (tests) and browser (renderer script).
 * No third-party menu library. No prompt/confirm/alert.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DigitalMeSessionOverflowMenu = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const MENU_Z = 10050;
  /** Match sessions.renameSession slice(0, 60). */
  const SESSION_TITLE_MAX = 60;

  function normalizeSessionTitle(raw, maxLen) {
    const limit =
      typeof maxLen === "number" && maxLen > 0 ? maxLen : SESSION_TITLE_MAX;
    const title = String(raw == null ? "" : raw).trim();
    if (!title) {
      return { ok: false, error: "请输入名称", title: "" };
    }
    return { ok: true, error: null, title: title.slice(0, limit) };
  }

  function positionMenu(trigger, menu) {
    if (!trigger || !menu || typeof trigger.getBoundingClientRect !== "function") return;
    const r = trigger.getBoundingClientRect();
    const menuWidth = Math.max(112, menu.offsetWidth || 112);
    const left = Math.min(
      Math.max(8, r.right - menuWidth),
      Math.max(8, (typeof window !== "undefined" ? window.innerWidth : 800) - menuWidth - 8)
    );
    const top = Math.min(
      r.bottom + 4,
      Math.max(8, (typeof window !== "undefined" ? window.innerHeight : 600) - 8)
    );
    menu.style.position = "fixed";
    menu.style.top = `${Math.round(top)}px`;
    menu.style.left = `${Math.round(left)}px`;
    menu.style.zIndex = String(MENU_Z);
  }

  /**
   * @param {{ onClose?: (state: { trigger: Element, menu: Element, sessionId: string|null }|null) => void }} [options]
   */
  function createSessionOverflowMenuController(options) {
    const opts = options && typeof options === "object" ? options : {};
    let openState = null;

    function close() {
      if (!openState) return;
      const prev = openState;
      const { trigger, menu } = prev;
      if (menu && menu.classList) menu.classList.add("hidden");
      if (trigger && trigger.setAttribute) trigger.setAttribute("aria-expanded", "false");
      openState = null;
      if (typeof opts.onClose === "function") {
        try {
          opts.onClose(prev);
        } catch {
          /* ignore listener errors */
        }
      }
    }

    function open(trigger, menu, sessionId) {
      if (!trigger || !menu) return;
      if (openState && openState.trigger === trigger) {
        close();
        return;
      }
      close();
      positionMenu(trigger, menu);
      menu.classList.remove("hidden");
      trigger.setAttribute("aria-expanded", "true");
      openState = { trigger, menu, sessionId: sessionId || null };
    }

    function toggle(trigger, menu, sessionId) {
      if (openState && openState.trigger === trigger) {
        close();
        return;
      }
      open(trigger, menu, sessionId);
    }

    function handleDocumentPointerDown(target) {
      if (!openState) return;
      const node = target && target.nodeType === 3 ? target.parentElement : target;
      if (!node) {
        close();
        return;
      }
      const { trigger, menu } = openState;
      if (
        (trigger && typeof trigger.contains === "function" && trigger.contains(node)) ||
        (menu && typeof menu.contains === "function" && menu.contains(node))
      ) {
        return;
      }
      close();
    }

    function handleKeydown(event) {
      if (!event) return;
      if (event.key === "Escape" || event.key === "Esc") close();
    }

    return {
      close,
      open,
      toggle,
      handleDocumentPointerDown,
      handleKeydown,
      isOpen() {
        return !!openState;
      },
      openSessionId() {
        return openState ? openState.sessionId : null;
      },
      positionMenu,
    };
  }

  return {
    createSessionOverflowMenuController,
    positionMenu,
    normalizeSessionTitle,
    MENU_Z,
    SESSION_TITLE_MAX,
  };
});
