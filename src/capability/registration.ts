/**
 * CapabilityRegistration — 一项已接入能力的声明(domain model §2.7)。
 * Model / Agent / Skill / Tool / Service 统一表达。
 * P0.1:废除任意模块路径(adapterModule),改为代码内白名单 adapterType + adapterId;
 * 注册数据永不指定可加载代码位置,Adapter 实现由代码静态绑定。
 */
import type { ContextIngestionPolicy } from '../work-runtime/context-policy';
import type { CodingExecutionProfile } from './coding-capability';

export type CapabilityKind = 'model' | 'agent' | 'skill' | 'tool' | 'service';

/**
 * Adapter 类型白名单 — 封闭枚举,新增类型必须改代码并过评审。
 * MCP-READONLY-ADAPTER-01：将 mcp-stdio 加入白名单（本块接线）。
 * mcp-stdio 仅供 kind='tool' 的只读工具能力；不得作为 Coding Job / 自主 Agent。
 */
export const ADAPTER_TYPES = [
  'openai-compatible-model',
  'local-tool',
  'remote-subject',
  'external-executor-cli',
  'external-executor-http',
  'external-executor-model-api',
  'mcp-stdio',
] as const;
export type AdapterType = (typeof ADAPTER_TYPES)[number];

export function isAdapterType(value: string): value is AdapterType {
  return (ADAPTER_TYPES as readonly string[]).includes(value);
}

/**
 * 同一产品类「agent」的运输方式。不是第二套 Job 真相源，也不是新的连接器类。
 * CLI / HTTP / model-api 共用 ExecutorTaskPackage / ExecutorRunResult。
 */
export const AGENT_TRANSPORT_ADAPTER_TYPES = [
  'external-executor-cli',
  'external-executor-http',
  'external-executor-model-api',
] as const;
export type AgentTransportAdapterType = (typeof AGENT_TRANSPORT_ADAPTER_TYPES)[number];

export function isAgentExecutorAdapterType(value: string): value is AgentTransportAdapterType {
  return (AGENT_TRANSPORT_ADAPTER_TYPES as readonly string[]).includes(value);
}

export type CapabilityPermission =
  | 'network'
  | 'filesystem_read'
  | 'filesystem_write'
  | 'secret_access';

export interface CapabilityRegistration {
  id: string;
  kind: CapabilityKind;
  displayName: string;
  /** 能做什么。 */
  description: string;
  /** 接受什么输入。 */
  inputContract: {
    acceptsGoal: true;
    acceptsSnapshot: boolean;
    acceptsSubjectContext: boolean;
  };
  /** 产出什么 Artifact 类型。 */
  outputArtifactTypes: string[];
  /** 需要什么权限(经 AuthorizationGrant 授予,grantee.kind = 'capability')。 */
  permissions: CapabilityPermission[];
  /** 成本与预计耗时。 */
  cost: { estimate: string };
  latencyEstimate: string;
  /** 运行位置。 */
  location: 'local' | 'remote';
  /** 可用性状态。 */
  availability: 'available' | 'unavailable' | 'needs_setup';
  /** 白名单内的 Adapter 类型 + 该类型下的实现实例标识。 */
  adapter: {
    type: AdapterType;
    adapterId: string;
  };
  /**
   * 通用上下文摄取策略(P2.0):由 ContextSnapshotBuilder 在构建期执行,
   * Adapter 执行期只消费冻结 Snapshot。缺省即现行文档能力行为。
   * 策略为通用值对象,不得携带场景专用状态。
   */
  contextPolicy?: ContextIngestionPolicy;
  /**
   * 代码执行能力画像（可选）。仅声明通用执行属性，不得放入供应商专有字段。
   */
  codingExecution?: CodingExecutionProfile;
}
