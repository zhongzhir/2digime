/**
 * 本机文件夹授权的路径围栏：canonical path + 覆盖判断。
 * 不是 sandbox，也不用字符串 startsWith。
 */
import { existsSync, realpathSync, statSync } from 'node:fs';
import * as path from 'node:path';

export function isUncOrNetworkPath(raw: string): boolean {
  const text = String(raw || '').trim();
  if (!text) return false;
  if (/^\\\\[.?]\\/.test(text)) return true;
  if (/^\\\\[^\\]/.test(text)) return true;
  if (/^\/\/[^/]/.test(text.replace(/\\/g, '/'))) return true;
  return false;
}

export function canonicalizeFolderPath(raw: string): string {
  const resolved = path.resolve(String(raw || '').trim());
  if (!resolved) return resolved;
  try {
    if (existsSync(resolved)) {
      const real = realpathSync.native(resolved);
      const st = statSync(real);
      return st.isDirectory() || st.isFile() ? real : resolved;
    }
    const missing: string[] = [];
    let current = resolved;
    while (current && !existsSync(current)) {
      const parent = path.dirname(current);
      if (parent === current) break;
      missing.unshift(path.basename(current));
      current = parent;
    }
    if (current && existsSync(current)) {
      return path.resolve(realpathSync.native(current), ...missing);
    }
  } catch {
    /* 保留 resolve 结果 */
  }
  return resolved;
}

export function folderCovers(grantedFolder: string, candidate: string): boolean {
  const root = canonicalizeFolderPath(grantedFolder);
  const abs = canonicalizeFolderPath(candidate);
  if (process.platform === 'win32') {
    const rootKey = root.replace(/\//g, '\\').toLowerCase();
    const absKey = abs.replace(/\//g, '\\').toLowerCase();
    const rel = path.win32.relative(rootKey, absKey);
    return rel === '' || (!rel.startsWith('..') && !path.win32.isAbsolute(rel));
  }
  const rel = path.relative(root, abs);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
