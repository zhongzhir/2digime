import { promises as fs } from 'node:fs';
import * as path from 'node:path';

/**
 * 原子写原语(摘取重写自 Legacy json-store-persistence 思路,零代码复制):
 * tmp 写入 → 现有文件备份为 .bak → rename 覆盖。
 * rename 在 Windows 上使用 MOVEFILE_REPLACE_EXISTING,可覆盖既有文件。
 */
export async function atomicWriteFile(filePath: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp`;
  const bakPath = `${filePath}.bak`;
  await fs.writeFile(tmpPath, data);
  try {
    await fs.copyFile(filePath, bakPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await fs.rename(tmpPath, filePath);
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
