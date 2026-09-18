import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { atomicWriteFile } from '../infrastructure/fs-atomic';

export interface InstallCapabilityTokenFile {
  version: 1;
  token: string;
  createdAt: string;
}

export function installCapabilityTokenPath(rootDir: string): string {
  return path.join(rootDir, 'install-capability-token.json');
}

/** 随机、不可表达偏好的安装能力令牌。只用于配额 / 滥用控制，不是用户画像 ID。 */
export async function readOrCreateInstallCapabilityToken(rootDir: string): Promise<string> {
  const file = installCapabilityTokenPath(rootDir);
  try {
    const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as InstallCapabilityTokenFile;
    const token = String(parsed.token || '').trim();
    if (token.length >= 32) return token;
  } catch {
    /* create */
  }
  const next: InstallCapabilityTokenFile = {
    version: 1,
    token: randomBytes(32).toString('hex'),
    createdAt: new Date().toISOString(),
  };
  await fs.mkdir(rootDir, { recursive: true });
  await atomicWriteFile(file, `${JSON.stringify(next, null, 2)}\n`);
  return next.token;
}
