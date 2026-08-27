/**
 * 确认规划的 Job 执行快照。
 * Task.meta.plan 仍是规划权威链；快照只证明本 Job 实际执行的已确认方案，不回写 Task。
 */
import type { CapabilityInput } from '../capability/adapter';
import type { ConfirmedPlanSnapshot, ExecutionJob } from './execution-job';
import type { Task } from './task';

/** 创建 Job 时从当时已确认规划冻结正文；之后不得再读 Task.meta.plan。 */
export function freezeConfirmedPlanSnapshot(
  task: Task | null | undefined,
): ConfirmedPlanSnapshot | undefined {
  const plan = task?.meta?.plan;
  if (plan?.status !== 'confirmed') return undefined;
  if (typeof plan.version !== 'number') return undefined;
  const content = String(plan.content || '');
  if (!content.trim()) return undefined;
  const requirements = (plan.semantic?.requirements || [])
    .map((r) => String(r || '').trim())
    .filter(Boolean)
    .slice(0, 8);
  const requiredCapabilities = (plan.semantic?.requiredCapabilities || []).slice(0, 8);
  return {
    version: plan.version,
    content,
    ...(requirements.length ? { requirements } : {}),
    ...(requiredCapabilities.length ? { requiredCapabilities } : {}),
  };
}

/**
 * 本 Job 执行用的确认规划：只读 Job 快照。
 * 禁止回退到当前 Task.meta.plan。
 */
export function confirmedPlanFromJob(
  job?: Pick<ExecutionJob, 'confirmedPlanSnapshot'> | null,
): CapabilityInput['confirmedPlan'] {
  const snap = job?.confirmedPlanSnapshot;
  if (!snap) return undefined;
  if (typeof snap.version !== 'number') return undefined;
  const content = String(snap.content || '');
  if (!content.trim()) return undefined;
  return { version: snap.version, content };
}
