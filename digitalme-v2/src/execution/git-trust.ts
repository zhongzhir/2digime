/**
 * 是否允许对 Codex 使用 --skip-git-repo-check（仅 Digital Me 自建、非 Git 仓库的新项目）。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export type ProjectOrigin = 'digitalme_created' | 'user_selected' | 'unknown';

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** 目录本身或任意上级是否已是 Git 仓库。 */
export async function isInsideGitRepository(dir: string): Promise<boolean> {
  let cur = path.resolve(dir);
  for (;;) {
    if (await pathExists(path.join(cur, '.git'))) return true;
    const parent = path.dirname(cur);
    if (parent === cur) return false;
    cur = parent;
  }
}

/**
 * 仅当同时满足：Digital Me 创建 + 当前授权目录 + 不属于已有 Git 仓库。
 * 不得对任意已有项目全局开启。
 */
export async function shouldSkipGitRepoCheck(input: {
  workingDirectory: string;
  authorizedWorkingDirectory?: string;
  projectOrigin?: ProjectOrigin | string | null;
}): Promise<boolean> {
  const origin = String(input.projectOrigin || '');
  if (origin !== 'digitalme_created') return false;
  const wd = path.resolve(input.workingDirectory);
  const auth = input.authorizedWorkingDirectory
    ? path.resolve(input.authorizedWorkingDirectory)
    : '';
  if (!auth || wd !== auth) return false;
  if (await isInsideGitRepository(wd)) return false;
  return true;
}
