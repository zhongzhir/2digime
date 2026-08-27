/**
 * Cross-task context candidates — deterministic discovery only.
 * Relevance is decided by the planner, not keywords.
 */
import type { Artifact } from './artifact';
import type { Task } from './task';

export interface WorkContextCandidate {
  id: string;
  kind: 'artifact' | 'task_folder';
  title: string;
  summary: string;
  taskId: string;
  /** Absolute path when the candidate is an authorized folder. */
  path?: string;
}

const MAX_CANDIDATES = 12;
const SUMMARY_CHARS = 280;

export function buildWorkContextCandidates(input: {
  currentTaskId: string;
  tasks: readonly Task[];
  artifacts: readonly Artifact[];
  readArtifactText?: (artifact: Artifact) => string | undefined;
}): WorkContextCandidate[] {
  const out: WorkContextCandidate[] = [];
  const seen = new Set<string>();
  const tasks = input.tasks.filter((t) => t.id !== input.currentTaskId).slice(0, 20);
  const artifactsByTask = new Map<string, Artifact[]>();
  for (const art of input.artifacts) {
    const list = artifactsByTask.get(art.taskId) || [];
    list.push(art);
    artifactsByTask.set(art.taskId, list);
  }

  for (const task of tasks) {
    const arts = artifactsByTask.get(task.id) || [];
    for (const art of arts.slice(0, 2)) {
      const id = `artifact:${art.id}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const body = input.readArtifactText?.(art) || '';
      out.push({
        id,
        kind: 'artifact',
        title: String(art.title || task.goal).slice(0, 80),
        summary: (body || task.goal).replace(/\s+/g, ' ').trim().slice(0, SUMMARY_CHARS),
        taskId: task.id,
      });
      if (out.length >= MAX_CANDIDATES) return out;
    }
    for (const ref of task.contextRefs || []) {
      if (ref.kind !== 'folder' || !ref.path) continue;
      const id = `task_folder:${ref.path}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        kind: 'task_folder',
        title: task.goal.slice(0, 80),
        summary: `已授权项目目录：${ref.path}`,
        taskId: task.id,
        path: ref.path,
      });
      if (out.length >= MAX_CANDIDATES) return out;
    }
  }
  return out;
}

export function formatContextCandidateBrief(
  candidates: readonly WorkContextCandidate[],
): string {
  if (!candidates.length) return '';
  const lines = ['【可选用的已有上下文候选】', '仅在与当前目标真正相关时选用；不要把无关项目硬塞进方案。'];
  for (const c of candidates) {
    lines.push(`- ${c.id}｜${c.title}｜${c.summary}`);
  }
  return lines.join('\n');
}

export function resolveSelectedContextRefs(
  candidates: readonly WorkContextCandidate[],
  selectedIds: readonly string[],
): { artifactIds: string[]; folderPaths: string[] } {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const artifactIds: string[] = [];
  const folderPaths: string[] = [];
  for (const raw of selectedIds) {
    const hit = byId.get(String(raw || '').trim());
    if (!hit) continue;
    if (hit.kind === 'artifact') {
      const artId = hit.id.replace(/^artifact:/, '');
      if (artId) artifactIds.push(artId);
    } else if (hit.path) {
      folderPaths.push(hit.path);
    }
  }
  return { artifactIds, folderPaths };
}
