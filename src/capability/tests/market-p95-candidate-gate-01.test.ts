/**
 * MARKET-P95-CANDIDATE-GATE-01 单测。
 * 覆盖：等预算违规拒绝、盲评包无臂标签、缺前置 → blocked、同 seed 可复现、
 *       verdict 集合不含 p95_met。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  P95_CANDIDATE_VERDICTS,
  P95_FORBIDDEN_VERDICTS,
  assertBlindReviewPacketClean,
  assertEqualBudget,
  buildBlindReviewPacket,
  checkEqualBudget,
  decideP95CandidateVerdict,
  reproducibleHash,
  unblindAfterReview,
} from '../market-p95-candidate-gate';
import {
  buildBenchmarkArmPair,
  computeArmPairGain,
  loadP0TaskFixtures,
  validateBenchmarkRecords,
} from '../external-connector-contract';
import * as path from 'node:path';

const FIXTURE_P0 = path.resolve(
  __dirname,
  '../../../scripts/fixtures/external-capability-p0-tasks.json',
);

describe('market-p95-candidate-gate-01', () => {
  it('verdict set is closed and never contains p95_met / mvp_ready / closed_alpha_ready', () => {
    assert.deepEqual(
      [...P95_CANDIDATE_VERDICTS],
      [
        'protocol_ready',
        'scoring_blocked_missing_budget',
        'scoring_blocked_missing_blind_review',
        'scoring_blocked_agents_unavailable',
        'candidate_scored_not_claimed',
      ],
    );
    for (const forbidden of P95_FORBIDDEN_VERDICTS) {
      assert.ok(!P95_CANDIDATE_VERDICTS.includes(forbidden as never), `must not contain ${forbidden}`);
    }
  });

  it('equal budget violation is rejected', () => {
    const fixture = loadP0TaskFixtures(FIXTURE_P0);
    const task = fixture.find((t) => t.taskId === 'P0-triageapp-edit')!;
    const pair = buildBenchmarkArmPair(task);
    assert.doesNotThrow(() => assertEqualBudget(pair));
    // violate: bump orchestrated budget
    const bad = {
      ...pair,
      orchestrated: { ...pair.orchestrated, budget: pair.orchestrated.budget + 1 },
    };
    assert.throws(() => assertEqualBudget(bad), /equal-budget violation/);
    const violations = checkEqualBudget([bad]);
    assert.ok(violations.some((v) => v.includes('budget-mismatch')));
    assert.equal(checkEqualBudget([pair]).length, 0);
  });

  it('blind review packet has no arm / adapter / vendor markers', () => {
    const packet = buildBlindReviewPacket({
      taskId: 'P0-triageapp-edit',
      goal: '修改 TRIAGEAPP 功能说明与一处界面文案，并在隔离副本上执行预注册测试。',
      allowedMaterials: ['materials/triageapp/triageapp.html', 'materials/triageapp/TRIAGEAPP-PROJECT.md'],
      outputExcerpt: '更新了功能说明与界面文案，预注册测试通过。',
      preRegisteredVerification: ['改动发生在隔离副本', '必须实际运行预注册测试'],
    });
    assert.doesNotThrow(() => assertBlindReviewPacketClean(packet));
    const blob = JSON.stringify(packet).toLowerCase();
    for (const bad of ['direct', 'orchestrated', 'adapterid', '"arm"', 'codex', 'claude', 'cursor']) {
      assert.equal(blob.includes(bad), false, `packet must not contain ${bad}`);
    }
    // 拆封后才带臂标签
    const unblinded = unblindAfterReview({
      packetId: packet.packetId,
      taskId: packet.taskId,
      arm: 'orchestrated',
      adapterId: 'external-executor-secondary-cli',
      ratings: { substantiveCompletion: true, falseCompletion: false, honestFailure: false, wouldAdopt: true },
    });
    assert.equal(unblinded.arm, 'orchestrated');
    assert.equal(unblinded.adapterId, 'external-executor-secondary-cli');
    assert.equal(unblinded.ratings.substantiveCompletion, true);
  });

  it('missing preconditions => blocked, never a pass claim', () => {
    assert.equal(
      decideP95CandidateVerdict({ hasBudgetAuthorization: false, hasBlindReviews: false, agentsAvailable: false }),
      'scoring_blocked_missing_budget',
    );
    assert.equal(
      decideP95CandidateVerdict({ hasBudgetAuthorization: true, hasBlindReviews: false, agentsAvailable: true }),
      'scoring_blocked_missing_blind_review',
    );
    assert.equal(
      decideP95CandidateVerdict({ hasBudgetAuthorization: true, hasBlindReviews: true, agentsAvailable: false }),
      'scoring_blocked_agents_unavailable',
    );
    // 仅协议自检 → protocol_ready
    assert.equal(
      decideP95CandidateVerdict({ hasBudgetAuthorization: true, hasBlindReviews: true, agentsAvailable: true, protocolCheckOnly: true }),
      'protocol_ready',
    );
    // 全真实发生 → candidate_scored_not_claimed（不得宣称 95 分位）
    assert.equal(
      decideP95CandidateVerdict({ hasBudgetAuthorization: true, hasBlindReviews: true, agentsAvailable: true }),
      'candidate_scored_not_claimed',
    );
  });

  it('same fixture + same seed + same synthetic records => identical hash (reproducible)', () => {
    const fixture = loadP0TaskFixtures(FIXTURE_P0);
    const pairs = fixture.map((t) => buildBenchmarkArmPair(t));
    const direct = pairs.map((p) => p.direct);
    const orchestrated = pairs.map((p) => p.orchestrated);
    const metrics1 = computeArmPairGain(direct, orchestrated);
    const metrics2 = computeArmPairGain(direct, orchestrated);
    const h1 = reproducibleHash({ taskId: 'P0-triageapp-edit', seed: 'seed-42', metrics: metrics1, verdict: 'protocol_ready' });
    const h2 = reproducibleHash({ taskId: 'P0-triageapp-edit', seed: 'seed-42', metrics: metrics2, verdict: 'protocol_ready' });
    assert.equal(h1, h2);
    // different seed => different hash
    const h3 = reproducibleHash({ taskId: 'P0-triageapp-edit', seed: 'seed-43', metrics: metrics1, verdict: 'protocol_ready' });
    assert.notEqual(h1, h3);
  });

  it('synthetic arm records load and metrics are deterministic', () => {
    const fixture = loadP0TaskFixtures(FIXTURE_P0);
    assert.equal(fixture.length, 4);
    const raw = JSON.parse(require('node:fs').readFileSync(FIXTURE_P0, 'utf8')) as {
      syntheticBenchmarkRecords?: unknown;
    };
    const records = validateBenchmarkRecords(raw.syntheticBenchmarkRecords);
    assert.equal(records.length, 8);
  });
});