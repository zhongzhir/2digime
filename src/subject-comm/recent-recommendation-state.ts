/**
 * 本机短期推荐上下文。衰减、可清空。
 * 不写 Digital Self，不写 explicit preference，不上传 Directory / Relay。
 * 未来 hook：同一主题持续出现时，可询问是否升格为 explicit preference。本轮不实现升格。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { atomicWriteFile } from '../infrastructure/fs-atomic';

export const RECENT_EVENT_TYPES = ['opened', 'asked_2digime', 'seek_topic'] as const;
export type RecentEventType = (typeof RECENT_EVENT_TYPES)[number];

export interface RecentRecommendationEvent {
  type: RecentEventType;
  at: string;
  itemId?: string;
  title?: string;
  topic?: string;
}

interface RecentFile {
  version: 1;
  events: RecentRecommendationEvent[];
}

const TYPE_SET = new Set<string>(RECENT_EVENT_TYPES);
const TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_EVENTS = 40;
const FORMAT_LIMIT = 12;

export function recentRecommendationPath(packageRoot: string): string {
  return path.join(packageRoot, 'content', 'recent-recommendation-state.json');
}

function emptyFile(): RecentFile {
  return { version: 1, events: [] };
}

function notExpired(event: RecentRecommendationEvent, nowMs: number): boolean {
  const at = Date.parse(event.at);
  if (!Number.isFinite(at)) return false;
  return nowMs - at <= TTL_MS;
}

function sanitize(raw: unknown, nowMs: number): RecentRecommendationEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: RecentRecommendationEvent[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    const type = String(rec.type || '');
    if (!TYPE_SET.has(type)) continue;
    const event: RecentRecommendationEvent = {
      type: type as RecentEventType,
      at: String(rec.at || ''),
    };
    if (!notExpired(event, nowMs)) continue;
    const itemId = String(rec.itemId || '').trim();
    const title = String(rec.title || '').trim().slice(0, 180);
    const topic = String(rec.topic || '').trim().slice(0, 120);
    if (itemId) event.itemId = itemId;
    if (title) event.title = title;
    if (topic) event.topic = topic;
    out.push(event);
  }
  return out.slice(-MAX_EVENTS);
}

async function readFile(packageRoot: string, nowMs: number): Promise<RecentFile> {
  try {
    const parsed = JSON.parse(await fs.readFile(recentRecommendationPath(packageRoot), 'utf8')) as RecentFile;
    return { version: 1, events: sanitize(parsed.events, nowMs) };
  } catch {
    return emptyFile();
  }
}

async function writeFile(packageRoot: string, file: RecentFile): Promise<void> {
  await fs.mkdir(path.dirname(recentRecommendationPath(packageRoot)), { recursive: true });
  await atomicWriteFile(recentRecommendationPath(packageRoot), `${JSON.stringify(file, null, 2)}\n`);
}

export async function listRecentRecommendationEvents(
  packageRoot: string,
  now?: string,
): Promise<RecentRecommendationEvent[]> {
  const nowMs = Date.parse(now || new Date().toISOString()) || Date.now();
  return (await readFile(packageRoot, nowMs)).events;
}

export async function appendRecentRecommendationEvent(
  packageRoot: string,
  event: Omit<RecentRecommendationEvent, 'at'> & { at?: string },
): Promise<void> {
  const at = event.at || new Date().toISOString();
  const nowMs = Date.parse(at) || Date.now();
  const file = await readFile(packageRoot, nowMs);
  const next: RecentRecommendationEvent = { type: event.type, at };
  if (event.itemId) next.itemId = event.itemId;
  if (event.title) next.title = event.title.slice(0, 180);
  if (event.topic) next.topic = event.topic.slice(0, 120);
  file.events = sanitize([...file.events, next], nowMs);
  await writeFile(packageRoot, file);
}

export async function resetRecentRecommendationState(packageRoot: string): Promise<void> {
  await writeFile(packageRoot, emptyFile());
}

export function openedItemIds(events: RecentRecommendationEvent[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (event.type !== 'opened' || !event.itemId || seen.has(event.itemId)) continue;
    seen.add(event.itemId);
    ids.push(event.itemId);
  }
  return ids;
}

export function formatRecentRecommendationContext(
  events: RecentRecommendationEvent[],
  options?: { includeOneOffSeeks?: boolean },
): string {
  const rows = events.slice(-FORMAT_LIMIT);
  if (!rows.length) return '';
  const opened = rows.filter((row) => row.type === 'opened' && (row.title || row.itemId));
  const asked = rows.filter((row) => row.type === 'asked_2digime' && (row.title || row.itemId));
  const seeks =
    options?.includeOneOffSeeks === false
      ? []
      : rows.filter((row) => row.type === 'seek_topic' && row.topic);
  const lines = [
    '近期内容上下文（只存在本机、会过期、可重置，不是长期偏好，不要写成「用户喜欢」）：',
  ];
  if (opened.length) {
    lines.push(`最近打开（打开不等于喜欢）：${opened.map((row) => row.title || row.itemId).join('；')}`);
  }
  if (asked.length) {
    lines.push(`最近问兔机米：${asked.map((row) => row.title || row.itemId).join('；')}`);
  }
  if (seeks.length) {
    lines.push(
      `一次性检索（不是长期兴趣，不要写成默认栏目）：${seeks.map((row) => row.topic).join('；')}`,
    );
  }
  return lines.join('\n');
}
