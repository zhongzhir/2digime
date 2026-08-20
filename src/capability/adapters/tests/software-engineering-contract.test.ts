/**
 * P2B 软件工程契约测试 — 仅锁规格封闭表与边界，无 Agent / 无写仓。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ARTIFACT_QUALITY_GRADES,
  CODING_AGENT_DEFAULT_ACTIONS,
  CODE_CHANGE_SCHEMA_VERSION,
  ENGINEERING_ARTIFACT_TYPES,
  ENGINEERING_PERMISSION_LEVELS,
  ENGINEERING_UI_PHASES,
  L1_ACTIONS,
  L2_ACTIONS,
  L3_ACTIONS,
  PROPOSED_ADAPTER_TYPES,
  VERDICT_SOURCES,
  assertChangeProposalComplete,
  codingAgentMayHold,
  isCodingAgentDefaultWithinL1,
  isDeliverableVerification,
  maxPermissionLevel,
} from '../software-engineering-contract';

test('P2B artifact types are closed and exclude new stores', () => {
  assert.deepEqual([...ENGINEERING_ARTIFACT_TYPES], [
    'engineering-plan',
    'code-change',
    'verification',
    'deployment',
  ]);
});

test('Coding Agent default actions stay within L1', () => {
  assert.equal(isCodingAgentDefaultWithinL1(), true);
  assert.equal(maxPermissionLevel(CODING_AGENT_DEFAULT_ACTIONS), 'L1');
  assert.equal(codingAgentMayHold([...L1_ACTIONS]), true);
  assert.equal(codingAgentMayHold([...L1_ACTIONS, ...L2_ACTIONS]), false);
  assert.equal(codingAgentMayHold([...L3_ACTIONS]), false);
});

test('Permission levels order L0 < L1 < L2 < L3', () => {
  assert.deepEqual([...ENGINEERING_PERMISSION_LEVELS], ['L0', 'L1', 'L2', 'L3']);
  assert.equal(maxPermissionLevel(['filesystem_read']), 'L0');
  assert.equal(maxPermissionLevel(['workspace_write']), 'L1');
  assert.equal(maxPermissionLevel(['repository_apply']), 'L2');
  assert.equal(maxPermissionLevel(['git_push']), 'L3');
});

test('Verdict sources are three-way and orthogonal to job states', () => {
  assert.deepEqual([...VERDICT_SOURCES], [
    'agent_claimed',
    'digitalme_verified',
    'owner_accepted',
  ]);
  assert.equal(isDeliverableVerification('agent_claimed'), false);
  assert.equal(isDeliverableVerification('digitalme_verified'), true);
  assert.equal(isDeliverableVerification('owner_accepted'), true);
});

test('Change proposal completeness rejects empty claims and user-repo writes', () => {
  assert.equal(
    assertChangeProposalComplete({
      hasPatch: true,
      baseDigest: 'abc',
      changedFiles: ['a.ts'],
      wroteUserRepo: false,
    }).ok,
    true,
  );
  const bad = assertChangeProposalComplete({
    hasPatch: false,
    baseDigest: '',
    changedFiles: [],
    wroteUserRepo: true,
  });
  assert.equal(bad.ok, false);
  assert.ok(bad.reasons.includes('missing_patch'));
  assert.ok(bad.reasons.includes('agent_wrote_user_repo'));
});

test('UI phases are derived views only (closed labels)', () => {
  assert.ok(ENGINEERING_UI_PHASES.includes('awaiting_decision'));
  assert.equal(ENGINEERING_UI_PHASES.length, 5);
});

test('Quality grades exist without new job states', () => {
  assert.deepEqual([...ARTIFACT_QUALITY_GRADES], [
    'usable',
    'needs_attention',
    'degraded_scan_only',
  ]);
});

test('Proposed adapter types include coding-agent-cli without claiming production whitelist', () => {
  assert.ok(PROPOSED_ADAPTER_TYPES.includes('coding-agent-cli'));
  assert.equal(CODE_CHANGE_SCHEMA_VERSION, 'code-change/1');
});
