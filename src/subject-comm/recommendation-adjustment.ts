/**
 * 发现页「本次调整」。用户主动表达，不是 Digital Self，不是第二套画像。
 * session：仅作用于默认推荐，不是当前进程；换主题搜索不自动套用。
 * keep：同时写入 content-preferences.steer，重启仍在。
 * 打开 / 稍后看 / 一次搜索不得写到这里。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile } from '../infrastructure/fs-atomic';
import type { ChatCompleteFn } from '../subject-core/structured-distill';
import { completeStructured } from './structured-call';

export const ADJUSTMENT_SCOPES = ['session', 'keep'] as const;
export type AdjustmentScope = (typeof ADJUSTMENT_SCOPES)[number];

export interface RecommendationAdjustment {
  id: string;
  text: string;
  summary: string;
  scope: AdjustmentScope;
  question?: string;
  runtimeId: string;
  origin: 'user_expression';
  createdAt: string;
  updatedAt: string;
  /** 关联已有 Talk 任务；有效条件从 thread 派生，不双写。 */
  goalThreadId?: string;
}

export const STEER_PREFERENCE_TARGET = 'recommendation_adjust';

interface AdjustmentFile {
  version: 1;
  current: RecommendationAdjustment | null;
}

export function recommendationAdjustmentPath(packageRoot: string): string {
  return path.join(packageRoot, 'content', 'recommendation-adjustment.json');
}

function emptyFile(): AdjustmentFile {
  return { version: 1, current: null };
}

function sanitize(raw: unknown, runtimeId?: string): RecommendationAdjustment | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  if (rec.origin !== 'user_expression') return null;
  const scope = String(rec.scope || '');
  if (scope !== 'session' && scope !== 'keep') return null;
  const text = String(rec.text || '').trim().slice(0, 400);
  const summary = String(rec.summary || '').trim().slice(0, 160);
  if (!text || !summary) return null;
  const next: RecommendationAdjustment = {
    id: String(rec.id || '').trim() || `ra_${Date.now().toString(36)}`,
    text,
    summary,
    scope,
    runtimeId: String(rec.runtimeId || runtimeId || ''),
    origin: 'user_expression',
    createdAt: String(rec.createdAt || ''),
    updatedAt: String(rec.updatedAt || ''),
  };
  const question = String(rec.question || '').trim().slice(0, 120);
  if (typeof rec.goalThreadId === 'string') next.goalThreadId = rec.goalThreadId;
  if (question) next.question = question;
  return next;
}

async function readFile(packageRoot: string, runtimeId?: string): Promise<AdjustmentFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(recommendationAdjustmentPath(packageRoot), 'utf8')) as AdjustmentFile;
    return { version: 1, current: sanitize(parsed.current, runtimeId) };
  } catch {
    return emptyFile();
  }
}

async function writeFile(packageRoot: string, file: AdjustmentFile): Promise<void> {
  await fs.mkdir(path.dirname(recommendationAdjustmentPath(packageRoot)), { recursive: true });
  await atomicWriteFile(recommendationAdjustmentPath(packageRoot), `${JSON.stringify(file, null, 2)}\n`);
}

export async function loadRecommendationAdjustment(
  packageRoot: string,
  runtimeId?: string,
): Promise<RecommendationAdjustment | null> {
  return (await readFile(packageRoot, runtimeId)).current;
}

/** 仅本次只作用于默认推荐。换主题的新搜索不自动套用；持续保留仍走已有偏好。 */
export function adjustmentSteersFeed(
  adjustment: RecommendationAdjustment | null,
  feedMode: 'personal' | 'intent' | undefined,
): boolean {
  if (!adjustment) return false;
  if (feedMode === 'intent') return false;
  return true;
}

export async function saveRecommendationAdjustment(
  packageRoot: string,
  input: Omit<RecommendationAdjustment, 'id' | 'createdAt' | 'updatedAt' | 'origin'> & {
    id?: string;
    createdAt?: string;
    now?: string;
  },
): Promise<RecommendationAdjustment> {
  const now = input.now || new Date().toISOString();
  const existing = await loadRecommendationAdjustment(packageRoot, input.runtimeId);
  const next: RecommendationAdjustment = {
    id: input.id || existing?.id || `ra_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    text: input.text.trim().slice(0, 400),
    summary: input.summary.trim().slice(0, 160),
    scope: input.scope,
    runtimeId: input.runtimeId,
    origin: 'user_expression',
    createdAt: input.createdAt || existing?.createdAt || now,
    updatedAt: now,
    ...(input.question?.trim() ? { question: input.question.trim().slice(0, 120) } : {}),
    ...(input.goalThreadId ? { goalThreadId: input.goalThreadId } : {}),
  };
  await writeFile(packageRoot, { version: 1, current: next });
  return next;
}

export async function clearRecommendationAdjustment(packageRoot: string): Promise<void> {
  await writeFile(packageRoot, emptyFile());
}

export function formatAdjustmentDirective(adjustment: RecommendationAdjustment | null): string {
  if (!adjustment) return '';
  return [
    '用户这次主动提出的推荐调整（只作用于当前推荐，不是长期身份，不要写成「用户不喜欢某类内容」）：',
    adjustment.summary,
    `原文：${adjustment.text}`,
    adjustment.scope === 'session'
      ? '作用范围：仅本次默认推荐。换主题搜索不自动套用。不是应用进程寿命，也不是长期「不喜欢」。'
      : '作用范围：用户选择持续保留。仍不是数字之我。',
    adjustment.question ? `还可以再细化：${adjustment.question}。先按已有条件找一批候选，不要停在追问。` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function interpretRecommendationAdjust(input: {
  text: string;
  selfContext?: string;
  chatComplete: ChatCompleteFn;
  model: { baseUrl: string; model: string; apiKey?: string };
  now?: string;
}): Promise<{ summary: string; sufficient: boolean; question?: string }> {
  const text = input.text.trim();
  const system = [
    '你在理解用户对「发现」推荐的一次主动调整。这不是搜索引擎，也不是给用户贴长期标签。',
    '只输出 JSON：{"summary":"","sufficient":true,"question":""}。',
    'summary 用一句中文说明「本次」要多看、少看或改成什么。必须带「本次」，不要写成「用户不喜欢…」「用户以后都不看…」这类长期结论。',
    '结合已经知道的兴趣找具体作品、节目、攻略或课程。打开、收藏、一次搜索都不是喜欢。',
    'sufficient：现有信息是否已经够去找一批具体候选。用户已经给出主题、方向或可用时间时写 true，不要再为细分方向追问。价格、课时、平台不知道不是追问理由，后续卡片如实标明未知。先交候选，允许用户再细化。不够时只问一个关键问题，写在 question；够了 question 留空。',
    '不要编造价格、课时或平台。不知道就让后续卡片如实标明。',
  ].join('\n');
  const user = [
    `当前时间：${input.now || new Date().toISOString()}`,
    input.selfContext?.trim() ? `数字之我摘要（仅供理解，不要写回身份）：\n${input.selfContext.trim().slice(0, 800)}` : '还没有可用的数字之我摘要。',
    `用户说：${text}`,
  ].join('\n\n');
  const outcome = await completeStructured<{ summary: string; sufficient: boolean; question?: string }>({
    chat: input.chatComplete,
    request: {
      baseUrl: input.model.baseUrl,
      ...(input.model.apiKey ? { apiKey: input.model.apiKey } : {}),
      model: input.model.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0,
      responseFormat: { type: 'json_object' },
    },
    parse: (raw) => {
      const start = raw.indexOf('{');
      const end = raw.lastIndexOf('}');
      if (start < 0 || end <= start) return null;
      try {
        const rec = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
        const summary = String(rec.summary || '').replace(/\s+/g, ' ').trim().slice(0, 160);
        if (!summary) return null;
        const sufficient = rec.sufficient === true || rec.sufficient === 'true';
        const question = String(rec.question || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        return {
          summary,
          sufficient,
          ...(question && !sufficient ? { question } : {}),
        };
      } catch {
        return null;
      }
    },
  });
  if (outcome.value) return outcome.value;
  return {
    summary: `本次按你刚才说的调整推荐：${text.slice(0, 40)}`,
    sufficient: true,
  };
}
