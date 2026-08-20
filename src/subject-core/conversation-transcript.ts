/**
 * 对话 transcript 辅助 — 追加式 NDJSON。
 * 成长捕获状态以独立行追加，不改写历史消息行；读层忽略内部状态。
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export type ConversationTurnRole = 'user' | 'assistant' | 'system';

export interface ConversationTurn {
  id: string;
  role: ConversationTurnRole;
  text: string;
  at: string;
}

export type GrowthCaptureStatusValue =
  | 'pending'
  | 'ok_empty'
  | 'ok_learned'
  | 'ok_pending_confirmation'
  | 'failed'
  | 'skipped';

export interface GrowthCaptureStatusRecord {
  kind: 'growth_capture_status';
  turnId: string;
  status: GrowthCaptureStatusValue;
  attempts: number;
  updatedAt: string;
}

export type ConversationNdjsonRow = ConversationTurn | GrowthCaptureStatusRecord;

export function isGrowthCaptureStatusRecord(row: unknown): row is GrowthCaptureStatusRecord {
  return (
    !!row &&
    typeof row === 'object' &&
    (row as { kind?: string }).kind === 'growth_capture_status' &&
    typeof (row as { turnId?: string }).turnId === 'string'
  );
}

export function isConversationTurn(row: unknown): row is ConversationTurn {
  if (!row || typeof row !== 'object') return false;
  if (isGrowthCaptureStatusRecord(row)) return false;
  const r = row as { id?: string; role?: string; text?: string };
  return (
    typeof r.id === 'string' &&
    (r.role === 'user' || r.role === 'assistant' || r.role === 'system') &&
    typeof r.text === 'string'
  );
}

export function conversationFilePath(packageRoot: string): string {
  return path.join(packageRoot, 'ui', 'conversation.ndjson');
}

export async function readConversationRows(filePath: string): Promise<ConversationNdjsonRow[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const rows: ConversationNdjsonRow[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as unknown;
      if (isGrowthCaptureStatusRecord(parsed) || isConversationTurn(parsed)) {
        rows.push(parsed);
      }
    } catch {
      /* skip corrupt */
    }
  }
  return rows;
}

/** 仅用户可见轮次；忽略成长状态行。 */
export function filterTurnsForUi(rows: readonly ConversationNdjsonRow[]): ConversationTurn[] {
  return rows.filter(isConversationTurn);
}

/** 同一 turnId 以最后一条状态为准。 */
export function latestCaptureStatusByTurnId(
  rows: readonly ConversationNdjsonRow[],
): Map<string, GrowthCaptureStatusRecord> {
  const map = new Map<string, GrowthCaptureStatusRecord>();
  for (const row of rows) {
    if (isGrowthCaptureStatusRecord(row)) {
      map.set(row.turnId, row);
    }
  }
  return map;
}

export function listReplayableUserTurns(rows: readonly ConversationNdjsonRow[]): Array<{
  turn: ConversationTurn;
  status: GrowthCaptureStatusRecord | null;
}> {
  const statuses = latestCaptureStatusByTurnId(rows);
  const out: Array<{ turn: ConversationTurn; status: GrowthCaptureStatusRecord | null }> = [];
  for (const row of rows) {
    if (!isConversationTurn(row) || row.role !== 'user') continue;
    const status = statuses.get(row.id) ?? null;
    if (!status || status.status === 'pending' || status.status === 'failed') {
      out.push({ turn: row, status });
    }
  }
  return out;
}

export async function appendConversationRow(
  filePath: string,
  row: ConversationNdjsonRow,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const line = JSON.stringify(row);
  if (line.includes('\n')) {
    throw new Error('conversation row must be single-line JSON');
  }
  await fs.appendFile(filePath, `${line}\n`, 'utf8');
}

export function outcomeToCaptureStatus(
  outcome: 'learned' | 'pending_confirmation' | 'nothing_to_learn' | 'distill_failed',
): GrowthCaptureStatusValue {
  switch (outcome) {
    case 'learned':
      return 'ok_learned';
    case 'pending_confirmation':
      return 'ok_pending_confirmation';
    case 'nothing_to_learn':
      return 'ok_empty';
    case 'distill_failed':
      return 'failed';
    default:
      return 'failed';
  }
}
