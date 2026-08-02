/**
 * CapabilityRegistration — 一项已接入能力的声明(domain model §2.7)。
 * Model / Agent / Skill / Tool / Service 统一表达。
 * P0.1:废除任意模块路径(adapterModule),改为代码内白名单 adapterType + adapterId;
 * 注册数据永不指定可加载代码位置,Adapter 实现由代码静态绑定。
 */
export type CapabilityKind = 'model' | 'agent' | 'skill' | 'tool' | 'service';

/** Adapter 类型白名单 — 封闭枚举,新增类型必须改代码并过评审。 */
export const ADAPTER_TYPES = ['openai-compatible-model', 'local-tool', 'remote-subject'] as const;
export type AdapterType = (typeof ADAPTER_TYPES)[number];

export function isAdapterType(value: string): value is AdapterType {
  return (ADAPTER_TYPES as readonly string[]).includes(value);
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
}
