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
}

export interface TalkThread {
  schemaVersion: typeof TALK_SCHEMA_VERSION;
  threadId: string;
  updatedAt: string;
  /** 历史字段，读取兼容。Talk 主链不再写入，也不再作为控制信号。 */
  openGoal?: string;
  turns: TalkTurn[];
  executions: TalkExecution[];
}

export interface TalkView {
  headline: string;
  empty: boolean;
  notice?: string;
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
  /** 自然语言合同：不能做什么。不给模型做枚举路由。 */
  cannotDo?: string;
  /** 自然语言合同：是否产生文件 / 改代码 / 访问网络等真实效果。 */
  effects?: string;
  /** 运行态：单次调用上限，检索应远短于整轮 deadline。 */
  maxCallMs?: number;
  /** 运行态：该能力返回证据而非用户交付物。 */
  returnsEvidence?: boolean;
  run(input: {
    instruction: string;
    workDir: string;
    signal: AbortSignal;
  }): Promise<ProfessionalResult>;
}
