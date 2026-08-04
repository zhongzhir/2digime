/**
 * GrowthEvent — 新知识进入主体的唯一方式;追加式、不可变(domain model §2.2)。
 * 确认动作 = 追加 confirmed 事件并以 confirms 指回 candidate,不修改历史事件。
 * 实践反馈:feedback_recorded → experience_confirmed;
 * 其他候选确认后保持原类型,仅 confidence 变为 confirmed。
 */
export type GrowthEventType =
  | 'preference_observed'
  | 'experience_confirmed'
  | 'asset_added'
  | 'boundary_updated'
  | 'goal_updated'
  | 'feedback_recorded'
  | 'identity_clarified'
  | 'principle_stated'
  | 'knowledge_gap_noted'
  | 'subject_corrected';

export type GrowthEventSourceKind = 'task_feedback' | 'artifact_edit' | 'owner_direct' | 'import';

export type SubjectCorrectionAction = 'reject' | 'replace';

export interface GrowthEventRelation {
  supersedes?: string;
  targetEventId?: string;
  materialRef?: string;
}

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
  payload: {
    title: string;
    detail: string;
    tags?: string[];
    evidence?: {
      artifactId: string;
      fromVersionId?: string;
      toVersionId: string;
    };
    relation?: GrowthEventRelation;
  };
  /** candidate 不进入任务上下文;confirmed 才可注入。 */
  confidence: 'confirmed' | 'candidate';
  /** 本事件确认的 candidate 事件 id。 */
  confirms?: string;
}

/** 实践反馈确认后映射为 experience_confirmed;其余保持原类型。 */
export function confirmedTypeForCandidate(candidateType: GrowthEventType): GrowthEventType {
  if (candidateType === 'feedback_recorded') return 'experience_confirmed';
  return candidateType;
}

/** 确认 candidate:追加式生成 confirmed 事件,保留原 payload 与 evidence 锚点。 */
export function confirmCandidate(candidate: GrowthEvent, newEventId: string, at: string): GrowthEvent {
  if (candidate.confidence !== 'candidate') {
    throw new Error(`event ${candidate.id} is not a candidate`);
  }
  if (candidate.type === 'knowledge_gap_noted') {
    throw new Error('knowledge_gap_noted cannot be confirmed into authoritative injection');
  }
  if (candidate.type === 'subject_corrected') {
    throw new Error('subject_corrected is written directly, not via candidate confirm');
  }
  const event: GrowthEvent = {
    id: newEventId,
    subjectId: candidate.subjectId,
    occurredAt: at,
    type: confirmedTypeForCandidate(candidate.type),
    // 保留任务/成果溯源，便于采用状态由事件派生（不另建 Store）。
    source: {
      kind: candidate.source.kind,
      ...(candidate.source.taskId ? { taskId: candidate.source.taskId } : {}),
      ...(candidate.source.artifactId ? { artifactId: candidate.source.artifactId } : {}),
      ...(candidate.source.jobId ? { jobId: candidate.source.jobId } : {}),
    },
    payload: { ...candidate.payload },
    confidence: 'confirmed',
    confirms: candidate.id,
  };
  return event;
}

export function correctionActionOf(event: GrowthEvent): SubjectCorrectionAction | null {
  if (event.type !== 'subject_corrected') return null;
  const tags = event.payload.tags ?? [];
  if (tags.includes('action:reject')) return 'reject';
  if (tags.includes('action:replace')) return 'replace';
  return null;
}
