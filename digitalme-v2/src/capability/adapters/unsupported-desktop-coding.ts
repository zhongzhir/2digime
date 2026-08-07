/**
 * 仅探测到、尚无稳定自动调用接口的桌面 Coding Agent。
 * 首轮：标记 unsupported，不实现假自动执行闭环。
 */
import { asLocalCapabilityAdapter } from '../local-adapter-lifecycle';
import type { AvailabilityCheckResult, CapabilityInput, CapabilityOutput, ExecutionContext } from '../adapter';
import type { CapabilityRegistration } from '../registration';
import { CODE_CHANGE_ARTIFACT_TYPE } from '../../execution/external-executor-contract';

export const UNSUPPORTED_DESKTOP_CODING_CAPABILITY_ID = 'cap_desktop_coding_unsupported';

export interface UnsupportedDesktopCodingOptions {
  displayName?: string;
  /** 测试注入：是否“检测到”该产品。 */
  detected?: boolean;
  capabilityId?: string;
}

export function createUnsupportedDesktopCodingAdapter(
  options: UnsupportedDesktopCodingOptions = {},
) {
  const capabilityId = options.capabilityId || UNSUPPORTED_DESKTOP_CODING_CAPABILITY_ID;
  const displayName = options.displayName || '桌面代码工具';
  const detected = options.detected !== false;

  const registration: CapabilityRegistration = {
    id: capabilityId,
    kind: 'agent',
    displayName,
    description: '检测到该工具，但当前还不能由 Digital Me 自动调用。',
    inputContract: {
      acceptsGoal: true,
      acceptsSnapshot: true,
      acceptsSubjectContext: true,
    },
    outputArtifactTypes: [CODE_CHANGE_ARTIFACT_TYPE],
    permissions: ['filesystem_read'],
    cost: { estimate: '不适用' },
    latencyEstimate: '不适用',
    location: 'local',
    availability: 'unavailable',
    adapter: {
      type: 'external-executor-cli',
      adapterId: 'adapter_desktop_coding_unsupported',
    },
    codingExecution: {
      providerKind: 'desktop_product',
      invocationKind: 'desktop_handoff',
      supportsAutomaticExecution: false,
      supportsProgress: false,
      supportsRevision: false,
      supportsResultCollection: false,
    },
  };

  return asLocalCapabilityAdapter({
    registration,
    adapterContractVersion: 'desktop-coding-unsupported/1',
    describe: () => ({
      adapterId: registration.adapter.adapterId,
      adapterType: 'external-executor-cli',
      capabilityId,
      displayName,
      location: 'local',
      outputArtifactTypes: [CODE_CHANGE_ARTIFACT_TYPE],
      supportsAsyncRemote: false,
      version: 'desktop-coding-unsupported/1',
    }),
    checkAvailability: async (): Promise<AvailabilityCheckResult> => {
      if (!detected) {
        return {
          available: false,
          reason: 'needs_setup',
          detail: '尚未检测到可用的代码执行能力。',
        };
      }
      return {
        available: false,
        reason: 'unsupported',
        detail: '检测到该工具，但当前版本还不能自动调用它。',
      };
    },
    execute: async (_input: CapabilityInput, _ctx: ExecutionContext): Promise<CapabilityOutput> => {
      throw new Error('该工具当前不能由 Digital Me 自动调用。');
    },
  });
}
