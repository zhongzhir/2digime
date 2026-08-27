/**
 * Bounded AI relevance / referent resolution.
 * Deterministic layer only supplies candidates and size limits.
 * The model decides what the current utterance refers to.
 */
import type { ChatMessage } from '../infrastructure/model-http';
import type { WorkContextCandidate } from './context-candidates';
import { formatContextCandidateBrief } from './context-candidates';

export interface ContextRelevanceResult {
  selectedIds: string[];
  /** false：通道不可用或无法解析，调用方应回退规划 id / 既有偏好门槛。 */
  decided: boolean;
}

export interface ContextRelevanceInput {
  goal: string;
  userText?: string;
  candidates: readonly WorkContextCandidate[];
  recentTurns?: ReadonlyArray<{ role: string; content: string }>;
}

const SYSTEM_PROMPT = [
  '你在为当前任务选择真正相关的已有上下文。',
  '候选来自已有对话、已完成成果、项目目录与已确认工作偏好，不是新的资料库。',
  '用户常常不重复项目名或材料，但仍在继续刚完成的工作。你必须结合当前目标、近期对话、成果语义与新近程度解析指代。',
  '新近程度是信号，不是自动全选：近期但语义无关的项目不要选；相关的历史成果即使不是最新一条也可以选。',
  '已确认偏好：仅当它会改变本次产物的写法或结构时才选；无关偏好不要机械注入。',
  '存在多个看似合理的候选时，选你能可靠判断的那些并执行；只有真正无法判断且选错代价明显时才返回空数组。',
  '只输出一个 JSON 对象：{"relevantContextIds":["候选 id", ...]}。不要 Markdown。',
].join('\n');

export function buildContextRelevanceMessages(input: ContextRelevanceInput): ChatMessage[] {
  const lines: string[] = [];
  lines.push('【当前任务目标】');
  lines.push(input.goal || '（尚未明确）');
  if (input.userText && input.userText.trim() && input.userText.trim() !== input.goal.trim()) {
    lines.push('【当前用户输入】');
    lines.push(input.userText.trim());
  }
  if (input.recentTurns?.length) {
    lines.push('【当前任务近期对话】');
    for (const t of input.recentTurns.slice(-8)) {
      lines.push(`${t.role === 'user' ? '用户' : 'Digital Me'}：${t.content}`);
    }
  }
  const brief = formatContextCandidateBrief(input.candidates);
  if (brief) lines.push(brief);
  else lines.push('【可选用的已有上下文候选】无');
  lines.push('请输出 relevantContextIds。');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: lines.join('\n') },
  ];
}

export function parseContextRelevanceOutput(
  text: string,
  allowedIds: readonly string[],
): string[] {
  const allowed = new Set(allowedIds);
  const obj = extractJsonObject(text);
  if (!obj) return [];
  const raw = obj.relevantContextIds ?? obj.selectedContextIds;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const id = String(item || '').trim();
    if (!id || !allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 12) break;
  }
  return out;
}

export async function resolveContextRelevanceWithChat(
  chat: (input: { messages: ChatMessage[] }) => Promise<{ text: string }>,
  input: ContextRelevanceInput,
): Promise<ContextRelevanceResult> {
  if (!input.candidates.length) return { selectedIds: [], decided: false };
  const allowed = input.candidates.map((c) => c.id);
  const messages = buildContextRelevanceMessages(input);
  try {
    const first = await chat({ messages });
    if (looksLikeEmptySelection(first.text) || parseContextRelevanceOutput(first.text, allowed).length) {
      return { selectedIds: parseContextRelevanceOutput(first.text, allowed), decided: true };
    }
    const retry = await chat({
      messages: [
        ...messages,
        { role: 'assistant', content: String(first.text || '').slice(0, 1500) },
        {
          role: 'user',
          content:
            '上一次输出不符合合同。请只输出一个 JSON 对象：{"relevantContextIds":["候选 id"]}。可为空数组。不要 Markdown。',
        },
      ],
    });
    if (looksLikeEmptySelection(retry.text) || parseContextRelevanceOutput(retry.text, allowed).length) {
      return { selectedIds: parseContextRelevanceOutput(retry.text, allowed), decided: true };
    }
    return { selectedIds: [], decided: false };
  } catch {
    return { selectedIds: [], decided: false };
  }
}

function looksLikeEmptySelection(text: string): boolean {
  const obj = extractJsonObject(text);
  if (!obj) return false;
  const raw = obj.relevantContextIds ?? obj.selectedContextIds;
  return Array.isArray(raw);
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
