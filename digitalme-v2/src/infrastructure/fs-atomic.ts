import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

export type AtomicRenameErrorCode = 'EPERM' | 'EACCES' | 'EBUSY' | 'EEXIST' | string;

export interface AtomicWriteOptions {
  /** Windows rename 短暂占用时的最大重试次数(含首次)。 */
  renameRetries?: number;
  /** 首次退避毫秒。 */
  initialBackoffMs?: number;
  /** 测试注入:替换 rename 实现。 */
  renameImpl?: (fromPath: string, toPath: string) => Promise<void>;
  /** 测试注入:sleep。 */
  sleepImpl?: (ms: number) => Promise<void>;
}

/**
 * 原子写原语:
 * 唯一 tmp 写入并 flush/close → 现有文件备份为 .bak → rename 覆盖。
 * Windows 上对短暂 EPERM/EBUSY/EACCES 做有限次数退避重试;不掩盖永久权限错误语义。
 */
export async function atomicWriteFile(
  filePath: string,
  data: string | Buffer,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
  const bakPath = `${filePath}.bak`;
  await writeTempFileFlushed(tmpPath, data);
  try {
    try {
      await fs.copyFile(filePath, bakPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await replaceFile(tmpPath, filePath, options);
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => undefined);
    throw error;
  }
}

async function writeTempFileFlushed(tmpPath: string, data: string | Buffer): Promise<void> {
  const handle = await fs.open(tmpPath, 'w');
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Windows 上 rename 覆盖既有文件可能短暂失败;有限退避后回退 unlink + rename。 */
export async function replaceFile(
  fromPath: string,
  toPath: string,
  options: AtomicWriteOptions = {},
): Promise<void> {
  const maxAttempts = Math.max(1, options.renameRetries ?? 5);
  const sleepFn = options.sleepImpl ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const renameFn =
    options.renameImpl ?? ((from: string, to: string) => fs.rename(from, to));
  let backoff = Math.max(1, options.initialBackoffMs ?? 15);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await renameFn(fromPath, toPath);
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException).code as AtomicRenameErrorCode | undefined;
      if (code === 'EEXIST') {
        await fs.unlink(toPath).catch(() => undefined);
        continue;
      }
      if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY') {
        if (attempt >= maxAttempts) {
          // 最后一次:尝试释放目标后再 rename
          await fs.unlink(toPath).catch(() => undefined);
          try {
            await renameFn(fromPath, toPath);
            return;
          } catch (finalError) {
            throw classifyAtomicError(finalError);
          }
        }
        await sleepFn(backoff);
        backoff = Math.min(backoff * 2, 200);
        continue;
      }
      throw classifyAtomicError(error);
    }
  }
  throw classifyAtomicError(lastError);
}

function classifyAtomicError(error: unknown): Error {
  const err = error as NodeJS.ErrnoException;
  if (!err || typeof err !== 'object') {
    return error instanceof Error ? error : new Error(String(error));
  }
  if (err.code === 'ENOENT') {
    return Object.assign(err, {
      atomicKind: 'path_missing' as const,
      actionable: '目标路径不存在',
    });
  }
  if (err.code === 'EPERM' || err.code === 'EACCES') {
    return Object.assign(err, {
      atomicKind: 'permission_or_lock' as const,
      actionable: '文件被占用或权限不足',
    });
  }
  return err;
}

export interface RecoveringReadResult {
  content: string | null;
  /** 主文件损坏且由 .bak 恢复时为 true(恢复后主文件已回写)。 */
  recoveredFromBackup: boolean;
}

/**
 * 损坏恢复读:主文件可读且通过校验则返回;
 * 校验失败时尝试 .bak,成功则回写主文件并报告 recoveredFromBackup。
 */
export async function readFileWithRecovery(
  filePath: string,
  validate: (content: string) => boolean,
): Promise<RecoveringReadResult> {
  const main = await readIfExists(filePath);
  if (main !== null && validate(main)) {
    return { content: main, recoveredFromBackup: false };
  }
  if (main === null) {
    return { content: null, recoveredFromBackup: false };
  }
  const bak = await readIfExists(`${filePath}.bak`);
  if (bak !== null && validate(bak)) {
    await atomicWriteFile(filePath, bak);
    return { content: bak, recoveredFromBackup: true };
  }
  throw new Error(`file corrupted and no valid backup: ${filePath}`);
}

async function readIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
