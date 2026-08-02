/**
 * Task — 用户意图的单一任务对象(domain model §2.3)。
 * P0.1:Task 是纯意图对象,不持有 Job/Artifact/Snapshot 指针;
 * 关联关系由 Job.taskId / Artifact.taskId / Snapshot.taskId 反向承载,
 * 状态由 derive.ts 从 Job 集合派生。"单活跃 Job"由执行器查询 Job Store 强制,
 * 不依赖 Task 上的镜像字段(消除双事实源)。
 */
export interface Task {
  id: string;
  subjectId: string;
  createdAt: string;
  /** 任务目标大输入区原文。 */
  goal: string;
  contextRefs: ContextRef[];
  requestedArtifactType: string;
  capabilityId?: string;
}

export interface ContextRef {
  kind: 'file' | 'folder';
  path: string;
}
