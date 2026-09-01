import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile, readFileWithRecovery } from '../../infrastructure/fs-atomic';
import { DIGITAL_SELF_SCHEMA_VERSION, type DigitalSelf } from './types';

export const DIGITAL_SELF_REL_PATH = path.join('digital-self', 'self.json');

export function digitalSelfFilePath(packageRoot: string): string {
  return path.join(packageRoot, DIGITAL_SELF_REL_PATH);
}

export function emptyDigitalSelf(subjectId: string, now: string): DigitalSelf {
  return {
    schemaVersion: DIGITAL_SELF_SCHEMA_VERSION,
    subjectId,
    updatedAt: now,
    understandings: [],
  };
}

export async function readDigitalSelf(
  packageRoot: string,
  subjectId: string,
  now: string,
): Promise<DigitalSelf> {
  const file = digitalSelfFilePath(packageRoot);
  try {
    const recovered = await readFileWithRecovery(file, (content) => {
      try {
        const parsed = JSON.parse(content) as DigitalSelf;
        return (
          !!parsed &&
          parsed.schemaVersion === DIGITAL_SELF_SCHEMA_VERSION &&
          Array.isArray(parsed.understandings)
        );
      } catch {
        return false;
      }
    });
    if (!recovered.content) return emptyDigitalSelf(subjectId, now);
    const parsed = JSON.parse(recovered.content) as DigitalSelf;
    return {
      schemaVersion: DIGITAL_SELF_SCHEMA_VERSION,
      subjectId: parsed.subjectId || subjectId,
      updatedAt: parsed.updatedAt || now,
      understandings: parsed.understandings,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return emptyDigitalSelf(subjectId, now);
    throw err;
  }
}

export async function writeDigitalSelf(
  packageRoot: string,
  self: DigitalSelf,
): Promise<void> {
  const file = digitalSelfFilePath(packageRoot);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await atomicWriteFile(file, `${JSON.stringify(self, null, 2)}\n`);
}

export async function writeSourceCopy(
  packageRoot: string,
  digest: string,
  text: string,
): Promise<string> {
  const dir = path.join(packageRoot, 'digital-self', 'sources');
  await fs.mkdir(dir, { recursive: true });
  const rel = path.join('digital-self', 'sources', `${digest}.txt`);
  await atomicWriteFile(path.join(packageRoot, rel), text);
  return rel.replace(/\\/g, '/');
}
