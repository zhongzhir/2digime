import type { ChatMessage } from '../../infrastructure/model-http';
import { coerceFacet } from './view';
import type {
  DigitalSelf,
  DigitalSelfOrigin,
  ModelInterpretResult,
  ModelUnderstandingProposal,
} from './types';
import { liveUnderstandings } from './view';

export type DigitalSelfChatFn = (input: {
  messages: ChatMessage[];
}) => Promise<{ text: string }>;

const SYSTEM = `你在帮助 2digime 理解「用户本人」。只判断与用户本人有关的信息。
返回一个 JSON 对象，不要markdown。形状：
{"understandings":[{"text":"用第一人称以外的客观短句描述这条理解","facet":"about_me|goals|preferences|boundaries|context","aboutUser":true,"origin":"user_statement|material|inference","excerpt":"原文摘录","lasting":false,"isCoreIdentity":false,"isSensitive":false,"isMajorGoal":false,"isBoundary":false,"mustAsk":false,"mergeWithId":null,"conflictsWithId":null,"replacesId":null}],"notice":""}

规则：
- lasting 必须给出。lasting=true 才值得进入长期数字之我；false 表示不要沉淀。
- 只输出与用户本人有关、具有稳定主体意义、未来判断或行动用得上的理解。
- 本轮具体要做的事、一次性任务目标、这次想要的成品、临时安排、纯当前对话事务：lasting=false，且不要写入 understandings。
- 可以 lasting=true 的：用户明确的长期偏好、稳定能力事实、稳定边界、用户明确表示今后都如此的偏好。
- 资料里的无关内容、百科、他人不要写成用户事实。
- 用户亲口明确说自己 → origin=user_statement；来自资料 → material；其余推断 → inference。
- text 写当前理解，不要复述整份资料或整段对话。
- facet 只是展示分组：about_me=我是谁；goals=关心/想要；preferences=偏好与判断；boundaries=边界；context=长期经历/项目/关系/上下文。
- 若与 CURRENT 中某条说的是同一事实，填 mergeWithId。
- 若明确纠正或收窄某条，填 replacesId，不要让互相冲突的旧条继续作为 current。
- 若与某条矛盾且不能静默覆盖，填 conflictsWithId，mustAsk=true。
- 资料或推断中的核心身份、敏感内容、重大长期目标、重要边界、低置信，mustAsk=true。
- 不要编造。没有长期价值、没有稳定主体意义的内容，understandings 为空数组。`;

function originOf(raw: unknown): DigitalSelfOrigin {
  if (raw === 'material' || raw === 'inference' || raw === 'user_statement') return raw;
  return 'inference';
}

function optionalId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const id = raw.trim();
  return id.length > 0 ? id : undefined;
}

function extractJsonObject(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/u, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('模型没有返回可理解的结果');
  }
  return JSON.parse(trimmed.slice(start, end + 1)) as unknown;
}

function asProposal(raw: unknown): ModelUnderstandingProposal | null {
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as Record<string, unknown>;
  const text = typeof row.text === 'string' ? row.text.trim() : '';
  if (!text) return null;
  const aboutUser = row.aboutUser !== false;
  const proposal: ModelUnderstandingProposal = {
    text,
    facet: coerceFacet(row.facet),
    aboutUser,
    origin: originOf(row.origin),
  };
  if (typeof row.excerpt === 'string' && row.excerpt.trim()) {
    proposal.excerpt = row.excerpt.trim().slice(0, 400);
  }
  if (row.lasting === false) proposal.lasting = false;
  if (row.lasting === true) proposal.lasting = true;
  if (row.isCoreIdentity === true) proposal.isCoreIdentity = true;
  if (row.isSensitive === true) proposal.isSensitive = true;
  if (row.isMajorGoal === true) proposal.isMajorGoal = true;
  if (row.isBoundary === true) proposal.isBoundary = true;
  if (row.mustAsk === true) proposal.mustAsk = true;
  const mergeWithId = optionalId(row.mergeWithId);
  const conflictsWithId = optionalId(row.conflictsWithId);
  const replacesId = optionalId(row.replacesId);
  if (mergeWithId) proposal.mergeWithId = mergeWithId;
  if (conflictsWithId) proposal.conflictsWithId = conflictsWithId;
  if (replacesId) proposal.replacesId = replacesId;
  return proposal;
}

export function parseInterpretResult(text: string): ModelInterpretResult {
  const parsed = extractJsonObject(text);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('模型没有返回可理解的结果');
  }
  const body = parsed as Record<string, unknown>;
  const list = Array.isArray(body.understandings) ? body.understandings : [];
  const understandings = list
    .map(asProposal)
    .filter((row): row is ModelUnderstandingProposal => row !== null);
  const notice = typeof body.notice === 'string' ? body.notice.trim() : '';
  return notice ? { understandings, notice } : { understandings };
}

export function buildInterpretPrompt(input: {
  mode: 'tell' | 'import';
  self: DigitalSelf;
  text: string;
  materialName?: string;
}): string {
  const current = liveUnderstandings(input.self).map((item) => ({
    id: item.id,
    text: item.text,
    status: item.status,
    facet: item.facet,
    confirmed: item.confirmed,
  }));
  const materialName = input.materialName ? input.materialName : '';
  return [
    '===DIGITAL_SELF_MODE===',
    input.mode,
    '===DIGITAL_SELF_CURRENT===',
    JSON.stringify(current),
    '===DIGITAL_SELF_MATERIAL_NAME===',
    materialName,
    '===DIGITAL_SELF_INPUT===',
    input.text,
  ].join('\n');
}

export async function interpretWithModel(input: {
  chat: DigitalSelfChatFn;
  mode: 'tell' | 'import';
  self: DigitalSelf;
  text: string;
  materialName?: string;
}): Promise<ModelInterpretResult> {
  const user = buildInterpretPrompt(input);
  const result = await input.chat({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user },
    ],
  });
  return parseInterpretResult(result.text);
}
