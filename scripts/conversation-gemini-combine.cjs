/**
 * DIGITALME-SEARCH-PROVIDER-GEMINI-01B — 组合 Gemini Arm A + 冻结 baseline Arm B。
 * 输出 <dir>/benchmark-runs.jsonl（与 baseline 同结构，供同一 anonymize/judge/summarize 消费）。
 */
const fs = require('node:fs');
const path = require('node:path');

const GEMINI_DIR = process.env.QR_EVIDENCE_DIR
  ? path.resolve(process.env.QR_EVIDENCE_DIR)
  : path.join(__dirname, '_conversation-gemini-benchmark-evidence');
const BASELINE_DIR = path.join(__dirname, '_conversation-p95-benchmark-01-evidence');

const geminiRuns = fs.readFileSync(path.join(GEMINI_DIR, 'benchmark-runs-gemini.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const baselineRuns = fs.readFileSync(path.join(BASELINE_DIR, 'benchmark-runs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const armA = geminiRuns.filter((r) => r.arm === 'arm-A-2digime');
const armB = baselineRuns.filter((r) => r.arm === 'arm-B-deepseek-raw');

if (armA.length !== armB.length) {
  console.error(`armA(${armA.length}) != armB(${armB.length})`);
  process.exit(1);
}

const out = [];
for (const a of armA) {
  const b = armB.find((x) => x.taskId === a.taskId);
  if (!b) { console.error('missing baseline armB for', a.taskId); process.exit(1); }
  out.push({ ...a, arm: 'arm-A-2digime' });
  out.push({ ...b, arm: 'arm-B-deepseek-raw' });
}

const outFile = path.join(GEMINI_DIR, 'benchmark-runs.jsonl');
fs.writeFileSync(outFile, out.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
console.log('combined', out.length, 'runs ->', outFile);
console.log('Arm A (Gemini):', armA.length, 'Arm B (frozen baseline):', armB.length);