/**
 * Phase 2 Intelligence — 用户与 2digime 的最小交流权威。
 *
 * 永久对象只有 Thread 与 ExecutionRecord。
 * 外部执行资源是 External Capabilities / Resources（Agent / Tool / Skill / Search / Model / Other Subject）。
 * 接口可统一；产品上 Codex 是 Agent，Search 是 Tool，不要把所有东西都叫成 Agent。
 */
export const TALK_SCHEMA_VERSION = 1 as const;
export const DEFAULT_THREAD_ID = 'default';

export interface TalkTurn {
  id: string;
  at: string;
  role: 'user' | 'assistant';
  text: string;
  executionIds?: string[];
  /** 本回合实际发生的 Subject ↔ Subject 交换，不是协作阶段。 */
  exchangeIds?: string[];
  result?: { title: string; path?: string };
}

/** 模型声明的目标可观察结果；不是对用户原句的关键词分类。 */
export interface TalkExpectedEffect {
  target?: string;
  effect: string;
  expectedState?: string;
}

/** 工具实际产生的机械 effect。 */
export interface TalkObservedEffect {
  kind: string;
  target?: string;
  mutated?: boolean;
}

export interface TalkExecution {
  id: string;
  at: string;
  turnId: string;
  capabilityId: string;
  instruction: string;
  /** runtime 权威：外部执行是否实际成功。 */
  ok: boolean;
  summary: string;
  failureReason?: string;
  producedOutputs?: string[];
  outputPath?: string;
  reviewNotes?: string;
  /** 内部审计，不含密钥，不作为对用户的诊断文案。 */
  safeDetail?: string;
  observedEffect?: TalkObservedEffect;
}

export interface TalkThread {
  schemaVersion: typeof TALK_SCHEMA_VERSION;
  threadId: string;
  updatedAt: string;
  /** 历史字段，读取兼容。Talk 主链不再写入，也不再作为控制信号。 */
  openGoal?: string;
  turns: TalkTurn[];
  executions: TalkExecution[];
  /** 本对话用户附上的文件路径。后续回合仍可读取，不是另一套记忆。 */
  materialPaths?: string[];
  /** 从发现进入的同一任务；当前条件唯一保存在本 thread，不是本人长期事实。 */
  discoveryGoal?: {
    originalRequest: string;
    request: string;
    scope: 'session' | 'keep';
    objects: Array<{ contentId: string; title: string; url: string; source: string; publisherSubjectId?: string; summary: string }>;
  };
}

export type TalkTurnOutcome = 'SUCCESS' | 'PARTIAL_SUCCESS' | 'FAILED' | 'CANCELLED';

export interface TalkView {
  headline: string;
  empty: boolean;
  notice?: string;
  /** 本回合最终收敛状态。timeout 后不得继续停留在 checking/executing/generating。 */
  outcome?: TalkTurnOutcome;
  turns: Array<{
    role: 'user' | 'assistant';
    text: string;
    result?: { title: string; path?: string };
  }>;
}

export interface TalkChatResult {
  text: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
}

export type TalkChatFn = (input: {
  messages: import('../infrastructure/model-http').ChatMessage[];
  tools?: import('../infrastructure/model-http').ChatToolDefinition[];
  signal?: AbortSignal;
  /** 本轮 Talk 剩余 deadline，传给运输层，不得另套更短 HTTP timeout。 */
  timeoutMs?: number;
}) => Promise<TalkChatResult>;

export interface ProfessionalResult {
  /** 与 actualSuccess 同一事实：确定性执行是否成功。 */
  ok: boolean;
  summary: string;
  failureReason?: string;
  producedOutputs?: string[];
  outputPath?: string;
  rawText?: string;
  safeDetail?: string;
  /**
   * 运行态：这次返回只是给 2digime 综合用的证据，不是用户交付物。
   * 不落盘、不作为 Thread 完成条件。
   */
  evidenceOnly?: boolean;
}

/** 统一调用接口；产品上这是外部能力/资源，不必都是 Agent。 */
export interface ProfessionalAgent {
  id: string;
  label: string;
  description: string;
  /** 机械授权需求，不是策略建议。 */
  authNeeded?: string;
  /** 专业 runtime 是否已经在本机准备好；acquirable 表示调用时才会获取。 */
  runtimeStatus?: 'ready' | 'acquirable';
  /** 运行态：该能力返回证据而非用户交付物。 */
  returnsEvidence?: boolean;
  run(input: {
    instruction: string;
    workDir: string;
    signal: AbortSignal;
  }): Promise<ProfessionalResult>;
}
