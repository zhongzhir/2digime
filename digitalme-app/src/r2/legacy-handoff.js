"use strict";

/**
 * One-shot legacy navigation intent (libraryId / scene only — never body).
 */
function createLegacyHandoff() {
  /** @type {null | { libraryId: string, scene: string, createdAt: string }} */
  let intent = null;

  function setOpenLibraryItem(libraryId, scene) {
    intent = {
      libraryId: String(libraryId || ""),
      scene: String(scene || "library"),
      createdAt: new Date().toISOString(),
    };
    return { ok: true, intent: { ...intent } };
  }

  function consume() {
    const out = intent;
    intent = null;
    return out;
  }

  function peek() {
    return intent ? { ...intent } : null;
  }

  function clear() {
    intent = null;
  }

  return { setOpenLibraryItem, consume, peek, clear };
}

module.exports = { createLegacyHandoff };
