import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { ObjectStore } from '../runtime/ports';
import { atomicWriteFile, readFileWithRecovery } from './fs-atomic';

/**
 * JSON ObjectStore(P1.1 §1):每对象独立文件 <dir>/<id>.json;
 * 原子写(tmp→bak→rename);损坏时从 .bak 恢复;不含任何领域状态逻辑。
 */
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface JsonObjectStoreOptions {
  dir: string;
  /** 损坏且无法恢复的条目在 list 时上报,不静默丢弃。 */
  onWarning?: (message: string) => void;
}

export class JsonObjectStore<T extends { id: string }> implements ObjectStore<T> {
  private readonly dir: string;
  private readonly onWarning: (message: string) => void;

  constructor(options: JsonObjectStoreOptions) {
    this.dir = options.dir;
    this.onWarning = options.onWarning ?? (() => {});
  }

  private fileFor(id: string): string {
    if (!ID_PATTERN.test(id)) {
      throw new Error(`invalid object id: ${JSON.stringify(id)}`);
    }
    return path.join(this.dir, `${id}.json`);
  }

  async get(id: string): Promise<T | null> {
    const result = await readFileWithRecovery(this.fileFor(id), isValidJson);
    if (result.content === null) return null;
    if (result.recoveredFromBackup) {
      this.onWarning(`object ${id} recovered from backup`);
    }
    return JSON.parse(result.content) as T;
  }

  async put(obj: T): Promise<void> {
    const filePath = this.fileFor(obj.id);
    await atomicWriteFile(filePath, `${JSON.stringify(obj, null, 2)}\n`);
  }

  async list(filter?: (obj: T) => boolean): Promise<T[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const results: T[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -'.json'.length);
      if (!ID_PATTERN.test(id)) continue;
      try {
        const obj = await this.get(id);
        if (obj !== null && (!filter || filter(obj))) results.push(obj);
      } catch (error) {
        this.onWarning(`object ${id} unreadable: ${(error as Error).message}`);
      }
    }
    return results;
  }
}

function isValidJson(content: string): boolean {
  try {
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
}
