/**
 * RelayTransport — SubjectTransport 远程实现。
 * 只负责加密投递 / 拉取 / ACK / retry；不含 Signal/Collab 业务。
 */
import type { CipherAdapter } from '../infrastructure/secret-store';
import type { SubjectRef } from '../collaboration/schema';
import type { SubjectEnvelope } from './envelope';
import { SUBJECT_ENVELOPE_VERSION, envelopeStoreId } from './envelope';
import type { SubjectTransport, SubjectTransportHealth } from './subject-transport';
import { InboxStore } from './inbox-store';
import { OutboxStore } from './outbox-store';
import { CommIdentityStore } from './identity-store';
import { RelayClient } from './relay-client';
import type { RelayWireEnvelope } from './relay-wire';
import {
  canonicalRelaySignBytes,
  openSealedPayload,
  sealForRecipient,
  sealedCanonicalJson,
  signRelayEnvelope,
  verifyRelayEnvelope,
} from './crypto-identity';
import { parseRemoteEndpointRef, remoteEndpointRef } from './endpoint';
import { nowIso } from '../shared/ids';

export interface RelayTransportOptions {
  packageRoot: string;
  cipher: CipherAdapter;
  /** 可选覆盖 Relay URL（默认用本端 profile） */
  relayUrl?: string;
}

/** 密封正文：完整 SubjectEnvelope JSON（Relay 不可读）。 */
function plaintextFromEnvelope(env: SubjectEnvelope): string {
  return JSON.stringify({
    version: env.version,
    envelopeId: env.envelopeId,
    from: env.from,
    to: env.to,
    kind: env.kind,
    createdAt: env.createdAt,
    expiresAt: env.expiresAt,
    correlationId: env.correlationId,
    replyTo: env.replyTo,
    payload: env.payload,
  });
}

export class RelayTransport implements SubjectTransport {
  private readonly identity: CommIdentityStore;
  private client: RelayClient | null = null;
  private boundRelayUrl: string | null = null;

  constructor(private readonly opts: RelayTransportOptions) {
    this.identity = new CommIdentityStore(opts.packageRoot, opts.cipher);
  }

  private async requireClient(): Promise<{
    client: RelayClient;
    profile: NonNullable<Awaited<ReturnType<CommIdentityStore['getLocalProfile']>>>;
    keys: NonNullable<Awaited<ReturnType<CommIdentityStore['loadKeyMaterial']>>>;
  }> {
    const profile = await this.identity.getLocalProfile();
    if (!profile) throw new Error('尚未配置远程端点');
    const keys = await this.identity.loadKeyMaterial();
    if (!keys) throw new Error('通信密钥不可用');
    const url = (this.opts.relayUrl || profile.relayUrl).replace(/\/+$/, '');
    if (!this.client || this.boundRelayUrl !== url) {
      this.client = new RelayClient(url);
      this.boundRelayUrl = url;
    }
    return { client: this.client, profile, keys };
  }

  identityStore(): CommIdentityStore {
    return this.identity;
  }

  async health(): Promise<SubjectTransportHealth> {
    try {
      const { client } = await this.requireClient();
      const h = await client.health();
      return {
        mode: 'remote',
        reachable: h.reachable && h.ok,
        capabilities: ['send', 'listInbox', 'acknowledge', 'retry', 'e2ee'],
      };
    } catch {
      return {
        mode: 'remote',
        reachable: false,
        capabilities: ['send', 'listInbox', 'acknowledge', 'retry', 'e2ee'],
      };
    }
  }

  async send(envelope: SubjectEnvelope): Promise<{ delivered: boolean; duplicate?: boolean }> {
    const { client, profile, keys } = await this.requireClient();
    const toEndpointId = parseRemoteEndpointRef(envelope.to.endpointRef);
    if (!toEndpointId) throw new Error('远程投递需要 dmep: 端点引用');
    const peer = await this.identity.getPeer(toEndpointId);
    if (!peer) throw new Error('尚未与对方建立连接');

    const sealed = sealForRecipient(peer.encPublicKey, plaintextFromEnvelope(envelope));
    const sealedJson = sealedCanonicalJson(sealed);
    const signBytes = canonicalRelaySignBytes({
      envelopeId: envelope.envelopeId,
      fromEndpointId: profile.endpointId,
      toEndpointId,
      keyId: keys.keyId,
      createdAt: envelope.createdAt,
      sealedJson,
    });
    const wire: RelayWireEnvelope = {
      version: 1,
      envelopeId: envelope.envelopeId,
      fromEndpointId: profile.endpointId,
      toEndpointId,
      keyId: keys.keyId,
      createdAt: envelope.createdAt,
      ...(envelope.expiresAt ? { expiresAt: envelope.expiresAt } : {}),
      sealed,
      signatureB64: signRelayEnvelope(keys.signPrivatePem, signBytes),
      deliveryState: 'submitted',
    };

    const outbox = await OutboxStore.open(this.opts.packageRoot);
    await outbox.putPending(wire);

    // 本方 inbox 留发送副本（明文本地，不经 Relay）
    const localInbox = await InboxStore.open(this.opts.packageRoot);
    await localInbox.putIfAbsent({
      ...envelope,
      id: envelopeStoreId(envelope.envelopeId),
      version: SUBJECT_ENVELOPE_VERSION,
      transportMeta: {
        mode: 'remote',
        keyId: keys.keyId,
        signature: wire.signatureB64,
        encrypted: true,
      },
      receivedAt: envelope.createdAt,
    });

    try {
      const res = await client.submit(wire);
      await outbox.markSubmitted(envelope.envelopeId);
      return { delivered: true, ...(res.duplicate ? { duplicate: true } : {}) };
    } catch (err) {
      const category =
        (err as Error & { category?: string }).category || 'relay_unavailable';
      const diag = (err as Error & { diagnostics?: { phase?: string; name?: string; code?: string; causeCode?: string; message?: string } })
        .diagnostics;
      const detail = diag
        ? `${diag.phase}|${diag.name}|${diag.code}|${diag.causeCode}|${diag.message}`
        : (err as Error).message;
      await outbox.markFailed(envelope.envelopeId, category, detail);
      if (process.env.DIGITALME_DEBUG_RELAY === '1') {
        console.info('[relay-outbox]', { envelopeId: envelope.envelopeId, category, detail });
      }
      // 不破坏 SubjectPackage；保留 outbox 待重试
      return { delivered: false };
    }
  }

  /** 重试 outbox 中未成功提交的消息。 */
  async retryOutbox(): Promise<{ submitted: number; failed: number; remaining: number }> {
    // 每次 retry 周期丢弃旧 client 绑定（http 本身已无连接池；避免 URL/配置半旧）
    this.client = null;
    this.boundRelayUrl = null;
    const { client } = await this.requireClient();
    const outbox = await OutboxStore.open(this.opts.packageRoot);
    let submitted = 0;
    let failed = 0;
    for (const item of await outbox.listPending()) {
      try {
        await client.submit(item.wire);
        await outbox.markSubmitted(item.envelopeId);
        submitted += 1;
      } catch (err) {
        const category =
          (err as Error & { category?: string }).category || 'relay_unavailable';
        const diag = (err as Error & { diagnostics?: { phase?: string; name?: string; code?: string; causeCode?: string; message?: string } })
          .diagnostics;
        const detail = diag
          ? `${diag.phase}|${diag.name}|${diag.code}|${diag.causeCode}|${diag.message}`
          : (err as Error).message;
        await outbox.markFailed(item.envelopeId, category, detail);
        if (process.env.DIGITALME_DEBUG_RELAY === '1') {
          console.info('[relay-retry]', { envelopeId: item.envelopeId, category, detail });
        }
        failed += 1;
      }
    }
    const remaining = (await outbox.listPending()).length;
    return { submitted, failed, remaining };
  }

  /**
   * 从 Relay 拉取密文 → 验签 → 解密 → 写入本机 inbox（幂等）。
   */
  async pullFromRelay(): Promise<{ fetched: number; rejected: number }> {
    const { client, profile, keys } = await this.requireClient();
    const fetched = await client.fetchFor(profile.endpointId);
    const inbox = await InboxStore.open(this.opts.packageRoot);
    let ok = 0;
    let rejected = 0;
    for (const wire of fetched.items || []) {
      try {
        const peer = await this.identity.getPeer(wire.fromEndpointId);
        if (!peer) {
          rejected += 1;
          continue;
        }
        const sealedJson = sealedCanonicalJson(wire.sealed as import('./crypto-identity').SealedPayload);
        // 验签不得把 Relay 附加的 expiresAt 算进去（签名时可能未含该字段）
        const signBytes = canonicalRelaySignBytes({
          envelopeId: wire.envelopeId,
          fromEndpointId: wire.fromEndpointId,
          toEndpointId: wire.toEndpointId,
          keyId: wire.keyId,
          createdAt: wire.createdAt,
          sealedJson,
        });
        if (!verifyRelayEnvelope(peer.signPublicKey, signBytes, wire.signatureB64)) {
          rejected += 1;
          continue;
        }
        if (wire.toEndpointId !== profile.endpointId) {
          rejected += 1;
          continue;
        }
        const plain = openSealedPayload(
          keys.encPrivatePem,
          wire.sealed as import('./crypto-identity').SealedPayload,
        );
        const parsed = JSON.parse(plain) as SubjectEnvelope;
        if (parsed.envelopeId !== wire.envelopeId) {
          rejected += 1;
          continue;
        }
        const stamped: SubjectEnvelope = {
          ...parsed,
          id: envelopeStoreId(parsed.envelopeId),
          version: SUBJECT_ENVELOPE_VERSION,
          receivedAt: nowIso(),
          transportMeta: {
            mode: 'remote',
            keyId: wire.keyId,
            signature: wire.signatureB64,
            encrypted: true,
          },
          from: {
            subjectId: peer.subjectId,
            displayName: peer.displayName,
            endpointRef: remoteEndpointRef(peer.endpointId),
          },
          to: {
            subjectId: profile.subjectId,
            displayName: profile.displayName,
            endpointRef: remoteEndpointRef(profile.endpointId),
          },
        };
        // 清除可能破坏 store 的可选字段 undefined
        if (stamped.expiresAt === undefined) delete stamped.expiresAt;
        if (stamped.correlationId === undefined) delete stamped.correlationId;
        if (stamped.replyTo === undefined) delete stamped.replyTo;
        const { inserted } = await inbox.putIfAbsent(stamped);
        if (inserted) ok += 1;
      } catch {
        rejected += 1;
      }
    }
    return { fetched: ok, rejected };
  }

  async listInbox(opts: { unreadOnly?: boolean } = {}): Promise<SubjectEnvelope[]> {
    await this.pullFromRelay().catch(() => ({ fetched: 0, rejected: 0 }));
    const inbox = await InboxStore.open(this.opts.packageRoot);
    const profile = await this.identity.getLocalProfile();
    let items = await inbox.list();
    if (profile) {
      items = items.filter(
        (e) =>
          e.to.subjectId === profile.subjectId ||
          parseRemoteEndpointRef(e.to.endpointRef) === profile.endpointId,
      );
    }
    if (opts.unreadOnly) items = items.filter((e) => !e.ackedAt);
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return items;
  }

  async acknowledge(envelopeId: string): Promise<{ ok: boolean }> {
    const inbox = await InboxStore.open(this.opts.packageRoot);
    const hit = await inbox.get(envelopeId);
    if (!hit) return { ok: false };
    if (!hit.ackedAt) {
      hit.ackedAt = nowIso();
      await inbox.put(hit);
    }
    try {
      const { client, profile } = await this.requireClient();
      await client.ack(profile.endpointId, envelopeId);
    } catch {
      // 本地 ACK 已记；Relay ACK 可随后重试
    }
    return { ok: true };
  }

  // —— Local-only 方法：远程路径明确拒绝（路径假设不得泄漏到上层合同用法）——

  async resolvePeer(_packageDir: string): Promise<SubjectRef & { brief?: string; packageDir: string }> {
    throw new Error('RelayTransport 不使用本地路径解析对方');
  }

  async registerEndpoint(_ref: SubjectRef, _packageDir: string): Promise<void> {
    throw new Error('RelayTransport 不登记本地 package 路径');
  }

  async lookupPackageDir(_endpointRef: string): Promise<string | null> {
    return null;
  }

  async openByEndpointRef(_endpointRef: string): Promise<{
    runtime: import('../runtime/digitalme-runtime').DigitalMeRuntime;
    subjectRef: SubjectRef;
    stop: () => Promise<void>;
  }> {
    throw new Error('RelayTransport 不能打开对方本地主体包');
  }
}
