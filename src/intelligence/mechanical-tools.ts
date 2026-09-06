/**
 * Talk 机械工具：授权围栏内 list / read / Office 导出。
 * 抽取走 extract.ts，Office 序列化走 export.ts，不做语义判断。
 */
import { existsSync, promises as fs, statSync } from 'node:fs';
import * as path from 'node:path';
import type { ChatToolDefinition } from '../infrastructure/model-http';
import { extractFile } from '../infrastructure/extract';
import { exportDocx, exportPptx } from '../infrastructure/export';

export const MAX_LIST_ENTRIES = 500;
export const MAX_WRITE_BYTES = 2_000_000;

export type AuthorizedFs = {
  folders: string[];
  files: string[];
};

export const LIST_DIRECTORY_TOOL: ChatToolDefinition = {
  type: 'function',
  function: {
    name: 'list_directory',
    description:
      '列出本次已授权文件夹中的文件和子目录名。只返回名字与基本 metadata，不挑选、不摘要。path 为授权根目录内的相对路径，空表示列出授权根目录。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '授权根目录内的相对路径，或授权文件夹的绝对路径。可为空。' },
      },
    },
  },
};

export const READ_FILE_TOOL: ChatToolDefinition = {
  type: 'function',
  function: {
    name: 'read_file',
    description: '读取本次已授权文件的真实抽取正文。支持 txt/md/csv/html/docx/pptx/pdf。不总结、不筛选。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '授权范围内的相对路径、文件名，或已授权文件的绝对路径。' },
      },
      required: ['path'],
    },
  },
};

export const EXPORT_FILE_TOOL: ChatToolDefinition = {
  type: 'function',
  function: {
    name: 'export_file',
    description:
      '把你已经组织好的文稿写成真实 Office 文件。format 为 docx 或 pptx。你负责内容；本工具只序列化并写盘。不要输出 HTML 让用户自己转换。',
    parameters: {
      type: 'object',
      properties: {
        format: { type: 'string', description: 'docx 或 pptx。' },
        relativePath: { type: 'string', description: '相对文件名，例如 outline.docx。' },
        content: { type: 'string', description: '完整文稿（Markdown 即可）。' },
      },
      required: ['format', 'relativePath', 'content'],
    },
  },
};

export function classifyAuthorizedPaths(contextPaths?: string[]): AuthorizedFs {
  const folders: string[] = [];
  const files: string[] = [];
  for (const raw of contextPaths || []) {
    const candidate = path.resolve(String(raw || '').trim());
    if (!candidate) continue;
    try {
      if (!existsSync(candidate)) continue;
      const st = statSync(candidate);
      if (st.isDirectory()) folders.push(candidate);
      else if (st.isFile()) files.push(candidate);
    } catch {
      /* skip */
    }
  }
  return { folders, files };
}

export function describeAuthorizedFs(auth: AuthorizedFs): string {
  if (!auth.folders.length && !auth.files.length) {
    return '当前没有通过“+”附加的文件或文件夹。不能读取用户电脑上仅出现在文字里的路径；需要时请用户用“+”选择该文件或文件夹。';
  }
  const lines = ['本次用户已通过“+”授权读取（不要再要用户贴正文或列文件）：'];
  for (const folder of auth.folders) lines.push(`- 文件夹 ${folder}`);
  for (const file of auth.files) lines.push(`- 文件 ${file}`);
  return lines.join('\n');
}

export function resolveWritePath(
  writeRoot: string,
  relativePath: string,
): { ok: true; abs: string } | { ok: false; reason: string } {
  const rel = relativePath.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!rel) return { ok: false, reason: '未提供相对路径。' };
  if (path.isAbsolute(relativePath) || rel.includes('..')) {
    return { ok: false, reason: '路径超出授权目录。' };
  }
  const rootResolved = path.resolve(writeRoot);
  const abs = path.resolve(writeRoot, rel);
  const inside = path.relative(rootResolved, abs);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) {
    return { ok: false, reason: '路径超出授权目录。' };
  }
  return { ok: true, abs };
}

function inside(root: string, abs: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(abs));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function posixRel(root: string, abs: string): string {
  return path.relative(path.resolve(root), path.resolve(abs)).split(path.sep).join('/');
}

function requestedPath(raw: string): string {
  return String(raw || '').trim().replace(/\\/g, path.sep);
}

function parsePathArg(rawArgs: string): string {
  try {
    const parsed = JSON.parse(rawArgs) as { path?: string; relativePath?: string };
    return String(parsed.path || parsed.relativePath || '').trim();
  } catch {
    return rawArgs.trim();
  }
}

function uniqAbs(paths: string[]): string[] {
  return [...new Set(paths.map((item) => path.resolve(item)))];
}

export function resolveAuthorizedFile(
  auth: AuthorizedFs,
  requested: string,
): { ok: true; abs: string } | { ok: false; reason: string } {
  const req = requestedPath(requested);
  if (!req) {
    const onlyFile = auth.files[0];
    if (auth.files.length === 1 && auth.folders.length === 0 && onlyFile) return { ok: true, abs: onlyFile };
    return { ok: false, reason: '未提供要读取的路径。' };
  }
  if (req.includes('..')) return { ok: false, reason: '路径超出授权范围。' };
  const matches: string[] = [];
  if (path.isAbsolute(req)) {
    const abs = path.resolve(req);
    if (auth.files.some((file) => path.resolve(file) === abs) || auth.folders.some((folder) => inside(folder, abs))) {
      matches.push(abs);
    }
  } else {
    const base = path.basename(req);
    const asPosix = req.split(path.sep).join('/');
    for (const file of auth.files) {
      if (path.basename(file) === base || posixRel(path.dirname(file), file) === asPosix) matches.push(file);
    }
    for (const folder of auth.folders) {
      const abs = path.resolve(folder, req);
      if (inside(folder, abs)) matches.push(abs);
    }
  }
  const unique = uniqAbs(matches);
  const abs = unique[0];
  if (!abs) return { ok: false, reason: '路径不在本次授权范围内。' };
  if (unique.length > 1) return { ok: false, reason: '路径对应多个已授权位置，请用更具体的路径。' };
  try {
    if (!existsSync(abs) || !statSync(abs).isFile()) return { ok: false, reason: '授权范围内没有这个文件。' };
  } catch {
    return { ok: false, reason: '授权范围内没有这个文件。' };
  }
  return { ok: true, abs };
}

export function resolveAuthorizedDirectory(
  auth: AuthorizedFs,
  requested: string,
): { ok: true; abs: string; root: string } | { ok: false; reason: string } {
  if (!auth.folders.length) return { ok: false, reason: '当前没有已授权的文件夹。请用户通过“+”选择该文件夹。' };
  const req = requestedPath(requested);
  if (req.includes('..')) return { ok: false, reason: '路径超出授权范围。' };
  const onlyFolder = auth.folders[0];
  if ((!req || req === '.' || req === './') && auth.folders.length === 1 && onlyFolder) {
    return { ok: true, abs: onlyFolder, root: onlyFolder };
  }
  if (!req || req === '.' || req === './') return { ok: false, reason: '有多个已授权文件夹，请指定其中一个路径。' };
  const matches: Array<{ abs: string; root: string }> = [];
  for (const folder of auth.folders) {
    const abs = path.isAbsolute(req) ? path.resolve(req) : path.resolve(folder, req);
    if (inside(folder, abs)) matches.push({ abs, root: folder });
  }
  const unique = [...new Map(matches.map((item) => [path.resolve(item.abs), item])).values()];
  const hit = unique[0];
  if (!hit) return { ok: false, reason: '路径不在本次授权范围内。' };
  if (unique.length > 1) return { ok: false, reason: '路径对应多个已授权位置，请用更具体的路径。' };
  try {
    if (!existsSync(hit.abs) || !statSync(hit.abs).isDirectory()) {
      return { ok: false, reason: '授权范围内没有这个文件夹。' };
    }
  } catch {
    return { ok: false, reason: '授权范围内没有这个文件夹。' };
  }
  return { ok: true, abs: hit.abs, root: hit.root };
}

export async function runListDirectory(auth: AuthorizedFs, rawArgs: string): Promise<string> {
  const requested = parsePathArg(rawArgs);
  if (!requested && auth.folders.length > 1) {
    return JSON.stringify({
      actualSuccess: true,
      ok: true,
      capabilityId: 'list_directory',
      entries: auth.folders.map((folder) => ({
        name: path.basename(folder),
        kind: 'directory',
        path: folder,
      })),
    });
  }
  const resolved = resolveAuthorizedDirectory(auth, requested);
  if (!resolved.ok) {
    return JSON.stringify({
      actualSuccess: false,
      ok: false,
      capabilityId: 'list_directory',
      failureReason: resolved.reason,
      entries: [],
    });
  }
  try {
    const dirents = await fs.readdir(resolved.abs, { withFileTypes: true });
    const truncated = dirents.length > MAX_LIST_ENTRIES;
    const slice = truncated ? dirents.slice(0, MAX_LIST_ENTRIES) : dirents;
    const entries: Array<{
      name: string;
      kind: 'file' | 'directory';
      path: string;
      size?: number;
      mtime?: string;
    }> = [];
    for (const entry of slice) {
      const abs = path.join(resolved.abs, entry.name);
      if (!inside(resolved.root, abs)) continue;
      const rel = posixRel(resolved.root, abs);
      if (entry.isDirectory()) {
        entries.push({ name: entry.name, kind: 'directory', path: rel });
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        const st = await fs.stat(abs);
        entries.push({
          name: entry.name,
          kind: 'file',
          path: rel,
          size: st.size,
          mtime: st.mtime.toISOString(),
        });
      } catch {
        entries.push({ name: entry.name, kind: 'file', path: rel });
      }
    }
    return JSON.stringify({
      actualSuccess: true,
      ok: true,
      capabilityId: 'list_directory',
      root: resolved.root,
      path: posixRel(resolved.root, resolved.abs) || '.',
      ...(truncated ? { truncated: true, limit: MAX_LIST_ENTRIES } : {}),
      entries,
    });
  } catch (err) {
    return JSON.stringify({
      actualSuccess: false,
      ok: false,
      capabilityId: 'list_directory',
      failureReason: String(err instanceof Error ? err.message : err),
      entries: [],
    });
  }
}

export async function runReadFile(auth: AuthorizedFs, rawArgs: string): Promise<string> {
  const resolved = resolveAuthorizedFile(auth, parsePathArg(rawArgs));
  if (!resolved.ok) {
    return JSON.stringify({
      actualSuccess: false,
      ok: false,
      capabilityId: 'read_file',
      failureReason: resolved.reason,
    });
  }
  const outcome = await extractFile(resolved.abs);
  if (outcome.status !== 'ok' || !outcome.text) {
    return JSON.stringify({
      actualSuccess: false,
      ok: false,
      capabilityId: 'read_file',
      path: resolved.abs,
      failureReason: outcome.warning || '没能抽出可读正文。',
    });
  }
  return JSON.stringify({
    actualSuccess: true,
    ok: true,
    capabilityId: 'read_file',
    path: resolved.abs,
    length: outcome.length,
    truncated: outcome.truncated === true,
    content: outcome.text,
  });
}

export function parseExportArgs(raw: string): {
  format: string;
  relativePath: string;
  content: string;
} {
  try {
    const parsed = JSON.parse(raw) as { format?: string; relativePath?: string; path?: string; content?: string };
    return {
      format: String(parsed.format || '').trim().toLowerCase().replace(/^\./, ''),
      relativePath: String(parsed.relativePath || parsed.path || '').trim(),
      content: String(parsed.content ?? ''),
    };
  } catch {
    return { format: '', relativePath: '', content: '' };
  }
}

export async function writeExportedOffice(input: {
  writeRoot: string;
  relativePath: string;
  format: string;
  content: string;
}): Promise<{ ok: true; abs: string } | { ok: false; reason: string }> {
  if (input.format !== 'docx' && input.format !== 'pptx') {
    return { ok: false, reason: 'format 只支持 docx 或 pptx。' };
  }
  if (Buffer.byteLength(input.content, 'utf8') > MAX_WRITE_BYTES) {
    return { ok: false, reason: `内容超过 ${MAX_WRITE_BYTES} 字节上限。` };
  }
  const resolved = resolveWritePath(input.writeRoot, input.relativePath);
  if (!resolved.ok) return resolved;
  try {
    const exported =
      input.format === 'docx'
        ? await exportDocx(input.content, resolved.abs)
        : await exportPptx(input.content, resolved.abs);
    const st = await fs.stat(exported.path);
    if (!st.isFile() || st.size <= 0) return { ok: false, reason: '导出后文件不存在或为空。' };
    return { ok: true, abs: exported.path };
  } catch (err) {
    return { ok: false, reason: String(err instanceof Error ? err.message : err) };
  }
}
