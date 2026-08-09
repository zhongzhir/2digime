/**
 * 待发送 Outbox — Relay 不可用时保留；重启可重试；envelopeId 幂等。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { JsonObjectStore } from '../infrastructure/json-store';
import type { RelayWireEnvelope } from './relay-wire';
import { nowIso } from '../shared/ids';

export interface OutboxItem {
  id: string;
  envelopeId: string;
  wire: RelayWireEnvelope;
  /** submitted | delivered-to-relay | failed */
  state: 'pending' | 'submitted' | 'failed';
  attempts: number;
  lastErrorCategory?: string;
  /** 开发诊断：不进用户 UI */
  lastErrorDetail?: string;
  createdAt: string;
  updatedAt: string;
}

export class OutboxStore {
  private readonly store: JsonObjectStore<OutboxItem>;

  private constructor(store: JsonObjectStore<OutboxItem>) {
    this.store = store;
  }

  static async open(packageRoot: string): Promise<OutboxStore> {
    const dir = path.join(packageRoot, 'collaboration', 'outbox');
    await fs.mkdir(dir, { recursive: true });
    return new OutboxStore(new JsonObjectStore<OutboxItem>({ dir }));
  }

  async putPending(wire: RelayWireEnvelope): Promise<OutboxItem> {
    const existing = await this.store.get(wire.envelopeId);
    if (existing) return existing;
    const item: OutboxItem = {
      id: wire.envelopeId,
      envelopeId: wire.envelopeId,
      wire,
      state: 'pending',
      attempts: 0,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await this.store.put(item);
    return item;
  }

  async markSubmitted(envelopeId: string): Promise<void> {
    const item = await this.store.get(envelopeId);
    if (!item) return;
    item.state = 'submitted';
    item.updatedAt = nowIso();
    delete item.lastErrorCategory;
    delete item.lastErrorDetail;
    await this.store.put(item);
  }

  async markFailed(
    envelopeId: string,
    category: string,
    detail?: string,
  ): Promise<void> {
    const item = await this.store.get(envelopeId);
    if (!item) return;
    item.state = 'failed';
    item.attempts += 1;
    item.lastErrorCategory = category;
    if (detail && detail.trim()) {
      item.lastErrorDetail = detail.trim().slice(0, 400);
    }
    item.updatedAt = nowIso();
    await this.store.put(item);
  }

  async listPending(): Promise<OutboxItem[]> {
    return (await this.store.list()).filter((i) => i.state === 'pending' || i.state === 'failed');
  }

  async get(envelopeId: string): Promise<OutboxItem | null> {
    return this.store.get(envelopeId);
  }
}
