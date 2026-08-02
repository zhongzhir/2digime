import type { ContextSnapshot } from '../work-runtime/context-snapshot';
import type { ConfirmedExperienceView } from '../subject-core/derived-views';
import type { CapabilityRegistration } from './registration';

/**
 * CapabilityAdapter — 能力接入的唯一形态(runtime contracts §2)。
 * 实现方不得触碰 Store;只消费输入、产出结果。
 * P0.1:产出载荷为 text/file/bundle 三形,由执行器持久化为 ArtifactContent 引用;
 * 图像/视频等二进制成果走 file/bundle,不需要改主链。
 */
export interface CapabilityAdapter {
  readonly registration: CapabilityRegistration;
  execute(input: CapabilityInput, ctx: ExecutionContext): Promise<CapabilityOutput>;
}

export interface CapabilityInput {
  goal: string;
  snapshot: ContextSnapshot;
  subjectContext: ConfirmedExperienceView;
  artifactType: string;
}

export interface ExecutionContext {
  jobId: string;
  /** 映射到 job.updated 推送。 */
  reportProgress(note: string): void;
  /** cancelled 传播。 */
  signal: AbortSignal;
  /** 声明的权限内取密钥。 */
  secrets: SecretAccessor;
  /** Adapter 可写的工作目录(file/bundle 载荷的产出位置)。 */
  workDir: string;
  /**
   * 只读解析 Snapshot 中的 extractedTextRef。
   * 由 Runner 注入;Adapter 不得持有 ContentStore。
   */
  readExtractedText?(ref: string): Promise<string>;
}

export interface SecretAccessor {
  get(key: string): Promise<string | null>;
}

/** Adapter 产出载荷:执行器负责搬运/落盘为 ArtifactContent 引用。 */
export type CapabilityArtifactPayload =
  | { kind: 'text'; format: 'markdown' | 'plain'; text: string }
  | { kind: 'file'; sourcePath: string; mediaType: string }
  | { kind: 'bundle'; entries: Array<{ sourcePath: string; mediaType: string; role?: string }> };

export interface CapabilityOutput {
  artifact: {
    type: string;
    title: string;
    payload: CapabilityArtifactPayload;
  };
  costActual?: { tokens?: number };
}
