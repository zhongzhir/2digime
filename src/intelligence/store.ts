import { promises as fs } from 'node:fs';
import * as fssync from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile, readFileWithRecovery } from '../infrastructure/fs-atomic';
import {
  listConversationSessionsSync,
} from '../subject-core/conversation-sessions';
import {
  DEFAULT_THREAD_ID,
  TALK_SCHEMA_VERSION,
  type TalkThread,
} from './types';

export function talkThreadsDir(packageRoot: string): string {
  return path.join(packageRoot, 'intelligence', 'threads');
}

export function legacyTalkThreadFilePath(packageRoot: string): string {
  return path.join(packageRoot, 'intelligence', 'thread.json');
}

/** 当前会话的 Talk 线程文件；无会话 id 时回落到 legacy 单文件。 */
export function talkThreadFilePath(packageRoot: string, threadId?: string): string {
  const id = String(threadId || '').trim();
  if (id) return path.join(talkThreadsDir(packageRoot), `${id}.json`);
  try {
    const currentId = listConversationSessionsSync(packageRoot).currentId;
    if (currentId) return path.join(talkThreadsDir(packageRoot), `${currentId}.json`);
  } catch {
    /* 无包/会话时用 legacy */
  }
  return legacyTalkThreadFilePath(packageRoot);
}

export function emptyThread(now: string, threadId: string = DEFAULT_THREAD_ID): TalkThread {
  return {
    schemaVersion: TALK_SCHEMA_VERSION,
    threadId,
    updatedAt: now,
    turns: [],
    executions: [],
  };
}

function parseThread(content: string, now: string, fallbackId: string): TalkThread | null {
  try {
    const parsed = JSON.parse(content) as TalkThread;
    if (!parsed || parsed.schemaVersion !== TALK_SCHEMA_VERSION || !Array.isArray(parsed.turns)) {
      return null;
    }
    return {
      schemaVersion: TALK_SCHEMA_VERSION,
      threadId: parsed.threadId || fallbackId,
      updatedAt: parsed.updatedAt || now,
      ...(parsed.openGoal ? { openGoal: parsed.openGoal } : {}),
      turns: parsed.turns || [],
      executions: parsed.executions || [],
    };
  } catch {
    return null;
  }
}

async function readThreadAt(
  file: string,
  now: string,
  threadId: string,
): Promise<TalkThread | null> {
  try {
    const recovered = await readFileWithRecovery(file, (content) => !!parseThread(content, now, threadId));
    if (!recovered.content) return null;
    return parseThread(recovered.content, now, threadId);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * 读当前会话的 Talk 线程。
 * 首次：若仅有 legacy intelligence/thread.json，迁入 threads/{sessionId}.json。
 */
export async function readThread(
  packageRoot: string,
  now: string,
  threadId?: string,
): Promise<TalkThread> {
  const id =
    String(threadId || '').trim() ||
    (() => {
      try {
        return listConversationSessionsSync(packageRoot).currentId;
      } catch {
        return DEFAULT_THREAD_ID;
      }
    })();
  const file = talkThreadFilePath(packageRoot, id);
  const existing = await readThreadAt(file, now, id);
  if (existing) {
    if (existing.threadId !== id) existing.threadId = id;
    return existing;
  }
  const legacy = legacyTalkThreadFilePath(packageRoot);
  if (fssync.existsSync(legacy) && !fssync.existsSync(file)) {
    const migrated = await readThreadAt(legacy, now, id);
    if (migrated) {
      migrated.threadId = id;
      await writeThread(packageRoot, migrated);
      return migrated;
    }
  }
  return emptyThread(now, id);
}

export async function writeThread(packageRoot: string, thread: TalkThread): Promise<void> {
  const file = talkThreadFilePath(packageRoot, thread.threadId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWriteFile(file, `${JSON.stringify(thread, null, 2)}\n`);
}
