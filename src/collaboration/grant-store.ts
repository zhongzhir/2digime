/**
 * AuthorizationGrant 持久化 — 对象 #8，落在 grantor SubjectPackage 内。
 * 不是 Message/Reputation/Delegation 状态机 Store。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { JsonObjectStore } from '../infrastructure/json-store';
import type { AuthorizationGrant } from './schema';

export const GRANT_DIR_REL = 'collaboration/grants';

export class GrantStore {
  private readonly store: JsonObjectStore<AuthorizationGrant>;

  private constructor(store: JsonObjectStore<AuthorizationGrant>) {
    this.store = store;
  }

  static async open(packageRootDir: string): Promise<GrantStore> {
    const dir = path.join(packageRootDir, GRANT_DIR_REL);
    await fs.mkdir(dir, { recursive: true });
    return new GrantStore(new JsonObjectStore<AuthorizationGrant>({ dir }));
  }

  async put(grant: AuthorizationGrant): Promise<void> {
    await this.store.put(grant);
  }

  async get(id: string): Promise<AuthorizationGrant | null> {
    return this.store.get(id);
  }

  async list(): Promise<AuthorizationGrant[]> {
    return this.store.list();
  }
}
