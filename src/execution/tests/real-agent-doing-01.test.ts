/**
 * REAL-AGENT-DOING-01 单测：AtomCode 接线参数与独立验收。不 spawn 真实 Agent。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAtomCodeExecArgs,
  usesAtomCodeCli,
} from '../../capability/adapters/external-executor-codex';
import {
  assessRealAgentDoing,
  userFacingDoingResult,
} from '../real-agent-doing-review';

describe('real-agent-doing-01', () => {
  it('atomcode argv is headless, scoped to the repo, and has no solution text', () => {
    assert.equal(usesAtomCodeCli({ cliKind: 'atomcode' }), true);
    assert.equal(usesAtomCodeCli({}), false);
    const args = buildAtomCodeExecArgs({
      workingDirectory: 'D:\\tmp\\target',
      promptFile: 'D:\\tmp\\prompt.txt',
    });
    assert.deepEqual(args, [
      '-C',
      'D:\\tmp\\target',
      '--prompt-file',
      'D:\\tmp\\prompt.txt',
      '-y',
      '--no-telemetry',
    ]);
    assert.equal(args.includes('trim'), false);
    assert.equal(JSON.stringify(args).includes('formatFullName'), false);
  });

  it('independent review rejects test-only changes and missing tests', () => {
    const rejected = assessRealAgentDoing({
      goal: 'fix name formatting',
      changedFiles: ['test/format.test.js'],
      gitDiff: 'diff --git a/test/format.test.js',
      independentTestExitCode: 0,
      independentTestOutput: 'ok',
      publicApiIntact: true,
      sourceModuleStillExports: ['formatFullName'],
    });
    assert.equal(rejected.verdict, 'cto_review_rejected');
    assert.equal(rejected.testsOnlyChanged, true);
    assert.match(userFacingDoingResult(rejected), /没有通过检查/);

    const failTests = assessRealAgentDoing({
      goal: 'fix name formatting',
      changedFiles: ['src/format.js'],
      gitDiff: 'diff --git a/src/format.js',
      independentTestExitCode: 1,
      independentTestOutput: 'fail',
      publicApiIntact: true,
      sourceModuleStillExports: ['formatFullName'],
    });
    assert.equal(failTests.verdict, 'cto_review_rejected');
  });

  it('independent review accepts source fix with passing tests and intact API', () => {
    const accepted = assessRealAgentDoing({
      goal: 'fix name formatting',
      changedFiles: ['src/format.js', 'test/format.test.js'],
      gitDiff: 'diff --git a/src/format.js\n+return [given, family].filter(Boolean).join(" ")',
      independentTestExitCode: 0,
      independentTestOutput: 'pass',
      publicApiIntact: true,
      sourceModuleStillExports: ['formatFullName'],
    });
    assert.equal(accepted.verdict, 'accepted');
    assert.equal(userFacingDoingResult(accepted), '已经完成修改并检查通过。');
  });

  it('inventory scope rejects test-only changes and accepts source+tests', () => {
    const rejected = assessRealAgentDoing({
      goal: 'fix negative stock',
      changedFiles: ['test/inventory.test.js'],
      gitDiff: 'diff --git a/test/inventory.test.js',
      independentTestExitCode: 0,
      independentTestOutput: 'ok',
      publicApiIntact: true,
      sourceModuleStillExports: ['Inventory'],
      sourceFile: 'src/inventory.js',
      testFile: 'test/inventory.test.js',
      allowedRel: ['src/inventory.js', 'test/inventory.test.js'],
    });
    assert.equal(rejected.verdict, 'cto_review_rejected');
    const accepted = assessRealAgentDoing({
      goal: 'fix negative stock',
      changedFiles: ['src/inventory.js', 'test/inventory.test.js'],
      gitDiff: 'diff --git a/src/inventory.js',
      independentTestExitCode: 0,
      independentTestOutput: 'pass',
      publicApiIntact: true,
      sourceModuleStillExports: ['Inventory'],
      sourceFile: 'src/inventory.js',
      testFile: 'test/inventory.test.js',
      allowedRel: ['src/inventory.js', 'test/inventory.test.js'],
    });
    assert.equal(accepted.verdict, 'accepted');
  });
});
