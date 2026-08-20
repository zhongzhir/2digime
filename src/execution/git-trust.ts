/**
 * Codex Git 仓库前置检查与 Digital Me 项目信任判定。
 * `--skip-git-repo-check` 仅绕过 Codex 的 Git 仓库检查，不绕过本产品授权门。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export type ProjectOrigin = 'digitalme_created' | 'user_selected' | 'unknown';

export const PROJECT_TRUST_ERRORS = {
  missing_or_inaccessible:
    '所选项目文件夹不存在或当前不可访问。请重新选择后再试。',
  not_authorized:
    '尚未明确授权项目文件夹。请通过文件夹选择器添加项目位置后再开始。',
  scope_changed:
    '项目范围发生变化，需要重新选择项目文件夹后再继续。',
} as const;

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

function normalizeDir(p: string): string {
  const resolved = path.resolve(String(p || ''));
  // 去掉尾部分隔符，便于精确相等比较（Windows 盘符大小写由 path.resolve 处理）
  if (resolved.length > 1 && (resolved.endsWith('\\') || resolved.endsWith('/'))) {
    return resolved.replace(/[/\\]+$/, '');
  }
  return resolved;
}

/** 相对/绝对 scope 路径是否落在授权目录内（规范化后）。 */
export function isPathInsideDirectory(candidate: string, rootDir: string): boolean {
  const root = normalizeDir(rootDir);
  const target = path.isAbsolute(candidate)
    ? normalizeDir(candidate)
    : normalizeDir(path.join(root, candidate));
  if (target === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return target.startsWith(prefix);
}

/**
 * 从文件夹材料派生项目来源：自建 → digitalme_created；其余显式文件夹 → user_selected。
 * 不得把明确选择的目录投影为 unknown。
 */
export function resolveProjectOrigin(input?: {
  projectOrigin?: string | null | undefined;
  isNewProject?: boolean;
}): ProjectOrigin {
  if (input?.isNewProject) return 'digitalme_created';
  const raw = String(input?.projectOrigin || '').trim();
  if (raw === 'digitalme_created') return 'digitalme_created';
  if (raw === 'user_selected') return 'user_selected';
  if (raw === 'unknown') return 'unknown';
  // 缺省：显式文件夹材料仅来自选择器或自建；缺字段视为用户选择（修复旧入口漏写）
  return 'user_selected';
}

async function assertDirectoryReal(dir: string): Promise<void> {
  let st;
  try {
    st = await fs.lstat(dir);
  } catch {
    throw Object.assign(new Error(PROJECT_TRUST_ERRORS.missing_or_inaccessible), {
      code: 'project_folder_inaccessible',
      actionable: PROJECT_TRUST_ERRORS.missing_or_inaccessible,
    });
  }
  // 项目根若为符号链接：禁止放行（防止跳转到未授权真实路径）
  if (st.isSymbolicLink()) {
    throw Object.assign(new Error(PROJECT_TRUST_ERRORS.scope_changed), {
      code: 'project_symlink_escape',
      actionable: PROJECT_TRUST_ERRORS.scope_changed,
    });
  }
  if (!st.isDirectory()) {
    throw Object.assign(new Error(PROJECT_TRUST_ERRORS.missing_or_inaccessible), {
      code: 'project_folder_inaccessible',
      actionable: PROJECT_TRUST_ERRORS.missing_or_inaccessible,
    });
  }
}

function assertScopesInside(root: string, readScope?: string[], writeScope?: string[]): void {
  const scopes = [...(readScope || []), ...(writeScope || [])];
  for (const s of scopes) {
    if (!s || s === '.' || s === './') continue;
    if (!isPathInsideDirectory(s, root)) {
      throw Object.assign(new Error(PROJECT_TRUST_ERRORS.scope_changed), {
        code: 'project_scope_escape',
        actionable: PROJECT_TRUST_ERRORS.scope_changed,
      });
    }
  }
}

/**
 * 非 Git 目录在启动 Codex 前的信任硬门。
 * Git 仓库：不在此拒绝（交给 Codex 正常 Git 检查）；unknown 非 Git：拒绝。
 */
export async function assertCodexProjectTrust(input: {
  workingDirectory: string;
  authorizedWorkingDirectory?: string;
  projectOrigin?: ProjectOrigin | string | null;
  readScope?: string[];
  writeScope?: string[];
}): Promise<{ origin: ProjectOrigin; skipGitRepoCheck: boolean }> {
  const wd = normalizeDir(input.workingDirectory);
  if (!wd) {
    throw Object.assign(new Error(PROJECT_TRUST_ERRORS.not_authorized), {
      code: 'project_not_authorized',
      actionable: PROJECT_TRUST_ERRORS.not_authorized,
    });
  }
  await assertDirectoryReal(wd);

  const origin = resolveProjectOrigin({ projectOrigin: input.projectOrigin });
  const auth = input.authorizedWorkingDirectory
    ? normalizeDir(input.authorizedWorkingDirectory)
    : '';

  if (origin === 'unknown') {
    const insideGit = await isInsideGitRepository(wd);
    if (!insideGit) {
      throw Object.assign(new Error(PROJECT_TRUST_ERRORS.not_authorized), {
        code: 'project_origin_unknown',
        actionable: PROJECT_TRUST_ERRORS.not_authorized,
      });
    }
    return { origin, skipGitRepoCheck: false };
  }

  if (!auth || wd !== auth) {
    throw Object.assign(new Error(PROJECT_TRUST_ERRORS.scope_changed), {
      code: 'project_cwd_mismatch',
      actionable: PROJECT_TRUST_ERRORS.scope_changed,
    });
  }

  assertScopesInside(wd, input.readScope, input.writeScope);

  const insideGit = await isInsideGitRepository(wd);
  if (insideGit) {
    return { origin, skipGitRepoCheck: false };
  }

  if (origin === 'digitalme_created' || origin === 'user_selected') {
    return { origin, skipGitRepoCheck: true };
  }

  throw Object.assign(new Error(PROJECT_TRUST_ERRORS.not_authorized), {
    code: 'project_not_authorized',
    actionable: PROJECT_TRUST_ERRORS.not_authorized,
  });
}

/**
 * 是否允许对 Codex 使用 --skip-git-repo-check。
 * - Git 仓库：永不 skip
 * - digitalme_created / user_selected 非 Git：在授权目录精确一致时可 skip
 * - unknown：永不 skip（应由 assertCodexProjectTrust 先拒绝）
 */
export async function shouldSkipGitRepoCheck(input: {
  workingDirectory: string;
  authorizedWorkingDirectory?: string;
  projectOrigin?: ProjectOrigin | string | null;
  readScope?: string[];
  writeScope?: string[];
}): Promise<boolean> {
  try {
    const result = await assertCodexProjectTrust(input);
    return result.skipGitRepoCheck;
  } catch {
    return false;
  }
}

/** Codex trusted-directory 原文 → 用户可行动中文（不得直出英文协议句）。 */
export function mapTrustedDirectoryError(text: string): string | null {
  const blob = String(text || '');
  if (
    /trusted directory|skip-git-repo-check|not inside a trusted/i.test(blob)
  ) {
    return PROJECT_TRUST_ERRORS.not_authorized;
  }
  return null;
}
