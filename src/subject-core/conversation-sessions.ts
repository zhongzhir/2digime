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
  /** 归档：从主列表收起，内容原样保留，可随时取回。 */
  archived?: boolean;
  /** 所属项目；没有就是未归入项目。 */
  projectId?: string;
}

export interface ConversationSessionIndex {
  schemaVersion: typeof CONVERSATION_SESSION_SCHEMA;
  currentId: string;
  sessions: ConversationSessionMeta[];
  projects?: ConversationProject[];
}

/** 项目：只是对话的分组标签，不拥有文件，也不拥有数字之我的内容。 */
export interface ConversationProject {
  id: string;
  name: string;
  createdAt: string;
}

/**
 * 对话管理（改名、归档、归入项目、删除）直接在这份索引上做。
 * 不新增第二份对话存储；归档/项目只是索引上的字段。
 */

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
  projects: ConversationProject[];
} {
  const index = loadConversationSessionIndexSync(packageRoot);
  const sessions = [...index.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { currentId: index.currentId, sessions, projects: [...(index.projects ?? [])] };
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function requireSession(index: ConversationSessionIndex, id: string): ConversationSessionMeta {
  const session = index.sessions.find((s) => s.id === id);
  if (!session) throw new Error('找不到这场对话');
  return session;
}

function cleanName(raw: string, what: string): string {
  const name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!name) throw new Error(`${what}不能为空`);
  return name.length > 60 ? name.slice(0, 60) : name;
}

export function renameConversationSessionSync(packageRoot: string, id: string, title: string): ConversationSessionMeta {
  const index = loadConversationSessionIndexSync(packageRoot);
  const session = requireSession(index, id);
  session.title = cleanName(title, '对话名称');
  saveIndexSync(packageRoot, index);
  return session;
}

export function archiveConversationSessionSync(
  packageRoot: string,
  id: string,
  archived: boolean,
): ConversationSessionMeta {
  const index = loadConversationSessionIndexSync(packageRoot);
  const session = requireSession(index, id);
  if (archived) session.archived = true;
  else delete session.archived;
  saveIndexSync(packageRoot, index);
  return session;
}

export function createConversationProjectSync(packageRoot: string, name: string): ConversationProject {
  const index = loadConversationSessionIndexSync(packageRoot);
  const project: ConversationProject = {
    id: `proj_${Date.now().toString(36)}${randomBytes(3).toString('hex')}`,
    name: cleanName(name, '项目名称'),
    createdAt: nowIso(),
  };
  index.projects = [...(index.projects ?? []), project];
  saveIndexSync(packageRoot, index);
  return project;
}

export function renameConversationProjectSync(packageRoot: string, projectId: string, name: string): ConversationProject {
  const index = loadConversationSessionIndexSync(packageRoot);
  const project = (index.projects ?? []).find((p) => p.id === projectId);
  if (!project) throw new Error('找不到这个项目');
  project.name = cleanName(name, '项目名称');
  saveIndexSync(packageRoot, index);
  return project;
}

/** 删除项目只解散分组：里面的对话回到未归入项目，一条都不删。 */
export function removeConversationProjectSync(packageRoot: string, projectId: string): { released: number } {
  const index = loadConversationSessionIndexSync(packageRoot);
  if (!(index.projects ?? []).some((p) => p.id === projectId)) throw new Error('找不到这个项目');
  let released = 0;
  for (const s of index.sessions) {
    if (s.projectId === projectId) {
      delete s.projectId;
      released += 1;
    }
  }
  index.projects = (index.projects ?? []).filter((p) => p.id !== projectId);
  saveIndexSync(packageRoot, index);
  return { released };
}

/** projectId 为空表示移出项目。 */
export function moveConversationSessionSync(
  packageRoot: string,
  id: string,
  projectId: string | null,
): ConversationSessionMeta {
  const index = loadConversationSessionIndexSync(packageRoot);
  const session = requireSession(index, id);
  if (projectId) {
    if (!(index.projects ?? []).some((p) => p.id === projectId)) throw new Error('找不到这个项目');
    session.projectId = projectId;
  } else {
    delete session.projectId;
  }
  saveIndexSync(packageRoot, index);
  return session;
}

/**
 * 删除范围必须明确。目前只有一种：`conversation_only`——
 * 删除这场对话的聊天记录和它的工作线程记录。
 * 这场对话产出的文件、数字之我里已经记下的内容、其他对话，都不会被动。
 */
export type ConversationDeleteScope = 'conversation_only';

export function deleteConversationSessionSync(
  packageRoot: string,
  id: string,
  scope: ConversationDeleteScope | string,
): { removedId: string; currentId: string } {
  if (scope !== 'conversation_only') throw new Error('请先确认删除范围');
  if (!SAFE_ID.test(id)) throw new Error('找不到这场对话');
  const index = loadConversationSessionIndexSync(packageRoot);
  requireSession(index, id);
  index.sessions = index.sessions.filter((s) => s.id !== id);
  if (index.currentId === id) {
    const next = [...index.sessions]
      .filter((s) => !s.archived)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (next) {
      index.currentId = next.id;
    } else {
      const at = nowIso();
      const fresh: ConversationSessionMeta = { id: newConversationSessionId(), title: '新对话', createdAt: at, updatedAt: at };
      fssync.writeFileSync(conversationSessionFilePath(packageRoot, fresh.id), '', 'utf8');
      index.sessions.push(fresh);
      index.currentId = fresh.id;
    }
  }
  // 先写索引再删文件：中途失败最多留下无人引用的文件，不会出现指向空文件的对话。
  saveIndexSync(packageRoot, index);
  const threadFile = path.join(packageRoot, 'intelligence', 'threads', `${id}.json`);
  for (const file of [conversationSessionFilePath(packageRoot, id), threadFile, `${threadFile}.bak`]) {
    try {
      fssync.rmSync(file, { force: true });
    } catch {
      /* 留下孤立文件不影响使用 */
    }
  }
  return { removedId: id, currentId: index.currentId };
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
  // 在归档的对话里继续说话，就是把它取回来。
  if (session.archived) delete session.archived;
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
