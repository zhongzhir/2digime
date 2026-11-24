"use strict";

function externalWindowOpenDecision(url, openExternal) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { action: "deny" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { action: "deny" };
  }

  try {
    Promise.resolve(openExternal(parsed.href)).catch(() => {});
  } catch {
    // The page remains inside 2digime if the operating system cannot open a browser.
  }
  return { action: "deny" };
}

module.exports = { externalWindowOpenDecision };
