/**
 * 协作传输边界：Record/合同不依赖部署位置；路径只存在于本机 Transport。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile, readFileWithRecovery } from '../infrastructure/fs-atomic';
import type { DigitalMeRuntime } from '../runtime/digitalme-runtime';
import type { CollaborationEvent, CollaborationRecord, SubjectRef } from './schema';
import { CollaborationRecordStore } from './record-store';
import { mergeIncomingEvents } from './record-derive';

export interface CollaborationTransport {
  resolvePeer(packageDir: string): Promise<SubjectRef & { brief?: string }>;
  openByEndpointRef(endpointRef: string): Promise<{
    runtime: DigitalMeRuntime;
    subjectRef: SubjectRef;
    stop: () => Promise<void>;
  }>;
  registerEndpoint(ref: SubjectRef, packageDir: string): Promise<void>;
  lookupPackageDir(endpointRef: string): Promise<string | null>;
  /** 将本方新事件推送到对方已接收副本（幂等按 eventId）。 */
  pushEvents(input: {
    endpointRef: string;
    recordId: string;
    events: CollaborationEvent[];
    seedRecord?: CollaborationRecord;
  }): Promise<void>;
  pullRecord(endpointRef: string, recordId: string): Promise<CollaborationRecord | null>;
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

/**
 * 同设备双 Package 传输实现。绝对路径仅存于此映射，不进入 CollaborationRecord。
 */
export class LocalPackageTransport implements CollaborationTransport {
  constructor(private readonly hostRuntime: DigitalMeRuntime) {}

  private hostRoot(): string {
    return this.hostRuntime.subject.requireActive().rootDir;
  }

  async resolvePeer(packageDir: string): Promise<SubjectRef & { brief?: string }> {
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
        ...(brief ? { brief } : {}),
      };
    } finally {
      await peerRt.stop();
    }
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

  async pushEvents(input: {
    endpointRef: string;
    recordId: string;
    events: CollaborationEvent[];
    seedRecord?: CollaborationRecord;
  }): Promise<void> {
    const opened = await this.openByEndpointRef(input.endpointRef);
    try {
      const store = await CollaborationRecordStore.open(opened.runtime.subject.requireActive().rootDir);
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
      // 若是新建，补齐身份字段
      if (!(await store.get(input.recordId)) && input.seedRecord) {
        await store.put({
          ...input.seedRecord,
          events: merged.events,
          updatedAt: merged.updatedAt,
        });
      } else {
        await store.put(merged);
      }
    } finally {
      await opened.stop();
    }
  }

  async pullRecord(endpointRef: string, recordId: string): Promise<CollaborationRecord | null> {
    const opened = await this.openByEndpointRef(endpointRef);
    try {
      const store = await CollaborationRecordStore.open(opened.runtime.subject.requireActive().rootDir);
      return store.get(recordId);
    } finally {
      await opened.stop();
    }
  }
}
