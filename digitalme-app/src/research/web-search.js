"use strict";

const https = require("node:https");

/** Research scene default capabilities (third-party MCP + built-in fallback). */
const RESEARCH_DEFAULT_EXTENSIONS = ["fetch", "brave-search"];

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": "DigitalMe-Research/1.0",
          Accept: "text/html,application/json",
          ...headers,
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          httpsGet(res.headers.location, headers).then(resolve).catch(reject);
          return;
        }
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(data));
      }
    );
    req.on("error", reject);
    req.setTimeout(20000, () => req.destroy(new Error("搜索请求超时")));
  });
}

function parseDuckDuckGoHtml(html) {
  const results = [];
  const linkRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  const links = [];
  let m;
  while ((m = linkRe.exec(html))) {
    let url = m[1];
    if (url.startsWith("//duckduckgo.com/l/?")) {
      const uddg = url.match(/uddg=([^&]+)/);
      if (uddg) url = decodeURIComponent(uddg[1]);
    }
    const title = m[2].replace(/<[^>]+>/g, "").trim();
    if (url && title) links.push({ url, title });
  }
  const snippets = [];
  while ((m = snippetRe.exec(html))) {
    snippets.push(m[1].replace(/<[^>]+>/g, "").trim());
  }
  for (let i = 0; i < links.length && results.length < 8; i++) {
    results.push({
      title: links[i].title.slice(0, 200),
      url: links[i].url,
      snippet: (snippets[i] || "").slice(0, 400),
      provider: "duckduckgo",
    });
  }
  return results;
}

function parseBraveToolResult(raw) {
  const text = typeof raw === "string" ? raw : JSON.stringify(raw || "");
  const results = [];
  try {
    const data = typeof raw === "object" ? raw : JSON.parse(text);
    const items = data?.web?.results || data?.results || [];
    for (const it of items) {
      if (!it.url && !it.link) continue;
      results.push({
        title: String(it.title || it.name || it.url || "未命名").slice(0, 200),
        url: it.url || it.link,
        snippet: String(it.description || it.snippet || "").slice(0, 400),
        provider: "brave",
      });
    }
    if (results.length) return results;
  } catch {
    // fall through to text parse
  }
  const lineRe = /(?:^|\n)\s*(?:\d+\.|[-*])\s*\[?([^\]\n]+)\]?\s*(?:\(|\[)?(https?:\/\/[^\s)\]]+)/gim;
  let m;
  while ((m = lineRe.exec(text))) {
    results.push({ title: m[1].trim().slice(0, 200), url: m[2].trim(), snippet: "", provider: "brave" });
  }
  return results.slice(0, 8);
}

async function searchViaBrave(em, query) {
  const st = em.getSessionStatus().find((s) => s.id === "brave-search" && s.status === "connected");
  if (!st) return null;
  try {
    const result = await em.callTool("brave-search", "brave_web_search", { query, count: 8 });
    const parsed = parseBraveToolResult(result);
    return parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

async function searchViaDuckDuckGo(query) {
  const q = encodeURIComponent(query);
  const html = await httpsGet(`https://html.duckduckgo.com/html/?q=${q}`);
  const results = parseDuckDuckGoHtml(html);
  if (!results.length) throw new Error("未找到相关网页结果，请换关键词或稍后再试。");
  return results;
}

async function searchWeb(em, query) {
  const q = String(query || "").trim();
  if (!q) throw new Error("请提供搜索关键词。");
  let results = null;
  let provider = "duckduckgo";
  if (em) {
    results = await searchViaBrave(em, q);
    if (results?.length) provider = "brave";
  }
  if (!results?.length) {
    results = await searchViaDuckDuckGo(q);
    provider = "duckduckgo";
  }
  return { query: q, provider, results };
}

module.exports = {
  RESEARCH_DEFAULT_EXTENSIONS,
  searchWeb,
  searchViaBrave,
  searchViaDuckDuckGo,
};
