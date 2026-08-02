import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * 原子写原语(摘取重写自 Legacy json-store-persistence 思路,零代码复制):
 * 唯一 tmp 写入 → 现有文件备份为 .bak → rename 覆盖。
 * 唯一 tmp 避免并发写互相删除临时文件。
 */
export async function atomicWriteFile(filePath: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
  const bakPath = `${filePath}.bak`;
  await fs.writeFile(tmpPath, data);
  try {
    try {
      await fs.copyFile(filePath, bakPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await replaceFile(tmpPath, filePath);
  } catch (error) {
    await fs.unlink(tmpPath).catch(() => undefined);
    throw error;
  }
}

/** Windows 上 rename 覆盖既有文件可能失败;回退为 unlink + rename。 */
async function replaceFile(fromPath: string, toPath: string): Promise<void> {
  try {
    await fs.rename(fromPath, toPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EEXIST') throw error;
    await fs.unlink(toPath).catch(() => undefined);
    await fs.rename(fromPath, toPath);
  }
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
