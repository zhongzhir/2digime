import type { ObjectStore } from '../runtime/ports';
import { newId, nowIso } from '../shared/ids';
import type {
  ContextRef,
  Task,
  TaskConversationTurn,
  TaskIntentConclusion,
  TaskMeta,
  TaskPlan,
} from './task';
import type { TaskRevisionLoopMeta } from './controlled-revision';
import type { TaskIntentKind } from './work-intent';
import { preserveExistingTaskIdentity } from './thin-owner-start';

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
    meta?: Pick<TaskMeta, 'runtimePath'>;
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
    if (input.meta?.runtimePath) {
      task.meta = { runtimePath: input.meta.runtimePath };
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

  /**
   * 追加对话轮与意图结论（D11-A）。
   * 追加式写入:不改写历史轮;意图结论经 turnId 引用,不进对话正文。
   */
  async appendConversation(
    taskId: string,
    input: { turns: TaskConversationTurn[]; intents?: TaskIntentConclusion[] },
  ): Promise<Task> {
    const task = await this.store.get(taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    const conversation = task.meta?.conversation ?? { turns: [], intents: [] };
    const updated: Task = {
      ...task,
      meta: {
        ...(task.meta ?? {}),
        conversation: {
          turns: [...conversation.turns, ...input.turns],
          intents: [...conversation.intents, ...(input.intents ?? [])],
        },
      },
    };
    await this.store.put(updated);
    return updated;
  }

  /** 写入/替换当前规划（唯一保存处;不复制到对话或 Job）。 */
  async updatePlan(taskId: string, plan: TaskPlan): Promise<Task> {
    const task = await this.store.get(taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    const updated: Task = {
      ...task,
      meta: { ...(task.meta ?? {}), plan },
    };
    await this.store.put(updated);
    return updated;
  }

  /**
   * D11-D：受控修订审计元数据。attempts 只追加，最多保留最近 30 条。
   * 调用方可用函数式 patch 在同一读取快照上构造下一状态。
   */
  async updateRevisionLoop(
    taskId: string,
    patch:
      | Partial<TaskRevisionLoopMeta>
      | ((prev: TaskRevisionLoopMeta) => TaskRevisionLoopMeta),
  ): Promise<Task> {
    const task = await this.store.get(taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    const prev: TaskRevisionLoopMeta = task.meta?.revisionLoop ?? {
      attempts: [],
      autoRoundCount: 0,
    };
    let revisionLoop: TaskRevisionLoopMeta;
    if (typeof patch === 'function') {
      // 函数式 patch：调用方负责完整下一状态；attempts 以返回值为准，仅截断长度
      const next = patch(prev);
      revisionLoop = {
        ...next,
        attempts: (next.attempts ?? []).slice(-30),
        autoRoundCount: next.autoRoundCount ?? prev.autoRoundCount,
      };
    } else {
      const added = Array.isArray(patch.attempts) ? patch.attempts : [];
      revisionLoop = {
        ...prev,
        ...patch,
        attempts: [...prev.attempts, ...added].slice(-30),
        autoRoundCount: patch.autoRoundCount ?? prev.autoRoundCount,
      };
    }
    const updated: Task = {
      ...task,
      meta: { ...(task.meta ?? {}), revisionLoop },
    };
    await this.store.put(updated);
    return updated;
  }

  /** 写入/更新工作单元身份（originTurn + converse recovery）。 */
  async updateWorkUnit(
    taskId: string,
    workUnit: import('./work-unit-ownership').TaskWorkUnitMeta,
  ): Promise<Task> {
    const task = await this.store.get(taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    const updated: Task = {
      ...task,
      meta: { ...(task.meta ?? {}), workUnit },
    };
    await this.store.put(updated);
    return updated;
  }

  /**
   * 确定性开始执行前同步任务事实（goal/意图/能力/产出族）。
   * 仅用于「先对话建任务、确认后在同一 Task 上执行」;不新建 Task。
   */
  async updateForSubmit(
    taskId: string,
    input: {
      goal?: string;
      contextRefs?: ContextRef[];
      requestedArtifactType?: string;
      intentKind?: TaskIntentKind;
      capabilityId?: string;
    },
  ): Promise<Task> {
    const task = await this.store.get(taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    const identity = preserveExistingTaskIdentity(task, {
      ...(input.goal ? { goal: input.goal } : {}),
      ...(input.contextRefs ? { contextRefs: input.contextRefs } : {}),
    });
    const updated: Task = {
      ...task,
      goal: identity.goal || task.goal,
      ...(input.contextRefs
        ? {
            contextRefs: identity.contextRefs.map((r) => ({
              kind: r.kind,
              path: r.path,
              ...(r.projectOrigin ? { projectOrigin: r.projectOrigin } : {}),
            })),
          }
        : {}),
      ...(input.requestedArtifactType
        ? { requestedArtifactType: input.requestedArtifactType }
        : {}),
      ...(input.intentKind !== undefined ? { intentKind: input.intentKind } : {}),
      ...(input.capabilityId !== undefined ? { capabilityId: input.capabilityId } : {}),
    };
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
