import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { EXCHANGE_SCHEMA_VERSION, type CollaborationExchangeEvent } from './types';

export function exchangeDir(packageRoot: string): string {
  return path.join(packageRoot, 'collaboration', 'exchanges');
}

export function bodyDigest(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex').slice(0, 32);
}

export async function appendExchange(
  packageRoot: string,
  event: Omit<CollaborationExchangeEvent, 'schemaVersion' | 'id' | 'bodyDigest' | 'settlementRef'> & {
    id?: string;
    bodyDigest?: string;
    settlementRef?: null;
  },
): Promise<CollaborationExchangeEvent> {
  const recorded: CollaborationExchangeEvent = {
    schemaVersion: EXCHANGE_SCHEMA_VERSION,
    id: event.id || `exev_${randomUUID()}`,
    exchangeId: event.exchangeId,
    kind: event.kind,
    at: event.at,
    fromSubjectId: event.fromSubjectId,
    toSubjectId: event.toSubjectId,
    summary: event.summary,
    body: event.body,
    bodyDigest: event.bodyDigest || bodyDigest(event.body),
    settlementRef: null,
    ...(event.threadId ? { threadId: event.threadId } : {}),
    ...(event.protocolRef ? { protocolRef: event.protocolRef } : {}),
    ...(event.peerDecision ? { peerDecision: event.peerDecision } : {}),
    ...(event.usedOwnCapability ? { usedOwnCapability: true } : {}),
  };
  const dir = exchangeDir(packageRoot);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${recorded.id}.json`);
  await fs.writeFile(file, `${JSON.stringify(recorded, null, 2)}\n`, 'utf8');
  return recorded;
}

export async function listExchanges(packageRoot: string): Promise<CollaborationExchangeEvent[]> {
  const dir = exchangeDir(packageRoot);
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const events: CollaborationExchangeEvent[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    try {
      const parsed = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')) as CollaborationExchangeEvent;
      if (parsed?.schemaVersion === EXCHANGE_SCHEMA_VERSION) events.push(parsed);
    } catch {
      /* skip */
    }
  }
  return events.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}
