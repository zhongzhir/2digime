/**
 * 成熟 Coding runtime 候选。OpenCode 是当前第一候选，不是产品架构。
 */
import { createWriteStream, readdirSync, promises as fs } from 'node:fs';
import * as http from 'node:https';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { AcquireCandidate, AcquireContext, AcquireResult } from './acquire-capability';
import { hiddenSpawnSyncOptions } from '../execution/hidden-spawn';

export const OPENCODE_CANDIDATE_ID = 'opencode-windows-cli';
const OPENCODE_RELEASE_API = 'https://api.github.com/repos/anomalyco/opencode/releases/latest';
const OPENCODE_ASSET = 'opencode-windows-x64.zip';

export interface OpenCodeAcquireDeps {
  downloadTo?: (url: string, dest: string, signal?: AbortSignal) => Promise<void>;
  extractZip?: (zipPath: string, destDir: string) => Promise<void>;
  resolveAsset?: () => Promise<{ version: string; url: string }>;
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

function probeVersion(exe: string): string | null {
  const result = spawnSync(exe, ['--version'], hiddenSpawnSyncOptions({ encoding: 'utf8', timeout: 20_000 }));
  const text = `${result.stdout || ''}${result.stderr || ''}`.trim();
  return result.status === 0 && text ? text.split(/\r?\n/)[0]!.trim() : null;
}

async function defaultDownload(url: string, dest: string, signal?: AbortSignal): Promise<void> {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const req = http.get(
      url,
      { headers: { 'User-Agent': '2digime', Accept: 'application/octet-stream' } },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          defaultDownload(res.headers.location, dest, signal).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`download_http_${res.statusCode || 0}`));
          return;
        }
        const out = createWriteStream(dest);
        res.pipe(out);
        out.on('finish', () => out.close(() => resolve()));
        out.on('error', reject);
      },
    );
    req.on('error', reject);
    if (signal) {
      if (signal.aborted) req.destroy();
      signal.addEventListener('abort', () => req.destroy(), { once: true });
    }
  });
}

async function defaultExtract(zipPath: string, destDir: string): Promise<void> {
  await fs.mkdir(destDir, { recursive: true });
  const { execFileSync } = require('node:child_process') as typeof import('node:child_process');
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`],
    { windowsHide: true, timeout: 120_000 },
  );
}

async function defaultResolveAsset(): Promise<{ version: string; url: string }> {
  const raw = await new Promise<string>((resolve, reject) => {
    http
      .get(OPENCODE_RELEASE_API, { headers: { 'User-Agent': '2digime', Accept: 'application/vnd.github+json' } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      })
      .on('error', reject);
  });
  const parsed = JSON.parse(raw) as { tag_name?: string; assets?: Array<{ name?: string; browser_download_url?: string }> };
  const asset = (parsed.assets || []).find((item) => item.name === OPENCODE_ASSET);
  if (!asset?.browser_download_url) throw new Error('asset_missing');
  return { version: String(parsed.tag_name || '').replace(/^v/, ''), url: asset.browser_download_url };
}

export function createOpenCodeWindowsCandidate(deps: OpenCodeAcquireDeps = {}): AcquireCandidate {
  return {
    id: OPENCODE_CANDIDATE_ID,
    async acquire(ctx: AcquireContext): Promise<AcquireResult> {
      const destDir = path.join(ctx.runtimeRoot, 'coding', OPENCODE_CANDIDATE_ID);
      const existing = findExe(destDir);
      if (existing) {
        const version = probeVersion(existing);
        if (version) {
          return { status: 'ready', candidateId: OPENCODE_CANDIDATE_ID, runtimePath: existing, version };
        }
      }
      try {
        const asset = await (deps.resolveAsset || defaultResolveAsset)();
        const zipPath = path.join(ctx.runtimeRoot, 'download', OPENCODE_ASSET);
        await fs.mkdir(path.dirname(zipPath), { recursive: true });
        await (deps.downloadTo || defaultDownload)(asset.url, zipPath, ctx.signal);
        await (deps.extractZip || defaultExtract)(zipPath, destDir);
        const exe = findExe(destDir);
        if (!exe) {
          return { status: 'failed', failureKind: 'RUNTIME FAILURE', detail: 'exe_missing' };
        }
        const version = probeVersion(exe);
        if (!version) {
          return { status: 'failed', failureKind: 'RUNTIME FAILURE', detail: 'version_probe_failed' };
        }
        return { status: 'ready', candidateId: OPENCODE_CANDIDATE_ID, runtimePath: exe, version };
      } catch (err) {
        return {
          status: 'failed',
          failureKind: 'ACQUISITION FAILURE',
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}

export function defaultCodingRuntimeCandidates(deps?: OpenCodeAcquireDeps): AcquireCandidate[] {
  return [createOpenCodeWindowsCandidate(deps)];
}
