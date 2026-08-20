import { randomBytes } from 'node:crypto';

export const ID_PREFIXES = {
  subject: 'subj',
  growthEvent: 'gevt',
  task: 'task',
  snapshot: 'snap',
  job: 'job',
  artifact: 'art',
  artifactVersion: 'ver',
  capability: 'cap',
  grant: 'grant',
  interactionRequest: 'ireq',
  collaborationJob: 'cjob',
  collaborationRecord: 'crec',
  collaborationEvent: 'cevt',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;

export function newId(kind: IdKind): string {
  return `${ID_PREFIXES[kind]}_${Date.now().toString(36)}${randomBytes(6).toString('hex')}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
