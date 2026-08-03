import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { contentDigest, normalizeText } from '../infrastructure/digest';
import {
  isSensitivePath,
  type ContextIngestionBudget,
  type ContextIngestionPolicy,
} from './context-policy';
import type { SnapshotIngestionMeta, SnapshotItem } from './context-snapshot';

function scrub(message: string): string {
  return message
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/api[_-]?key["']?\s*[:=]\s*["']?[^"'&\s]+/gi, 'api_key=[redacted]')
    .slice(0, 500);
}

/**
 * 递归摄取(通用 contextPolicy.folderTraversal='recursive')。
 * 安全:路径围栏、symlink 跳过、敏感命中前不打开文件、预算截断降级。
 * 产出冻结文本;调用方负责写入 ContentStore。
 */

/** 可冻结为文本的扩展名(代码/配置/文档)。二进制与未知类型跳过。 */
export const RECURSIVE_TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.markdown',
  '.txt',
  '.yml',
  '.yaml',
  '.toml',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.less',
  '.vue',
  '.svelte',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.cs',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cc',
  '.m',
  '.mm',
  '.swift',
  '.rb',
  '.php',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.bat',
  '.cmd',
  '.sql',
  '.graphql',
  '.gql',
  '.proto',
  '.gitignore',
  '.dockerignore',
  '.editorconfig',
  '.npmrc',
]);

/** 无扩展名但常作为配置的文件名。 */
export const RECURSIVE_BASENAME_ALLOW = new Set([
  'dockerfile',
  'makefile',
  'gemfile',
  'rakefile',
  'procfile',
  'license',
  'licence',
  'readme',
  'changelog',
]);

export interface IngestedFile {
  item: Omit<SnapshotItem, 'extractedTextRef' | 'contentDigest'> & {
    text?: string;
    contentDigest?: string;
  };
}

export interface RecursiveIngestResult {
  files: IngestedFile[];
  ingestion: SnapshotIngestionMeta;
  warnings: string[];
}

export async function ingestSingleFile(
  filePath: string,
  policy: ContextIngestionPolicy,
): Promise<RecursiveIngestResult> {
  const abs = path.resolve(filePath);
  const rootName = path.basename(path.dirname(abs));
  const rel = path.basename(abs);
  const warnings: string[] = [];
  const files: IngestedFile[] = [];
  let skippedSensitiveCount = 0;
  let skippedBudgetCount = 0;
  let totalBytesScanned = 0;
  let truncated = false;

  if (policy.excludeSensitivePaths && isSensitivePath(rel)) {
    skippedSensitiveCount = 1;
    return {
      files,
      ingestion: {
        rootName,
        truncated: false,
        skippedSensitiveCount,
        skippedBudgetCount: 0,
        totalBytesScanned: 0,
        fileCountScanned: 0,
      },
      warnings: ['已跳过敏感或凭证类文件'],
    };
  }

  if (!isTextCandidate(path.basename(abs))) {
    return {
      files: [
        {
          item: {
            sourcePath: abs,
            kind: 'file',
            status: 'warning',
            warning: '不支持的文件类型',
            relativePath: rel,
          },
        },
      ],
      ingestion: {
        rootName,
        truncated: false,
        skippedSensitiveCount: 0,
        skippedBudgetCount: 0,
        totalBytesScanned: 0,
        fileCountScanned: 0,
      },
      warnings,
    };
  }

  const budget = policy.budget;
  const maxFileBytes = budget?.maxFileBytes ?? 512 * 1024;

  try {
    const lstat = await fs.lstat(abs);
    if (lstat.isSymbolicLink()) {
      return {
        files: [],
        ingestion: {
          rootName,
          truncated: false,
          skippedSensitiveCount: 0,
          skippedBudgetCount: 0,
          totalBytesScanned: 0,
          fileCountScanned: 0,
        },
        warnings: ['已跳过符号链接'],
      };
    }
    const fileBytes = Number(lstat.size);
    const readLen = Math.min(fileBytes, maxFileBytes);
    truncated = fileBytes > maxFileBytes;
    const handle = await fs.open(abs, 'r');
    let buf: Buffer;
    try {
      buf = Buffer.alloc(readLen);
      const { bytesRead } = await handle.read(buf, 0, readLen, 0);
      buf = buf.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
    const raw = buf.toString('utf8');
    if (raw.includes('\u0000')) {
      return {
        files: [
          {
            item: {
              sourcePath: abs,
              kind: 'file',
              status: 'warning',
              warning: '二进制文件已跳过',
              relativePath: rel,
            },
          },
        ],
        ingestion: {
          rootName,
          truncated: false,
          skippedSensitiveCount: 0,
          skippedBudgetCount: 0,
          totalBytesScanned: 0,
          fileCountScanned: 0,
        },
        warnings,
      };
    }
    const normalized = normalizeText(raw);
    totalBytesScanned = buf.length;
    files.push({
      item: {
        sourcePath: abs,
        kind: 'file',
        status: 'ok',
        relativePath: rel,
        bytes: buf.length,
        ...(truncated ? { truncated: true } : {}),
        text: normalized,
        contentDigest: contentDigest(normalized),
      },
    });
  } catch (error) {
    files.push({
      item: {
        sourcePath: abs,
        kind: 'file',
        status: 'warning',
        warning: scrub(`文件不可读: ${(error as Error).message}`),
        relativePath: rel,
      },
    });
  }

  return {
    files,
    ingestion: {
      rootName,
      truncated,
      skippedSensitiveCount,
      skippedBudgetCount,
      totalBytesScanned,
      fileCountScanned: files.filter((f) => f.item.status === 'ok').length,
    },
    warnings,
  };
}

export async function ingestFolderRecursive(
  rootPath: string,
  policy: ContextIngestionPolicy,
  signal?: AbortSignal,
): Promise<RecursiveIngestResult> {
  const budget: ContextIngestionBudget = policy.budget ?? {
    maxFiles: 2000,
    maxTotalBytes: 32 * 1024 * 1024,
    maxFileBytes: 512 * 1024,
    maxDepth: 12,
    maxScanMs: 60_000,
  };
  const rootResolved = path.resolve(rootPath);
  const rootName = path.basename(rootResolved);
  const startedAt = Date.now();
  const files: IngestedFile[] = [];
  const warnings: string[] = [];
  let skippedSensitiveCount = 0;
  let skippedBudgetCount = 0;
  let totalBytesScanned = 0;
  let truncated = false;

  const state = {
    get truncated() {
      return truncated;
    },
    set truncated(v: boolean) {
      truncated = v;
    },
    get skippedSensitive() {
      return skippedSensitiveCount;
    },
    bumpSensitive() {
      skippedSensitiveCount += 1;
    },
    get skippedBudget() {
      return skippedBudgetCount;
    },
    bumpBudget() {
      skippedBudgetCount += 1;
    },
    get totalBytes() {
      return totalBytesScanned;
    },
    addBytes(n: number) {
      totalBytesScanned += n;
    },
  };

  await walkDir({
    dir: rootResolved,
    rootResolved,
    depth: 0,
    budget,
    policy,
    ...(signal ? { signal } : {}),
    startedAt,
    files,
    warnings,
    state,
  });

  return {
    files,
    ingestion: {
      rootName,
      truncated,
      skippedSensitiveCount,
      skippedBudgetCount,
      totalBytesScanned,
      fileCountScanned: files.filter((f) => f.item.status === 'ok').length,
    },
    warnings,
  };
}

async function walkDir(args: {
  dir: string;
  rootResolved: string;
  depth: number;
  budget: ContextIngestionBudget;
  policy: ContextIngestionPolicy;
  signal?: AbortSignal;
  startedAt: number;
  files: IngestedFile[];
  warnings: string[];
  state: {
    truncated: boolean;
    bumpSensitive(): void;
    bumpBudget(): void;
    addBytes(n: number): void;
    readonly totalBytes: number;
  };
}): Promise<void> {
  const {
    dir,
    rootResolved,
    depth,
    budget,
    policy,
    signal,
    startedAt,
    files,
    warnings,
    state,
  } = args;

  if (signal?.aborted) return;
  if (Date.now() - startedAt > budget.maxScanMs) {
    state.truncated = true;
    warnings.push('扫描达到时间上限，已输出部分结果');
    return;
  }
  if (depth > budget.maxDepth) {
    state.truncated = true;
    state.bumpBudget();
    return;
  }

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    warnings.push(scrub(`目录不可读: ${(error as Error).message}`));
    files.push({
      item: {
        sourcePath: dir,
        kind: 'folder-entry',
        status: 'warning',
        warning: scrub(`目录不可读: ${(error as Error).message}`),
        relativePath: toRel(rootResolved, dir),
      },
    });
    return;
  }

  // 稳定顺序,保证确定性
  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (signal?.aborted) return;
    if (Date.now() - startedAt > budget.maxScanMs) {
      state.truncated = true;
      warnings.push('扫描达到时间上限，已输出部分结果');
      return;
    }

    const fullPath = path.join(dir, entry.name);
    if (!isInsideRoot(rootResolved, fullPath)) {
      warnings.push('已跳过越界路径');
      continue;
    }

    let lstat;
    try {
      lstat = await fs.lstat(fullPath);
    } catch (error) {
      files.push({
        item: {
          sourcePath: fullPath,
          kind: 'folder-entry',
          status: 'warning',
          warning: scrub(`无法读取条目: ${(error as Error).message}`),
          relativePath: toRel(rootResolved, fullPath),
        },
      });
      continue;
    }

    if (lstat.isSymbolicLink()) {
      warnings.push('已跳过符号链接');
      continue;
    }

    const rel = toRel(rootResolved, fullPath);

    if (lstat.isDirectory()) {
      if (policy.excludeSensitivePaths && isSensitivePath(rel)) {
        state.bumpSensitive();
        continue;
      }
      // 目录名本身命中敏感(如 node_modules)时 isSensitivePath 也会 true
      await walkDir({
        dir: fullPath,
        rootResolved,
        depth: depth + 1,
        budget,
        policy,
        ...(signal ? { signal } : {}),
        startedAt,
        files,
        warnings,
        state,
      });
      if (state.truncated && Date.now() - startedAt > budget.maxScanMs) return;
      continue;
    }

    if (!lstat.isFile()) continue;

    if (policy.excludeSensitivePaths && isSensitivePath(rel)) {
      state.bumpSensitive();
      continue;
    }

    if (!isTextCandidate(entry.name)) continue;

    if (files.filter((f) => f.item.status === 'ok').length >= budget.maxFiles) {
      state.truncated = true;
      state.bumpBudget();
      continue;
    }
    if (state.totalBytes >= budget.maxTotalBytes) {
      state.truncated = true;
      state.bumpBudget();
      continue;
    }

    const fileBytes = Number(lstat.size);
    if (state.totalBytes + Math.min(fileBytes, budget.maxFileBytes) > budget.maxTotalBytes) {
      state.truncated = true;
      state.bumpBudget();
      continue;
    }

    try {
      const readLen = Math.min(fileBytes, budget.maxFileBytes);
      const truncatedFile = fileBytes > budget.maxFileBytes;
      const handle = await fs.open(fullPath, 'r');
      let buf: Buffer;
      try {
        buf = Buffer.alloc(readLen);
        const { bytesRead } = await handle.read(buf, 0, readLen, 0);
        buf = buf.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
      const raw = buf.toString('utf8');
      // 粗略二进制检测
      if (raw.includes('\u0000')) {
        continue;
      }
      const normalized = normalizeText(raw);
      const digest = contentDigest(normalized);
      state.addBytes(buf.length);
      files.push({
        item: {
          sourcePath: fullPath,
          kind: 'folder-entry',
          status: 'ok',
          relativePath: rel,
          bytes: buf.length,
          ...(truncatedFile ? { truncated: true } : {}),
          text: normalized,
          contentDigest: digest,
        },
      });
    } catch (error) {
      files.push({
        item: {
          sourcePath: fullPath,
          kind: 'folder-entry',
          status: 'warning',
          warning: scrub(`文件不可读: ${(error as Error).message}`),
          relativePath: rel,
        },
      });
    }
  }
}

export function isInsideRoot(rootResolved: string, candidate: string): boolean {
  const abs = path.resolve(candidate);
  const rel = path.relative(rootResolved, abs);
  if (rel === '') return true;
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function toRel(rootResolved: string, absolute: string): string {
  return path.relative(rootResolved, absolute).split(path.sep).join('/');
}

function isTextCandidate(name: string): boolean {
  const lower = name.toLowerCase();
  const ext = path.extname(lower);
  if (ext && RECURSIVE_TEXT_EXTENSIONS.has(ext)) return true;
  if (!ext && RECURSIVE_BASENAME_ALLOW.has(lower)) return true;
  // .env 等已由敏感规则排除;无扩展名的隐藏文件默认跳过
  return false;
}
