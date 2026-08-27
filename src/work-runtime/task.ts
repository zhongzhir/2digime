/**
 * Task — 用户意图的单一任务对象(domain model §2.3)。
 * P0.1:Task 是纯意图对象,不持有 Job/Artifact/Snapshot 指针;
 * 关联关系由 Job.taskId / Artifact.taskId / Snapshot.taskId 反向承载,
 * 状态由 derive.ts 从 Job 集合派生。"单活跃 Job"由执行器查询 Job Store 强制,
 * 不依赖 Task 上的镜像字段(消除双事实源)。
 *
 * intentKind ≠ capabilityId ≠ requestedArtifactType(期望产出族)。
 */
import type { TaskIntentKind } from './work-intent';
import type { TaskRevisionLoopMeta } from './controlled-revision';
import type { PlannerSemanticDecision } from './planner-semantic';

export interface Task {
  id: string;
  subjectId: string;
  createdAt: string;
  /** 任务目标大输入区原文。 */
  goal: string;
  contextRefs: ContextRef[];
  /**
   * Task 级附属事实（D11-A，Owner 批准 2026-08-11）：
   * - conversation:当前任务对话的唯一权威记录（可恢复、可审计）;
   * - plan:当前规划、版本与确认事实。
   * 不构成第二状态机;不保存提示词或模型思维链。
   */
  meta?: TaskMeta;
  /**
   * 期望产出族（如 document / code-analysis）。
   * 不再单独承担任务分类或能力选择键。
   */
  requestedArtifactType: string;
  /**
   * 可选任务意图（派生后写入，便于重启/重试保持语义）。
   * 缺省时按旧行为：仅依赖 requestedArtifactType。
   */
  intentKind?: TaskIntentKind;
  capabilityId?: string;
  /**
   * 可选：本机协作授权溯源（非状态机）。
   * 写入 Snapshot.authorization，证明披露范围由 Grant 约束。
   */
  authorization?: {
    grantId: string;
    issuerSubjectId: string;
    granteeSubjectId: string;
  };
}

export interface ContextRef {
  kind: 'file' | 'folder';
  path: string;
  /** 文件夹来源：Digital Me 创建 / 用户自选（非第二 Store）。 */
  projectOrigin?: 'digitalme_created' | 'user_selected' | 'unknown';
}

export interface TaskMeta {
  conversation?: TaskConversation;
  plan?: TaskPlan;
  /**
   * D11-D：不是第二状态机；attempts 是自动修订的审计记录，
   * 连续失败数由 attempts 与 Job 事实派生。
   */
  revisionLoop?: TaskRevisionLoopMeta;
  /**
   * 2DIGIME-AI-NATIVE-THIN-RUNTIME-26：Owner 薄主链标记。
   * 只影响确认与意图绕开策略；不构成第二状态机。
   */
  runtimePath?: 'legacy' | 'thin_v1';
}

/**
 * Task 级对话（唯一权威记录）。
 * 只落盘可见对话与意图结论引用；内部提示词、模型思维链一律不落盘。
 */
export interface TaskConversation {
  turns: TaskConversationTurn[];
  /** AI 意图结论（经 turnId 引用关联用户轮，不写入对话正文）。 */
  intents: TaskIntentConclusion[];
}

export interface TaskConversationTurn {
  turnId: string;
  role: 'user' | 'digital_me';
  content: string;
  createdAt: string;
  /** 用户轮可引用对应意图结论。 */
  intentId?: string;
}

export interface TaskIntentConclusion {
  intentId: string;
  /** 关联的用户轮。 */
  turnId: string;
  /** work-converse 意图枚举之一。 */
  intent: string;
  /** 0..1。 */
  confidence: number;
  needsClarification?: boolean;
  /** 模型不可用降级时为 true。 */
  degraded?: boolean;
  createdAt: string;
}

/**
 * 任务规划（当前版本 + 确认事实）。
 * 规划正文只保存在此处，不复制到对话、Job 或其他字段。
 */
export interface TaskPlan {
  version: number;
  status: 'draft' | 'confirmed';
  content: string;
  updatedAt: string;
  confirmedAt?: string;
  /** 已确认事实（用户明确认可的目标/边界要点）。 */
  confirmedFacts?: string[];
  /**
   * model：用户可见的 CTO 规划（可确认开始）。
   * seed_internal：仅内部恢复材料，不得展示为「开发规划」、不得授权开始。
   * 缺省按历史数据视为 model（兼容旧包）。
   */
  source?: 'model' | 'seed_internal';
  /**
   * Planner-owned semantic decision (delivery vs capability needs).
   * Control may validate shape and enforce safety; it must not reinterpret.
   */
  semantic?: PlannerSemanticDecision;
}
