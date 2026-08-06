import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  deriveCaptureOutcome,
  captureOutcomeUserHint,
} from '../capture-outcome';
import {
  appendConversationRow,
  filterTurnsForUi,
  latestCaptureStatusByTurnId,
  listReplayableUserTurns,
  outcomeToCaptureStatus,
  readConversationRows,
} from '../conversation-transcript';
import { createDigitalMeRuntime } from '../../runtime/digitalme-runtime';

test('captureOutcome distinguishes empty learn vs distill failure', () => {
  assert.equal(
    deriveCaptureOutcome({ candidateCount: 0, confirmationSuggestedCount: 0 }),
    'nothing_to_learn',
  );
  assert.equal(
    deriveCaptureOutcome({
      distillFailed: true,
      candidateCount: 0,
      confirmationSuggestedCount: 0,
    }),
    'distill_failed',
  );
  assert.equal(
    deriveCaptureOutcome({
      candidateCount: 1,
      confirmationSuggestedCount: 1,
    }),
    'pending_confirmation',
  );
  assert.equal(
    deriveCaptureOutcome({
      candidateCount: 1,
      confirmationSuggestedCount: 0,
      confirmedCount: 1,
    }),
    'learned',
  );
  assert.ok(!/pending|failed|attempts/i.test(captureOutcomeUserHint('distill_failed')));
});

test('conversation transcript appends status without rewriting turns', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-conv-'));
  const file = path.join(dir, 'conversation.ndjson');
  await appendConversationRow(file, {
    id: 'turn_1',
    role: 'user',
    text: '以后汇报请结论先行',
    at: new Date().toISOString(),
  });
  await appendConversationRow(file, {
    kind: 'growth_capture_status',
    turnId: 'turn_1',
    status: 'pending',
    attempts: 0,
    updatedAt: new Date().toISOString(),
  });
  await appendConversationRow(file, {
    kind: 'growth_capture_status',
    turnId: 'turn_1',
    status: 'ok_learned',
    attempts: 1,
    updatedAt: new Date().toISOString(),
  });
  const rows = await readConversationRows(file);
  const turns = filterTurnsForUi(rows);
  assert.equal(turns.length, 1);
  assert.equal(turns[0]?.id, 'turn_1');
  const latest = latestCaptureStatusByTurnId(rows).get('turn_1');
  assert.equal(latest?.status, 'ok_learned');
  assert.equal(outcomeToCaptureStatus('nothing_to_learn'), 'ok_empty');
});

test('listReplayableUserTurns only pending or failed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-conv2-'));
  const file = path.join(dir, 'conversation.ndjson');
  await appendConversationRow(file, {
    id: 't_ok',
    role: 'user',
    text: 'ok',
    at: new Date().toISOString(),
  });
  await appendConversationRow(file, {
    kind: 'growth_capture_status',
    turnId: 't_ok',
    status: 'ok_empty',
    attempts: 1,
    updatedAt: new Date().toISOString(),
  });
  await appendConversationRow(file, {
    id: 't_fail',
    role: 'user',
    text: 'fail',
    at: new Date().toISOString(),
  });
  await appendConversationRow(file, {
    kind: 'growth_capture_status',
    turnId: 't_fail',
    status: 'failed',
    attempts: 2,
    updatedAt: new Date().toISOString(),
  });
  const rows = await readConversationRows(file);
  const replay = listReplayableUserTurns(rows);
  assert.equal(replay.length, 1);
  assert.equal(replay[0]?.turn.id, 't_fail');
});

test('captureInput returns captureOutcome; empty text is nothing_to_learn', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-cap-'));
  const rt = createDigitalMeRuntime({ documentCapability: 'fake' });
  await rt.createPackage({
    displayName: 't',
    targetDir: root,
    initialSelfDescription: '我是本地优先的产品负责人',
  });
  const empty = await rt.captureSubjectInput({
    text: '   ',
    sourceKind: 'conversation',
  });
  assert.equal(empty.captureOutcome, 'nothing_to_learn');

  const learned = await rt.captureSubjectInput({
    text: '以后写汇报请结论先行，控制篇幅',
    sourceKind: 'conversation',
    captureKey: 'conversation:test1',
  });
  assert.ok(
    learned.captureOutcome === 'learned' ||
      learned.captureOutcome === 'pending_confirmation' ||
      learned.captureOutcome === 'nothing_to_learn',
  );
  const again = await rt.captureSubjectInput({
    text: '以后写汇报请结论先行，控制篇幅',
    sourceKind: 'conversation',
    captureKey: 'conversation:test1',
  });
  assert.equal(again.idempotent, true);
  assert.equal(again.captureOutcome, 'learned');
  await rt.stop();
});

test('task submit schedules task_requirement capture without waiting job success', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dmv2-taskcap-'));
  const rt = createDigitalMeRuntime({ documentCapability: 'fake' });
  await rt.createPackage({
    displayName: 't',
    targetDir: root,
  });
  const created = await rt.submitTask({
    goal: '以后同类文章请保持结论先行的结构',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  // 等待异步捕获
  await new Promise((r) => setTimeout(r, 800));
  const events = await rt.subject.listGrowthEvents();
  const key = `captureKey:task_requirement:${created.taskId}`;
  const hit = events.some((e) => (e.payload.tags ?? []).includes(key));
  assert.ok(hit, 'task_requirement capture should land after submit persist');
  await rt.stop();
});
