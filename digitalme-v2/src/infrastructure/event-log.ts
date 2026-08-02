import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { EventLog } from '../runtime/ports';

/**
 * GrowthEvent EventLog(P1.1 §2):NDJSON 追加式日志,按 subjectId 一文件。
 * - 只追加,无修改/删除 API(事件不可变);
 * - 重复 eventId 拒绝;
 * - 损坏行隔离到 <subjectId>.quarantine.ndjson 并经 onCorruptLine 上报,
 *   原始日志保持不动(append-only),不静默吞掉。
 */
const SUBJECT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface NdjsonEventLogOptions {
  dir: string;
  onCorruptLine?: (subjectId: string, lineNumber: number, reason: string) => void;
}

export class NdjsonEventLog<E extends { id: string; subjectId: string }> implements EventLog<E> {
  private readonly dir: string;
  private readonly onCorruptLine: (subjectId: string, lineNumber: number, reason: string) => void;
  private readonly knownIds = new Map<string, Set<string>>();

  constructor(options: NdjsonEventLogOptions) {
    this.dir = options.dir;
    this.onCorruptLine = options.onCorruptLine ?? (() => {});
  }

  private fileFor(subjectId: string): string {
    if (!SUBJECT_ID_PATTERN.test(subjectId)) {
      throw new Error(`invalid subject id: ${JSON.stringify(subjectId)}`);
    }
    return path.join(this.dir, `${subjectId}.ndjson`);
  }

  async append(event: E): Promise<void> {
    const ids = await this.loadIds(event.subjectId);
    if (ids.has(event.id)) {
      throw new Error(`duplicate event id: ${event.id} (subject ${event.subjectId})`);
    }
    const line = JSON.stringify(event);
    if (line.includes('\n')) {
      throw new Error(`event ${event.id} serializes to multiple lines`);
    }
    await fs.mkdir(this.dir, { recursive: true });
    await fs.appendFile(this.fileFor(event.subjectId), `${line}\n`, 'utf8');
    ids.add(event.id);
  }

  async *replay(subjectId: string): AsyncIterable<E> {
    for (const parsed of await this.readValidEvents(subjectId)) {
      yield parsed;
    }
  }

  private async loadIds(subjectId: string): Promise<Set<string>> {
    const cached = this.knownIds.get(subjectId);
    if (cached) return cached;
    const ids = new Set<string>();
    for (const event of await this.readValidEvents(subjectId)) {
      ids.add(event.id);
    }
    this.knownIds.set(subjectId, ids);
    return ids;
  }

  private async readValidEvents(subjectId: string): Promise<E[]> {
    const filePath = this.fileFor(subjectId);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const events: E[] = [];
    const lines = raw.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i] ?? '';
      if (line.trim().length === 0) continue;
      const parsed = tryParseEvent<E>(line, subjectId);
      if (parsed.ok) {
        events.push(parsed.event);
      } else {
        await this.quarantine(subjectId, i + 1, line, parsed.reason);
      }
    }
    return events;
  }

  private async quarantine(
    subjectId: string,
    lineNumber: number,
    line: string,
    reason: string,
  ): Promise<void> {
    const quarantinePath = path.join(this.dir, `${subjectId}.quarantine.ndjson`);
    const record = JSON.stringify({ lineNumber, reason, raw: line });
    await fs.appendFile(quarantinePath, `${record}\n`, 'utf8');
    this.onCorruptLine(subjectId, lineNumber, reason);
  }
}

function tryParseEvent<E extends { id: string; subjectId: string }>(
  line: string,
  subjectId: string,
): { ok: true; event: E } | { ok: false; reason: string } {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    return { ok: false, reason: `invalid json: ${(error as Error).message}` };
  }
  const event = value as Partial<E>;
  if (typeof event !== 'object' || event === null || typeof event.id !== 'string') {
    return { ok: false, reason: 'missing event id' };
  }
  if (event.subjectId !== subjectId) {
    return { ok: false, reason: `subject mismatch: ${String(event.subjectId)}` };
  }
  return { ok: true, event: event as E };
}
