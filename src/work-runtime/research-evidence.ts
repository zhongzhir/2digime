/**
 * Bounded AI-native research evidence loop helpers.
 * Deterministic: dedupe, normalize, size limits.
 * Model: what to search, which hits are relevant/sufficient, whether to search again.
 */
import type { ChatMessage } from '../infrastructure/model-http';
import type { SearchSource } from '../capability/search-contract';
import { isUsableWebEvidenceItem } from '../capability/search-contract';

export const RESEARCH_MAX_ROUNDS = 2;
export const RESEARCH_MAX_QUERIES_PER_ROUND = 2;
export const RESEARCH_MAX_EVIDENCE = 8;
export const SEARCH_DUMP_MARKER = '综合结论以 2digime 后续分析为准';

export interface ResearchQueryPlan {
  queries: string[];
  decided: boolean;
}

export interface ResearchEvidenceJudgment {
  selectedIndexes: number[];
  sufficient: boolean;
  followupQueries: string[];
  missingQuestions: string[];
  decided: boolean;
}

export interface ResearchEvidenceCandidate {
  index: number;
  title: string;
  url: string;
  snippet?: string;
  evidenceExcerpt?: string;
}

export interface JobResearchEvidence {
  queries: string[];
  rounds: number;
  candidateUrls: string[];
  selectedUrls: string[];
  rejectedUrls: string[];
  sufficient: boolean;
  decided: boolean;
}

export function isSearchDumpText(text: string): boolean {
  return String(text || '').includes(SEARCH_DUMP_MARKER);
}

export function normalizeHttpUrl(url: string): string {
  try {
    const u = new URL(String(url || '').trim());
    u.hash = '';
    return u.toString();
  } catch {
    return String(url || '').trim();
  }
}

export function dedupeSearchSources(sources: readonly SearchSource[]): SearchSource[] {
  const out: SearchSource[] = [];
  const seen = new Set<string>();
  for (const raw of sources) {
    if (!isUsableWebEvidenceItem(raw)) continue;
    const url = normalizeHttpUrl(raw.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ ...raw, url });
    if (out.length >= 24) break;
  }
  return out;
}

export function toResearchCandidates(sources: readonly SearchSource[]): ResearchEvidenceCandidate[] {
  return sources.slice(0, 16).map((s, i) => {
    const snippet = snippetFromSource(s);
    const excerpt = excerptFromSource(s);
    return {
      index: i + 1,
      title: s.title,
      url: s.url,
      ...(snippet ? { snippet } : {}),
      ...(excerpt ? { evidenceExcerpt: excerpt } : {}),
    };
  });
}

function snippetFromSource(s: SearchSource): string | undefined {
  const direct = String(s.snippet || '').trim();
  if (direct) return direct.slice(0, 280);
  const grounded = (s.groundingSupport || [])
    .map((g) => String(g.segment || '').trim())
    .filter(Boolean)
    .join(' ')
    .trim();
  return grounded ? grounded.slice(0, 280) : undefined;
}

function excerptFromSource(s: SearchSource): string | undefined {
  const direct = String(s.evidenceChunk || '').trim();
  if (direct) return direct.slice(0, 500);
  const grounded = (s.groundingSupport || [])
    .map((g) => String(g.segment || '').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
  return grounded ? grounded.slice(0, 500) : undefined;
}

export function parseResearchQueries(text: string): string[] {
  const obj = extractJsonObject(text);
  if (!obj) return [];
  const raw = obj.queries ?? obj.searchQueries;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const q = String(item || '').trim().replace(/\s+/g, ' ');
    if (q.length < 4 || seen.has(q.toLowerCase())) continue;
    seen.add(q.toLowerCase());
    out.push(q.slice(0, 160));
    if (out.length >= RESEARCH_MAX_QUERIES_PER_ROUND) break;
  }
  return out;
}

export function parseEvidenceJudgment(
  text: string,
  candidateCount: number,
): Omit<ResearchEvidenceJudgment, 'decided'> | null {
  const obj = extractJsonObject(text);
  if (!obj) return null;
  const rawIdx = obj.selectedIndexes ?? obj.selected ?? obj.relevantIndexes;
  if (!Array.isArray(rawIdx)) return null;
  const selectedIndexes: number[] = [];
  const seen = new Set<number>();
  for (const item of rawIdx) {
    const n = Number(item);
    if (!Number.isInteger(n) || n < 1 || n > candidateCount || seen.has(n)) continue;
    seen.add(n);
    selectedIndexes.push(n);
    if (selectedIndexes.length >= RESEARCH_MAX_EVIDENCE) break;
  }
  const followupRaw = obj.followupQueries ?? obj.nextQueries;
  const followupQueries = Array.isArray(followupRaw)
    ? followupRaw
        .map((q) => String(q || '').trim().replace(/\s+/g, ' '))
        .filter((q) => q.length >= 4)
        .slice(0, RESEARCH_MAX_QUERIES_PER_ROUND)
    : [];
  const missingRaw = obj.missingQuestions ?? obj.gaps;
  const missingQuestions = Array.isArray(missingRaw)
    ? missingRaw.map((q) => String(q || '').trim()).filter(Boolean).slice(0, 6)
    : [];
  return {
    selectedIndexes,
    sufficient: obj.sufficient === true,
    followupQueries,
    missingQuestions,
  };
}

export function buildResearchQueryMessages(input: {
  goal: string;
  plan?: string;
}): ChatMessage[] {
  const lines = [
    '【用户要回答的问题】',
    input.goal || '（尚未明确）',
  ];
  if (input.plan?.trim()) {
    lines.push('【已确认研究规划】');
    lines.push(input.plan.trim().slice(0, 1200));
  }
  lines.push(
    '请为获取现实世界证据生成 1-2 条精炼搜索查询。查询应覆盖问题的不同关键角度，不要复述整段用户原话，不要加入「搜索/联网/研究」等指令词。',
  );
  return [
    {
      role: 'system',
      content:
        '你在为一项现实信息任务规划检索。只输出 JSON：{"queries":["..."]}。查询要短、具体、可检索。不要 Markdown。',
    },
    { role: 'user', content: lines.join('\n') },
  ];
}

export function buildEvidenceJudgmentMessages(input: {
  goal: string;
  queries: readonly string[];
  candidates: readonly ResearchEvidenceCandidate[];
}): ChatMessage[] {
  const lines = [
    '【用户要回答的问题】',
    input.goal,
    '【本轮已执行查询】',
    input.queries.map((q) => `- ${q}`).join('\n') || '（无）',
    '【检索候选】',
  ];
  if (!input.candidates.length) {
    lines.push('（没有候选）');
  } else {
    for (const c of input.candidates) {
      lines.push(`[${c.index}] ${c.title}`);
      lines.push(`    URL: ${c.url}`);
      if (c.snippet) lines.push(`    摘要: ${c.snippet}`);
      if (c.evidenceExcerpt) lines.push(`    片段: ${c.evidenceExcerpt}`);
    }
  }
  lines.push(
    '判断每条候选与问题是否相关、是否值得作为证据。排名不等于相关性。明显无关、空壳导航页、重复镜像不要选。',
  );
  lines.push(
    '标题、摘要或 URL 已能看出与问题相关的，必须选入；没有正文片段也可以选。跳转链接只要标题相关就选。',
  );
  lines.push(
    'selectedIndexes 为空只表示全部候选都与问题无关。有多条明显相关时不得给空数组。',
  );
  lines.push(
    '若已选证据仍不足以诚实回答问题，sufficient=false，并给出 followupQueries。不要用内部知识把缺口补成「最新事实」。',
  );
  lines.push(
    '只输出 JSON：{"selectedIndexes":[1],"sufficient":false,"missingQuestions":["..."],"followupQueries":["..."]}',
  );
  return [
    {
      role: 'system',
      content:
        '你在筛选研究证据。只根据候选条目判断相关性与充足性。只输出一个 JSON 对象。不要 Markdown。',
    },
    { role: 'user', content: lines.join('\n') },
  ];
}

export function formatSelectedEvidenceDocument(input: {
  goal: string;
  queries: readonly string[];
  selected: readonly SearchSource[];
  rejectedCount: number;
  sufficient: boolean;
  missingQuestions?: readonly string[];
}): string {
  const lines: string[] = [
    `# 研究证据（已筛选）`,
    '',
    `问题：${input.goal.slice(0, 240)}`,
    `查询：${input.queries.join(' | ') || '（未单独规划）'}`,
    `筛选：采用 ${input.selected.length} 条，排除 ${input.rejectedCount} 条。充足：${input.sufficient ? '是' : '否'}。`,
    '',
  ];
  if (input.missingQuestions?.length) {
    lines.push('尚未被证据覆盖的问题：');
    for (const q of input.missingQuestions) lines.push(`- ${q}`);
    lines.push('');
  }
  if (!input.selected.length) {
    lines.push('没有与问题相关的可用外部证据。综合时必须如实说明缺口，不得把内部知识写成已检索到的最新事实。');
    return lines.join('\n');
  }
  input.selected.forEach((s, i) => {
    const n = i + 1;
    lines.push(`[${n}] ${s.title}`);
    lines.push(`    URL：${s.url}`);
    if (s.sourceType) lines.push(`    类型：${s.sourceType}`);
    if (s.snippet) lines.push(`    摘要：${s.snippet.slice(0, 280)}`);
    if (s.evidenceChunk) {
      const chunk =
        s.evidenceChunk.length > 2200 ? `${s.evidenceChunk.slice(0, 2200)}…` : s.evidenceChunk;
      lines.push(`    证据片段：\n${chunk}`);
    } else {
      lines.push('    证据片段：（未能抓取正文，仅标题/URL 可参考，不得编造其具体内容）');
    }
    lines.push('');
  });
  lines.push('综合要求：基于上述已选证据回答用户问题；关键现实判断必须能回到编号来源；来源冲突要写明差异；证据不足不得给出过强结论。不要只交链接清单。');
  return lines.join('\n');
}

export async function planResearchQueriesWithChat(
  chat: (input: { messages: ChatMessage[] }) => Promise<{ text: string }>,
  input: { goal: string; plan?: string },
): Promise<ResearchQueryPlan> {
  const messages = buildResearchQueryMessages(input);
  try {
    const first = await chat({ messages });
    const queries = parseResearchQueries(first.text);
    if (queries.length) return { queries, decided: true };
    const retry = await chat({
      messages: [
        ...messages,
        { role: 'assistant', content: String(first.text || '').slice(0, 800) },
        {
          role: 'user',
          content: '上一次输出不符合合同。请只输出 {"queries":["精炼查询"]}。1-2 条。不要 Markdown。',
        },
      ],
    });
    const again = parseResearchQueries(retry.text);
    if (again.length) return { queries: again, decided: true };
    return { queries: [], decided: false };
  } catch {
    return { queries: [], decided: false };
  }
}

export async function judgeResearchEvidenceWithChat(
  chat: (input: { messages: ChatMessage[] }) => Promise<{ text: string }>,
  input: {
    goal: string;
    queries: readonly string[];
    candidates: readonly ResearchEvidenceCandidate[];
  },
): Promise<ResearchEvidenceJudgment> {
  if (!input.candidates.length) {
    return {
      selectedIndexes: [],
      sufficient: false,
      followupQueries: [],
      missingQuestions: [],
      decided: false,
    };
  }
  const messages = buildEvidenceJudgmentMessages(input);
  try {
    const first = await chat({ messages });
    const parsed = parseEvidenceJudgment(first.text, input.candidates.length);
    if (parsed && (parsed.selectedIndexes.length > 0 || input.candidates.length === 0)) {
      return { ...parsed, decided: true };
    }
    const retry = await chat({
      messages: [
        ...messages,
        { role: 'assistant', content: String(first.text || '').slice(0, 800) },
        {
          role: 'user',
          content:
            parsed && parsed.selectedIndexes.length === 0
              ? '空数组只表示全部候选都与问题无关。标题或摘要已能看出相关的必须写入 selectedIndexes。只输出 JSON。'
              : '上一次输出不符合合同。请只输出 {"selectedIndexes":[1],"sufficient":false,"missingQuestions":[],"followupQueries":[]}。不要 Markdown。',
        },
      ],
    });
    const again = parseEvidenceJudgment(retry.text, input.candidates.length);
    if (again) return { ...again, decided: true };
    if (parsed) return { ...parsed, decided: true };
    return {
      selectedIndexes: [],
      sufficient: false,
      followupQueries: [],
      missingQuestions: [],
      decided: false,
    };
  } catch {
    return {
      selectedIndexes: [],
      sufficient: false,
      followupQueries: [],
      missingQuestions: [],
      decided: false,
    };
  }
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    if (!obj || typeof obj !== 'object') return null;
    return obj as Record<string, unknown>;
  } catch {
    return null;
  }
}
