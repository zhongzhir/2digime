/**
 * 成熟 Coding runtime 候选。OpenCode 是当前第一候选，不是产品架构。
 */
import { readdirSync, promises as fs } from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  failedAcquire,
  readyAcquire,
  type AcquireCandidate,
  type AcquireContext,
  type AcquireResult,
  type AcquireSourceFailure,
} from './acquire-capability';
import { DownloadError, downloadVerifiedFile } from './http-download';
import { hiddenSpawnSyncOptions } from '../execution/hidden-spawn';
import {
  OPENCODE_ASSET_NAME,
  OPENCODE_ASSET_SHA256,
  OPENCODE_CANDIDATE_ID,
  OPENCODE_PINNED_VERSION,
  defaultOpencodeSources,
  type RuntimeAcquireSource,
} from './coding-runtime-manifest';

export {
  OPENCODE_CANDIDATE_ID,
  OPENCODE_PINNED_VERSION,
  OPENCODE_ASSET_NAME,
  OPENCODE_ASSET_SHA256,
} from './coding-runtime-manifest';

export interface OpenCodeAcquireDeps {
  sources?: RuntimeAcquireSource[];
  downloadTo?: typeof downloadVerifiedFile;
  extractZip?: (zipPath: string, destDir: string) => Promise<void>;
  probeVersion?: (exe: string) => string | null;
  expectedSha256?: string;
  expectedVersion?: string;
}

export function probeCachedOpencodeRuntime(
  runtimeRoot: string,
  expectedVersion: string = OPENCODE_PINNED_VERSION,
): boolean {
  const destDir = path.join(runtimeRoot, 'coding', OPENCODE_CANDIDATE_ID);
  const existing = findExe(destDir);
  if (!existing) return false;
  const version = probeOpencodeVersion(existing);
  return Boolean(version && versionMatches(version, expectedVersion));
}

function findExe(dir: string): string | null {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const nested = findExe(full);
        if (nested) return nested;
      } else if (/^opencode(\.exe)?$/i.test(entry.name)) {
        return full;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function probeOpencodeVersion(exe: string): string | null {
  const result = spawnSync(exe, ['--version'], hiddenSpawnSyncOptions({ encoding: 'utf8', timeout: 20_000 }));
  const text = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return result.status === 0 && text ? text.split(/\r?\n/)[0]!.trim() : null;
}

async function unlinkQuiet(file: string): Promise<void> {
  try {
    await fs.unlink(file);
  } catch {
    /* ignore */
  }
}

async function rmQuiet(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

export async function defaultExtractZip(zipPath: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
    ],
    { windowsHide: true, timeout: 120_000 },
  );
}

function versionMatches(probed: string, expected: string): boolean {
  return probed === expected || probed.includes(expected);
}

export function createOpenCodeWindowsCandidate(deps: OpenCodeAcquireDeps = {}): AcquireCandidate {
  const expectedSha = (deps.expectedSha256 || OPENCODE_ASSET_SHA256).toLowerCase();
  const expectedVersion = deps.expectedVersion || OPENCODE_PINNED_VERSION;
  const sources = deps.sources || defaultOpencodeSources();
  const downloadTo = deps.downloadTo || downloadVerifiedFile;
  const extractZip = deps.extractZip || defaultExtractZip;
  const probeVersion = deps.probeVersion || probeOpencodeVersion;

  return {
    id: OPENCODE_CANDIDATE_ID,
    async acquire(ctx: AcquireContext): Promise<AcquireResult> {
      const destDir = path.join(ctx.runtimeRoot, 'coding', OPENCODE_CANDIDATE_ID);
      const existing = findExe(destDir);
      if (existing) {
        const version = probeVersion(existing);
        if (version && versionMatches(version, expectedVersion)) {
          return readyAcquire({
            candidateId: OPENCODE_CANDIDATE_ID,
            runtimePath: existing,
            version: expectedVersion,
            source: 'cached',
          });
        }
        await rmQuiet(destDir);
      }

      const sourceFailures: AcquireSourceFailure[] = [];
      for (const source of sources) {
        if (ctx.signal?.aborted) {
          return failedAcquire({
            candidateId: OPENCODE_CANDIDATE_ID,
            failureKind: 'timeout',
            safeDetail: 'aborted',
            sourceFailures,
          });
        }
        const zipPath = path.join(ctx.runtimeRoot, 'download', `${source.id}-${OPENCODE_ASSET_NAME}`);
        try {
          await downloadTo({
            url: source.url,
            dest: zipPath,
            expectedSha256: expectedSha,
            ...(ctx.signal ? { signal: ctx.signal } : {}),
          });
          await extractZip(zipPath, destDir);
          const exe = findExe(destDir);
          if (!exe) {
            await unlinkQuiet(zipPath);
            await rmQuiet(destDir);
            sourceFailures.push({
              source: source.id,
              failureKind: 'extract',
              safeDetail: 'exe_missing',
            });
            continue;
          }
          const version = probeVersion(exe);
          if (!version || !versionMatches(version, expectedVersion)) {
            await unlinkQuiet(zipPath);
            await rmQuiet(destDir);
            sourceFailures.push({
              source: source.id,
              failureKind: 'version',
              safeDetail: 'version_mismatch',
            });
            continue;
          }
          return readyAcquire({
            candidateId: OPENCODE_CANDIDATE_ID,
            runtimePath: exe,
            version: expectedVersion,
            source: source.id,
            ...(sourceFailures.length ? { sourceFailures } : {}),
          });
        } catch (err) {
          await unlinkQuiet(zipPath);
          await rmQuiet(destDir);
          if (err instanceof DownloadError) {
            sourceFailures.push({
              source: source.id,
              failureKind: err.failureKind,
              safeDetail: err.safeDetail,
            });
          } else {
            sourceFailures.push({
              source: source.id,
              failureKind: 'extract',
              safeDetail: err instanceof Error ? err.message.slice(0, 240) : 'source_failed',
            });
          }
        }
      }
      const last = sourceFailures[sourceFailures.length - 1];
      return failedAcquire({
        candidateId: OPENCODE_CANDIDATE_ID,
        failureKind: last?.failureKind || 'ACQUISITION FAILURE',
        safeDetail: last?.safeDetail || 'all_sources_failed',
        sourceFailures,
      });
    },
  };
}

export function defaultCodingRuntimeCandidates(deps?: OpenCodeAcquireDeps): AcquireCandidate[] {
  return [createOpenCodeWindowsCandidate(deps)];
}
