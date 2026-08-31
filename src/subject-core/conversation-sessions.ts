/**
 * 对话会话权威存储 — 主进程/核心维护；页面只显示投影。
 * 本轮只实现创建、列表、打开和继续。重命名/删除/移动/存档留作扩展接口。
 */
import { promises as fs } from 'node:fs';
import * as fssync from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { nowIso } from '../shared/ids';
import {
  filterTurnsForUi,
  legacyConversationFilePath,
  readConversationRows,
  type ConversationTurn,
} from './conversation-transcript';

export const CONVERSATION_SESSION_SCHEMA = 1 as const;

export interface ConversationSessionMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationSessionIndex {
  schemaVersion: typeof CONVERSATION_SESSION_SCHEMA;
  currentId: string;
  sessions: ConversationSessionMeta[];
}

/** 扩展接口：本轮不实现，避免扩大范围。 */
export interface ConversationSessionFutureOps {
  rename?(id: string, title: string): Promise<void>;
  remove?(id: string): Promise<void>;
  archive?(id: string): Promise<void>;
  move?(id: string, dest: string): Promise<void>;
}

export function conversationsDir(packageRoot: string): string {
  return path.join(packageRoot, 'ui', 'conversations');
}

export function conversationIndexPath(packageRoot: string): string {
  return path.join(conversationsDir(packageRoot), 'index.json');
}

export function conversationSessionFilePath(packageRoot: string, sessionId: string): string {
  return path.join(conversationsDir(packageRoot), `${sessionId}.ndjson`);
}

export function newConversationSessionId(): string {
  return `conv_${Date.now().toString(36)}${randomBytes(4).toString('hex')}`;
}

export function titleFromFirstUserText(text: string, fallback = '新对话'): string {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return fallback;
  return t.length <= 24 ? t : `${t.slice(0, 23)}…`;
}

export function loadConversationSessionIndexSync(packageRoot: string): ConversationSessionIndex {
  const indexFile = conversationIndexPath(packageRoot);
  if (fssync.existsSync(indexFile)) {
    try {
      const parsed = JSON.parse(fssync.readFileSync(indexFile, 'utf8')) as ConversationSessionIndex;
      if (parsed && parsed.schemaVersion === 1 && Array.isArray(parsed.sessions) && parsed.currentId) {
        if (parsed.sessions.some((s) => s.id === parsed.currentId)) return parsed;
      }
    } catch {
      /* migrate */
    }
  }
  return migrateLegacyConversationSync(packageRoot);
}

function migrateLegacyConversationSync(packageRoot: string): ConversationSessionIndex {
  const id = newConversationSessionId();
  const at = nowIso();
  const dir = conversationsDir(packageRoot);
  fssync.mkdirSync(dir, { recursive: true });
  const dest = conversationSessionFilePath(packageRoot, id);
  const legacy = legacyConversationFilePath(packageRoot);
  let title = '新对话';
  if (fssync.existsSync(legacy)) {
    const raw = fssync.readFileSync(legacy, 'utf8');
    fssync.writeFileSync(dest, raw, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as { role?: string; text?: string };
        if (row.role === 'user' && row.text) {
          title = titleFromFirstUserText(row.text);
          break;
        }
      } catch {
        /* skip */
      }
    }
  } else {
    fssync.writeFileSync(dest, '', 'utf8');
  }
  const index: ConversationSessionIndex = {
    schemaVersion: 1,
    currentId: id,
    sessions: [{ id, title, createdAt: at, updatedAt: at }],
  };
  fssync.writeFileSync(indexFilePath(packageRoot), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
  return index;
}

function indexFilePath(packageRoot: string): string {
  return conversationIndexPath(packageRoot);
}

function saveIndexSync(packageRoot: string, index: ConversationSessionIndex): void {
  fssync.mkdirSync(conversationsDir(packageRoot), { recursive: true });
  fssync.writeFileSync(indexFilePath(packageRoot), `${JSON.stringify(index, null, 2)}\n`, 'utf8');
}

export function currentConversationFilePathSync(packageRoot: string): string {
  const index = loadConversationSessionIndexSync(packageRoot);
  return conversationSessionFilePath(packageRoot, index.currentId);
}

export function listConversationSessionsSync(packageRoot: string): {
  currentId: string;
  sessions: ConversationSessionMeta[];
} {
  const index = loadConversationSessionIndexSync(packageRoot);
  const sessions = [...index.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { currentId: index.currentId, sessions };
}

export function createConversationSessionSync(packageRoot: string): ConversationSessionMeta {
  const index = loadConversationSessionIndexSync(packageRoot);
  const id = newConversationSessionId();
  const at = nowIso();
  const session: ConversationSessionMeta = { id, title: '新对话', createdAt: at, updatedAt: at };
  fssync.mkdirSync(conversationsDir(packageRoot), { recursive: true });
  fssync.writeFileSync(conversationSessionFilePath(packageRoot, id), '', 'utf8');
  index.sessions.push(session);
  index.currentId = id;
  saveIndexSync(packageRoot, index);
  return session;
}

export function openConversationSessionSync(packageRoot: string, sessionId: string): ConversationSessionMeta {
  const index = loadConversationSessionIndexSync(packageRoot);
  const session = index.sessions.find((s) => s.id === sessionId);
  if (!session) throw new Error('找不到这场对话');
  index.currentId = sessionId;
  saveIndexSync(packageRoot, index);
  return session;
}

export function touchConversationSessionSync(
  packageRoot: string,
  opts: { titleFromUserText?: string } = {},
): void {
  const index = loadConversationSessionIndexSync(packageRoot);
  const session = index.sessions.find((s) => s.id === index.currentId);
  if (!session) return;
  session.updatedAt = nowIso();
  if (opts.titleFromUserText && (session.title === '新对话' || !session.title)) {
    session.title = titleFromFirstUserText(opts.titleFromUserText);
  }
  saveIndexSync(packageRoot, index);
}

export async function listCurrentSessionTurns(packageRoot: string): Promise<ConversationTurn[]> {
  const file = currentConversationFilePathSync(packageRoot);
  const rows = await readConversationRows(file);
  return filterTurnsForUi(rows);
}
