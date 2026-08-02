/**
 * GrowthEvent — 新知识进入主体的唯一方式;追加式、不可变(domain model §2.2)。
 * P0.1:payload 增加 evidence 锚点(指向具体修改),支撑
 * "用户具体修改 → confirmed 精确经验 → 下一任务复用"的最小成长闭环;
 * 确认动作 = 追加 confirmed 事件并以 confirms 指回 candidate,不修改历史事件。
 */
export type GrowthEventType =
  | 'preference_observed'
  | 'experience_confirmed'
  | 'asset_added'
  | 'boundary_updated'
  | 'goal_updated'
  | 'feedback_recorded';

export type GrowthEventSourceKind = 'task_feedback' | 'artifact_edit' | 'owner_direct' | 'import';

export interface GrowthEvent {
  id: string;
  subjectId: string;
  occurredAt: string;
  type: GrowthEventType;
  source: {
    kind: GrowthEventSourceKind;
    taskId?: string;
    artifactId?: string;
    jobId?: string;
  };
  /** 类型化载荷;首切片为文本经验/偏好条目。 */
  payload: {
    title: string;
    detail: string;
    tags?: string[];
    /** 精确锚点:该经验源自哪次具体修改(版本对)。 */
    evidence?: {
      artifactId: string;
      fromVersionId?: string;
      toVersionId: string;
    };
  };
  /** candidate 不进入任务上下文;confirmed 才可注入。 */
  confidence: 'confirmed' | 'candidate';
  /** 本事件确认的 candidate 事件 id(仅 experience_confirmed 使用)。 */
  confirms?: string;
}

/** 确认 candidate:追加式生成 confirmed 事件,保留原 payload 与 evidence 锚点。 */
export function confirmCandidate(candidate: GrowthEvent, newEventId: string, at: string): GrowthEvent {
  if (candidate.confidence !== 'candidate') {
    throw new Error(`event ${candidate.id} is not a candidate`);
  }
  return {
    id: newEventId,
    subjectId: candidate.subjectId,
    occurredAt: at,
    type: 'experience_confirmed',
    source: { kind: 'owner_direct' },
    payload: candidate.payload,
    confidence: 'confirmed',
    confirms: candidate.id,
  };
}
