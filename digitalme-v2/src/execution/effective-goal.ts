/**
 * 当前 Job 的有效目标：即时派生，不覆盖历史 Task.goal，不落第二事实源。
 *
 * - 首次 Job：Task.goal + 已确认规划
 * - Owner 修订 Job：原确认规划作背景，Job.revisionRequest 为本轮权威目标增量
 * - 若本轮有对应修订规划，仅作解释与验收上下文
 */

export type EffectiveGoalAuthority = 'initial_task' | 'owner_revision';

export type EffectiveGoalInput = {
  taskGoal: string;
  confirmedPlan?: string;
  revisionRequest?: string;
  currentPlan?: string;
};

export type JobEffectiveGoal = {
  /** 本轮验收目标（CTO / 执行对本轮负责的对象） */
  acceptanceTarget: string;
  /** 历史 Task.goal，不得被覆盖 */
  originalTaskGoal: string;
  currentRoundAuthority: EffectiveGoalAuthority;
  revisionRequest?: string;
  /** 给验收模型的背景（原规划 / 本轮规划）；不是第二份目标存档 */
  background?: string;
};

export function deriveJobEffectiveGoal(input: EffectiveGoalInput): JobEffectiveGoal {
  const taskGoal = String(input.taskGoal || '').trim();
  const revisionRequest = String(input.revisionRequest || '').trim();
  const confirmedPlan = String(input.confirmedPlan || '').trim();
  const currentPlan = String(input.currentPlan || '').trim();

  if (!revisionRequest) {
    return {
      acceptanceTarget: taskGoal,
      originalTaskGoal: taskGoal,
      currentRoundAuthority: 'initial_task',
      ...(confirmedPlan ? { background: confirmedPlan } : {}),
    };
  }

  const backgroundParts: string[] = [];
  if (taskGoal) {
    backgroundParts.push(`最初目标（仅作背景，不是本轮验收标准）：${taskGoal}`);
  }
  if (confirmedPlan) {
    backgroundParts.push(`原确认规划（背景）：${confirmedPlan}`);
  }
  if (currentPlan && currentPlan !== confirmedPlan) {
    backgroundParts.push(`本轮修订规划：${currentPlan}`);
  } else if (currentPlan && !confirmedPlan) {
    backgroundParts.push(`本轮规划：${currentPlan}`);
  }

  return {
    acceptanceTarget: revisionRequest,
    originalTaskGoal: taskGoal,
    currentRoundAuthority: 'owner_revision',
    revisionRequest,
    ...(backgroundParts.length ? { background: backgroundParts.join('\n') } : {}),
  };
}
