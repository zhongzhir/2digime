"use strict";

/**
 * R1 shell load helpers — local file production-load vs explicit Vite dev URL.
 */

const fs = require("node:fs");
const path = require("node:path");

const LEGACY_INDEX = path.join(__dirname, "renderer", "index.html");
const NEXT_DIST_INDEX = path.join(__dirname, "renderer-next", "dist", "index.html");

function getLegacyIndexPath() {
  return LEGACY_INDEX;
}

function getNextDistIndexPath() {
  return NEXT_DIST_INDEX;
}

function nextDistExists() {
  return fs.existsSync(NEXT_DIST_INDEX);
}

function resolveViteDevUrl() {
  const raw = String(process.env.DIGITALME_VITE_DEV_URL || "http://127.0.0.1:5173/").trim();
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Match page URL to the resolved Vite dev origin (protocol + hostname + port),
 * not a hard-coded 5173 or startsWith prefix.
 */
function isViteDevPageUrl(url) {
  if (process.env.DIGITALME_VITE_DEV !== "1") return false;
  const resolved = resolveViteDevUrl();
  if (!resolved) return false;
  try {
    const page = new URL(String(url || ""));
    const expected = new URL(resolved);
    return page.origin === expected.origin;
  } catch {
    return false;
  }
}

/**
 * @param {import('electron').BrowserWindow} win
 * @param {{ viteDev?: boolean }} opts
 */
async function loadLegacyEntry(win) {
  await win.loadFile(LEGACY_INDEX);
  return { ok: true, mode: "legacy_file", path: LEGACY_INDEX };
}

/**
 * @param {import('electron').BrowserWindow} win
 * @param {{ viteDev?: boolean }} opts
 */
async function loadNextEntry(win, opts = {}) {
  const viteDev = opts.viteDev === true || process.env.DIGITALME_VITE_DEV === "1";
  if (viteDev) {
    const url = resolveViteDevUrl();
    if (!url) {
      const err = new Error("vite_dev_url_invalid");
      err.code = "vite_dev_url_invalid";
      throw err;
    }
    await win.loadURL(url);
    return { ok: true, mode: "vite_dev", url };
  }
  if (!nextDistExists()) {
    const err = new Error("next_build_missing");
    err.code = "next_build_missing";
    throw err;
  }
  await win.loadFile(NEXT_DIST_INDEX);
  return { ok: true, mode: "production_load", path: NEXT_DIST_INDEX };
}

function isNextPageUrl(url) {
  const s = String(url || "");
  if (!s) return false;
  if (s.includes("renderer-next")) return true;
  return isViteDevPageUrl(s);
}

module.exports = {
  getLegacyIndexPath,
  getNextDistIndexPath,
  nextDistExists,
  resolveViteDevUrl,
  isViteDevPageUrl,
  loadLegacyEntry,
  loadNextEntry,
  isNextPageUrl,
};
