/**
 * AI-NATIVE-MATERIAL-AWARE-WORKFLOW-32-ROUTING-CLOSE 真实模型两场景
 * 凭证：Electron 用户数据导出（load-app-model-credential）
 * 只验证能力选择：实施 → Coding；纯报告 → 文档。不启动 Owner 验收。
 *
 * 用法（digitalme-v2）：
 *   node scripts/run-ai-native-material-aware-workflow-32-routing-close-real.cjs
 */
'use strict';

const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(
  ROOT,
  'scripts',
  '_ai-native-material-aware-workflow-32-routing-close-evidence',
);
const CRED = path.join(
  ROOT,
  'scripts',
  '_mvp-p14-real-capability-evidence',
  '.runtime-model-credential.json',
);
const IMPRINT_SRC = 'D:\\Projects\\IMPRINT';
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

fs.rmSync(EVIDENCE, { recursive: true, force: true });
fs.mkdirSync(EVIDENCE, { recursive: true });

function fail(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`OK: ${msg}`);
}

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) copyTree(from, to);
    else fs.copyFileSync(from, to);
  }
}

function hashTree(rootDir) {
  const files = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else {
        const rel = path.relative(rootDir, p).replace(/\\/g, '/');
        const buf = fs.readFileSync(p);
        files.push({
          rel,
          size: buf.length,
          sha256: crypto.createHash('sha256').update(buf).digest('hex'),
        });
      }
    }
  };
  walk(rootDir);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return {
    count: files.length,
    digest: crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex'),
  };
}

function loadCredential() {
  if (!fs.existsSync(ELECTRON)) fail(`electron missing: ${ELECTRON}`);
  const load = spawnSync(
    ELECTRON,
    [path.join(ROOT, 'scripts', 'load-app-model-credential.cjs')],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true },
  );
  if (load.status !== 0) {
    fail(`load-app-model-credential exited ${load.status}: ${load.stderr || load.stdout}`);
  }
  if (!fs.existsSync(CRED)) fail('credential file missing after load');
  const meta = JSON.parse(fs.readFileSync(CRED, 'utf8'));
  if (!meta.apiKey || !meta.baseUrl || !meta.model) fail('credential incomplete');
  ok(`credential host=${new URL(meta.baseUrl).host} model=${meta.model}`);
  return meta;
}

async function waitJob(runtime, jobId, ms) {
  const { waitForJobTerminal } = require('../dist/work-runtime/job-runner');
  return waitForJobTerminal(runtime.workRuntime, jobId, ms);
}

async function runScenario(input) {
  const {
    createDigitalMeRuntime,
  } = require('../dist/runtime/digitalme-runtime');
  const { createCommandBus } = require('../dist/runtime/command-bus');
  const {
    createEnvSecretAccessor,
  } = require('../dist/infrastructure/env-secrets');

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), `dm-32rc-${input.id}-`));
  copyTree(input.projectSrc, fixture);
  const before = hashTree(fixture);
  let codingHits = 0;

  const secrets = createEnvSecretAccessor(process.env, 'openai-compatible', input.cred);
  const runtime = createDigitalMeRuntime({
    documentCapability: 'openai-compatible',
    registerOpenAiStub: false,
    openaiCompatible: {
      providerId: 'openai-compatible',
      baseUrl: input.cred.baseUrl,
      model: input.cred.model,
      apiKey: input.cred.apiKey,
      timeoutMs: 180_000,
    },
    secrets,
    externalExecutorCapability: {
      forceAvailability: 'ready',
      executeHook: async () => {
        codingHits += 1;
        const note = path.join(fixture, `routing-close-${input.id}.txt`);
        fs.writeFileSync(note, `routing-close ${input.id}\n`, 'utf8');
        return {
          exitCode: 0,
          summary: `routing-close ${input.id}`,
          changedFiles: [`routing-close-${input.id}.txt`],
          unifiedDiff:
            `diff --git a/routing-close-${input.id}.txt b/routing-close-${input.id}.txt\n` +
            `new file mode 100644\n--- /dev/null\n+++ b/routing-close-${input.id}.txt\n@@ -0,0 +1 @@\n+routing-close ${input.id}\n`,
        };
      },
    },
  });
  const bus = createCommandBus(runtime);
  const pkgDir = path.join(fixture, '_pkg');
  await bus.invoke('subject.createPackage', {
    displayName: `32-routing-${input.id}`,
    targetDir: pkgDir,
  });

  const first = await bus.invoke('work.converse', {
    text: input.goal,
    contextRefs: [{ kind: 'folder', path: fixture, projectOrigin: 'user_selected' }],
  });
  const jobsBefore = await runtime.workRuntime.listJobsForTask(first.taskId);
  if (first.startAuthorized) throw new Error(`${input.id}: first turn must not start`);
  if (jobsBefore.length !== 0) throw new Error(`${input.id}: jobs before confirm = ${jobsBefore.length}`);

  const confirm = await bus.invoke('work.converse', {
    taskId: first.taskId,
    text: '按这个方案开始。',
  });
  if (!confirm.startAuthorized) {
    throw new Error(
      `${input.id}: confirm not authorized reply=${String(confirm.reply || '').slice(0, 200)} degraded=${confirm.degraded}`,
    );
  }
  if (confirm.executionIntentKind !== input.expectKind) {
    throw new Error(
      `${input.id}: executionIntentKind=${confirm.executionIntentKind} expected=${input.expectKind}`,
    );
  }
  if (confirm.executionRequestedArtifactType !== input.expectFamily) {
    throw new Error(
      `${input.id}: family=${confirm.executionRequestedArtifactType} expected=${input.expectFamily}`,
    );
  }

  const submitted = await bus.invoke('work.submitTask', {
    goal: input.goal,
    contextRefs: [{ kind: 'folder', path: fixture, projectOrigin: 'user_selected' }],
    existingTaskId: first.taskId,
    confirmedPlanVersion: confirm.plan?.version || first.plan?.version || 1,
    intentKind: confirm.executionIntentKind,
    requestedArtifactType: confirm.executionRequestedArtifactType,
    ...(input.expectCap === 'coding'
      ? {
          executionAuthorization: {
            confirmed: true,
            workingDirectory: fixture,
            readScope: ['.'],
            writeScope: ['.'],
          },
        }
      : {}),
  });
  if (!submitted.jobId) {
    throw new Error(`${input.id}: no jobId ${JSON.stringify(submitted)}`);
  }
  const job = await waitJob(runtime, submitted.jobId, 240_000);
  const jobs = await runtime.workRuntime.listJobsForTask(first.taskId);
  if (jobs.length !== 1) throw new Error(`${input.id}: job count ${jobs.length}`);
  const capId = String(job.capabilityId || '');
  const after = hashTree(fixture);
  const result = {
    id: input.id,
    goal: input.goal,
    expectCap: input.expectCap,
    startAuthorized: confirm.startAuthorized,
    executionIntentKind: confirm.executionIntentKind,
    executionRequestedArtifactType: confirm.executionRequestedArtifactType,
    jobId: job.id,
    jobStatus: job.status,
    capabilityId: capId,
    codingHits,
    fixtureDigestBefore: before.digest,
    fixtureDigestAfter: after.digest,
    fixtureChanged: before.digest !== after.digest,
    planPreview: String(confirm.plan?.content || first.plan?.content || '').slice(0, 400),
    replyPreview: String(confirm.reply || '').slice(0, 300),
  };

  if (input.expectCap === 'coding') {
    if (!/external_executor|codex/i.test(capId)) {
      throw new Error(`${input.id}: expected coding cap, got ${capId}`);
    }
    if (codingHits < 1) throw new Error(`${input.id}: coding hook not called`);
  } else {
    if (/external_executor|codex/i.test(capId)) {
      throw new Error(`${input.id}: expected document cap, got ${capId}`);
    }
    if (codingHits !== 0) throw new Error(`${input.id}: coding must not run`);
    // 报告场景允许文档写入包目录，但不应走 Coding hook；fixture 主体变更仅允许 _pkg
  }

  await runtime.stop();
  return result;
}

async function main() {
  process.chdir(ROOT);
  const build = spawnSync('npm', ['run', 'build'], { stdio: 'inherit', shell: true });
  if (build.status !== 0) process.exit(build.status || 1);
  ok('build');

  if (!fs.existsSync(IMPRINT_SRC)) fail(`IMPRINT missing: ${IMPRINT_SRC}`);
  const cred = loadCredential();

  const report = {
    schemaVersion: 'ai-native-material-aware-workflow-32-routing-close-real/1',
    task: 'AI-NATIVE-MATERIAL-AWARE-WORKFLOW-32-ROUTING-CLOSE',
    ownerAccepted: false,
    startedAt: new Date().toISOString(),
    model: { baseUrl: cred.baseUrl, model: cred.model },
    scenarios: {},
    verdict: 'pending',
  };

  try {
    report.scenarios.implement = await runScenario({
      id: 'implement',
      goal: '提出/规划项目优化升级方案，待批准后实施。',
      projectSrc: IMPRINT_SRC,
      cred,
      expectKind: 'modify_code',
      expectFamily: 'code-change',
      expectCap: 'coding',
    });
    ok('scenario implement → Coding');

    report.scenarios.report_only = await runScenario({
      id: 'report_only',
      goal: '只分析这个项目并写一份评估报告，暂不修改任何文件。',
      projectSrc: IMPRINT_SRC,
      cred,
      expectKind: 'create_document',
      expectFamily: 'document',
      expectCap: 'document',
    });
    ok('scenario report_only → document');

    report.verdict = 'passed_pending_cto_review';
    report.finishedAt = new Date().toISOString();
  } catch (e) {
    report.verdict = 'failed';
    report.error = String(e && e.message ? e.message : e);
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(EVIDENCE, 'REPORT.json'), `${JSON.stringify(report, null, 2)}\n`);
    fail(report.error);
  }

  fs.writeFileSync(path.join(EVIDENCE, 'REPORT.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log('\n--- routing-close real summary ---');
  console.log(JSON.stringify(report, null, 2));
  console.log(`evidence: ${EVIDENCE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
