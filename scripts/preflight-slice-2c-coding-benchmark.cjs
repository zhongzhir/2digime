const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.join(repoRoot, 'scripts', 'fixtures');
const taskContractPath = path.join(fixtureRoot, 'slice-2c-coding-benchmark-v1.json');
const materialContractPath = path.join(fixtureRoot, 'slice-2c-project-materials-v1.json');
const requiredClasses = ['web', 'desktop', 'backend', 'dirty_worktree'];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
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
  return result.stdout.trim();
}

async function treeDigest(root) {
  const hash = crypto.createHash('sha256');
  async function visit(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, '/');
      if (entry.isSymbolicLink()) throw new Error(`fixture must not contain symlink: ${rel}`);
      hash.update(`${entry.isDirectory() ? 'd' : 'f'}:${rel}\0`);
      if (entry.isDirectory()) await visit(full);
      else hash.update(await fsp.readFile(full));
    }
  }
  await visit(root);
  return hash.digest('hex');
}

async function main() {
  const taskContract = readJson(taskContractPath);
  const materialContract = readJson(materialContractPath);
  const tasks = new Map(taskContract.tasks.map((task) => [task.taskId, task]));
  const materials = materialContract.materials;
  if (materials.length !== requiredClasses.length) throw new Error('material contract must contain exactly four projects');
  if (new Set(materials.map((item) => item.taskId)).size !== materials.length) throw new Error('duplicate material taskId');
  const classes = new Set(materials.map((item) => item.projectClass));
  for (const required of requiredClasses) if (!classes.has(required)) throw new Error(`missing project class: ${required}`);

  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'dm-slice-2c-materials-'));
  const resolvedTemp = path.resolve(tempRoot);
  if (!resolvedTemp.startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('unsafe temporary root');
  const results = [];
  try {
    for (const material of materials) {
      const task = tasks.get(material.taskId);
      if (!task || task.projectClass !== material.projectClass) throw new Error(`material/task mismatch: ${material.taskId}`);
      const fixtureDir = safeRelative(material.fixtureDir, 'fixtureDir');
      const testFile = safeRelative(material.testFile, 'testFile');
      const source = path.resolve(fixtureRoot, fixtureDir);
      if (!source.startsWith(fixtureRoot + path.sep)) throw new Error(`fixture escapes root: ${fixtureDir}`);
      const sourceDigestBefore = await treeDigest(source);
      const workspace = path.join(tempRoot, material.taskId);
      await fsp.cp(source, workspace, { recursive: true, errorOnExist: true, force: false });

      let dirtyProof = null;
      if (material.dirtySetup) {
        const protectedPath = safeRelative(material.dirtySetup.protectedPath, 'protectedPath');
        runGit(['init', '--quiet'], workspace);
        runGit(['config', 'user.name', '2digime benchmark'], workspace);
        runGit(['config', 'user.email', 'benchmark@invalid.local'], workspace);
        runGit(['add', '.'], workspace);
        runGit(['commit', '--quiet', '-m', 'fixture baseline'], workspace);
        const protectedFile = path.join(workspace, protectedPath);
        await fsp.appendFile(protectedFile, String(material.dirtySetup.appendText), 'utf8');
        const beforeHash = crypto.createHash('sha256').update(await fsp.readFile(protectedFile)).digest('hex');
        const beforeDiff = runGit(['diff', '--', protectedPath], workspace);
        if (!beforeDiff) throw new Error('dirty fixture did not create a pre-existing change');
        dirtyProof = { protectedPath, beforeHash, beforeDiff };
      }

      const baseline = run(process.execPath, ['--test', testFile], workspace);
      const combined = `${baseline.stdout}\n${baseline.stderr}`;
      if (baseline.status === 0 || !combined.includes(material.expectedFailureMarker)) {
        throw new Error(`baseline did not fail as registered: ${material.taskId}`);
      }

      if (dirtyProof) {
        const protectedFile = path.join(workspace, dirtyProof.protectedPath);
        const afterHash = crypto.createHash('sha256').update(await fsp.readFile(protectedFile)).digest('hex');
        const afterDiff = runGit(['diff', '--', dirtyProof.protectedPath], workspace);
        if (afterHash !== dirtyProof.beforeHash || afterDiff !== dirtyProof.beforeDiff) {
          throw new Error('pre-existing dirty change was altered by preflight');
        }
      }
      const sourceDigestAfter = await treeDigest(source);
      if (sourceDigestAfter !== sourceDigestBefore) throw new Error(`source fixture changed: ${material.taskId}`);
      results.push({
        taskId: material.taskId,
        projectClass: material.projectClass,
        isolatedCopy: true,
        baselineFailedAsRegistered: true,
        sourceFixtureUnchanged: true,
        preExistingChangePreserved: dirtyProof ? true : null,
      });
    }
  } finally {
    await fsp.rm(resolvedTemp, { recursive: true, force: true });
  }

  process.stdout.write(`${JSON.stringify({ schemaVersion: 'slice-2c-material-preflight/1', results })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
