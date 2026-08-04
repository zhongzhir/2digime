import type { ObjectStore } from '../runtime/ports';
import type { ContentStore } from '../infrastructure/content-store';
import { extractFile, extractFolder, type ExtractionOutcome } from '../infrastructure/extract';
import { newId, nowIso } from '../shared/ids';
import type { ContextRef, Task } from './task';
import type { ContextSnapshot, SnapshotIngestionMeta, SnapshotItem } from './context-snapshot';
import {
  DEFAULT_CONTEXT_INGESTION_POLICY,
  type ContextIngestionPolicy,
} from './context-policy';
import { ingestFolderRecursive, ingestSingleFile } from './recursive-ingest';

/**
 * ContextSnapshotBuilder — Job running 后异步构建不可变快照。
 * Task 1:N Snapshot;Job 1:1 Snapshot;重试默认新建。
 * P2.1:按 CapabilityRegistration.contextPolicy 执行通用摄取;
 * 未声明策略时保持 P1 document 行为逐字节不变。
 */
export class ContextSnapshotBuilder {
  constructor(
    private readonly snapshotStore: ObjectStore<ContextSnapshot>,
    private readonly contentStore: ContentStore,
  ) {}

  async build(task: Task, policy?: ContextIngestionPolicy): Promise<ContextSnapshot> {
    const effective = policy ?? DEFAULT_CONTEXT_INGESTION_POLICY;
    if (effective.folderTraversal === 'recursive') {
      return this.buildRecursive(task, effective);
    }
    return this.buildDocumentDefault(task);
  }

  async get(id: string): Promise<ContextSnapshot | null> {
    return this.snapshotStore.get(id);
  }

  async listByTask(taskId: string): Promise<ContextSnapshot[]> {
    return this.snapshotStore.list((s) => s.taskId === taskId);
  }

  /**
   * 将选定主体切片冻结进 ContentStore,并写回 Snapshot.subjectContextRef。
   * 不复制完整 GrowthEvent 日志。
   */
  async attachSubjectContext(
    snapshotId: string,
    freezeJson: string,
  ): Promise<ContextSnapshot> {
    const snapshot = await this.snapshotStore.get(snapshotId);
    if (!snapshot) throw new Error(`snapshot not found: ${snapshotId}`);
    const stored = await this.contentStore.putText(freezeJson, 'plain');
    if (stored.content.kind !== 'text') {
      throw new Error('subject context freeze must be stored as text');
    }
    const next: ContextSnapshot = {
      ...snapshot,
      subjectContextRef: stored.content.ref,
    };
    await this.snapshotStore.put(next);
    return next;
  }

  /** P1 文档路径 — 不得改动抽取语义。 */
  private async buildDocumentDefault(task: Task): Promise<ContextSnapshot> {
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
      ...(task.authorization ? { authorization: { ...task.authorization } } : {}),
    };
    await this.snapshotStore.put(snapshot);
    return snapshot;
  }

  private async buildRecursive(
    task: Task,
    policy: ContextIngestionPolicy,
  ): Promise<ContextSnapshot> {
    const items: SnapshotItem[] = [];
    const warningSet: string[] = [];
    let merged: SnapshotIngestionMeta = {
      truncated: false,
      skippedSensitiveCount: 0,
      skippedBudgetCount: 0,
      totalBytesScanned: 0,
      fileCountScanned: 0,
    };

    for (const ref of task.contextRefs) {
      if (ref.kind === 'file') {
        const result = await ingestSingleFile(ref.path, policy);
        for (const file of result.files) {
          items.push(await this.freezeIngested(file));
        }
        warningSet.push(...result.warnings);
        merged = {
          ...(result.ingestion.rootName || merged.rootName
            ? { rootName: merged.rootName ?? result.ingestion.rootName }
            : {}),
          truncated: merged.truncated || result.ingestion.truncated,
          skippedSensitiveCount:
            merged.skippedSensitiveCount + result.ingestion.skippedSensitiveCount,
          skippedBudgetCount: merged.skippedBudgetCount + result.ingestion.skippedBudgetCount,
          totalBytesScanned: merged.totalBytesScanned + result.ingestion.totalBytesScanned,
          fileCountScanned: merged.fileCountScanned + result.ingestion.fileCountScanned,
        };
        continue;
      }

      const result = await ingestFolderRecursive(ref.path, policy);
      for (const file of result.files) {
        items.push(await this.freezeIngested(file));
      }
      warningSet.push(...result.warnings);
      merged = {
        ...(result.ingestion.rootName || merged.rootName
          ? { rootName: merged.rootName ?? result.ingestion.rootName }
          : {}),
        truncated: merged.truncated || result.ingestion.truncated,
        skippedSensitiveCount:
          merged.skippedSensitiveCount + result.ingestion.skippedSensitiveCount,
        skippedBudgetCount: merged.skippedBudgetCount + result.ingestion.skippedBudgetCount,
        totalBytesScanned: merged.totalBytesScanned + result.ingestion.totalBytesScanned,
        fileCountScanned: merged.fileCountScanned + result.ingestion.fileCountScanned,
      };
    }

    if (merged.truncated && !warningSet.some((w) => w.includes('时间上限') || w.includes('部分'))) {
      warningSet.push('已达到扫描预算，输出为部分结果');
    }

    const snapshot: ContextSnapshot = {
      id: newId('snapshot'),
      taskId: task.id,
      createdAt: nowIso(),
      items,
      ingestion: merged,
      ...(task.authorization ? { authorization: { ...task.authorization } } : {}),
    };
    await this.snapshotStore.put(snapshot);
    return snapshot;
  }

  private async freezeIngested(file: {
    item: Omit<SnapshotItem, 'extractedTextRef'> & { text?: string };
  }): Promise<SnapshotItem> {
    const base = file.item;
    if (base.status !== 'ok' || base.text === undefined) {
      const item: SnapshotItem = {
        sourcePath: base.sourcePath,
        kind: base.kind,
        status: 'warning',
      };
      if (base.warning !== undefined) item.warning = sanitizeMessage(base.warning);
      if (base.relativePath !== undefined) item.relativePath = base.relativePath;
      return item;
    }
    const stored = await this.contentStore.putText(base.text, 'plain');
    const item: SnapshotItem = {
      sourcePath: base.sourcePath,
      kind: base.kind,
      status: 'ok',
      contentDigest: stored.digest,
    };
    if (stored.content.kind === 'text') {
      item.extractedTextRef = stored.content.ref;
    }
    if (base.relativePath !== undefined) item.relativePath = base.relativePath;
    if (base.bytes !== undefined) item.bytes = base.bytes;
    if (base.truncated) item.truncated = true;
    return item;
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
