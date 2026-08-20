/**
 * EXTERNAL-CAPABILITY-CONTRACT-01 合同模块单元测试。
 * 全部为纯函数判定；不调用任何真实厂商 / MCP / A2A / 模型。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import * as path from 'node:path';
import { readFileSync } from 'node:fs';
import {
  CONNECTOR_CLASSES,
  DECLARED_MCP_ADAPTER_TYPES,
  assertConnectorClass,
  assertMcpIsNotAutonomousAgent,
  assertMcpRegistrationShape,
  assertMcpWireableGuard,
  buildBenchmarkArmPair,
  computeArmPairGain,
  computeBenchmarkMetrics,
  isMcpToolNotAgent,
  loadP0TaskFixtures,
  mapConnectorClassToAdapterType,
  validateBenchmarkRecords,
  validateP0TaskFixtures,
  type BenchmarkArmRecord,
  type P0TaskFixture,
} from '../external-connector-contract';
import { ADAPTER_TYPES, isAgentExecutorAdapterType } from '../registration';
import {
  EXTERNAL_CAPABILITY_FAILURE,
  EXTERNAL_CAPABILITY_USER_LABELS,
} from '../external-capability-product';

const FIXTURE_FILE = path.resolve(
  __dirname,
  '../../../scripts/fixtures/external-capability-p0-tasks.json',
);

function syntheticRecords(): BenchmarkArmRecord[] {
  return validateBenchmarkRecords([
    {
      taskId: 'P0-mechanical-reply',
      arm: 'direct',
      connectorClass: 'agent',
      adapterId: 'external-executor-codex-cli',
      budget: 2000,
      confirmationCount: 0,
      outcome: 'completed',
      falseCompletion: true,
      recovered: false,
      adoptedOnFirstAttempt: false,
      honestFailure: false,
    },
    {
      taskId: 'P0-mechanical-reply',
      arm: 'orchestrated',
      connectorClass: 'agent',
      adapterId: 'external-executor-codex-cli',
      budget: 2000,
      confirmationCount: 0,
      outcome: 'failed',
      falseCompletion: false,
      recovered: false,
      adoptedOnFirstAttempt: false,
      honestFailure: true,
    },
    {
      taskId: 'P0-triageapp-edit',
      arm: 'direct',
      connectorClass: 'agent',
      adapterId: 'external-executor-codex-cli',
      budget: 4000,
      confirmationCount: 1,
      outcome: 'completed',
      falseCompletion: false,
      recovered: false,
      adoptedOnFirstAttempt: true,
      honestFailure: false,
    },
    {
      taskId: 'P0-triageapp-edit',
      arm: 'orchestrated',
      connectorClass: 'agent',
      adapterId: 'external-executor-codex-cli',
      budget: 4000,
      confirmationCount: 0,
      outcome: 'timeout',
      falseCompletion: false,
      recovered: false,
      adoptedOnFirstAttempt: false,
      honestFailure: false,
    },
    {
      taskId: 'P0-research-honest-fail',
      arm: 'direct',
      connectorClass: 'agent',
      adapterId: 'external-executor-codex-cli',
      budget: 2000,
      confirmationCount: 0,
      outcome: 'completed',
      falseCompletion: true,
      recovered: false,
      adoptedOnFirstAttempt: false,
      honestFailure: false,
    },
    {
      taskId: 'P0-research-honest-fail',
      arm: 'orchestrated',
      connectorClass: 'agent',
      adapterId: 'external-executor-codex-cli',
      budget: 2000,
      confirmationCount: 0,
      outcome: 'failed',
      falseCompletion: false,
      recovered: false,
      adoptedOnFirstAttempt: false,
      honestFailure: true,
    },
    {
      taskId: 'P0-restart-recover',
      arm: 'direct',
      connectorClass: 'agent',
      adapterId: 'external-executor-codex-cli',
      budget: 3000,
      confirmationCount: 0,
      outcome: 'cancelled',
      falseCompletion: false,
      recovered: false,
      adoptedOnFirstAttempt: false,
      honestFailure: false,
      neededRecovery: true,
    },
    {
      taskId: 'P0-restart-recover',
      arm: 'orchestrated',
      connectorClass: 'agent',
      adapterId: 'external-executor-codex-cli',
      budget: 3000,
      confirmationCount: 1,
      outcome: 'completed',
      falseCompletion: false,
      recovered: true,
      adoptedOnFirstAttempt: true,
      honestFailure: false,
      neededRecovery: true,
    },
  ]);
}

test('connector classes are frozen to the four product classes', () => {
  assert.deepEqual([...CONNECTOR_CLASSES], ['model', 'agent', 'mcp-tool', 'a2a-agent']);
  assert.deepEqual([...DECLARED_MCP_ADAPTER_TYPES], ['mcp-stdio']);
});

test('connector class maps to existing adapter types; mcp-stdio now wireable', () => {
  assert.equal(mapConnectorClassToAdapterType('model'), 'openai-compatible-model');
  assert.equal(mapConnectorClassToAdapterType('agent'), 'external-executor-cli');
  assert.equal(mapConnectorClassToAdapterType('a2a-agent'), 'remote-subject');
  for (const cls of ['model', 'agent', 'a2a-agent'] as const) {
    const mapped = mapConnectorClassToAdapterType(cls);
    assert.ok(
      ADAPTER_TYPES.includes(mapped as (typeof ADAPTER_TYPES)[number]),
      `${cls} -> ${mapped} must be in production ADAPTER_TYPES`,
    );
  }
  assert.equal(mapConnectorClassToAdapterType('mcp-tool'), 'mcp-stdio');
  assert.ok(
    ADAPTER_TYPES.includes('mcp-stdio' as (typeof ADAPTER_TYPES)[number]),
    'mcp-stdio must now be wireable in ADAPTER_TYPES (MCP-READONLY-ADAPTER-01)',
  );
  assert.ok(
    ADAPTER_TYPES.includes('external-executor-http' as (typeof ADAPTER_TYPES)[number]),
    'HTTP is a sibling transport of the same agent class, not a new connector class',
  );
  assert.equal(isAgentExecutorAdapterType('external-executor-cli'), true);
  assert.equal(isAgentExecutorAdapterType('external-executor-http'), true);
  assert.equal(isAgentExecutorAdapterType('mcp-stdio'), false);
  assert.doesNotThrow(() => assertMcpWireableGuard());
  // 接线后守卫：kind=tool、无写权限
  assert.doesNotThrow(() =>
    assertMcpRegistrationShape({
      kind: 'tool',
      permissions: ['filesystem_read'],
      adapter: { type: 'mcp-stdio' },
    }),
  );
  assert.throws(
    () =>
      assertMcpRegistrationShape({
        kind: 'agent',
        permissions: [],
        adapter: { type: 'mcp-stdio' },
      }),
    /kind must be 'tool'/,
  );
  assert.throws(
    () =>
      assertMcpRegistrationShape({
        kind: 'tool',
        permissions: ['filesystem_write'],
        adapter: { type: 'mcp-stdio' },
      }),
    /filesystem_write/,
  );
  assert.throws(
    () =>
      assertMcpRegistrationShape({
        kind: 'tool',
        permissions: ['filesystem_read'],
        adapter: { type: 'external-executor-cli' },
      }),
    /type must be 'mcp-stdio'/,
  );
});

test('unknown connector class is rejected at runtime', () => {
  assert.throws(() => mapConnectorClassToAdapterType('cursor' as never), /unknown connector class/);
  assert.throws(() => assertConnectorClass('agentic-loop'), /unknown connector class/);
});

test('mcp-tool is a tool, not an autonomous agent', () => {
  assert.equal(isMcpToolNotAgent('mcp-tool'), true);
  assert.equal(isMcpToolNotAgent('agent'), false);
  assert.equal(isMcpToolNotAgent('model'), false);
  assert.equal(isMcpToolNotAgent('a2a-agent'), false);
  assert.doesNotThrow(() => assertMcpIsNotAutonomousAgent('mcp-tool', { autonomous: false }));
  assert.throws(() => assertMcpIsNotAutonomousAgent('mcp-tool', { autonomous: true }), /tools\/data only/);
  assert.doesNotThrow(() => assertMcpIsNotAutonomousAgent('agent', { autonomous: true }));
});

test('buildBenchmarkArmPair produces direct/orchestrated not_run placeholders', () => {
  const fixture = loadP0TaskFixtures(FIXTURE_FILE);
  const task = fixture.find((t) => t.taskId === 'P0-mechanical-reply')!;
  const pair = buildBenchmarkArmPair(task);
  assert.equal(pair.taskId, 'P0-mechanical-reply');
  assert.equal(pair.direct.arm, 'direct');
  assert.equal(pair.orchestrated.arm, 'orchestrated');
  for (const rec of [pair.direct, pair.orchestrated]) {
    assert.equal(rec.outcome, 'not_run');
    assert.equal(rec.connectorClass, 'agent');
    assert.equal(rec.adapterId, 'external-executor-codex-cli');
    assert.equal(rec.budget, task.budget.maxTokens);
    assert.equal(rec.confirmationCount, 0);
    assert.equal(rec.falseCompletion, false);
    assert.equal(rec.recovered, false);
    assert.equal(rec.adoptedOnFirstAttempt, false);
    assert.equal(rec.honestFailure, false);
  }
});

test('benchmark metrics on not_run-only records are null-rate deterministic', () => {
  const fixture = loadP0TaskFixtures(FIXTURE_FILE);
  const placeholders = fixture.flatMap((t) => {
    const pair = buildBenchmarkArmPair(t);
    return [pair.direct, pair.orchestrated];
  });
  assert.equal(placeholders.length, 8);
  const m = computeBenchmarkMetrics(placeholders);
  assert.equal(m.denominator, 0);
  assert.equal(m.counts.notRun, 8);
  assert.equal(m.completionRate, null);
  assert.equal(m.firstAdoptionRate, null);
  assert.equal(m.falseCompletionRate, null);
  assert.equal(m.recoveryRate, null);
  assert.equal(m.honestFailureRate, null);
  assert.equal(m.totalNecessaryConfirmations, 0);
  assert.equal(m.avgNecessaryConfirmations, null);
});

test('benchmark metrics formulas include failures, timeouts and cancellations', () => {
  const m = computeBenchmarkMetrics(syntheticRecords());
  assert.equal(m.denominator, 8);
  assert.equal(m.counts.completed, 4);
  assert.equal(m.counts.failed, 2);
  assert.equal(m.counts.timeout, 1);
  assert.equal(m.counts.cancelled, 1);
  assert.equal(m.counts.falseCompletion, 2);
  assert.equal(m.counts.adoptedOnFirstAttempt, 2);
  assert.equal(m.counts.recovered, 1);
  assert.equal(m.counts.neededRecovery, 2);
  assert.equal(m.counts.honestFailure, 2);
  assert.equal(m.completionRate, 0.5);
  assert.equal(m.firstAdoptionRate, 0.25);
  assert.equal(m.totalNecessaryConfirmations, 2);
  assert.equal(m.avgNecessaryConfirmations, 0.25);
  assert.equal(m.falseCompletionRate, 0.25);
  assert.equal(m.recoveryRate, 0.5);
  assert.equal(m.honestFailureRate, 0.5);
});

test('arm pair gain is deterministic over synthetic records', () => {
  const recs = syntheticRecords();
  const direct = recs.filter((r) => r.arm === 'direct');
  const orchestrated = recs.filter((r) => r.arm === 'orchestrated');
  assert.equal(direct.length, 4);
  assert.equal(orchestrated.length, 4);
  const pair = computeArmPairGain(direct, orchestrated);
  assert.equal(pair.direct.completionRate, 0.75);
  assert.equal(pair.orchestrated.completionRate, 0.25);
  assert.equal(pair.gain.completionGain, -0.5);
  assert.equal(pair.direct.falseCompletionRate, 0.5);
  assert.equal(pair.orchestrated.falseCompletionRate, 0);
  assert.equal(pair.gain.falseCompletionGain, 0.5);
  assert.equal(pair.gain.firstAdoptionGain, 0);
  assert.equal(pair.gain.interventionCostGain, 0);
  assert.ok(Math.abs(pair.orchestrated.recoveryRate! - 1) < 1e-9);
  assert.ok(Math.abs(pair.orchestrated.honestFailureRate! - 2 / 3) < 1e-9);
  assert.ok(Math.abs(pair.direct.recoveryRate! - 0) < 1e-9);
});

test('P0 fixture file loads and validates all four tasks', () => {
  const tasks = loadP0TaskFixtures(FIXTURE_FILE);
  assert.equal(tasks.length, 4);
  for (const id of [
    'P0-mechanical-reply',
    'P0-triageapp-edit',
    'P0-research-honest-fail',
    'P0-restart-recover',
  ]) {
    assert.ok(tasks.some((t) => t.taskId === id), `missing ${id}`);
  }
  for (const t of tasks) {
    assert.ok(t.goal.trim().length > 0);
    assert.ok(t.preRegisteredVerification.length > 0);
    assert.ok(t.budget.maxTokens > 0 && t.budget.maxCalls > 0);
    assert.ok(t.maxConfirmationCount >= 0 && t.maxConfirmationCount <= 1);
    assert.equal(t.connectorClass, 'agent');
  }
  const raw = JSON.parse(readFileSync(FIXTURE_FILE, 'utf8')) as {
    syntheticBenchmarkRecords: unknown;
  };
  const recs = validateBenchmarkRecords(raw.syntheticBenchmarkRecords);
  assert.equal(recs.length, 8);
});

test('P0 fixture validation rejects malformed inputs', () => {
  const base = (over: Partial<P0TaskFixture>): P0TaskFixture => ({
    taskId: 'P0-mechanical-reply',
    scenario: 's',
    goal: 'g',
    allowedMaterials: [],
    forbiddenMaterials: [],
    preRegisteredVerification: ['v'],
    budget: { maxTokens: 100, maxCalls: 1 },
    maxConfirmationCount: 1,
    orchestratedExpectation: 'e',
    directArmPurpose: 'd',
    connectorClass: 'agent',
    adapterId: 'external-executor-codex-cli',
    ...over,
  });
  assert.throws(() => validateP0TaskFixtures([base({ taskId: 'P0-not-known' })]), /unknown P0 task id/);
  assert.throws(() => validateP0TaskFixtures([base({ allowedMaterials: ['C:/Users/x.md'] })]), /relative fixture path/);
  assert.throws(() => validateP0TaskFixtures([base({ allowedMaterials: ['materials/private-notes.md'] })]), /sensitive material/);
  assert.throws(() => validateP0TaskFixtures([base({ maxConfirmationCount: 2 })]), /maxConfirmationCount/);
  assert.throws(() => validateP0TaskFixtures([base({ connectorClass: 'cursor' as never })]), /unknown connector class/);
  const onlyOne = [base({})];
  assert.throws(() => validateP0TaskFixtures(onlyOne), /missing P0 fixture/);
});

test('frozen user-facing labels never carry internal protocol jargon', () => {
  const copy = [
    ...EXTERNAL_CAPABILITY_USER_LABELS,
    ...Object.values(EXTERNAL_CAPABILITY_FAILURE),
  ].join(' ');
  for (const bad of ['MCP', 'A2A', 'tool_calls', 'endpoint', 'protocol', 'taskId', 'agent card', 'agent_card', 'SDK']) {
    assert.equal(new RegExp(bad, 'i').test(copy), false, `user-facing copy must not contain ${bad}`);
  }
});

test('same-agent requirement: every P0 task binds one connector class + adapter', () => {
  const tasks = loadP0TaskFixtures(FIXTURE_FILE);
  const classes = new Set(tasks.map((t) => t.connectorClass));
  const adapters = new Set(tasks.map((t) => t.adapterId));
  assert.deepEqual([...classes], ['agent']);
  assert.deepEqual([...adapters], ['external-executor-codex-cli']);
});