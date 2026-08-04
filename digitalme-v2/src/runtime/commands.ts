import type { ContextRef, Task } from '../work-runtime/task';
import type { TaskState } from '../work-runtime/derive';
import type { JobStatus } from '../work-runtime/execution-job';
import type { ArtifactContent } from '../work-runtime/artifact';
import type { CapabilityRegistration } from '../capability/registration';
import type { AuthorizationScope } from '../collaboration/schema';
import type { ExportFormat } from '../artifact-workspace/contracts';

/**
 * 命令总线契约(runtime contracts §1.1)。
 * UI ↔ 领域层唯一通道;上限 20 条。
 * 新增命令必须对应新的用户决策或新的领域用例,且经 CTO 复核。
 * subject.captureInput:使用即构建 — 多来源自然语言→候选(非表单门禁)。
 */
export type SubjectCaptureSourceKind =
  | 'initial_self_description'
  | 'imported_material'
  | 'conversation'
  | 'task_requirement'
  | 'artifact_edit'
  | 'artifact_acceptance'
  | 'artifact_rejection'
  | 'repeated_correction'
  | 'explicit_boundary';

export interface CommandMap {
  'subject.createPackage': {
    input: {
      displayName: string;
      targetDir: string;
      /** 一句话自我说明即可;不要求档案完整。 */
      initialSelfDescription?: string;
    };
    output: { subjectId: string };
  };
  'subject.openPackage': {
    input: { dir: string };
    output: { subjectId: string; displayName: string };
  };
  'subject.getOverview': {
    input: Record<string, never>;
    output: {
      subjectId: string;
      displayName: string;
      confirmedExperienceCount: number;
      /** 待确认的要点(用户面用「还不确定」等用语,勿展示内部 type)。 */
      candidateExperiences: Array<{
        eventId: string;
        title: string;
        detail: string;
        type?: string;
        /** 是否建议打扰确认(C 类);低风险可为 false。 */
        requiresConfirmation?: boolean;
      }>;
      /** C 类建议确认的 eventId;不得要求一次确认全部。 */
      confirmationSuggestedEventIds?: string[];
      readiness?: 'empty' | 'needs_confirmation' | 'usable';
      /** 恒为 false:readiness 仅为派生提示,不得阻断 Task。 */
      readinessBlocksTasks?: boolean;
      summaryLine?: string;
      knowledgeGapCount?: number;
    };
  };
  'subject.confirmExperience': {
    input: { eventIds: string[] };
    output: { confirmedCount: number };
  };
  /**
   * 从自然语言捕获候选 — 来源含自我说明/对话/任务/材料/成果反馈等。
   * 本切片允许显式测试调用模拟提炼;不构成完整自动蒸馏管线。
   */
  'subject.captureInput': {
    input: {
      text: string;
      sourceKind: SubjectCaptureSourceKind;
      materialRef?: string;
      taskId?: string;
      artifactId?: string;
    };
    output: { candidateEventIds: string[]; confirmationSuggestedEventIds: string[] };
  };
  /** 导入单文件到主体 materials/,可选产生候选。 */
  'subject.importMaterial': {
    input: { sourcePath: string; distillCandidates?: boolean };
    output: { materialRef: string; candidateEventIds: string[] };
  };
  'work.submitTask': {
    input: {
      goal: string;
      contextRefs: ContextRef[];
      requestedArtifactType: string;
      capabilityId?: string;
    };
    output: { taskId: string; jobId: string };
  };
  'work.retryTask': {
    input: { taskId: string };
    output: { jobId: string };
  };
  /**
   * 对已有成果提出修改要求:同 Task 新 Job,成功后向同一 Artifact 追加 capability 版本。
   * 失败不破坏当前 head。
   */
  'work.reviseArtifact': {
    input: { taskId: string; artifactId: string; revisionRequest: string };
    output: { jobId: string };
  };
  'work.cancelJob': {
    input: { jobId: string };
    output: { cancelled: boolean };
  };
  'work.getTask': {
    input: { taskId: string };
    output: {
      task: Task;
      state: TaskState;
      userFacingLabel: string;
      latestJob?: { jobId: string; status: JobStatus; progressNote?: string };
      artifactIds: string[];
    };
  };
  'work.listTasks': {
    input: { limit?: number };
    output: { tasks: Array<{ taskId: string; goal: string; state: TaskState }> };
  };
  'artifact.getContent': {
    input: { artifactId: string; versionId?: string };
    output: {
      content: ArtifactContent;
      /** text 类内容直接内联返回,供页面直显与编辑。bundle 时为主报告 Markdown。 */
      text?: string;
      headVersionId: string;
      versionCount: number;
      /** bundle 成果的条目与摘要(不新增命令)。 */
      bundle?: {
        entries: Array<{ role?: string; mediaType: string; text?: string }>;
        manifestSummary?: {
          fileCountScanned: number;
          languages: Array<{ language: string; files: number; bytes: number }>;
          truncated: boolean;
          skippedSensitiveCount: number;
          warnings: string[];
        };
      };
    };
  };
  'artifact.saveEdit': {
    input: { artifactId: string; text: string };
    output: { versionId: string };
  };
  'artifact.export': {
    input: { artifactId: string; format: ExportFormat; targetPath?: string };
    output: { path: string };
  };
  'artifact.revealInFolder': {
    input: { artifactId: string };
    output: { opened: boolean };
  };
  'capability.list': {
    input: Record<string, never>;
    output: { capabilities: CapabilityRegistration[] };
  };
  'collab.simulateInteraction': {
    input: { granteeName: string; scope: AuthorizationScope; goal: string };
    output: { requestId: string; grantId: string };
  };
}

export type CommandName = keyof CommandMap;

export const COMMAND_NAMES = [
  'subject.createPackage',
  'subject.openPackage',
  'subject.getOverview',
  'subject.confirmExperience',
  'subject.captureInput',
  'subject.importMaterial',
  'work.submitTask',
  'work.retryTask',
  'work.reviseArtifact',
  'work.cancelJob',
  'work.getTask',
  'work.listTasks',
  'artifact.getContent',
  'artifact.saveEdit',
  'artifact.export',
  'artifact.revealInFolder',
  'capability.list',
  'collab.simulateInteraction',
] as const satisfies readonly CommandName[];

/** 命令面硬上限(architecture §4;超出即架构违规)。 */
export const COMMAND_COUNT_LIMIT = 20;

export interface CommandBus {
  invoke<K extends CommandName>(
    name: K,
    input: CommandMap[K]['input'],
  ): Promise<CommandMap[K]['output']>;
}
