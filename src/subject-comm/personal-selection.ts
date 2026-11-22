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
      if (!row || typeof row !== 'object') continue;
      const rec = row as Record<string, unknown>;
      const itemId = String(rec.itemId || '').trim();
      const decision = String(rec.decision || '')
        .trim()
        .toLowerCase();
      const reason = String(rec.reason || '').trim();
      if (!expectedIds.has(itemId) || seen.has(itemId)) continue;
      if (decision !== 'show' && decision !== 'ignore') continue;
      seen.add(itemId);
      out.push({
        itemId,
        decision,
        reason: (reason || (decision === 'show' ? '适合现在看。' : '稍后再看。')).slice(0, 400),
      });
    }
    if (!out.length) return null;
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
  /** 当前投影需要的条数。只是页面机械事实，不参与语义判断。 */
  targetCount?: number;
}): Promise<PersonalSelectionResult> {
  if (!input.items.length) {
    return { ok: true, decisions: [], shownItemIds: [], ignoredItemIds: [] };
  }
  // 一个完整页面及其下一页缓冲必须在同一模型窗口中比较；旧值 8 会让批次位置支配排序。
  // 24 条在现有字段裁剪下仍处于有界上下文内。超过 24 条时先排每批，再把相同名次带
  // 跨批复排；不能把各批直接拼接，否则第三批再相关也无法竞争第一页。
  const BATCH = 24;
  if (input.items.length > BATCH) {
    const slices: NetworkItem[][] = [];
    for (let i = 0; i < input.items.length; i += BATCH) slices.push(input.items.slice(i, i + BATCH));
    const rankedBatches = await Promise.all(
      slices.map((items) => selectNetworkItems({ ...input, items })),
    );
    const failedBatch = rankedBatches.find((part) => !part.ok);
    if (failedBatch && !failedBatch.ok) return failedBatch;

    const ranked = rankedBatches.flatMap((part) => (part.ok ? [part.decisions] : []));
    const itemById = new Map(input.items.map((item) => [item.itemId, item]));
    const bandWidth = Math.max(1, Math.floor(BATCH / ranked.length));
    const bandStarts = Array.from(
      { length: Math.ceil(Math.max(...ranked.map((rows) => rows.length)) / bandWidth) },
      (_, index) => index * bandWidth,
    );
    const globallyRankedBands = await Promise.all(
      bandStarts.map(async (start) => {
        const ids = ranked.flatMap((rows) => rows.slice(start, start + bandWidth).map((row) => row.itemId));
        const items = ids.map((id) => itemById.get(id)).filter((item): item is NetworkItem => !!item);
        return selectNetworkItems({ ...input, items });
      }),
    );
    const failedGlobalBand = globallyRankedBands.find((part) => !part.ok);
    if (failedGlobalBand && !failedGlobalBand.ok) return failedGlobalBand;
    const decisions = globallyRankedBands.flatMap((part) => (part.ok ? part.decisions : []));
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
    text: String(item.content.text || '').replace(/\s+/g, ' ').trim().slice(0, 180),
    ...(item.content.url ? { url: item.content.url } : {}),
    ...(item.content.contentType ? { contentType: item.content.contentType } : {}),
    publisherSubjectId: item.publisherSubjectId,
    createdAt: item.createdAt,
  }));
  const expected = new Set(input.items.map((item) => item.itemId));
  const targetCount = Math.min(
    input.items.length,
    Math.max(0, Math.floor(Number(input.targetCount || 0))),
  );
  const system = [
    '你是这个人的 2digime。给这些公开候选排序，而不是做准入审查。',
    'show 表示现在更靠前，ignore 表示靠后，不是删除。用户这次明确要看的主题优先于历史偏好。单条不喜欢不要变成封禁整个主题。',
    '只输出 JSON：{"decisions":[{"itemId":"...","decision":"show"|"ignore","reason":"..."}]}。',
    'decisions 按你认为现在该先看到的顺序排列。必须覆盖每一条 itemId。show 的 reason 用一句中文说明具体联系，不超过 20 字；ignore 的 reason 统一写“稍后”。不要 score，不要解释推理过程。',
    ...(targetCount
      ? [
          `当前页面需要 ${targetCount} 条。请把 decisions 最前面的 ${targetCount} 条作为本页选择并标为 show，其余标为 ignore；具体选哪 ${targetCount} 条仍由你根据当前数字之我、本次要求和内容质量判断。`,
        ]
      : []),
    '优化 USER VALUE：相关、有用、质量、新鲜、符合明确偏好与当前目标、保持多样与必要新奇。',
    'show 是下一页优先候选，不是“内容本身还不错”的同义词。候选充足时要拉开先后，不要把几乎所有高质量候选都 show；较弱但仍可用的内容放 ignore，之后仍可看到。',
    '如果本次要求很宽泛、没有指定主题，就让已确认的数字之我成为同等质量内容之间的主要区分依据，同时保留少量相邻探索。不要把不同的人都收敛成同一套泛化好内容。',
    '多样性先在与当前目标或数字之我有明确联系的候选中实现。这样的候选充足时，第一页绝大多数都应有明确联系；相邻探索只能占少量，不能为了题材或媒介多样，把无关但看起来优质的内容挤进前页。',
    '宽泛请求不等于“什么高质量内容都相关”。要实际使用数字之我中已确认的关注、目标和判断方式区分先后，并在 reason 里说清这条内容与这个人的具体联系。',
    '候选可能带 contentType（article/video/image/audio）。在相关和质量足够时，不要把视频、图片、音频全部 ignore 只留文章。不要为凑媒介类型而选低质或不相关项，也不要使用固定比例。',
    '禁止优化停留时长、点击率、打开次数或让人一直刷。不要只重复一个主题，也不要为多样性塞低质内容。',
    'show：现在更靠前，包括相邻或意外但仍然可用的内容。ignore：先排后，不是从信息流删掉。只有用户明确不再看的来源才排除。',
    '加推和关注提高相近内容的优先级。不喜欢只针对用户指出的那一条，不要因此封禁整个主题或来源。只有 block 才排除对应来源。',
    '用户这次主动提出的推荐调整优先于历史偏好。那是本次要求，不要写成长期「不喜欢某类内容」。打开和收藏不是喜欢。候选里若已有符合本次调整的具体对象，优先 show，不要用新闻或评论顶替。',
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
    // 部分 OpenAI-compatible 模型即使收到“每条不超过 40 字”仍会展开理由。
    // 第三次只扩大有界输出，不改变候选、提示或选择权，避免完整 JSON 在尾部被截断。
    { maxTokens: 8192, jsonObject: false },
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
        const seen = new Set(parsed.map((row) => row.itemId));
        for (const itemId of expected) {
          if (!seen.has(itemId)) parsed.push({ itemId, decision: 'ignore', reason: '这一轮没有排到。' });
        }
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
