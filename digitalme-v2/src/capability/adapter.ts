import type { ContextSnapshot } from '../work-runtime/context-snapshot';
import type { ConfirmedExperienceView } from '../subject-core/derived-views';
import type { CapabilityRegistration } from './registration';
import type { RemoteAuthorizationProjection } from './remote-authorization';

/**
 * CapabilityAdapter — 能力接入的唯一形态(runtime contracts §2)。
 * 实现方不得触碰 Store;只消费输入、产出结果。
 * P0.1:产出载荷为 text/file/bundle 三形,由执行器持久化为 ArtifactContent 引用;
 * 图像/视频等二进制成果走 file/bundle,不需要改主链。
 *
 * DIGITALME-V2-REMOTE-CAPABILITY-PRODUCT-READINESS-01:
 * 冻结统一生命周期合同;协议 Adapter 不得成为 Job 权威。
 */
export interface CapabilityAdapter {
  readonly registration: CapabilityRegistration;
  /** 静态描述(可展示/可审计),不含运行态。 */
  describe(): AdapterDescribeResult;
  /** 当前可用性探测(本地确定性或轻量探测)。 */
  checkAvailability(ctx?: AvailabilityProbeContext): Promise<AvailabilityCheckResult>;
  /**
   * 按授权投影裁剪字段与材料后再执行。
   * 本地同步能力可原样返回;远端能力必须裁剪。
   */
  prepareAuthorizedInput(
    input: CapabilityInput,
    auth: RemoteAuthorizationProjection,
    ctx: ExecutionContext,
  ): Promise<CapabilityInput>;
  execute(input: CapabilityInput, ctx: ExecutionContext): Promise<CapabilityOutput>;
  getStatus(ref: RemoteExecutionRef, ctx: ExecutionContext): Promise<RemoteStatusView>;
  cancel(ref: RemoteExecutionRef, ctx: ExecutionContext): Promise<RemoteCancelResult>;
  recover(ref: RemoteExecutionRef, ctx: ExecutionContext): Promise<RemoteRecoverResult>;
  collectArtifact(ref: RemoteExecutionRef, ctx: ExecutionContext): Promise<CapabilityOutput>;
}

/** 远端执行引用 — 映射字段,不是第二状态机权威。 */
export interface RemoteExecutionRef {
  executionId: string;
  adapterId: string;
  endpoint?: string;
}

export type RemoteLifecycleStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface RemoteStatusView {
  status: RemoteLifecycleStatus;
  message?: string;
  /** 远端是否确认取消请求(取消请求本身失败时可为 false)。 */
  remoteAck?: boolean;
}

export interface RemoteCancelResult {
  cancelled: boolean;
  remoteAck: boolean;
  message?: string;
}

export interface RemoteRecoverResult {
  status: RemoteLifecycleStatus;
  output?: CapabilityOutput;
  message?: string;
}

export interface AdapterDescribeResult {
  adapterId: string;
  adapterType: CapabilityRegistration['adapter']['type'];
  capabilityId: string;
  displayName: string;
  location: CapabilityRegistration['location'];
  outputArtifactTypes: string[];
  supportsAsyncRemote: boolean;
  version: string;
}

export interface AvailabilityProbeContext {
  signal?: AbortSignal;
}

export interface AvailabilityCheckResult {
  available: boolean;
  reason?: string;
  detail?: string;
}

export interface CapabilityInput {
  goal: string;
  snapshot: ContextSnapshot;
  subjectContext: ConfirmedExperienceView;
  artifactType: string;
  /**
   * 修改成果时由 Runner 注入:当前 head 文本与用户修改要求。
   * 非持久核心对象;仅一次执行输入。
   */
  revision?: {
    request: string;
    previousText: string;
    artifactId: string;
  };
  /**
   * 授权投影附带字段(可选);prepareAuthorizedInput 可写入。
   * 不得携带未授权正文。
   */
  authorized?: {
    purpose?: string;
    allowedMaterialPaths?: string[];
    materialDigests?: string[];
    grantId?: string;
  };
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
  /**
   * 可选:远端执行绑定回调。Runner 写入 Job.remoteExecution 映射。
   * Adapter 不得据此自建权威状态机。
   */
  bindRemoteExecution?(ref: RemoteExecutionRef & { lastRemoteStatus?: RemoteLifecycleStatus }): void;
  /** 可选:更新远端映射状态。 */
  updateRemoteExecution?(patch: {
    lastRemoteStatus?: RemoteLifecycleStatus;
    executionId?: string;
  }): void;
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
  /** 候选成果元数据;验证前不得当作已提交 Artifact。 */
  candidateMeta?: {
    provenance?: string;
    sourceBinding?: string;
    contentDigest?: string;
    producedAt?: string;
    /**
     * 成果完整性追溯 — 区分模型原文与确定性格式化。
     * reachedModel 只表示调用到模型，不表示成果合格。
     */
    contentIntegrity?: {
      modelGeneratedContent: string;
      modelContentDigest: string;
      deterministicFormatting: string[];
      reachedModel?: boolean;
      revisionAttempted?: boolean;
      insufficientLength?: boolean;
    };
  };
}

/** 仅实现 execute 的局部 Adapter;经 asLocalCapabilityAdapter 补齐合同。 */
export type LocalCapabilityAdapterCore = {
  readonly registration: CapabilityRegistration;
  execute(input: CapabilityInput, ctx: ExecutionContext): Promise<CapabilityOutput>;
  describe?: () => AdapterDescribeResult;
  checkAvailability?: (ctx?: AvailabilityProbeContext) => Promise<AvailabilityCheckResult>;
  prepareAuthorizedInput?: (
    input: CapabilityInput,
    auth: RemoteAuthorizationProjection,
    ctx: ExecutionContext,
  ) => Promise<CapabilityInput>;
  getStatus?: (ref: RemoteExecutionRef, ctx: ExecutionContext) => Promise<RemoteStatusView>;
  cancel?: (ref: RemoteExecutionRef, ctx: ExecutionContext) => Promise<RemoteCancelResult>;
  recover?: (ref: RemoteExecutionRef, ctx: ExecutionContext) => Promise<RemoteRecoverResult>;
  collectArtifact?: (ref: RemoteExecutionRef, ctx: ExecutionContext) => Promise<CapabilityOutput>;
  /** 合同版本标记。 */
  adapterContractVersion?: string;
};
