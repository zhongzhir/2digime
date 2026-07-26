"use strict";

/**
 * Minimal Markdown → self-contained HTML (no new dependencies).
 */

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inlineFormat(text) {
  let s = escapeHtml(text);
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  return s;
}

function markdownToHtml(md, { title } = {}) {
  const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
  const body = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      body.push("</ul>");
      inList = false;
    }
  };
  for (const line of lines) {
    if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) {
        body.push("<ul>");
        inList = true;
      }
      body.push("<li>" + inlineFormat(line.replace(/^\s*[-*]\s+/, "")) + "</li>");
      continue;
    }
    closeList();
    if (!line.trim()) {
      body.push("");
      continue;
    }
    if (/^###\s+/.test(line)) {
      body.push("<h3>" + inlineFormat(line.replace(/^###\s+/, "")) + "</h3>");
    } else if (/^##\s+/.test(line)) {
      body.push("<h2>" + inlineFormat(line.replace(/^##\s+/, "")) + "</h2>");
    } else if (/^#\s+/.test(line)) {
      body.push("<h1>" + inlineFormat(line.replace(/^#\s+/, "")) + "</h1>");
    } else {
      body.push("<p>" + inlineFormat(line) + "</p>");
    }
  }
  closeList();
  const docTitle = escapeHtml(title || "成果");
  return (
    "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\"/>\n" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>\n" +
    "<title>" +
    docTitle +
    "</title>\n<style>\n" +
    "body{font-family:Segoe UI,Microsoft YaHei,sans-serif;line-height:1.6;max-width:48rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a;}" +
    "h1,h2,h3{line-height:1.25;} code{background:#f4f4f5;padding:0.1em 0.35em;border-radius:4px;}" +
    "ul{padding-left:1.4rem;}\n</style>\n</head>\n<body>\n" +
    body.join("\n") +
    "\n</body>\n</html>\n"
  );
}

function slidesToHtmlDeck(plan) {
  const title = escapeHtml(plan.title || "演示文稿");
  const slides = Array.isArray(plan.slides) ? plan.slides : [];
  const sections = slides
    .map((sl, i) => {
      const bullets = (sl.bullets || [])
        .map((b) => "<li>" + escapeHtml(b) + "</li>")
        .join("");
      return (
        `<section class="slide" id="slide-${i + 1}">` +
        `<h2>${escapeHtml(sl.title || "第 " + (i + 1) + " 页")}</h2>` +
        (bullets ? `<ul>${bullets}</ul>` : "") +
        `</section>`
      );
    })
    .join("\n");
  return (
    "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n<meta charset=\"utf-8\"/>\n" +
    `<title>${title}</title>\n<style>\n` +
    "body{font-family:Segoe UI,Microsoft YaHei,sans-serif;margin:0;background:#0f172a;color:#e2e8f0;}" +
    ".slide{min-height:100vh;padding:3rem 4rem;box-sizing:border-box;border-bottom:1px solid #334155;}" +
    "h1{font-size:2.4rem;} h2{font-size:1.8rem;} ul{font-size:1.2rem;line-height:1.7;}" +
    "</style>\n</head>\n<body>\n" +
    `<section class="slide"><h1>${title}</h1>` +
    (plan.subtitle ? `<p>${escapeHtml(plan.subtitle)}</p>` : "") +
    `</section>\n${sections}\n` +
    (plan.closing
      ? `<section class="slide"><h1>${escapeHtml(plan.closing)}</h1></section>\n`
      : "") +
    "</body>\n</html>\n"
  );
}

module.exports = {
  escapeHtml,
  markdownToHtml,
  slidesToHtmlDeck,
};
