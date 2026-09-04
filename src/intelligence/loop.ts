import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import type { ChatMessage, ChatToolCall, ChatToolDefinition } from '../infrastructure/model-http';
import { describeProfessionals } from './professionals';
import type {
  ProfessionalAgent,
  TalkChatFn,
  TalkExecution,
  TalkThread,
  TalkTurn,
} from './types';
import type { ConsultResult, PublicSubjectCard } from '../subject-collab/types';
import { formatPublicCardsForModel } from '../subject-collab/public-card';

export const NO_MODEL_NOTICE = '需要先连接 AI 能力，才能继续交流。';

const DELEGATE_TOOL: ChatToolDefinition = {
  type: 'function',
  function: {
    name: 'delegate',
    description:
      '当已连接专业能力能够实际执行用户目标，或需要核验可能过时的公开现状，而你仅靠对话无法完成时调用。必须填写已连接能力的 id。工具返回的是证据或执行事实，调用后必须综合成给用户的最终答案。不要把工具原文交给用户就算完成。若这次执行失败或未产生该能力声明的真实效果，应根据执行事实另选已连接能力、改方案、用已有证据作答，或仅在只有用户才能补的信息时提问；不要默认再调刚失败的同一个能力，也不要连续换多个同类检索器直到超时。不要用它来闲聊、回答关于用户自己的问题，或给稳定知识投保式检索。不要假装执行不存在的能力。',
    parameters: {
      type: 'object',
      properties: {
        instruction: {
          type: 'string',
          description: '给专业能力的完整任务说明，含必要背景，不是枚举类型。',
        },
        capabilityId: {
          type: 'string',
          description: '已连接能力的 id。多个已连接能力时必须填写。',
        },
      },
      required: ['instruction'],
    },
  },
};

const CONSULT_TOOL: ChatToolDefinition = {
  type: 'function',
  function: {
    name: 'consult_subject',
    description:
      '当当前目标需要另一个独立数字主体、且公开协作声明匹配时，向其发出合作请求。不要把对方当成你的内部能力。不要让用户选择协作者或协议。',
    parameters: {
      type: 'object',
      properties: {
        subjectId: {
          type: 'string',
          description: '可发现主体列表中的 subjectId。',
        },
        goal: {
          type: 'string',
          description: '希望共同完成什么。',
        },
        hopedContribution: {
          type: 'string',
          description: '希望对方贡献什么。',
        },
        disclosure: {
          type: 'string',
          description: '本次合作必要的最小上下文。不得发送完整数字之我或完整对话。',
        },
      },
      required: ['subjectId', 'goal', 'hopedContribution', 'disclosure'],
    },
  },
};

export type SubjectCollabPort = {
  cards: PublicSubjectCard[];
  consult: (input: {
    threadId: string;
    threadTurns: Array<{ role: string; text: string }>;
    selfContext: string;
    now: string;
    subjectId: string;
    goal: string;
    hopedContribution: string;
    disclosure: string;
  }) => Promise<ConsultResult>;
};

function parseConsultArgs(raw: string): {
  subjectId: string;
  goal: string;
  hopedContribution: string;
  disclosure: string;
} {
  try {
    const parsed = JSON.parse(raw) as {
      subjectId?: string;
      goal?: string;
      request?: string;
      hopedContribution?: string;
      disclosure?: string;
    };
    return {
      subjectId: String(parsed.subjectId || '').trim(),
      goal: String(parsed.goal || parsed.request || '').trim(),
      hopedContribution: String(parsed.hopedContribution || '').trim(),
      disclosure: String(parsed.disclosure || '').trim(),
    };
  } catch {
    return { subjectId: '', goal: raw.trim(), hopedContribution: '', disclosure: '' };
  }
}

function claimsCollabSuccess(text: string): boolean {
  return /已经完成合作|对方已经同意|已经征询成功|合作已经完成|对方已经接受|协作者已经完成/.test(
    text,
  );
}

function applyCollabTruth(
  judged: {
    deliver: boolean;
    userReply: string;
    askUser?: string;
    openGoal?: string;
    revision?: string;
  },
  facts: ConsultResult,
): {
  deliver: boolean;
  userReply: string;
  askUser?: string;
  openGoal?: string;
  revision?: string;
} {
  if (facts.ok && facts.received) return judged;
  const failureLine = facts.failureReason || facts.reply;
  const next = {
    ...judged,
    deliver: false,
  };
  if (!judged.askUser && claimsCollabSuccess(judged.userReply)) {
    next.userReply = `这次合作没有成立。${failureLine}`;
  }
  return next;
}

function parseArgs(raw: string): { instruction: string; capabilityId?: string } {
  try {
    const parsed = JSON.parse(raw) as { instruction?: string; capabilityId?: string };
    const instruction = String(parsed.instruction || '').trim();
    const capabilityId = String(parsed.capabilityId || '').trim();
    return capabilityId ? { instruction, capabilityId } : { instruction };
  } catch {
    return { instruction: raw.trim() };
  }
}

function parseReview(text: string): {
  deliver: boolean;
  userReply: string;
  askUser?: string;
  openGoal?: string;
  revision?: string;
  freshnessRequired?: boolean;
} {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    return { deliver: true, userReply: text.trim() };
  }
  try {
    const parsed = JSON.parse(match[0]) as {
      deliver?: boolean;
      userReply?: string;
      askUser?: string;
      openGoal?: string;
      revision?: string;
      freshnessRequired?: boolean;
    };
    const userReply = String(parsed.userReply || '').trim();
    const askUser = String(parsed.askUser || '').trim();
    const revision = String(parsed.revision || '').trim();
    const openGoal = String(parsed.openGoal || '').trim();
    return {
      deliver: parsed.deliver !== false && !askUser,
      userReply: userReply || askUser || '',
      ...(askUser ? { askUser } : {}),
      ...(openGoal ? { openGoal } : {}),
      ...(revision ? { revision } : {}),
      ...(parsed.freshnessRequired === true ? { freshnessRequired: true } : {}),
    };
  } catch {
    return { deliver: true, userReply: text.trim() };
  }
}

function claimsCompletion(text: string): boolean {
  return /已经完成|已完成|已创建|已经创建|已在工作区创建|成功写入|已经写好|已写好/.test(text);
}

function isAbortLike(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name;
  return name === 'AbortError' || name === 'TalkTimeoutError';
}

function abortError(): Error {
  const err = new Error('aborted');
  err.name = 'AbortError';
  return err;
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    signal.addEventListener('abort', () => reject(abortError()), { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/** 工具 JSON 整段冒充最终答案。检索横幅只作最低限度防御。 */
function isOwnEvidenceLeak(text: string): boolean {
  const trimmed = String(text || '').trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { actualSuccess?: unknown; role?: unknown };
      if (parsed && typeof parsed === 'object') {
        if ('actualSuccess' in parsed || parsed.role === 'evidence' || parsed.role === 'execution') {
          return true;
        }
      }
    } catch {
      /* 不是 JSON，走横幅兜底 */
    }
  }
  return /只供 2digime 综合，不是给用户的最终答案/.test(trimmed);
}

function applyExecutionTruth(
  judged: ReturnType<typeof parseReview>,
  facts: { ok: boolean; summary: string; failureReason?: string },
): ReturnType<typeof parseReview> {
  if (facts.ok) return judged;
  const failureLine = facts.failureReason || facts.summary;
  const next = {
    ...judged,
    deliver: false,
  };
  if (!judged.askUser && claimsCompletion(judged.userReply)) {
    next.userReply = `这件事还没有做成。${failureLine}`;
  }
  return next;
}

/** 结束本轮却把答案推到「稍后」——这不是完成。 */
function isDeferredDelivery(text: string): boolean {
  const t = String(text || '');
  return /稍后再(回答|答复|说明)|稍后.*再(回答|整理)|重新整理后再|会重新整理后再|后续分析为准|等(我|稍后).*再(回答|整理)|先不回答/.test(
    t,
  );
}

function usableFinalText(text: string): boolean {
  const t = String(text || '').trim();
  if (!t || isDeferredDelivery(t) || isOwnEvidenceLeak(t)) return false;
  if (t === '已经看过结果。' || t === '已经看过结果') return false;
  return true;
}

const MAX_TOOL_ROUNDS = 4;
/** 单次检索远短于整轮 deadline，避免一个 connector 吃光 180s。 */
export const SEARCH_CALL_TIMEOUT_MS = 25_000;
const DEFAULT_TOOL_CALL_TIMEOUT_MS = 75_000;
const TOOL_SYNTHESIS_RESERVE_MS = 20_000;
const MIN_TOOL_START_MS = 8_000;
const UNVERIFIED_FRESH_NOTICE = '本轮没有获得实时核验，当前无法可靠确认这一点。';

function remainingMs(deadlineAt?: number): number {
  if (!deadlineAt || !Number.isFinite(deadlineAt)) return Number.POSITIVE_INFINITY;
  return deadlineAt - Date.now();
}

function callTimeoutMs(agent: ProfessionalAgent, remaining: number): number {
  const cap = agent.maxCallMs && agent.maxCallMs > 0 ? agent.maxCallMs : DEFAULT_TOOL_CALL_TIMEOUT_MS;
  if (!Number.isFinite(remaining)) return cap;
  return Math.max(1, Math.min(cap, remaining));
}

function bindCallSignal(parent: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Math.max(1, timeoutMs));
  const onParent = () => ac.abort();
  if (parent) {
    if (parent.aborted) ac.abort();
    else parent.addEventListener('abort', onParent, { once: true });
  }
  return {
    signal: ac.signal,
    dispose: () => {
      clearTimeout(timer);
      if (parent) parent.removeEventListener('abort', onParent);
    },
  };
}

const INCOMPLETE_SYNTHESIS_NOTICE =
  '这一轮没能形成可用的最终结论。外部能力有返回，但还不足以可靠回答你的问题。请再问一次，或把问题说得更具体。';

const INCOMPLETE_REPLY_NOTICE =
  '这一轮没能形成可用的最终结论。请再问一次，或把问题说得更具体。';

function asCollabResult(value: ConsultResult | null): ConsultResult | null {
  return value;
}

export async function runTalkTurn(input: {
  thread: TalkThread;
  userText: string;
  selfContext: string;
  agents: ProfessionalAgent[];
  chat: TalkChatFn;
  workRoot: string;
  now: string;
  signal?: AbortSignal;
  /** 本轮硬截止。检索单次超时由此计算剩余预算，不得延长整轮。 */
  deadlineAt?: number;
  subjectCollab?: SubjectCollabPort;
  /** 需要用户亲自确认的理解。用人话问，不是「保存到数字之我」。 */
  confirmHint?: string;
}): Promise<TalkThread> {
  const userTurn: TalkTurn = {
    id: `turn_${randomUUID()}`,
    at: input.now,
    role: 'user',
    text: input.userText,
  };
  const thread: TalkThread = {
    ...input.thread,
    updatedAt: input.now,
    turns: [...input.thread.turns, userTurn],
  };

  const history: ChatMessage[] = [];
  for (const turn of thread.turns) {
    history.push({
      role: turn.role === 'assistant' ? 'assistant' : 'user',
      content: turn.text,
    });
  }

  const cards = input.subjectCollab?.cards || [];
  const system = [
    '你是用户的兔机米，负责理解、编排与验收。',
    '当已连接专业能力能够实际执行用户目标，而你仅靠对话无法完成该执行时，应调用该能力；不要假装执行不存在的能力。',
    '先判断：这是稳定知识，还是可能随时间变化的公开现实事实。算术、语言含义、已确定的科学关系、明确的历史事实，直接回答，不要为了保险去检索。',
    '若正确答案取决于训练截止之后仍可能变化的公开现状（任职、排名、统计、价格、政策、公司或产品现状等），且已连接实时检索能力，应先核验再回答。这是认识判断，不是按某个词触发。',
    '不要把未经核验的训练记忆说成已经确认的当前事实。检索失败或时间不够时：换一次已连接检索、用已有证据做有限说明，或明确无法确认。不要连续换多个同类检索器直到超时。',
    '每一轮只针对当前这句用户原话判断。上一轮检索不能自动当作对本问的核验。',
    '已公布的任职、主办、赛程、政策仍可能调整，不能因为训练记忆里「已经定了」就不核验。',
    '你根据当前数字之我理解用户；不要编造未写入的本人事实。',
    '交流、判断、解释用普通人语言直接回复，不要调用工具。',
    '工具返回的是证据或执行事实，不是给用户的最终答案。若调用了工具，必须在同一轮综合成用户能直接使用的结论。',
    '若执行失败或未产生该能力声明的真实效果，根据返回的执行事实继续：可换已连接能力、改方案、用已有证据作答；不要把刚失败的能力当成唯一选项。已授权工作目录不需要向用户再要路径。',
    '禁止把来源清单、redirect 或未完成草稿当成最终回复；禁止说稍后回答、重新整理后再说或后续分析为准并结束本轮。',
    '不要问用户这是聊天还是做事，不要让用户选择 Agent、任务类型、workflow、协作者、协议或分工。',
    '不要向用户展示 Job、capability、adapter、stage 或内部错误原文。',
    '缺信息时：先看数字之我和当前对话是否已有；只有用户才能提供时，用你自己的口吻问一句，然后根据对话继续。',
    input.confirmHint
      ? [
          `有一件关于用户本人的理解需要用户亲自确认：${input.confirmHint}`,
          '用普通人语言问一句。不要说保存、数字之我、确认按钮或内部机制。',
        ].join('\n')
      : '',
    cards.length
      ? [
          '当前可发现的其他主体（公开协作声明，不是对方 Digital Self）：',
          formatPublicCardsForModel(cards),
          '先判断自己能否完成、是否值得寻求其他主体。不要因为出现了可发现主体就一定联系。',
          '若确实需要合作，根据公开声明选择合适主体并调用 consult_subject。',
          '发给对方的 disclosure 必须是本次合作必要的最小上下文，不得发送完整数字之我或完整对话。',
          '不要把对方当成你的内部能力或 Tool。',
        ].join('\n')
      : '',
    input.thread.openGoal ? `用户正在继续同一件事：${input.thread.openGoal}` : '',
    '当前对用户的必要理解：',
    input.selfContext,
    '当前已连接的外部能力：',
    describeProfessionals(input.agents),
  ]
    .filter(Boolean)
    .join('\n');

  const tools: ChatToolDefinition[] = [];
  if (input.agents.length) tools.push(DELEGATE_TOOL);
  if (cards.length) tools.push(CONSULT_TOOL);

  const chat: TalkChatFn = (req) =>
    input.chat({
      ...req,
      ...(input.signal ? { signal: input.signal } : {}),
    });

  const messages: ChatMessage[] = [{ role: 'system', content: system }, ...history];
  const first = await chat({
    messages,
    ...(tools.length ? { tools } : {}),
  });

  if (!first.toolCalls?.length && !input.agents.length) {
    let text = first.text.trim();
    if (!text) {
      text = '我在。请再说一次你想让我做什么。';
    } else if (!usableFinalText(text)) {
      text = INCOMPLETE_REPLY_NOTICE;
    }
    thread.turns.push({
      id: `turn_${randomUUID()}`,
      at: input.now,
      role: 'assistant',
      text,
    });
    return thread;
  }

  const executionIds: string[] = [];
  const exchangeIds: string[] = [];
  let lastSummary = '';
  let lastPath: string | undefined;
  let lastInstruction = '';
  let lastCapability = '';
  let lastOk = false;
  let lastFailureReason = '';
  let lastOutputs: string[] = [];
  let lastEvidenceOnly = false;
  let freshEvidenceSeen = false;
  let evidenceCalls = 0;
  let didDelegate = false;
  let collabResult: ConsultResult | null = null;

  const runDelegate = async (rawArgs: string): Promise<string> => {
    const parsed = parseArgs(rawArgs);
    const requested = parsed.capabilityId;
    const agent = requested
      ? input.agents.find((item) => item.id === requested)
      : input.agents.length === 1
        ? input.agents[0]
        : undefined;
    if (!agent) {
      lastOk = false;
      lastFailureReason = requested
        ? `没有名为 ${requested} 的已连接能力。`
        : `未指定 capabilityId。当前已连接：${input.agents.map((item) => item.id).join('、') || '无'}。请选择其中一个。`;
      lastOutputs = [];
      lastSummary = lastFailureReason;
      lastPath = undefined;
      lastEvidenceOnly = false;
      lastCapability = requested || '';
      return JSON.stringify({
        actualSuccess: false,
        ok: false,
        role: 'execution',
        capabilityId: requested || '',
        evidenceOnly: false,
        failureReason: lastFailureReason,
        producedOutputs: [],
        summary: lastFailureReason,
      });
    }
    lastInstruction = parsed.instruction || input.userText;
    lastCapability = agent.id;
    const execId = `run_${randomUUID()}`;
    const workDir = path.join(input.workRoot, 'intelligence', 'runs', execId);
    const remaining = remainingMs(input.deadlineAt);
    const returnsEvidence = agent.returnsEvidence === true;
    let result: Awaited<ReturnType<ProfessionalAgent['run']>>;
    if (remaining < MIN_TOOL_START_MS) {
      result = {
        ok: false,
        failureReason: '时间预算不足，不能再启动一次外部调用。请基于已有证据综合，或说明无法确认。',
        summary: '时间预算不足，不能再启动一次外部调用。',
        producedOutputs: [],
        ...(returnsEvidence ? { evidenceOnly: true } : {}),
      };
    } else {
      const callMs = callTimeoutMs(agent, remaining - TOOL_SYNTHESIS_RESERVE_MS);
      const bound = bindCallSignal(input.signal, callMs);
      try {
        throwIfAborted(input.signal);
        result = await Promise.race([
          agent.run({
            instruction: lastInstruction,
            workDir,
            signal: bound.signal,
          }),
          waitForAbort(bound.signal),
        ]);
      } catch (err) {
        if (input.signal?.aborted) throw err;
        if (isAbortLike(err) || bound.signal.aborted) {
          result = {
            ok: false,
            failureReason: `这次调用在 ${callMs}ms 内没有返回。不是整轮结束，可换已连接能力、用已有证据，或说明无法确认。`,
            summary: '外部能力这次没有在预算内返回。',
            producedOutputs: [],
            rawText: `timeout after ${callMs}ms`,
            ...(returnsEvidence ? { evidenceOnly: true } : {}),
          };
        } else {
          result = {
            ok: false,
            failureReason: String(err instanceof Error ? err.message : err),
            summary: '外部能力这次没能完成。',
            producedOutputs: [],
            rawText: String(err instanceof Error ? err.message : err),
            ...(returnsEvidence ? { evidenceOnly: true } : {}),
          };
        }
      } finally {
        bound.dispose();
      }
    }
    lastOk = result.ok;
    lastFailureReason = result.failureReason || (result.ok ? '' : result.summary);
    lastEvidenceOnly = result.evidenceOnly === true || returnsEvidence;
    if (lastEvidenceOnly) evidenceCalls += 1;
    if (lastOk && lastEvidenceOnly) freshEvidenceSeen = true;
    lastOutputs = lastEvidenceOnly
      ? []
      : result.producedOutputs || (result.outputPath ? [result.outputPath] : []);
    lastSummary = result.summary;
    lastPath = result.ok && !lastEvidenceOnly ? result.outputPath : undefined;
    const rec: TalkExecution = {
      id: execId,
      at: input.now,
      turnId: userTurn.id,
      capabilityId: agent.id,
      instruction: lastInstruction,
      ok: result.ok,
      summary: result.summary,
      ...(lastFailureReason ? { failureReason: lastFailureReason } : {}),
      ...(lastOutputs.length ? { producedOutputs: lastOutputs } : {}),
      ...(lastPath ? { outputPath: lastPath } : {}),
    };
    thread.executions.push(rec);
    executionIds.push(execId);
    return JSON.stringify({
      actualSuccess: result.ok,
      ok: result.ok,
      role: lastEvidenceOnly ? 'evidence' : 'execution',
      capabilityId: agent.id,
      evidenceOnly: lastEvidenceOnly,
      summary: result.summary.slice(0, 4000),
      ...(lastFailureReason ? { failureReason: lastFailureReason } : {}),
      producedOutputs: lastOutputs,
      ...(lastPath ? { outputPath: lastPath } : {}),
    });
  };

  type ModelToolCall = { id: string; name: string; arguments: string };

  const runOneTool = async (call: ModelToolCall): Promise<string> => {
    throwIfAborted(input.signal);
    if (call.name === 'consult_subject') {
      const parsed = parseConsultArgs(call.arguments);
      if (!input.subjectCollab) {
        collabResult = {
          ok: false,
          received: false,
          exchangeId: '',
          disclosed: '',
          reply: '当前没有可联系的其他主体。',
          failureReason: '当前没有可联系的其他主体。',
        };
        return JSON.stringify(collabResult);
      }
      const consult = input.subjectCollab.consult({
        threadId: thread.threadId,
        threadTurns: thread.turns.map((turn) => ({ role: turn.role, text: turn.text })),
        selfContext: input.selfContext,
        now: input.now,
        subjectId: parsed.subjectId,
        goal: parsed.goal || input.userText,
        hopedContribution: parsed.hopedContribution,
        disclosure: parsed.disclosure,
      });
      collabResult = input.signal
        ? await Promise.race([consult, waitForAbort(input.signal)])
        : await consult;
      if (collabResult.exchangeId) exchangeIds.push(collabResult.exchangeId);
      return JSON.stringify({
        actualSuccess: collabResult.ok,
        received: collabResult.received,
        decision: collabResult.decision || '',
        reply: collabResult.reply,
        contribution: collabResult.contribution || '',
        disclosed: collabResult.disclosed,
        ...(collabResult.failureReason ? { failureReason: collabResult.failureReason } : {}),
      });
    }
    if (call.name === 'delegate') {
      didDelegate = true;
      return runDelegate(call.arguments);
    }
    return JSON.stringify({
      actualSuccess: false,
      ok: false,
      failureReason: '当前没有这个外部能力。',
      summary: '当前没有这个外部能力。',
    });
  };

  const appendToolRound = async (
    response: { text?: string; toolCalls?: ModelToolCall[] },
  ): Promise<void> => {
    const roundCalls = response.toolCalls || [];
    if (!roundCalls.length) return;
    const contents: string[] = [];
    for (const call of roundCalls) {
      contents.push(await runOneTool(call));
    }
    const toolCalls: ChatToolCall[] = roundCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: call.arguments },
    }));
    messages.push({
      role: 'assistant',
      content: response.text || '',
      tool_calls: toolCalls,
    });
    roundCalls.forEach((call, index) => {
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: contents[index] || '',
      });
    });
  };

  await appendToolRound(first);

  const collabNow = asCollabResult(collabResult);
  if (collabNow && !didDelegate) {
    const review = await chat({
      messages: [
        {
          role: 'system',
          content: [
            '你是兔机米，正在独立验收另一次主体合作的返回。用人话向用户交付，不要展示协议词。',
            collabNow.ok
              ? '对方已真实回应并接受。判断：是否回答了原合作需求、是否可信、是否还缺内容、是否足够用于用户最终目标。'
              : '这次合作没有成立（对方拒绝、不可达或未收到）。判断：自己继续、换主体，或用人话告诉用户。不得把拒绝或未收到说成已经合作成功。',
            '只输出 JSON：{"deliver":true,"userReply":"...","askUser":"","openGoal":"","revision":""}',
            '必须在本轮给出可用结论或明确失败。禁止稍后再回答、重新整理后再说、后续分析为准。',
            `合作事实（runtime 权威，不得改写）：actualSuccess=${collabNow.ok} received=${collabNow.received} decision=${collabNow.decision || ''}`,
            collabNow.failureReason ? `失败原因：${collabNow.failureReason}` : '',
            `实际披露：${collabNow.disclosed.slice(0, 2000)}`,
            `对方回复：${collabNow.reply}`,
            collabNow.contribution ? `对方贡献：${collabNow.contribution}` : '',
            `用户原话：${input.userText}`,
            `数字之我：\n${input.selfContext}`,
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
    });
    const judged = applyCollabTruth(parseReview(review.text), collabNow);
    const assistantText = (judged.askUser || judged.userReply).trim();
    thread.turns.push({
      id: `turn_${randomUUID()}`,
      at: input.now,
      role: 'assistant',
      text: assistantText,
      ...(exchangeIds.length ? { exchangeIds } : {}),
    });
    if (judged.askUser) {
      thread.openGoal = judged.openGoal || input.thread.openGoal || input.userText;
    } else {
      delete thread.openGoal;
    }
    return thread;
  }

  const continueWithTools = tools.length ? { tools } : {};
  let current = first;
  let toolRounds = first.toolCalls?.length ? 1 : 0;
  if (first.toolCalls?.length) {
    current = await chat({
      messages,
      ...continueWithTools,
    });
    while (current.toolCalls?.length && toolRounds < MAX_TOOL_ROUNDS) {
      throwIfAborted(input.signal);
      await appendToolRound(current);
      toolRounds += 1;
      current = await chat({
        messages,
        ...continueWithTools,
      });
    }
    if (current.toolCalls?.length) {
      throwIfAborted(input.signal);
      await appendToolRound(current);
      current = await chat({ messages, ...continueWithTools });
    }
  }

  const remainingNow = () => remainingMs(input.deadlineAt);
  const recoveryFacts = (extra: string) =>
    [
      extra,
      `执行事实（runtime 权威，不得改写）：actualSuccess=${lastOk} capabilityId=${lastCapability || '（未指定）'} evidenceOnly=${lastEvidenceOnly} freshEvidenceSeen=${freshEvidenceSeen}`,
      lastFailureReason ? `failureReason=${lastFailureReason}` : '',
      lastOutputs.length ? `outputs=${lastOutputs.join('；')}` : 'outputs=（无）',
      thread.executions.length
        ? `已尝试：${thread.executions.map((item) => `${item.capabilityId} actualSuccess=${item.ok}`).join('；')}`
        : '已尝试：无外部调用',
      `检索类调用次数=${evidenceCalls} 剩余时间约 ${Number.isFinite(remainingNow()) ? `${Math.max(0, Math.round(remainingNow() / 1000))}s` : '未知'}`,
      `当前已连接：${input.agents.map((item) => item.id).join('、') || '无'}`,
      '由你选择下一步：换已连接能力、改方案、用已有证据作答，或仅在只有用户知道时提问。不要默认再调刚失败的同一个能力。已有检索证据时综合交付；同类检索已失败两次或时间不够时，不要再换检索器，应诚实说明无法确认。已授权工作目录不需要向用户再要路径。',
    ].filter(Boolean).join('\n');

  const canStartAnotherTool =
    toolRounds < MAX_TOOL_ROUNDS && remainingNow() >= MIN_TOOL_START_MS && evidenceCalls < 2;
  if (!lastOk && didDelegate && input.agents.length > 1 && !current.toolCalls?.length && canStartAnotherTool) {
    throwIfAborted(input.signal);
    messages.push({ role: 'system', content: recoveryFacts('上一轮未产生要求的真实效果，同一轮继续。') });
    current = await chat({
      messages,
      ...continueWithTools,
    });
    if (current.toolCalls?.length) {
      await appendToolRound(current);
      toolRounds += 1;
      while (current.toolCalls?.length && toolRounds < MAX_TOOL_ROUNDS) {
        throwIfAborted(input.signal);
        current = await chat({
          messages,
          ...continueWithTools,
        });
        if (!current.toolCalls?.length) break;
        await appendToolRound(current);
        toolRounds += 1;
      }
      if (current.toolCalls?.length) {
        await appendToolRound(current);
        current = await chat({ messages, ...continueWithTools });
      }
    }
  }

  let synthesized = String(current.text || '').trim();

  const reviewPrompt = (extra: string[]) =>
    [
      '你是兔机米，正在独立验收本轮结果。不要把工具原文、来源清单或 stdout 原样丢给用户。',
      lastOk
        ? lastEvidenceOnly
          ? '外部检索只提供了证据。必须综合成对用户问题的最终答案；来源清单不是答案。'
          : '执行已成功。判断：是否满足用户目标、内容是否合格、是否需要继续、如何向用户交付。若产生了文件，必须说明做了什么、结果在哪里、是否完成。'
        : didDelegate
          ? '执行已失败或未产生声明的真实效果。判断：是否已用人话说明、是否还缺只有用户知道的信息。不得宣称任务已完成，不得生成看起来完成的空结果。'
          : '本轮没有外部执行。判断答案是否可直接交付。',
      '再判断：这是稳定知识，还是可能随训练截止后变化的公开现实事实？freshnessRequired=true 仅当正确答案取决于可能变化的公开现状。算术、语言、已确定科学关系、明确历史事实必须 freshnessRequired=false，不要为了保险要求检索。已公布的任职、主办、赛程、政策仍可能变化。只针对当前用户原话；上一轮证据不能代替本轮核验。',
      freshEvidenceSeen
        ? '本轮已有实时检索证据。综合证据作答；不得把来源清单当答案。'
        : '本轮 freshEvidenceSeen=false。若 freshnessRequired=true，不得把训练记忆包装成已确认的当前事实；应 revision 去核验，或明确说当前无法可靠核验。禁止「据我所知目前是 X」当成已核验。',
      '只输出 JSON：{"deliver":true,"userReply":"...","askUser":"","openGoal":"","revision":"","freshnessRequired":false}',
      'userReply 必须是用户现在就能用的最终说明。禁止稍后再回答、重新整理后再说、后续分析为准。',
      'askUser 仅在数字之我与对话都无法补上、且只有用户知道时填写。',
      'revision 只描述还缺什么，不是指定再调哪一个能力。同类检索已失败或时间不够时不要 revision 再搜，应诚实交付。',
      `执行事实（runtime 权威，不得改写）：actualSuccess=${lastOk} capabilityId=${lastCapability || ''} evidenceOnly=${lastEvidenceOnly} freshEvidenceSeen=${freshEvidenceSeen} evidenceCalls=${evidenceCalls}`,
      lastFailureReason ? `失败原因：${lastFailureReason}` : '',
      lastOutputs.length ? `已产生文件：${lastOutputs.join('；')}` : '未产生用户文件',
      `用户原话：${input.userText}`,
      input.thread.openGoal ? `同一件事：${input.thread.openGoal}` : '',
      `数字之我：\n${input.selfContext}`,
      lastInstruction ? `委托：${lastInstruction}` : '',
      `能力返回：${lastSummary}`,
      synthesized ? `本轮综合草稿：${synthesized.slice(0, 4000)}` : '本轮尚未形成综合草稿。',
      ...extra,
    ].filter(Boolean);

  const settleJudgement = (
    judged: ReturnType<typeof parseReview>,
    draft: string,
  ): ReturnType<typeof parseReview> => {
    let next = applyExecutionTruth(judged, {
      ok: lastOk,
      summary: lastSummary,
      ...(lastFailureReason ? { failureReason: lastFailureReason } : {}),
    });
    if (judged.freshnessRequired) next = { ...next, freshnessRequired: true };
    if (next.freshnessRequired && !freshEvidenceSeen) {
      next.deliver = false;
      if (!next.revision && !next.askUser) {
        const reply = (next.userReply || '').trim();
        next.userReply = reply && !claimsCompletion(reply) ? reply : UNVERIFIED_FRESH_NOTICE;
        if (!next.revision && canStartAnotherTool && input.agents.length) {
          next.revision = '还缺一次对当前公开事实的实时核验';
        } else if (!usableFinalText(next.userReply) || claimsCompletion(next.userReply)) {
          next.userReply = UNVERIFIED_FRESH_NOTICE;
          next.deliver = true;
          delete next.revision;
        }
      }
    }
    const reply = (next.askUser || next.userReply).trim();
    if (next.deliver && isDeferredDelivery(reply)) {
      if (usableFinalText(draft) && !(next.freshnessRequired && !freshEvidenceSeen)) {
        next = { deliver: true, userReply: draft };
      } else {
        next = {
          deliver: true,
          userReply: lastOk
            ? INCOMPLETE_SYNTHESIS_NOTICE
            : didDelegate
              ? `这件事还没有做成。${lastFailureReason || lastSummary}`
              : INCOMPLETE_REPLY_NOTICE,
        };
      }
    }
    if (!next.askUser && !usableFinalText(next.userReply) && usableFinalText(draft) && !(next.freshnessRequired && !freshEvidenceSeen)) {
      next = { ...next, userReply: draft };
    }
    if (!next.askUser && !usableFinalText(next.userReply) && !next.revision) {
      next = {
        ...next,
        deliver: true,
        userReply:
          next.freshnessRequired && !freshEvidenceSeen
            ? UNVERIFIED_FRESH_NOTICE
            : lastOk
              ? INCOMPLETE_SYNTHESIS_NOTICE
              : didDelegate
                ? `这件事还没有做成。${lastFailureReason || lastSummary}`
                : INCOMPLETE_REPLY_NOTICE,
      };
    }
    return next;
  };

  const review = await chat({
    messages: [{ role: 'system', content: reviewPrompt([]).join('\n') }],
  });
  let judged = settleJudgement(parseReview(review.text), synthesized);

  if (judged.revision && input.agents.length && toolRounds < MAX_TOOL_ROUNDS && remainingNow() >= MIN_TOOL_START_MS && evidenceCalls < 2) {
    messages.push({
      role: 'system',
      content: recoveryFacts(`还缺什么：${judged.revision}`),
    });
    const recovered = await chat({
      messages,
      ...continueWithTools,
    });
    if (recovered.toolCalls?.length) {
      await appendToolRound(recovered);
      toolRounds += 1;
      const after = await chat({
        messages,
        ...continueWithTools,
      });
      if (after.toolCalls?.length) {
        await appendToolRound(after);
        const forced = await chat({ messages });
        synthesized = String(forced.text || after.text || '').trim();
      } else {
        synthesized = String(after.text || recovered.text || '').trim();
      }
    } else {
      synthesized = String(recovered.text || '').trim();
    }
    const second = await chat({
      messages: [{ role: 'system', content: reviewPrompt(['这是继续之后的再次验收。执行仍失败时不得宣称任务已完成。']).join('\n') }],
    });
    judged = settleJudgement(parseReview(second.text), synthesized);
  }

  if (judged.freshnessRequired && !freshEvidenceSeen && !judged.askUser) {
    const text = (judged.userReply || '').trim();
    judged = {
      deliver: true,
      userReply: text && !claimsCompletion(text) ? text : UNVERIFIED_FRESH_NOTICE,
    };
  }

  if (judged.deliver && isDeferredDelivery(judged.userReply)) {
    judged = {
      deliver: true,
      userReply: lastOk ? INCOMPLETE_SYNTHESIS_NOTICE : `这件事还没有做成。${lastFailureReason || lastSummary}`,
    };
  }

  const assistantText = (judged.askUser || judged.userReply).trim();
  const resultPath =
    !judged.askUser &&
    lastOk &&
    !lastEvidenceOnly &&
    usableFinalText(assistantText) &&
    assistantText !== INCOMPLETE_SYNTHESIS_NOTICE
      ? lastPath || lastOutputs[0]
      : undefined;
  const result =
    resultPath
      ? { title: path.basename(resultPath), path: resultPath }
      : undefined;
  thread.turns.push({
    id: `turn_${randomUUID()}`,
    at: input.now,
    role: 'assistant',
    text: assistantText,
    ...(executionIds.length ? { executionIds } : {}),
    ...(exchangeIds.length ? { exchangeIds } : {}),
    ...(result ? { result } : {}),
  });
  if (judged.askUser) {
    thread.openGoal = judged.openGoal || input.thread.openGoal || input.userText;
  } else {
    delete thread.openGoal;
  }
  return thread;
}
