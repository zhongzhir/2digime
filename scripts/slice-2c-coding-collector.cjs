const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.join(repoRoot, 'scripts', 'fixtures');
const defaultRunsRoot = path.join(repoRoot, 'scripts', '_slice-2c-coding-runs');
const markerName = '.slice-2c-run.json';

function assertAllowedRunsRoot(value) {
  const root = path.resolve(value);
  if (root === path.resolve(defaultRunsRoot)) return root;
  const tempRoot = path.resolve(os.tmpdir());
  if (root.startsWith(tempRoot + path.sep) && path.basename(root).startsWith('dm-slice-2c-')) return root;
  throw new Error('runs root must be the dedicated project directory or a dedicated system-temp directory');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const values = {};
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i];
    if (!key.startsWith('--')) throw new Error(`unexpected argument: ${key}`);
    const next = rest[i + 1];
    if (!next || next.startsWith('--')) values[key.slice(2)] = true;
    else {
      values[key.slice(2)] = next;
      i += 1;
    }
  }
  return { command, values };
}

function safeRelative(value, label) {
  if (typeof value !== 'string' || !value || path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
    throw new Error(`${label} must be a safe relative path`);
  }
  return value;
}

function run(executable, args, cwd) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(executable, args, { cwd, env, encoding: 'utf8', windowsHide: true });
}

function runGit(args, cwd) {
  const result = run('git', args, cwd);
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

async function treeDigest(root, options = {}) {
  const hash = crypto.createHash('sha256');
  async function visit(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === '.git' || options.exclude?.includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');
      if (entry.isSymbolicLink()) throw new Error(`workspace contains symlink: ${rel}`);
      hash.update(`${entry.isDirectory() ? 'd' : 'f'}:${rel}\0`);
      if (entry.isDirectory()) await visit(full);
      else hash.update(await fsp.readFile(full));
    }
  }
  await visit(root);
  return hash.digest('hex');
}

function processEvidence(executable, args, cwd) {
  const startedAt = new Date().toISOString();
  const result = run(executable, args, cwd);
  const finishedAt = new Date().toISOString();
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  return {
    result,
    evidence: {
      commandDigest: sha256(JSON.stringify([path.basename(executable), ...args])),
      outputDigest: sha256(output),
      exitCode: typeof result.status === 'number' ? result.status : -1,
      startedAt,
      finishedAt,
    },
    output,
  };
}

function loadContracts() {
  const tasks = readJson(path.join(fixtureRoot, 'slice-2c-coding-benchmark-v1.json')).tasks;
  const materials = readJson(path.join(fixtureRoot, 'slice-2c-project-materials-v1.json')).materials;
  return { tasks, materials };
}

async function prepare(values) {
  const taskId = String(values.task || '');
  const arm = String(values.arm || '');
  const mode = String(values.mode || 'real');
  if (!['leading_agent_direct', '2digime_orchestrated'].includes(arm)) throw new Error('invalid --arm');
  if (!['real', 'mechanical_fixture'].includes(mode)) throw new Error('invalid --mode');
  const { tasks, materials } = loadContracts();
  const task = tasks.find((item) => item.taskId === taskId);
  const material = materials.find((item) => item.taskId === taskId);
  if (!task || !material || task.projectClass !== material.projectClass) throw new Error('unknown or mismatched task');

  const costBasis = String(values['cost-basis'] || 'unknown');
  if (mode === 'real') {
    if (!['local_no_model', 'existing_entitlement_no_incremental_charge'].includes(costBasis)) {
      throw new Error('real collection requires a proven zero-new-cost basis');
    }
    if (values['attest-no-new-cost'] !== true) throw new Error('real collection requires --attest-no-new-cost');
  }
  const agentExecutable = path.resolve(String(values['agent-executable'] || process.execPath));
  const agentStat = await fsp.stat(agentExecutable);
  if (!agentStat.isFile()) throw new Error('agent executable must be a file');
  const agentVersion = String(values['agent-version'] || 'mechanical-fixture');
  const executorId = String(values['executor-id'] || (mode === 'real' ? 'unidentified-agent' : 'mechanical-fixture'));

  const runsRoot = assertAllowedRunsRoot(String(values['runs-root'] || defaultRunsRoot));
  await fsp.mkdir(runsRoot, { recursive: true });
  const runId = `run-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const runDir = path.join(runsRoot, runId);
  const workspace = path.join(runDir, 'workspace');
  await fsp.mkdir(runDir, { recursive: false });
  const source = path.resolve(fixtureRoot, safeRelative(material.fixtureDir, 'fixtureDir'));
  await fsp.cp(source, workspace, { recursive: true, errorOnExist: true, force: false });
  const fixtureDigest = await treeDigest(source);

  runGit(['init', '--quiet'], workspace);
  runGit(['config', 'user.name', '2digime benchmark'], workspace);
  runGit(['config', 'user.email', 'benchmark@invalid.local'], workspace);
  runGit(['add', '.'], workspace);
  runGit(['commit', '--quiet', '-m', 'fixture baseline'], workspace);
  const projectRevision = runGit(['rev-parse', 'HEAD'], workspace).trim();

  let dirtyProof = null;
  if (material.dirtySetup) {
    const protectedPath = safeRelative(material.dirtySetup.protectedPath, 'protectedPath');
    const protectedFile = path.join(workspace, protectedPath);
    await fsp.appendFile(protectedFile, String(material.dirtySetup.appendText), 'utf8');
    dirtyProof = {
      path: protectedPath,
      beforeDigest: sha256(await fsp.readFile(protectedFile)),
      beforeDiffDigest: sha256(runGit(['diff', '--', protectedPath], workspace)),
    };
  }

  const testFile = safeRelative(material.testFile, 'testFile');
  const baseline = processEvidence(process.execPath, ['--test', testFile], workspace);
  if (baseline.evidence.exitCode === 0 || !baseline.output.includes(material.expectedFailureMarker)) {
    throw new Error('registered baseline failure was not reproduced');
  }
  const plan = {
    schemaVersion: 'slice-2c-collector-run/1',
    runId,
    runsRoot,
    runDir,
    workspace,
    mode,
    scorable: mode === 'real',
    collected: false,
    taskId,
    projectClass: task.projectClass,
    arm,
    goal: task.goal,
    testFile,
    fixtureDigest,
    projectRevision,
    agent: {
      executorId,
      version: agentVersion,
      executableDigest: sha256(await fsp.readFile(agentExecutable)),
    },
    agentExecutablePath: agentExecutable,
    baselineTest: { ...baseline.evidence, matchedRegisteredFailure: true },
    dirtyProof,
    cost: {
      basis: mode === 'real' ? costBasis : 'local_no_model',
      externalChargeIncurred: false,
      amountCny: 0,
    },
    createdAt: new Date().toISOString(),
  };
  await fsp.writeFile(path.join(runDir, markerName), JSON.stringify(plan, null, 2), { encoding: 'utf8', flag: 'wx' });
  await fsp.writeFile(path.join(runDir, 'TASK.md'), `# ${taskId}\n\n${task.goal}\n`, { encoding: 'utf8', flag: 'wx' });
  process.stdout.write(`${JSON.stringify({ runId, runDir, workspace, taskId, arm, scorable: plan.scorable })}\n`);
}

function parseChangedFiles(workspace) {
  const output = runGit(['status', '--porcelain=v1', '-z'], workspace);
  if (!output) return [];
  const parts = output.split('\0').filter(Boolean);
  const files = [];
  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index];
    const status = entry.slice(0, 2);
    files.push(entry.slice(3).replace(/\\/g, '/'));
    if (/[RC]/.test(status)) index += 1;
  }
  return files;
}

async function collect(values) {
  const runDir = path.resolve(String(values.run || ''));
  const markerPath = path.join(runDir, markerName);
  const plan = readJson(markerPath);
  assertRunPath(plan, runDir);
  if (plan.collected) throw new Error('run evidence was already collected');
  const final = processEvidence(process.execPath, ['--test', plan.testFile], plan.workspace);
  if (final.evidence.exitCode !== 0) throw new Error('final registered test is not passing');
  let dirtyEvidence;
  if (plan.dirtyProof) {
    const protectedFile = path.join(plan.workspace, safeRelative(plan.dirtyProof.path, 'protectedPath'));
    dirtyEvidence = {
      path: plan.dirtyProof.path,
      beforeDigest: plan.dirtyProof.beforeDigest,
      afterDigest: sha256(await fsp.readFile(protectedFile)),
      beforeDiffDigest: plan.dirtyProof.beforeDiffDigest,
      afterDiffDigest: sha256(runGit(['diff', '--', plan.dirtyProof.path], plan.workspace)),
    };
    if (dirtyEvidence.beforeDigest !== dirtyEvidence.afterDigest || dirtyEvidence.beforeDiffDigest !== dirtyEvidence.afterDiffDigest) {
      throw new Error('pre-existing dirty change was altered');
    }
  }
  const allChanged = parseChangedFiles(plan.workspace);
  const changedFiles = allChanged.filter((file) => file !== plan.dirtyProof?.path);
  if (!changedFiles.length) throw new Error('no task change was collected');

  let outsideScopeWrites = [];
  if (plan.mode === 'real') {
    const sandboxReceiptPath = String(values['sandbox-receipt'] || '');
    if (!sandboxReceiptPath) throw new Error('real collection requires --sandbox-receipt');
    const sandboxReceipt = readJson(path.resolve(sandboxReceiptPath));
    if (path.resolve(sandboxReceipt.workingDirectory || '') !== path.resolve(plan.workspace)) {
      throw new Error('sandbox receipt working directory mismatch');
    }
    if (!Array.isArray(sandboxReceipt.outsideScopeWrites)) throw new Error('invalid sandbox receipt');
    outsideScopeWrites = sandboxReceipt.outsideScopeWrites;
  }

  let talkReceipt;
  if (plan.arm === '2digime_orchestrated') {
    const talkReceiptPath = String(values['talk-receipt'] || '');
    if (!talkReceiptPath) throw new Error('orchestrated collection requires --talk-receipt');
    talkReceipt = readJson(path.resolve(talkReceiptPath));
  }
  const evidence = {
    schemaVersion: 'slice-2c-coding-run-evidence/1',
    source: plan.mode === 'real' ? 'real_process' : 'mechanical_fixture',
    taskId: plan.taskId,
    projectClass: plan.projectClass,
    arm: plan.arm,
    workspaceId: plan.runId,
    fixtureDigest: plan.fixtureDigest,
    projectRevision: plan.projectRevision,
    agent: {
      executorId: plan.agent.executorId,
      version: plan.agent.version,
      executableDigest: plan.agent.executableDigest,
    },
    baselineTest: plan.baselineTest,
    finalTest: final.evidence,
    changedFiles,
    outsideScopeWrites,
    ...(dirtyEvidence ? { preExistingDirtyProof: dirtyEvidence } : {}),
    cost: plan.cost,
    ...(talkReceipt ? { talkReceipt } : {}),
  };
  const evidencePath = path.join(runDir, 'evidence.json');
  await fsp.writeFile(evidencePath, JSON.stringify(evidence, null, 2), { encoding: 'utf8', flag: 'wx' });
  plan.collected = true;
  plan.collectedAt = new Date().toISOString();
  await fsp.writeFile(markerPath, JSON.stringify(plan, null, 2), 'utf8');
  process.stdout.write(`${JSON.stringify({ runId: plan.runId, evidencePath, scorable: plan.scorable, source: evidence.source })}\n`);
}

function assertRunPath(plan, runDir) {
  if (plan.schemaVersion !== 'slice-2c-collector-run/1') throw new Error('invalid run marker');
  if (path.resolve(plan.runDir) !== runDir) throw new Error('run marker path mismatch');
  const runsRoot = assertAllowedRunsRoot(plan.runsRoot);
  if (path.dirname(runDir) !== runsRoot || !path.basename(runDir).startsWith('run-')) {
    throw new Error('unsafe run directory');
  }
}

async function cleanup(values) {
  const runDir = path.resolve(String(values.run || ''));
  const plan = readJson(path.join(runDir, markerName));
  assertRunPath(plan, runDir);
  await fsp.rm(runDir, { recursive: true, force: false });
  process.stdout.write(`${JSON.stringify({ removed: true, runId: plan.runId })}\n`);
}

async function main() {
  const { command, values } = parseArgs(process.argv.slice(2));
  if (command === 'prepare') await prepare(values);
  else if (command === 'collect') await collect(values);
  else if (command === 'cleanup') await cleanup(values);
  else throw new Error('Usage: prepare|collect|cleanup with --options');
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, prepare, collect, cleanup };
