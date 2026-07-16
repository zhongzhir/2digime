/**
 * 对话内使用已连接的能力扩展（MCP tools → OpenAI-compatible tool calls）
 */

export function mcpToolToOpenAI(extensionId, tool) {
  const safeExt = String(extensionId).replace(/[^a-zA-Z0-9_]/g, "_");
  const name = `${safeExt}__${tool.name}`.slice(0, 64);
  return {
    type: "function",
    function: {
      name,
      description: tool.description || `${extensionId}: ${tool.name}`,
      parameters: tool.inputSchema || { type: "object", properties: {} },
    },
    _meta: { extensionId, toolName: tool.name },
  };
}

export function formatToolResult(result) {
  if (result == null) return "";
  if (typeof result === "string") return result;
  if (result.content && Array.isArray(result.content)) {
    return result.content
      .map((c) => (c.type === "text" ? c.text : JSON.stringify(c)))
      .join("\n");
  }
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

export function buildCapabilitiesSystemAppend(toolEntries) {
  if (!toolEntries.length) return "";

  const byExt = new Map();
  for (const t of toolEntries) {
    if (!byExt.has(t.extensionId)) {
      byExt.set(t.extensionId, { name: t.extensionName || t.extensionId, tools: [] });
    }
    byExt.get(t.extensionId).tools.push(t.name);
  }

  let text =
    "\n\n---\n\n## 当前已连接的能力扩展（对话中可调用）\n\n" +
    "以下工具**已经启用并连接**，你必须在需要时通过 function calling 调用它们。\n" +
    "**禁止**再回答「我无法联网」「无法访问网页」——应改用工具，或如实说明需要用户提供具体 URL。\n\n";

  for (const [id, info] of byExt) {
    text += `- **${info.name}**：${info.tools.join("、")}\n`;
  }

  text +=
    "\n**能力说明**：\n" +
    "- 「网页抓取」：在用户给出**具体链接**时抓取正文；若只有主题没有链接，请说明可提供 URL 后你再抓取，或给出可查证的官方站点让用户确认链接。\n" +
    "- 「本地文件读写」：读写用户授权目录中的文件。\n" +
    "- 「知识图谱记忆」：查询/写入结构化记忆。\n";

  return text;
}

export async function collectConnectedToolEntries(em, enabledExtensions) {
  const status = em.getSessionStatus();
  const entries = [];
  for (const ext of enabledExtensions) {
    const st = status.find((s) => s.id === ext.id);
    if (st?.status !== "connected") continue;
    try {
      const tools = em.listTools(ext.id);
      for (const tool of tools) {
        entries.push({
          extensionId: ext.id,
          extensionName: ext.name,
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        });
      }
    } catch {}
  }
  return entries;
}

export async function ensureEnabledExtensionsConnected(em, enabledExtensions) {
  const status = em.getSessionStatus();
  for (const ext of enabledExtensions) {
    const st = status.find((s) => s.id === ext.id);
    if (st?.status === "connected") continue;
    try {
      await em.connectExtension(ext);
    } catch {}
  }
}

export function extractUrls(text) {
  return [...String(text || "").matchAll(/https?:\/\/[^\s<>"{}|\\^`[\]]+/gi)].map((m) => m[0]);
}
