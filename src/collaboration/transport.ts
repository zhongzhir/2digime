/**
 * CollaborationTransport：Local 直写路径假设仅限 LocalSubjectTransport；
 * 远程端点经 RelayTransport 只投递 envelope，由接收方 apply collaboration_sync。
 */
import type { DigitalMeRuntime } from '../runtime/digitalme-runtime';
import type { CollaborationEvent, CollaborationRecord, SubjectRef } from './schema';
import { CollaborationRecordStore } from './record-store';
import { LocalSubjectTransport, buildEnvelope } from '../subject-comm/local-subject-transport';
import type { CollaborationSyncPayload } from '../subject-comm/envelope';
import { InboxStore } from '../subject-comm/inbox-store';
import { applyCollaborationSyncLocally } from '../subject-comm/collaboration-sync-apply';
import { isRemoteEndpointRef, parseRemoteEndpointRef } from '../subject-comm/endpoint';
import type { SubjectTransport } from '../subject-comm/subject-transport';
import type { RelayTransport } from '../subject-comm/relay-transport';
import { nowIso } from '../shared/ids';

export interface CollaborationTransport {
  resolvePeer(packageDir: string): Promise<SubjectRef & { brief?: string }>;
  openByEndpointRef(endpointRef: string): Promise<{
    runtime: DigitalMeRuntime;
    subjectRef: SubjectRef;
    stop: () => Promise<void>;
  }>;
  registerEndpoint(ref: SubjectRef, packageDir: string): Promise<void>;
  lookupPackageDir(endpointRef: string): Promise<string | null>;
  pushEvents(input: {
    endpointRef: string;
    recordId: string;
    events: CollaborationEvent[];
    seedRecord?: CollaborationRecord;
  }): Promise<void>;
  pullRecord(endpointRef: string, recordId: string): Promise<CollaborationRecord | null>;
}

export class LocalPackageTransport implements CollaborationTransport {
  private readonly localTransport: LocalSubjectTransport;
  private readonly relayTransport: RelayTransport | null;

  constructor(
    private readonly issuer: DigitalMeRuntime,
    options?: { relay?: RelayTransport | null },
  ) {
    this.localTransport = new LocalSubjectTransport(issuer);
    this.relayTransport = options?.relay ?? null;
  }

  asSubjectTransport(): SubjectTransport {
    return this.relayTransport ?? this.localTransport;
  }

  asLocalSubjectTransport(): LocalSubjectTransport {
    return this.localTransport;
  }

  private subjectFor(endpointRef: string): SubjectTransport {
    if (isRemoteEndpointRef(endpointRef)) {
      if (!this.relayTransport) throw new Error('远程端点需要 RelayTransport');
      return this.relayTransport;
    }
    return this.localTransport;
  }

  resolvePeer(packageDir: string) {
    return this.localTransport.resolvePeer(packageDir);
  }

  registerEndpoint(ref: SubjectRef, packageDir: string) {
    return this.localTransport.registerEndpoint(ref, packageDir);
  }

  lookupPackageDir(endpointRef: string) {
    if (isRemoteEndpointRef(endpointRef)) return Promise.resolve(null);
    return this.localTransport.lookupPackageDir(endpointRef);
  }

  openByEndpointRef(endpointRef: string) {
    if (isRemoteEndpointRef(endpointRef)) {
      return Promise.reject(new Error('远程端点不能打开对方本地主体包'));
    }
    return this.localTransport.openByEndpointRef(endpointRef);
  }

  async pushEvents(input: {
    endpointRef: string;
    recordId: string;
    events: CollaborationEvent[];
    seedRecord?: CollaborationRecord;
  }): Promise<void> {
    const host = this.issuer.subject.requireActive();
    const remote = isRemoteEndpointRef(input.endpointRef);
    const transport = this.subjectFor(input.endpointRef);

    let from: SubjectRef;
    let to: SubjectRef;

    if (remote) {
      const relay = this.relayTransport!;
      const self = await relay.identityStore().getLocalProfile();
      if (!self) throw new Error('尚未配置远程端点');
      const peerId = parseRemoteEndpointRef(input.endpointRef);
      const peer = peerId ? await relay.identityStore().getPeer(peerId) : null;
      if (!peer) throw new Error('尚未与对方建立连接');
      from = {
        subjectId: self.subjectId,
        displayName: self.displayName,
        endpointRef: `dmep:${self.endpointId}`,
      };
      to = {
        subjectId: peer.subjectId,
        displayName: peer.displayName,
        endpointRef: input.endpointRef,
      };
    } else {
      from = {
        subjectId: host.id,
        displayName: host.identity.displayName,
        endpointRef: `subject:${host.id}`,
      };
      await this.localTransport.registerEndpoint(from, host.rootDir);
      const probe = await this.localTransport.openByEndpointRef(input.endpointRef);
      try {
        to = probe.subjectRef;
      } finally {
        await probe.stop();
      }
    }

    const payload: CollaborationSyncPayload = {
      recordId: input.recordId,
      events: input.events,
      ...(input.seedRecord ? { seedRecord: input.seedRecord } : {}),
    };
    const envelope = buildEnvelope({
      from,
      to,
      kind: 'collaboration_sync',
      payload,
      correlationId: input.recordId,
    });
    if (remote) {
      envelope.transportMeta = { mode: 'remote', encrypted: true };
    }

    const sendResult = await transport.send(envelope);

    // Local 优化：同机仍可直接合并对方 Record（路径假设不出 Local）
    if (!remote) {
      const opened = await this.localTransport.openByEndpointRef(input.endpointRef);
      try {
        await applyCollaborationSyncLocally(
          opened.runtime.subject.requireActive().rootDir,
          payload,
        );
        if (!sendResult.duplicate) {
          const peerInbox = await InboxStore.open(
            opened.runtime.subject.requireActive().rootDir,
          );
          const env = await peerInbox.get(envelope.envelopeId);
          if (env && !env.ackedAt) {
            env.ackedAt = nowIso();
            await peerInbox.put(env);
          }
        }
      } finally {
        await opened.stop();
      }
    }
    // Remote：接收方 pull + processTransportInbox 应用；发送方已有本地真相
  }

  async pullRecord(endpointRef: string, recordId: string): Promise<CollaborationRecord | null> {
    if (isRemoteEndpointRef(endpointRef)) {
      // 远程：只读本机副本（对端事件经 collaboration_sync 汇入）
      const store = await CollaborationRecordStore.open(
        this.issuer.subject.requireActive().rootDir,
      );
      return store.get(recordId);
    }
    const opened = await this.localTransport.openByEndpointRef(endpointRef);
    try {
      const store = await CollaborationRecordStore.open(
        opened.runtime.subject.requireActive().rootDir,
      );
      return store.get(recordId);
    } finally {
      await opened.stop();
    }
  }
}
