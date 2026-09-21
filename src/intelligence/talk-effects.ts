/**
 * Goal → Effect → Evidence：机械对照 expected vs observed。
 * 不根据用户原句做关键词路由；expected 由模型经工具声明。
 */
import type { TalkExecution, TalkExpectedEffect, TalkTurnOutcome } from './types';

const MUTATION_EFFECTS = new Set(['file_created', 'content_modified', 'file_written']);

export function isMutationEffectName(effect: string): boolean {
  return MUTATION_EFFECTS.has(String(effect || '').trim().toLowerCase());
}

export function targetMatches(actual?: string, expected?: string): boolean {
  const a = String(actual || '').trim().toLowerCase().replace(/\\/g, '/');
  const e = String(expected || '').trim().toLowerCase().replace(/\\/g, '/');
  if (!e) return true;
  if (!a) return false;
  if (a === e) return true;
  if (a.endsWith(`/${e}`) || a.endsWith(e)) return true;
  const aBase = a.split('/').pop() || a;
  const eBase = e.split('/').pop() || e;
  return Boolean(aBase && eBase && aBase === eBase);
}

export function expectedFromExecutions(execs: TalkExecution[]): TalkExpectedEffect[] {
  const rec = [...execs].reverse().find((item) => item.capabilityId === 'set_expected_effects' && item.ok);
  if (!rec?.safeDetail) return [];
  try {
    const parsed = JSON.parse(rec.safeDetail) as { effects?: TalkExpectedEffect[] };
    return Array.isArray(parsed.effects) ? parsed.effects.filter((row) => row && row.effect) : [];
  } catch {
    return [];
  }
}

export function hasObservedMutation(execs: TalkExecution[], target?: string): boolean {
  return execs.some(
    (item) =>
      item.ok &&
      item.observedEffect?.mutated === true &&
      (!target || targetMatches(item.observedEffect.target || item.outputPath, target)),
  );
}

export function unsatisfiedRequiredEffects(
  expected: TalkExpectedEffect[],
  execs: TalkExecution[],
  reads: Array<{ target: string; content: string; seq: number }>,
  mutations: Array<{ target: string; seq: number }>,
): string | null {
  const required = expected.filter((row) => isMutationEffectName(row.effect));
  if (!required.length) return null;
  for (const req of required) {
    if (!hasObservedMutation(execs, req.target)) {
      return `目标还没有完成：尚未观察到 ${req.effect}${req.target ? `（${req.target}）` : ''}。不能收工。`;
    }
    const state = String(req.expectedState || '').trim();
    if (!state) continue;
    const writeSeq = Math.max(
      0,
      ...mutations.filter((row) => targetMatches(row.target, req.target)).map((row) => row.seq),
    );
    const later = [...reads]
      .reverse()
      .find((row) => targetMatches(row.target, req.target) && row.seq > writeSeq);
    if (!later) {
      return `目标还没有完成：尚未验证${req.target ? ` ${req.target}` : '目标文件'} 的当前状态。`;
    }
    if (!later.content.includes(state)) {
      return `验证未匹配：${req.target || '目标文件'} 还没有达到 expected state。允许修正一次。`;
    }
  }
  return null;
}

export function deriveTalkOutcome(input: {
  execs: TalkExecution[];
  expected: TalkExpectedEffect[];
  timedOut?: boolean;
  stillOpen?: boolean;
}): TalkTurnOutcome {
  const mutated = hasObservedMutation(input.execs);
  const required = input.expected.some((row) => isMutationEffectName(row.effect));
  if (input.timedOut) {
    if (mutated) return 'PARTIAL_SUCCESS';
    if (input.execs.some((item) => item.ok)) return 'PARTIAL_SUCCESS';
    return 'FAILED';
  }
  if (required && !mutated) return 'FAILED';
  if (input.stillOpen) return mutated ? 'PARTIAL_SUCCESS' : 'FAILED';
  return 'SUCCESS';
}
