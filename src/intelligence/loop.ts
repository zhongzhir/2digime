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
  resolveProposedAccessPath,
  runListDirectory,
  runReadFile,
  writeExportedOffice,
} from './mechanical-tools';
import { folderCovers } from '../authorization/filesystem-path';
import type {
  ProfessionalAgent,
  TalkChatFn,
  TalkExecution,
  TalkExpectedEffect,
  TalkThread,
  TalkTurn,
  TalkTurnOutcome,
} from './types';
import type { ConsultResult, PublicSubjectCard } from '../subject-collab/types';
import { formatPublicCardsForModel } from '../subject-collab/public-card';
import {
  deriveTalkOutcome,
  expectedFromExecutions,
  hasObservedMutation,
  unsatisfiedRequiredEffects,
} from './talk-effects';

export const NO_MODEL_NOTICE = '需要先连接 AI 能力，才能继续交流。';

const MAX_TOOL_ROUNDS = 8;
/** 与 Relay complete timeout 对齐；不得把整轮 leftover deadline 当成单次 HTTP 等待。 */
export const TALK_CHAT_TRANSPORT_TIMEOUT_MS = 90_000;
/** 无 execution 时的普通聊天空回复；有 execution 时不得落到用户面（见 TalkService fallback）。 */
export const EMPTY_REPLY = '我在。请再说一次你想让我做什么。';

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

const SET_EXPECTED_EFFECTS_TOOL: ChatToolDefinition = {
  type: 'function',
  function: {
    name: 'set_expected_effects',
    description:
      '记下这次目标完成后应能观察到的结果。改文件用 content_modified 或 file_created；只看不改用 observation。这不是完成任务，只是声明验收标准。真正的创建/修改仍要调用 write_file 或其他已连接能力。',
    parameters: {
      type: 'object',
      properties: {
        effects: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              target: { type: 'string', description: '文件名或相对路径。observation 可省略。' },
              effect: {
                type: 'string',
                description: 'observation | file_created | content_modified',
              },
              expectedState: { type: 'string', description: '完成后应能在文件中看到的关键片段。' },
            },
            required: ['effect'],
          },
        },
      },
      required: ['effects'],
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

const REQUEST_FOLDER_ACCESS_TOOL: ChatToolDefinition = {
  type: 'function',
  function: {
    name: 'request_folder_access',
    description:
      '当任务需要在用户电脑上创建或修改文件、且当前还没有已授权文件夹时，向主人申请一次访问范围。path 可以是 desktop / 桌面、或其下子文件夹、或桌面/文档/下载下的绝对路径。主人确认后才能写盘。不要让主人自己运行命令。',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: '希望访问的文件夹，例如 desktop、desktop/TujimiCodingTest，或桌面下的绝对路径。',
        },
      },
      required: ['path'],
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

function parseFolderAccessArgs(raw: string): { path: string } {
  try {
    const parsed = JSON.parse(raw) as { path?: string; folder?: string };
    return { path: String(parsed.path || parsed.folder || '').trim() };
  } catch {
    return { path: raw.trim() };
  }
}

function parseExpectedEffectsArgs(raw: string): TalkExpectedEffect[] {
  try {
    const parsed = JSON.parse(raw) as { effects?: TalkExpectedEffect[] };
    if (!Array.isArray(parsed.effects)) return [];
    return parsed.effects
      .map((row) => ({
        effect: String(row?.effect || '').trim(),
        ...(row?.target ? { target: String(row.target).trim() } : {}),
        ...(row?.expectedState ? { expectedState: String(row.expectedState).trim() } : {}),
      }))
      .filter((row) => row.effect);
  } catch {
    return [];
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

function chatTransportTimeoutMs(remaining: number): number {
  if (!Number.isFinite(remaining)) return TALK_CHAT_TRANSPORT_TIMEOUT_MS;
  return Math.max(1, Math.min(remaining, TALK_CHAT_TRANSPORT_TIMEOUT_MS));
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
  requestFolderAccess?: (input: { path: string; label: string }) => Promise<boolean>;
  persistFolderGrant?: (folder: string) => Promise<void>;
  refreshAgents?: (contextPaths: string[]) => ProfessionalAgent[];
}): Promise<{ thread: TalkThread; outcome: TalkTurnOutcome }> {
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
  const deniedThisTurn = new Set<string>();
  let agents = input.agents.slice();
  const system = [
    '你是用户的兔机米，也是用户的超级助手。',
    '根据当前数字之我理解用户；不要编造未写入的本人事实。',
    '主人原则上只需表达目标。技术实现、工具选择、能力调度、普通失败恢复由你自行完成；不要把工具交给主人自己操作。',
    '能直接完成的一般事务（写作、总结、分析、简单文件修改等）直接做，不要仅为「看起来专业」而调用外部能力。',
    '需要已连接的专业能力时再 delegate；同一回合可按需连续使用多个工具/能力，每步先看真实结果再决定下一步。',
    '当你已经能够给主人最终答复时，直接给出最终回答，不要继续无意义的工具调用。',
    '普通低风险内部执行自行完成。只有真实涉及资金、隐私或凭证授权、对外发送或发布、删除或不可逆修改、超出现有授权，或只能由主人作出的价值判断时，才请求主人决定。',
    '对可能变化的公开事实，可使用已连接的实时能力核验。',
    '工具返回的是执行事实或证据，不是必须照抄的答案。不要把未真实执行的动作说成已经做成。',
    '需要改动世界时，先用 set_expected_effects 记下完成后应观察到的结果，再动手。只看不改则 effect=observation。工具返回 ok 不等于目标完成；没有所需 effect 证据时不要宣布完成。',
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
    agents.length ? `当前可调用的外部能力：\n${describeProfessionals(agents)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const tools: ChatToolDefinition[] = [SET_EXPECTED_EFFECTS_TOOL, REQUEST_FOLDER_ACCESS_TOOL];
  const ensureFsTools = () => {
    if (!tools.some((item) => item.function.name === 'write_file')) {
      tools.push(WRITE_FILE_TOOL, EXPORT_FILE_TOOL, LIST_DIRECTORY_TOOL);
    }
    if (!tools.some((item) => item.function.name === 'read_file')) {
      tools.push(READ_FILE_TOOL);
    }
  };
  const ensureDelegateTool = () => {
    if (agents.length && !tools.some((item) => item.function.name === 'delegate')) {
      tools.push(DELEGATE_TOOL);
    }
  };
  if (auth.folders.length) ensureFsTools();
  if (auth.folders.length || auth.files.length) {
    if (!tools.some((item) => item.function.name === 'read_file')) tools.push(READ_FILE_TOOL);
  }
  ensureDelegateTool();
  if (cards.length) tools.push(CONSULT_TOOL);

  const chat: TalkChatFn = (req) => {
    const left = remainingMs(input.deadlineAt);
    return input.chat({
      ...req,
      ...(input.signal ? { signal: input.signal } : {}),
      ...(Number.isFinite(left) ? { timeoutMs: chatTransportTimeoutMs(left) } : { timeoutMs: TALK_CHAT_TRANSPORT_TIMEOUT_MS }),
    });
  };

  const messages: ChatMessage[] = [{ role: 'system', content: system }, ...history];
  const first = await chat({ messages, tools });

  const executionIds: string[] = [];
  const exchangeIds: string[] = [];
  let lastPath: string | undefined;
  let lastOk = false;
  let lastEvidenceOnly = false;
  let seq = 0;
  const reads: Array<{ target: string; content: string; seq: number }> = [];
  const mutations: Array<{ target: string; seq: number }> = [];

  const recordExec = (rec: TalkExecution) => {
    thread.executions.push(rec);
    executionIds.push(rec.id);
    input.onExecution?.(rec);
  };

  const runRequestFolderAccess = async (rawArgs: string): Promise<string> => {
    const asked = parseFolderAccessArgs(rawArgs);
    const execId = `run_${randomUUID()}`;
    const fail = (reason: string) => {
      lastOk = false;
      lastEvidenceOnly = false;
      lastPath = undefined;
      recordExec({
        id: execId,
        at: input.now,
        turnId: userTurn.id,
        capabilityId: 'request_folder_access',
        instruction: asked.path,
        ok: false,
        summary: reason,
        failureReason: reason,
      });
      return JSON.stringify({
        actualSuccess: false,
        ok: false,
        capabilityId: 'request_folder_access',
        evidenceOnly: false,
        failureReason: reason,
        producedOutputs: [],
        summary: reason,
      });
    };
    const resolved = resolveProposedAccessPath(asked.path);
    if (!resolved.ok) return fail(resolved.reason);
    const already = auth.folders.some((folder) => folderCovers(folder, resolved.abs));
    if (already) {
      try {
        await fs.mkdir(resolved.abs, { recursive: true });
      } catch (err) {
        return fail(String(err instanceof Error ? err.message : err));
      }
      lastOk = true;
      lastEvidenceOnly = false;
      lastPath = resolved.abs;
      recordExec({
        id: execId,
        at: input.now,
        turnId: userTurn.id,
        capabilityId: 'request_folder_access',
        instruction: asked.path,
        ok: true,
        summary: `已授权 ${resolved.abs}`,
        producedOutputs: [resolved.abs],
        outputPath: resolved.abs,
      });
      return JSON.stringify({
        actualSuccess: true,
        ok: true,
        capabilityId: 'request_folder_access',
        evidenceOnly: false,
        producedOutputs: [resolved.abs],
        outputPath: resolved.abs,
        summary: `已授权可写文件夹：${resolved.abs}。可用 write_file 创建和修改其中的文件；专业代码改动可 delegate 已连接的代码执行能力。不要让主人自己运行命令。`,
      });
    }
    if (deniedThisTurn.has(resolved.abs)) {
      return fail('主人没有允许访问该文件夹。不要让主人自己运行命令或安装开发工具。');
    }
    if (!input.requestFolderAccess) {
      return fail('当前无法向主人确认文件夹访问。不要让主人自己运行命令。');
    }
    let allowed = false;
    try {
      allowed = await input.requestFolderAccess({ path: resolved.abs, label: resolved.label });
    } catch (err) {
      return fail(String(err instanceof Error ? err.message : err));
    }
    if (!allowed) {
      deniedThisTurn.add(resolved.abs);
      return fail('主人没有允许访问该文件夹。不要让主人自己运行命令或安装开发工具。');
    }
    try {
      await fs.mkdir(resolved.abs, { recursive: true });
    } catch (err) {
      return fail(String(err instanceof Error ? err.message : err));
    }
    if (input.persistFolderGrant) {
      try {
        await input.persistFolderGrant(resolved.abs);
      } catch {
        /* 本轮内存授权仍有效；持久化失败不得改口让主人跑命令 */
      }
    }
    if (!auth.folders.some((folder) => folderCovers(folder, resolved.abs))) {
      auth.folders.push(resolved.abs);
    }
    ensureFsTools();
    if (input.refreshAgents) {
      agents = input.refreshAgents([resolved.abs, ...(input.contextPaths || [])]);
      ensureDelegateTool();
    }
    lastOk = true;
    lastEvidenceOnly = false;
    lastPath = resolved.abs;
    recordExec({
      id: execId,
      at: input.now,
      turnId: userTurn.id,
      capabilityId: 'request_folder_access',
      instruction: asked.path,
      ok: true,
      summary: `已授权 ${resolved.abs}`,
      producedOutputs: [resolved.abs],
      outputPath: resolved.abs,
    });
    return JSON.stringify({
      actualSuccess: true,
      ok: true,
      capabilityId: 'request_folder_access',
      evidenceOnly: false,
      producedOutputs: [resolved.abs],
      outputPath: resolved.abs,
      summary: `已授权可写文件夹：${resolved.abs}。可用 write_file 创建和修改其中的文件；专业代码改动可 delegate 已连接的代码执行能力。不要让主人自己运行命令。`,
    });
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
    let existed = false;
    try {
      const before = await fs.stat(resolved.abs);
      existed = before.isFile();
    } catch {
      existed = false;
    }
    try {
      await fs.mkdir(path.dirname(resolved.abs), { recursive: true });
      await fs.writeFile(resolved.abs, parsed.content, 'utf8');
      const st = await fs.stat(resolved.abs);
      if (!st.isFile() || st.size <= 0) return fail('写入后文件不存在或为空。');
      lastOk = true;
      lastEvidenceOnly = false;
      lastPath = resolved.abs;
      seq += 1;
      mutations.push({ target: resolved.abs, seq });
      const kind = existed ? 'content_modified' : 'file_created';
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
        observedEffect: { kind, target: resolved.abs, mutated: true },
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
    seq += 1;
    mutations.push({ target: written.abs, seq });
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
      observedEffect: { kind: 'file_created', target: written.abs, mutated: true },
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
      ? agents.find((item) => item.id === requested)
      : agents.length === 1
        ? agents[0]
        : undefined;
    if (!agent) {
      const failureReason = requested
        ? `没有名为 ${requested} 的已连接能力。`
        : `未指定 capabilityId。当前已连接：${agents.map((item) => item.id).join('、') || '无'}。请选择其中一个。`;
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
    if (lastPath) {
      seq += 1;
      mutations.push({ target: lastPath, seq });
    }
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
      ...(result.ok && lastPath
        ? { observedEffect: { kind: 'content_modified', target: lastPath, mutated: true } }
        : {}),
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
    if (call.name === 'set_expected_effects') {
      const effects = parseExpectedEffectsArgs(call.arguments);
      const execId = `run_${randomUUID()}`;
      const ok = effects.length > 0;
      recordExec({
        id: execId,
        at: input.now,
        turnId: userTurn.id,
        capabilityId: 'set_expected_effects',
        instruction: input.userText,
        ok,
        summary: ok
          ? `expected: ${effects.map((row) => row.effect).join(', ')}`
          : 'expected effects 为空',
        ...(ok ? { safeDetail: JSON.stringify({ effects }) } : { failureReason: 'expected effects 为空' }),
      });
      return JSON.stringify({
        actualSuccess: ok,
        ok,
        capabilityId: 'set_expected_effects',
        effects,
        summary: ok ? '已记录 expected effects。请继续执行，不要把这一步当成任务完成。' : 'effects 不能为空。',
      });
    }
    if (call.name === 'request_folder_access') return runRequestFolderAccess(call.arguments);
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
        ...(parsed.actualSuccess === true ? { observedEffect: { kind: 'directory_listed', mutated: false } } : {}),
      });
      return payload;
    }
    if (call.name === 'read_file') {
      const payload = await runReadFile(auth, call.arguments);
      let parsed: { actualSuccess?: boolean; failureReason?: string; path?: string; content?: string } = {};
      try {
        parsed = JSON.parse(payload) as typeof parsed;
      } catch {
        parsed = {};
      }
      if (parsed.actualSuccess === true && parsed.path) {
        seq += 1;
        let content = String(parsed.content || '');
        try {
          content = await fs.readFile(parsed.path, 'utf8');
        } catch {
          /* 验证用正文读盘失败时退回工具返回 */
        }
        reads.push({ target: parsed.path, content, seq });
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
        ...(parsed.actualSuccess === true && parsed.path
          ? { outputPath: parsed.path, observedEffect: { kind: 'file_read', target: parsed.path, mutated: false } }
          : {}),
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
  const drainTools = async () => {
    if (!current.toolCalls?.length) return;
    await appendToolRound(current);
    toolRounds += 1;
    throwIfAborted(input.signal);
    current = await chat({ messages, tools });
    while (current.toolCalls?.length && toolRounds < MAX_TOOL_ROUNDS) {
      throwIfAborted(input.signal);
      await appendToolRound(current);
      toolRounds += 1;
      throwIfAborted(input.signal);
      current = await chat({ messages, tools });
      if (!current.toolCalls?.length) break;
    }
    if (current.toolCalls?.length) {
      throwIfAborted(input.signal);
      await appendToolRound(current);
      throwIfAborted(input.signal);
      current = await chat({ messages, tools });
    }
  };
  await drainTools();

  const MAX_NUDGES = 2;
  let nudges = 0;
  while (nudges < MAX_NUDGES && toolRounds < MAX_TOOL_ROUNDS) {
    const turnExecs = thread.executions.filter((item) => executionIds.includes(item.id));
    const expected = expectedFromExecutions(turnExecs);
    const reason = unsatisfiedRequiredEffects(expected, turnExecs, reads, mutations);
    if (!reason) break;
    nudges += 1;
    messages.push({
      role: 'system',
      content: `机械事实：${reason} 继续使用已有能力完成目标，不要宣布成功。`,
    });
    throwIfAborted(input.signal);
    current = await chat({ messages, tools });
    await drainTools();
  }

  const turnExecs = thread.executions.filter((item) => executionIds.includes(item.id));
  const expected = expectedFromExecutions(turnExecs);
  const stillOpen = Boolean(unsatisfiedRequiredEffects(expected, turnExecs, reads, mutations));
  const outcome = deriveTalkOutcome({ execs: turnExecs, expected, stillOpen });
  const openReason = unsatisfiedRequiredEffects(expected, turnExecs, reads, mutations);

  // 无 toolCalls 即为模型 final assistant response；下方落 Thread，由 service writeThread → renderer。
  let assistantText = deliverText(current.text);
  if (stillOpen && !hasObservedMutation(turnExecs) && openReason) {
    assistantText = openReason;
  }
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
  return { thread, outcome };
}
