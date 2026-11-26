import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import {
  CODING_PROJECT_CLASSES,
  CODING_SCORE_DIMENSIONS,
  evaluateCodingBenchmark,
  loadCodingBenchmarkTasks,
  scoreCodingRun,
  type CodingBenchmarkRun,
} from '../coding-agent-benchmark-gate';

const FIXTURE = path.resolve(
  __dirname,
  '../../../scripts/fixtures/slice-2c-coding-benchmark-v1.json',
);

function run(
  taskId: string,
  arm: CodingBenchmarkRun['arm'],
  score: number,
  overrides: Partial<CodingBenchmarkRun> = {},
): CodingBenchmarkRun {
  return {
    taskId,
    arm,
    realRun: true,
    projectRevision: '0123456789abcdef',
    scores: Object.fromEntries(CODING_SCORE_DIMENSIONS.map((dimension) => [dimension, score])) as CodingBenchmarkRun['scores'],
    hardFailures: [],
    endToEndEffectVerified: arm === '2digime_orchestrated',
    ...overrides,
  };
}

describe('slice-2c coding agent benchmark gate', () => {
  it('freezes four required project classes and weights total 100', () => {
    const tasks = loadCodingBenchmarkTasks(FIXTURE);
    assert.equal(tasks.length, 4);
    assert.deepEqual(new Set(tasks.map((task) => task.projectClass)), new Set(CODING_PROJECT_CLASSES));
    assert.equal(tasks.reduce((sum, task) => sum + task.weight, 0), 100);
  });

  it('protocol self-check cannot claim a real benchmark result', () => {
    const result = evaluateCodingBenchmark(loadCodingBenchmarkTasks(FIXTURE), [], { protocolOnly: true });
    assert.equal(result.verdict, 'protocol_ready');
    assert.equal(result.relativePercent, null);
    assert.match(result.reasons.join(' '), /未运行真实 Agent/);
  });

  it('requires both real arms for every frozen task', () => {
    const tasks = loadCodingBenchmarkTasks(FIXTURE);
    const runs = tasks.map((task) => run(task.taskId, '2digime_orchestrated', 5));
    const result = evaluateCodingBenchmark(tasks, runs);
    assert.equal(result.verdict, 'real_runs_incomplete');
    assert.match(result.reasons.join(' '), /leading_agent_direct/);
  });

  it('fails closed on false completion, out-of-scope writes or lost pre-existing changes', () => {
    const tasks = loadCodingBenchmarkTasks(FIXTURE);
    const runs = tasks.flatMap((task) => [
      run(task.taskId, 'leading_agent_direct', 5),
      run(task.taskId, '2digime_orchestrated', 5),
    ]);
    runs[1] = run(tasks[0]!.taskId, '2digime_orchestrated', 5, { hardFailures: ['out_of_scope_write'] });
    const result = evaluateCodingBenchmark(tasks, runs);
    assert.equal(result.verdict, 'hard_failure');
    assert.equal(scoreCodingRun(runs[1]), 0);
  });

  it('computes the relative threshold but keeps Owner acceptance pending', () => {
    const tasks = loadCodingBenchmarkTasks(FIXTURE);
    const nearRuns = tasks.flatMap((task) => [
      run(task.taskId, 'leading_agent_direct', 5),
      run(task.taskId, '2digime_orchestrated', 4.7),
    ]);
    assert.equal(evaluateCodingBenchmark(tasks, nearRuns).verdict, 'below_95_percent');

    const passingRuns = tasks.flatMap((task) => [
      run(task.taskId, 'leading_agent_direct', 4.8),
      run(task.taskId, '2digime_orchestrated', 4.6),
    ]);
    const result = evaluateCodingBenchmark(tasks, passingRuns);
    assert.equal(result.verdict, 'developer_threshold_met_owner_pending');
    assert.ok((result.relativePercent || 0) >= 95);
  });
});
