/**
 * 协作传输边界：Record/合同不依赖部署位置；路径只存在于本机 Transport。
 * LocalPackageTransport 经 SubjectTransport 发送 collaboration_sync，再幂等合并 Record。
 */
import type { DigitalMeRuntime } from '../runtime/digitalme-runtime';
import type { CollaborationEvent, CollaborationRecord, SubjectRef } from './schema';
import { CollaborationRecordStore } from './record-store';
import { mergeIncomingEvents } from './record-derive';
import { LocalSubjectTransport, buildEnvelope } from '../subject-comm/local-subject-transport';
import type { CollaborationSyncPayload } from '../subject-comm/envelope';
import { InboxStore } from '../subject-comm/inbox-store';
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
  private readonly subjectTransport: LocalSubjectTransport;

  constructor(private readonly issuer: DigitalMeRuntime) {
    this.subjectTransport = new LocalSubjectTransport(issuer);
  }

  asSubjectTransport(): LocalSubjectTransport {
    return this.subjectTransport;
  }

  resolvePeer(packageDir: string) {
    return this.subjectTransport.resolvePeer(packageDir);
  }

  registerEndpoint(ref: SubjectRef, packageDir: string) {
    return this.subjectTransport.registerEndpoint(ref, packageDir);
  }

  lookupPackageDir(endpointRef: string) {
    return this.subjectTransport.lookupPackageDir(endpointRef);
  }

  openByEndpointRef(endpointRef: string) {
    return this.subjectTransport.openByEndpointRef(endpointRef);
  }

  async pushEvents(input: {
    endpointRef: string;
    recordId: string;
    events: CollaborationEvent[];
    seedRecord?: CollaborationRecord;
  }): Promise<void> {
    const host = this.issuer.subject.requireActive();
    const from: SubjectRef = {
      subjectId: host.id,
      displayName: host.identity.displayName,
      endpointRef: `subject:${host.id}`,
    };
    await this.subjectTransport.registerEndpoint(from, host.rootDir);

    let to: SubjectRef;
    {
      const probe = await this.subjectTransport.openByEndpointRef(input.endpointRef);
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
    const sendResult = await this.subjectTransport.send(envelope);

    const opened = await this.subjectTransport.openByEndpointRef(input.endpointRef);
    try {
      const store = await CollaborationRecordStore.open(
        opened.runtime.subject.requireActive().rootDir,
      );
      let existing = await store.get(input.recordId);
      if (!existing) {
        if (!input.seedRecord) {
          throw new Error('对方尚无协作记录且未提供初始副本');
        }
        existing = {
          ...input.seedRecord,
          events: [],
        };
      }
      const merged = mergeIncomingEvents(existing, input.events);
      if (!(await store.get(input.recordId)) && input.seedRecord) {
        await store.put({
          ...input.seedRecord,
          events: merged.events,
          updatedAt: merged.updatedAt,
        });
      } else {
        await store.put(merged);
      }

      if (!sendResult.duplicate) {
        const peerInbox = await InboxStore.open(opened.runtime.subject.requireActive().rootDir);
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

  async pullRecord(endpointRef: string, recordId: string): Promise<CollaborationRecord | null> {
    const opened = await this.subjectTransport.openByEndpointRef(endpointRef);
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
