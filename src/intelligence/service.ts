import { statSync } from 'node:fs';
import * as path from 'node:path';
import { extractFile } from '../infrastructure/extract';
import { nowIso } from '../shared/ids';
import { readDigitalSelf } from '../subject-core/digital-self/store';
import {
  listConversationSessionsSync,
  touchConversationSessionSync,
} from '../subject-core/conversation-sessions';
import { formatSelfContext, selectSelfContext } from './self-context';
import { emptyThread, readThread, writeThread } from './store';
import { randomUUID } from 'node:crypto';
import { EMPTY_REPLY, NO_MODEL_NOTICE, runTalkTurn, type SubjectCollabPort } from './loop';
import { isManagedAiUserNotice } from '../capability/managed-ai-client';
import type { ProfessionalAgent, TalkChatFn, TalkExecution, TalkTurnOutcome, TalkView, TalkThread } from './types';
import { listContentPreferences, formatPreferenceDirectives } from '../subject-comm/content-preferences';
import {
  listActiveFilesystemGrantFolders,
  saveFilesystemGrant,
} from '../authorization/filesystem-grant';
import { hasObservedMutation } from './talk-effects';

/** 做事（含首次获取代码执行能力）需要数分钟；180s 会在 runtime 仍工作时掐断。 */
export const TALK_TURN_DEADLINE_MS = 600_000;
export const TALK_TIMEOUT_NOTICE = '请求超时，模型在限定时间内没有返回。可重试。';
/** 最终模型说明失败时的附加句；不得单独冒充「任务失败」。 */
export const TALK_SYNTHESIS_TIMEOUT_NOTICE = '详细说明生成超时。';
export const TALK_EXECUTION_DONE_NOTICE = '已完成。相关修改已经写入你授权的项目。';
const MUTATING_CAPS = new Set(['write_file', 'export_file']);

export class TalkTimeoutError extends Error {
  readonly kind = 'timeout';
  constructor() {
    super(TALK_TIMEOUT_NOTICE);
    this.name = 'TalkTimeoutError';
  }
}

export function talkTurnDeadlineMs(): number {
  const raw = process.env.DIGITALME_V2_TALK_TURN_DEADLINE_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : TALK_TURN_DEADLINE_MS;
}

export function isTalkCancelled(err: unknown): boolean {
  return err instanceof Error && err.name === 'TalkCancelled';
}

function isTalkTimeout(err: unknown): boolean {
  if (isTalkCancelled(err)) return false;
  if (err instanceof TalkTimeoutError) return true;
  if (!(err instanceof Error)) return false;
  if (err.name === 'TalkTimeoutError') return true;
  const kind = (err as { kind?: string }).kind;
  if (err.name === 'ModelHttpError' && kind === 'timeout') return true;
  return /timeout after\s+\d+ms|请求超时|TalkTimeout/i.test(err.message);
}

function errorFromAbort(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error) return reason;
  return new TalkTimeoutError();
}

const turnSignals: AbortSignal[] = [];

/** 当前正在执行的对话回合信号。授权等待用它结束，避免原生对话框把下一次发送卡住。 */
export function currentTalkTurnSignal(): AbortSignal | null {
  return turnSignals[turnSignals.length - 1] || null;
}

function wrapChatWithDeadline(chat: TalkChatFn, signal: AbortSignal): TalkChatFn {
  return async (input) => {
    if (signal.aborted) throw errorFromAbort(signal);
    return await new Promise((resolve, reject) => {
      const onAbort = () => reject(errorFromAbort(signal));
      signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve(chat({ ...input, signal })).then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (err) => {
          signal.removeEventListener('abort', onAbort);
          if (signal.aborted) reject(errorFromAbort(signal));
          else reject(err);
        },
      );
    });
  };
}

export interface TalkPackageRef {
  rootDir: string;
  subjectId: string;
}

export type TalkLearnResult = {
  asked: boolean;
  askHint?: string;
};

export class TalkService {
  /** 按会话串行写 Thread；不同会话互不阻塞，便于长 Doing 时切去其它对话。 */
  private readonly writeChains = new Map<string, Promise<void>>();

  constructor(
    private readonly resolvePackage: () => TalkPackageRef | null,
    private readonly chat: TalkChatFn | null,
    private readonly resolveAgents: (
      pkg: TalkPackageRef,
      turn?: { contextPaths?: string[] },
    ) => ProfessionalAgent[],
    private readonly now: () => string = nowIso,
    private readonly resolveCollab?: (pkg: TalkPackageRef) => Promise<SubjectCollabPort | null>,
    private readonly learnFromUtterance?: (text: string) => Promise<TalkLearnResult>,
    private readonly resolveContentSeek?: (pkg: TalkPackageRef, query: string) => Promise<string>,
    private readonly requestFolderAccess?: (input: { path: string; label: string }) => Promise<boolean>,
    private readonly resolveWebSearch?: () =>
      | ((query: string) => Promise<Array<{ title: string; url: string; snippet?: string }>>)
      | undefined,
    private readonly resolveNewsSearch?: () =>
      | ((query: string) => Promise<
          Array<{
            title: string;
            url: string;
            snippet?: string;
            publisherName?: string;
            publisherUrl?: string;
            publishedAt?: string;
            fetchedAt?: string;
            bodyRead?: boolean;
          }>
        >)
      | undefined,
  ) {}

  /** 与回合写入使用同一串行链，撤销不能被在途回合的迟到保存覆盖。 */
  async revokeDiscoveryGoal(threadId: string): Promise<void> {
    const prev = this.writeChains.get(threadId) || Promise.resolve();
    const run = prev.then(async () => {
      const pkg = this.resolvePackage();
      if (!pkg) return;
      const thread = await readThread(pkg.rootDir, this.now(), threadId);
      delete thread.discoveryGoal;
      thread.turns.push({ id: `turn_${randomUUID()}`, at: this.now(), role: 'user',
        text: '我撤销了从发现带入的当前目标。后续不要自动沿用它的条件；已有材料和成果仍保留。' });
      await writeThread(pkg.rootDir, thread);
    });
    this.writeChains.set(threadId, run.catch(() => undefined));
    await run;
  }

  async invoke(
    input: { text?: string; contextPaths?: string[]; discoveryGoal?: TalkThread['discoveryGoal'] },
    externalSignal?: AbortSignal | null,
  ): Promise<{ view: TalkView }> {
    const pkg = this.resolvePackage();
    if (!pkg) {
      return { view: projectView(emptyThread(this.now()), '还没有可用的数字之我。') };
    }
    const threadId = listConversationSessionsSync(pkg.rootDir).currentId;
    const prev = this.writeChains.get(threadId) || Promise.resolve();
    const run = prev.then(() => this.invokeNow(input, threadId, externalSignal));
    this.writeChains.set(
      threadId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  private async invokeNow(
    input: { text?: string; contextPaths?: string[]; discoveryGoal?: TalkThread['discoveryGoal'] },
    threadId: string,
    externalSignal?: AbortSignal | null,
  ): Promise<{ view: TalkView }> {
    const pkg = this.resolvePackage();
    if (!pkg) {
      return { view: projectView(emptyThread(this.now()), '还没有可用的数字之我。') };
    }
    const now = this.now();
    const thread = await readThread(pkg.rootDir, now, threadId);
    if (input.discoveryGoal) thread.discoveryGoal = input.discoveryGoal;
    const spoken = String(input.text || '').trim();
    const text = composeTalkUserText(spoken, input.contextPaths);
    if (!text) {
      return { view: projectView(thread) };
    }
    if (spoken) {
      try {
        touchConversationSessionSync(pkg.rootDir, { titleFromUserText: spoken });
      } catch {
        /* 会话标题失败不得阻断 Talk */
      }
    }
    if (!this.chat) {
      return { view: projectView(thread, NO_MODEL_NOTICE) };
    }
    let confirmHint: string | undefined;
    // DIGITAL_SELF_LEARNING_BLOCKS_TALK = YES
    // 每个 Talk turn 在真正 Talk 前同步调用 Digital Self interpret。本轮不改成异步。
    if (spoken && this.learnFromUtterance && !thread.discoveryGoal) {
      try {
        const learned = await this.learnFromUtterance(spoken);
        if (learned.asked && learned.askHint) confirmHint = learned.askHint;
      } catch {
        /* 学习失败不得阻断交流 */
      }
    }
    let selfContext = '当前还没有已写入的数字之我认识。读取失败不得假装了解用户。';
    try {
      const self = await readDigitalSelf(pkg.rootDir, pkg.subjectId, now);
      selfContext = formatSelfContext(selectSelfContext(self, text));
    } catch {
      selfContext = '读取数字之我失败。不得解释为不了解用户，也不要编造本人事实。';
    }
    const attachedNow = (input.contextPaths || []).map((item) => String(item || '').trim()).filter(isExistingFile);
    thread.materialPaths = [...new Set([...(thread.materialPaths || []), ...attachedNow])];
    const materialBlock = await attachedMaterialBlock(thread.materialPaths);
    if (materialBlock) selfContext = `${selfContext}\n\n${materialBlock}`;
    const directives = await listContentPreferences(pkg.rootDir);
    const explicit = directives.filter((row) => row.kind !== 'steer');
    if (explicit.length) selfContext += `\n\n用户显式内容边界（跨入口有效；单条 reduce 只指该对象，不能扩大为主题禁令）：\n${formatPreferenceDirectives(explicit)}\n目标引用：${JSON.stringify(explicit.map(({kind,targetType,target}) => ({kind,targetType,target})))}`;
    if (spoken && this.resolveContentSeek) {
      try {
        const block = await this.resolveContentSeek(pkg, spoken);
        if (block.trim()) {
          selfContext = `${selfContext}\n\n内容目录候选（保留原文链接）：\n${block}`;
        }
      } catch {
        /* 目录检索失败不得阻断交流 */
      }
    }
    const collab = this.resolveCollab ? await this.resolveCollab(pkg) : null;
    const grantedFolders = await listActiveFilesystemGrantFolders(pkg.rootDir);
    const contextPaths = [
      ...new Set(
        [...(input.contextPaths || []), ...(thread.materialPaths || [])]
          .map((item) => String(item || '').trim())
          .filter(Boolean),
      ),
    ];
    const writeFolders = [...new Set(grantedFolders.map((item) => String(item || '').trim()).filter(Boolean))];
    const turnCtx = contextPaths.length ? { contextPaths } : {};
    const ac = new AbortController();
    const timer = setTimeout(() => {
      if (!ac.signal.aborted) ac.abort(new TalkTimeoutError());
    }, talkTurnDeadlineMs());
    const onExternal = () => {
      if (ac.signal.aborted) return;
      const reason = externalSignal?.reason;
      ac.abort(reason instanceof Error ? reason : Object.assign(new Error('已取消。'), { name: 'TalkCancelled' }));
    };
    if (externalSignal) {
      if (externalSignal.aborted) onExternal();
      else externalSignal.addEventListener('abort', onExternal, { once: true });
    }
    turnSignals.push(ac.signal);
    const boundedChat = wrapChatWithDeadline(this.chat, ac.signal);
    const turnExecutions: TalkExecution[] = [];
    let next = thread;
    let timeoutNotice: string | undefined;
    let outcome: TalkTurnOutcome = 'SUCCESS';
    try {
      const ran = await runTalkTurn({
        thread,
        userText: text,
        selfContext,
        agents: this.resolveAgents(pkg, turnCtx),
        chat: boundedChat,
        workRoot: pkg.rootDir,
        now,
        signal: ac.signal,
        deadlineAt: Date.now() + talkTurnDeadlineMs(),
        onExecution: (rec) => {
          turnExecutions.push(rec);
        },
        ...(contextPaths.length ? { contextPaths } : {}),
        ...(writeFolders.length ? { writeFolders } : {}),
        ...(collab ? { subjectCollab: collab } : {}),
        ...(confirmHint ? { confirmHint } : {}),
        ...(this.requestFolderAccess ? { requestFolderAccess: this.requestFolderAccess } : {}),
        persistFolderGrant: (folder) =>
          saveFilesystemGrant({
            packageRoot: pkg.rootDir,
            subjectId: pkg.subjectId,
            folder,
            now,
          }).then(() => undefined),
        refreshAgents: (paths) => this.resolveAgents(pkg, { contextPaths: paths }),
        ...(this.resolveWebSearch
          ? {
              searchWeb: async (query: string) => {
                const search = this.resolveWebSearch?.();
                if (!search) throw new Error('搜索还没有接上');
                return search(query);
              },
            }
          : {}),
        ...(this.resolveNewsSearch
          ? {
              newsSearch: async (query: string) => {
                const search = this.resolveNewsSearch?.();
                if (!search) throw new Error('新闻来源还没有接上');
                return search(query);
              },
            }
          : {}),
      });
      next = ran.thread;
      outcome = ran.outcome;
      // 模型最终回复为空或整段内部 execution JSON 时，deliverText 会变成 EMPTY_REPLY。
      // 本轮已有 execution 则不得把 EMPTY_REPLY 交给用户；复用 execution 机械事实。
      applyUndeliverableFinalFallback(next, turnExecutions);
      if (turnExecutions.length) {
        const last = next.turns[next.turns.length - 1];
        if (last?.role === 'assistant' && last.text !== EMPTY_REPLY) {
          const fromExec = assistantFromTurnExecutions(turnExecutions, 'undeliverable_final');
          if (last.text === fromExec.text) outcome = fromExec.outcome;
        }
      }
    } catch (err) {
      const last = thread.turns[thread.turns.length - 1];
      if (!last || last.role !== 'user' || last.text !== text) {
        thread.turns.push({
          id: `turn_${randomUUID()}`,
          at: now,
          role: 'user',
          text,
        });
      }
      const userTurn = thread.turns[thread.turns.length - 1];
      const pushStopped = (text: string, stoppedOutcome: TalkTurnOutcome, notice: string, result?: { title: string; path?: string }) => {
        thread.turns.push({
          id: `turn_${randomUUID()}`,
          at: now,
          role: 'assistant',
          text,
          ...(turnExecutions.length ? { executionIds: turnExecutions.map((item) => item.id) } : {}),
          ...(result?.path ? { result: { title: result.title, path: result.path } } : {}),
        });
        if (userTurn && userTurn.role === 'user' && turnExecutions.length) {
          userTurn.executionIds = turnExecutions.map((item) => item.id);
        }
        thread.executions = [...(thread.executions || []), ...turnExecutions];
        timeoutNotice = notice;
        outcome = stoppedOutcome;
        next = thread;
      };
      if (isTalkCancelled(err)) {
        const writes = turnExecutions.filter(
          (item) => item.ok && (MUTATING_CAPS.has(item.capabilityId) || item.observedEffect?.mutated === true),
        );
        const written = [...writes].reverse().find((item) => item.outputPath);
        const text = written?.outputPath
          ? `已取消。已经写入的文件还在：${path.basename(written.outputPath)}`
          : '已取消。';
        pushStopped(text, 'CANCELLED', '已取消。', written?.outputPath ? { title: path.basename(written.outputPath), path: written.outputPath } : undefined);
      } else if (turnExecutions.length && isManagedAiUserNotice(err)) {
        const fromExec = assistantFromTurnExecutions(turnExecutions, 'undeliverable_final');
        const reason = String((err as Error).message || '').trim();
        const text = reason && !fromExec.text.includes(reason.slice(0, 24)) ? `${fromExec.text}\n\n${reason}` : fromExec.text;
        pushStopped(text, fromExec.outcome, reason || fromExec.notice, fromExec.result);
      } else if (isManagedAiUserNotice(err)) {
        thread.turns.push({
          id: `turn_${randomUUID()}`,
          at: now,
          role: 'assistant',
          text: String((err as Error).message || '兔机米提供的免费 AI 额度已经用完。'),
        });
        timeoutNotice = String((err as Error).message || '兔机米提供的免费 AI 额度已经用完。');
        outcome = 'FAILED';
        next = thread;
      } else if (!isTalkTimeout(err)) throw err;
      else {
        const fromExec = assistantFromTurnExecutions(turnExecutions, 'deadline');
        timeoutNotice = fromExec.notice;
        outcome = fromExec.outcome;
        thread.turns.push({
          id: `turn_${randomUUID()}`,
          at: now,
          role: 'assistant',
          text: fromExec.text,
          ...(fromExec.executionIds.length ? { executionIds: fromExec.executionIds } : {}),
          ...(fromExec.result ? { result: fromExec.result } : {}),
        });
        if (userTurn && userTurn.role === 'user' && fromExec.executionIds.length) {
          userTurn.executionIds = fromExec.executionIds;
        }
        thread.executions = [...(thread.executions || []), ...turnExecutions];
        next = thread;
      }
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternal);
      const idx = turnSignals.lastIndexOf(ac.signal);
      if (idx >= 0) turnSignals.splice(idx, 1);
    }
    if (next.threadId !== threadId) next.threadId = threadId;
    await writeThread(pkg.rootDir, next);
    return { view: projectView(next, timeoutNotice, outcome) };
  }
}

const MATERIAL_FILE_CHARS = 4000;
const MATERIAL_TOTAL_CHARS = 12000;
const MATERIAL_FILES = 6;

function isExistingFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

/** 把已附文件的摘录交给模型，并写明未纳入的部分。授权文件夹不整树读取。 */
export async function attachedMaterialBlock(contextPaths?: string[]): Promise<string> {
  const files = [...new Set((contextPaths || []).map((item) => String(item || '').trim()).filter(Boolean))].filter(
    isExistingFile,
  );
  if (!files.length) return '';
  const blocks: string[] = [];
  let used = 0;
  const listed = files.slice(0, MATERIAL_FILES);
  const skipped = files.slice(MATERIAL_FILES);
  for (const file of listed) {
    const room = MATERIAL_TOTAL_CHARS - used;
    if (room <= 0) {
      blocks.push(`- ${file}：本轮摘录容量已用完，正文未放入上下文。需要时用 read_file 读取。不得说成已经读完。`);
      continue;
    }
    try {
      const extracted = await extractFile(file);
      const text = String(extracted.text || '').trim();
      if (!text) {
        blocks.push(`- ${file}：文件在，但没有抽出可用正文。不得说成已经读过内容。`);
        continue;
      }
      const take = Math.min(MATERIAL_FILE_CHARS, room, text.length);
      const body = text.slice(0, take);
      used += body.length;
      const omitted = text.length - body.length;
      const tail =
        omitted > 0
          ? `\n（读取状态：excerpt；未读完；offset=0；length=${body.length}；total=${text.length}；complete=false。这一段不是全文。）`
          : `\n（读取状态：full；offset=0；length=${text.length}；total=${text.length}；complete=true。）`;
      blocks.push(`- ${file}\n${body}${tail}`);
    } catch (err) {
      blocks.push(`- ${file}：读取失败（${err instanceof Error ? err.message : String(err)}）。不得说成已经读过。`);
    }
  }
  for (const file of skipped) {
    blocks.push(`- ${file}：本轮未放入摘录。需要时用 read_file 读取。不得说成已经读完。`);
  }
  return `已附材料（路径会留在这个对话里，后续回合仍可 read_file；下面的摘录不是全文记忆）：\n${blocks.join('\n\n')}`;
}

export function composeTalkUserText(text: string, contextPaths?: string[]): string {
  const body = String(text || '').trim();
  const paths = (contextPaths || []).map((item) => String(item || '').trim()).filter(Boolean);
  if (!paths.length) return body;
  const list = paths.map((item) => `- ${item}`).join('\n');
  const suffix = `用户附上的文件或文件夹（这次交流的上下文，不是新任务）：\n${list}`;
  return body ? `${body}\n\n${suffix}` : suffix;
}

/**
 * 仅用 execution 机械事实生成用户可见结果。
 * - deadline：整轮超时后的合成失败说明
 * - undeliverable_final：模型最终回复为空或内部 actualSuccess JSON
 * 不读自然语言目标，不声称测试通过，不编造修改内容。
 */
export function assistantFromTurnExecutions(
  execs: TalkExecution[],
  mode: 'deadline' | 'undeliverable_final' = 'deadline',
): {
  text: string;
  notice: string;
  executionIds: string[];
  outcome: TalkTurnOutcome;
  result?: { title: string; path?: string };
} {
  const executionIds = execs.map((item) => item.id);
  if (!execs.length) {
    return {
      text: TALK_TIMEOUT_NOTICE,
      notice: TALK_TIMEOUT_NOTICE,
      executionIds,
      outcome: 'FAILED',
    };
  }
  const okWrites = execs.filter(
    (item) => item.ok && (MUTATING_CAPS.has(item.capabilityId) || item.observedEffect?.mutated === true),
  );
  const anyOk = execs.some((item) => item.ok);
  const mutated = hasObservedMutation(execs) || okWrites.length > 0;
  const failed = [...execs].reverse().find((item) => !item.ok);
  if (failed && !okWrites.length && !mutated) {
    const fact = String(failed.summary || failed.failureReason || '这次没有完成。').trim();
    return {
      text: fact.slice(0, 4000),
      notice: fact.slice(0, 400),
      executionIds,
      outcome: anyOk ? 'PARTIAL_SUCCESS' : 'FAILED',
    };
  }
  const lastWrite = [...okWrites].reverse()[0];
  const outputPath = lastWrite?.outputPath;
  const changedNames = uniqueBasenames(
    okWrites.flatMap((item) => [...(item.producedOutputs || []), ...(item.outputPath ? [item.outputPath] : [])]),
  );
  const writePaths = new Set(
    okWrites.flatMap((item) =>
      [...(item.producedOutputs || []), ...(item.outputPath ? [item.outputPath] : [])].map((row) =>
        path.basename(String(row || '').trim()).toLowerCase(),
      ),
    ),
  );
  const verified = execs.some((item) => {
    if (!item.ok || item.capabilityId !== 'read_file') return false;
    const blob = `${item.outputPath || ''} ${(item.producedOutputs || []).join(' ')} ${item.summary || ''}`.toLowerCase();
    return [...writePaths].some((name) => name && blob.includes(name));
  });
  let doneText: string;
  if (changedNames.length) {
    const verifyBit = verified ? ' 并验证' : '';
    doneText =
      mode === 'undeliverable_final'
        ? `已完成。已修改 ${changedNames.join('、')}${verifyBit}，结果已经写入项目目录。`
        : `操作已完成。已修改 ${changedNames.join('、')}${verifyBit}。\n${TALK_SYNTHESIS_TIMEOUT_NOTICE}`;
  } else if (mode === 'undeliverable_final') {
    doneText = anyOk
      ? execs
          .filter((item) => item.ok)
          .map((item) => String(item.summary || '').trim())
          .filter(Boolean)
          .slice(0, 3)
          .join('\n') || TALK_TIMEOUT_NOTICE
      : TALK_TIMEOUT_NOTICE;
  } else {
    const facts = execs
      .filter((item) => item.ok)
      .map((item) => String(item.summary || '').trim())
      .filter(Boolean)
      .slice(0, 3);
    doneText = facts.length
      ? `${facts.join('\n')}\n${TALK_SYNTHESIS_TIMEOUT_NOTICE}`
      : TALK_SYNTHESIS_TIMEOUT_NOTICE;
  }
  return {
    text: doneText,
    notice: doneText.slice(0, 400),
    executionIds,
    outcome: 'PARTIAL_SUCCESS',
    ...(outputPath ? { result: { title: path.basename(outputPath), path: outputPath } } : {}),
  };
}

function uniqueBasenames(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of paths) {
    const name = path.basename(String(item || '').trim());
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function applyUndeliverableFinalFallback(thread: ReturnType<typeof emptyThread>, execs: TalkExecution[]): void {
  if (!execs.length) return;
  const last = thread.turns[thread.turns.length - 1];
  if (!last || last.role !== 'assistant') return;
  if (last.text !== EMPTY_REPLY) return;
  const fromExec = assistantFromTurnExecutions(execs, 'undeliverable_final');
  last.text = fromExec.text;
  if (fromExec.executionIds.length) last.executionIds = fromExec.executionIds;
  if (fromExec.result) last.result = fromExec.result;
}

function projectView(
  thread: ReturnType<typeof emptyThread>,
  notice?: string,
  outcome?: TalkTurnOutcome,
): TalkView {
  return {
    headline: '与兔机米',
    empty: thread.turns.length === 0,
    ...(notice ? { notice } : {}),
    ...(outcome ? { outcome } : {}),
    turns: thread.turns.map((turn) => ({
      role: turn.role,
      text: turn.text,
      ...(turn.result ? { result: turn.result } : {}),
    })),
  };
}

export function talkOutputDir(packageRoot: string, execId: string): string {
  return path.join(packageRoot, 'intelligence', 'runs', execId);
}
