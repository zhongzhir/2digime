/**
 * Credential View: TreeDataProvider that lists Digital Me outward
 * credentials generated during this (and previous) sessions.
 *
 * Generated credentials are persisted in the extension's globalState so the
 * list survives window reloads; each entry shows audience, validity window
 * and the package fingerprint / proof digests from dm_credential.
 */

import * as vscode from "vscode";

export interface CredentialRecord {
  id: string;
  audience: string;
  issuedAt: string;
  expiresAt: string;
  validityDays: number;
  packageFingerprint: string;
  proof: string;
  scope: string[];
}

const STORAGE_KEY = "digitalme.credentials";

export type CredentialNodeKind = "status" | "credential" | "field";

export class CredentialNode extends vscode.TreeItem {
  constructor(
    readonly kind: CredentialNodeKind,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
    readonly record?: CredentialRecord
  ) {
    super(label, collapsibleState);
  }
}

function shortDigest(value: string): string {
  const v = String(value || "");
  return v.length > 16 ? v.slice(0, 16) + "…" : v;
}

function isExpired(record: CredentialRecord): boolean {
  const expires = Date.parse(record.expiresAt);
  return Number.isFinite(expires) && expires < Date.now();
}

function fieldNode(label: string, value: string): CredentialNode {
  const node = new CredentialNode("field", value ? `${label}：${value}` : `${label}：（空）`);
  node.tooltip = value;
  return node;
}

export class CredentialTreeProvider implements vscode.TreeDataProvider<CredentialNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<CredentialNode | undefined>();
  readonly onDidChangeTreeData: vscode.Event<CredentialNode | undefined> =
    this.onDidChangeTreeDataEmitter.event;

  private credentials: CredentialRecord[];

  constructor(private readonly state: vscode.Memento) {
    this.credentials = this.state.get<CredentialRecord[]>(STORAGE_KEY, []);
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  listCredentials(): readonly CredentialRecord[] {
    return this.credentials;
  }

  async addCredential(record: CredentialRecord): Promise<void> {
    this.credentials = [record, ...this.credentials];
    await this.state.update(STORAGE_KEY, this.credentials);
    this.refresh();
  }

  getTreeItem(element: CredentialNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CredentialNode): CredentialNode[] {
    if (!element) {
      if (this.credentials.length === 0) {
        const empty = new CredentialNode(
          "status",
          "尚未生成凭据（运行 Digital Me: Generate Credential）"
        );
        empty.iconPath = new vscode.ThemeIcon("info");
        return [empty];
      }
      return this.credentials.map((record) => {
        const node = new CredentialNode(
          "credential",
          record.audience || record.id,
          vscode.TreeItemCollapsibleState.Collapsed,
          record
        );
        const day = String(record.expiresAt || "").slice(0, 10);
        node.description = `有效期至 ${day}${isExpired(record) ? "（已过期）" : ""}`;
        node.tooltip = `${record.id}\naudience：${record.audience}\n有效期至：${record.expiresAt}`;
        node.iconPath = new vscode.ThemeIcon(isExpired(record) ? "key" : "pass-filled");
        return node;
      });
    }
    if (element.kind === "credential" && element.record) {
      const r = element.record;
      return [
        fieldNode("id", r.id),
        fieldNode("签发时间", r.issuedAt),
        fieldNode("有效期", `${r.validityDays} 天（至 ${r.expiresAt}）`),
        fieldNode("Package 指纹", shortDigest(r.packageFingerprint)),
        fieldNode("proof", shortDigest(r.proof)),
        fieldNode("scope", r.scope.join(", ")),
      ];
    }
    return [];
  }
}
