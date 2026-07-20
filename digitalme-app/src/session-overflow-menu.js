"use strict";

/**
 * Session list overflow (⋯) menu controller.
 * UMD: CommonJS (tests) and browser (renderer script).
 * No third-party menu library.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DigitalMeSessionOverflowMenu = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  const MENU_Z = 10050;

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
   * @returns {{
   *   close: () => void,
   *   open: (trigger: Element, menu: Element, sessionId: string) => void,
   *   toggle: (trigger: Element, menu: Element, sessionId: string) => void,
   *   handleDocumentPointerDown: (target: EventTarget|null) => void,
   *   handleKeydown: (event: { key?: string }) => void,
   *   isOpen: () => boolean,
   *   openSessionId: () => string|null,
   *   positionMenu: typeof positionMenu
   * }}
   */
  function createSessionOverflowMenuController() {
    let openState = null;

    function close() {
      if (!openState) return;
      const { trigger, menu } = openState;
      if (menu && menu.classList) menu.classList.add("hidden");
      if (trigger && trigger.setAttribute) trigger.setAttribute("aria-expanded", "false");
      openState = null;
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
    MENU_Z,
  };
});
