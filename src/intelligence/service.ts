import * as path from 'node:path';
import { nowIso } from '../shared/ids';
import { readDigitalSelf } from '../subject-core/digital-self/store';
import { formatSelfContext, selectSelfContext } from './self-context';
import { emptyThread, readThread, writeThread } from './store';
import { NO_MODEL_NOTICE, runTalkTurn } from './loop';
import type { ProfessionalAgent, TalkChatFn, TalkView } from './types';

export interface TalkPackageRef {
  rootDir: string;
  subjectId: string;
}

export class TalkService {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly resolvePackage: () => TalkPackageRef | null,
    private readonly chat: TalkChatFn | null,
    private readonly resolveAgents: (pkg: TalkPackageRef) => ProfessionalAgent[],
    private readonly now: () => string = nowIso,
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
    const text = composeTalkUserText(String(input.text || '').trim(), input.contextPaths);
    if (!text) {
      return { view: projectView(thread) };
    }
    if (!this.chat) {
      return { view: projectView(thread, NO_MODEL_NOTICE) };
    }
    let selfContext = '当前还没有已写入的数字之我认识。读取失败不得假装了解用户。';
    try {
      const self = await readDigitalSelf(pkg.rootDir, pkg.subjectId, now);
      selfContext = formatSelfContext(selectSelfContext(self, text));
    } catch {
      selfContext = '读取数字之我失败。不得解释为不了解用户，也不要编造本人事实。';
    }
    const next = await runTalkTurn({
      thread,
      userText: text,
      selfContext,
      agents: this.resolveAgents(pkg),
      chat: this.chat,
      workRoot: pkg.rootDir,
      now,
    });
    await writeThread(pkg.rootDir, next);
    return { view: projectView(next) };
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

function projectView(thread: ReturnType<typeof emptyThread>, notice?: string): TalkView {
  return {
    headline: '与 2digime',
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
