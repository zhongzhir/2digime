/**
 * DIGITALME-V2-SUBJECT-COLLABORATION-FOUNDATION-01 — 单元：条款 digest 与评估。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  termsDigestOf,
  tryFormAgreementDigest,
  deriveCollabStatus,
} from '../record-derive';
import type { CollaborationRecord } from '../schema';

test('termsDigest stable for same terms regardless of material order', () => {
  const a = termsDigestOf({
    intent: '分析材料',
    expectedOutcome: '摘要',
    offeredMaterials: [
      { path: '/b.md' },
      { path: '/a.md', summary: 'x' },
    ],
    acceptanceCriteria: ['依据', '清单'],
  });
  const b = termsDigestOf({
    intent: '分析材料',
    expectedOutcome: '摘要',
    offeredMaterials: [
      { path: '/a.md', summary: 'x' },
      { path: '/b.md' },
    ],
    acceptanceCriteria: ['清单', '依据'],
  });
  assert.equal(a, b);
});

test('agreement requires same termsDigest from both sides', () => {
  const record: CollaborationRecord = {
    id: 'crec_1',
    recordId: 'crec_1',
    initiator: { subjectId: 'A', displayName: '甲', endpointRef: 'subject:A' },
    responder: { subjectId: 'B', displayName: '乙', endpointRef: 'subject:B' },
    proposal: {
      intent: 'x',
      expectedOutcome: 'y',
      offeredMaterials: [{ path: '/m.md' }],
      acceptanceCriteria: ['c'],
    },
    events: [
      {
        eventId: 'e1',
        kind: 'proposed',
        authorSubjectId: 'A',
        at: '2026-08-06T00:00:00.000Z',
        termsDigest: 'digest-1',
      },
      {
        eventId: 'e2',
        kind: 'accepted',
        authorSubjectId: 'B',
        at: '2026-08-06T00:01:00.000Z',
        termsDigest: 'digest-2',
      },
    ],
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:01:00.000Z',
  };
  assert.equal(tryFormAgreementDigest(record), null);
  record.events.push({
    eventId: 'e3',
    kind: 'accepted',
    authorSubjectId: 'A',
    at: '2026-08-06T00:02:00.000Z',
    termsDigest: 'digest-2',
  });
  assert.equal(tryFormAgreementDigest(record), 'digest-2');
  assert.equal(deriveCollabStatus(record), 'proposed');
});

test('deriveCollabStatus: delivered-without-delivery fail note is failed not running', () => {
  const record: CollaborationRecord = {
    id: 'crec_fail',
    recordId: 'crec_fail',
    initiator: { subjectId: 'A', displayName: '甲', endpointRef: 'subject:A' },
    responder: { subjectId: 'B', displayName: '乙', endpointRef: 'subject:B' },
    proposal: {
      intent: 'x',
      expectedOutcome: 'y',
      offeredMaterials: [{ path: '/m.md' }],
      acceptanceCriteria: ['c'],
    },
    events: [
      {
        eventId: 'e1',
        kind: 'fulfillment_started',
        authorSubjectId: 'B',
        at: '2026-08-06T00:00:00.000Z',
        jobId: 'job_1',
        note: 'job_linked',
      },
      {
        eventId: 'e2',
        kind: 'delivered',
        authorSubjectId: 'B',
        at: '2026-08-06T00:01:00.000Z',
        jobId: 'job_1',
        note: 'recoverable_fail:执行中断',
        selfCheck: { passed: false, notes: ['执行中断'] },
      },
    ],
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:01:00.000Z',
  };
  assert.equal(deriveCollabStatus(record), 'failed');
});

test('deriveCollabStatus: new fulfillment after failure returns running', () => {
  const record: CollaborationRecord = {
    id: 'crec_retry',
    recordId: 'crec_retry',
    initiator: { subjectId: 'A', displayName: '甲', endpointRef: 'subject:A' },
    responder: { subjectId: 'B', displayName: '乙', endpointRef: 'subject:B' },
    proposal: {
      intent: 'x',
      expectedOutcome: 'y',
      offeredMaterials: [{ path: '/m.md' }],
      acceptanceCriteria: ['c'],
    },
    events: [
      {
        eventId: 'e1',
        kind: 'fulfillment_started',
        authorSubjectId: 'B',
        at: '2026-08-06T00:00:00.000Z',
        note: 'recoverable_fail:中断',
      },
      {
        eventId: 'e2',
        kind: 'fulfillment_started',
        authorSubjectId: 'B',
        at: '2026-08-06T00:02:00.000Z',
        jobId: 'job_2',
        note: 'job_linked',
      },
    ],
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:02:00.000Z',
  };
  assert.equal(deriveCollabStatus(record), 'running');
});
