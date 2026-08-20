/**
 * 从 Capability Registry 派生代码执行能力状态（不建第二 Store）。
 */
import type { CapabilityRegistry } from './registry';
import type { CapabilityAdapter } from './adapter';
import {
  buildCodingCapabilityStatus,
  mapProbeToCodingAvailability,
  selectPreferredCodingCapability,
  type CodingCapabilityPrefs,
  type CodingCapabilityStatus,
  type CodingExecutionProfile,
  isAutomaticReady,
} from './coding-capability';
import { CODE_CHANGE_ARTIFACT_TYPE } from '../execution/external-executor-contract';

const DEFAULT_PROFILE: CodingExecutionProfile = {
  providerKind: 'local_coding_agent',
  invocationKind: 'cli',
  supportsAutomaticExecution: true,
  supportsProgress: true,
  supportsRevision: true,
  supportsResultCollection: true,
};

export function isCodingCapabilityAdapter(adapter: CapabilityAdapter): boolean {
  const reg = adapter.registration;
  if (reg.codingExecution) return true;
  return reg.outputArtifactTypes.includes(CODE_CHANGE_ARTIFACT_TYPE);
}

export async function listCodingCapabilityStatuses(
  registry: CapabilityRegistry,
  opts?: { probe?: boolean; prefs?: CodingCapabilityPrefs },
): Promise<{
  statuses: CodingCapabilityStatus[];
  preferred: CodingCapabilityStatus | null;
}> {
  const adapters = registry
    .list()
    .map((reg) => registry.get(reg.id))
    .filter((a): a is CapabilityAdapter => !!a && isCodingCapabilityAdapter(a));

  const statuses: CodingCapabilityStatus[] = [];
  for (const adapter of adapters) {
    const reg = adapter.registration;
    const profile = reg.codingExecution || DEFAULT_PROFILE;
    let availability = mapProbeToCodingAvailability({
      available: reg.availability === 'available',
      reason: reg.availability === 'needs_setup' ? 'needs_setup' : 'unavailable',
    });
    let actionable: string | undefined;
    if (opts?.probe) {
      try {
        const check = await adapter.checkAvailability({});
        availability = mapProbeToCodingAvailability(check);
        actionable = check.detail;
        (reg as { availability: string }).availability =
          check.available ? 'available' : availability === 'unavailable' ? 'unavailable' : 'needs_setup';
      } catch (err) {
        availability = 'needs_setup';
        actionable = err instanceof Error ? err.message : String(err);
        (reg as { availability: string }).availability = 'needs_setup';
      }
    } else if (reg.availability === 'available' && profile.supportsAutomaticExecution) {
      availability = 'ready';
    } else if (!profile.supportsAutomaticExecution) {
      // 静态：桌面 handoff / unsupported 需探测才准确；未探测时按画像降级
      if (profile.invocationKind === 'desktop_handoff') {
        availability = 'unsupported';
      }
    }
    statuses.push(
      buildCodingCapabilityStatus({
        capabilityId: reg.id,
        displayName: reg.displayName,
        profile,
        availability,
        canDo: reg.description,
        ...(actionable ? { actionableMessage: actionable } : {}),
      }),
    );
  }

  const preferred = selectPreferredCodingCapability(statuses, opts?.prefs);
  return { statuses, preferred };
}

export function assertAutomaticCodingReady(
  preferred: CodingCapabilityStatus | null,
): preferred is CodingCapabilityStatus {
  return isAutomaticReady(preferred);
}
