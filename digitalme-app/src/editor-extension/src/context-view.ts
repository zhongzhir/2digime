/**
 * Context View: TreeDataProvider that shows the Digital Me personalized
 * context exposed by the MCP server (dm://persona, dm://style-guide,
 * dm://boundaries, dm://memory, dm://frameworks, dm://identity,
 * dm://life-summary).
 *
 * Top level: one node per dm:// resource. Expanding a node reads the
 * resource from the MCP server and shows a bounded line preview.
 */

import * as vscode from "vscode";
import { DigitalMeMcpClient, DmResourceInfo } from "./mcp-client";

const PREVIEW_LINE_LIMIT = 12;
const PREVIEW_LINE_LENGTH = 120;

const RESOURCE_ICONS: Record<string, string> = {
  "dm://persona": "person",
  "dm://style-guide": "symbol-text",
  "dm://boundaries": "shield",
  "dm://memory": "history",
  "dm://frameworks": "symbol-misc",
  "dm://identity": "verified",
  "dm://life-summary": "book",
};

export type ContextNodeKind = "status" | "resource" | "line";

export class ContextNode extends vscode.TreeItem {
  constructor(
    readonly kind: ContextNodeKind,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
    readonly dmUri?: string
  ) {
    super(label, collapsibleState);
  }
}

function statusNode(label: string, tooltip?: string): ContextNode {
  const node = new ContextNode("status", label);
  node.iconPath = new vscode.ThemeIcon("info");
  if (tooltip) node.tooltip = tooltip;
  return node;
}

function errorNode(label: string, err: unknown): ContextNode {
  const node = new ContextNode("status", label);
  node.iconPath = new vscode.ThemeIcon("error");
  node.tooltip = err instanceof Error ? err.message : String(err);
  return node;
}

function previewLine(line: string): string {
  const trimmed = line.trimEnd();
  const text = trimmed || "（空行）";
  return text.length > PREVIEW_LINE_LENGTH ? text.slice(0, PREVIEW_LINE_LENGTH) + "…" : text;
}

export class ContextTreeProvider implements vscode.TreeDataProvider<ContextNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<ContextNode | undefined>();
  readonly onDidChangeTreeData: vscode.Event<ContextNode | undefined> =
    this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly client: DigitalMeMcpClient) {}

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  getTreeItem(element: ContextNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ContextNode): Promise<ContextNode[]> {
    if (!this.client.connected) {
      return [
        statusNode(
          "未连接 Digital Me MCP Server",
          "检查设置 digitalme.mcpServer.command（默认 dm-mcp 需在 PATH 中），然后执行任意 Digital Me 命令重连。"
        ),
      ];
    }
    if (!element) {
      return this.rootNodes();
    }
    if (element.kind === "resource" && element.dmUri) {
      return this.resourceChildren(element.dmUri);
    }
    return [];
  }

  private async rootNodes(): Promise<ContextNode[]> {
    let resources: DmResourceInfo[];
    try {
      resources = await this.client.listResources();
    } catch (err) {
      return [errorNode("无法列出 Digital Me 上下文资源", err)];
    }
    if (resources.length === 0) {
      return [statusNode("MCP Server 未暴露任何上下文资源。")];
    }
    return resources.map((r) => {
      const node = new ContextNode(
        "resource",
        r.name || r.uri,
        vscode.TreeItemCollapsibleState.Collapsed,
        r.uri
      );
      node.tooltip = r.description ? `${r.description}\n${r.uri}` : r.uri;
      node.iconPath = new vscode.ThemeIcon(RESOURCE_ICONS[r.uri] || "note");
      return node;
    });
  }

  private async resourceChildren(uri: string): Promise<ContextNode[]> {
    let text: string;
    try {
      text = await this.client.readResourceText(uri);
    } catch (err) {
      return [errorNode("读取资源失败：" + uri, err)];
    }
    const lines = String(text).split(/\r?\n/);
    const nodes = lines
      .slice(0, PREVIEW_LINE_LIMIT)
      .map((line) => new ContextNode("line", previewLine(line)));
    if (lines.length > PREVIEW_LINE_LIMIT) {
      const more = new ContextNode(
        "line",
        `… 共 ${lines.length} 行，其余 ${lines.length - PREVIEW_LINE_LIMIT} 行省略`
      );
      more.iconPath = new vscode.ThemeIcon("ellipsis");
      nodes.push(more);
    }
    return nodes;
  }
}
