/**
 * TRIAL-SURFACE-01B — 专用代码执行器评分（按能力完整度，不按厂商名排序）。
 */
import type { CapabilityAdapter } from './adapter';

/**
 * 对专用执行器（cli/http）按能力完整度评分。只用于同属「专用」候选间的排序，
 * 不用于与模型兜底（model-api）比较（§2.4：专用优先由路由逻辑保证）。
 */
export function scoreCodingAdapter(adapter: CapabilityAdapter): number {
  const profile = adapter.registration.codingExecution;
  let score = 0;
  if (profile?.supportsAutomaticExecution) score += 40;
  if (profile?.supportsRevision) score += 20;
  if (profile?.supportsResultCollection) score += 20;
  if (profile?.supportsProgress) score += 10;
  if (adapter.registration.availability === 'available') score += 30;
  return score;
}
