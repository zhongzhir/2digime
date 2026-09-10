import * as path from 'node:path';
import { nowIso } from '../shared/ids';
import { readDigitalSelf } from '../subject-core/digital-self/store';
import { formatSelfContext, selectSelfContext } from './self-context';
import { emptyThread, readThread, writeThread } from './store';
import { randomUUID } from 'node:crypto';
import { NO_MODEL_NOTICE, runTalkTurn, type SubjectCollabPort } from './loop';
import type { ProfessionalAgent, TalkChatFn, TalkExecution, TalkView } from './types';

/** 做事（含首次获取代码执行能力）需要数分钟；180s 会在 runtime 仍工作时掐断。 */
export const TALK_TURN_DEADLINE_MS = 600_000;
export const TALK_TIMEOUT_NOTICE = '请求超时，模型在限定时间内没有返回。可重试。';
export const TALK_SYNTHESIS_TIMEOUT_NOTICE = '操作已经完成，但最终回复生成超时';

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

function isTalkTimeout(err: unknown): boolean {
  if (err instanceof TalkTimeoutError) return true;
  if (!(err instanceof Error)) return false;
  if (err.name === 'TalkTimeoutError' || err.name === 'AbortError') return true;
  // 工具已成功后，合成/续聊的运输层超时不得绕过 writeThread，否则 Owner 空等约整轮 deadline。
  const kind = (err as { kind?: string }).kind;
  if (err.name === 'ModelHttpError' && (kind === 'timeout' || kind === 'aborted')) return true;
  return /timeout after\s+\d+ms|请求超时|TalkTimeout/i.test(err.message);
}

function wrapChatWithDeadline(chat: TalkChatFn, signal: AbortSignal): TalkChatFn {
  return async (input) => {
    if (signal.aborted) throw new TalkTimeoutError();
    return await new Promise((resolve, reject) => {
      const onAbort = () => reject(new TalkTimeoutError());
      signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve(chat({ ...input, signal })).then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (err) => {
          signal.removeEventListener('abort', onAbort);
          if (signal.aborted) reject(new TalkTimeoutError());
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
  private writeChain: Promise<void> = Promise.resolve();

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
  ) {}

  async invoke(input: { text?: string; contextPaths?: string[] }): Promise<{ view: TalkView }> {
    const run = this.writeChain.then(() => this.invokeNow(input));
    this.writeChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async invokeNow(input: { text?: string; contextPaths?: string[] }): Promise<{ view: TalkView }> {
    const pkg = this.resolvePackage();
    if (!pkg) {
      return { view: projectView(emptyThread(this.now()), '还没有可用的数字之我。') };
    }
    const now = this.now();
    const thread = await readThread(pkg.rootDir, now);
    const spoken = String(input.text || '').trim();
    const text = composeTalkUserText(spoken, input.contextPaths);
    if (!text) {
      return { view: projectView(thread) };
    }
    if (!this.chat) {
      return { view: projectView(thread, NO_MODEL_NOTICE) };
    }
    let confirmHint: string | undefined;
    // DIGITAL_SELF_LEARNING_BLOCKS_TALK = YES
    // 每个 Talk turn 在真正 Talk 前同步调用 Digital Self interpret。本轮不改成异步。
    if (spoken && this.learnFromUtterance) {
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
    const collab = this.resolveCollab ? await this.resolveCollab(pkg) : null;
    const turnCtx = input.contextPaths?.length ? { contextPaths: input.contextPaths } : {};
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), talkTurnDeadlineMs());
    const boundedChat = wrapChatWithDeadline(this.chat, ac.signal);
    const turnExecutions: TalkExecution[] = [];
    let next = thread;
    let timeoutNotice: string | undefined;
    try {
      next = await runTalkTurn({
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
        ...(input.contextPaths?.length ? { contextPaths: input.contextPaths } : {}),
        ...(collab ? { subjectCollab: collab } : {}),
        ...(confirmHint ? { confirmHint } : {}),
      });
    } catch (err) {
      if (!isTalkTimeout(err)) throw err;
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
      const fromExec = assistantFromTurnExecutions(turnExecutions);
      timeoutNotice = fromExec.notice;
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
    } finally {
      clearTimeout(timer);
    }
    await writeThread(pkg.rootDir, next);
    return { view: projectView(next, timeoutNotice) };
  }
}

export function composeTalkUserText(text: string, contextPaths?: string[]): string {
  const body = String(text || '').trim();
  const paths = (contextPaths || []).map((item) => String(item || '').trim()).filter(Boolean);
  if (!paths.length) return body;
  const list = paths.map((item) => `- ${item}`).join('\n');
  const suffix = `用户附上的文件或文件夹（这次交流的上下文，不是新任务）：\n${list}`;
  return body ? `${body}\n\n${suffix}` : suffix;
}

function assistantFromTurnExecutions(execs: TalkExecution[]): {
  text: string;
  notice: string;
  executionIds: string[];
  result?: { title: string; path?: string };
} {
  const executionIds = execs.map((item) => item.id);
  if (!execs.length) {
    return { text: TALK_TIMEOUT_NOTICE, notice: TALK_TIMEOUT_NOTICE, executionIds };
  }
  const failed = [...execs].reverse().find((item) => !item.ok);
  if (failed) {
    const fact = String(failed.summary || failed.failureReason || TALK_TIMEOUT_NOTICE).trim();
    return {
      text: fact.slice(0, 4000),
      notice: fact.slice(0, 400),
      executionIds,
    };
  }
  const lastOk = [...execs].reverse().find((item) => item.ok);
  const outputPath = lastOk?.outputPath;
  return {
    text: TALK_SYNTHESIS_TIMEOUT_NOTICE,
    notice: TALK_SYNTHESIS_TIMEOUT_NOTICE,
    executionIds,
    ...(outputPath ? { result: { title: path.basename(outputPath), path: outputPath } } : {}),
  };
}

function projectView(thread: ReturnType<typeof emptyThread>, notice?: string): TalkView {
  return {
    headline: '与兔机米',
    empty: thread.turns.length === 0,
    ...(notice ? { notice } : {}),
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
