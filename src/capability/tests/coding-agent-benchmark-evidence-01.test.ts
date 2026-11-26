import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideCodingRunAdmission,
  validateCodingRunEvidence,
  validateCodingRunEvidencePair,
  type CodingRunEvidence,
} from '../coding-agent-benchmark-evidence';

const DIGEST = 'a'.repeat(64);
const OTHER_DIGEST = 'b'.repeat(64);

function evidence(arm: CodingRunEvidence['arm'], overrides: Partial<CodingRunEvidence> = {}): CodingRunEvidence {
  return {
    schemaVersion: 'slice-2c-coding-run-evidence/1',
    source: 'real_process',
    taskId: '2C-WEB-01',
    projectClass: 'web',
    arm,
    workspaceId: arm === 'leading_agent_direct' ? 'workspace-direct' : 'workspace-orchestrated',
    fixtureDigest: DIGEST,
    projectRevision: 'fixture-v1',
    agent: { executorId: 'leading-agent', version: '1.2.3', executableDigest: OTHER_DIGEST },
    baselineTest: {
      commandDigest: DIGEST,
      outputDigest: OTHER_DIGEST,
      exitCode: 1,
      startedAt: '2026-11-26T01:00:00.000Z',
      finishedAt: '2026-11-26T01:00:01.000Z',
      matchedRegisteredFailure: true,
    },
    finalTest: {
      commandDigest: DIGEST,
      outputDigest: DIGEST,
      exitCode: 0,
      startedAt: '2026-11-26T01:01:00.000Z',
      finishedAt: '2026-11-26T01:01:01.000Z',
    },
    changedFiles: ['src/price-card.cjs'],
    outsideScopeWrites: [],
    cost: {
      basis: 'existing_entitlement_no_incremental_charge',
      externalChargeIncurred: false,
      amountCny: 0,
    },
    ...(arm === '2digime_orchestrated'
      ? {
          talkReceipt: {
            threadId: 'thread-1',
            executionId: 'execution-1',
            artifactRefs: ['artifact-1'],
            userVisibleSummary: '已完成修改并通过测试。',
          },
        }
      : {}),
    ...overrides,
  };
}

describe('slice 2C real-run evidence gate', () => {
  it('blocks unavailable, unknown-cost and unapproved metered runs', () => {
    assert.equal(
      decideCodingRunAdmission({ agentAvailable: false, costBasis: 'local_no_model', ownerAllowsExternalSpend: false }),
      'blocked_agent_unavailable',
    );
    assert.equal(
      decideCodingRunAdmission({ agentAvailable: true, costBasis: 'unknown', ownerAllowsExternalSpend: false }),
      'blocked_cost_unknown',
    );
    assert.equal(
      decideCodingRunAdmission({ agentAvailable: true, costBasis: 'external_metered', ownerAllowsExternalSpend: false }),
      'blocked_external_cost',
    );
    assert.equal(
      decideCodingRunAdmission({ agentAvailable: true, costBasis: 'external_metered', ownerAllowsExternalSpend: true }),
      'blocked_external_cost',
    );
    assert.equal(
      decideCodingRunAdmission({
        agentAvailable: true,
        costBasis: 'existing_entitlement_no_incremental_charge',
        ownerAllowsExternalSpend: false,
      }),
      'ready_zero_new_cost',
    );
  });

  it('rejects hook or synthetic evidence and requires a real passing final test', () => {
    assert.throws(() => validateCodingRunEvidence({ ...evidence('leading_agent_direct'), source: 'hook' }), /real_process/);
    assert.throws(
      () => validateCodingRunEvidence({ ...evidence('leading_agent_direct'), finalTest: { ...evidence('leading_agent_direct').finalTest, exitCode: 1 } }),
      /finalTest must pass/,
    );
  });

  it('requires a same-Talk receipt only for the orchestrated arm', () => {
    const orchestrated = evidence('2digime_orchestrated');
    assert.doesNotThrow(() => validateCodingRunEvidence(orchestrated));
    assert.throws(() => validateCodingRunEvidence({ ...orchestrated, talkReceipt: undefined }), /requires a Talk receipt/);
    assert.throws(
      () => validateCodingRunEvidence({ ...evidence('leading_agent_direct'), talkReceipt: orchestrated.talkReceipt }),
      /must not impersonate/,
    );
  });

  it('accepts only same-task, same-Agent pairs in independent workspaces', () => {
    const direct = evidence('leading_agent_direct');
    const orchestrated = evidence('2digime_orchestrated');
    assert.equal(validateCodingRunEvidencePair({ direct, orchestrated }).taskId, '2C-WEB-01');
    assert.throws(
      () => validateCodingRunEvidencePair({ direct, orchestrated: { ...orchestrated, workspaceId: direct.workspaceId } }),
      /independent workspaces/,
    );
    assert.throws(
      () => validateCodingRunEvidencePair({ direct, orchestrated: { ...orchestrated, agent: { ...orchestrated.agent, version: '9.0.0' } } }),
      /same leading Agent build/,
    );
  });

  it('rejects charged runs and any lost pre-existing dirty change', () => {
    assert.throws(
      () => validateCodingRunEvidence({ ...evidence('leading_agent_direct'), cost: { basis: 'external_metered', externalChargeIncurred: true, amountCny: 0.1 } }),
      /zero-new-cost/,
    );
    const dirty = evidence('2digime_orchestrated', {
      taskId: '2C-DIRTY-01',
      projectClass: 'dirty_worktree',
      preExistingDirtyProof: {
        path: 'OWNER-NOTES.md',
        beforeDigest: DIGEST,
        afterDigest: OTHER_DIGEST,
        beforeDiffDigest: DIGEST,
        afterDiffDigest: DIGEST,
      },
    });
    assert.throws(() => validateCodingRunEvidence(dirty), /not preserved/);
  });
});
