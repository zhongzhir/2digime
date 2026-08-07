/**
 * 安全恢复 — 只恢复本次执行器造成的变化；禁止 git reset --hard。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { CollectedExecutionChanges, ExecutionBaseline } from './external-executor-contract';
import { sha256 } from './baseline';

export interface RestoreResult {
  ok: boolean;
  restored: string[];
  skippedUserEdited: string[];
  conflicts: string[];
  message: string;
}

/**
 * 将工作目录恢复到执行前基线（仅范围内、且当前内容仍等于执行后采集值的文件）。
 * 若文件在采集后又被用户修改 → 冲突，停止对该文件的恢复。
 */
export async function restoreExecutionBaseline(input: {
  baseline: ExecutionBaseline;
  collected: CollectedExecutionChanges;
  jobEvidenceDir: string;
}): Promise<RestoreResult> {
  const root = path.resolve(input.baseline.workingDirectory);
  const restored: string[] = [];
  const skippedUserEdited: string[] = [];
  const conflicts: string[] = [];

  const afterByPath = new Map(
    input.collected.changes.map((c) => [c.relativePath, c] as const),
  );

  for (const change of input.collected.changes) {
    if (!change.withinWriteScope) continue;
    const abs = path.join(root, change.relativePath);

    // 当前内容是否仍等于采集时 afterDigest？若否 → 用户又改了
    let currentDigest: string | null = null;
    let exists = true;
    try {
      currentDigest = sha256(await fs.readFile(abs));
    } catch {
      exists = false;
      currentDigest = null;
    }

    if (change.changeType === 'added') {
      if (!exists) {
        skippedUserEdited.push(change.relativePath);
        continue;
      }
      if (change.afterDigest && currentDigest !== change.afterDigest) {
        conflicts.push(change.relativePath);
        continue;
      }
      try {
        await fs.unlink(abs);
        restored.push(change.relativePath);
      } catch (error) {
        conflicts.push(change.relativePath);
        void error;
      }
      continue;
    }

    if (change.changeType === 'deleted') {
      // 恢复删除：从备份写回；若用户已自行重建且内容不同 → 冲突
      const baselineFile = input.baseline.scopedFiles.find(
        (f) => f.relativePath === change.relativePath,
      );
      if (!baselineFile?.backupRelPath) {
        conflicts.push(change.relativePath);
        continue;
      }
      if (exists && change.beforeDigest && currentDigest && currentDigest !== change.beforeDigest) {
        // 用户已放回不同内容
        conflicts.push(change.relativePath);
        continue;
      }
      if (exists && currentDigest === change.beforeDigest) {
        skippedUserEdited.push(change.relativePath);
        continue;
      }
      const backupAbs = path.join(input.jobEvidenceDir, baselineFile.backupRelPath);
      try {
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.copyFile(backupAbs, abs);
        restored.push(change.relativePath);
      } catch {
        conflicts.push(change.relativePath);
      }
      continue;
    }

    if (change.changeType === 'modified') {
      if (!exists) {
        conflicts.push(change.relativePath);
        continue;
      }
      if (change.afterDigest && currentDigest !== change.afterDigest) {
        conflicts.push(change.relativePath);
        continue;
      }
      const baselineFile = input.baseline.scopedFiles.find(
        (f) => f.relativePath === change.relativePath,
      );
      if (!baselineFile?.backupRelPath) {
        conflicts.push(change.relativePath);
        continue;
      }
      const backupAbs = path.join(input.jobEvidenceDir, baselineFile.backupRelPath);
      try {
        await fs.copyFile(backupAbs, abs);
        restored.push(change.relativePath);
      } catch {
        conflicts.push(change.relativePath);
      }
    }
  }

  void afterByPath;

  if (conflicts.length > 0) {
    return {
      ok: false,
      restored,
      skippedUserEdited,
      conflicts,
      message: `已恢复 ${restored.length} 个文件，但有 ${conflicts.length} 个文件因与你之后的手工修改冲突而停止，请手动处理：${conflicts.slice(0, 5).join(', ')}`,
    };
  }

  return {
    ok: true,
    restored,
    skippedUserEdited,
    conflicts,
    message:
      restored.length > 0
        ? `已恢复本次执行前的 ${restored.length} 个文件状态。`
        : '没有需要恢复的变更。',
  };
}
