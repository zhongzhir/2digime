/**
 * 独立变更采集 — 结合 Git 与执行前后文件摘要；不采信执行器自报。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { nowIso } from '../shared/ids';
import {
  computeScopeDigest,
  isPathWithinScope,
  sha256,
} from './baseline';
import type {
  CollectedChange,
  CollectedExecutionChanges,
  ExecutionBaseline,
} from './external-executor-contract';

export async function collectExecutionChanges(input: {
  baseline: ExecutionBaseline;
  jobEvidenceDir: string;
  /** 本轮相对执行前快照无改动时，把范围内相对 HEAD 的未提交改动当作可交付结果。 */
  includeDirtyVersusHeadWhenUnchanged?: boolean;
}): Promise<CollectedExecutionChanges> {
  const root = path.resolve(input.baseline.workingDirectory);
  const beforeMap = new Map(
    input.baseline.scopedFiles.map((f) => [f.relativePath, f] as const),
  );
  const afterFiles = await listScopedFiles(root, input.baseline.writeScope);
  const afterMap = new Map(afterFiles.map((f) => [f.relativePath, f] as const));

  const changes: CollectedChange[] = [];
  const allKeys = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  for (const rel of [...allKeys].sort()) {
    const before = beforeMap.get(rel);
    const after = afterMap.get(rel);
    const within = isPathWithinScope(root, rel, input.baseline.writeScope);
    if (!before && after) {
      changes.push({
        relativePath: rel,
        changeType: 'added',
        beforeDigest: null,
        afterDigest: after.digest,
        withinWriteScope: within,
      });
    } else if (before && !after) {
      changes.push({
        relativePath: rel,
        changeType: 'deleted',
        beforeDigest: before.digest,
        afterDigest: null,
        withinWriteScope: within,
      });
    } else if (before && after && before.digest !== after.digest) {
      changes.push({
        relativePath: rel,
        changeType: 'modified',
        beforeDigest: before.digest,
        afterDigest: after.digest,
        withinWriteScope: within,
      });
    }
  }

  // 范围外：对比 outsideSamples + 扫描是否出现新文件
  const outsideBefore = new Map(
    input.baseline.outsideSamples.map((f) => [f.relativePath, f.digest] as const),
  );
  const allNow = await listAllRelative(root);
  for (const rel of allNow) {
    if (isPathWithinScope(root, rel, input.baseline.writeScope)) continue;
    const prev = outsideBefore.get(rel);
    let dig: string | null = null;
    try {
      dig = sha256(await fs.readFile(path.join(root, rel)));
    } catch {
      dig = null;
    }
    if (prev === undefined) {
      // 新出现在范围外 — 可能越界新增
      changes.push({
        relativePath: rel,
        changeType: 'added',
        beforeDigest: null,
        afterDigest: dig,
        withinWriteScope: false,
      });
    } else if (prev !== dig) {
      changes.push({
        relativePath: rel,
        changeType: 'modified',
        beforeDigest: prev,
        afterDigest: dig,
        withinWriteScope: false,
      });
    }
  }
  for (const [rel, prevDig] of outsideBefore) {
    if (allNow.includes(rel)) continue;
    changes.push({
      relativePath: rel,
      changeType: 'deleted',
      beforeDigest: prevDig,
      afterDigest: null,
      withinWriteScope: false,
    });
  }

  const gitCheck = checkGitIntegrity(root, input.baseline.git?.head ?? null);

  let withinChanges = changes.filter((c) => c.withinWriteScope);
  if (
    input.includeDirtyVersusHeadWhenUnchanged &&
    withinChanges.length === 0 &&
    input.baseline.git?.hasRepo
  ) {
    const dirty = listGitDirtyRelative(root).filter((rel) =>
      isPathWithinScope(root, rel, input.baseline.writeScope),
    );
    for (const rel of dirty) {
      const after = afterMap.get(rel);
      changes.push({
        relativePath: rel,
        changeType: after ? 'modified' : 'deleted',
        beforeDigest: input.baseline.git.head || 'HEAD',
        afterDigest: after?.digest ?? null,
        withinWriteScope: true,
      });
    }
  }

  const outOfScopeChanges = changes
    .filter((c) => !c.withinWriteScope)
    .map((c) => c.relativePath);
  withinChanges = changes.filter((c) => c.withinWriteScope);
  const changedFiles = withinChanges.map((c) => c.relativePath);
  const untrackedCreated = withinChanges
    .filter((c) => c.changeType === 'added')
    .map((c) => c.relativePath);
  const untrackedDeleted = withinChanges
    .filter((c) => c.changeType === 'deleted')
    .map((c) => c.relativePath);

  const afterScopeDigest = await computeScopeDigest(root, input.baseline.writeScope);
  // 并发：若执行前后「非执行器预期」——这里用二次采样：调用方应在执行刚结束时采集；
  // 另存 midDigest 由 orchestrator 传入更准确。此处用 after vs baseline 之外的文件 mtime 难判，
  // orchestrator 会在执行前后各算一次 scopeDigest 传入。默认 false，由入参覆盖。

  let unifiedDiff = '';
  if (input.baseline.git?.hasRepo) {
    unifiedDiff = buildGitDiff(root, withinChanges);
  } else {
    unifiedDiff = await buildSyntheticDiff(root, input.baseline, withinChanges);
  }

  const collected: CollectedExecutionChanges = {
    collectedAt: nowIso(),
    changes,
    changedFiles,
    outOfScopeChanges,
    concurrentModificationSuspected: false,
    gitHeadMoved: gitCheck.headMoved,
    newCommitsDetected: gitCheck.newCommits,
    unifiedDiff,
    afterScopeDigest,
    untrackedCreated,
    untrackedDeleted,
  };

  await fs.writeFile(
    path.join(input.jobEvidenceDir, 'collected-changes.json'),
    JSON.stringify(
      {
        ...collected,
        unifiedDiff: undefined,
        unifiedDiffBytes: Buffer.byteLength(unifiedDiff, 'utf8'),
      },
      null,
      2,
    ),
    'utf8',
  );
  await fs.writeFile(path.join(input.jobEvidenceDir, 'patch.diff'), unifiedDiff, 'utf8');
  return collected;
}

export function markConcurrentIfNeeded(
  collected: CollectedExecutionChanges,
  preRunScopeDigest: string,
  postRunPreCollectDigest: string,
): CollectedExecutionChanges {
  if (
    preRunScopeDigest &&
    postRunPreCollectDigest &&
    preRunScopeDigest !== collected.afterScopeDigest &&
    // 若仅有执行器改动，afterScopeDigest 应等于采集结果；
    // 并发嫌疑：执行开始时 digest 与「刚结束尚未采集」之间，外部又改了。
    // 简化：若调用方提供的 mid digest 与最终 after 不一致，则怀疑并发。
    postRunPreCollectDigest !== collected.afterScopeDigest
  ) {
    return { ...collected, concurrentModificationSuspected: true };
  }
  // 另一路径：baseline.scopeDigest 在执行期间被第三方改到与 collector 观察到的不一致模式
  void preRunScopeDigest;
  return collected;
}

async function listScopedFiles(
  root: string,
  writeScope: string[],
): Promise<Array<{ relativePath: string; digest: string | null }>> {
  const all = await listAllRelative(root);
  const out: Array<{ relativePath: string; digest: string | null }> = [];
  for (const rel of all) {
    if (!isPathWithinScope(root, rel, writeScope)) continue;
    try {
      out.push({ relativePath: rel, digest: sha256(await fs.readFile(path.join(root, rel))) });
    } catch {
      out.push({ relativePath: rel, digest: null });
    }
  }
  return out;
}

async function listAllRelative(root: string): Promise<string[]> {
  const IGNORE = new Set([
    'node_modules',
    'dist',
    '.git',
    'release-staging',
    'coverage',
    '.next',
    'out',
    '_evidence',
    'baseline-backups',
  ]);
  const out: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (IGNORE.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out.push(path.relative(root, full).replace(/\\/g, '/'));
    }
  }
  await walk(root);
  out.sort();
  return out;
}

function listGitDirtyRelative(root: string): string[] {
  const names = new Set<string>();
  const tracked = spawnSync('git', ['diff', '--name-only', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  for (const blob of [tracked.stdout, untracked.stdout]) {
    for (const line of String(blob || '').split(/\r?\n/)) {
      const rel = line.trim().replace(/\\/g, '/');
      if (rel) names.add(rel);
    }
  }
  return [...names].sort();
}

function checkGitIntegrity(
  root: string,
  expectedHead: string | null,
): { headMoved: boolean; newCommits: boolean } {
  if (!expectedHead) return { headMoved: false, newCommits: false };
  const head = spawnSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (head.status !== 0) return { headMoved: false, newCommits: false };
  const current = String(head.stdout || '').trim();
  const moved = current !== expectedHead;
  return { headMoved: moved, newCommits: moved };
}

function buildGitDiff(
  root: string,
  changes: CollectedChange[],
): string {
  // 使用工作区 diff（含未跟踪需特殊处理）
  const tracked = spawnSync('git', ['diff', '--', '.'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  const parts: string[] = [];
  if (tracked.status === 0 && tracked.stdout) parts.push(String(tracked.stdout));
  const cached = spawnSync('git', ['diff', '--cached', '--', '.'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (cached.status === 0 && cached.stdout) parts.push(String(cached.stdout));
  for (const c of changes) {
    if (c.changeType !== 'added') continue;
    const show = spawnSync('git', ['diff', '--no-index', '--', '/dev/null', c.relativePath], {
      cwd: root,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      maxBuffer: 5 * 1024 * 1024,
    });
    // git diff --no-index 在有差异时 exit 1
    if (show.stdout) parts.push(String(show.stdout));
  }
  if (parts.join('').trim()) return parts.join('\n');
  return changes.map((c) => `# ${c.changeType} ${c.relativePath}`).join('\n') + '\n';
}

async function buildSyntheticDiff(
  root: string,
  baseline: ExecutionBaseline,
  changes: CollectedChange[],
): Promise<string> {
  const lines: string[] = [`# synthetic diff (non-git) @ ${nowIso()}`, ''];
  for (const c of changes) {
    lines.push(`## ${c.changeType} ${c.relativePath}`);
    if (c.changeType === 'deleted') {
      const b = baseline.scopedFiles.find((f) => f.relativePath === c.relativePath);
      if (b?.backupRelPath) {
        try {
          // backup 在 jobEvidenceDir，此处仅注明
          lines.push(`(deleted; baseline digest ${c.beforeDigest})`);
        } catch {
          lines.push('(deleted)');
        }
      } else {
        lines.push(`(deleted; digest ${c.beforeDigest})`);
      }
      continue;
    }
    try {
      const text = await fs.readFile(path.join(root, c.relativePath), 'utf8');
      lines.push('```');
      lines.push(text.slice(0, 8000));
      lines.push('```');
    } catch {
      lines.push(`(unreadable; digest ${c.afterDigest})`);
    }
    lines.push('');
  }
  void root;
  return lines.join('\n');
}
