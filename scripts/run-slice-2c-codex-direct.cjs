const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function main() {
  const runIndex = process.argv.indexOf('--run');
  if (runIndex < 0 || !process.argv[runIndex + 1]) throw new Error('Usage: --run <collector-run-directory>');
  const runDir = path.resolve(process.argv[runIndex + 1]);
  const markerPath = path.join(runDir, '.slice-2c-run.json');
  const plan = JSON.parse(await fsp.readFile(markerPath, 'utf8'));
  if (plan.schemaVersion !== 'slice-2c-collector-run/1' || path.resolve(plan.runDir) !== runDir) {
    throw new Error('invalid collector run marker');
  }
  if (plan.mode !== 'real' || plan.arm !== 'leading_agent_direct') {
    throw new Error('direct launcher requires a real leading_agent_direct run');
  }
  if (plan.collected) throw new Error('run was already collected');
  const executable = path.resolve(plan.agentExecutablePath || '');
  const digest = sha256(await fsp.readFile(executable));
  if (digest !== plan.agent.executableDigest) throw new Error('Agent executable changed after prepare');

  const lastMessage = path.join(runDir, 'agent-last-message.txt');
  const args = [
    '--sandbox', 'workspace-write',
    '--ask-for-approval', 'never',
    '--cd', plan.workspace,
    '-c', 'windows.sandbox="unelevated"',
    'exec',
    '--ephemeral',
    '--ignore-user-config',
    '--json',
    '--output-last-message', lastMessage,
    [
      'Complete the single coding task below in the current repository.',
      'Work only inside the current repository. Do not modify tests. Do not use network tools.',
      'Run the registered test before finishing. Do not commit, push, deploy, or change credentials.',
      `Task: ${plan.goal}`,
      `Registered test: node --test ${plan.testFile}`,
    ].join('\n'),
  ];
  const startedAt = new Date().toISOString();
  const child = spawn(executable, args, {
    cwd: plan.workspace,
    windowsHide: true,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? -1));
  });
  const finishedAt = new Date().toISOString();
  await fsp.writeFile(path.join(runDir, 'agent-events.jsonl'), stdout, { encoding: 'utf8', flag: 'wx' });
  await fsp.writeFile(path.join(runDir, 'agent-stderr.txt'), stderr, { encoding: 'utf8', flag: 'wx' });
  const receipt = {
    schemaVersion: 'slice-2c-codex-sandbox-receipt/1',
    workingDirectory: plan.workspace,
    sandbox: 'workspace-write',
    windowsSandbox: 'unelevated',
    approvalPolicy: 'never',
    outsideScopeWrites: [],
    commandDigest: sha256(JSON.stringify([path.basename(executable), ...args.slice(0, -1), sha256(args.at(-1))])),
    exitCode,
    startedAt,
    finishedAt,
  };
  const receiptPath = path.join(runDir, 'sandbox-receipt.json');
  await fsp.writeFile(receiptPath, JSON.stringify(receipt, null, 2), { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ exitCode, receiptPath, lastMessage, stdoutDigest: sha256(stdout), stderrDigest: sha256(stderr) })}\n`);
  if (exitCode !== 0) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
