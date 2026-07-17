"use strict";

/**
 * Minimal PE VersionInfo reader (no native deps).
 * Extracts OriginalFilename / InternalName / FileDescription / ProductName when present.
 */

const fs = require("node:fs");

function readUInt32LE(buf, off) {
  return buf.readUInt32LE(off);
}

function readUInt16LE(buf, off) {
  return buf.readUInt16LE(off);
}

function isPeExecutable(buf) {
  if (!buf || buf.length < 0x40) return false;
  if (buf[0] !== 0x4d || buf[1] !== 0x5a) return false; // MZ
  const peOff = readUInt32LE(buf, 0x3c);
  if (peOff <= 0 || peOff + 4 >= buf.length) return false;
  return buf[peOff] === 0x50 && buf[peOff + 1] === 0x45; // PE
}

function decodeUtf16z(buf, start, maxBytes) {
  const end = Math.min(buf.length, start + maxBytes);
  const chars = [];
  for (let i = start; i + 1 < end; i += 2) {
    const code = buf.readUInt16LE(i);
    if (code === 0) break;
    chars.push(String.fromCharCode(code));
  }
  return chars.join("");
}

/**
 * Scan PE for UTF-16LE VersionInfo keys. Best-effort; fail-closed callers treat missing as unknown.
 */
function extractVersionStrings(filePath) {
  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch {
    return { ok: false, reason: "read_failed" };
  }
  if (!isPeExecutable(buf)) {
    return { ok: false, reason: "not_pe", isPe: false };
  }

  const keys = ["OriginalFilename", "InternalName", "FileDescription", "ProductName", "CompanyName"];
  const found = Object.create(null);
  for (const key of keys) {
    const needle = Buffer.from(key + "\0", "utf16le");
    let idx = buf.indexOf(needle);
    while (idx !== -1) {
      const valueStart = idx + needle.length;
      // Align to 32-bit boundary as VERSIONINFO does.
      let aligned = valueStart;
      while (aligned % 4 !== 0) aligned += 1;
      if (aligned + 2 < buf.length) {
        const value = decodeUtf16z(buf, aligned, 512).trim();
        if (value) {
          found[key] = value;
          break;
        }
      }
      idx = buf.indexOf(needle, idx + 2);
    }
  }

  return {
    ok: true,
    isPe: true,
    originalFilename: found.OriginalFilename || "",
    internalName: found.InternalName || "",
    fileDescription: found.FileDescription || "",
    productName: found.ProductName || "",
    companyName: found.CompanyName || "",
  };
}

function normalizeIdentityToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\.exe$/i, "");
}

module.exports = {
  isPeExecutable,
  extractVersionStrings,
  normalizeIdentityToken,
};
