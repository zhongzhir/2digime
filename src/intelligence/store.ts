import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile, readFileWithRecovery } from '../infrastructure/fs-atomic';
import {
  DEFAULT_THREAD_ID,
  TALK_SCHEMA_VERSION,
  type TalkThread,
} from './types';

export function talkThreadFilePath(packageRoot: string): string {
  return path.join(packageRoot, 'intelligence', 'thread.json');
}

export function emptyThread(now: string): TalkThread {
  return {
    schemaVersion: TALK_SCHEMA_VERSION,
    threadId: DEFAULT_THREAD_ID,
    updatedAt: now,
    turns: [],
    executions: [],
  };
}

export async function readThread(packageRoot: string, now: string): Promise<TalkThread> {
  const file = talkThreadFilePath(packageRoot);
  try {
    const recovered = await readFileWithRecovery(file, (content) => {
      try {
        const parsed = JSON.parse(content) as TalkThread;
        return !!parsed && parsed.schemaVersion === TALK_SCHEMA_VERSION && Array.isArray(parsed.turns);
      } catch {
        return false;
      }
    });
    if (!recovered.content) return emptyThread(now);
    const parsed = JSON.parse(recovered.content) as TalkThread;
    return {
      schemaVersion: TALK_SCHEMA_VERSION,
      threadId: parsed.threadId || DEFAULT_THREAD_ID,
      updatedAt: parsed.updatedAt || now,
      ...(parsed.openGoal ? { openGoal: parsed.openGoal } : {}),
      turns: parsed.turns || [],
      executions: parsed.executions || [],
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return emptyThread(now);
    throw err;
  }
}

export async function writeThread(packageRoot: string, thread: TalkThread): Promise<void> {
  const file = talkThreadFilePath(packageRoot);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWriteFile(file, `${JSON.stringify(thread, null, 2)}\n`);
}
