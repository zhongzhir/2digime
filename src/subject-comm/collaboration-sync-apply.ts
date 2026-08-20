/**
 * 将 collaboration_sync 应用到本机 RecordStore（接收方路径）。
 * 不打开对端 package；不依赖文件系统路径映射。
 */
import { CollaborationRecordStore } from '../collaboration/record-store';
import { mergeIncomingEvents } from '../collaboration/record-derive';
import type { CollaborationSyncPayload } from './envelope';

export function isCollaborationSyncPayload(p: unknown): p is CollaborationSyncPayload {
  return !!p && typeof p === 'object' && 'recordId' in p && 'events' in p;
}

export async function applyCollaborationSyncLocally(
  packageRootDir: string,
  payload: CollaborationSyncPayload,
): Promise<{ recordId: string; merged: boolean }> {
  const store = await CollaborationRecordStore.open(packageRootDir);
  let existing = await store.get(payload.recordId);
  if (!existing) {
    if (!payload.seedRecord) {
      throw new Error('对方尚无协作记录且未提供初始副本');
    }
    existing = { ...payload.seedRecord, events: [] };
  }
  const merged = mergeIncomingEvents(existing, payload.events);
  if (!(await store.get(payload.recordId)) && payload.seedRecord) {
    await store.put({
      ...payload.seedRecord,
      events: merged.events,
      updatedAt: merged.updatedAt,
    });
  } else {
    await store.put(merged);
  }
  return { recordId: payload.recordId, merged: true };
}
