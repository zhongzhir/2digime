/**
 * DIGITALME-CONVERSATION-QUALITY-RECOVERY-01 — 组合复测运行集。
 * 读取：修复后 Arm A 复测 runs（本任务新跑）+ 冻结 baseline Arm B（a187534 的 deepseek 原始结果）。
 * 输出：<outdir>/benchmark-runs.jsonl —— 与 baseline 相同结构，供同一 anonymize/judge/summarize 消费。
 */
const fs = require('node:fs');
const path = require('node:path');

const RECOVERY_DIR = process.env.QR_EVIDENCE_DIR
  ? path.resolve(process.env.QR_EVIDENCE_DIR)
  : path.join(__dirname, '_conversation-quality-recovery-evidence');
const BASELINE_DIR = path.join(__dirname, '_conversation-p95-benchmark-01-evidence');

const recoveryRuns = fs.readFileSync(path.join(RECOVERY_DIR, 'benchmark-runs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const baselineRuns = fs.readFileSync(path.join(BASELINE_DIR, 'benchmark-runs.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const armA = recoveryRuns.filter((r) => r.arm === 'arm-A-2digime');
const armB = baselineRuns.filter((r) => r.arm === 'arm-B-deepseek-raw');

if (armA.length !== armB.length) {
  console.error(`armA(${armA.length}) != armB(${armB.length})`);
  process.exitCode = 1;
  process.exit(1);
}

const out = [];
for (let i = 0; i < armA.length; i++) {
  const a = armA[i];
  const b = armB.find((x) => x.taskId === a.taskId);
  if (!b) { console.error('missing baseline armB for', a.taskId); process.exitCode = 1; process.exit(1); }
  out.push({ ...a, arm: 'arm-A-2digime' });
  out.push({ ...b, arm: 'arm-B-deepseek-raw' });
}

const outFile = path.join(RECOVERY_DIR, 'benchmark-runs.jsonl');
fs.writeFileSync(outFile, out.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');
console.log('combined', out.length, 'runs ->', outFile);
console.log('Arm A (recovered):', armA.length, 'Arm B (frozen baseline):', armB.length);
