import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import type { ChatMessage, ChatToolDefinition } from '../infrastructure/model-http';
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
      '当已连接专业能力能够实际执行用户目标，而你仅靠对话无法完成该执行时调用。不要用它来闲聊或回答关于用户自己的问题。不要假装执行不存在的能力。',
    parameters: {
      type: 'object',
      properties: {
        instruction: {
          type: 'string',
          description: '给专业能力的完整任务说明，含必要背景，不是枚举类型。',
        },
        capabilityId: {
          type: 'string',
          description: '可选。已连接能力的 id。若只有一个可用能力可省略。',
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
    };
    const userReply = String(parsed.userReply || '').trim();
    const askUser = String(parsed.askUser || '').trim();
    const revision = String(parsed.revision || '').trim();
    const openGoal = String(parsed.openGoal || '').trim();
    return {
      deliver: parsed.deliver !== false && !askUser,
      userReply: userReply || (askUser ? askUser : '已经看过结果。'),
      ...(askUser ? { askUser } : {}),
      ...(openGoal ? { openGoal } : {}),
      ...(revision ? { revision } : {}),
    };
  } catch {
    return { deliver: true, userReply: text.trim() };
  }
}

function claimsCompletion(text: string): boolean {
  return /已经完成|已完成|已创建|已经创建|已在工作区创建|成功写入|已经写好|已写好/.test(text);
}

function applyExecutionTruth(
  judged: {
    deliver: boolean;
    userReply: string;
    askUser?: string;
    openGoal?: string;
    revision?: string;
  },
  facts: { ok: boolean; summary: string; failureReason?: string },
): {
  deliver: boolean;
  userReply: string;
  askUser?: string;
  openGoal?: string;
  revision?: string;
} {
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

export async function runTalkTurn(input: {
  thread: TalkThread;
  userText: string;
  selfContext: string;
  agents: ProfessionalAgent[];
  chat: TalkChatFn;
  workRoot: string;
  now: string;
  signal?: AbortSignal;
  subjectCollab?: SubjectCollabPort;
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
    '你是用户的 2digime，负责理解、编排与验收。',
    '当已连接专业能力能够实际执行用户目标，而你仅靠对话无法完成该执行时，应调用该能力；不要假装执行不存在的能力。',
    '你根据当前数字之我理解用户；不要编造未写入的本人事实。',
    '交流、判断、解释用普通人语言直接回复，不要调用工具。',
    '不要问用户这是聊天还是做事，不要让用户选择 Agent、任务类型、workflow、协作者、协议或分工。',
    '不要向用户展示 Job、capability、adapter、stage 或内部错误原文。',
    '缺信息时：先看数字之我和当前对话是否已有；只有用户才能提供时，用你自己的口吻问一句，然后根据对话继续。',
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

  const messages: ChatMessage[] = [{ role: 'system', content: system }, ...history];
  const first = await input.chat({
    messages,
    ...(tools.length ? { tools } : {}),
  });

  if (!first.toolCalls?.length) {
    const text = first.text.trim() || '我在。请再说一次你想让我做什么。';
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
  let calls = 0;
  let didDelegate = false;
  let collabResult: ConsultResult | null = null;

  const runDelegate = async (rawArgs: string): Promise<string> => {
    const parsed = parseArgs(rawArgs);
    const agent =
      (parsed.capabilityId && input.agents.find((item) => item.id === parsed.capabilityId)) ||
      input.agents[0];
    if (!agent) {
      lastOk = false;
      lastFailureReason = '当前没有可调用的外部能力。';
      lastOutputs = [];
      lastSummary = lastFailureReason;
      lastPath = undefined;
      return JSON.stringify({
        actualSuccess: false,
        ok: false,
        failureReason: lastFailureReason,
        producedOutputs: [],
        summary: lastFailureReason,
      });
    }
    lastInstruction = parsed.instruction || input.userText;
    lastCapability = agent.id;
    const execId = `run_${randomUUID()}`;
    const workDir = path.join(input.workRoot, 'intelligence', 'runs', execId);
    let result;
    try {
      result = await agent.run({
        instruction: lastInstruction,
        workDir,
        signal: input.signal || new AbortController().signal,
      });
    } catch (err) {
      result = {
        ok: false,
        failureReason: String(err instanceof Error ? err.message : err),
        summary: '外部能力这次没能完成。',
        producedOutputs: [] as string[],
        rawText: String(err instanceof Error ? err.message : err),
      };
    }
    lastOk = result.ok;
    lastFailureReason = result.failureReason || (result.ok ? '' : result.summary);
    lastOutputs = result.producedOutputs || (result.outputPath ? [result.outputPath] : []);
    lastSummary = result.summary;
    lastPath = result.ok ? result.outputPath : undefined;
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
      ...(result.outputPath && result.ok ? { outputPath: result.outputPath } : {}),
    };
    thread.executions.push(rec);
    executionIds.push(execId);
    return JSON.stringify({
      actualSuccess: result.ok,
      ok: result.ok,
      summary: result.summary.slice(0, 4000),
      ...(lastFailureReason ? { failureReason: lastFailureReason } : {}),
      producedOutputs: lastOutputs,
      ...(result.outputPath && result.ok ? { outputPath: result.outputPath } : {}),
    });
  };

  const pushToolCall = (call: { id: string; name: string; arguments: string }, toolContent: string) => {
    messages.push({
      role: 'assistant',
      content: first.text || '',
      tool_calls: [
        {
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        },
      ],
    });
    messages.push({ role: 'tool', tool_call_id: call.id, content: toolContent });
  };

  for (const call of first.toolCalls) {
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
        pushToolCall(call, JSON.stringify(collabResult));
        continue;
      }
      collabResult = await input.subjectCollab.consult({
        threadId: thread.threadId,
        threadTurns: thread.turns.map((turn) => ({ role: turn.role, text: turn.text })),
        selfContext: input.selfContext,
        now: input.now,
        subjectId: parsed.subjectId,
        goal: parsed.goal || input.userText,
        hopedContribution: parsed.hopedContribution,
        disclosure: parsed.disclosure,
      });
      if (collabResult.exchangeId) exchangeIds.push(collabResult.exchangeId);
      pushToolCall(
        call,
        JSON.stringify({
          actualSuccess: collabResult.ok,
          received: collabResult.received,
          decision: collabResult.decision || '',
          reply: collabResult.reply,
          contribution: collabResult.contribution || '',
          disclosed: collabResult.disclosed,
          ...(collabResult.failureReason ? { failureReason: collabResult.failureReason } : {}),
        }),
      );
      continue;
    }
    if (call.name !== 'delegate') continue;
    didDelegate = true;
    calls += 1;
    const toolContent = await runDelegate(call.arguments);
    pushToolCall(call, toolContent);
  }

  if (collabResult && !didDelegate) {
    const review = await input.chat({
      messages: [
        {
          role: 'system',
          content: [
            '你是 2digime，正在独立验收另一次主体合作的返回。用人话向用户交付，不要展示协议词。',
            collabResult.ok
              ? '对方已真实回应并接受。判断：是否回答了原合作需求、是否可信、是否还缺内容、是否足够用于用户最终目标。'
              : '这次合作没有成立（对方拒绝、不可达或未收到）。判断：自己继续、换主体，或用人话告诉用户。不得把拒绝或未收到说成已经合作成功。',
            '只输出 JSON：{"deliver":true,"userReply":"...","askUser":"","openGoal":"","revision":""}',
            `合作事实（runtime 权威，不得改写）：actualSuccess=${collabResult.ok} received=${collabResult.received} decision=${collabResult.decision || ''}`,
            collabResult.failureReason ? `失败原因：${collabResult.failureReason}` : '',
            `实际披露：${collabResult.disclosed.slice(0, 2000)}`,
            `对方回复：${collabResult.reply}`,
            collabResult.contribution ? `对方贡献：${collabResult.contribution}` : '',
            `用户原话：${input.userText}`,
            `数字之我：\n${input.selfContext}`,
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
    });
    const judged = applyCollabTruth(parseReview(review.text), collabResult);
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

  const review = await input.chat({
    messages: [
      {
        role: 'system',
        content: [
          '你是 2digime，正在独立验收外部能力的返回。不要把 stdout 原样丢给用户。',
          lastOk
            ? '执行已成功。判断：是否满足用户目标、内容是否合格、是否需要修订、如何向用户交付。'
            : '执行已失败。判断：是否可换能力或重试、是否需要用户处理、如何用人话说明。不得宣称任务已完成。',
          '只输出 JSON：{"deliver":true,"userReply":"...","askUser":"","openGoal":"","revision":""}',
          'askUser 仅在数字之我与对话都无法补上、且只有用户知道时填写。',
          'revision 仅在需要外部能力再做一次时填写完整新委托。',
          `执行事实（runtime 权威，不得改写）：actualSuccess=${lastOk}`,
          lastFailureReason ? `失败原因：${lastFailureReason}` : '',
          lastOutputs.length ? `已产生文件：${lastOutputs.join('；')}` : '未产生用户文件',
          `用户原话：${input.userText}`,
          input.thread.openGoal ? `同一件事：${input.thread.openGoal}` : '',
          `数字之我：\n${input.selfContext}`,
          `委托：${lastInstruction}`,
          `能力返回：${lastSummary}`,
        ]
          .filter(Boolean)
          .join('\n'),
      },
    ],
  });
  let judged = applyExecutionTruth(parseReview(review.text), {
    ok: lastOk,
    summary: lastSummary,
    ...(lastFailureReason ? { failureReason: lastFailureReason } : {}),
  });

  if (judged.revision && calls < 2 && input.agents.length) {
    const toolContent = await runDelegate(
      JSON.stringify({ instruction: judged.revision, capabilityId: lastCapability }),
    );
    const second = await input.chat({
      messages: [
        {
          role: 'system',
          content: [
            '你是 2digime，正在再次验收。只输出 JSON：{"deliver":true,"userReply":"...","askUser":"","openGoal":"","revision":""}',
            lastOk ? '' : '执行仍失败时不得宣称任务已完成。',
            `执行事实：actualSuccess=${lastOk}`,
            lastFailureReason ? `失败原因：${lastFailureReason}` : '',
            `用户原话：${input.userText}`,
            `第二次返回：${toolContent}`,
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
    });
    judged = applyExecutionTruth(parseReview(second.text), {
      ok: lastOk,
      summary: lastSummary,
      ...(lastFailureReason ? { failureReason: lastFailureReason } : {}),
    });
  }

  const assistantText = (judged.askUser || judged.userReply).trim();
  const resultPath = lastOk ? lastPath || lastOutputs[0] : undefined;
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
