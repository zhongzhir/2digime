import type { ObjectStore } from '../runtime/ports';
import { newId, nowIso } from '../shared/ids';
import type { ContextRef, Task } from './task';
import type { TaskIntentKind } from './work-intent';

/**
 * TaskService — 纯意图任务的创建与查询。
 * 不保存 status / jobIds / artifactIds / activeJobId;
 * 关联一律经 taskId 在 Job/Artifact/Snapshot Store 上反向查询。
 */
export class TaskService {
  constructor(private readonly store: ObjectStore<Task>) {}

  async create(input: {
    subjectId: string;
    goal: string;
    contextRefs: ContextRef[];
    requestedArtifactType: string;
    intentKind?: TaskIntentKind;
    capabilityId?: string;
    authorization?: Task['authorization'];
  }): Promise<Task> {
    const goal = input.goal.trim();
    if (goal.length === 0) {
      throw new Error('task goal must not be empty');
    }
    for (const ref of input.contextRefs) {
      if (ref.kind !== 'file' && ref.kind !== 'folder') {
        throw new Error(`invalid context ref kind: ${String((ref as ContextRef).kind)}`);
      }
      if (typeof ref.path !== 'string' || ref.path.trim().length === 0) {
        throw new Error('context ref path must not be empty');
      }
    }
    if (input.requestedArtifactType.trim().length === 0) {
      throw new Error('requestedArtifactType must not be empty');
    }

    const task: Task = {
      id: newId('task'),
      subjectId: input.subjectId,
      createdAt: nowIso(),
      goal,
      contextRefs: input.contextRefs.map((r) => ({
        kind: r.kind,
        path: r.path,
        ...(r.projectOrigin ? { projectOrigin: r.projectOrigin } : {}),
      })),
      requestedArtifactType: input.requestedArtifactType,
    };
    if (input.intentKind !== undefined) {
      task.intentKind = input.intentKind;
    }
    if (input.capabilityId !== undefined) {
      task.capabilityId = input.capabilityId;
    }
    if (input.authorization) {
      task.authorization = { ...input.authorization };
    }
    await this.store.put(task);
    return task;
  }

  /** 向既有 Task 追加材料路径（截图反馈等）；不新建 Task。 */
  async appendContextRefs(taskId: string, refs: ContextRef[]): Promise<Task> {
    const task = await this.store.get(taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    const existing = new Set(task.contextRefs.map((r) => `${r.kind}:${pathKey(r.path)}`));
    const next = [...task.contextRefs];
    for (const ref of refs) {
      if (ref.kind !== 'file' && ref.kind !== 'folder') continue;
      if (!ref.path || !String(ref.path).trim()) continue;
      const key = `${ref.kind}:${pathKey(ref.path)}`;
      if (existing.has(key)) continue;
      existing.add(key);
      next.push({
        kind: ref.kind,
        path: ref.path,
        ...(ref.projectOrigin ? { projectOrigin: ref.projectOrigin } : {}),
      });
    }
    const updated: Task = { ...task, contextRefs: next };
    await this.store.put(updated);
    return updated;
  }

  async get(id: string): Promise<Task | null> {
    return this.store.get(id);
  }

  async list(limit?: number): Promise<Task[]> {
    const all = await this.store.list();
    all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    if (limit === undefined || limit >= all.length) return all;
    return all.slice(0, Math.max(0, limit));
  }
}

function pathKey(p: string): string {
  return String(p || '').replace(/\\/g, '/').toLowerCase();
}
