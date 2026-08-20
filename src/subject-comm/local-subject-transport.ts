/**
 * LocalSubjectTransport — SubjectTransport 的同机实现（local_trusted）。
 * 绝对路径仅存 peer-endpoints；不进入 Envelope 协议身份。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile, readFileWithRecovery } from '../infrastructure/fs-atomic';
import type { DigitalMeRuntime } from '../runtime/digitalme-runtime';
import type { SubjectRef } from '../collaboration/schema';
import type { SubjectEnvelope } from './envelope';
import { SUBJECT_ENVELOPE_VERSION, envelopeStoreId } from './envelope';
import { InboxStore } from './inbox-store';
import type { SubjectTransport, SubjectTransportHealth } from './subject-transport';
import { nowIso } from '../shared/ids';

function makeCommId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

interface PeerEndpointMap {
  byEndpointRef: Record<string, string>;
}

function endpointsPath(packageRoot: string): string {
  return path.join(packageRoot, 'collaboration', 'peer-endpoints.json');
}

async function loadEndpoints(packageRoot: string): Promise<PeerEndpointMap> {
  const file = endpointsPath(packageRoot);
  const result = await readFileWithRecovery(file, (c) => {
    try {
      JSON.parse(c);
      return true;
    } catch {
      return false;
    }
  });
  if (!result.content) return { byEndpointRef: {} };
  try {
    const parsed = JSON.parse(result.content) as PeerEndpointMap;
    return { byEndpointRef: parsed.byEndpointRef || {} };
  } catch {
    return { byEndpointRef: {} };
  }
}

async function saveEndpoints(packageRoot: string, map: PeerEndpointMap): Promise<void> {
  const file = endpointsPath(packageRoot);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWriteFile(file, `${JSON.stringify(map, null, 2)}\n`);
}

export class LocalSubjectTransport implements SubjectTransport {
  constructor(private readonly hostRuntime: DigitalMeRuntime) {}

  private hostRoot(): string {
    return this.hostRuntime.subject.requireActive().rootDir;
  }

  async health(): Promise<SubjectTransportHealth> {
    return {
      mode: 'local_trusted',
      reachable: true,
      capabilities: ['send', 'listInbox', 'acknowledge', 'local_package_open'],
    };
  }

  async registerEndpoint(ref: SubjectRef, packageDir: string): Promise<void> {
    const map = await loadEndpoints(this.hostRoot());
    map.byEndpointRef[ref.endpointRef] = path.resolve(packageDir);
    await saveEndpoints(this.hostRoot(), map);
  }

  async lookupPackageDir(endpointRef: string): Promise<string | null> {
    const map = await loadEndpoints(this.hostRoot());
    const dir = map.byEndpointRef[endpointRef];
    return dir ? path.resolve(dir) : null;
  }

  async resolvePeer(packageDir: string): Promise<SubjectRef & { brief?: string; packageDir: string }> {
    const dir = path.resolve(packageDir);
    const peerRt = this.hostRuntime.createSiblingRuntime();
    try {
      const opened = await peerRt.openPackage({ dir });
      const endpointRef = `subject:${opened.subjectId}`;
      await this.registerEndpoint(
        {
          subjectId: opened.subjectId,
          displayName: opened.displayName,
          endpointRef,
        },
        dir,
      );
      let brief: string | undefined;
      try {
        const overview = await peerRt.getOverview({});
        const line =
          (overview.activeUnderstandings &&
            overview.activeUnderstandings[0] &&
            overview.activeUnderstandings[0].text) ||
          overview.summaryLine ||
          '';
        if (line && String(line).trim()) brief = String(line).trim().slice(0, 120);
      } catch {
        /* optional */
      }
      return {
        subjectId: opened.subjectId,
        displayName: opened.displayName,
        endpointRef,
        packageDir: dir,
        ...(brief ? { brief } : {}),
      };
    } finally {
      await peerRt.stop();
    }
  }

  async openByEndpointRef(endpointRef: string): Promise<{
    runtime: DigitalMeRuntime;
    subjectRef: SubjectRef;
    stop: () => Promise<void>;
  }> {
    const dir = await this.lookupPackageDir(endpointRef);
    if (!dir) {
      throw new Error('协作对象暂不可达：未找到本地端点映射');
    }
    try {
      await fs.access(dir);
    } catch {
      throw new Error('协作对象暂不可达：对方主体包不可访问');
    }
    const runtime = this.hostRuntime.createSiblingRuntime();
    const opened = await runtime.openPackage({ dir });
    return {
      runtime,
      subjectRef: {
        subjectId: opened.subjectId,
        displayName: opened.displayName,
        endpointRef,
      },
      stop: async () => {
        await runtime.stop();
      },
    };
  }

  async send(envelope: SubjectEnvelope): Promise<{ delivered: boolean; duplicate?: boolean }> {
    const opened = await this.openByEndpointRef(envelope.to.endpointRef);
    try {
      const inbox = await InboxStore.open(opened.runtime.subject.requireActive().rootDir);
      const stamped: SubjectEnvelope = {
        ...envelope,
        id: envelopeStoreId(envelope.envelopeId),
        version: SUBJECT_ENVELOPE_VERSION,
        receivedAt: nowIso(),
        transportMeta: { ...envelope.transportMeta, mode: 'local_trusted' },
      };
      const { inserted } = await inbox.putIfAbsent(stamped);

      // 反向端点：对方可回推
      const host = this.hostRuntime.subject.requireActive();
      const peerRoot = opened.runtime.subject.requireActive().rootDir;
      const peerMap = await loadEndpoints(peerRoot);
      peerMap.byEndpointRef[`subject:${host.id}`] = path.resolve(this.hostRoot());
      await saveEndpoints(peerRoot, peerMap);

      // 本方也保留一份已发送副本（outbox 复用 inbox 目录语义：本方也可 list）
      const localInbox = await InboxStore.open(this.hostRoot());
      await localInbox.putIfAbsent({
        ...envelope,
        id: envelopeStoreId(envelope.envelopeId),
        receivedAt: envelope.createdAt,
      });

      return { delivered: true, ...(inserted ? {} : { duplicate: true }) };
    } finally {
      await opened.stop();
    }
  }

  async listInbox(opts: { unreadOnly?: boolean } = {}): Promise<SubjectEnvelope[]> {
    const inbox = await InboxStore.open(this.hostRoot());
    let items = await inbox.list();
    const selfId = this.hostRuntime.subject.requireActive().id;
    // 收件箱：发给本方的
    items = items.filter((e) => e.to.subjectId === selfId);
    if (opts.unreadOnly) {
      items = items.filter((e) => !e.ackedAt);
    }
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return items;
  }

  async acknowledge(envelopeId: string): Promise<{ ok: boolean }> {
    const inbox = await InboxStore.open(this.hostRoot());
    const hit = await inbox.get(envelopeId);
    if (!hit) return { ok: false };
    if (hit.ackedAt) return { ok: true };
    hit.ackedAt = nowIso();
    await inbox.put(hit);
    return { ok: true };
  }
}

export function buildEnvelope(input: {
  from: SubjectRef;
  to: SubjectRef;
  kind: SubjectEnvelope['kind'];
  payload: SubjectEnvelope['payload'];
  correlationId?: string;
  replyTo?: string;
  expiresAt?: string;
}): SubjectEnvelope {
  const envelopeId = makeCommId('envelope');
  const at = nowIso();
  return {
    id: envelopeStoreId(envelopeId),
    version: SUBJECT_ENVELOPE_VERSION,
    envelopeId,
    from: input.from,
    to: input.to,
    kind: input.kind,
    createdAt: at,
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    payload: input.payload,
    transportMeta: { mode: 'local_trusted' },
  };
}
