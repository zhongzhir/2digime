/**
 * JIT 冲突确认 — 平时静默；即将使用时才给出自然语言选择。
 * 不引入第二状态机：决议写入既有 GrowthEvent / 任务作用域 tags。
 */
import type { GrowthEvent } from './growth-event';
import type { SubjectDerivedBundle } from './derive-all';
import { detectAuthorityConflict } from './growth-signal';
import { chooseExecutionProfile } from '../work-runtime/ai-first-policy';

export type JitChoiceAction =
  | 'use_a_once'
  | 'use_b_once'
  | 'prefer_a'
  | 'prefer_b'
  | 'defer';

export interface JitConflictPrompt {
  question: string;
  labelA: string;
  labelB: string;
  eventIdA: string;
  eventIdB: string;
  highRisk: boolean;
  /** 已对同一冲突展示过则不再重复 */
  fingerprint: string;
}

export interface JitResolution {
  action: JitChoiceAction;
  eventIdA: string;
  eventIdB: string;
  taskId?: string;
}

/** 在即将注入前查找需确认的冲突对。 */
export function findJitConflict(input: {
  goal: string;
  derived: SubjectDerivedBundle;
  /** 本任务已处理过的冲突指纹 */
  seenFingerprints?: Set<string>;
}): JitConflictPrompt | null {
  const profile = chooseExecutionProfile({ goal: input.goal });
  const highRisk = profile === 'high_risk';
  const confirmed = input.derived.activeItems.filter(
    (i) => i.kind === 'preference' || i.kind === 'principle' || i.kind === 'goal',
  );
  const candidates = input.derived.candidates.entries.filter(
    (c) =>
      (c.tags || []).includes('conflict') ||
      (c.tags || []).includes('needs_confirmation') ||
      preferenceStyleConflict(
        confirmed.map((x) => x.title + x.detail).join('||'),
        c.title + c.detail,
      ),
  );

  for (const cand of candidates) {
    for (const conf of confirmed) {
      const conflict = detectAuthorityConflict({
        title: cand.title,
        detail: cand.detail,
        type: cand.type,
        authority: [
          {
            title: conf.title,
            detail: conf.detail,
            type:
              conf.kind === 'goal'
                ? 'goal_updated'
                : conf.kind === 'principle'
                  ? 'principle_stated'
                  : 'preference_observed',
          },
        ],
      });
      const soft = preferenceStyleConflict(conf.title + conf.detail, cand.title + cand.detail);
      if (!conflict && !soft) continue;

      if (
        !relevantToGoal(input.goal, conf.title + conf.detail) &&
        !relevantToGoal(input.goal, cand.title + cand.detail)
      ) {
        continue;
      }

      const fingerprint = `${conf.eventId}|${cand.eventId}`;
      if (input.seenFingerprints?.has(fingerprint)) continue;

      return {
        question: `你之前更偏向「${short(conf.title || conf.detail)}」，最近一次又提到「${short(cand.title || cand.detail)}」。这次按哪一种处理？`,
        labelA: short(conf.title || conf.detail),
        labelB: short(cand.title || cand.detail),
        eventIdA: conf.eventId,
        eventIdB: cand.eventId,
        highRisk,
        fingerprint,
      };
    }
  }

  for (let i = 0; i < confirmed.length; i += 1) {
    for (let j = i + 1; j < confirmed.length; j += 1) {
      const a = confirmed[i]!;
      const b = confirmed[j]!;
      const soft = preferenceStyleConflict(a.title + a.detail, b.title + b.detail);
      if (!soft) continue;
      if (
        !relevantToGoal(input.goal, a.title + a.detail) &&
        !relevantToGoal(input.goal, b.title + b.detail)
      ) {
        continue;
      }
      const fingerprint = `${a.eventId}|${b.eventId}`;
      if (input.seenFingerprints?.has(fingerprint)) continue;
      return {
        question: `你有两种不同偏好：「${short(a.title)}」和「${short(b.title)}」。这次按哪一种处理？`,
        labelA: short(a.title),
        labelB: short(b.title),
        eventIdA: a.eventId,
        eventIdB: b.eventId,
        highRisk,
        fingerprint,
      };
    }
  }

  return null;
}

function preferenceStyleConflict(a: string, b: string): boolean {
  const shortSide = /简洁|短句|少套话|尽量简短|控制篇幅|先给结论|结论先行|简短/;
  const longSide = /完整分析|保留完整|详细展开|详细论证|细节写全|写长一点/;
  return (shortSide.test(a) && longSide.test(b)) || (longSide.test(a) && shortSide.test(b));
}

function relevantToGoal(goal: string, text: string): boolean {
  const g = goal.toLowerCase();
  const t = text.toLowerCase();
  if (
    /周报|汇报|报告|文档|写作|表达|分析|简洁|完整|结论/.test(g) &&
    /周报|汇报|报告|文档|写作|表达|分析|简洁|完整|结论|决策|篇幅|论证/.test(t)
  ) {
    return true;
  }
  for (let i = 0; i < g.length - 1; i += 1) {
    const bi = g.slice(i, i + 2);
    if (/[\u4e00-\u9fff]/.test(bi) && t.includes(bi)) return true;
  }
  return false;
}

function short(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 24);
}

/**
 * 应用 JIT 决议到注入排除/强制纳入集。
 * use_b_once：排除 A，并强制纳入候选 B（本 Snapshot）。
 */
export function injectionExclusionsForJit(input: {
  prompt: JitConflictPrompt;
  resolution?: JitResolution | null;
}): {
  excludeEventIds: string[];
  includeEventIds: string[];
  pauseExternalAction: boolean;
} {
  const { prompt, resolution } = input;
  if (!resolution) {
    return {
      excludeEventIds: [prompt.eventIdB],
      includeEventIds: [],
      pauseExternalAction: prompt.highRisk,
    };
  }
  switch (resolution.action) {
    case 'use_a_once':
    case 'prefer_a':
      return {
        excludeEventIds: [prompt.eventIdB],
        includeEventIds: [prompt.eventIdA],
        pauseExternalAction: false,
      };
    case 'use_b_once':
    case 'prefer_b':
      return {
        excludeEventIds: [prompt.eventIdA],
        includeEventIds: [prompt.eventIdB],
        pauseExternalAction: false,
      };
    case 'defer':
    default:
      return {
        excludeEventIds: [prompt.eventIdA, prompt.eventIdB],
        includeEventIds: [],
        pauseExternalAction: prompt.highRisk,
      };
  }
}

/** 从事件流找 id */
export function findEvent(events: readonly GrowthEvent[], id: string): GrowthEvent | undefined {
  return events.find((e) => e.id === id);
}
