/**
 * 本地 Personal Selection — 把 Digital Self 与候选交给已有模型。
 * 模型失败不得退回关键词/重合/score。排序只发生在本机解析之后。
 */
import type { ChatCompleteFn } from '../subject-core/structured-distill';
import type { DigitalSelf } from '../subject-core/digital-self/types';
import { formatSelfContext, selectSelfContext } from '../intelligence/self-context';
import {
  PERSONAL_SELECTION_UNAVAILABLE,
  type NetworkItem,
} from './network-item';

export type PersonalSelectionDecisionKind = 'show' | 'ignore';

export interface PersonalSelectionDecision {
  itemId: string;
  decision: PersonalSelectionDecisionKind;
  reason: string;
}

export type PersonalSelectionResult =
  | {
      ok: true;
      decisions: PersonalSelectionDecision[];
      shownItemIds: string[];
      ignoredItemIds: string[];
    }
  | {
      ok: false;
      error: typeof PERSONAL_SELECTION_UNAVAILABLE;
      detail: string;
    };

function parseDecisions(raw: string, expectedIds: Set<string>): PersonalSelectionDecision[] | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { decisions?: unknown };
    if (!Array.isArray(parsed.decisions)) return null;
    const out: PersonalSelectionDecision[] = [];
    const seen = new Set<string>();
    for (const row of parsed.decisions) {
      if (!row || typeof row !== 'object') return null;
      const rec = row as Record<string, unknown>;
      const itemId = String(rec.itemId || '').trim();
      const decision = String(rec.decision || '')
        .trim()
        .toLowerCase();
      const reason = String(rec.reason || '').trim();
      if (!expectedIds.has(itemId) || seen.has(itemId)) return null;
      if (decision !== 'show' && decision !== 'ignore') return null;
      if (!reason) return null;
      seen.add(itemId);
      out.push({ itemId, decision, reason: reason.slice(0, 400) });
    }
    if (seen.size !== expectedIds.size) return null;
    return out;
  } catch {
    return null;
  }
}

export async function selectNetworkItems(input: {
  digitalSelf: DigitalSelf;
  items: NetworkItem[];
  chatComplete: ChatCompleteFn;
  model: { baseUrl: string; model: string; apiKey?: string };
  /** 用户明确的内容偏好指令原文。不得由 AI 决策写入。 */
  preferenceDirectives?: string;
  /** 本机短期上下文。不是长期偏好，不得写回 Digital Self。 */
  selectionNotes?: string;
}): Promise<PersonalSelectionResult> {
  if (!input.items.length) {
    return { ok: true, decisions: [], shownItemIds: [], ignoredItemIds: [] };
  }
  const BATCH = 8;
  if (input.items.length > BATCH) {
    const decisions: PersonalSelectionDecision[] = [];
    for (let i = 0; i < input.items.length; i += BATCH) {
      const part = await selectNetworkItems({
        ...input,
        items: input.items.slice(i, i + BATCH),
      });
      if (!part.ok) return part;
      decisions.push(...part.decisions);
    }
    return {
      ok: true,
      decisions,
      shownItemIds: decisions.filter((row) => row.decision === 'show').map((row) => row.itemId),
      ignoredItemIds: decisions.filter((row) => row.decision === 'ignore').map((row) => row.itemId),
    };
  }
  const selfContext = formatSelfContext(selectSelfContext(input.digitalSelf, ''));
  const catalog = input.items.map((item) => ({
    itemId: item.itemId,
    title: item.content.title,
    text: item.content.text,
    ...(item.content.url ? { url: item.content.url } : {}),
    ...(item.content.contentType ? { contentType: item.content.contentType } : {}),
    publisherSubjectId: item.publisherSubjectId,
    createdAt: item.createdAt,
  }));
  const expected = new Set(input.items.map((item) => item.itemId));
  const system = [
    '你是这个人的 2digime。根据数字之我、当前需要和明确反馈，为这些公开候选排序。',
    '数字之我不是准入过滤器。不确定时可以 show，并保留新主题、新来源和意外发现。',
    '只输出 JSON：{"decisions":[{"itemId":"...","decision":"show"|"ignore","reason":"..."}]}。',
    '必须覆盖输入的每一条 itemId，不得增删。reason 用一句中文，不超过 40 字，普通人能懂，不要 score。',
    '优化 USER VALUE：相关、有用、质量、新鲜、符合明确偏好与当前目标、保持多样与必要新奇。',
    '候选可能带 contentType（article/video/image/audio）。在相关和质量足够时，不要把视频、图片、音频全部 ignore 只留文章。不要为凑媒介类型而选低质或不相关项，也不要使用固定比例。',
    '禁止优化停留时长、点击率、打开次数或让人一直刷。不要只重复一个主题，也不要为多样性塞低质内容。',
    'show：现在值得看到，包括相邻或意外但仍然可用的内容。ignore：明显低质、越界、失效，或用户明确不再看的那一条。',
    '加推和关注提高相近内容的优先级。不喜欢只针对用户指出的那一条，不要因此封禁整个主题或来源。只有 block 才排除对应来源。',
    '这些指令不是数字之我身份，不要把它们写回用户是谁。',
    '近期打开/搜索只是会过期的短期上下文，不是长期「喜欢」，不要写回数字之我。',
    '不要用关键词表或打分规则。',
  ].join('\n');
  const preferenceBlock = input.preferenceDirectives?.trim()
    ? `\n\n用户明确的内容偏好指令：\n${input.preferenceDirectives.trim()}`
    : '';
  const notesBlock = input.selectionNotes?.trim() ? `\n\n${input.selectionNotes.trim()}` : '';
  const user = `当前数字之我：\n${selfContext}${preferenceBlock}${notesBlock}\n\n候选：\n${JSON.stringify(catalog)}`;

  const attempts: Array<{ maxTokens: number; jsonObject: boolean }> = [
    { maxTokens: 2048, jsonObject: true },
    { maxTokens: 4096, jsonObject: false },
  ];
  let lastDetail = 'unparseable_or_incomplete';
  for (const attempt of attempts) {
    try {
      const result = await input.chatComplete({
        baseUrl: input.model.baseUrl,
        ...(input.model.apiKey ? { apiKey: input.model.apiKey } : {}),
        model: input.model.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0,
        maxTokens: attempt.maxTokens,
        timeoutMs: 120_000,
        ...(attempt.jsonObject ? { responseFormat: { type: 'json_object' as const } } : {}),
      });
      const parsed = parseDecisions(result.text || '', expected);
      if (parsed) {
        const shownItemIds = parsed.filter((row) => row.decision === 'show').map((row) => row.itemId);
        const ignoredItemIds = parsed.filter((row) => row.decision === 'ignore').map((row) => row.itemId);
        return { ok: true, decisions: parsed, shownItemIds, ignoredItemIds };
      }
      lastDetail = result.truncated ? 'truncated' : 'unparseable_or_incomplete';
    } catch (error) {
      lastDetail = error instanceof Error ? error.message.slice(0, 240) : 'model_error';
    }
  }
  return { ok: false, error: PERSONAL_SELECTION_UNAVAILABLE, detail: lastDetail };
}
