/**
 * 2DIGIME-AI-NATIVE-THIN-RUNTIME-26
 * Owner 薄主链：自然语言 → 当前方案 → 一次确认 → Coding Agent → 按真实结果回复。
 * 复用既有执行器 / 权限 / 存储 / 恢复；不扩展规则矩阵，不新增第二事实源。
 */
import { CODE_CHANGE_ARTIFACT_TYPE } from '../execution/external-executor-contract';
import type { ContextRef, Task } from './task';
import { inspectSoftwareProject } from './work-intent';

export const THIN_RUNTIME_PATH = 'thin_v1' as const;
export type ThinRuntimePath = typeof THIN_RUNTIME_PATH | 'legacy';

export function isThinRuntimeEnabled(): boolean {
  return String(process.env.DIGITALME_THIN_OWNER_RUNTIME || '').trim() !== '0';
}

export function isThinOwnerRuntime(
  task: Pick<Task, 'meta'> | null | undefined,
): boolean {
  return task?.meta?.runtimePath === THIN_RUNTIME_PATH;
}

export function mergeThinContextRefs(
  payloadRefs: readonly ContextRef[],
  taskRefs: readonly ContextRef[] | undefined,
): ContextRef[] {
  if (payloadRefs.some((r) => r.kind === 'folder' && String(r.path || '').trim())) {
    return [...payloadRefs];
  }
  const fromTask = (taskRefs || []).filter(
    (r) => (r.kind === 'folder' || r.kind === 'file') && String(r.path || '').trim(),
  );
  return fromTask.length ? [...fromTask, ...payloadRefs] : [...payloadRefs];
}

function refPathKey(p: string): string {
  return String(p || '').replace(/\\/g, '/').toLowerCase();
}

/**
 * 已有 Task 的目标与已绑定工作目录不得被后续无关 payload 覆盖。
 * 无绑定目录时允许第一次附上项目位置。
 */
export function preserveExistingTaskIdentity(
  existing: { goal: string; contextRefs?: readonly ContextRef[] },
  incoming: { goal?: string; contextRefs?: readonly ContextRef[] },
): { goal: string; contextRefs: ContextRef[] } {
  const existingGoal = String(existing.goal || '').trim();
  const incomingGoal = String(incoming.goal || '').trim();
  const boundFolders = (existing.contextRefs || []).filter(
    (r) => r.kind === 'folder' && String(r.path || '').trim(),
  );
  const incomingRefs = [...(incoming.contextRefs || [])];
  let contextRefs: ContextRef[];
  if (boundFolders.length) {
    const boundKeys = new Set(boundFolders.map((r) => `${r.kind}:${refPathKey(r.path)}`));
    const extraFiles = incomingRefs.filter(
      (r) => r.kind === 'file' && String(r.path || '').trim() && !boundKeys.has(`file:${refPathKey(r.path)}`),
    );
    contextRefs = [...boundFolders, ...extraFiles];
  } else {
    contextRefs = incomingRefs.filter((r) => String(r.path || '').trim());
  }
  return {
    goal: existingGoal || incomingGoal,
    contextRefs,
  };
}

/**
 * 第一阶段：已附软件项目（或空项目候选）即走薄主链。
 * 不依赖意图枚举或目标关键词。
 */
export async function shouldUseThinOwnerRuntime(input: {
  goal: string;
  contextRefs: readonly ContextRef[];
}): Promise<boolean> {
  if (!isThinRuntimeEnabled()) return false;
  const folder = input.contextRefs.find(
    (r) => r.kind === 'folder' && String(r.path || '').trim(),
  );
  if (!folder) return false;
  try {
    const inspected = await inspectSoftwareProject(folder.path);
    return inspected.isSoftwareProject || !!inspected.isNewProjectCandidate;
  } catch {
    return true;
  }
}

export function thinCodeChangeOverride(): {
  intentKind: 'modify_code';
  expectedOutputFamily: string;
  requiresExecutionConfirm: true;
  userFacingNotice: string;
} {
  return {
    intentKind: 'modify_code',
    expectedOutputFamily: CODE_CHANGE_ARTIFACT_TYPE,
    requiresExecutionConfirm: true,
    userFacingNotice:
      '这项任务需要修改项目文件，将交给已连接的代码执行能力完成。开始前你可以查看它能够访问和修改的范围。',
  };
}
