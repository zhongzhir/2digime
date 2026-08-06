/**
 * 成长捕获结果语义 — 区分「无可学」「失败」「待确认」「已学会」。
 * 不得把空候选与蒸馏故障统一标为成功。
 */

export type CaptureOutcome =
  | 'learned'
  | 'pending_confirmation'
  | 'nothing_to_learn'
  | 'distill_failed';

/** 用户面中性文案（禁止暴露内部枚举名）。 */
export function captureOutcomeUserHint(outcome: CaptureOutcome): string {
  switch (outcome) {
    case 'learned':
      return '';
    case 'pending_confirmation':
      return '有一条新体会待你确认。';
    case 'nothing_to_learn':
      return '';
    case 'distill_failed':
      return '刚才这条体会还没记上，稍后会再试。';
    default:
      return '';
  }
}

export function deriveCaptureOutcome(input: {
  distillFailed?: boolean;
  candidateCount: number;
  confirmationSuggestedCount: number;
  confirmedCount?: number;
  idempotent?: boolean;
}): CaptureOutcome {
  if (input.distillFailed) return 'distill_failed';
  if (input.idempotent) return 'learned';
  if (input.confirmationSuggestedCount > 0) return 'pending_confirmation';
  if ((input.confirmedCount ?? 0) > 0 || input.candidateCount > 0) return 'learned';
  return 'nothing_to_learn';
}
