import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

test('slice 2C project materials are isolated, reproducibly failing, and preserve dirty work', () => {
  const script = path.resolve(process.cwd(), 'scripts/preflight-slice-2c-coding-benchmark.cjs');
  const result = spawnSync(process.execPath, [script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout) as {
    schemaVersion: string;
    results: Array<{
      projectClass: string;
      isolatedCopy: boolean;
      baselineFailedAsRegistered: boolean;
      sourceFixtureUnchanged: boolean;
      preExistingChangePreserved: boolean | null;
    }>;
  };
  assert.equal(report.schemaVersion, 'slice-2c-material-preflight/1');
  assert.equal(report.results.length, 4);
  assert.deepEqual(
    new Set(report.results.map((item) => item.projectClass)),
    new Set(['web', 'desktop', 'backend', 'dirty_worktree']),
  );
  for (const item of report.results) {
    assert.equal(item.isolatedCopy, true);
    assert.equal(item.baselineFailedAsRegistered, true);
    assert.equal(item.sourceFixtureUnchanged, true);
  }
  assert.equal(
    report.results.find((item) => item.projectClass === 'dirty_worktree')?.preExistingChangePreserved,
    true,
  );
});
