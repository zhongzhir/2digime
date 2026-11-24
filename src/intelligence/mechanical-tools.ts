/**
 * Talk 机械工具：授权围栏内 list / read / Office 导出。
 * 抽取走 extract.ts，Office 序列化走 export.ts，不做语义判断。
 */
import { createHash } from 'node:crypto';
import { constants, existsSync, promises as fs, statSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ChatToolDefinition } from '../infrastructure/model-http';
import { extractFile, MAX_EXTRACT_CHARS } from '../infrastructure/extract';
import { exportDocx, exportPdf, exportPptx } from '../infrastructure/export';
import {
  canonicalizeFolderPath,
  folderCovers,
  isUncOrNetworkPath,
} from '../authorization/filesystem-path';

export const MAX_LIST_ENTRIES = 500;
export const MAX_WRITE_BYTES = 2_000_000;
export const MAX_READ_BYTES = 1_000_000;

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
    description:
      '读取本次已授权文件的一段真实正文。Office/PDF 走抽取；其余文件在大小限制内按文本读取。不总结、不筛选。返回 coverage：full 表示这次内容覆盖已抽出的全文；excerpt 表示只返回了这一段，用 nextOffset 继续读，complete 为 false 时不能当作全文；failed 表示这次没有读到正文。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '授权范围内的相对路径、文件名，或已授权文件的绝对路径。' },
        offset: { type: 'number', description: '从抽出的正文第几个字符开始。省略则从 0 开始。' },
        limit: { type: 'number', description: '这一段最多返回的字符数，不超过 12000。省略则返回一段。' },
      },
      required: ['path'],
    },
  },
};

export const COPY_FILE_TOOL: ChatToolDefinition = {
  type: 'function',
  function: {
    name: 'copy_file',
    description:
      '在同一个已授权文件夹根内复制一个现有普通文件。不会覆盖已有目标；操作后核对源文件、目标文件和 SHA-256。多个授权根时必须填写 root。',
    parameters: {
      type: 'object',
      properties: {
        sourcePath: { type: 'string', description: '授权根内的源文件相对路径，或该文件的绝对路径。' },
        destinationPath: { type: 'string', description: '同一授权根内的目标相对路径，或目标绝对路径。目标不得已存在。' },
        root: { type: 'string', description: '授权根绝对路径；有多个授权根时必填。' },
      },
      required: ['sourcePath', 'destinationPath'],
    },
  },
};

export const MOVE_FILE_TOOL: ChatToolDefinition = {
  type: 'function',
  function: {
    name: 'move_file',
    description:
      '在同一个已授权文件夹根内移动或重命名一个现有普通文件。不会覆盖已有目标；操作后核对源路径消失、目标文件存在且 SHA-256 不变。多个授权根时必须填写 root。',
    parameters: {
      type: 'object',
      properties: {
        sourcePath: { type: 'string', description: '授权根内的源文件相对路径，或该文件的绝对路径。' },
        destinationPath: { type: 'string', description: '同一授权根内的新相对路径或绝对路径。目标不得已存在。' },
        root: { type: 'string', description: '授权根绝对路径；有多个授权根时必填。' },
      },
      required: ['sourcePath', 'destinationPath'],
    },
  },
};

export type FileTransferArgs = { sourcePath: string; destinationPath: string; root?: string };

export function parseFileTransferArgs(raw: string): FileTransferArgs {
  try {
    const parsed = JSON.parse(raw) as {
      sourcePath?: string;
      destinationPath?: string;
      source?: string;
      destination?: string;
      root?: string;
    };
    const root = String(parsed.root || '').trim();
    return {
      sourcePath: String(parsed.sourcePath || parsed.source || '').trim(),
      destinationPath: String(parsed.destinationPath || parsed.destination || '').trim(),
      ...(root ? { root } : {}),
    };
  } catch {
    return { sourcePath: '', destinationPath: '' };
  }
}

export const EXPORT_FILE_TOOL: ChatToolDefinition = {
  type: 'function',
  function: {
    name: 'export_file',
    description:
      '把你已经组织好的文稿写成真实 Word、PowerPoint 或 PDF 文件。format 为 docx、pptx 或 pdf。你负责内容；本工具只序列化并写盘。不要输出 HTML 让用户自己转换。',
    parameters: {
      type: 'object',
      properties: {
        format: { type: 'string', description: 'docx、pptx 或 pdf。' },
        relativePath: { type: 'string', description: '相对文件名，例如 outline.docx。' },
        content: { type: 'string', description: '完整文稿（Markdown 即可）。' },
      },
      required: ['format', 'relativePath', 'content'],
    },
  },
};

export const REVISE_DOCX_TOOL: ChatToolDefinition = {
  type: 'function',
  function: {
    name: 'revise_docx',
    description:
      '在本次已授权的现有 DOCX 中精确替换少量文字，保留原文档版式并另存为应用成果区的新 DOCX。源文件不会被覆盖。只用于用户明确要求修改已有 Word；不要用于新建文档、整篇重写或无法给出准确原文的修改。',
    parameters: {
      type: 'object',
      properties: {
        sourcePath: { type: 'string', description: '本次已授权的源 DOCX 绝对路径或明确文件名。' },
        fileName: { type: 'string', description: '新副本文件名，必须以 .docx 结尾，且不能覆盖已有成果。' },
        replacements: {
          type: 'array',
          description: '1—20 项精确替换。原文必须来自实际读取或用户逐字提供；expectedCount 可用于避免误改同名内容。',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string', description: '需要精确匹配的原文。' },
              to: { type: 'string', description: '替换后的文字。' },
              expectedCount: { type: 'number', description: '可选；原文预期出现次数，不一致时停止且不生成副本。' },
              matchCase: { type: 'boolean', description: '是否区分大小写，默认 true。' },
            },
            required: ['from', 'to'],
          },
        },
      },
      required: ['sourcePath', 'fileName', 'replacements'],
    },
  },
};

export function parseReviseDocxArgs(raw: string): {
  sourcePath: string;
  fileName: string;
  replacements: Array<{ from: string; to: string; expectedCount?: number; matchCase?: boolean }>;
} {
  try {
    const parsed = JSON.parse(raw) as {
      sourcePath?: string;
      path?: string;
      fileName?: string;
      replacements?: Array<{ from?: string; to?: string; expectedCount?: number; matchCase?: boolean }>;
    };
    return {
      sourcePath: String(parsed.sourcePath || parsed.path || '').trim(),
      fileName: String(parsed.fileName || '').trim(),
      replacements: Array.isArray(parsed.replacements)
        ? parsed.replacements.map((item) => ({
            from: String(item.from || ''),
            to: String(item.to || ''),
            ...(item.expectedCount === undefined ? {} : { expectedCount: Number(item.expectedCount) }),
            ...(item.matchCase === undefined ? {} : { matchCase: Boolean(item.matchCase) }),
          }))
        : [],
    };
  } catch {
    return { sourcePath: '', fileName: '', replacements: [] };
  }
}

export function classifyAuthorizedPaths(contextPaths?: string[]): AuthorizedFs {
  const folders: string[] = [];
  const files: string[] = [];
  for (const raw of contextPaths || []) {
    const candidate = path.resolve(String(raw || '').trim());
    if (!candidate) continue;
    try {
      if (!existsSync(candidate)) continue;
      const st = statSync(candidate);
      if (st.isDirectory()) folders.push(canonicalizeFolderPath(candidate));
      else if (st.isFile()) files.push(canonicalizeFolderPath(candidate));
    } catch {
      /* skip */
    }
  }
  return { folders, files };
}

export function userHomeDir(): string {
  return String(process.env.DIGITALME_V2_HOME || os.homedir() || '').trim() || os.homedir();
}

const KNOWN_FOLDER_ALIASES: Record<string, string> = {
  desktop: 'Desktop',
  桌面: 'Desktop',
  documents: 'Documents',
  文档: 'Documents',
  downloads: 'Downloads',
  下载: 'Downloads',
};

function knownUserRoots(): string[] {
  const home = path.resolve(userHomeDir());
  return ['Desktop', 'Documents', 'Downloads'].map((name) => path.resolve(home, name));
}

function isPathInside(root: string, candidate: string): boolean {
  return folderCovers(root, candidate);
}

/**
 * 把模型申请的访问路径收成桌面/文档/下载围栏内的绝对路径。
 * 不是对用户原话做关键词路由；只解释 tool 参数。
 */
export function resolveProposedAccessPath(
  raw: string,
): { ok: true; abs: string; label: string } | { ok: false; reason: string } {
  const trimmed = String(raw || '').trim().replace(/\\/g, '/');
  if (!trimmed || trimmed.includes('..') || isUncOrNetworkPath(raw) || isUncOrNetworkPath(trimmed)) {
    return { ok: false, reason: '路径超出可授权范围。' };
  }
  const home = path.resolve(userHomeDir());
  const roots = knownUserRoots();
  const lower = trimmed.toLowerCase();
  const alias = Object.keys(KNOWN_FOLDER_ALIASES).find(
    (key) => lower === key.toLowerCase() || lower.startsWith(`${key.toLowerCase()}/`),
  );
  let abs: string;
  if (alias) {
    const rest = trimmed.slice(alias.length).replace(/^[/\\]+/, '');
    abs = path.resolve(home, KNOWN_FOLDER_ALIASES[alias]!, rest);
  } else if (path.isAbsolute(trimmed) || /^[a-zA-Z]:[\\/]/.test(trimmed)) {
    abs = path.resolve(trimmed);
  } else {
    abs = path.resolve(home, 'Desktop', trimmed);
  }
  const canonical = canonicalizeFolderPath(abs);
  if (!roots.some((root) => isPathInside(root, canonical))) {
    return { ok: false, reason: '只能申请桌面、文档或下载目录及其子文件夹。' };
  }
  return { ok: true, abs: canonical, label: canonical };
}

export function describeAuthorizedFs(writeAuth: AuthorizedFs, readAuth: AuthorizedFs = writeAuth): string {
  if (!writeAuth.folders.length && !writeAuth.files.length && !readAuth.files.length && !readAuth.folders.length) {
    return [
      '当前没有已授权的可写文件夹。',
      '需要在电脑上创建或修改文件、且现有授权覆盖不了目标路径时，调用 request_folder_access。',
      '已经覆盖的路径不要再次申请。不要让主人自己运行命令。',
    ].join('\n');
  }
  const lines = ['已有可复用的本机授权。覆盖范围内不要再次申请，也不要扩大到相邻目录。'];
  if (writeAuth.folders.length) {
    lines.push('可写入文件夹（write_file 的授权根；不是已附材料，不要去翻里面的其它文稿）：');
    for (const folder of writeAuth.folders) lines.push(`- ${folder}`);
    if (writeAuth.folders.length > 1) {
      lines.push('有多个可写根时，write_file 必须填写 root，且必须是上列某一个绝对路径。');
    }
  }
  if (readAuth.folders.length) {
    lines.push('可列出的文件夹（list_directory）：');
    for (const folder of readAuth.folders) lines.push(`- ${folder}`);
  }
  if (readAuth.files.length) {
    lines.push('可读文件：');
    for (const file of readAuth.files) lines.push(`- ${file}`);
  }
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
  const rootResolved = canonicalizeFolderPath(writeRoot);
  const abs = path.resolve(rootResolved, rel);
  if (!folderCovers(rootResolved, abs)) {
    return { ok: false, reason: '路径超出授权目录。' };
  }
  return { ok: true, abs };
}

/** 写盘只落在 Owner 通过「+」授权的文件夹根上。多个根时必须显式选择列出的绝对路径。 */
export function resolveAuthorizedWritePath(
  auth: AuthorizedFs,
  relativePath: string,
  requestedRoot?: string,
): { ok: true; abs: string; root: string } | { ok: false; reason: string } {
  const roots = uniqAbs(auth.folders);
  if (!roots.length) {
    return { ok: false, reason: '当前没有已授权的可写文件夹。' };
  }
  const asked = String(requestedRoot || '').trim();
  let root: string | undefined;
  if (asked) {
    if (asked.includes('..')) return { ok: false, reason: '路径超出授权目录。' };
    const resolvedAsked = canonicalizeFolderPath(path.resolve(asked));
    root = roots.find((item) => folderCovers(item, resolvedAsked) && folderCovers(resolvedAsked, item));
    if (!root) {
      return {
        ok: false,
        reason: `root 不在本次授权可写目录中。请从下列路径中选一个：${roots.join('、')}`,
      };
    }
  } else if (roots.length === 1) {
    root = roots[0];
  } else {
    return {
      ok: false,
      reason: `有多个已授权可写目录，请在 root 中填写其中一个绝对路径：${roots.join('、')}`,
    };
  }
  if (!root) return { ok: false, reason: '当前没有已授权的可写文件夹。' };
  const resolved = resolveWritePath(root, relativePath);
  if (!resolved.ok) return resolved;
  return { ok: true, abs: resolved.abs, root };
}

export type AuthorizedFileTransfer = {
  root: string;
  source: string;
  destination: string;
};

function resolvePathInRoot(
  root: string,
  raw: string,
): { ok: true; abs: string } | { ok: false; reason: string } {
  const requested = String(raw || '').trim();
  if (!requested) return { ok: false, reason: '源路径和目标路径都不能为空。' };
  if (isUncOrNetworkPath(requested) || requested.replace(/\\/g, '/').split('/').includes('..')) {
    return { ok: false, reason: '路径超出授权目录。' };
  }
  const abs = path.isAbsolute(requested) ? path.resolve(requested) : path.resolve(root, requested);
  if (!folderCovers(root, abs)) return { ok: false, reason: '路径超出授权目录。' };
  return { ok: true, abs };
}

async function firstSymlinkBetween(root: string, target: string): Promise<string | undefined> {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  if (!rel || rel === '.') return undefined;
  let current = path.resolve(root);
  for (const segment of rel.split(path.sep)) {
    current = path.join(current, segment);
    try {
      const st = await fs.lstat(current);
      if (st.isSymbolicLink()) return current;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') return undefined;
      throw err;
    }
  }
  return undefined;
}

export async function resolveAuthorizedFileTransfer(
  auth: AuthorizedFs,
  args: FileTransferArgs,
): Promise<{ ok: true; transfer: AuthorizedFileTransfer } | { ok: false; reason: string }> {
  const roots = uniqAbs(auth.folders);
  if (!roots.length) return { ok: false, reason: '当前没有已授权的可写文件夹。' };
  const askedRoot = String(args.root || '').trim();
  let root: string | undefined;
  if (askedRoot) {
    if (isUncOrNetworkPath(askedRoot) || askedRoot.replace(/\\/g, '/').split('/').includes('..')) {
      return { ok: false, reason: '路径超出授权目录。' };
    }
    const canonical = canonicalizeFolderPath(path.resolve(askedRoot));
    root = roots.find((item) => folderCovers(item, canonical) && folderCovers(canonical, item));
    if (!root) return { ok: false, reason: `root 不在本次授权目录中。请从下列路径中选一个：${roots.join('、')}` };
  } else if (roots.length === 1) {
    root = roots[0];
  } else {
    return { ok: false, reason: `有多个已授权目录，请在 root 中填写其中一个绝对路径：${roots.join('、')}` };
  }
  if (!root) return { ok: false, reason: '当前没有已授权的可写文件夹。' };
  const source = resolvePathInRoot(root, args.sourcePath);
  if (!source.ok) return source;
  const destination = resolvePathInRoot(root, args.destinationPath);
  if (!destination.ok) return destination;
  if (path.resolve(source.abs) === path.resolve(destination.abs)) {
    return { ok: false, reason: '源路径和目标路径不能相同。' };
  }
  try {
    const sourceLink = await firstSymlinkBetween(root, source.abs);
    if (sourceLink) return { ok: false, reason: '源路径包含符号链接，已拒绝操作。' };
    const sourceStat = await fs.lstat(source.abs);
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
      return { ok: false, reason: '源路径必须是授权目录内的普通文件。' };
    }
    const parent = path.dirname(destination.abs);
    const parentLink = await firstSymlinkBetween(root, parent);
    if (parentLink) return { ok: false, reason: '目标路径包含符号链接，已拒绝操作。' };
    const parentStat = await fs.lstat(parent);
    if (!parentStat.isDirectory()) return { ok: false, reason: '目标文件夹不存在。' };
    try {
      await fs.lstat(destination.abs);
      return { ok: false, reason: '目标路径已存在；为避免覆盖，操作已停止。' };
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err;
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { ok: false, reason: '源文件或目标文件夹不存在。' };
    }
    return { ok: false, reason: String(err instanceof Error ? err.message : err) };
  }
  return { ok: true, transfer: { root, source: source.abs, destination: destination.abs } };
}

async function sha256File(filePath: string): Promise<string> {
  return createHash('sha256').update(await fs.readFile(filePath)).digest('hex');
}

export type FileTransferResult = {
  ok: boolean;
  sourcePath: string;
  destinationPath: string;
  sha256?: string;
  failureReason?: string;
};

export async function copyAuthorizedFile(
  auth: AuthorizedFs,
  args: FileTransferArgs,
): Promise<FileTransferResult> {
  const resolved = await resolveAuthorizedFileTransfer(auth, args);
  if (!resolved.ok) return { ok: false, sourcePath: args.sourcePath, destinationPath: args.destinationPath, failureReason: resolved.reason };
  const { source, destination } = resolved.transfer;
  try {
    const beforeHash = await sha256File(source);
    await fs.copyFile(source, destination, constants.COPYFILE_EXCL);
    const [sourceStat, destinationStat, sourceHash, destinationHash] = await Promise.all([
      fs.lstat(source),
      fs.lstat(destination),
      sha256File(source),
      sha256File(destination),
    ]);
    if (!sourceStat.isFile() || !destinationStat.isFile() || sourceStat.isSymbolicLink() || destinationStat.isSymbolicLink()) {
      return { ok: false, sourcePath: source, destinationPath: destination, failureReason: '复制后文件类型核验失败。' };
    }
    if (beforeHash !== sourceHash || beforeHash !== destinationHash) {
      return { ok: false, sourcePath: source, destinationPath: destination, failureReason: '复制后 SHA-256 核验不一致。' };
    }
    return { ok: true, sourcePath: source, destinationPath: destination, sha256: destinationHash };
  } catch (err) {
    return { ok: false, sourcePath: source, destinationPath: destination, failureReason: String(err instanceof Error ? err.message : err) };
  }
}

export async function moveAuthorizedFile(
  auth: AuthorizedFs,
  args: FileTransferArgs,
): Promise<FileTransferResult> {
  const resolved = await resolveAuthorizedFileTransfer(auth, args);
  if (!resolved.ok) return { ok: false, sourcePath: args.sourcePath, destinationPath: args.destinationPath, failureReason: resolved.reason };
  const { source, destination } = resolved.transfer;
  let destinationLinked = false;
  try {
    const beforeHash = await sha256File(source);
    // link() is same-volume and refuses an existing destination. It avoids the
    // platform-dependent overwrite behavior of rename(), then unlink() removes
    // the old name only after the new name has been verified.
    await fs.link(source, destination);
    destinationLinked = true;
    const linkedHash = await sha256File(destination);
    if (beforeHash !== linkedHash) throw new Error('移动前目标 SHA-256 核验不一致。');
    await fs.unlink(source);
    let sourceStillExists = true;
    try {
      await fs.lstat(source);
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') sourceStillExists = false;
      else throw err;
    }
    const destinationStat = await fs.lstat(destination);
    const destinationHash = await sha256File(destination);
    if (sourceStillExists || !destinationStat.isFile() || destinationStat.isSymbolicLink() || beforeHash !== destinationHash) {
      return { ok: false, sourcePath: source, destinationPath: destination, failureReason: '移动后路径或 SHA-256 核验失败。' };
    }
    return { ok: true, sourcePath: source, destinationPath: destination, sha256: destinationHash };
  } catch (err) {
    if (destinationLinked) {
      try {
        if (existsSync(source)) await fs.unlink(destination);
      } catch {
        /* 保留实际文件状态供上层如实报告，不覆盖原错误。 */
      }
    }
    const code = (err as NodeJS.ErrnoException)?.code;
    const reason = code === 'EXDEV'
      ? '源文件与目标位置不在同一卷；为避免隐式复制后删除，操作已停止。'
      : String(err instanceof Error ? err.message : err);
    return { ok: false, sourcePath: source, destinationPath: destination, failureReason: reason };
  }
}

function inside(root: string, abs: string): boolean {
  return folderCovers(root, abs);
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
  if (!auth.folders.length) return { ok: false, reason: '当前没有已授权的文件夹。' };
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

const READ_SEGMENT_CHARS = 12_000;

function parseReadWindow(rawArgs: string): { path: string; offset: number; limit: number } {
  try {
    const parsed = JSON.parse(rawArgs) as { path?: string; relativePath?: string; offset?: number; limit?: number };
    const offset = Number(parsed.offset);
    const limit = Number(parsed.limit);
    return {
      path: String(parsed.path || parsed.relativePath || '').trim(),
      offset: Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0,
      limit:
        Number.isFinite(limit) && limit > 0
          ? Math.min(Math.floor(limit), READ_SEGMENT_CHARS)
          : READ_SEGMENT_CHARS,
    };
  } catch {
    return { path: String(rawArgs || '').trim(), offset: 0, limit: READ_SEGMENT_CHARS };
  }
}

function readSlicePayload(input: {
  abs: string;
  text: string;
  offset: number;
  limit: number;
  extractTruncated: boolean;
}): string {
  const total = input.text.length;
  const start = Math.min(Math.max(0, input.offset), total);
  const end = Math.min(total, start + input.limit);
  const content = input.text.slice(start, end);
  const reachedStoredEnd = end >= total;
  const complete = reachedStoredEnd && start === 0 && !input.extractTruncated;
  return JSON.stringify({
    actualSuccess: true,
    ok: true,
    capabilityId: 'read_file',
    path: input.abs,
    coverage: complete ? 'full' : 'excerpt',
    offset: start,
    length: content.length,
    total,
    ...(reachedStoredEnd ? {} : { nextOffset: end }),
    complete,
    extractTruncated: input.extractTruncated,
    content,
  });
}

export async function runReadFile(auth: AuthorizedFs, rawArgs: string): Promise<string> {
  const window = parseReadWindow(rawArgs);
  const resolved = resolveAuthorizedFile(auth, window.path);
  if (!resolved.ok) {
    return JSON.stringify({
      actualSuccess: false,
      ok: false,
      capabilityId: 'read_file',
      coverage: 'failed',
      failureReason: resolved.reason,
    });
  }
  const outcome = await extractFile(resolved.abs);
  if (outcome.status === 'ok' && outcome.text) {
    return readSlicePayload({
      abs: resolved.abs,
      text: outcome.text,
      offset: window.offset,
      limit: window.limit,
      extractTruncated: outcome.truncated === true,
    });
  }
  const asText = await tryReadAuthorizedText(resolved.abs);
  if (asText.ok) {
    return readSlicePayload({
      abs: resolved.abs,
      text: asText.text,
      offset: window.offset,
      limit: window.limit,
      extractTruncated: asText.truncated === true,
    });
  }
  return JSON.stringify({
    actualSuccess: false,
    ok: false,
    capabilityId: 'read_file',
    coverage: 'failed',
    path: resolved.abs,
    failureReason: asText.reason || outcome.warning || '没能抽出可读正文。',
  });
}

async function tryReadAuthorizedText(
  absPath: string,
): Promise<{ ok: true; text: string; truncated?: boolean } | { ok: false; reason: string }> {
  let st;
  try {
    st = await fs.stat(absPath);
  } catch (err) {
    return { ok: false, reason: `无法读取: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!st.isFile()) {
    return { ok: false, reason: '不是文件。' };
  }
  if (st.size > MAX_READ_BYTES) {
    return { ok: false, reason: `文件超过 ${MAX_READ_BYTES} 字节，无法作为文本整份读取。` };
  }
  let buf: Buffer;
  try {
    buf = await fs.readFile(absPath);
  } catch (err) {
    return { ok: false, reason: `无法读取: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (buf.includes(0)) {
    return { ok: false, reason: '文件是二进制，无法作为文本安全读取。' };
  }
  const text = buf.toString('utf8');
  const replacement = (text.match(/\uFFFD/g) || []).length;
  if (text.length > 0 && replacement / text.length > 0.1) {
    return { ok: false, reason: '文件无法按文本解码。' };
  }
  if (!text.trim()) {
    return { ok: false, reason: '没能抽出可读正文。' };
  }
  const truncated = text.length > MAX_EXTRACT_CHARS;
  const stored = truncated ? text.slice(0, MAX_EXTRACT_CHARS) : text;
  return truncated ? { ok: true, text: stored, truncated: true } : { ok: true, text: stored };
}

export function parseExportArgs(raw: string): {
  format: string;
  relativePath: string;
  content: string;
  root?: string;
} {
  try {
    const parsed = JSON.parse(raw) as {
      format?: string;
      relativePath?: string;
      path?: string;
      content?: string;
      root?: string;
    };
    const root = String(parsed.root || '').trim();
    return {
      format: String(parsed.format || '').trim().toLowerCase().replace(/^\./, ''),
      relativePath: String(parsed.relativePath || parsed.path || '').trim(),
      content: String(parsed.content ?? ''),
      ...(root ? { root } : {}),
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
  signal?: AbortSignal;
}): Promise<{ ok: true; abs: string } | { ok: false; reason: string }> {
  if (input.format !== 'docx' && input.format !== 'pptx' && input.format !== 'pdf') {
    return { ok: false, reason: 'format 只支持 docx、pptx 或 pdf。' };
  }
  if (Buffer.byteLength(input.content, 'utf8') > MAX_WRITE_BYTES) {
    return { ok: false, reason: `内容超过 ${MAX_WRITE_BYTES} 字节上限。` };
  }
  const resolved = resolveWritePath(input.writeRoot, input.relativePath);
  if (!resolved.ok) return resolved;
  try {
    const exported = input.format === 'docx'
      ? await exportDocx(input.content, resolved.abs, input.signal)
      : input.format === 'pptx'
        ? await exportPptx(input.content, resolved.abs, input.signal)
        : await exportPdf(input.content, resolved.abs, input.signal);
    const st = await fs.stat(exported.path);
    if (!st.isFile() || st.size <= 0) return { ok: false, reason: '导出后文件不存在或为空。' };
    return { ok: true, abs: exported.path };
  } catch (err) {
    input.signal?.throwIfAborted();
    return { ok: false, reason: String(err instanceof Error ? err.message : err) };
  }
}
