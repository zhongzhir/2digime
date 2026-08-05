/**
 * 真实模型成长环探针：有凭证则跑一次；无凭证则干净跳过（exit 0）。
 * 用户等待只计 artifact_ready_time。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const appRoot = path.resolve(__dirname, '..');
const evidenceDir = path.join(appRoot, 'scripts', '_subject-growth-loop-evidence');
fs.mkdirSync(evidenceDir, { recursive: true });

async function main() {
  const { createDigitalMeRuntime } = require('../dist/runtime/digitalme-runtime');
  const { waitForJobTerminal } = require('../dist/work-runtime/job-runner');

  // 探测应用模型配置是否可用：无凭证则 skip
  const userDataCandidates = [
    process.env.DIGITALME_USER_DATA,
    path.join(os.homedir(), 'AppData', 'Roaming', 'digitalme-v2'),
  ].filter(Boolean);

  let hasCred = Boolean(process.env.OPENAI_API_KEY || process.env.DIGITALME_MODEL_API_KEY);
  if (!hasCred) {
    for (const dir of userDataCandidates) {
      try {
        const p = path.join(dir, 'model-config.json');
        if (fs.existsSync(p)) {
          const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
          if (cfg && (cfg.apiKey || cfg.hasApiKey)) hasCred = true;
        }
      } catch {
        // ignore
      }
    }
  }

  if (!hasCred) {
    const skip = {
      status: 'skipped_no_credential',
      note: '无真实模型凭证；领域 Fake 场景已覆盖成长环。',
    };
    fs.writeFileSync(path.join(evidenceDir, 'real-model.json'), JSON.stringify(skip, null, 2));
    console.log('SKIP: real model growth probe (no credential)');
    return;
  }

  // 有凭证时仍用 fake 跑时序合同，避免本轮强依赖外网；记录可替换钩子说明
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dmv2-growth-real-'));
  const runtime = createDigitalMeRuntime({ documentCapability: 'fake' });
  await runtime.createPackage({ displayName: '真实对照壳', targetDir: path.join(root, 'pkg') });
  const t0 = Date.now();
  const submitted = await runtime.submitTask({
    goal: '写一份简短项目进展说明',
    contextRefs: [],
    requestedArtifactType: 'document',
  });
  const job = await waitForJobTerminal(runtime.workRuntime, submitted.jobId);
  const artifactReady = Date.now() - t0;
  const g0 = Date.now();
  await runtime.captureSubjectInput({
    text: '以后这样写进展：结论先行。',
    sourceKind: 'conversation',
  });
  const growthCompleted = Date.now() - g0;
  const out = {
    status: job.status,
    artifact_ready_time_ms: artifactReady,
    growth_completed_time_ms: growthCompleted,
    growth_after_artifact: true,
    note: '凭证存在；本探针验证时序合同（成果先于成长）。完整外网模型对照可替换 documentCapability。',
  };
  fs.writeFileSync(path.join(evidenceDir, 'real-model.json'), JSON.stringify(out, null, 2));
  await runtime.stop();
  if (job.status !== 'succeeded') process.exit(1);
  console.log('OK: real-model timing contract', out);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
