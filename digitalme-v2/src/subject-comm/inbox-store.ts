/**
 * Inbox / Opportunity 持久化 — 非 Collaboration / Growth Store。
 *
 * 唯一事实关系（冻结）：
 * - SubjectEnvelope @ collaboration/inbox/  = 收到过什么消息的持久权威事实
 * - Opportunity @ collaboration/opportunities/ = 基于 Signal + 本地判断的派生/业务视图
 *
 * Opportunity 必须引用 signalEnvelopeId；展示摘要可缓存，但可从 inbox 重建。
 * 删除/重算机会卡不得删除 inbox 信封。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { JsonObjectStore } from '../infrastructure/json-store';
import type { SubjectEnvelope } from './envelope';
import { envelopeStoreId } from './envelope';
import type { OpportunityCard } from './signal';

export const INBOX_DIR_REL = 'collaboration/inbox';
export const OPPORTUNITY_DIR_REL = 'collaboration/opportunities';

export class InboxStore {
  private readonly store: JsonObjectStore<SubjectEnvelope>;

  private constructor(store: JsonObjectStore<SubjectEnvelope>) {
    this.store = store;
  }

  static async open(packageRootDir: string): Promise<InboxStore> {
    const dir = path.join(packageRootDir, INBOX_DIR_REL);
    await fs.mkdir(dir, { recursive: true });
    return new InboxStore(new JsonObjectStore<SubjectEnvelope>({ dir }));
  }

  async putIfAbsent(envelope: SubjectEnvelope): Promise<{ inserted: boolean }> {
    const id = envelopeStoreId(envelope.envelopeId);
    const existing = await this.store.get(id);
    if (existing) return { inserted: false };
    await this.store.put({ ...envelope, id });
    return { inserted: true };
  }

  async get(envelopeId: string): Promise<SubjectEnvelope | null> {
    return this.store.get(envelopeStoreId(envelopeId));
  }

  async put(envelope: SubjectEnvelope): Promise<void> {
    await this.store.put({ ...envelope, id: envelopeStoreId(envelope.envelopeId) });
  }

  async list(): Promise<SubjectEnvelope[]> {
    return this.store.list();
  }
}

export class OpportunityStore {
  private readonly store: JsonObjectStore<OpportunityCard>;
  private readonly dir: string;

  private constructor(store: JsonObjectStore<OpportunityCard>, dir: string) {
    this.store = store;
    this.dir = dir;
  }

  static async open(packageRootDir: string): Promise<OpportunityStore> {
    const dir = path.join(packageRootDir, OPPORTUNITY_DIR_REL);
    await fs.mkdir(dir, { recursive: true });
    return new OpportunityStore(new JsonObjectStore<OpportunityCard>({ dir }), dir);
  }

  /** 同一 signalEnvelopeId 只保留一张机会卡（upsert）。 */
  async put(card: OpportunityCard): Promise<void> {
    if (!card.signalEnvelopeId) {
      throw new Error('opportunity must reference signalEnvelopeId');
    }
    const existing = await this.findBySignalEnvelopeId(card.signalEnvelopeId);
    if (existing && existing.id !== card.id) {
      // 合并到既有主键，避免 duplicate delivery 产生第二张卡
      const merged: OpportunityCard = {
        ...existing,
        ...card,
        id: existing.id,
        signalEnvelopeId: card.signalEnvelopeId,
        createdAt: existing.createdAt,
      };
      await this.store.put(merged);
      return;
    }
    await this.store.put(card);
  }

  async get(id: string): Promise<OpportunityCard | null> {
    return this.store.get(id);
  }

  async findBySignalEnvelopeId(signalEnvelopeId: string): Promise<OpportunityCard | null> {
    const all = await this.store.list();
    return all.find((c) => c.signalEnvelopeId === signalEnvelopeId) || null;
  }

  async list(): Promise<OpportunityCard[]> {
    return this.store.list();
  }

  /** 仅删除派生视图；不得触碰 inbox。 */
  async deleteDerived(id: string): Promise<{ deleted: boolean }> {
    const file = path.join(this.dir, `${id}.json`);
    try {
      await fs.unlink(file);
      try {
        await fs.unlink(`${file}.bak`);
      } catch {
        /* optional bak */
      }
      return { deleted: true };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { deleted: false };
      throw err;
    }
  }
}
