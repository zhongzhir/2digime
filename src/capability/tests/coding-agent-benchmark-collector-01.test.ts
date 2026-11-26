import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateCodingRunEvidence } from '../coding-agent-benchmark-evidence';

const script = path.resolve(process.cwd(), 'scripts/slice-2c-coding-collector.cjs');

function invoke(args: string[]) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, [script, ...args], {
    cwd: process.cwd(),
    env,
    encoding: 'utf8',
    windowsHide: true,
  });
}

test('collector prepares, collects once, marks fixture evidence non-scorable, and safely cleans up', async () => {
  const runsRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'dm-slice-2c-collector-test-'));
  try {
    const metered = invoke([
      'prepare', '--task', '2C-WEB-01', '--arm', 'leading_agent_direct', '--mode', 'real',
      '--runs-root', runsRoot, '--agent-executable', process.execPath,
      '--cost-basis', 'external_metered', '--attest-no-new-cost',
    ]);
    assert.notEqual(metered.status, 0);
    assert.match(metered.stderr, /zero-new-cost basis/);
    const unattested = invoke([
      'prepare', '--task', '2C-WEB-01', '--arm', 'leading_agent_direct', '--mode', 'real',
      '--runs-root', runsRoot, '--agent-executable', process.execPath,
      '--cost-basis', 'existing_entitlement_no_incremental_charge',
    ]);
    assert.notEqual(unattested.status, 0);
    assert.match(unattested.stderr, /attest-no-new-cost/);

    const prepared = invoke([
      'prepare',
      '--task', '2C-WEB-01',
      '--arm', 'leading_agent_direct',
      '--mode', 'mechanical_fixture',
      '--runs-root', runsRoot,
      '--agent-executable', process.execPath,
      '--agent-version', process.version,
    ]);
    assert.equal(prepared.status, 0, prepared.stderr || prepared.stdout);
    const prep = JSON.parse(prepared.stdout) as { runDir: string; workspace: string; scorable: boolean };
    assert.equal(prep.scorable, false);

    await fs.writeFile(
      path.join(prep.workspace, 'src', 'price-card.cjs'),
      "function formatPrice(cents) {\n  return `¥${(cents / 100).toFixed(2)}`;\n}\n\nmodule.exports = { formatPrice };\n",
      'utf8',
    );
    const collected = invoke(['collect', '--run', prep.runDir]);
    assert.equal(collected.status, 0, collected.stderr || collected.stdout);
    const result = JSON.parse(collected.stdout) as { evidencePath: string; scorable: boolean; source: string };
    assert.equal(result.scorable, false);
    assert.equal(result.source, 'mechanical_fixture');
    const evidence = JSON.parse(await fs.readFile(result.evidencePath, 'utf8')) as unknown;
    assert.throws(() => validateCodingRunEvidence(evidence), /real_process/);

    const replay = invoke(['collect', '--run', prep.runDir]);
    assert.notEqual(replay.status, 0);
    assert.match(replay.stderr, /already collected/);

    const cleaned = invoke(['cleanup', '--run', prep.runDir]);
    assert.equal(cleaned.status, 0, cleaned.stderr || cleaned.stdout);
    await assert.rejects(() => fs.stat(prep.runDir));
  } finally {
    await fs.rm(runsRoot, { recursive: true, force: true });
  }
});
