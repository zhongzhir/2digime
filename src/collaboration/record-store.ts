/**
 * CollaborationRecord 持久化 — 复用 JsonObjectStore，不新建平行运行时。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { JsonObjectStore } from '../infrastructure/json-store';
import type { CollaborationRecord } from './schema';

export const RECORD_DIR_REL = 'collaboration/records';

export class CollaborationRecordStore {
  private readonly store: JsonObjectStore<CollaborationRecord>;

  private constructor(store: JsonObjectStore<CollaborationRecord>) {
    this.store = store;
  }

  static async open(packageRootDir: string): Promise<CollaborationRecordStore> {
    const dir = path.join(packageRootDir, RECORD_DIR_REL);
    await fs.mkdir(dir, { recursive: true });
    return new CollaborationRecordStore(new JsonObjectStore<CollaborationRecord>({ dir }));
  }

  async put(record: CollaborationRecord): Promise<void> {
    await this.store.put(record);
  }

  async get(recordId: string): Promise<CollaborationRecord | null> {
    return this.store.get(recordId);
  }

  async list(): Promise<CollaborationRecord[]> {
    return this.store.list();
  }
}
