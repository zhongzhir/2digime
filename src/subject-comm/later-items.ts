/**
 * 用户的「稍后看」收藏。不是第二套内容库，只记住已有条目的稳定标识和展示信息。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile } from '../infrastructure/fs-atomic';
import type { DiscoverCard } from './content-discover';

export interface LaterItem {
  itemId: string;
  url: string;
  title: string;
  text: string;
  publisher: string;
  savedAt: string;
}

interface LaterFile {
  version: 1;
  items: LaterItem[];
}

export function laterItemsPath(packageRoot: string): string {
  return path.join(packageRoot, 'content', 'later-items.json');
}

function emptyFile(): LaterFile {
  return { version: 1, items: [] };
}

export async function listLaterItems(packageRoot: string): Promise<LaterItem[]> {
  try {
    const raw = JSON.parse(await fs.readFile(laterItemsPath(packageRoot), 'utf8')) as LaterFile;
    return Array.isArray(raw.items) ? raw.items.filter((row) => row && row.itemId) : [];
  } catch {
    return [];
  }
}

export async function saveLaterItem(packageRoot: string, item: LaterItem): Promise<void> {
  const current = await listLaterItems(packageRoot);
  const next = [item, ...current.filter((row) => row.itemId !== item.itemId)].slice(0, 200);
  await atomicWriteFile(laterItemsPath(packageRoot), JSON.stringify({ version: 1, items: next } satisfies LaterFile, null, 2));
}

export function laterCards(rows: LaterItem[], liveIds: Set<string>): DiscoverCard[] {
  return rows.map((row) => {
    const available = liveIds.has(row.itemId);
    return {
      itemId: row.itemId,
      title: row.title || row.url || row.itemId,
      text: available ? row.text : `${row.text ? `${row.text} ` : ''}来源暂时打不开，收藏仍在。`.trim(),
      ...(row.url ? { url: row.url } : {}),
      ...(row.publisher ? { publisherDisplayName: row.publisher } : {}),
      reason: available ? '稍后看' : '稍后看 · 来源暂时打不开',
      source: 'directory',
      unavailable: !available,
    };
  });
}
