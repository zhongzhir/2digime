import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile } from '../infrastructure/fs-atomic';

export type AiCapabilityPath = 'managed' | 'byok';

export interface AiCapabilityPreference {
  version: 1;
  path: AiCapabilityPath;
}

const FILE = 'ai-capability.json';

export function aiCapabilityPreferencePath(rootDir: string): string {
  return path.join(rootDir, FILE);
}

export function defaultAiCapabilityPreference(): AiCapabilityPreference {
  return { version: 1, path: 'managed' };
}

export async function readAiCapabilityPreference(rootDir: string): Promise<AiCapabilityPreference | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(aiCapabilityPreferencePath(rootDir), 'utf8')) as Partial<AiCapabilityPreference>;
    return {
      version: 1,
      path: parsed.path === 'byok' ? 'byok' : 'managed',
    };
  } catch {
    return null;
  }
}

export async function writeAiCapabilityPreference(
  rootDir: string,
  input: { path: AiCapabilityPath },
): Promise<AiCapabilityPreference> {
  const next: AiCapabilityPreference = {
    version: 1,
    path: input.path === 'byok' ? 'byok' : 'managed',
  };
  await fs.mkdir(rootDir, { recursive: true });
  await atomicWriteFile(aiCapabilityPreferencePath(rootDir), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/**
 * 已有连接用户保留 BYOK；全新安装默认 MANAGED。
 * 一旦写入 preference，后续服从文件，不因旧 Key 突然改路径。
 */
export async function readOrMigrateAiCapabilityPreference(
  rootDir: string,
  input: { hasByokKey: boolean },
): Promise<AiCapabilityPreference> {
  const existing = await readAiCapabilityPreference(rootDir);
  if (existing) return existing;
  const next: AiCapabilityPreference = {
    version: 1,
    path: input.hasByokKey ? 'byok' : 'managed',
  };
  await writeAiCapabilityPreference(rootDir, next);
  return next;
}
