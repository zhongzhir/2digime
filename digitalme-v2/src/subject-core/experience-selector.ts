import type { ConfirmedExperienceView } from './derived-views';
import type { BoundariesView } from './derive-all';

export interface ExperienceSelectInput {
  goal: string;
  requestedArtifactType: string;
  confirmed: ConfirmedExperienceView;
  boundaries: BoundariesView;
}

export interface ExperienceSelectOptions {
  maxEntries?: number;
  maxDetailChars?: number;
}

const DEFAULT_MAX_ENTRIES = 5;
const DEFAULT_MAX_DETAIL_CHARS = 200;

/**
 * ConfirmedExperienceSelector — 确定性关键词/标签匹配。
 * - candidate 永不进入;
 * - 边界 excludedTags 过滤;
 * - 数量与长度上限;
 * - 每条保留 eventId 可追溯。
 */
export function selectConfirmedExperiences(
  input: ExperienceSelectInput,
  options: ExperienceSelectOptions = {},
): ConfirmedExperienceView {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxDetailChars = options.maxDetailChars ?? DEFAULT_MAX_DETAIL_CHARS;
  const excluded = new Set(input.boundaries.excludedTags.map((t) => t.toLowerCase()));
  const tokens = tokenize(input.goal);

  const scored = input.confirmed.entries
    .filter((entry) => {
      const tags = entry.tags.map((t) => t.toLowerCase());
      if (tags.some((t) => excluded.has(t))) return false;
      return true;
    })
    .map((entry) => {
      const hay = tokenize(`${entry.title} ${entry.detail} ${entry.tags.join(' ')}`);
      let score = 0;
      for (const token of tokens) {
        if (token.length >= 2 && hay.has(token)) score += 1;
      }
      // 仅在目标已有命中时,成果类型标签才加权(避免所有 document 任务误注入)
      if (
        score > 0 &&
        entry.tags.map((t) => t.toLowerCase()).includes(input.requestedArtifactType.toLowerCase())
      ) {
        score += 2;
      }
      return { entry, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || b.entry.occurredAt.localeCompare(a.entry.occurredAt));

  const entries = scored.slice(0, maxEntries).map(({ entry }) => ({
    eventId: entry.eventId,
    title: entry.title,
    detail:
      entry.detail.length <= maxDetailChars
        ? entry.detail
        : `${entry.detail.slice(0, maxDetailChars - 1)}…`,
    tags: [...entry.tags],
    occurredAt: entry.occurredAt,
  }));

  return {
    subjectId: input.confirmed.subjectId,
    derivedAt: input.confirmed.derivedAt,
    entries,
  };
}

function tokenize(text: string): Set<string> {
  const result = new Set<string>();
  const lower = text.toLowerCase();
  for (const part of lower.split(/[^\p{L}\p{N}]+/u)) {
    if (part.length === 0) continue;
    if (part.length >= 2 && !/[\u4e00-\u9fff]/.test(part)) result.add(part);
    // 中文无空格:仅用双字词元,避免单字误匹配
    if (/[\u4e00-\u9fff]/.test(part)) {
      for (let i = 0; i < part.length - 1; i += 1) {
        result.add(part.slice(i, i + 2));
      }
      if (part.length >= 2) result.add(part);
    } else if (part.length >= 2) {
      result.add(part);
    }
  }
  return result;
}
