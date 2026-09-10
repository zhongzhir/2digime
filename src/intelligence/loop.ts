import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { ChatMessage, ChatToolCall, ChatToolDefinition } from '../infrastructure/model-http';
import { describeProfessionals } from './professionals';
import {
  EXPORT_FILE_TOOL,
  LIST_DIRECTORY_TOOL,
  MAX_WRITE_BYTES,
  READ_FILE_TOOL,
  classifyAuthorizedPaths,
  describeAuthorizedFs,
  parseExportArgs,
  resolveAuthorizedWritePath,
  runListDirectory,
  runReadFile,
  writeExportedOffice,
} from './mechanical-tools';
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

const MAX_TOOL_ROUNDS = 8;
const EMPTY_REPLY = '我在。请再说一次你想让我做什么。';

const DELEGATE_TOOL: ChatToolDefinition = {
  type: 'function',
  function: {
    name: 'delegate',
    description:
      '调用一个已连接的外部能力。必须填写 capabilityId。返回的是执行事实或检索证据，不是给用户的最终答案。',
    parameters: {
      type: 'object',
      properties: {
        instruction: {
          type: 'string',
          description: '给该能力的完整任务说明。',
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

const WRITE_FILE_TOOL: ChatToolDefinition = {
  type: 'function',
  function: {
    name: 'write_file',
    description:
      '把完整文件内容写入本次已授权文件夹。relativePath 相对授权根。多个授权根时必须填写 root，且必须是系统列出的某一个绝对路径。只写盘并返回文件是否真实存在。',
    parameters: {
      type: 'object',
      properties: {
        relativePath: {
          type: 'string',
          description: '相对授权根的文件路径，例如 index.html 或 README.md。',
        },
        content: {
          type: 'string',
          description: '完整文件内容。',
        },
        root: {
          type: 'string',
          description: '授权可写根目录的绝对路径。仅当有多个授权文件夹时需要。',
        },
      },
      required: ['relativePath', 'content'],
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
        subjectId: { type: 'string', description: '可发现主体列表中的 subjectId。' },
        goal: { type: 'string', description: '希望共同完成什么。' },
        hopedContribution: { type: 'string', description: '希望对方贡献什么。' },
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

function parseWriteArgs(raw: string): { relativePath: string; content: string; root?: string } {
  try {
    const parsed = JSON.parse(raw) as { relativePath?: string; content?: string; path?: string; root?: string };
    const root = String(parsed.root || '').trim();
    return {
      relativePath: String(parsed.relativePath || parsed.path || '').trim(),
      content: String(parsed.content ?? ''),
      ...(root ? { root } : {}),
    };
  } catch {
    return { relativePath: '', content: '' };
  }
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

function isInternalToolPayload(text: string): boolean {
  const trimmed = String(text || '').trim();
  if (!trimmed.startsWith('{')) return false;
  try {
    const parsed = JSON.parse(trimmed) as { actualSuccess?: unknown };
    return !!parsed && typeof parsed === 'object' && 'actualSuccess' in parsed;
  } catch {
    return false;
  }
}

function deliverText(text: string): string {
  const t = String(text || '').trim();
  if (!t || isInternalToolPayload(t)) return EMPTY_REPLY;
  return t;
}

function remainingMs(deadlineAt?: number): number {
  if (!deadlineAt || !Number.isFinite(deadlineAt)) return Number.POSITIVE_INFINITY;
  return deadlineAt - Date.now();
}

function callTimeoutMs(remaining: number): number {
  if (!Number.isFinite(remaining)) return Number.POSITIVE_INFINITY;
  return Math.max(1, remaining);
}

function bindCallSignal(parent: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const ac = new AbortController();
  const timer =
    Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => ac.abort(), timeoutMs)
      : undefined;
  const onParent = () => ac.abort();
  if (parent) {
    if (parent.aborted) ac.abort();
    else parent.addEventListener('abort', onParent, { once: true });
  }
  return {
    signal: ac.signal,
    dispose: () => {
      if (timer) clearTimeout(timer);
      if (parent) parent.removeEventListener('abort', onParent);
    },
  };
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
  deadlineAt?: number;
  subjectCollab?: SubjectCollabPort;
  confirmHint?: string;
  contextPaths?: string[];
  /** 工具一旦完成就把执行事实交给本轮 service；不是 workflow / retry 状态。 */
  onExecution?: (rec: TalkExecution) => void;
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
    executions: [...(input.thread.executions || [])],
  };
  delete thread.openGoal;

  const history: ChatMessage[] = [];
  for (const turn of thread.turns) {
    history.push({
      role: turn.role === 'assistant' ? 'assistant' : 'user',
      content: turn.text,
    });
  }

  const cards = input.subjectCollab?.cards || [];
  const auth = classifyAuthorizedPaths(input.contextPaths);
  const system = [
    '你是用户的兔机米。',
    '根据当前数字之我理解用户；不要编造未写入的本人事实。',
    '对可能变化的公开事实，可使用已连接的实时能力核验。',
    '工具返回的是执行事实或证据，不是必须照抄的答案。不要把未真实执行的动作说成已经做成。',
    '不要问用户选择 Agent、任务类型、workflow、协作者或协议。',
    input.confirmHint
      ? `有一件关于用户本人的理解需要用户亲自确认：${input.confirmHint}。用普通人语言问一句，不要提内部机制。`
      : '',
    cards.length
      ? [
          '当前可发现的其他主体（公开协作声明，不是对方 Digital Self）：',
          formatPublicCardsForModel(cards),
          '若确实需要合作，根据公开声明选择合适主体并调用 consult_subject。发给对方的 disclosure 必须是本次必要的最小上下文。',
        ].join('\n')
      : '',
    '当前对用户的必要理解：',
    input.selfContext,
    describeAuthorizedFs(auth),
    input.agents.length ? `当前可调用的外部能力：\n${describeProfessionals(input.agents)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const tools: ChatToolDefinition[] = [];
  if (auth.folders.length) {
    tools.push(WRITE_FILE_TOOL, EXPORT_FILE_TOOL, LIST_DIRECTORY_TOOL);
  }
  if (auth.folders.length || auth.files.length) tools.push(READ_FILE_TOOL);
  if (input.agents.length) tools.push(DELEGATE_TOOL);
  if (cards.length) tools.push(CONSULT_TOOL);

  const chat: TalkChatFn = (req) => {
    const left = remainingMs(input.deadlineAt);
    return input.chat({
      ...req,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(Number.isFinite(left) ? { timeoutMs: Math.max(1, left) } : {}),
    });
  };

  const messages: ChatMessage[] = [{ role: 'system', content: system }, ...history];
  const first = await chat({ messages, tools });

  const executionIds: string[] = [];
  const exchangeIds: string[] = [];
  let lastPath: string | undefined;
  let lastOk = false;
  let lastEvidenceOnly = false;

  const recordExec = (rec: TalkExecution) => {
    thread.executions.push(rec);
    executionIds.push(rec.id);
    input.onExecution?.(rec);
  };

  const runWriteFile = async (rawArgs: string): Promise<string> => {
    const parsed = parseWriteArgs(rawArgs);
    const execId = `run_${randomUUID()}`;
    const resolved = resolveAuthorizedWritePath(auth, parsed.relativePath, parsed.root);
    const fail = (reason: string) => {
      lastOk = false;
      lastEvidenceOnly = false;
      lastPath = undefined;
      recordExec({
        id: execId,
        at: input.now,
        turnId: userTurn.id,
        capabilityId: 'write_file',
        instruction: parsed.relativePath,
        ok: false,
        summary: reason,
        failureReason: reason,
      });
      return JSON.stringify({
        actualSuccess: false,
        ok: false,
        capabilityId: 'write_file',
        evidenceOnly: false,
        failureReason: reason,
        producedOutputs: [],
        summary: reason,
      });
    };
    if (!resolved.ok) return fail(resolved.reason);
    const bytes = Buffer.byteLength(parsed.content, 'utf8');
    if (bytes > MAX_WRITE_BYTES) return fail(`文件超过 ${MAX_WRITE_BYTES} 字节上限。`);
    try {
      await fs.mkdir(path.dirname(resolved.abs), { recursive: true });
      await fs.writeFile(resolved.abs, parsed.content, 'utf8');
      const st = await fs.stat(resolved.abs);
      if (!st.isFile() || st.size <= 0) return fail('写入后文件不存在或为空。');
      lastOk = true;
      lastEvidenceOnly = false;
      lastPath = resolved.abs;
      recordExec({
        id: execId,
        at: input.now,
        turnId: userTurn.id,
        capabilityId: 'write_file',
        instruction: parsed.relativePath,
        ok: true,
        summary: `已写入 ${resolved.abs}`,
        producedOutputs: [resolved.abs],
        outputPath: resolved.abs,
      });
      return JSON.stringify({
        actualSuccess: true,
        ok: true,
        capabilityId: 'write_file',
        evidenceOnly: false,
        producedOutputs: [resolved.abs],
        outputPath: resolved.abs,
        summary: `已写入 ${resolved.abs}`,
      });
    } catch (err) {
      return fail(String(err instanceof Error ? err.message : err));
    }
  };

  const runExportFile = async (rawArgs: string): Promise<string> => {
    const parsed = parseExportArgs(rawArgs);
    const execId = `run_${randomUUID()}`;
    const fail = (reason: string) => {
      lastOk = false;
      lastEvidenceOnly = false;
      lastPath = undefined;
      recordExec({
        id: execId,
        at: input.now,
        turnId: userTurn.id,
        capabilityId: 'export_file',
        instruction: `${parsed.format}:${parsed.relativePath}`,
        ok: false,
        summary: reason,
        failureReason: reason,
      });
      return JSON.stringify({
        actualSuccess: false,
        ok: false,
        capabilityId: 'export_file',
        evidenceOnly: false,
        failureReason: reason,
        producedOutputs: [],
        summary: reason,
      });
    };
    const dest = resolveAuthorizedWritePath(auth, parsed.relativePath, parsed.root);
    if (!dest.ok) return fail(dest.reason);
    const written = await writeExportedOffice({
      writeRoot: dest.root,
      relativePath: parsed.relativePath,
      format: parsed.format,
      content: parsed.content,
    });
    if (!written.ok) return fail(written.reason);
    lastOk = true;
    lastEvidenceOnly = false;
    lastPath = written.abs;
    recordExec({
      id: execId,
      at: input.now,
      turnId: userTurn.id,
      capabilityId: 'export_file',
      instruction: `${parsed.format}:${parsed.relativePath}`,
      ok: true,
      summary: `已导出 ${written.abs}`,
      producedOutputs: [written.abs],
      outputPath: written.abs,
    });
    return JSON.stringify({
      actualSuccess: true,
      ok: true,
      capabilityId: 'export_file',
      evidenceOnly: false,
      format: parsed.format,
      producedOutputs: [written.abs],
      outputPath: written.abs,
      summary: `已导出 ${written.abs}`,
    });
  };

  const runDelegate = async (rawArgs: string): Promise<string> => {
    const parsed = parseArgs(rawArgs);
    const requested = parsed.capabilityId;
    const agent = requested
      ? input.agents.find((item) => item.id === requested)
      : input.agents.length === 1
        ? input.agents[0]
        : undefined;
    if (!agent) {
      const failureReason = requested
        ? `没有名为 ${requested} 的已连接能力。`
        : `未指定 capabilityId。当前已连接：${input.agents.map((item) => item.id).join('、') || '无'}。请选择其中一个。`;
      lastOk = false;
      lastEvidenceOnly = false;
      lastPath = undefined;
      return JSON.stringify({
        actualSuccess: false,
        ok: false,
        capabilityId: requested || '',
        evidenceOnly: false,
        failureReason,
        producedOutputs: [],
        summary: failureReason,
      });
    }
    const instruction = parsed.instruction || input.userText;
    const execId = `run_${randomUUID()}`;
    const workDir = path.join(input.workRoot, 'intelligence', 'runs', execId);
    const remaining = remainingMs(input.deadlineAt);
    const returnsEvidence = agent.returnsEvidence === true;
    let result: Awaited<ReturnType<ProfessionalAgent['run']>>;
    if (Number.isFinite(remaining) && remaining <= 0) {
      result = {
        ok: false,
        failureReason: '已到时限。',
        summary: '已到时限。',
        producedOutputs: [],
        ...(returnsEvidence ? { evidenceOnly: true } : {}),
      };
    } else {
      const callMs = callTimeoutMs(remaining);
      const bound = bindCallSignal(input.signal, callMs);
      try {
        throwIfAborted(input.signal);
        result = await Promise.race([
          agent.run({ instruction, workDir, signal: bound.signal }),
          waitForAbort(bound.signal),
        ]);
      } catch (err) {
        if (input.signal?.aborted) throw err;
        if (isAbortLike(err) || bound.signal.aborted) {
          result = {
            ok: false,
            failureReason: `这次调用在 ${callMs}ms 内没有返回。`,
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
    const evidenceOnly = result.evidenceOnly === true || returnsEvidence;
    const outputs = evidenceOnly
      ? []
      : result.producedOutputs || (result.outputPath ? [result.outputPath] : []);
    const failureReason = result.failureReason || (result.ok ? '' : result.summary);
    lastOk = result.ok;
    lastEvidenceOnly = evidenceOnly;
    lastPath = result.ok && !evidenceOnly ? result.outputPath || outputs[0] : undefined;
    recordExec({
      id: execId,
      at: input.now,
      turnId: userTurn.id,
      capabilityId: agent.id,
      instruction,
      ok: result.ok,
      summary: result.summary,
      ...(failureReason ? { failureReason } : {}),
      ...(result.safeDetail ? { safeDetail: result.safeDetail } : {}),
      ...(outputs.length ? { producedOutputs: outputs } : {}),
      ...(lastPath ? { outputPath: lastPath } : {}),
    });
    return JSON.stringify({
      actualSuccess: result.ok,
      ok: result.ok,
      capabilityId: agent.id,
      evidenceOnly,
      summary: result.summary.slice(0, 4000),
      ...(failureReason ? { failureReason } : {}),
      producedOutputs: outputs,
      ...(lastPath ? { outputPath: lastPath } : {}),
    });
  };

  type ModelToolCall = { id: string; name: string; arguments: string };

  const runOneTool = async (call: ModelToolCall): Promise<string> => {
    throwIfAborted(input.signal);
    if (call.name === 'write_file') return runWriteFile(call.arguments);
    if (call.name === 'export_file') return runExportFile(call.arguments);
    if (call.name === 'list_directory') {
      const payload = await runListDirectory(auth, call.arguments);
      let parsed: { actualSuccess?: boolean; failureReason?: string; entries?: unknown[] } = {};
      try {
        parsed = JSON.parse(payload) as typeof parsed;
      } catch {
        parsed = {};
      }
      recordExec({
        id: `run_${randomUUID()}`,
        at: input.now,
        turnId: userTurn.id,
        capabilityId: 'list_directory',
        instruction: call.arguments,
        ok: parsed.actualSuccess === true,
        summary:
          parsed.actualSuccess === true
            ? `列出 ${Array.isArray(parsed.entries) ? parsed.entries.length : 0} 项`
            : parsed.failureReason || '列出失败',
        ...(parsed.failureReason ? { failureReason: parsed.failureReason } : {}),
      });
      return payload;
    }
    if (call.name === 'read_file') {
      const payload = await runReadFile(auth, call.arguments);
      let parsed: { actualSuccess?: boolean; failureReason?: string; path?: string } = {};
      try {
        parsed = JSON.parse(payload) as typeof parsed;
      } catch {
        parsed = {};
      }
      recordExec({
        id: `run_${randomUUID()}`,
        at: input.now,
        turnId: userTurn.id,
        capabilityId: 'read_file',
        instruction: parsed.path || call.arguments,
        ok: parsed.actualSuccess === true,
        summary: parsed.actualSuccess === true ? `已读取 ${parsed.path || ''}` : parsed.failureReason || '读取失败',
        ...(parsed.failureReason ? { failureReason: parsed.failureReason } : {}),
      });
      return payload;
    }
    if (call.name === 'consult_subject') {
      const parsed = parseConsultArgs(call.arguments);
      if (!input.subjectCollab) {
        return JSON.stringify({
          actualSuccess: false,
          received: false,
          failureReason: '当前没有可联系的其他主体。',
          reply: '当前没有可联系的其他主体。',
        });
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
      const collabResult = input.signal
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
    if (call.name === 'delegate') return runDelegate(call.arguments);
    return JSON.stringify({
      actualSuccess: false,
      ok: false,
      failureReason: '当前没有这个外部能力。',
      summary: '当前没有这个外部能力。',
    });
  };

  const appendToolRound = async (response: {
    text?: string;
    toolCalls?: ModelToolCall[];
  }): Promise<void> => {
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

  let current = first;
  let toolRounds = 0;
  if (first.toolCalls?.length) {
    await appendToolRound(first);
    toolRounds = 1;
    current = await chat({ messages, tools });
    while (current.toolCalls?.length && toolRounds < MAX_TOOL_ROUNDS) {
      throwIfAborted(input.signal);
      await appendToolRound(current);
      toolRounds += 1;
      current = await chat({ messages, tools });
    }
    if (current.toolCalls?.length) {
      throwIfAborted(input.signal);
      await appendToolRound(current);
      current = await chat({ messages, tools });
    }
  }

  const assistantText = deliverText(current.text);
  const resultPath = lastOk && !lastEvidenceOnly ? lastPath : undefined;
  thread.turns.push({
    id: `turn_${randomUUID()}`,
    at: input.now,
    role: 'assistant',
    text: assistantText,
    ...(executionIds.length ? { executionIds } : {}),
    ...(exchangeIds.length ? { exchangeIds } : {}),
    ...(resultPath ? { result: { title: path.basename(resultPath), path: resultPath } } : {}),
  });
  return thread;
}
