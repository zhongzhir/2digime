import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { ArtifactContent } from '../work-runtime/artifact';
import { contentDigest, normalizeRelRef, normalizeText, sanitizeFileName } from './digest';

/**
 * ContentStore(P1.1 §6):抽取文本、Artifact 载荷、版本内容的唯一内容落点。
 * - 大内容不进对象 JSON,一律 contentRef 引用;
 * - ref 为相对路径,解析时强制限制在管理根目录内(越界拒绝);
 * - 文本内容按 digest 寻址(幂等);文件/包按随机 id + 安全文件名存放。
 */
export class ContentStore {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
  }

  /** ref → 绝对路径;拒绝越界(路径围栏)。 */
  resolvePath(ref: string): string {
    const normalized = normalizeRelRef(ref);
    const absolute = path.resolve(this.rootDir, normalized);
    const relative = path.relative(this.rootDir, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`content ref escapes managed root: ${ref}`);
    }
    return absolute;
  }

  async putText(
    text: string,
    format: 'markdown' | 'plain' = 'markdown',
  ): Promise<{ content: ArtifactContent; digest: string; length: number }> {
    const stored = normalizeText(text);
    const digest = contentDigest(stored);
    const ext = format === 'markdown' ? 'md' : 'txt';
    const ref = `text/${digest.slice(0, 2)}/${digest}.${ext}`;
    const target = this.resolvePath(ref);
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      await fs.writeFile(target, stored, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; // digest 寻址,已存在即幂等
    }
    return { content: { kind: 'text', format, ref }, digest, length: stored.length };
  }

  async getText(content: ArtifactContent): Promise<string> {
    if (content.kind !== 'text') {
      throw new Error(`content is not text: ${content.kind}`);
    }
    return fs.readFile(this.resolvePath(content.ref), 'utf8');
  }

  async putFile(sourcePath: string, mediaType: string): Promise<ArtifactContent> {
    const ref = await this.copyIn(sourcePath);
    return { kind: 'file', ref, mediaType };
  }

  async putBundle(
    entries: Array<{ sourcePath: string; mediaType: string; role?: string }>,
  ): Promise<ArtifactContent> {
    const stored: Array<{ ref: string; mediaType: string; role?: string }> = [];
    for (const entry of entries) {
      const ref = await this.copyIn(entry.sourcePath);
      const item: { ref: string; mediaType: string; role?: string } = {
        ref,
        mediaType: entry.mediaType,
      };
      if (entry.role !== undefined) item.role = entry.role;
      stored.push(item);
    }
    return { kind: 'bundle', entries: stored };
  }

  async readBytes(ref: string): Promise<Buffer> {
    return fs.readFile(this.resolvePath(ref));
  }

  private async copyIn(sourcePath: string): Promise<string> {
    const name = sanitizeFileName(path.basename(sourcePath));
    const id = randomBytes(8).toString('hex');
    const ref = `files/${id}/${name}`;
    const target = this.resolvePath(ref);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(sourcePath, target);
    return ref;
  }
}
