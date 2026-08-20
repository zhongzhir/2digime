/**
 * 软件开发任务「稍后连接」草稿 — 落在主体包 runtime 目录，复用包路径，不建第二 Task Store。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export const PENDING_SOFTWARE_TASK_FILENAME = 'pending-software-task.json';
export const CODING_CAPABILITY_PREFS_FILENAME = 'coding-capability-prefs.json';

export interface PendingSoftwareTaskDraft {
  schemaVersion: 'pending-software-task/1';
  savedAt: string;
  goal: string;
  contextRefs: Array<{ kind: 'file' | 'folder'; path: string }>;
  acceptanceNotes?: string;
  status: 'awaiting_coding_capability';
  userFacingNotice: string;
}

export interface CodingCapabilityPrefsFile {
  schemaVersion: 'coding-capability-prefs/1';
  defaultCapabilityId?: string;
  updatedAt: string;
}

export async function savePendingSoftwareTask(
  runtimeDir: string,
  draft: Omit<PendingSoftwareTaskDraft, 'schemaVersion' | 'savedAt' | 'status' | 'userFacingNotice'> & {
    userFacingNotice?: string;
  },
): Promise<PendingSoftwareTaskDraft> {
  await fs.mkdir(runtimeDir, { recursive: true });
  const full: PendingSoftwareTaskDraft = {
    schemaVersion: 'pending-software-task/1',
    savedAt: new Date().toISOString(),
    goal: draft.goal,
    contextRefs: draft.contextRefs,
    ...(draft.acceptanceNotes ? { acceptanceNotes: draft.acceptanceNotes } : {}),
    status: 'awaiting_coding_capability',
    userFacingNotice:
      draft.userFacingNotice || '连接代码执行能力后可继续',
  };
  await fs.writeFile(
    path.join(runtimeDir, PENDING_SOFTWARE_TASK_FILENAME),
    `${JSON.stringify(full, null, 2)}\n`,
    'utf8',
  );
  return full;
}

export async function loadPendingSoftwareTask(
  runtimeDir: string,
): Promise<PendingSoftwareTaskDraft | null> {
  try {
    const raw = await fs.readFile(
      path.join(runtimeDir, PENDING_SOFTWARE_TASK_FILENAME),
      'utf8',
    );
    const parsed = JSON.parse(raw) as PendingSoftwareTaskDraft;
    if (!parsed || parsed.schemaVersion !== 'pending-software-task/1') return null;
    if (!String(parsed.goal || '').trim()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearPendingSoftwareTask(runtimeDir: string): Promise<void> {
  try {
    await fs.unlink(path.join(runtimeDir, PENDING_SOFTWARE_TASK_FILENAME));
  } catch {
    /* ignore */
  }
}

export async function loadCodingCapabilityPrefs(
  runtimeDir: string,
): Promise<CodingCapabilityPrefsFile | null> {
  try {
    const raw = await fs.readFile(
      path.join(runtimeDir, CODING_CAPABILITY_PREFS_FILENAME),
      'utf8',
    );
    const parsed = JSON.parse(raw) as CodingCapabilityPrefsFile;
    if (!parsed || parsed.schemaVersion !== 'coding-capability-prefs/1') return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function saveCodingCapabilityPrefs(
  runtimeDir: string,
  prefs: { defaultCapabilityId?: string },
): Promise<CodingCapabilityPrefsFile> {
  await fs.mkdir(runtimeDir, { recursive: true });
  const full: CodingCapabilityPrefsFile = {
    schemaVersion: 'coding-capability-prefs/1',
    updatedAt: new Date().toISOString(),
    ...(prefs.defaultCapabilityId
      ? { defaultCapabilityId: prefs.defaultCapabilityId }
      : {}),
  };
  await fs.writeFile(
    path.join(runtimeDir, CODING_CAPABILITY_PREFS_FILENAME),
    `${JSON.stringify(full, null, 2)}\n`,
    'utf8',
  );
  return full;
}
