/**
 * 能力扩展管理器（产品面对用户称「能力扩展」，技术实现为 MCP Client）
 * 骨架：配置 → 连接 stdio 扩展 → 列出工具 → 调用工具
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawnSync } from "node:child_process";

const sessions = new Map();

function npxCommand() {
  return process.platform === "win32" ? "npx.cmd" : "npx";
}

/** Windows 控制台多为 GBK；按平台解码 stderr，避免出现  */
function decodeProcessChunk(chunk) {
  if (chunk == null) return "";
  if (typeof chunk === "string") return chunk;
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  if (process.platform === "win32") {
    try {
      return new TextDecoder("gbk").decode(buf);
    } catch {
      try {
        return new TextDecoder("utf-8").decode(buf);
      } catch {
        return buf.toString("utf8");
      }
    }
  }
  return buf.toString("utf8");
}

function commandExists(command) {
  if (!command) return false;
  if (process.platform === "win32") {
    const r = spawnSync("where.exe", [command], { encoding: "utf8", windowsHide: true });
    return r.status === 0 && String(r.stdout || "").trim().length > 0;
  }
  const r = spawnSync("sh", ["-c", `command -v ${JSON.stringify(command)}`], {
    encoding: "utf8",
  });
  return r.status === 0 && String(r.stdout || "").trim().length > 0;
}

function friendlyMissingCommandHint(command, extId) {
  const cmd = String(command || "");
  if (cmd === "uvx" || cmd === "uv") {
    return [
      `本机未找到「${cmd}」。网页抓取（fetch）依赖 Astral uv 工具链。`,
      "处理办法：",
      "1）安装 uv：https://docs.astral.sh/uv/getting-started/installation/ （装好后重启 Digital Me）",
      "2）或停用「网页抓取」，改用「联网搜索（Brave）」——同样能补联网信息，且用 npx，一般已可用",
      extId ? `（扩展：${extId}）` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (cmd.includes("npx")) {
    return `本机未找到「${cmd}」。请确认已安装 Node.js，并重启 Digital Me 后再试。`;
  }
  return `本机未找到启动命令「${cmd}」，请安装对应运行时后重试。`;
}

export function getSessionStatus() {
  const out = [];
  for (const [id, s] of sessions) {
    out.push({
      id,
      name: s.name,
      status: s.status,
      toolCount: s.tools?.length || 0,
      error: s.error || null,
    });
  }
  return out;
}

function collectStderr(transport, sink) {
  try {
    const stream = transport.stderr;
    if (!stream) return;
    stream.on("data", (chunk) => {
      const text = decodeProcessChunk(chunk);
      sink.buf += text;
      if (sink.buf.length > 4000) sink.buf = sink.buf.slice(-4000);
    });
  } catch {}
}

function looksLikeCommandNotFound(stderr) {
  const s = String(stderr || "");
  return (
    /不是内部或外部命令/.test(s) ||
    /无法识别/.test(s) ||
    /not recognized as an internal or external command/i.test(s) ||
    /command not found/i.test(s) ||
    /No such file or directory/i.test(s)
  );
}

function formatConnectError(err, stderrBuf, command, extId) {
  const msg = err?.message || String(err);
  const stderr = String(stderrBuf || "").trim();

  if (looksLikeCommandNotFound(stderr) || /ENOENT/i.test(msg)) {
    return friendlyMissingCommandHint(command, extId);
  }

  if (!stderr) {
    if (/Connection closed/i.test(msg)) {
      return (
        msg +
        "\n可能原因：扩展进程启动后立即退出（缺依赖、命令错误或包下载失败）。" +
        (command === "uvx"
          ? "\n若使用网页抓取：请确认已安装 uv（提供 uvx），或改用「联网搜索（Brave）」。"
          : "")
      );
    }
    return msg;
  }

  const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-8).join("\n");
  if (looksLikeCommandNotFound(tail)) {
    return friendlyMissingCommandHint(command, extId) + "\n\n原始输出：\n" + tail;
  }
  return msg + "\n--- 扩展进程输出 ---\n" + tail;
}

export async function connectExtension(ext) {
  if (!ext?.id) throw new Error("扩展配置缺少 id");
  if (sessions.has(ext.id)) await disconnectExtension(ext.id);

  const command = ext.command || npxCommand();
  const args = Array.isArray(ext.args) ? ext.args : [];

  // 启动前检查命令是否存在，避免 Windows「不是内部或外部命令」乱码体验
  if (!commandExists(command)) {
    // 兼容：有时配置写 uvx，实际只有 uv.exe
    if (command === "uvx" && commandExists("uv")) {
      // uv 存在但 uvx 不在 PATH 时，仍提示安装/修复 PATH
      throw new Error(
        friendlyMissingCommandHint("uvx", ext.id) +
          "\n检测到本机有 uv，但找不到 uvx；请确认安装完整并已加入 PATH 后重启应用。"
      );
    }
    throw new Error(friendlyMissingCommandHint(command, ext.id));
  }

  const stderrSink = { buf: "" };

  const transport = new StdioClientTransport({
    command,
    args,
    env: {
      ...process.env,
      ...(ext.env || {}),
      // 尽量让子进程输出 UTF-8（部分工具会尊重该变量）
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
    },
    cwd: ext.cwd || undefined,
    stderr: "pipe",
  });

  collectStderr(transport, stderrSink);

  const client = new Client({ name: "digitalme-app", version: "0.1.0" }, { capabilities: {} });
  const session = {
    client,
    transport,
    name: ext.name || ext.id,
    status: "connecting",
    tools: [],
    error: null,
  };
  sessions.set(ext.id, session);

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    session.tools = tools || [];
    session.status = "connected";
    return { id: ext.id, status: "connected", tools: session.tools };
  } catch (e) {
    const detail = formatConnectError(e, stderrSink.buf, command, ext.id);
    session.status = "error";
    session.error = detail;
    try {
      await client.close();
    } catch {}
    sessions.delete(ext.id);
    const err = new Error(detail);
    err.cause = e;
    throw err;
  }
}

export async function disconnectExtension(id) {
  const s = sessions.get(id);
  if (!s) return;
  try {
    await s.client.close();
  } catch {}
  sessions.delete(id);
}

export async function disconnectAll() {
  for (const id of [...sessions.keys()]) await disconnectExtension(id);
}

export function listTools(id) {
  const s = sessions.get(id);
  if (!s || s.status !== "connected") throw new Error("扩展未连接");
  return s.tools;
}

export async function callTool(id, name, args) {
  const s = sessions.get(id);
  if (!s || s.status !== "connected") throw new Error("扩展未连接");
  const result = await s.client.callTool({ name, arguments: args || {} });
  return result;
}
