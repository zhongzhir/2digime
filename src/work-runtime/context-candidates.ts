/**
 * Cross-task context candidates — deterministic discovery only.
 * Relevance / referent resolution is decided by the model, not keywords.
 *
 * Each authoritative source has its own bounded lane so recency-heavy
 * artifacts/conversations cannot starve Subject durable context before
 * the model sees it. Lanes are merged; AI still chooses what is relevant.
 *
 * Sources: conversation/thread, completed job/result/deliverable,
 * project/workspace folders, subject preferences, current attachments
 * (attachments already live in the converse material brief).
 */
import type { Artifact } from './artifact';
import type { Task } from './task';

export type WorkContextCandidateKind =
  | 'artifact'
  | 'task_folder'
  | 'conversation'
  | 'preference';

export interface WorkContextCandidate {
  id: string;
  kind: WorkContextCandidateKind;
  title: string;
  summary: string;
  taskId: string;
  /** Absolute path when the candidate is an authorized folder. */
  path?: string;
  /** Subject preference event id when kind is preference. */
  eventId?: string;
}

export interface ResolvedContextSelection {
  artifactIds: string[];
  folderPaths: string[];
  preferenceEventIds: string[];
  conversationTaskIds: string[];
}

/** Per-source discovery caps. Not a single shared pool. */
export const CONTEXT_CANDIDATE_LANES = {
  artifact: 10,
  task_folder: 2,
  conversation: 6,
  preference: 6,
} as const;

const MAX_ARTIFACTS_PER_TASK = 2;
const TASK_LOOKBACK = 20;
const SUMMARY_CHARS = 280;

export function buildWorkContextCandidates(input: {
  currentTaskId: string;
  tasks: readonly Task[];
  artifacts: readonly Artifact[];
  readArtifactText?: (artifact: Artifact) => string | undefined;
  preferences?: readonly { eventId: string; title: string; detail: string }[];
}): WorkContextCandidate[] {
  const tasks = input.tasks.filter((t) => t.id !== input.currentTaskId).slice(0, TASK_LOOKBACK);
  const artifactsByTask = new Map<string, Artifact[]>();
  for (const art of input.artifacts) {
    const list = artifactsByTask.get(art.taskId) || [];
    list.push(art);
    artifactsByTask.set(art.taskId, list);
  }

  const artifacts: WorkContextCandidate[] = [];
  for (const task of tasks) {
    if (artifacts.length >= CONTEXT_CANDIDATE_LANES.artifact) break;
    const arts = artifactsByTask.get(task.id) || [];
    for (const art of arts.slice(0, MAX_ARTIFACTS_PER_TASK)) {
      if (artifacts.length >= CONTEXT_CANDIDATE_LANES.artifact) break;
      const body = String(input.readArtifactText?.(art) || '').replace(/\s+/g, ' ').trim();
      artifacts.push({
        id: `artifact:${art.id}`,
        kind: 'artifact',
        title: String(art.title || task.goal).slice(0, 80),
        summary: (body || task.goal).slice(0, SUMMARY_CHARS),
        taskId: task.id,
      });
    }
  }

  const folders: WorkContextCandidate[] = [];
  for (const task of tasks) {
    if (folders.length >= CONTEXT_CANDIDATE_LANES.task_folder) break;
    for (const ref of task.contextRefs || []) {
      if (ref.kind !== 'folder' || !ref.path) continue;
      if (folders.length >= CONTEXT_CANDIDATE_LANES.task_folder) break;
      folders.push({
        id: `task_folder:${ref.path}`,
        kind: 'task_folder',
        title: task.goal.slice(0, 80),
        summary: `已授权项目目录：${ref.path}`,
        taskId: task.id,
        path: ref.path,
      });
    }
  }

  const conversations: WorkContextCandidate[] = [];
  for (const task of tasks) {
    if (conversations.length >= CONTEXT_CANDIDATE_LANES.conversation) break;
    const summary = conversationCandidateSummary(task);
    if (!summary) continue;
    conversations.push({
      id: `conversation:${task.id}`,
      kind: 'conversation',
      title: task.goal.slice(0, 80) || '近期对话',
      summary,
      taskId: task.id,
    });
  }

  const preferences: WorkContextCandidate[] = [];
  for (const pref of input.preferences || []) {
    if (preferences.length >= CONTEXT_CANDIDATE_LANES.preference) break;
    const eventId = String(pref.eventId || '').trim();
    if (!eventId) continue;
    preferences.push({
      id: `preference:${eventId}`,
      kind: 'preference',
      title: String(pref.title || '已确认偏好').slice(0, 80),
      summary: String(pref.detail || pref.title || '').replace(/\s+/g, ' ').trim().slice(0, SUMMARY_CHARS),
      taskId: input.currentTaskId,
      eventId,
    });
  }

  return mergeLaneCandidates([artifacts, folders, conversations, preferences]);
}

export function formatContextCandidateBrief(
  candidates: readonly WorkContextCandidate[],
): string {
  if (!candidates.length) return '';
  const lines = [
    '【可选用的已有上下文候选】',
    '这些是已经存在的对话、已完成成果、项目目录与已确认工作偏好。',
    '你必须对当前用户目标做指代解析：用户可能不重复项目名或材料，但仍在继续刚完成的工作。',
    '选择依据是语义相关、对话连续性与新近程度的综合判断，不是“最新一条全选”，也不是名称关键词命中。',
    '只填真正相关的 id；无关项目与不适用的偏好不要选。',
  ];
  const groups: Array<{ kind: WorkContextCandidateKind; label: string }> = [
    { kind: 'artifact', label: '近期成果' },
    { kind: 'task_folder', label: '项目目录' },
    { kind: 'conversation', label: '近期对话' },
    { kind: 'preference', label: '已确认工作偏好' },
  ];
  for (const g of groups) {
    const items = candidates.filter((c) => c.kind === g.kind);
    if (!items.length) continue;
    lines.push(`— ${g.label} —`);
    for (const c of items) {
      lines.push(`- ${c.id}｜${c.kind}｜${c.title}｜${c.summary}`);
    }
  }
  return lines.join('\n');
}

/**
 * Map model/planner aliases onto canonical candidate ids.
 * Deterministic identity only — does not decide relevance.
 */
export function canonicalizeContextSelectionIds(
  candidates: readonly WorkContextCandidate[],
  selectedIds: readonly string[],
): string[] {
  const aliases = new Map<string, string>();
  for (const c of candidates) {
    aliases.set(c.id, c.id);
    if (c.kind === 'preference' && c.eventId) {
      aliases.set(c.eventId, c.id);
    } else if (c.kind === 'artifact') {
      aliases.set(c.id.replace(/^artifact:/, ''), c.id);
    } else if (c.kind === 'conversation' && c.taskId) {
      aliases.set(c.taskId, c.id);
    } else if (c.kind === 'task_folder' && c.path) {
      aliases.set(c.path, c.id);
      aliases.set(`task_folder:${c.path}`, c.id);
    }
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of selectedIds) {
    const key = String(raw || '').trim();
    if (!key) continue;
    const canon = aliases.get(key);
    if (!canon || seen.has(canon)) continue;
    seen.add(canon);
    out.push(canon);
  }
  return out;
}

export function resolveSelectedContextRefs(
  candidates: readonly WorkContextCandidate[],
  selectedIds: readonly string[],
): ResolvedContextSelection {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const canonical = canonicalizeContextSelectionIds(candidates, selectedIds);
  const artifactIds: string[] = [];
  const folderPaths: string[] = [];
  const preferenceEventIds: string[] = [];
  const conversationTaskIds: string[] = [];
  const seenArt = new Set<string>();
  const seenFolder = new Set<string>();
  const seenPref = new Set<string>();
  const seenConv = new Set<string>();

  for (const raw of canonical) {
    const hit = byId.get(raw);
    if (!hit) continue;
    if (hit.kind === 'artifact') {
      const artId = hit.id.replace(/^artifact:/, '');
      if (artId && !seenArt.has(artId)) {
        seenArt.add(artId);
        artifactIds.push(artId);
      }
    } else if (hit.kind === 'task_folder' && hit.path && !seenFolder.has(hit.path)) {
      seenFolder.add(hit.path);
      folderPaths.push(hit.path);
    } else if (hit.kind === 'preference') {
      const eventId = hit.eventId || hit.id.replace(/^preference:/, '');
      if (eventId && !seenPref.has(eventId)) {
        seenPref.add(eventId);
        preferenceEventIds.push(eventId);
      }
    } else if (hit.kind === 'conversation' && hit.taskId && !seenConv.has(hit.taskId)) {
      seenConv.add(hit.taskId);
      conversationTaskIds.push(hit.taskId);
    }
  }
  return { artifactIds, folderPaths, preferenceEventIds, conversationTaskIds };
}

export function mergeSelectedContextIds(
  planned: readonly string[] | undefined,
  resolved: readonly string[] | undefined,
): string[] {
  const extra = (resolved || []).map((id) => String(id || '').trim()).filter(Boolean);
  if (extra.length) return uniqueIds(extra);
  return uniqueIds((planned || []).map((id) => String(id || '').trim()).filter(Boolean));
}

function mergeLaneCandidates(lanes: readonly WorkContextCandidate[][]): WorkContextCandidate[] {
  const seen = new Set<string>();
  const out: WorkContextCandidate[] = [];
  for (const lane of lanes) {
    for (const c of lane) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
  }
  return out;
}

function uniqueIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out.slice(0, 12);
}

function conversationCandidateSummary(task: Task): string {
  const turns = task.meta?.conversation?.turns || [];
  const lastUser = [...turns].reverse().find((t) => t.role === 'user');
  const lastMe = [...turns].reverse().find((t) => t.role === 'digital_me');
  const parts: string[] = [];
  if (task.goal.trim()) parts.push(task.goal.trim());
  if (lastUser?.content?.trim() && lastUser.content.trim() !== task.goal.trim()) {
    parts.push(`用户：${lastUser.content.trim()}`);
  }
  if (lastMe?.content?.trim()) {
    parts.push(`此前回复：${lastMe.content.trim()}`);
  }
  const text = parts.join(' / ').replace(/\s+/g, ' ').trim();
  return text.slice(0, SUMMARY_CHARS);
}
