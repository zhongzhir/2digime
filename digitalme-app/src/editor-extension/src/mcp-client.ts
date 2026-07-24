/**
 * Digital Me MCP client wrapper for the editor extension.
 *
 * Connects to the Digital Me MCP server (src/mcp-server, `dm-mcp` command)
 * over stdio and exposes its Resources / Tools as typed helpers.
 *
 * This module intentionally does NOT import "vscode" so it can be loaded in
 * plain Node (see scripts/test-editor-extension.cjs).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export const DEFAULT_SERVER_COMMAND = "dm-mcp";
export const CLIENT_NAME = "digitalme-editor-extension";
export const CLIENT_VERSION = "0.1.0";

/** Spawn description for the MCP server process. */
export interface DmMcpServerSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface ResolveServerSpecOptions {
  command?: string;
  args?: string[];
  packageDir?: string;
}

/**
 * Build the spawn spec for the MCP server. Defaults to the `dm-mcp` command
 * on PATH; a non-empty packageDir is forwarded as `--package-dir <dir>`.
 */
export function resolveServerSpec(options: ResolveServerSpecOptions = {}): DmMcpServerSpec {
  const command = String(options.command || "").trim() || DEFAULT_SERVER_COMMAND;
  const args = Array.isArray(options.args) ? options.args.map(String) : [];
  const packageDir = String(options.packageDir || "").trim();
  if (packageDir) {
    args.push("--package-dir", packageDir);
  }
  return { command, args };
}

export interface DmResourceInfo {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface DmToolInfo {
  name: string;
  description: string;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export class DigitalMeMcpClient {
  private client: Client | null = null;
  private connecting: Promise<void> | null = null;

  constructor(readonly spec: DmMcpServerSpec) {}

  get connected(): boolean {
    return this.client !== null;
  }

  async connect(): Promise<void> {
    if (this.client) return;
    if (!this.connecting) {
      this.connecting = this.doConnect().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  private async doConnect(): Promise<void> {
    const transport = new StdioClientTransport({
      command: this.spec.command,
      args: this.spec.args,
      env: this.spec.env,
      cwd: this.spec.cwd,
      // The server logs to stderr only; inherit so logs surface in the host.
      stderr: "inherit",
    });
    const client = new Client(
      { name: CLIENT_NAME, version: CLIENT_VERSION },
      { capabilities: {} }
    );
    try {
      await client.connect(transport);
    } catch (err) {
      try {
        await transport.close();
      } catch {
        /* ignore */
      }
      throw new Error(
        `无法通过 stdio 启动 Digital Me MCP Server（命令：${this.spec.command}）：${errorMessage(err)}`
      );
    }
    this.client = client;
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    }
  }

  private requireClient(): Client {
    if (!this.client) {
      throw new Error("尚未连接到 Digital Me MCP Server。");
    }
    return this.client;
  }

  async listResources(): Promise<DmResourceInfo[]> {
    const { resources } = await this.requireClient().listResources();
    return resources.map((r) => ({
      uri: String(r.uri),
      name: String(r.name || r.uri),
      description: String(r.description || ""),
      mimeType: String(r.mimeType || ""),
    }));
  }

  async readResourceText(uri: string): Promise<string> {
    const result = (await this.requireClient().readResource({ uri })) as {
      contents?: Array<{ text?: unknown }>;
    };
    const item = (result.contents || []).find((c) => typeof c.text === "string");
    return item ? String(item.text) : "";
  }

  async listTools(): Promise<DmToolInfo[]> {
    const { tools } = await this.requireClient().listTools();
    return tools.map((t) => ({
      name: String(t.name),
      description: String(t.description || ""),
    }));
  }

  /**
   * Call a dm_* tool and return its first text content item.
   * Throws when the tool reports isError or returns no text.
   */
  async callToolText(name: string, args: Record<string, unknown> = {}): Promise<string> {
    const result = (await this.requireClient().callTool({ name, arguments: args })) as {
      content?: Array<{ type?: unknown; text?: unknown }>;
      isError?: boolean;
    };
    const item = (result.content || []).find(
      (c) => c && c.type === "text" && typeof c.text === "string"
    );
    const text = item ? String(item.text) : "";
    if (result.isError) {
      throw new Error(text || `工具 ${name} 执行失败。`);
    }
    if (!item) {
      throw new Error(`工具 ${name} 未返回文本内容。`);
    }
    return text;
  }

  /** dm_get_context: goal-related personalized context excerpts (markdown). */
  getContext(goal: string): Promise<string> {
    return this.callToolText("dm_get_context", { goal });
  }

  /** dm_generate: system+user messages JSON for the caller's AI. */
  generate(goal: string, type: string): Promise<string> {
    return this.callToolText("dm_generate", { goal, type });
  }

  /** dm_credential: bounded outward credential JSON. */
  generateCredential(audience: string, validityDays: number): Promise<string> {
    return this.callToolText("dm_credential", { audience, validityDays });
  }
}
