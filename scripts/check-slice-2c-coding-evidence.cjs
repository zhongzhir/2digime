const fs = require('node:fs');
const path = require('node:path');

const [directPath, orchestratedPath] = process.argv.slice(2);
if (!directPath || !orchestratedPath) {
  process.stderr.write('Usage: node scripts/check-slice-2c-coding-evidence.cjs <direct.json> <orchestrated.json>\n');
  process.exit(2);
}

try {
  const { validateCodingRunEvidencePair } = require('../dist/capability/coding-agent-benchmark-evidence.js');
  const direct = JSON.parse(fs.readFileSync(path.resolve(directPath), 'utf8'));
  const orchestrated = JSON.parse(fs.readFileSync(path.resolve(orchestratedPath), 'utf8'));
  const pair = validateCodingRunEvidencePair({ direct, orchestrated });
  const contract = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'slice-2c-coding-benchmark-v1.json'), 'utf8'),
  );
  const task = contract.tasks.find((item) => item.taskId === pair.taskId);
  if (!task || task.projectClass !== pair.direct.projectClass) {
    throw new Error('evidence does not match the frozen task contract');
  }
  process.stdout.write(`${JSON.stringify({ valid: true, taskId: pair.taskId, status: 'evidence_ready_for_scoring' })}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
