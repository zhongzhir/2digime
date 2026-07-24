/**
 * Digital Me Context — VS Code / Cursor extension entry point.
 *
 * On activation the extension spawns the Digital Me MCP server (the
 * `dm-mcp` command by default, see setting digitalme.mcpServer.command)
 * over stdio, then surfaces the server's personalized context in two tree
 * views (Context / Credentials) and three commands:
 *   - Digital Me: Get Context
 *   - Digital Me: Generate
 *   - Digital Me: Generate Credential
 */

import * as vscode from "vscode";
import { DigitalMeMcpClient, resolveServerSpec } from "./mcp-client";
import { ContextTreeProvider } from "./context-view";
import { CredentialRecord, CredentialTreeProvider } from "./credential-view";

const GENERATE_TYPES: Array<{ label: string; description: string }> = [
  { label: "draft", description: "产出一份可直接修改后使用的完整草稿" },
  { label: "reply", description: "产出一段可直接发送的回复文本" },
  { label: "summary", description: "产出一份结构化的要点摘要" },
  { label: "plan", description: "产出一份分步骤、可执行的计划或方案" },
];

let client: DigitalMeMcpClient | undefined;

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("digitalme");
  const spec = resolveServerSpec({
    command: cfg.get<string>("mcpServer.command"),
    args: cfg.get<string[]>("mcpServer.args"),
    packageDir: cfg.get<string>("packageDir"),
  });
  const dmClient = new DigitalMeMcpClient(spec);
  client = dmClient;

  const contextProvider = new ContextTreeProvider(dmClient);
  const credentialProvider = new CredentialTreeProvider(context.globalState);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("digitalme.contextView", contextProvider),
    vscode.window.registerTreeDataProvider("digitalme.credentialView", credentialProvider),
    vscode.commands.registerCommand("digitalme.getContext", () =>
      runWithErrors(() => runGetContext(dmClient))
    ),
    vscode.commands.registerCommand("digitalme.generate", () =>
      runWithErrors(() => runGenerate(dmClient))
    ),
    vscode.commands.registerCommand("digitalme.generateCredential", () =>
      runWithErrors(() => runGenerateCredential(dmClient, credentialProvider))
    ),
    new vscode.Disposable(() => {
      void dmClient.disconnect();
    })
  );

  try {
    await dmClient.connect();
  } catch (err) {
    void vscode.window.showWarningMessage(
      "Digital Me：MCP Server 连接失败（" +
        errMessage(err) +
        "）。请确认 dm-mcp 命令可用（或调整 digitalme.mcpServer.command 设置），执行 Digital Me 命令会自动重连。"
    );
  }
  contextProvider.refresh();
}

export async function deactivate(): Promise<void> {
  const active = client;
  client = undefined;
  if (active) {
    await active.disconnect();
  }
}

async function runWithErrors(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    void vscode.window.showErrorMessage("Digital Me：" + errMessage(err));
  }
}

/** Ensure the MCP client is connected; retry connecting once when not. */
async function ensureConnected(dmClient: DigitalMeMcpClient): Promise<void> {
  if (dmClient.connected) return;
  await dmClient.connect();
}

function goalHint(): string {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return "";
  const selection = editor.selection;
  const selected = selection && !selection.isEmpty ? editor.document.getText(selection) : "";
  if (selected.trim()) {
    const oneLine = selected.trim().replace(/\s+/g, " ");
    return oneLine.slice(0, 80);
  }
  const fileName = editor.document.fileName.split(/[\\/]/).pop() || "";
  return fileName ? `与 ${fileName} 相关的任务` : "";
}

async function showTextDocument(content: string, language: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ content, language });
  await vscode.window.showTextDocument(doc, { preview: false });
}

async function promptGoal(title: string, prompt: string): Promise<string> {
  const goal = await vscode.window.showInputBox({
    title,
    prompt,
    value: goalHint(),
    ignoreFocusOut: true,
  });
  return String(goal || "").trim();
}

async function runGetContext(dmClient: DigitalMeMcpClient): Promise<void> {
  const goal = await promptGoal(
    "Digital Me: Get Context",
    "描述当前任务目标，用于从本人资料中挑选相关摘录"
  );
  if (!goal) return;
  await ensureConnected(dmClient);
  const text = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Digital Me：获取个性化上下文…" },
    () => dmClient.getContext(goal)
  );
  await showTextDocument(text, "markdown");
}

async function runGenerate(dmClient: DigitalMeMcpClient): Promise<void> {
  const goal = await promptGoal("Digital Me: Generate", "要生成的内容目标");
  if (!goal) return;
  const picked = await vscode.window.showQuickPick(GENERATE_TYPES, {
    title: "Digital Me: Generate — 产出类型",
    placeHolder: "draft（默认）",
    ignoreFocusOut: true,
  });
  const type = picked ? picked.label : "draft";
  await ensureConnected(dmClient);
  const text = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Digital Me：构建生成提示…" },
    () => dmClient.generate(goal, type)
  );
  await showTextDocument(text, "json");
}

function toCredentialRecord(raw: unknown): CredentialRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.id !== "string" || typeof c.audience !== "string") return null;
  const subject = (c.subject || {}) as Record<string, unknown>;
  return {
    id: c.id,
    audience: c.audience,
    issuedAt: String(c.issuedAt || ""),
    expiresAt: String(c.expiresAt || ""),
    validityDays: Number(c.validityDays) || 0,
    packageFingerprint: String(subject.packageFingerprint || ""),
    proof: String(c.proof || ""),
    scope: Array.isArray(c.scope) ? c.scope.map(String) : [],
  };
}

async function runGenerateCredential(
  dmClient: DigitalMeMcpClient,
  credentialProvider: CredentialTreeProvider
): Promise<void> {
  const audience = await vscode.window.showInputBox({
    title: "Digital Me: Generate Credential",
    prompt: "凭据接收方（某个工具、协作者或服务的名称）",
    value: "cursor",
    ignoreFocusOut: true,
  });
  if (!audience || !audience.trim()) return;
  const validityInput = await vscode.window.showInputBox({
    title: "Digital Me: Generate Credential",
    prompt: "有效天数（1-365）",
    value: "30",
    ignoreFocusOut: true,
    validateInput: (value) => {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 1 || n > 365) return "请输入 1-365 的整数天数。";
      return undefined;
    },
  });
  if (validityInput === undefined) return;
  const validityDays = Math.min(365, Math.max(1, Math.floor(Number(validityInput) || 30)));
  await ensureConnected(dmClient);
  const text = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Digital Me：生成对外凭据…" },
    () => dmClient.generateCredential(audience.trim(), validityDays)
  );
  try {
    const record = toCredentialRecord(JSON.parse(text));
    if (record) {
      await credentialProvider.addCredential(record);
    }
  } catch {
    /* credential JSON 无法解析时仍展示原文 */
  }
  await showTextDocument(text, "json");
  void vscode.window.showInformationMessage(
    `Digital Me：已为「${audience.trim()}」生成 ${validityDays} 天有效的凭据。`
  );
}
