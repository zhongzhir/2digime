import type { JobStatus } from '../work-runtime/execution-job';

/** 领域 → UI 的单向推送事件(runtime contracts §1.2)。 */
export type DomainPushEvent =
  | {
      kind: 'job.updated';
      jobId: string;
      taskId: string;
      status: JobStatus;
      phase?: string;
      progressNote?: string;
    }
  | {
      kind: 'artifact.updated';
      artifactId: string;
      taskId: string;
      headVersionId: string;
    }
  | {
      kind: 'subject.updated';
      subjectId: string;
      summary: string;
    };

export type PushEventListener = (event: DomainPushEvent) => void;
