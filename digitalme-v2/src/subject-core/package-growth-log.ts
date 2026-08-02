import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile, readFileWithRecovery } from '../infrastructure/fs-atomic';

/**
 * SubjectPackage 内固定路径的 GrowthEvent 日志。
 * 文件名固定为 events.ndjson(布局 SUBJECT_PACKAGE_LAYOUT),不按 subjectId 分文件;
 * 行为与 NdjsonEventLog 一致:append-only、重复 id 拒绝、损坏行隔离上报。
 */
export class PackageGrowthLog<E extends { id: string; subjectId: string }> {
  private readonly filePath: string;
  private readonly quarantinePath: string;
  private readonly onCorruptLine: (lineNumber: number, reason: string) => void;
  private knownIds: Set<string> | null = null;

  constructor(options: {
    packageRoot: string;
    relativePath?: string;
    onCorruptLine?: (lineNumber: number, reason: string) => void;
  }) {
    const relative = options.relativePath ?? path.join('growth', 'events.ndjson');
    this.filePath = path.join(options.packageRoot, relative);
    this.quarantinePath = `${this.filePath.replace(/\.ndjson$/, '')}.quarantine.ndjson`;
    this.onCorruptLine = options.onCorruptLine ?? (() => {});
  }

  async append(event: E): Promise<void> {
    const ids = await this.loadIds(event.subjectId);
    if (ids.has(event.id)) {
      throw new Error(`duplicate event id: ${event.id}`);
    }
    const line = JSON.stringify(event);
    if (line.includes('\n')) {
      throw new Error(`event ${event.id} serializes to multiple lines`);
    }
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.appendFile(this.filePath, `${line}\n`, 'utf8');
    ids.add(event.id);
  }

  async *replay(expectedSubjectId: string): AsyncIterable<E> {
    for (const event of await this.readValidEvents(expectedSubjectId)) {
      yield event;
    }
  }

  async list(expectedSubjectId: string): Promise<E[]> {
    return this.readValidEvents(expectedSubjectId);
  }

  private async loadIds(subjectId: string): Promise<Set<string>> {
    if (this.knownIds) return this.knownIds;
    const ids = new Set<string>();
    for (const event of await this.readValidEvents(subjectId)) {
      ids.add(event.id);
    }
    this.knownIds = ids;
    return ids;
  }

  private async readValidEvents(subjectId: string): Promise<E[]> {
    let raw: string;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const events: E[] = [];
    const lines = raw.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      if (line.trim().length === 0) continue;
      try {
        const event = JSON.parse(line) as E;
        if (typeof event?.id !== 'string') throw new Error('missing event id');
        if (event.subjectId !== subjectId) throw new Error(`subject mismatch: ${event.subjectId}`);
        events.push(event);
      } catch (error) {
        await fs.mkdir(path.dirname(this.quarantinePath), { recursive: true });
        await fs.appendFile(
          this.quarantinePath,
          `${JSON.stringify({ lineNumber: i + 1, reason: (error as Error).message, raw: line })}\n`,
          'utf8',
        );
        this.onCorruptLine(i + 1, (error as Error).message);
      }
    }
    return events;
  }
}

/** 派生视图缓存写读(可删除重建,非事实源)。 */
export async function writeDerivedJson(filePath: string, value: unknown): Promise<void> {
  await atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readDerivedJson<T>(filePath: string): Promise<T | null> {
  const result = await readFileWithRecovery(filePath, (c) => {
    try {
      JSON.parse(c);
      return true;
    } catch {
      return false;
    }
  });
  if (result.content === null) return null;
  return JSON.parse(result.content) as T;
}
