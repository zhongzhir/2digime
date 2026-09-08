/**
 * 执行前可恢复基线 — Job 证据材料，非第二代码仓库。
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { nowIso } from '../shared/ids';
import type { ExecutionBaseline, ExecutionBaselineFile } from './external-executor-contract';

const IGNORE_NAMES = new Set([
  'node_modules',
  'dist',
  '.git',
  'release-staging',
  '.runtime-model-credential.json',
  'coverage',
  '.next',
  'out',
  '_evidence',
  'baseline-backups',
  'external-execution',
  '.opencode',
]);

export type WorkTreeFileState = {
  relativePath: string;
  size: number;
  mtimeMs: number;
  hash: string | null;
};

export type WorkTreeDelta = {
  created: string[];
  modified: string[];
  deleted: string[];
  unchanged: string[];
};

/** 执行前后文件状态。用相对路径 + 内容哈希，不靠绝对路径 startsWith，也不把“目录里存在”当成本次成果。 */
export async function snapshotWorkTree(workingDirectory: string): Promise<Map<string, WorkTreeFileState>> {
  const root = path.resolve(workingDirectory);
  const out = new Map<string, WorkTreeFileState>();
  const allFiles = await listFiles(root);
  for (const rel of allFiles) {
    const abs = path.join(root, rel);
    try {
      const st = await fs.stat(abs);
      const buf = await fs.readFile(abs);
      out.set(rel, {
        relativePath: rel,
        size: buf.byteLength,
        mtimeMs: st.mtimeMs,
        hash: sha256(buf),
      });
    } catch {
      out.set(rel, { relativePath: rel, size: 0, mtimeMs: 0, hash: null });
    }
  }
  return out;
}

export function diffWorkTree(
  before: Map<string, WorkTreeFileState>,
  after: Map<string, WorkTreeFileState>,
): WorkTreeDelta {
  const created: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const unchanged: string[] = [];
  for (const [rel, snap] of after) {
    const prev = before.get(rel);
    if (!prev) created.push(rel);
    else if ((prev.hash || '') !== (snap.hash || '') || prev.size !== snap.size) modified.push(rel);
    else unchanged.push(rel);
  }
  for (const rel of before.keys()) {
    if (!after.has(rel)) deleted.push(rel);
  }
  created.sort();
  modified.sort();
  deleted.sort();
  unchanged.sort();
  return { created, modified, deleted, unchanged };
}

export function workTreeDeltaPaths(delta: WorkTreeDelta): string[] {
  return [...delta.created, ...delta.modified, ...delta.deleted];
}

export function isPathWithinScope(
  workingDirectory: string,
  relativePath: string,
  scopes: readonly string[],
): boolean {
  const norm = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
  if (scopes.includes('.') || scopes.includes('./') || scopes.includes('*')) return true;
  for (const scope of scopes) {
    const s = scope.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
    if (!s || s === '.') return true;
    if (norm === s || norm.startsWith(`${s}/`)) return true;
  }
  void workingDirectory;
  return false;
}

export async function captureExecutionBaseline(input: {
  workingDirectory: string;
  writeScope: string[];
  readScope: string[];
  jobEvidenceDir: string;
  /** 范围外最多抽样文件数 */
  outsideSampleLimit?: number;
}): Promise<ExecutionBaseline> {
  const root = path.resolve(input.workingDirectory);
  await fs.mkdir(input.jobEvidenceDir, { recursive: true });
  const backupDir = path.join(input.jobEvidenceDir, 'baseline-backups');
  await fs.mkdir(backupDir, { recursive: true });

  const git = readGitState(root);
  const allFiles = await listFiles(root);
  const scopedFiles: ExecutionBaselineFile[] = [];
  const outsideSamples: ExecutionBaselineFile[] = [];
  const outsideLimit = input.outsideSampleLimit ?? 80;

  for (const rel of allFiles) {
    const abs = path.join(root, rel);
    const within = isPathWithinScope(root, rel, input.writeScope);
    let digest: string | null = null;
    let size = 0;
    try {
      const buf = await fs.readFile(abs);
      size = buf.byteLength;
      digest = sha256(buf);
    } catch {
      digest = null;
    }
    const tracked = git.hasRepo ? isGitTracked(root, rel) : false;
    const entry: ExecutionBaselineFile = {
      relativePath: rel,
      digest,
      size,
      kind: within ? (tracked ? 'tracked' : 'untracked') : 'outside_scope_sample',
    };
    if (within) {
      if (digest && size <= 1_500_000) {
        const backupRel = path.join('baseline-backups', rel).replace(/\\/g, '/');
        const backupAbs = path.join(input.jobEvidenceDir, backupRel);
        await fs.mkdir(path.dirname(backupAbs), { recursive: true });
        try {
          await fs.copyFile(abs, backupAbs);
          entry.backupRelPath = backupRel;
        } catch {
          /* 备份失败不阻断执行，恢复时会提示 */
        }
      }
      scopedFiles.push(entry);
    } else if (outsideSamples.length < outsideLimit) {
      outsideSamples.push(entry);
    }
  }

  // 记录范围内「当时不存在」的占位由采集侧用 baseline 缺失推断新增
  const scopeDigest = digestEntries(scopedFiles);
  const baseline: ExecutionBaseline = {
    schemaVersion: 'execution-baseline/1',
    capturedAt: nowIso(),
    workingDirectory: root,
    writeScope: [...input.writeScope],
    readScope: [...input.readScope],
    git: {
      head: git.head,
      statusPorcelain: git.statusPorcelain,
      hasRepo: git.hasRepo,
    },
    scopedFiles,
    outsideSamples,
    scopeDigest,
  };
  await fs.writeFile(
    path.join(input.jobEvidenceDir, 'baseline.json'),
    JSON.stringify(baseline, null, 2),
    'utf8',
  );
  return baseline;
}

export async function computeScopeDigest(
  workingDirectory: string,
  writeScope: string[],
): Promise<string> {
  const root = path.resolve(workingDirectory);
  const allFiles = await listFiles(root);
  const entries: ExecutionBaselineFile[] = [];
  for (const rel of allFiles) {
    if (!isPathWithinScope(root, rel, writeScope)) continue;
    try {
      const buf = await fs.readFile(path.join(root, rel));
      entries.push({
        relativePath: rel,
        digest: sha256(buf),
        size: buf.byteLength,
        kind: 'tracked',
      });
    } catch {
      entries.push({ relativePath: rel, digest: null, size: 0, kind: 'tracked' });
    }
  }
  return digestEntries(entries);
}

function digestEntries(files: ExecutionBaselineFile[]): string {
  const sorted = [...files].sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  const hash = createHash('sha256');
  for (const f of sorted) {
    hash.update(f.relativePath);
    hash.update('\0');
    hash.update(f.digest || '');
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

async function listFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORE_NAMES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        out.push(path.relative(root, full).replace(/\\/g, '/'));
      }
    }
  }
  await walk(root);
  out.sort();
  return out;
}

function readGitState(root: string): {
  hasRepo: boolean;
  head: string | null;
  statusPorcelain: string;
} {
  const run = (args: string[]) =>
    spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false, windowsHide: true });
  const inside = run(['rev-parse', '--is-inside-work-tree']);
  if (inside.status !== 0 || String(inside.stdout || '').trim() !== 'true') {
    return { hasRepo: false, head: null, statusPorcelain: '' };
  }
  const head = run(['rev-parse', 'HEAD']);
  const status = run(['status', '--porcelain', '-uall']);
  return {
    hasRepo: true,
    head: head.status === 0 ? String(head.stdout || '').trim() || null : null,
    statusPorcelain: status.status === 0 ? String(status.stdout || '') : '',
  };
}

function isGitTracked(root: string, rel: string): boolean {
  const r = spawnSync('git', ['ls-files', '--error-unmatch', rel], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  return r.status === 0;
}
