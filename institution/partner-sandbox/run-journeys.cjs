#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');

function run(name, command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
    shell: false,
    timeout: 600_000,
  });
  if (result.status !== 0) {
    if (result.error) throw result.error;
    const detail = `${result.stdout || ''}\n${result.stderr || ''}`.trim().slice(-6000);
    throw new Error(`${name} failed\n${detail}`);
  }
  return {
    name,
    status: 'pass',
    output: `${result.stdout || ''}\n${result.stderr || ''}`.trim().slice(-1200),
  };
}

function main() {
  const steps = [];
  steps.push(run('telecom entitlement issuance', process.execPath, [
    '--test', 'dist/runtime/tests/institution-telecom-entitlement-journey-slice4c.test.js',
  ]));
  steps.push(run('institution service subject mapping', process.execPath, [
    '--test', 'dist/identity/tests/institution-partner-service-mapping-slice4c.test.js',
  ]));
  steps.push(run('bank service collaboration accept and revoke', process.execPath, [
    '--test', 'dist/subject-core/tests/digital-self-collaboration-controls-slice3b.electron.test.js',
  ]));
  steps.push(run('A2A Agent Card Message Task Artifact interoperability', process.execPath, [
    '--test', 'dist/collaboration/tests/a2a-subject-interop-04.test.js',
  ]));
  console.log(JSON.stringify({
    verdict: 'SLICE_4C_SYNTHETIC_INSTITUTION_JOURNEYS_PASS',
    journeys: {
      telecom: ['sandbox login', 'entitlement arrival', 'Talk capability call', 'usage aggregation', 'client revocation'],
      bank: ['service Subject mapping', 'Relay/E2EE collaboration accept', 'collaboration revocation', 'A2A interop'],
    },
    steps,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}
