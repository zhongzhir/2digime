import type { ContextRef, Task } from '../work-runtime/task';
import type { TaskState } from '../work-runtime/derive';
import type { JobStatus } from '../work-runtime/execution-job';
import type { ArtifactContent } from '../work-runtime/artifact';
import type { CapabilityRegistration } from '../capability/registration';
import type { AuthorizationScope } from '../collaboration/schema';
import type { ExportFormat } from '../artifact-workspace/contracts';

/**
 * 命令总线契约(runtime contracts §1.1)。
 * UI ↔ 领域层唯一通道;当前 16 条,上限 20 条。
 * 新增命令必须对应新的用户决策或新的领域用例,且经 CTO 复核。
 * P0.1 新增 subject.confirmExperience:确认候选经验是真实的新用户决策
 * (成长闭环第 7→8 步),现有命令无法参数化承载。
 */
export interface CommandMap {
  'subject.createPackage': {
    input: { displayName: string; targetDir: string };
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
      /** 待确认的候选经验(用户面文案:来自你最近修改的可复用经验)。 */
      candidateExperiences: Array<{ eventId: string; title: string; detail: string }>;
    };
  };
  'subject.confirmExperience': {
    input: { eventIds: string[] };
    output: { confirmedCount: number };
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
      /** text 类内容直接内联返回,供页面直显与编辑。 */
      text?: string;
      headVersionId: string;
      versionCount: number;
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
