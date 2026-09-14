/**
 * 用户拥有的内容偏好指令。不是 Digital Self，不是中心画像。
 * 只有 origin=user_action 的显式操作可以写入；打开/稍后看不得改这里。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile } from '../infrastructure/fs-atomic';

export const CONTENT_PREFERENCE_KINDS = ['boost', 'reduce', 'follow', 'block'] as const;
export type ContentPreferenceKind = (typeof CONTENT_PREFERENCE_KINDS)[number];

export interface ContentPreferenceDirective {
  id: string;
  kind: ContentPreferenceKind;
  targetType: 'item' | 'source';
  target: string;
  text: string;
  origin: 'user_action';
  updatedAt: string;
}

interface PreferenceFile {
  version: 1;
  directives: ContentPreferenceDirective[];
}

const KIND_SET = new Set<string>(CONTENT_PREFERENCE_KINDS);

export function contentPreferencesPath(packageRoot: string): string {
  return path.join(packageRoot, 'content', 'content-preferences.json');
}

export function formatPreferenceDirectives(directives: ContentPreferenceDirective[]): string {
  if (!directives.length) return '';
  return directives.map((row) => `- [${row.kind}] ${row.text}`).join('\n');
}

function emptyFile(): PreferenceFile {
  return { version: 1, directives: [] };
}

async function readFile(packageRoot: string): Promise<PreferenceFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(contentPreferencesPath(packageRoot), 'utf8')) as PreferenceFile;
    const directives = Array.isArray(parsed.directives)
      ? parsed.directives.filter((row) => row && row.origin === 'user_action' && KIND_SET.has(row.kind))
      : [];
    return { version: 1, directives };
  } catch {
    return emptyFile();
  }
}

async function writeFile(packageRoot: string, file: PreferenceFile): Promise<void> {
  await fs.mkdir(path.dirname(contentPreferencesPath(packageRoot)), { recursive: true });
  await atomicWriteFile(contentPreferencesPath(packageRoot), `${JSON.stringify(file, null, 2)}\n`);
}

export async function listContentPreferences(packageRoot: string): Promise<ContentPreferenceDirective[]> {
  return (await readFile(packageRoot)).directives;
}

export async function upsertContentPreference(
  packageRoot: string,
  input: {
    kind: ContentPreferenceKind;
    targetType: 'item' | 'source';
    target: string;
    text: string;
    now?: string;
  },
): Promise<ContentPreferenceDirective> {
  const now = input.now || new Date().toISOString();
  const file = await readFile(packageRoot);
  const target = input.target.trim();
  const existing = file.directives.find(
    (row) => row.targetType === input.targetType && row.target === target,
  );
  const next: ContentPreferenceDirective = {
    id: existing?.id || `cp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    kind: input.kind,
    targetType: input.targetType,
    target,
    text: input.text.trim().slice(0, 240),
    origin: 'user_action',
    updatedAt: now,
  };
  file.directives = file.directives.filter(
    (row) => !(row.targetType === input.targetType && row.target === target),
  );
  file.directives.push(next);
  await writeFile(packageRoot, file);
  return next;
}

export async function reverseContentPreference(packageRoot: string, directiveId: string): Promise<boolean> {
  const file = await readFile(packageRoot);
  const next = file.directives.filter((row) => row.id !== directiveId);
  if (next.length === file.directives.length) return false;
  await writeFile(packageRoot, { version: 1, directives: next });
  return true;
}
