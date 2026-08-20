/**
 * DIGITALME-GROWTH-CLOSED-LOOP-03
 * 纠正 → supersede 闭环：把「修正后持续更新」落到既有 supersedes 关系。
 * 新真实经历（纠正后的新值）必须把旧值变为 inactive，而不是与旧值并存。
 * 不引入第二 Store：关系复用 GrowthEvent.payload.relation.supersedes。
 */
import type { GrowthEvent } from './growth-event';
import { isExpiredByTags } from './growth-signal';

/** 明确的纠正意图信号（保守集合，避免把闲聊/背景误判为纠正）。 */
const CORRECTION_INTENT_RE =
  /上次|之前|原来|其实|更正|纠正|不对|改成|换成|改为|换掉|不要|别再|不再|以后不要|以后别|只要|统一|固定为/;

const ONE_OFF_RE = /仅本次|只这一次|临时|这次先/;

/** 主题词（与 experience-selector 一致的双字/词元切分）。 */
export function topicTokens(text: string): Set<string> {
  const result = new Set<string>();
  const lower = String(text || '').toLowerCase();
  for (const part of lower.split(/[^\p{L}\p{N}]+/u)) {
    if (!part) continue;
    if (/[\u4e00-\u9fff]/.test(part)) {
      if (part.length >= 2) result.add(part);
      for (let i = 0; i < part.length - 1; i += 1) {
        result.add(part.slice(i, i + 2));
      }
    } else if (part.length >= 2) {
      result.add(part);
    }
  }
  return result;
}

function sharedTopicTokens(a: string, b: string): number {
  const ta = topicTokens(a);
  const tb = topicTokens(b);
  let shared = 0;
  for (const t of ta) {
    if (t.length >= 2 && tb.has(t)) shared += 1;
  }
  return shared;
}

function tagValue(tags: readonly string[], prefix: string): string | null {
  const hit = tags.find((t) => t.toLowerCase().startsWith(prefix.toLowerCase()));
  return hit ? hit.slice(prefix.length) : null;
}

/** 是否像纠正性陈述（排除一次性/临时措辞）。 */
export function isCorrectionStatement(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  if (ONE_OFF_RE.test(t)) return false;
  return CORRECTION_INTENT_RE.test(t);
}

/** 有明确新值措辞的纠正：不得是单纯否定/疑问。 */
export function hasReplacementValue(text: string): boolean {
  const t = String(text || '').trim();
  if (!t) return false;
  if (/(改成|换成|改为|换掉|只要|统一|固定为|以后用|以后要)/.test(t)) return true;
  // 「不要 X，要 Y」结构
  if (/不要[^。\n]{0,40}，?要/.test(t)) return true;
  return false;
}

/** 从纠正文本提炼替换值偏好。无替换值返回 null。 */
export function extractReplacementPreference(text: string): {
  title: string;
  detail: string;
} | null {
  const t = String(text || '').trim();
  if (!t || !isCorrectionStatement(t) || !hasReplacementValue(t)) return null;

  const after = (re: RegExp): string | null => {
    const m = re.exec(t);
    if (!m) return null;
    const rest = t.slice((m.index ?? 0) + m[0].length).trim();
    return rest.split(/[。；;，,]|不要|别用|别用|不再|去掉/)[0]?.trim() || null;
  };

  const value =
    after(/(?:改成|换成|改为|换掉|统一为|固定为|以后统一为)/) ||
    after(/(?:以后只要|以后用|以后要|只保留|只留|只要)/) ||
    after(/不要[^。\n]{0,40}，?要/) ||
    after(/(?:改为|换成|改成)/);
  if (!value || value.length < 2) return null;
  if (/仅本次|只这一次|临时/.test(value)) return null;

  const projectMatch = /\b([A-Z][a-zA-Z0-9_-]{1,24})\b/.exec(t);
  const title = projectMatch?.[1]
    ? `偏好：${projectMatch[1]} 的表达与格式`
    : /简历|文件|格式/.test(t)
      ? '偏好：简历与文件格式'
      : /周报|汇报|报告|文档/.test(t)
        ? '偏好：周报与文档写法'
        : '偏好：更正后的表达方式';
  return { title, detail: `${value}。${t.slice(0, 80)}`.slice(0, 200) };
}

/**
 * 在已确认事件中找同主题、同类型、可被纠正的旧值。
 * 优先：同 project / 同 domain tag；其次共享主题词。
 * 仅返回 confirmed 且当前有效的条目。
 */
export function matchCorrectionTarget(input: {
  text: string;
  type: string;
  events: readonly GrowthEvent[];
}): GrowthEvent | null {
  const candidates = [...input.events].filter(
    (e) =>
      e.confidence === 'confirmed' &&
      e.type === input.type &&
      !isExpiredByTags(e.payload.tags ?? []),
  );
  if (candidates.length === 0) return null;

  const newTags = topicTokens(input.text);
  const exactTagHits: GrowthEvent[] = [];
  const topicHits: GrowthEvent[] = [];

  for (const e of candidates) {
    const tags = e.payload.tags ?? [];
    const project = tagValue(tags, 'project:');
    const newProject = tagValue([...newTags], 'project:') ?? null;
    if (project && newProject === project) {
      exactTagHits.push(e);
      continue;
    }
    const domainTags = tags.filter((t) => /category:|style|preference|document|周报|汇报|介绍/.test(t));
    const newDomain = [...newTags];
    if (domainTags.some((t) => newDomain.includes(t.toLowerCase()))) {
      exactTagHits.push(e);
      continue;
    }
    const blob = `${e.payload.title} ${e.payload.detail}`;
    if (sharedTopicTokens(input.text, blob) >= 2) {
      topicHits.push(e);
    }
  }

  const pool = exactTagHits.length > 0 ? exactTagHits : topicHits;
  if (pool.length === 0) return null;
  return [...pool].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0] ?? null;
}

/**
 * 为纠正后的候选事件写入 supersede 关系。
 * 仅处理 preference_observed（低风险、易纠正、可静默）；
 * 身份/目标/原则/边界仍走既有 must_confirm + conflict 检测。
 * existingEvents 提供已被确认的旧值作为 supersede 目标。
 */
export function applyCorrectionSupersede(input: {
  text: string;
  events: GrowthEvent[];
  existingEvents?: readonly GrowthEvent[];
}): { changed: number } {
  let changed = 0;
  const confirmedList =
    input.existingEvents && input.existingEvents.length > 0
      ? input.existingEvents.filter((e) => e.confidence === 'confirmed')
      : input.events.filter((e) => e.confidence === 'confirmed');
  for (const event of input.events) {
    if (event.confidence !== 'candidate') continue;
    if (event.type !== 'preference_observed') continue;
    if (!isCorrectionStatement(input.text) || !hasReplacementValue(input.text)) continue;
    const target = matchCorrectionTarget({
      text: input.text,
      type: 'preference_observed',
      events: confirmedList,
    });
    if (!target) continue;
    if (target.id === event.id) continue;
    event.payload = {
      ...event.payload,
      tags: [
        ...(event.payload.tags ?? []),
        'supersede',
        `supersedes:${target.id}`,
      ],
      relation: {
        ...(event.payload.relation ?? {}),
        supersedes: target.id,
      },
    };
    changed += 1;
  }
  return { changed };
}