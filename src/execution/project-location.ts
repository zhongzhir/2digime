/**
 * 软件新项目默认位置 — Documents/Digital Me Projects（成果工作目录，非第二 Store）。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export const DIGITAL_ME_PROJECTS_DIRNAME = 'Digital Me Projects';

/** 从任务目标派生可读文件夹名（不含路径分隔符）。 */
export function deriveProjectFolderName(goal: string): string {
  let name = String(goal || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  name = name
    .replace(/^(请|帮我|帮忙)?(开发一个|开发一款|开发|做一个|做一款|创建|写一个|实现一个|实现)/, '')
    .replace(/[“”"'「」]/g, '')
    .replace(/(游戏|程序|应用|软件|项目)[。.!！]?$/, '')
    .trim();
  if (!name) name = '新项目';
  if (name.length > 48) name = name.slice(0, 48).trim();
  return name || '新项目';
}

export function resolveDigitalMeProjectsRoot(documentsPath: string): string {
  return path.join(path.resolve(documentsPath), DIGITAL_ME_PROJECTS_DIRNAME);
}

/** 用户可读相对文案，如「文档\Digital Me Projects\俄罗斯方块」。 */
export function displayProjectsRelativePath(
  documentsPath: string,
  projectDir: string,
): string {
  const rel = path.relative(path.resolve(documentsPath), path.resolve(projectDir));
  if (!rel || rel.startsWith('..')) {
    return path.basename(projectDir);
  }
  const docsLabel = path.basename(path.resolve(documentsPath)) || 'Documents';
  return path.join(docsLabel, rel).split(path.sep).join('\\');
}

async function isEmptyDir(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir);
    return entries.length === 0;
  } catch {
    return false;
  }
}

/**
 * 在根下安全分配唯一空目录；不覆盖已有内容。
 * reuseEmptySameName：同名空目录存在时复用（retry/revision 幂等，避免「(2)」）。
 */
export async function allocateUniqueProjectDir(
  projectsRoot: string,
  baseName: string,
  opts?: { reuseEmptySameName?: boolean },
): Promise<{ absolutePath: string; folderName: string; created: boolean; reused?: boolean }> {
  await fs.mkdir(projectsRoot, { recursive: true });
  const safeBase = deriveProjectFolderName(baseName);
  const preferred = path.join(projectsRoot, safeBase);
  if (opts?.reuseEmptySameName !== false) {
    try {
      const st = await fs.stat(preferred);
      if (st.isDirectory() && (await isEmptyDir(preferred))) {
        return {
          absolutePath: preferred,
          folderName: safeBase,
          created: false,
          reused: true,
        };
      }
    } catch {
      /* 不存在则继续创建 */
    }
  }
  let candidate = preferred;
  let folderName = safeBase;
  let n = 2;
  while (true) {
    try {
      await fs.mkdir(candidate, { recursive: false });
      return { absolutePath: candidate, folderName, created: true };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'EEXIST') throw err;
      // 已占用且非空：跳到 (n)；若恰好是空目录且允许复用则复用
      if (opts?.reuseEmptySameName !== false && (await isEmptyDir(candidate))) {
        return {
          absolutePath: candidate,
          folderName,
          created: false,
          reused: true,
        };
      }
      folderName = `${safeBase} (${n})`;
      candidate = path.join(projectsRoot, folderName);
      n += 1;
      if (n > 500) throw new Error('无法创建唯一项目文件夹');
    }
  }
}
