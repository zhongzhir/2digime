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
    publisherSubjectId: item.publisherSubjectId,
    createdAt: item.createdAt,
  }));
  const expected = new Set(input.items.map((item) => item.itemId));
  const system = [
    '你是这个人的 2digime。根据数字之我判断每条公开候选是否值得此人现在看到。',
    '只输出 JSON：{"decisions":[{"itemId":"...","decision":"show"|"ignore","reason":"..."}]}。',
    '必须覆盖输入的每一条 itemId，不得增删。reason 用一句中文，不超过 40 字。',
    'show：与此人已确认的关注、目标、边界相符，或对其长期意图有具体价值。',
    'ignore：与此人关系弱、越界、或只是泛泛热门。',
    '不要用关键词表或打分规则；不要输出 score/rank。理由用普通人语言，引用数字之我中的事实。',
  ].join('\n');
  const user = `当前数字之我：\n${selfContext}\n\n候选：\n${JSON.stringify(catalog)}`;

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
