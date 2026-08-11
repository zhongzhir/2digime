import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildErrorSignature,
  decideControlledRevision,
  schemesSubstantiallyDifferent,
  type ControlledRevisionEvidence,
  type RevisionAttemptRecord,
} from '../controlled-revision';

const failure: ControlledRevisionEvidence = {
  decision: 'needs_revision',
  revisionPlan: '检查 build:api_contract 并补充缺失的输入校验。',
  checks: [{ id: 'api_contract', verdict: 'unsatisfied', detail: '缺少输入校验' }],
  failureMessage: '接口校验失败',
};

function attempt(plan = failure.revisionPlan!): RevisionAttemptRecord {
  return {
    jobId: 'job-1',
    at: '2026-08-11T00:00:00.000Z',
    attribution: 'other',
    errorSignature: buildErrorSignature(failure),
    schemeFingerprint: plan,
    revisionPlanExcerpt: plan,
    outcome: 'auto_revised',
  };
}

function decide(evidence = failure, extra: Record<string, unknown> = {}) {
  return decideControlledRevision({
    evidence,
    confirmedPlanVersion: 1,
    hasConfirmedPlan: true,
    hasActiveJob: false,
    modelAvailable: true,
    pausedByUser: false,
    cancelled: false,
    ...extra,
  });
}

describe('D11-D controlled revision', () => {
  it('首次 needs_revision 自动修订', () => {
    const result = decide();
    assert.equal(result.action, 'auto_revise');
  });

  it('同一原因第二次必须换方案', () => {
    const result = decide(failure, { loop: { attempts: [attempt()], autoRoundCount: 1 } });
    assert.equal(result.action, 'pause');
    assert.match(result.userFacingNote, /不同/);
  });

  it('同一原因第三次暂停且不产生自动动作', () => {
    const result = decide(failure, {
      loop: { attempts: [attempt(), attempt()], autoRoundCount: 2 },
    });
    assert.equal(result.action, 'pause');
    assert.equal(result.revisionRequest, undefined);
  });

  it('不同原因不会累加连续失败', () => {
    const prior = { ...attempt(), attribution: 'runtime_failure' as const };
    const result = decide(failure, { loop: { attempts: [prior], autoRoundCount: 1 } });
    assert.equal(result.consecutiveSameCause, 0);
    assert.equal(result.action, 'auto_revise');
  });

  it('成功停止并重置连续失败', () => {
    const result = decide({ ...failure, decision: 'meets_plan' }, {
      loop: { attempts: [attempt(), attempt()], autoRoundCount: 2 },
    });
    assert.equal(result.action, 'stop_success');
    assert.equal(result.consecutiveSameCause, 0);
  });

  it('blocked 与证据不足不自动修订', () => {
    assert.equal(decide({ ...failure, decision: 'blocked' }).action, 'pause');
    assert.equal(decide({ ...failure, decision: 'insufficient_evidence' }).action, 'pause');
  });

  it('模型不可用不自动修订', () => {
    assert.equal(decide(failure, { modelAvailable: false }).action, 'pause');
  });

  it('已有活动 Job 时 noop', () => {
    assert.equal(decide(failure, { hasActiveJob: true }).action, 'noop');
  });

  it('近似改写不能作为第二次方案', () => {
    assert.equal(
      schemesSubstantiallyDifferent(
        '检查 build:api_contract 并补充缺失的输入校验',
        '补充输入校验，然后检查 api_contract build',
      ),
      false,
    );
  });

  it('高风险方案等待用户决定', () => {
    const result = decide({ ...failure, revisionPlan: '删除整个项目并覆盖全部配置。' });
    assert.equal(result.action, 'await_user');
    assert.equal(result.requireUserDecision, true);
  });
});
