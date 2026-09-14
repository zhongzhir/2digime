/**
 * 公开候选存储 — 与加密信封分目录。Relay 不读 Digital Self，不做排序目标函数。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import {
  filterNetworkItems,
  isNetworkItemExpired,
  paginateNetworkItems,
  validateNetworkItem,
  type NetworkItem,
  type NetworkItemQuery,
} from '../subject-comm/network-item';

function safeId(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 40);
}

export interface NetworkItemStore {
  put(item: NetworkItem): Promise<{ itemId: string }>;
  get?(itemId: string, nowIso: string): Promise<NetworkItem | undefined>;
  list(query: NetworkItemQuery, nowIso: string): Promise<{ items: NetworkItem[]; nextCursor?: string }>;
  purgeExpired(nowIso: string): Promise<number>;
}

export class MemoryNetworkItemStore implements NetworkItemStore {
  private readonly items = new Map<string, NetworkItem>();

  async put(item: NetworkItem): Promise<{ itemId: string }> {
    this.items.set(item.itemId, item);
    return { itemId: item.itemId };
  }

  async get(itemId: string, nowIso: string): Promise<NetworkItem | undefined> {
    const item = this.items.get(itemId);
    if (!item || isNetworkItemExpired(item, nowIso)) return undefined;
    return item;
  }

  async list(query: NetworkItemQuery, nowIso: string): Promise<{ items: NetworkItem[]; nextCursor?: string }> {
    await this.purgeExpired(nowIso);
    const loaded = [...this.items.values()];
    const filtered = filterNetworkItems(loaded, query, nowIso);
    return paginateNetworkItems(filtered, query);
  }

  async purgeExpired(nowIso: string): Promise<number> {
    let n = 0;
    for (const [id, item] of this.items) {
      if (isNetworkItemExpired(item, nowIso)) {
        this.items.delete(id);
        n += 1;
      }
    }
    return n;
  }
}

export class FileNetworkItemStore implements NetworkItemStore {
  constructor(private readonly dataDir: string) {}

  private dir(): string {
    return path.join(this.dataDir, 'network-items');
  }

  private fileFor(itemId: string): string {
    return path.join(this.dir(), `${safeId(itemId)}.json`);
  }

  async put(item: NetworkItem): Promise<{ itemId: string }> {
    await fs.mkdir(this.dir(), { recursive: true });
    const file = this.fileFor(item.itemId);
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(item, null, 2)}\n`, 'utf8');
    await fs.rename(tmp, file);
    return { itemId: item.itemId };
  }

  async get(itemId: string, nowIso: string): Promise<NetworkItem | undefined> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.fileFor(itemId), 'utf8')) as unknown;
      const checked = validateNetworkItem(parsed);
      if (!checked.ok || isNetworkItemExpired(checked.item, nowIso)) return undefined;
      return checked.item;
    } catch {
      return undefined;
    }
  }

  async list(query: NetworkItemQuery, nowIso: string): Promise<{ items: NetworkItem[]; nextCursor?: string }> {
    await this.purgeExpired(nowIso);
    const names = await fs.readdir(this.dir()).catch(() => [] as string[]);
    const loaded: NetworkItem[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(await fs.readFile(path.join(this.dir(), name), 'utf8')) as unknown;
        const checked = validateNetworkItem(parsed);
        if (checked.ok && !isNetworkItemExpired(checked.item, nowIso)) loaded.push(checked.item);
      } catch {
        /* skip corrupt */
      }
    }
    const filtered = filterNetworkItems(loaded, query, nowIso);
    return paginateNetworkItems(filtered, query);
  }

  async purgeExpired(nowIso: string): Promise<number> {
    const names = await fs.readdir(this.dir()).catch(() => [] as string[]);
    let n = 0;
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const file = path.join(this.dir(), name);
      try {
        const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as unknown;
        const checked = validateNetworkItem(parsed);
        if (!checked.ok || isNetworkItemExpired(checked.item, nowIso)) {
          await fs.unlink(file);
          n += 1;
        }
      } catch {
        /* ignore */
      }
    }
    return n;
  }
}
