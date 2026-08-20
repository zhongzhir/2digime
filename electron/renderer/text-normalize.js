/**
 * 纯文本规范化 — 仅 CRLF/CR → LF,不改句子内容。
 * 供渲染层与 Node 测试共用。
 */
function normalizeNewlines(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { normalizeNewlines };
}
if (typeof window !== "undefined") {
  window.DigitalMeText = { normalizeNewlines };
}
