/**
 * Work-unit ownership — Turn → Task → Job 身份关联。
 * 排序可用 latest/list[0]；事实归属不得用它们。
 */
import type { Task, TaskConversationTurn } from './task';

export const WORK_UNITS = ['new', 'continue', 'confirm', 'recover'] as const;
export type WorkUnitKind = (typeof WORK_UNITS)[number];

export const STALE_CONFIRMATION_CODE = 'stale_confirmation';
export const STALE_CONFIRMATION_NOTICE =
  '这项工作已经完成。新的目标请作为新任务发送，不能再确认到旧任务上。';

export const CONVERSE_TRANSIENT_MAX_ATTEMPTS = 3;

export type ConverseRecoveryStatus = 'pending' | 'recovered' | 'exhausted';

export interface TaskWorkUnitMeta {
  /** 建立本工作单元的用户轮（首轮 user turn）。 */
  originTurnId: string;
  converseRecovery?: {
    status: ConverseRecoveryStatus;
    attempts: number;
    updatedAt: string;
  };
}

export function isWorkUnitKind(value: unknown): value is WorkUnitKind {
  return typeof value === 'string' && (WORK_UNITS as readonly string[]).includes(value);
}

export function firstUserTurn(task: Task): TaskConversationTurn | undefined {
  const turns = task.meta?.conversation?.turns ?? [];
  return turns.find((t) => t && t.role === 'user');
}

export function originatingTurnIdFromTask(task: Task): string | undefined {
  const fromMeta = String(task.meta?.workUnit?.originTurnId || '').trim();
  if (fromMeta) return fromMeta;
  const first = firstUserTurn(task);
  return first?.turnId;
}

export function turnBelongsToTask(task: Task, turnId: string): boolean {
  const id = String(turnId || '').trim();
  if (!id) return false;
  if (String(task.meta?.workUnit?.originTurnId || '') === id) return true;
  const turns = task.meta?.conversation?.turns ?? [];
  return turns.some((t) => t && t.turnId === id);
}

export function isClosedForNewExecution(facts: {
  hasArtifact?: boolean;
  latestJobStatus?: string;
  jobRunning?: boolean;
}): boolean {
  if (facts.jobRunning) return false;
  return !!facts.hasArtifact && facts.latestJobStatus === 'succeeded';
}

export function workUnitRecoveryExhausted(task: Task | null | undefined): boolean {
  return task?.meta?.workUnit?.converseRecovery?.status === 'exhausted';
}

/**
 * 决定本次 converse 绑到哪一个 Task。
 * workUnit=new 忽略任何泄漏的 taskId。
 * workUnit=confirm 必须带 taskId；已完成 Task 拒绝，不得改写旧 Task。
 */
export function resolveConverseBinding(input: {
  requestedTaskId?: string;
  workUnit?: WorkUnitKind;
  closedForNewExecution?: boolean;
}):
  | { action: 'create_new' }
  | { action: 'use_requested'; taskId: string }
  | { action: 'reject_stale_confirm'; taskId: string } {
  const requested = String(input.requestedTaskId || '').trim();
  const unit = input.workUnit;
  if (unit === 'confirm') {
    if (!requested || input.closedForNewExecution) {
      return { action: 'reject_stale_confirm', taskId: requested };
    }
    return { action: 'use_requested', taskId: requested };
  }
  if (unit === 'new' || !requested) {
    return { action: 'create_new' };
  }
  return { action: 'use_requested', taskId: requested };
}

export function staleConfirmationError(): Error {
  return Object.assign(new Error(STALE_CONFIRMATION_NOTICE), {
    code: STALE_CONFIRMATION_CODE,
    actionable: STALE_CONFIRMATION_NOTICE,
  });
}
