import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { AutomationService } from '../automation-service';

test('human-in-loop institution automation is scoped, idempotent, pausable and revocable', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'digitalme-automation-'));
  try {
    const service = await AutomationService.open(root);
    const created = await service.create({
      subjectId: 'subj_owner',
      title: '收到机构账单后整理摘要',
      goalTemplate: '读取这次机构账单事件，生成一份供我确认的摘要。',
      trigger: { type: 'institution_event', institutionEventType: 'billing.statement.ready' },
      allowedCapabilityIds: ['cap_fake_document'],
      allowedSubjectIds: ['subj_demo_telecom'],
      validUntil: '2027-01-01T00:00:00.000Z',
      maxCostCny: 0,
      humanInLoop: 'before_execution',
      risk: 'low',
    }, '2026-11-27T08:00:00.000Z');

    const first = await service.recordTrigger({
      automationId: created.id,
      eventKey: 'statement-2026-11',
      triggerType: 'institution_event',
      now: '2026-11-27T08:01:00.000Z',
    });
    const duplicate = await service.recordTrigger({
      automationId: created.id,
      eventKey: 'statement-2026-11',
      triggerType: 'institution_event',
      now: '2026-11-27T08:02:00.000Z',
    });
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.receipt.id, first.receipt.id);

    let submissions = 0;
    const confirmed = await service.confirmTrigger({
      automationId: created.id,
      receiptId: first.receipt.id,
      capabilityId: 'cap_fake_document',
      now: '2026-11-27T08:03:00.000Z',
      submit: async ({ goal, capabilityId }) => {
        submissions += 1;
        assert.equal(goal, created.goalTemplate);
        assert.equal(capabilityId, 'cap_fake_document');
        return { taskId: 'task_real', jobId: 'job_real' };
      },
    });
    assert.equal(confirmed.receipt.taskId, 'task_real');
    const confirmedAgain = await service.confirmTrigger({
      automationId: created.id,
      receiptId: first.receipt.id,
      capabilityId: 'cap_fake_document',
      submit: async () => {
        submissions += 1;
        return { taskId: 'task_wrong' };
      },
    });
    assert.equal(confirmedAgain.duplicate, true);
    assert.equal(submissions, 1);

    await service.setLifecycle(created.id, 'pause', '2026-11-27T08:04:00.000Z');
    await assert.rejects(
      service.recordTrigger({
        automationId: created.id,
        eventKey: 'statement-2026-12',
        triggerType: 'institution_event',
        now: '2026-11-27T08:05:00.000Z',
      }),
      /当前未运行/,
    );
    await service.setLifecycle(created.id, 'resume', '2026-11-27T08:06:00.000Z');
    await service.setLifecycle(created.id, 'revoke', '2026-11-27T08:07:00.000Z');
    await assert.rejects(service.setLifecycle(created.id, 'resume'), /不能恢复/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('automation definitions fail closed without capability scope or valid trigger details', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'digitalme-automation-invalid-'));
  try {
    const service = await AutomationService.open(root);
    await assert.rejects(
      service.create({
        subjectId: 'subj_owner',
        title: '无范围',
        goalTemplate: '执行',
        trigger: { type: 'scheduled', schedule: '0 9 * * *' },
        allowedCapabilityIds: [],
        validUntil: '2027-01-01T00:00:00.000Z',
        maxCostCny: 0,
        humanInLoop: 'before_execution',
        risk: 'low',
      }, '2026-11-27T08:00:00.000Z'),
      /明确允许使用的能力/,
    );
    await assert.rejects(
      service.create({
        subjectId: 'subj_owner',
        title: '缺少观察位置',
        goalTemplate: '执行',
        trigger: { type: 'file_arrival' },
        allowedCapabilityIds: ['cap_fake_document'],
        validUntil: '2027-01-01T00:00:00.000Z',
        maxCostCny: 0,
        humanInLoop: 'before_execution',
        risk: 'low',
      }, '2026-11-27T08:00:00.000Z'),
      /观察位置/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
