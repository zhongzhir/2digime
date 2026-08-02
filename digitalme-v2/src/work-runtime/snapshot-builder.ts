import type { ObjectStore } from '../runtime/ports';
import type { ContentStore } from '../infrastructure/content-store';
import { extractFile, extractFolder, type ExtractionOutcome } from '../infrastructure/extract';
import { newId, nowIso } from '../shared/ids';
import type { ContextRef, Task } from './task';
import type { ContextSnapshot, SnapshotItem } from './context-snapshot';

/**
 * ContextSnapshotBuilder — Job running 后异步构建不可变快照。
 * Task 1:N Snapshot;Job 1:1 Snapshot;重试默认新建。
 * 字段映射冻结:sourcePath / kind / status / warning? / contentDigest / extractedTextRef。
 * 无 stale / materialsStale / planned digest。
 */
export class ContextSnapshotBuilder {
  constructor(
    private readonly snapshotStore: ObjectStore<ContextSnapshot>,
    private readonly contentStore: ContentStore,
  ) {}

  async build(task: Task): Promise<ContextSnapshot> {
    const items: SnapshotItem[] = [];
    for (const ref of task.contextRefs) {
      if (ref.kind === 'file') {
        items.push(await this.mapOutcome(await extractFile(ref.path), 'file'));
      } else {
        const outcomes = await extractFolder(ref.path);
        if (outcomes.length === 0) {
          items.push({
            sourcePath: ref.path,
            kind: 'folder-entry',
            status: 'warning',
            warning: 'folder empty or contains no supported files',
          });
        } else {
          for (const outcome of outcomes) {
            items.push(await this.mapOutcome(outcome, 'folder-entry'));
          }
        }
      }
    }

    const snapshot: ContextSnapshot = {
      id: newId('snapshot'),
      taskId: task.id,
      createdAt: nowIso(),
      items,
    };
    await this.snapshotStore.put(snapshot);
    return snapshot;
  }

  async get(id: string): Promise<ContextSnapshot | null> {
    return this.snapshotStore.get(id);
  }

  async listByTask(taskId: string): Promise<ContextSnapshot[]> {
    return this.snapshotStore.list((s) => s.taskId === taskId);
  }

  private async mapOutcome(
    outcome: ExtractionOutcome,
    kind: SnapshotItem['kind'],
  ): Promise<SnapshotItem> {
    if (outcome.status === 'warning' || outcome.text === undefined) {
      const item: SnapshotItem = {
        sourcePath: outcome.sourcePath,
        kind,
        status: 'warning',
      };
      if (outcome.warning !== undefined) item.warning = sanitizeMessage(outcome.warning);
      return item;
    }
    const stored = await this.contentStore.putText(outcome.text, 'plain');
    const item: SnapshotItem = {
      sourcePath: outcome.sourcePath,
      kind,
      status: 'ok',
      contentDigest: stored.digest,
    };
    if (stored.content.kind === 'text') {
      item.extractedTextRef = stored.content.ref;
    }
    return item;
  }
}

/** 错误/警告信息安全化:截断并剔除疑似密钥片段。 */
export function sanitizeMessage(message: string): string {
  const scrubbed = message
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/api[_-]?key["']?\s*[:=]\s*["']?[^"'&\s]+/gi, 'api_key=[redacted]');
  return scrubbed.slice(0, 500);
}

export function validateContextRefs(refs: ContextRef[]): void {
  for (const ref of refs) {
    if (ref.kind !== 'file' && ref.kind !== 'folder') {
      throw new Error(`invalid context ref kind`);
    }
    if (typeof ref.path !== 'string' || ref.path.trim().length === 0) {
      throw new Error('context ref path must not be empty');
    }
  }
}
