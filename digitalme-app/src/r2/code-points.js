"use strict";

/**
 * Unicode code point helpers (not UTF-16 code units).
 */

function codePointCount(text) {
  const s = String(text || "");
  let n = 0;
  for (const _ of s) n += 1;
  return n;
}

function sliceCodePoints(text, maxPoints) {
  const s = String(text || "");
  const max = Math.max(0, Number(maxPoints) || 0);
  if (max === 0) return "";
  let out = "";
  let n = 0;
  for (const ch of s) {
    if (n >= max) break;
    out += ch;
    n += 1;
  }
  return out;
}

function clampCodePoints(text, maxPoints, suffix) {
  const s = String(text || "");
  if (codePointCount(s) <= maxPoints) return s;
  const cut = sliceCodePoints(s, maxPoints);
  return suffix != null ? cut + String(suffix) : cut;
}

module.exports = {
  codePointCount,
  sliceCodePoints,
  clampCodePoints,
};
