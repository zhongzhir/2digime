/**
 * Isolated Workspace Manager — 运行期设施,非第九事实源。
 * 见 docs/design/digitalme_v2_workspace_and_permission_model.md
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { nowIso } from '../shared/ids';

export interface WorkspaceHandle {
  id: string;
  sourceRoot: string;
  rootPath: string;
  baseRevision: string | null;
  baseDigest: string;
  createdAt: string;
  retention: 'ephemeral' | 'retain_on_failure';
}

export interface CreateWorkspaceInput {
  sourceRoot: string;
  /** 工作区父目录;实际根为 parent/ws_<id> */
  parentDir: string;
  retention?: WorkspaceHandle['retention'];
  /** 复制时忽略的相对路径前缀 */
  ignoreNames?: string[];
}

const DEFAULT_IGNORE = new Set([
  'node_modules',
  'dist',
  '.git',
  'release-staging',
  '.runtime-model-credential.json',
]);

export class WorkspacePathEscapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspacePathEscapeError';
  }
}

export class IsolatedWorkspaceManager {
  async create(input: CreateWorkspaceInput): Promise<WorkspaceHandle> {
    const sourceRoot = path.resolve(input.sourceRoot);
    await fs.access(sourceRoot);
    const wsId = `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const rootPath = path.join(path.resolve(input.parentDir), wsId);
    await fs.mkdir(rootPath, { recursive: true });

    const ignore = new Set([...(input.ignoreNames || []), ...DEFAULT_IGNORE]);
    await copyTree(sourceRoot, rootPath, ignore);

    // 隔离副本自建干净 git 基线,不携带源仓未提交改动作为隐式输入
    const baseRevision = initCleanGitBaseline(rootPath);
    const baseDigest = await digestTree(rootPath, new Set(['.git', 'node_modules', 'dist']));

    return {
      id: wsId,
      sourceRoot,
      rootPath,
      baseRevision,
      baseDigest,
      createdAt: nowIso(),
      retention: input.retention ?? 'retain_on_failure',
    };
  }

  /** 路径必须落在工作区根内。 */
  resolveInside(workspace: WorkspaceHandle, relativeOrAbsolute: string): string {
    const root = path.resolve(workspace.rootPath);
    const candidate = path.resolve(root, relativeOrAbsolute);
    const rel = path.relative(root, candidate);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new WorkspacePathEscapeError(`path escapes workspace: ${relativeOrAbsolute}`);
    }
    return candidate;
  }

  assertInside(workspace: WorkspaceHandle, targetPath: string): void {
    this.resolveInside(workspace, path.relative(workspace.rootPath, path.resolve(targetPath)));
  }

  async digestNow(workspace: WorkspaceHandle): Promise<string> {
    return digestTree(workspace.rootPath, new Set(['.git', 'node_modules', 'dist']));
  }

  async cleanup(workspace: WorkspaceHandle): Promise<void> {
    await fs.rm(workspace.rootPath, { recursive: true, force: true });
  }
}

async function copyTree(src: string, dest: string, ignore: Set<string>): Promise<void> {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (ignore.has(entry.name)) continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyTree(from, to, ignore);
    } else if (entry.isFile()) {
      await fs.copyFile(from, to);
    }
  }
}

function initCleanGitBaseline(rootPath: string): string | null {
  const run = (args: string[]) =>
    spawnSync('git', args, { cwd: rootPath, encoding: 'utf8', shell: false });
  if (run(['init']).status !== 0) return null;
  run(['config', 'user.email', 'p2b1@digitalme.local']);
  run(['config', 'user.name', 'Digital Me P2B.1']);
  run(['add', '-A']);
  const commit = run(['commit', '-m', 'p2b1 baseline']);
  if (commit.status !== 0) return null;
  const head = run(['rev-parse', 'HEAD']);
  if (head.status !== 0) return null;
  return String(head.stdout || '').trim() || null;
}

export async function digestTree(root: string, ignoreNames: Set<string>): Promise<string> {
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignoreNames.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) files.push(full);
    }
  }
  await walk(root);
  files.sort();
  const hash = createHash('sha256');
  for (const file of files) {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    hash.update(rel);
    hash.update('\0');
    hash.update(await fs.readFile(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** 检测源根相对基线是否被改动(用于断言原仓不变)。 */
export async function assertSourceUnchanged(
  sourceRoot: string,
  expectedDigest: string,
): Promise<{ ok: boolean; currentDigest: string }> {
  const currentDigest = await digestTree(sourceRoot, new Set(['.git', 'node_modules', 'dist']));
  return { ok: currentDigest === expectedDigest, currentDigest };
}
