import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile } from '../infrastructure/fs-atomic';

export type WebDiscoveryPath = 'managed' | 'byok';

export interface WebDiscoveryPreference {
  version: 1;
  enabled: boolean;
  path: WebDiscoveryPath;
}

const FILE = 'web-discovery.json';

export function webDiscoveryPreferencePath(rootDir: string): string {
  return path.join(rootDir, FILE);
}

export function defaultWebDiscoveryPreference(): WebDiscoveryPreference {
  return { version: 1, enabled: true, path: 'managed' };
}

export async function readWebDiscoveryPreference(rootDir: string): Promise<WebDiscoveryPreference> {
  try {
    const parsed = JSON.parse(await fs.readFile(webDiscoveryPreferencePath(rootDir), 'utf8')) as Partial<WebDiscoveryPreference>;
    return {
      version: 1,
      enabled: parsed.enabled !== false,
      path: parsed.path === 'byok' ? 'byok' : 'managed',
    };
  } catch {
    return defaultWebDiscoveryPreference();
  }
}

export async function writeWebDiscoveryPreference(
  rootDir: string,
  input: { enabled?: boolean; path?: WebDiscoveryPath },
): Promise<WebDiscoveryPreference> {
  const current = await readWebDiscoveryPreference(rootDir);
  const next: WebDiscoveryPreference = {
    version: 1,
    enabled: input.enabled !== undefined ? !!input.enabled : current.enabled,
    path: input.path === 'byok' || input.path === 'managed' ? input.path : current.path,
  };
  await fs.mkdir(rootDir, { recursive: true });
  await atomicWriteFile(webDiscoveryPreferencePath(rootDir), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}
