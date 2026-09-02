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
  /** runtime 权威：外部执行是否实际成功。模型 review 不得改写。 */
  ok: boolean;
  summary: string;
  failureReason?: string;
  producedOutputs?: string[];
  outputPath?: string;
  reviewNotes?: string;
}

export interface TalkThread {
  schemaVersion: typeof TALK_SCHEMA_VERSION;
  threadId: string;
  updatedAt: string;
  /** 用户尚未答完的同一件事。重启后必须还能继续，不能另起任务。 */
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
}) => Promise<TalkChatResult>;

export interface ProfessionalResult {
  /** 与 actualSuccess 同一事实：确定性执行是否成功。 */
  ok: boolean;
  summary: string;
  failureReason?: string;
  producedOutputs?: string[];
  outputPath?: string;
  rawText?: string;
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
  run(input: {
    instruction: string;
    workDir: string;
    signal: AbortSignal;
  }): Promise<ProfessionalResult>;
}
