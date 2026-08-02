import type {
  CapabilityAdapter,
  CapabilityInput,
  CapabilityOutput,
  ExecutionContext,
} from '../adapter';
import type { CapabilityRegistration } from '../registration';

/**
 * model.openai-compatible Adapter 接口预留(P1.2)。
 * - 以白名单 adapterType 注册;
 * - availability=needs_setup;
 * - 本轮不接真实 SecretStore,不发 HTTP。
 * Work Runtime 与领域对象不出现 provider 专有字段。
 */
export const OPENAI_COMPATIBLE_CAPABILITY_ID = 'cap_model_openai_compatible';

const REGISTRATION: CapabilityRegistration = {
  id: OPENAI_COMPATIBLE_CAPABILITY_ID,
  kind: 'model',
  displayName: '通用对话模型',
  description: 'OpenAI 兼容接口的模型能力(本轮未接通密钥与网络)',
  inputContract: {
    acceptsGoal: true,
    acceptsSnapshot: true,
    acceptsSubjectContext: true,
  },
  outputArtifactTypes: ['document'],
  permissions: ['network', 'secret_access'],
  cost: { estimate: '按用量计费' },
  latencyEstimate: '数秒到数十秒',
  location: 'remote',
  availability: 'needs_setup',
  adapter: {
    type: 'openai-compatible-model',
    adapterId: 'openai-compatible-chat',
  },
};

export function createOpenAiCompatibleAdapterStub(): CapabilityAdapter {
  return {
    registration: { ...REGISTRATION },
    async execute(_input: CapabilityInput, _ctx: ExecutionContext): Promise<CapabilityOutput> {
      throw Object.assign(new Error('model adapter is not wired in this release'), {
        actionable: '请先完成模型接入与凭证配置后再试',
        stage: 'model' as const,
      });
    },
  };
}
